// Listening: the push-to-talk session as a pure state machine.
//
//   reduce(state, event) -> { state, effects }
//
// Phases: idle -> listening (key held) -> transcribing (key released) -> idle.
// The shell performs the returned effects and feeds results back as events:
//   PttPressed, PttReleased, TranscriptReceived{text}, ClientsSnapshot{clients},
//   RecordingFailed{message}, ScreenLocked, Cancelled, WatchdogExpired, ConfigLoaded{config, errors}
// Assistant mode (its own key; see assistant/session.mjs) adds AssistPressed, AssistReleased, UnlockResult,
// ModelReplied, ModelFailed, ChoiceSelected, ClarifyExpired, and the phases unlocking/thinking/clarifying.
// Every event may carry `at` (ms); the assistant's unlock window is measured with it.
// ClientsSnapshot carries `unlocked`: only `true` lets a command run (fail closed; see `refuse`).
// Effects: voxtype.start/stop/cancel, hypr.snapshotClients, watchdog.arm/disarm, notify, log,
// plus whatever actions the matched command emits.
// Pure; ES2017-conservative.

import { defaults } from "../config.mjs";
import { interpret, registryErrors } from "../pipeline.mjs";
import { notify, typeText } from "../execution/actions.mjs";
import { activeWindow } from "../execution/windows.mjs";
import { normalize, afterWords } from "../interpretation/utterance.mjs";
import { idle, log, result } from "./state.mjs";
import * as Assistant from "../assistant/session.mjs";

export function initialState(config) {
  // dictation: null, or { address } of the window it was armed for (see completeDictation)
  // mode: which key started this ("command" | "assistant"); now: the last event time; unlockedUntil: the
  // assistant's fingerprint unlock; pending: the assistant's request in flight (see assistant/session.mjs)
  return {
    phase: "idle", mode: "command", transcript: null, clients: null, unlocked: false, dictation: null,
    now: 0, unlockedUntil: 0, pending: null, requestSeq: 0, config: config || defaults,
  };
}

function fail(state, message) {
  return result(idle(state), [
    { type: "watchdog.disarm" },
    notify("Voice command failed", message, "critical"),
    log("failed: " + message),
  ]);
}

function failureTitle(outcome) {
  return outcome.kind === "incomplete" ? "Incomplete command"
    : outcome.kind === "ambiguous" ? "Ambiguous command"
    : "Didn't understand";
}

// "move banana" -> “move banana” — after "move", expected: focused
function failureBody(transcript, outcome) {
  var heard = "“" + transcript + "”";
  if (outcome.kind === "ambiguous") return heard + " — “" + outcome.candidates.join("” or “") + "” fit equally";
  var after = outcome.path && outcome.path.length ? " after “" + outcome.path.join(" ") + "”" : "";
  var expected = outcome.expected && outcome.expected.length ? ", expected: " + outcome.expected.join(" | ") : "";
  return heard + " —" + (outcome.kind === "incomplete" ? " missing" + after : " no match" + after) + expected;
}

// Voice control is off while the screen is locked. Nothing is interpreted, typed or run, any armed
// dictation is dropped, and the transcript is not logged. "Locked" includes "can't tell": the shell
// reports `unlocked: true` only when it positively confirmed an unlocked session.
function refuse(state) {
  return result(Object.assign({}, idle(state), { dictation: null }), [
    { type: "watchdog.disarm" },
    { type: "dictation.timer.disarm" },
    notify("Voice commands are off", "The screen is locked", "low"),
    log("refused: screen locked"),
  ]);
}

// What the log says about an utterance. Speech is never logged (it can be anything: a misfired press,
// background talk, text meant for dictation); only the word count and what the parser did with it.
// `path` and `candidates` are grammar words from the command tree, never heard words.
function heardLine(transcript, outcome) {
  var line = "heard " + normalize(transcript).length + " word(s) -> " + outcome.kind;
  if (outcome.commandId) line += " " + outcome.commandId + " (score " + outcome.score.toFixed(2) + ")";
  if (outcome.kind !== "matched" && outcome.path && outcome.path.length) line += " after \u201c" + outcome.path.join(" ") + "\u201d";
  return line;
}

