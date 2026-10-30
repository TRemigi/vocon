// Unlock for assistant mode: the edge that finds out whether you are who the policy needs. The policy
// (how long an unlock lasts) lives in the pure core; this reports one fact.
//
//   method "password"     (default) opens a small floating terminal running bin/vocon-unlock: sudo itself asks
//                         for your password there, so the password never reaches vocon.
//   method "fingerprint"  tries `fprintd-verify` first and falls back to the password terminal when it
//                         fails, times out or is unavailable.
//
// Fails closed: success needs the wrapper's own "ok" (or fprintd's "verify-match" with exit 0), and a locked
// screen never starts anything. `reason` is from a fixed set (failed, timeout, unavailable, cancelled,
// nopassword, locked); neither the password nor any program output is passed on.
//
//   Auth { onResult: function(ok, reason) { ... } }   then   auth.verify("password", 60)   /   auth.cancel()
//
// The result file lives in $XDG_RUNTIME_DIR (mode 0700) and is written by the wrapper. It stops an accidental
// unlock (speech in the room); it is not a defence against code already running as you.

import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  signal result(bool ok, string reason)

  property string method: "password"
  property int seconds: 60
  // Bumped on every verify and cancel: a result only counts if it belongs to the latest verify.
  property int _gen: 0
  property int _pending: -1
  property string _file: ""

  readonly property string _script: Qt.resolvedUrl("../bin/vocon-unlock").toString().replace(/^file:\/\//, "")

  function verify(wantedMethod, timeoutSeconds) {
    root._cleanup(true)
    root.method = wantedMethod
    root.seconds = timeoutSeconds
    root._gen += 1
    root._pending = root._gen
    lock.check()
  }

  function cancel() {
    root._gen += 1
    fingerprint.cancel()
    root._cleanup(true)
  }

  function _done(ok, reason) {
    if (root._pending !== root._gen) return
    root._cleanup(false)
    root._pending = -1
    root.result(ok, reason)
  }

  // Stops waiting. With `kill`, also closes a password terminal that is still open.
  function _cleanup(kill) {
    poll.stop()
    deadline.stop()
    if (root._file !== "") {
      if (kill) Quickshell.execDetached(["pkill", "-f", "vocon-unlock " + root._file])
      Quickshell.execDetached(["rm", "-f", root._file, root._file + ".tmp"])
      resultFile.path = ""
      root._file = ""
    }
  }

  function _startPassword() {
    var dir = Quickshell.env("XDG_RUNTIME_DIR")
    if (!dir) { root._done(false, "unavailable"); return }
    root._file = dir + "/vocon-unlock." + Date.now().toString(16) + Math.random().toString(16).slice(2, 10)
    resultFile.path = root._file
    deadline.interval = (root.seconds + 5) * 1000
    deadline.restart()
    poll.restart()
    Quickshell.execDetached(["setsid", "uwsm-app", "--", "xdg-terminal-exec", "--app-id=org.omarchy.terminal",
      "--title=vocon unlock", "-e", "bash", root._script, root._file, String(root.seconds)])
  }

  function _fromWord(word) {
    if (word === "ok") root._done(true, "")
    else if (word === "failed" || word === "cancelled" || word === "timeout" || word === "nopassword") root._done(false, word)
    // anything else (an empty or partial file) is not a result yet
  }

  ScreenLock {
    id: lock
    onChecked: function(unlocked) {
      if (root._pending !== root._gen) return
      if (!unlocked) { root._done(false, "locked"); return }
      if (root.method === "fingerprint") fingerprint.run(["timeout", String(Math.min(root.seconds, 20)), "fprintd-verify"])
      else root._startPassword()
    }
  }

  // fprintd must exit 0 AND say verify-match. Any other outcome falls back to the password terminal.
  Run {
    id: fingerprint
    onFinished: function(code, out, err) {
      if (root._pending !== root._gen) return
      if (code === 0 && /verify-match/.test(String(out))) root._done(true, "")
      else root._startPassword()
    }
  }

  // Polls for the wrapper's one-word answer.
  FileView {
    id: resultFile
    printErrors: false
    onLoaded: root._fromWord(String(text()).trim())
  }

  Timer {
    id: poll
    interval: 400
    repeat: true
    onTriggered: { if (resultFile.path !== "") resultFile.reload() }
  }

  Timer {
    id: deadline
    repeat: false
    onTriggered: {
      if (root._pending !== root._gen) return
      root._cleanup(true)
      root._pending = -1
      root.result(false, "timeout")
    }
  }
}
