// Listening: the push-to-talk session as a pure state machine.
//
//   reduce(state, event) -> { state, effects }
//
// Phases: idle -> listening (key held) -> transcribing (key released) -> idle.
// The shell performs the returned effects and feeds results back as events:
//   PttPressed, PttReleased, TranscriptReceived{text}, ClientsSnapshot{clients},
//   RecordingFailed{message}, ScreenLocked, Cancelled, WatchdogExpired, ConfigLoaded{config, errors}
// ClientsSnapshot carries `unlocked`: only `true` lets a command run (fail closed; see `refuse`).
// Effects: voxtype.start/stop/cancel, hypr.snapshotClients, watchdog.arm/disarm, notify, log,
// plus whatever actions the matched command emits.
// Pure; ES2017-conservative.

import { defaults } from "../config.mjs";
import { interpret, registryErrors } from "../pipeline.mjs";
import { notify, typeText } from "../execution/actions.mjs";
import { activeWindow } from "../execution/windows.mjs";
import { normalize } from "../interpretation/utterance.mjs";

export function initialState(config) {
  // dictation: null, or { address } of the window it was armed for (see completeDictation)
  return { phase: "idle", transcript: null, clients: null, unlocked: false, dictation: null, config: config || defaults };
}

function log(message) {
  return { type: "log", message: message };
}

function idle(state) {
  return Object.assign({}, state, { phase: "idle", transcript: null, clients: null, unlocked: false });
}

function result(state, effects) {
  return { state: state, effects: effects || [] };
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

// "Dictate, Hi team." -> "Hi team." The command word is always the first word, so drop the first
// run of letters/digits (what `normalize` calls a token) and the separator after it.
function afterCommandWord(transcript) {
  return transcript.replace(/^[^a-z0-9]*[a-z0-9]+[\s,.:;!?]*/i, "").trim();
}

// `dictate <text>`: type <text> now, without a second key press. It goes through the same checks as an
// armed dictation (ignore list, "cancel", focus), and stays armed with its timer if nothing was typed.
function dictateInline(state) {
  var focused = activeWindow(state.clients);
  var done = completeDictation(Object.assign({}, state, {
    transcript: afterCommandWord(state.transcript),
    dictation: { address: focused ? focused.address : null },
  }));
  if (!done.state.dictation) return done;
  return result(done.state, done.effects.concat([{ type: "dictation.timer.arm", ms: state.config.dictation.armSeconds * 1000 }]));
}

// Both inputs are in: interpret and hand back the command's actions.
function complete(state) {
  if (!state.unlocked) return refuse(state);
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
    if (feedback.notifyOnSuccess) effects.push(notify("Voice command", state.transcript, "low"));
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

function maybeComplete(state) {
  return state.transcript !== null && state.clients !== null ? complete(state) : result(state);
}

export function reduce(state, event) {
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
      if (state.phase !== "listening") return result(state);
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

    case "ScreenLocked":
      return state.phase === "idle" ? result(state) : refuse(state);

    case "RecordingFailed":
      return state.phase === "idle" ? result(state) : fail(state, event.message);

    case "WatchdogExpired":
      if (state.phase === "idle") return result(state);
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
        [{ type: "watchdog.disarm" }, { type: "dictation.timer.disarm" }, { type: "voxtype.cancel" }]);

    default:
      return result(state);
  }
}
