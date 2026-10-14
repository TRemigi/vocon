// Interprets effect descriptors from the pure core. New effect kinds register in `handlers`.

import QtQuick
import Quickshell
import "../core/execution/hyprctl.mjs" as Hyprctl

Item {
  id: root

  property var voxtype: null
  property var hypr: null
  property var watchdog: null

  readonly property var handlers: ({
    "voxtype.start":      function(e) { root.voxtype.start(e.model, e.showOsd) },
    "voxtype.stop":       function(e) { root.voxtype.stop(e.timeoutSeconds) },
    "voxtype.cancel":     function(e) { root.voxtype.cancel() },
    "hypr.snapshotClients": function(e) { root.hypr.snapshotClients() },
    "watchdog.arm":       function(e) { root.watchdog.interval = e.ms; root.watchdog.restart() },
    "watchdog.disarm":    function(e) { root.watchdog.stop() },
    "notify":             function(e) {
      Quickshell.execDetached(["notify-send", "-a", "vocon", "-u", e.urgency, e.title, e.body])
    },
    "log":                function(e) { console.log("vocon: " + e.message) },
    "exec":               function(e) { Quickshell.execDetached(e.argv) }
  })

  function execute(effect) {
    var handler = handlers[effect.type]
    if (handler) { handler(effect); return }
    var argv = Hyprctl.toArgv(effect)
    if (argv) root.hypr.run(argv)
    else console.log("vocon: no handler for effect " + effect.type)
  }
}