// Dictation: `dictate` arms it; the next utterance is typed into the focused window instead of being
// interpreted. It is single-shot and stays armed only until it expires, is cancelled, or the
// focused window changes, so a later command can never be typed into the wrong place.
function completeDictation(state) {
  var heard = state.transcript.trim();
  var words = normalize(heard).join(" ");
  var active = activeWindow(state.clients);
  var armed = state.dictation;

  // Finish dictation: disarm it and its timer.
  var end = function (effects) {
    return result(Object.assign({}, idle(state), { dictation: null }),
      [{ type: "watchdog.disarm" }, { type: "dictation.timer.disarm" }].concat(effects));
  };
  // Nothing usable heard: stay armed.
  var keep = function (effects) {
    return result(idle(state), [{ type: "watchdog.disarm" }].concat(effects));
  };

  if (words === "") return keep([notify("Dictation", "Didn't hear anything \u2014 still listening", "low"), log("dictation: nothing heard")]);
  if (words === "cancel") return end([notify("Dictation cancelled", "", "low"), log("dictation: cancelled by voice")]);
  if (state.config.dictation.ignore.indexOf(words) !== -1) {
    return keep([notify("Dictation", "Ignored \u201c" + heard + "\u201d (probably silence) \u2014 still listening", "low"), log("dictation: ignored a likely hallucination")]);
  }
  if (armed.address && (!active || active.address !== armed.address)) {
    return end([notify("Dictation cancelled", "The focused window changed", "normal"), log("dictation: focus changed, discarded")]);
  }
  // Only the length is logged: dictated text is message content.
  return end([typeText(heard), log("dictation: typed " + heard.length + " characters")]);
}

// `dictate <text>`: type <text> now, without a second key press. It goes through the same checks as an
// armed dictation (ignore list, "cancel", focus), and stays armed with its timer if nothing was typed.
function dictateInline(state) {
  var focused = activeWindow(state.clients);
  var done = completeDictation(Object.assign({}, state, {
    transcript: afterWords(state.transcript, 1),
    dictation: { address: focused ? focused.address : null },
  }));
  if (!done.state.dictation) return done;
  return result(done.state, done.effects.concat([{ type: "dictation.timer.arm", ms: state.config.dictation.armSeconds * 1000 }]));
}

// Both inputs are in: interpret and hand back the command's actions.
function complete(state) {
  if (!state.unlocked) return refuse(state);
  if (state.mode === "assistant") return Assistant.complete(state);
  if (state.dictation) return completeDictation(state);
  var interpreted = interpret(state.config, { clients: state.clients }, state.transcript);
  var outcome = interpreted.outcome;
  // Dictated text is message content: skip the "heard ..." log and success notification below.
  if (outcome.kind === "matched" && interpreted.actions.some(function (a) { return a.type === "dictation.arm" && a.inline; })) {
    return dictateInline(state);
  }
  var feedback = state.config.feedback;
  var effects = [{ type: "watchdog.disarm" }, log(heardLine(state.transcript, outcome))];

  if (outcome.kind === "matched") {
    var arm = interpreted.actions.some(function (a) { return a.type === "dictation.arm"; });
    effects = effects.concat(interpreted.actions.filter(function (a) { return a.type !== "dictation.arm"; }));
    // Actions marked `private` carry what was said (a note): no toast quoting it either.
    var quiet = interpreted.actions.some(function (a) { return a.private; });
    if (feedback.notifyOnSuccess && !quiet) effects.push(notify("Voice command", state.transcript, "low"));
    if (arm) {
      var focused = activeWindow(state.clients);
      effects.push({ type: "dictation.timer.arm", ms: state.config.dictation.armSeconds * 1000 });
      effects.push(notify("Dictation on", "Hold the key and speak; it types into this window. Say \u201ccancel\u201d to stop.", "low"));
      return result(Object.assign({}, idle(state), { dictation: { address: focused ? focused.address : null } }), effects);
    }
  } else if (outcome.kind !== "empty" && feedback.notifyOnNoMatch) {
    effects.push(notify(failureTitle(outcome), failureBody(state.transcript, outcome), "low"));
  }
  return result(idle(state), effects);
}

function recording(state) {
  return state.phase === "listening" || state.phase === "transcribing";
}

function maybeComplete(state) {
  return state.transcript !== null && state.clients !== null ? complete(state) : result(state);
}

// Leaving an assistant phase must always undo what it started, whichever event caused it: the model
// request, the fingerprint check, the question on screen. Done here once rather than in every branch.
function settle(before, event, out) {
  var after = out.state;
  var extra = [];
  var asked = before.pending && before.pending.clarification;
  if (asked && !(after.pending && after.pending.clarification)) {
    extra.push({ type: "clarify.timer.disarm" }, { type: "assistant.clarify.hide" });
  }
  if (before.phase === "thinking" && after.phase !== "thinking" && event.type !== "ModelReplied" && event.type !== "ModelFailed") {
    extra.push({ type: "llm.cancel" });
  }
  if (before.phase === "unlocking" && after.phase !== "unlocking" && event.type !== "UnlockResult") {
    extra.push({ type: "auth.cancel" });
  }
  return extra.length ? result(after, out.effects.concat(extra)) : out;
}

