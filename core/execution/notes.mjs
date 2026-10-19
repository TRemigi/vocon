// Execution: braindump (the notes organiser). Translates note actions to argv. Pure;
// ES2017-conservative. The one speech-derived value, the note text, travels as a single argument to
// a fixed script that pipes it to braindump's stdin, so it is never parsed as a flag or by a shell
// (the same shape as `text.type` in keys.mjs). Everything else in the argv comes from config.

var MAX_NOTE_CHARS = 200000;   // braindump's own limit

function assertCommand(argv) {
  var ok = Array.isArray(argv) && argv.length > 0 && argv.every(function (part) {
    return typeof part === "string" && part !== "" && part.indexOf("\u0000") === -1;
  });
  if (!ok) throw new Error("invalid braindump command");
  return argv;
}

// Returns argv for a note action, or null when the action isn't one.
export function toArgv(action) {
  if (action.type === "note.capture") {
    var command = assertCommand(action.argv);
    var text = String(action.text == null ? "" : action.text).trim();
    if (text === "") throw new Error("nothing to capture");
    if (text.length > MAX_NOTE_CHARS || text.indexOf("\u0000") !== -1) throw new Error("note text not acceptable");
    return ["sh", "-c", "text=$1; shift; printf '%s' \"$text\" | \"$@\"", "vocon-note", text].concat(command);
  }
  if (action.type === "note.status") return assertCommand(action.argv);
  return null;
}
