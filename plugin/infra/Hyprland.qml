// Side effects for Hyprland: snapshot windows and run translated dispatch argv.

import QtQuick
import Quickshell

Item {
  id: root

  signal clientsReady(var clients)

  function snapshotClients() {
    clientsRun.run(["hyprctl", "clients", "-j"])
  }

  function run(argv) {
    Quickshell.execDetached(argv)
  }

  Run {
    id: clientsRun
    onFinished: function(code, out, err) {
      var list = []
      if (code === 0) {
        try { list = JSON.parse(out) } catch (e) { list = [] }
      }
      root.clientsReady(list)
    }
  }
}
