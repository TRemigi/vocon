// Side effects for VoxType: start/stop/cancel a recording and report the transcript.
// Stop waits for start to have exited so the daemon sees the signals in order.

import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  signal transcript(string text)
  signal failed(string message)

  readonly property string utterancePath: Quickshell.env("XDG_RUNTIME_DIR") + "/vocon-utterance.txt"

  property int _stopTimeoutSeconds: 20
  property bool _stopPending: false

  function start(model, showOsd) {
    var argv = ["voxtype", "record", "start", "--file=" + utterancePath]
    if (!showOsd) argv.push("--no-osd")
    if (model) argv = argv.concat(["--model", model])
    startProcess.command = argv
    startProcess.running = true
  }

  function stop(timeoutSeconds) {
    root._stopTimeoutSeconds = timeoutSeconds
    if (startProcess.running) {
      root._stopPending = true
      return
    }
    root._runStop()
  }

  function cancel() {
    root._stopPending = false
    cancelProcess.running = true
  }

  function _runStop() {
    stopProcess.command = ["voxtype", "record", "stop", "--wait", "--json",
                           "--timeout", String(root._stopTimeoutSeconds)]
    stopProcess.running = true
  }

  Process {
    id: startProcess
    running: false
    command: []
    stderr: StdioCollector { id: startStderr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        root._stopPending = false
        root.failed("voxtype record start failed (" + exitCode + "): " + String(startStderr.text).trim())
      } else if (root._stopPending) {
        root._stopPending = false
        root._runStop()
      }
    }
  }

  Process {
    id: stopProcess
    running: false
    command: []
    stdout: StdioCollector { id: stopStdout; waitForEnd: true }
    stderr: StdioCollector { id: stopStderr; waitForEnd: true }
    onExited: function(exitCode) {
      var out = String(stopStdout.text).trim()
      var result = null
      try { result = JSON.parse(out) } catch (e) { result = null }

      if (result && result.status === "ok") root.transcript(String(result.text || ""))
      else if (result && result.status === "empty") root.transcript("")
      else root.failed("voxtype record stop: " + (result ? result.status + " " + (result.message || "")
                                                          : "exit " + exitCode + " " + String(stopStderr.text).trim()))
    }
  }

  Process {
    id: cancelProcess
    running: false
    command: ["voxtype", "record", "cancel"]
  }
}
