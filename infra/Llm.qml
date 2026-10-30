// Sends one request to the local model (Ollama, /api/chat) and reports its text. The request is built
// and checked by the pure core (core/assistant/ollama.mjs: loopback endpoint only); this file only does
// the HTTP. Speech, window titles and replies are never logged here, and error texts are fixed strings
// that don't quote the model or the request.
//
//   Llm { onReplied: function(id, text) { ... }  onFailed: function(id, message) { ... } }
//   llm.request(id, url, body, timeoutSeconds)   /   llm.cancel()
//
// One request at a time: a new one supersedes the old. `id` ties a reply to its request, so a late reply
// to a cancelled or superseded request is dropped here (and again in the reducer).

import QtQuick
import "../core/assistant/ollama.mjs" as Ollama

Item {
  id: root

  signal replied(int id, string text)
  signal failed(int id, string message)

  property int _active: 0
  property var _xhr: null

  function request(id, url, body, timeoutSeconds) {
    root.cancel()
    root._active = id
    var xhr = new XMLHttpRequest()
    root._xhr = xhr
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return
      if (root._active !== id || root._xhr !== xhr) return
      root._finish(id, xhr)
    }
    xhr.open("POST", url)
    xhr.setRequestHeader("Content-Type", "application/json")
    timeout.interval = timeoutSeconds * 1000
    timeout.restart()
    xhr.send(JSON.stringify(body))
  }

  function cancel() {
    timeout.stop()
    var xhr = root._xhr
    root._active = 0
    root._xhr = null
    if (xhr) xhr.abort()
  }

  function _finish(id, xhr) {
    timeout.stop()
    root._active = 0
    root._xhr = null
    if (xhr.status === 0) { root.failed(id, "Couldn't reach Ollama. Is the ollama service running?"); return }
    if (xhr.status !== 200) { root.failed(id, "Ollama returned an error (HTTP " + xhr.status + "). Is the model installed?"); return }
    var parsed = null
    try { parsed = JSON.parse(xhr.responseText) } catch (e) { parsed = null }
    if (parsed === null) { root.failed(id, "Ollama's reply was unreadable"); return }
    // An empty text is passed on as is: the core reports "the model returned nothing".
    root.replied(id, Ollama.replyText(parsed))
  }

  Timer {
    id: timeout
    repeat: false
    onTriggered: {
      var id = root._active
      var xhr = root._xhr
      root._active = 0
      root._xhr = null
      if (xhr) xhr.abort()
      if (id !== 0) root.failed(id, "The model took too long to answer")
    }
  }
}
