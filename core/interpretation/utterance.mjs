// Interpretation: turn raw speech-to-text output into comparable tokens.
// Pure. Syntax is kept ES2017-conservative because QML's V4 engine loads this file.

// Whisper often splits compounds; rewrite known splits before tokenising.
var JOINS = [
  [["work", "space"], "workspace"],
  [["work", "spaces"], "workspaces"],
];

function joinCompounds(tokens) {
  var out = [];
  var i = 0;
  while (i < tokens.length) {
    var joined = null;
    for (var j = 0; j < JOINS.length; j++) {
      var parts = JOINS[j][0];
      var fits = parts.every(function (part, k) { return tokens[i + k] === part; });
      if (fits) { joined = JOINS[j]; break; }
    }
    if (joined) {
      out.push(joined[1]);
      i += joined[0].length;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return out;
}

// "Move focused Space 1." -> ["move", "focused", "space", "1"]
export function normalize(text) {
  var cleaned = String(text == null ? "" : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (cleaned === "") return [];
  return joinCompounds(cleaned.split(/\s+/));
}

// "Dictate, Hi team." -> "Hi team.": the raw transcript with its first `count` words dropped (each a
// run of letters/digits, which is what `normalize` calls a token) and the separators after them.
// Slots only carry normalised words, so commands that need case and punctuation read it from here.
export function afterWords(transcript, count) {
  var rest = String(transcript == null ? "" : transcript);
  for (var i = 0; i < count; i++) rest = rest.replace(/^[^a-z0-9]*[a-z0-9]+[\s,.:;!?]*/i, "");
  return rest.trim();
}
