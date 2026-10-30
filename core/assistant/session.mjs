// Assistant: the session logic for assistant mode. Pure; ES2017-conservative.
//
// This is a sub-reducer of core/listening/session.mjs, not a second machine: both push-to-talk keys use
// the same microphone, so they share the recording phases (listening -> transcribing). On top of those
// the assistant adds three phases of its own:
//
//   unlocking    waiting for the fingerprint check (the key does nothing until it succeeds)
//   thinking     waiting for the local model's reply to a request
//   clarifying   more than one window fits; waiting for you to say or press which one
//
// Happy path:  AssistPressed (unlocked) -> listening -> AssistReleased -> transcribing
//              -> TranscriptReceived + ClientsSnapshot -> thinking -> ModelReplied -> actions (back to idle)
//
// Events (all stamped with `at`, ms since the epoch, by the shell: the core has no clock, and a missing
// `at` counts as locked): AssistPressed, AssistReleased, UnlockResult{ok, reason}, ModelReplied{id, text},
// ModelFailed{id, message}, ChoiceSelected{number}, ClarifyExpired.
// Effects: auth.verify{timeoutSeconds}, auth.cancel, llm.interpret{id, request, timeoutSeconds}, llm.cancel,
// assistant.status{text}, assistant.clarify.show{title, rows}, assistant.clarify.hide,
// clarify.timer.arm{ms}, clarify.timer.disarm, plus voxtype/watchdog/notify/log and the plan's actions.
//
// Nothing said, no window title and no model reply is ever written to a log line: only counts and kinds.

import { notify } from "../execution/actions.mjs";
import { activeWindow } from "../execution/windows.mjs";
import { normalize } from "../interpretation/utterance.mjs";
import { idle, log, result } from "../listening/state.mjs";
import { candidates, buildRequest, parseIntent, plan, choose, clarifyRows, clarifyTitle } from "./windows.mjs";
import { parseChoice } from "./choice.mjs";

var AUTH_TIMEOUT_SECONDS = 20;

var UNLOCK_FAILURES = {
  failed: "Fingerprint not recognised",
  timeout: "No fingerprint was presented in time",
  unavailable: "The fingerprint reader is not available",
  locked: "The screen is locked",
};

// Unlocked only with a real clock reading that is still inside the window (fail closed otherwise).
export function isUnlocked(state) {
  return typeof state.now === "number" && state.now > 0 && state.now < state.unlockedUntil;
}

// Sudo-style: every use pushes the expiry out again.
function extend(state) {
  return Object.assign({}, state, { unlockedUntil: state.now + state.config.assistant.unlockMinutes * 60000 });
}

function currentWorkspace(clients) {
  var focused = activeWindow(clients);
  return focused && focused.workspace && Number.isInteger(focused.workspace.id) ? focused.workspace.id : null;
}

// Finished (or failed): back to rest.
function done(state, effects) {
  return result(idle(state), [{ type: "watchdog.disarm" }].concat(effects));
}

// An answer we could not use: keep waiting on the same question.
function stillAsking(state, effects) {
  var s = Object.assign({}, state, { phase: "clarifying", mode: "command", transcript: null, clients: null, unlocked: false });
  return result(s, [{ type: "watchdog.disarm" }, { type: "clarify.timer.arm", ms: state.config.assistant.clarifySeconds * 1000 }].concat(effects));
}

function recordingStart(state) {
  return [
    { type: "voxtype.start", model: state.config.voxtype.model, showOsd: state.config.voxtype.showOsd },
    { type: "watchdog.arm", ms: state.config.voxtype.maxSeconds * 1000 },
  ];
}

export function onPressed(state) {
  var a = state.config.assistant;
  if (!a.enabled) return result(state, [notify("Assistant is off", "Set assistant.enabled to true in the vocon config", "low")]);
  var answering = state.phase === "clarifying";
  if (state.phase !== "idle" && !answering) return result(state, [log("assistant: ignored press while " + state.phase)]);

  if (!isUnlocked(state)) {
    return result(Object.assign({}, idle(state), { phase: "unlocking", mode: "assistant" }), [
      { type: "auth.verify", timeoutSeconds: AUTH_TIMEOUT_SECONDS },
      { type: "watchdog.arm", ms: (AUTH_TIMEOUT_SECONDS + 5) * 1000 },
      notify("Assistant locked", "Touch the fingerprint sensor, then press the key again", "low"),
    ]);
  }

  // The assistant and `dictate` never share a press: a press for one drops the other.
  var effects = state.dictation ? [{ type: "dictation.timer.disarm" }] : [];
  var next = Object.assign({}, extend(state), { phase: "listening", mode: "assistant", transcript: null, clients: null, dictation: null });
  return result(next, effects.concat(recordingStart(state)));
}

export function onReleased(state) {
  if (state.phase !== "listening" || state.mode !== "assistant") return result(state);
  return result(Object.assign({}, state, { phase: "transcribing" }), [
    { type: "voxtype.stop", timeoutSeconds: state.config.voxtype.transcribeTimeoutSeconds },
    { type: "hypr.snapshotClients" },
    { type: "watchdog.arm", ms: (state.config.voxtype.transcribeTimeoutSeconds + 5) * 1000 },
  ]);
}

export function onUnlockResult(state, event) {
  if (state.phase !== "unlocking") return result(state);
  var minutes = state.config.assistant.unlockMinutes;
  if (event.ok === true && typeof state.now === "number" && state.now > 0) {
    return done(extend(state), [
      notify("Assistant unlocked", "Press the key again and speak. It stays unlocked " + minutes + " minutes after you last use it.", "low"),
      log("assistant: unlocked"),
    ]);
  }
  // Only fixed texts are shown; whatever `reason` says is not echoed.
  var why = Object.prototype.hasOwnProperty.call(UNLOCK_FAILURES, event.reason) ? UNLOCK_FAILURES[event.reason] : "Unlock failed";
  return done(state, [notify("Assistant is still locked", why, "normal"), log("assistant: unlock failed")]);
}

