// Execution: keyboard input via wtype (the Wayland virtual-keyboard tool VoxType also uses).
// Step builders for packs, and the translator from action descriptors to argv. Pure;
// ES2017-conservative. Nothing here touches a shell except the fixed stdin pipe in text.type.
//
//   keysAction([combo("ctrl+k"), sleep(300), text("general"), key("Return")])
//
// Steps: combo("ctrl+shift+Tab") / key("Return") press modifiers+key; text("...") types characters;
// sleep(ms) waits (apps need time to open a dialog before typing into it).

var MODIFIERS = ["shift", "ctrl", "alt", "logo", "altgr"];

export function combo(spec) { return { combo: spec }; }
export function key(name) { return { combo: name }; }
export function text(value) { return { text: value }; }
export function sleep(ms) { return { sleep: ms }; }

function assertKeyName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("invalid key name: " + name);
  return name;
}

function stepArgv(step) {
  if (step.sleep !== undefined) {
    if (!Number.isInteger(step.sleep) || step.sleep < 0 || step.sleep > 5000) throw new Error("invalid sleep: " + step.sleep);
    return ["-s", String(step.sleep)];
  }
  if (step.text !== undefined) {
    var t = String(step.text);
    // wtype reads a leading "-" as an option, and control characters would press keys (Enter!).
    if (t === "" || t.charAt(0) === "-" || /[\u0000-\u001f\u007f]/.test(t)) throw new Error("invalid text to type");
    return [t];
  }
  if (step.combo !== undefined) {
    var parts = String(step.combo).split("+");
    var name = assertKeyName(parts[parts.length - 1]);
    var mods = parts.slice(0, -1).map(function (m) {
      var lower = m.toLowerCase();
      if (MODIFIERS.indexOf(lower) === -1) throw new Error("invalid modifier: " + m);
      return lower;
    });
    var argv = [];
    mods.forEach(function (m) { argv.push("-M", m); });
    argv.push("-k", name);
    mods.slice().reverse().forEach(function (m) { argv.push("-m", m); });
    return argv;
  }
  throw new Error("unknown key step");
}

// Dictated text is arbitrary, so it goes through stdin (`wtype -`), never as an argument, and has
// control characters (newlines would press Enter) flattened to spaces.
function dictatedText(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

// Returns argv for keyboard actions, or null for any other action type.
export function toArgv(action) {
  if (action.type === "keys.send") {
    return action.steps.reduce(function (argv, step) { return argv.concat(stepArgv(step)); }, ["wtype"]);
  }
  if (action.type === "text.type") {
    var cleaned = dictatedText(action.text);
    if (cleaned === "") throw new Error("nothing to type");
    return ["sh", "-c", "printf '%s' \"$1\" | wtype -", "vocon-type", cleaned];
  }
  return null;
}
