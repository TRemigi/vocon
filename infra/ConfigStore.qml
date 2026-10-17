// Side effects for config: read ~/.config/vocon/config.json and reload when it changes.

import QtQuick
import Quickshell
import Quickshell.Io
import "../core/config.mjs" as Config

Item {
  id: root

  signal loaded(var config, var errors, bool ok)

  readonly property string path: Quickshell.env("HOME") + "/.config/vocon/config.json"

  FileView {
    path: root.path
    watchChanges: true
    printErrors: false
    onLoaded: {
      var parsed = Config.parse(String(text()))
      root.loaded(parsed.config, parsed.errors, parsed.ok)
    }
    onLoadFailed: root.loaded(Config.defaults, [], true)
    onFileChanged: reload()
  }
}