// The window list at the time of a spoken answer must still contain what we are about to act on.
function stillThere(clients, address) {
  return (clients || []).some(function (c) { return c && c.mapped !== false && c.address === address; });
}

// A plan -> the end of this request: its actions, or the reason there are none.
function finish(state, p) {
  if (p.kind === "none") return done(state, [notify("Assistant", p.reason, "low"), log("assistant: nothing to do")]);
  if (!isUnlocked(state)) {
    return done(state, [notify("Assistant locked", "The unlock expired; touch the sensor and ask again", "normal"), log("assistant: unlock expired")]);
  }
  return result(extend(idle(state)), [{ type: "watchdog.disarm" }].concat(p.actions, [notify("Assistant", p.summary, "low"), log("assistant: acted")]));
}

function ask(state, p) {
  var pending = Object.assign({}, state.pending, { clarification: p });
  return result(Object.assign({}, state, { phase: "clarifying", pending: pending }), [
    { type: "watchdog.disarm" },
    { type: "assistant.clarify.show", title: clarifyTitle(p), rows: clarifyRows(p) },
    { type: "clarify.timer.arm", ms: state.config.assistant.clarifySeconds * 1000 },
    log("assistant: asking which of " + p.options.length + " windows"),
  ]);
}

export function onModelReplied(state, event) {
  if (state.phase !== "thinking" || !state.pending || event.id !== state.pending.id) return result(state);
  var windows = state.pending.windows;
  var parsed = parseIntent(event.text, windows.length);
  if (!parsed.ok) return done(state, [notify("Assistant", parsed.error, "normal"), log("assistant: unusable reply")]);
  var p = plan(parsed.intent, windows, { workspace: state.pending.workspace });
  var line = log("assistant: " + parsed.intent.verb + ", " + parsed.intent.matches.length + " window(s) -> " + p.kind);
  var out = p.kind === "clarify" ? ask(state, p) : finish(state, p);
  return result(out.state, out.effects.concat([line]));
}

export function onModelFailed(state, event) {
  if (state.phase !== "thinking" || !state.pending || event.id !== state.pending.id) return result(state);
  return done(state, [notify("Assistant couldn't reach the model", String(event.message), "normal"), log("assistant: model failed")]);
}

// A number pressed in the overlay. The overlay only offers valid ones, so anything else is ignored.
export function onChoiceSelected(state, event) {
  var c = state.phase === "clarifying" && state.pending ? state.pending.clarification : null;
  if (!c) return result(state);
  if (!Number.isInteger(event.number) || !c.options[event.number - 1]) return result(state, [log("assistant: ignored a bad choice")]);
  return finish(state, choose(c, event.number, { workspace: state.pending.workspace }));
}

export function onClarifyExpired(state) {
  if (state.phase !== "clarifying") return result(state);
  return done(state, [notify("Assistant timed out", "No answer, so nothing was done", "low"), log("assistant: question expired")]);
}

// You said which one (or cancelled).
function answer(state, heard) {
  var c = state.pending.clarification;
  var choice = parseChoice(heard, c.options.length);
  if (choice.kind === "cancel") return done(state, [notify("Assistant cancelled", "", "low"), log("assistant: cancelled by voice")]);
  if (choice.kind === "unclear") {
    return stillAsking(state, [notify("Assistant", "Say a number from 1 to " + c.options.length + ", or cancel", "low"), log("assistant: unclear answer")]);
  }
  var picked = c.options[choice.number - 1];
  if (!stillThere(state.clients, picked.address)) return done(state, [notify("Assistant", "That window is gone", "low"), log("assistant: chosen window gone")]);
  var here = currentWorkspace(state.clients);
  return finish(state, choose(c, choice.number, { workspace: here === null ? state.pending.workspace : here }));
}

// A new request: ask the local model. The transcript only travels inside the effect.
function interpretNew(state, heard) {
  var windows = candidates(state.clients, state.config);
  if (windows.length === 0) return done(state, [notify("Assistant", "No windows to choose from", "low"), log("assistant: no windows")]);
  var id = state.requestSeq + 1;
  var a = state.config.assistant;
  var next = Object.assign({}, extend(idle(state)), {
    phase: "thinking",
    requestSeq: id,
    pending: { id: id, windows: windows, workspace: currentWorkspace(state.clients), clarification: null },
  });
  return result(next, [
    { type: "watchdog.arm", ms: (a.timeoutSeconds + 5) * 1000 },
    { type: "assistant.status", text: "Thinking…" },
    { type: "llm.interpret", id: id, request: buildRequest(windows, heard), timeoutSeconds: a.timeoutSeconds },
    log("assistant: " + normalize(heard).length + " word(s) -> asking the model about " + windows.length + " window(s)"),
  ]);
}

// Both the transcript and the window snapshot are in, the screen is unlocked (checked by the caller).
export function complete(state) {
  var heard = state.transcript.trim();
  var answering = state.pending && state.pending.clarification;
  if (normalize(heard).length === 0) {
    var nothing = [notify("Assistant", "Didn't hear anything", "low"), log("assistant: nothing heard")];
    return answering ? stillAsking(state, nothing) : done(state, nothing);
  }
  if (!isUnlocked(state)) {
    return done(state, [notify("Assistant locked", "The unlock expired; touch the sensor and try again", "normal"), log("assistant: unlock expired")]);
  }
  return answering ? answer(state, heard) : interpretNew(state, heard);
}
