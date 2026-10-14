// Execution: find an existing window for an app. Pure; ES2017-conservative.
//
// Mirrors omarchy-launch-or-focus (case-insensitive, word-boundary regex) but matches the window
// *class* only: a browser tab titled "Slack ..." must not count as the Slack app.
// `clients` is the parsed output of `hyprctl clients -j`.

export function isValidPattern(pattern) {
  try {
    new RegExp("\\b" + pattern + "\\b", "i");
    return true;
  } catch (e) {
    return false;
  }
}

// First mapped window whose class matches, or null.
export function findWindow(clients, pattern) {
  if (!isValidPattern(pattern)) return null;
  var re = new RegExp("\\b" + pattern + "\\b", "i");
  var found = (clients || []).filter(function (c) {
    return c && c.mapped !== false && re.test(String(c["class"] || ""));
  });
  return found.length ? found[0] : null;
}
