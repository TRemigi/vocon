// Interprets effect descriptors from the pure core. New effect kinds register in `handlers`.

import QtQuick
import Quickshell
import "../core/execution/hyprctl.mjs" as Hyprctl
import "../core/execution/keys.mjs" as Keys

Item {
  id: root

  property var voxtype: null
  property var hypr: null
  property var watchdog: null
  property var dictationTimer: null

  readonly property var handlers: ({
    "voxtype.start":      function(e) { root.voxtype.start(e.model, e.showOsd) },
    "voxtype.stop":       function(e) { root.voxtype.stop(e.timeoutSeconds) },
    "voxtype.cancel":     function(e) { root.voxtype.cancel() },
    "hypr.snapshotClients": function(e) { root.hypr.snapshotClients() },
    "watchdog.arm":       function(e) { root.watchdog.interval = e.ms; root.watchdog.restart() },
    "watchdog.disarm":    function(e) { root.watchdog.stop() },
    "dictation.timer.arm":    function(e) { root.dictationTimer.interval = e.ms; root.dictationTimer.restart() },
    "dictation.timer.disarm": function(e) { root.dictationTimer.stop() },
    "notify":             function(e) {
      Quickshell.execDetached(["notify-send", "-a", "vocon", "-u", e.urgency, e.title, e.body])
    },
    "log":                function(e) { console.log("vocon: " + e.message) },
    "exec":               function(e) { Quickshell.execDetached(e.argv) },
    // Same launch path as Omarchy's own bindings (uwsm-app); argv is from the app catalog.
    "app.launch":         function(e) { Quickshell.execDetached(["setsid", "uwsm-app", "--"].concat(e.argv)) }
  })

  function execute(effect) {
    var handler = handlers[effect.type]
    if (handler) { handler(effect); return }
    // Hyprland dispatches, then keyboard input (wtype); both are argv arrays run detached.
    var argv = Hyprctl.toArgv(effect) || Keys.toArgv(effect)
    if (argv) root.hypr.run(argv)
    else console.log("vocon: no handler for effect " + effect.type)
  }
}
