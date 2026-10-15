// Asks Omarchy whether the compositor holds a session lock (`omarchy-hyprland-session-locked`:
// exit 0 locked, 1 unlocked, 2 undetermined). Fails closed: only exit 1 reports `unlocked`, so an
// undetermined answer, a missing script or a crashed probe all count as locked.
//
//   ScreenLock { onChecked: function(unlocked) { ... } }   then   lock.check()

import QtQuick

Item {
  id: root

  signal checked(bool unlocked)

  function check() {
    probe.run(["omarchy-hyprland-session-locked"])
  }

  Run {
    id: probe
    onFinished: function(code, out, err) { root.checked(code === 1) }
  }
}
