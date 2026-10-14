// Listening: the push-to-talk session as a pure state machine.
//
//   reduce(state, event) -> { state, effects }
//
// Phases: idle -> listening (key held) -> transcribing (key released) -> idle.
// The shell performs the returned effects and feeds results back as events:
//   PttPressed, PttReleased, TranscriptReceived{text}, ClientsSnapshot{clients},
//   RecordingFailed{message}, Cancelled, WatchdogExpired, ConfigLoaded{config, errors}
// Effects: voxtype.start/stop/cancel, hypr.snapshotClients, watchdog.arm/disarm, notify, log,
// plus whatever actions the matched command emits.
// Pure; ES2017-conservative.

import { defaults } from "../config.mjs";
import { interpret, registryErrors } from "../pipeline.mjs";
import { notify } from "../execution/actions.mjs";

export function initialState(config) {
  return { phase: "idle", transcript: null, clients: null, config: config || defaults };
}

function log(message) {
  return { type: "log", message: message };
}

function idle(state) {
  return Object.assign({}, state, { phase: "idle", transcript: null, clients: null });
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

// Both inputs are in: interpret and hand back the command's actions.
function complete(state) {
  var interpreted = interpret(state.config, { clients: state.clients }, state.transcript);
  var outcome = interpreted.outcome;
  var feedback = state.config.feedback;
  var effects = [{ type: "watchdog.disarm" }, log("heard \"" + state.transcript + "\" -> " + outcome.kind +
    (outcome.commandId ? " " + outcome.commandId + " (score " + outcome.score.toFixed(2) + ")" : ""))];

  if (outcome.kind === "matched") {
    effects = effects.concat(interpreted.actions);
    if (feedback.notifyOnSuccess) effects.push(notify("Voice command", state.transcript, "low"));
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
      var problems = (event.errors || []).concat(registryErrors(event.config));
      var effects = problems.length
        ? [notify("vocon config problems", problems.join("; "), "normal")]
        : [];
      return result(Object.assign({}, state, { config: event.config }), effects);
    }

    case "PttPressed":
      if (state.phase !== "idle") return result(state, [log("ignored press while " + state.phase)]);
      return result(Object.assign({}, state, { phase: "listening", transcript: null, clients: null }), [
        { type: "voxtype.start", model: state.config.voxtype.model, showOsd: state.config.voxtype.showOsd },
        { type: "watchdog.arm", ms: state.config.voxtype.maxSeconds * 1000 },
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
      return maybeComplete(Object.assign({}, state, { clients: event.clients }));

    case "RecordingFailed":
      return state.phase === "idle" ? result(state) : fail(state, event.message);

    case "WatchdogExpired":
      if (state.phase === "idle") return result(state);
      return result(idle(state), [
        { type: "voxtype.cancel" },
        notify("Voice command timed out", "Recording was cancelled", "normal"),
        log("watchdog expired while " + state.phase),
      ]);

    case "Cancelled":
      if (state.phase === "idle") return result(state);
      return result(idle(state), [{ type: "watchdog.disarm" }, { type: "voxtype.cancel" }]);

    default:
      return result(state);
  }
}
