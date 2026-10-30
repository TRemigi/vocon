// vocon: push-to-talk voice commands. Composition root — wires the pure core to the
// side-effecting infra. Hyprland binds the PTT key to `omarchy-shell vocon start|stop`.

import QtQuick
import Quickshell
import Quickshell.Io
import "core/listening/session.mjs" as Session
import "infra"

Item {
  id: service

  // Injected by omarchy-shell.
  property var shell: null

  property var sessionState: Session.initialState()

  // Every event is stamped with the time here, once: the core has no clock, and the assistant's unlock
  // is measured with it. An event without `at` would count as locked.
  function dispatch(raw) {
    var event = Object.assign({}, raw, { at: Date.now() })
    var result = Session.reduce(service.sessionState, event)
    service.sessionState = result.state
    for (var i = 0; i < result.effects.length; i++) executor.execute(result.effects[i])
  }

  Voxtype {
    id: voxtype
    onTranscript: function(text) { service.dispatch({ type: "TranscriptReceived", text: text }) }
    onFailed: function(message) { service.dispatch({ type: "RecordingFailed", message: message }) }
    onRefused: service.dispatch({ type: "ScreenLocked" })
  }

  Hyprland {
    id: hypr
    onClientsReady: function(clients, unlocked) { service.dispatch({ type: "ClientsSnapshot", clients: clients, unlocked: unlocked }) }
  }

  Timer {
    id: watchdog
    repeat: false
    onTriggered: service.dispatch({ type: "WatchdogExpired" })
  }

  // `dictate` stays armed only briefly, so a later command can't be typed by mistake.
  Timer {
    id: dictationTimer
    repeat: false
    onTriggered: service.dispatch({ type: "DictationExpired" })
  }

  Braindump { id: braindump }

  // Assistant mode: fingerprint unlock, the local model, and the "which window?" timeout.
  Auth {
    id: auth
    onResult: function(ok, reason) { service.dispatch({ type: "UnlockResult", ok: ok, reason: reason }) }
  }

  Llm {
    id: llm
    onReplied: function(id, text) { service.dispatch({ type: "ModelReplied", id: id, text: text }) }
    onFailed: function(id, message) { service.dispatch({ type: "ModelFailed", id: id, message: message }) }
  }

  Timer {
    id: clarifyTimer
    repeat: false
    onTriggered: service.dispatch({ type: "ClarifyExpired" })
  }

  Executor {
    id: executor
    voxtype: voxtype
    hypr: hypr
    watchdog: watchdog
    dictationTimer: dictationTimer
    braindump: braindump
    auth: auth
    llm: llm
    clarifyTimer: clarifyTimer
    shell: service.shell
  }

  ConfigStore {
    onLoaded: function(config, errors, ok) { service.dispatch({ type: "ConfigLoaded", config: config, errors: errors, ok: ok }) }
  }

  IpcHandler {
    target: "vocon"

    function start(): string {
      service.dispatch({ type: "PttPressed" })
      return service.sessionState.phase
    }

    function stop(): string {
      service.dispatch({ type: "PttReleased" })
      return service.sessionState.phase
    }

    function cancel(): string {
      service.dispatch({ type: "Cancelled" })
      return service.sessionState.phase
    }

    function status(): string {
      return service.sessionState.phase
    }

    // Assistant mode: its own key (see bin/vocon-keybind). Held = listening; the first press while locked
    // starts the fingerprint check instead.
    function assistStart(): string {
      service.dispatch({ type: "AssistPressed" })
      return service.sessionState.phase
    }

    function assistStop(): string {
      service.dispatch({ type: "AssistReleased" })
      return service.sessionState.phase
    }

    // Answer "which window?" by number (the overlay will call this; useful from a shell too).
    function choose(number: int): string {
      service.dispatch({ type: "ChoiceSelected", number: number })
      return service.sessionState.phase
    }

    function dictation(): string {
      return service.sessionState.dictation ? "armed" : "off"
    }

    // Dev aid: run a transcript through the real pipeline without a microphone.
    function simulate(text: string): string {
      if (service.sessionState.phase !== "idle") return "busy"
      service.sessionState = Object.assign({}, service.sessionState, { phase: "transcribing" })
      hypr.snapshotClients()
      service.dispatch({ type: "TranscriptReceived", text: text })
      return "ok"
    }

    // Dev aid for assistant mode: like `simulate`, but through the assistant. The unlock and the screen
    // lock still apply, so unlock first (assistStart, then touch the sensor). Also answers a pending question.
    function assistSimulate(text: string): string {
      var phase = service.sessionState.phase
      if (phase !== "idle" && phase !== "clarifying") return "busy"
      service.sessionState = Object.assign({}, service.sessionState, { phase: "transcribing", mode: "assistant", transcript: null, clients: null })
      hypr.snapshotClients()
      service.dispatch({ type: "TranscriptReceived", text: text })
      return "ok"
    }
  }
}
