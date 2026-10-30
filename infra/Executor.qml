// Interprets effect descriptors from the pure core. New effect kinds register in `handlers`.

import QtQuick
import Quickshell
import "../core/execution/hyprctl.mjs" as Hyprctl
import "../core/execution/keys.mjs" as Keys
import "../core/execution/notes.mjs" as Notes

Item {
  id: root

  property var voxtype: null
  property var hypr: null
  property var watchdog: null
  property var dictationTimer: null
  property var braindump: null
  property var auth: null
  property var llm: null
  property var clarifyTimer: null
  property var shell: null
  property string pluginId: "vocon"

  readonly property var handlers: ({
    "voxtype.start":      function(e) { root.voxtype.start(e.model, e.showOsd) },
    "voxtype.stop":       function(e) { root.voxtype.stop(e.timeoutSeconds) },
    "voxtype.cancel":     function(e) { root.voxtype.cancel() },
    "hypr.snapshotClients": function(e) { root.hypr.snapshotClients() },
    "watchdog.arm":       function(e) { root.watchdog.interval = e.ms; root.watchdog.restart() },
    "watchdog.disarm":    function(e) { root.watchdog.stop() },
    "dictation.timer.arm":    function(e) { root.dictationTimer.interval = e.ms; root.dictationTimer.restart() },
    "dictation.timer.disarm": function(e) { root.dictationTimer.stop() },
    // `--`: bodies can quote the transcript, and Whisper may start one with "-" ("- Yes. - No.").
    "notify":             function(e) {
      Quickshell.execDetached(["notify-send", "-a", "vocon", "-u", e.urgency, "--", e.title, e.body])
    },
    "log":                function(e) { console.log("vocon: " + e.message) },
    // The menu is this plugin's own overlay (Help.qml); the descriptor is its payload.
    "help.show":          function(e) {
      if (!root.shell || !root.shell.summon(root.pluginId, JSON.stringify(e))) console.log("vocon: help menu unavailable")
    },
    // Assistant mode. The model request arrives fully built (and loopback-checked) by the core.
    "auth.verify":        function(e) { root.auth.verify(e.method, e.timeoutSeconds) },
    "auth.cancel":        function(e) { root.auth.cancel() },
    "llm.interpret":      function(e) { root.llm.request(e.id, e.url, e.body, e.timeoutSeconds) },
    "llm.cancel":         function(e) { root.llm.cancel() },
    "clarify.timer.arm":    function(e) { root.clarifyTimer.interval = e.ms; root.clarifyTimer.restart() },
    "clarify.timer.disarm": function(e) { root.clarifyTimer.stop() },
    "assistant.status":   function(e) {
      Quickshell.execDetached(["notify-send", "-a", "vocon", "-u", "low", "-t", "4000", "--", e.text])
    },
    // Stand-in until the overlay (Help-style) exists: the choices as one toast. Titles come from web pages,
    // so markup characters are escaped (the notification daemon renders a subset of HTML).
    "assistant.clarify.show": function(e) {
      var lines = e.rows.map(function(r) { return r.number + ". " + root._plain(r.text) + " (workspace " + r.workspace + ")" })
      Quickshell.execDetached(["notify-send", "-a", "vocon", "-u", "normal", "-t", "30000", "--", e.title, lines.join("\n")])
    },
    "assistant.clarify.hide": function(e) { },
    "note.capture":       function(e) { root.braindump.capture(Notes.toArgv(e)) },
    "note.status":        function(e) { root.braindump.status(Notes.toArgv(e)) },
    "exec":               function(e) { Quickshell.execDetached(e.argv) },
    // Same launch path as Omarchy's own bindings (uwsm-app); argv is from the app catalog.
    "app.launch":         function(e) { Quickshell.execDetached(["setsid", "uwsm-app", "--"].concat(e.argv)) }
  })

  function _plain(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  function execute(effect) {
    var handler = handlers[effect.type]
    if (handler) { handler(effect); return }
    // Hyprland dispatches, then keyboard input (wtype); both are argv arrays run detached.
    var argv = Hyprctl.toArgv(effect) || Keys.toArgv(effect)
    if (argv) root.hypr.run(argv)
    else console.log("vocon: no handler for effect " + effect.type)
  }
}