export function reduce(state, event) {
  // Each event is judged by its own time. No timestamp means 0, which the assistant treats as locked.
  var stamped = Object.assign({}, state, { now: typeof event.at === "number" ? event.at : 0 });
  return settle(stamped, event, step(stamped, event));
}

function step(state, event) {
  switch (event.type) {
    case "ConfigLoaded": {
      // A file that can't be used at all must not wipe the working config.
      if (event.ok === false) {
        var why = (event.errors || []).join("; ");
        return result(state, [
          notify("vocon config not loaded", why + " \u2014 keeping the previous config", "normal"),
          log("config rejected: " + why),
        ]);
      }
      var problems = (event.errors || []).concat(registryErrors(event.config));
      var effects = problems.length
        ? [notify("vocon config problems", problems.join("; "), "normal"), log("config problems: " + problems.join("; "))]
        : [log("config loaded")];
      return result(Object.assign({}, state, { config: event.config }), effects);
    }

    case "PttPressed":
      if (state.phase !== "idle") return result(state, [log("ignored press while " + state.phase)]);
      return result(Object.assign({}, state, { phase: "listening", transcript: null, clients: null }), [
        { type: "voxtype.start", model: state.config.voxtype.model, showOsd: state.config.voxtype.showOsd },
        { type: "watchdog.arm", ms: (state.dictation ? state.config.dictation.maxSeconds : state.config.voxtype.maxSeconds) * 1000 },
      ]);

    case "PttReleased":
      if (state.phase !== "listening" || state.mode !== "command") return result(state);
      return result(Object.assign({}, state, { phase: "transcribing" }), [
        { type: "voxtype.stop", timeoutSeconds: state.config.voxtype.transcribeTimeoutSeconds },
        { type: "hypr.snapshotClients" },
        { type: "watchdog.arm", ms: (state.config.voxtype.transcribeTimeoutSeconds + 5) * 1000 },
      ]);

    case "TranscriptReceived":
      if (state.phase !== "transcribing") return result(state);
      return maybeComplete(Object.assign({}, state, { transcript: event.text }));

    case "ClientsSnapshot":
      if (state.phase !== "transcribing") return result(state);
      return maybeComplete(Object.assign({}, state, { clients: event.clients, unlocked: event.unlocked === true }));

    case "AssistPressed":
      return Assistant.onPressed(state);

    case "AssistReleased":
      return Assistant.onReleased(state);

    case "UnlockResult":
      return Assistant.onUnlockResult(state, event);

    case "ModelReplied":
      return Assistant.onModelReplied(state, event);

    case "ModelFailed":
      return Assistant.onModelFailed(state, event);

    case "ChoiceSelected":
      return Assistant.onChoiceSelected(state, event);

    case "ClarifyExpired":
      return Assistant.onClarifyExpired(state);

    case "ScreenLocked":
      return state.phase === "idle" ? result(state) : refuse(state);

    case "RecordingFailed":
      return state.phase === "idle" ? result(state) : fail(state, event.message);

    case "WatchdogExpired":
      if (state.phase === "idle") return result(state);
      // Only a recording vocon started is cancelled; waiting on the fingerprint or the model is not one.
      if (!recording(state)) {
        return result(idle(state), [notify("Assistant timed out", "Nothing was done", "normal"), log("watchdog expired while " + state.phase)]);
      }
      return result(idle(state), [
        { type: "voxtype.cancel" },
        notify("Voice command timed out", "Recording was cancelled", "normal"),
        log("watchdog expired while " + state.phase),
      ]);

    case "DictationExpired":
      if (!state.dictation) return result(state);
      return result(Object.assign({}, state, { dictation: null }), [
        notify("Dictation timed out", "Say \u201cdictate\u201d to start again", "low"),
        log("dictation expired"),
      ]);

    case "Cancelled":
      if (state.phase === "idle") {
        if (!state.dictation) return result(state);
        return result(Object.assign({}, state, { dictation: null }),
          [{ type: "dictation.timer.disarm" }, notify("Dictation cancelled", "", "low")]);
      }
      return result(Object.assign({}, idle(state), { dictation: null }),
        [{ type: "watchdog.disarm" }, { type: "dictation.timer.disarm" }]
          .concat(recording(state) ? [{ type: "voxtype.cancel" }] : [notify("Assistant cancelled", "", "low")]));

    default:
      return result(state);
  }
}
