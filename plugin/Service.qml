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

  function dispatch(event) {
    var result = Session.reduce(service.sessionState, event)
    service.sessionState = result.state
    for (var i = 0; i < result.effects.length; i++) executor.execute(result.effects[i])
  }

  Voxtype {
    id: voxtype
    onTranscript: function(text) { service.dispatch({ type: "TranscriptReceived", text: text }) }
    onFailed: function(message) { service.dispatch({ type: "RecordingFailed", message: message }) }
  }

  Hyprland {
    id: hypr
    onClientsReady: function(clients) { service.dispatch({ type: "ClientsSnapshot", clients: clients }) }
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

  Executor {
    id: executor
    voxtype: voxtype
    hypr: hypr
    watchdog: watchdog
    dictationTimer: dictationTimer
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
  }
}
