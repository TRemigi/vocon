// Side effects for Hyprland: snapshot windows and run translated dispatch argv.

import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  signal clientsReady(var clients)

  function snapshotClients() {
    clientsProcess.running = true
  }

  function run(argv) {
    Quickshell.execDetached(argv)
  }

  Process {
    id: clientsProcess
    running: false
    command: ["hyprctl", "clients", "-j"]
    stdout: StdioCollector { id: clientsStdout; waitForEnd: true }
    onExited: function(exitCode) {
      var list = []
      if (exitCode === 0) {
        try { list = JSON.parse(String(clientsStdout.text)) } catch (e) { list = [] }
      }
      root.clientsReady(list)
    }
  }
}
