// Side effects for the braindump pack: queue a note, or ask for its status, and tell the user how it
// went. The note text only ever travels in the argv built by core/execution/notes.mjs; it is never
// logged or shown here (stderr is, but braindump does not echo a note back in its errors).
//
// One command at a time per kind: a capture returns as soon as the note is queued, and a push-to-talk
// cycle takes longer than that, so overlap would mean a stuck process rather than a busy user.

import QtQuick
import Quickshell

Item {
  id: root

  function capture(argv) {
    if (captureRun.busy) { root._toast("Note not captured", "The previous capture is still running", "normal"); return }
    captureRun.busy = true
    captureRun.run(argv)
  }

  function status(argv) {
    if (statusRun.busy) return
    statusRun.busy = true
    statusRun.run(argv)
  }

  function _toast(title, body, urgency) {
    Quickshell.execDetached(["notify-send", "-a", "vocon", "-u", urgency, title, body])
  }

  // First line of an error, trimmed: enough to say why without dumping a log.
  function _reason(err) {
    var line = String(err).trim().split("\n")[0]
    return line.length > 160 ? line.substring(0, 160) + "…" : line
  }

  Run {
    id: captureRun
    property bool busy: false
    onFinished: function(code, out, err) {
      busy = false
      if (code === 0) root._toast("Note queued", "braindump will file it", "low")
      else {
        console.log("vocon: braindump capture failed (exit " + code + ")")
        root._toast("Couldn't capture the note", root._reason(err) || "braindump exited with " + code, "normal")
      }
    }
  }

  Run {
    id: statusRun
    property bool busy: false
    onFinished: function(code, out, err) {
      busy = false
      if (code === 0) root._toast("braindump", String(out).trim(), "low")
      else {
        console.log("vocon: braindump status failed (exit " + code + ")")
        root._toast("braindump status failed", root._reason(err) || "braindump exited with " + code, "normal")
      }
    }
  }
}
