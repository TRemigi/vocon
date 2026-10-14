// Runs one command and reports once, after the process has exited AND stdout/stderr have
// drained. Process.onExited can fire before StdioCollector has its text, so reading output in
// onExited is racy; this is the single place that handles that.
//
//   Run { onFinished: function(code, out, err) { ... } }   then   run.run(["cmd", "arg"])

import QtQuick
import Quickshell.Io

Item {
  id: root

  signal finished(int code, string out, string err)

  property int _code: -1
  property bool _exited: false
  property bool _outDone: false
  property bool _errDone: false
  property string _out: ""
  property string _err: ""

  function run(argv) {
    root._code = -1
    root._exited = false
    root._outDone = false
    root._errDone = false
    root._out = ""
    root._err = ""
    proc.command = argv
    proc.running = true
  }

  function _check() {
    if (root._exited && root._outDone && root._errDone) root._finish()
  }

  function _finish() {
    drainTimer.stop()
    if (!root._exited) return
    root._exited = false
    root.finished(root._code, root._out || String(outCollector.text), root._err || String(errCollector.text))
  }

  // Bounds the wait for the streams (and covers a command that never started).
  Timer {
    id: drainTimer
    interval: 300
    repeat: false
    onTriggered: root._finish()
  }

  Process {
    id: proc
    running: false
    command: []
    stdout: StdioCollector {
      id: outCollector
      waitForEnd: true
      onStreamFinished: { root._out = text; root._outDone = true; root._check() }
    }
    stderr: StdioCollector {
      id: errCollector
      waitForEnd: true
      onStreamFinished: { root._err = text; root._errDone = true; root._check() }
    }
    onExited: function(exitCode) {
      root._code = exitCode
      root._exited = true
      if (root._outDone && root._errDone) root._finish()
      else drainTimer.restart()
    }
  }
}
