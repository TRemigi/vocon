// Side effects for VoxType: start/stop/cancel a recording and report the transcript.
//
// - start checks the daemon is up and free first (never touches someone else's recording),
//   then confirms ~0.8 s later that it really began recording (`record start` exits 0 even
//   when the daemon then fails to open the mic).
// - stop waits for start to have finished so the daemon sees the signals in order.

import QtQuick
import Quickshell

Item {
  id: root

  signal transcript(string text)
  signal failed(string message)

  readonly property string utterancePath: Quickshell.env("XDG_RUNTIME_DIR") + "/vocon-utterance.txt"
  readonly property string statePath: Quickshell.env("XDG_RUNTIME_DIR") + "/voxtype/state"

  // Daemon states in which it is already doing something for someone.
  readonly property var _busyStates: ["recording", "streaming", "transcribing"]

  property int _stopTimeoutSeconds: 20
  property bool _stopPending: false
  property bool _starting: false     // from start() until `record start` has finished
  property bool _released: false
  property string _model: ""
  property bool _showOsd: true

  function start(model, showOsd) {
    root._starting = true
    root._released = false
    root._model = model || ""
    root._showOsd = showOsd
    preState.run(["cat", root.statePath])
  }

  function stop(timeoutSeconds) {
    root._stopTimeoutSeconds = timeoutSeconds
    root._released = true
    if (root._starting) {
      root._stopPending = true
      return
    }
    root._runStop()
  }

  function cancel() {
    root._stopPending = false
    cancelRun.run(["voxtype", "record", "cancel"])
  }

  // Never run `stop` after a failed start: it could end someone else's recording.
  function _abortStart(message) {
    root._starting = false
    root._stopPending = false
    root.failed(message)
  }

  function _launch() {
    var argv = ["voxtype", "record", "start", "--file=" + root.utterancePath]
    if (!root._showOsd) argv.push("--no-osd")
    if (root._model) argv = argv.concat(["--model", root._model])
    startRun.run(argv)
  }

  function _runStop() {
    stopRun.run(["voxtype", "record", "stop", "--wait", "--json",
                 "--timeout", String(root._stopTimeoutSeconds)])
  }

  Run {
    id: preState
    onFinished: function(code, out, err) {
      var state = out.trim()
      if (code !== 0 || state === "" || state === "stopped")
        root._abortStart("VoxType isn't running. Try: systemctl --user start voxtype")
      else if (root._busyStates.indexOf(state) !== -1)
        root._abortStart("VoxType is busy (" + state + "). If it is stuck: voxtype record cancel")
      else root._launch()
    }
  }

  Run {
    id: startRun
    onFinished: function(code, out, err) {
      root._starting = false
      if (code !== 0) {
        root._stopPending = false
        root.failed("voxtype record start failed (" + code + "): " + err.trim())
      } else if (root._stopPending) {
        root._stopPending = false
        root._runStop()
      } else {
        verifyTimer.restart()
      }
    }
  }

  Timer {
    id: verifyTimer
    interval: 800
    repeat: false
    onTriggered: if (!root._released) postState.run(["cat", root.statePath])
  }

  Run {
    id: postState
    onFinished: function(code, out, err) {
      var state = out.trim()
      if (root._released) return
      if (code !== 0 || root._busyStates.indexOf(state) === -1)
        root.failed("VoxType didn't start recording (state: " + (state || "unknown") + "). Check: journalctl --user -u voxtype -n 20")
    }
  }

  Run {
    id: stopRun
    onFinished: function(code, out, err) {
      var result = null
      try { result = JSON.parse(out.trim()) } catch (e) { result = null }

      if (result && result.status === "ok") root.transcript(String(result.text || ""))
      else if (result && result.status === "empty") root.transcript("")
      else root.failed("voxtype record stop: " + (result ? result.status + " " + (result.message || "")
                                                          : "exit " + code + " " + err.trim()))
    }
  }

  Run { id: cancelRun }
}
