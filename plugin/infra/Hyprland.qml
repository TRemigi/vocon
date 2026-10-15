// Side effects for Hyprland: snapshot windows (plus whether the screen is unlocked) and run
// translated dispatch argv.

import QtQuick
import Quickshell

Item {
  id: root

  signal clientsReady(var clients, bool unlocked)

  property var _clients: null
  property var _unlocked: null

  // The lock state is read together with the windows, so it is as fresh as the snapshot that
  // the command is interpreted against.
  function snapshotClients() {
    root._clients = null
    root._unlocked = null
    lock.check()
    clientsRun.run(["hyprctl", "clients", "-j"])
  }

  function _emitWhenReady() {
    if (root._clients === null || root._unlocked === null) return
    var clients = root._clients
    var unlocked = root._unlocked
    root._clients = null
    root._unlocked = null
    root.clientsReady(clients, unlocked)
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
      root._clients = list
      root._emitWhenReady()
    }
  }

  ScreenLock {
    id: lock
    onChecked: function(unlocked) {
      root._unlocked = unlocked
      root._emitWhenReady()
    }
  }
}
