import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, registryErrors } from "../plugin/core/pipeline.mjs";
import { parse, defaults } from "../plugin/core/config.mjs";
import { toArgv } from "../plugin/core/execution/keys.mjs";

const win = (address, cls, focus) => ({ address, class: cls, title: "", mapped: true, focusHistoryID: focus });
const inClaude = [win("0x1", "com.anthropic.Claude", 0), win("0x2", "com.mitchellh.ghostty", 1)];
const inTerminal = [win("0x1", "com.anthropic.Claude", 1), win("0x2", "com.mitchellh.ghostty", 0)];
const noClaude = [win("0x2", "com.mitchellh.ghostty", 0)];

const say = (text, clients, config = defaults) => interpret(config, { clients }, text);
const keys = (text, clients, config) => {
  const r = say(text, clients, config);
  return r.actions.map((a) => (a.type === "keys.send" ? toArgv(a).slice(1).join(" ") : a.type));
};

test("the claude pack registers cleanly with the others", () => {
  assert.deepEqual(registryErrors(defaults), []);
});

// Navigation and UI commands, with the shortcut each one presses.
const navigation = {
  "tab code": "-M ctrl -k k -m ctrl -s 350 code -s 450 -k Return",
  "tab home": "-M ctrl -k k -m ctrl -s 350 home -s 450 -k Return",
  "session new": "-M ctrl -k n -m ctrl",
  "session next": "-M ctrl -k Tab -m ctrl",
  "session previous": "-M ctrl -M shift -k Tab -m shift -m ctrl",
  "pane diff": "-M ctrl -M shift -k d -m shift -m ctrl",
  "pane terminal": "-M ctrl -k grave -m ctrl",
  "side chat": "-M ctrl -k semicolon -m ctrl",
  "menu model": "-M ctrl -M shift -k i -m shift -m ctrl",
  "menu permission": "-M ctrl -M shift -k m -m shift -m ctrl",
  "menu permissions": "-M ctrl -M shift -k m -m shift -m ctrl",
  "menu effort": "-M ctrl -M shift -k e -m shift -m ctrl",
  "view": "-M ctrl -k o -m ctrl",
  "palette": "-M ctrl -k k -m ctrl",
  "search": "-M ctrl -k k -m ctrl",
  "settings": "-M ctrl -k comma -m ctrl",
  "sidebar": "-M ctrl -k b -m ctrl",
  "shortcuts": "-M ctrl -k slash -m ctrl",
  "find": "-M ctrl -k f -m ctrl",
  "find next": "-M ctrl -k g -m ctrl",
  "find previous": "-M ctrl -M shift -k g -m shift -m ctrl",
  "zoom in": "-M ctrl -k equal -m ctrl",
  "zoom out": "-M ctrl -k minus -m ctrl",
  "zoom reset": "-M ctrl -k 0 -m ctrl",
  "zoom actual": "-M ctrl -k 0 -m ctrl",
  "fullscreen": "-k F11",
  "full screen": "-k F11",
};

// Commands that act on a session or the prompt: focused-only.
const acting = {
  "close session": "-M ctrl -k w -m ctrl",
  "close pane": "-M ctrl -k backslash -m ctrl",
  "reopen": "-M ctrl -M shift -k t -m shift -m ctrl",
  "reopen session": "-M ctrl -M shift -k t -m shift -m ctrl",
  "stop": "-k Escape",
  "send": "-k Return",
  "session my project": "-M ctrl -k k -m ctrl -s 350 my project -s 450 -k Return",
  "newline": "-M shift -k Return -m shift",
  "confirm": "-k Return",
  "palette document review": "-M ctrl -k k -m ctrl -s 350 document review",
  "search document review": "-M ctrl -k k -m ctrl -s 350 document review",
  "accept": "-k Tab",
  "choose 1": "-k 1",
  "choose two": "-k 2",
  "choose 9": "-k 9",
  "undo": "-M ctrl -k z -m ctrl",
  "redo": "-M ctrl -M shift -k z -m shift -m ctrl",
  "cut": "-M ctrl -k x -m ctrl",
  "copy": "-M ctrl -k c -m ctrl",
  "paste": "-M ctrl -k v -m ctrl",
  "select all": "-M ctrl -k a -m ctrl",
};

test("every command presses its shortcut while Claude Desktop is focused", () => {
  for (const [text, expected] of Object.entries(Object.assign({}, navigation, acting))) {
    assert.deepEqual(keys(text, inClaude), [expected], text);
  }
});

test("send follows the configured key", () => {
  const { config } = parse('{"packs":{"claude":{"send":"ctrl+Return"}}}');
  assert.deepEqual(keys("send", inClaude, config), ["-M ctrl -k Return -m ctrl"]);
});

// --- scoping and safety ---
test("short forms exist only while Claude Desktop is focused", () => {
  for (const text of Object.keys(Object.assign({}, navigation, acting))) {
    const r = say(text, inTerminal);
    assert.equal(r.outcome.kind, "nomatch", text);
    assert.deepEqual(r.actions, [], text);
  }
});

test("from anywhere: 'claude ...' focuses the app first, then sends the keys", () => {
  const r = say("claude session next", inTerminal);
  assert.equal(r.actions.length, 2);
  assert.deepEqual(r.actions[0], { type: "hypr.focusWindow", address: "0x1" });
  assert.equal(toArgv(r.actions[1]).slice(1).join(" "), "-s 300 -M ctrl -k Tab -m ctrl");
  assert.equal(keys("claude pane terminal", inTerminal)[1], "-s 300 -M ctrl -k grave -m ctrl");
});

test("every navigation command has a 'claude ...' form", () => {
  for (const [text, shortcut] of Object.entries(navigation)) {
    assert.deepEqual(keys("claude " + text, inTerminal)[1], "-s 300 " + shortcut, text);
  }
});

test("'claude ...' says so when Claude Desktop isn't running", () => {
  const r = say("claude settings", noClaude);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].type, "notify");
  assert.match(r.actions[0].title, /Claude Desktop isn't running/);
});

test("closing, stopping, sending and editing are never available from other apps", () => {
  for (const text of Object.keys(acting)) {
    for (const clients of [inTerminal, noClaude]) {
      for (const spoken of ["claude " + text]) {
        const r = say(spoken, clients);
        assert.equal(r.outcome.kind, "nomatch", spoken);
        assert.deepEqual(r.actions, [], spoken);
      }
    }
  }
});

test("a command that needs an argument says what is missing", () => {
  const r = say("close", inClaude);
  assert.equal(r.outcome.kind, "incomplete");
  assert.deepEqual(r.outcome.expected, ["session", "pane"]);
  assert.equal(say("choose", inClaude).outcome.kind, "incomplete");
});

test("choose only accepts menu items 1 to 9, and never from the browser pane (removed) or elsewhere", () => {
  for (const text of ["choose 0", "choose 10", "choose nine hundred", "choose dev"]) {
    const r = say(text, inClaude);
    assert.equal(r.outcome.kind, "nomatch", text);
    assert.deepEqual(r.actions, [], text);
  }
  assert.equal(say("pane browser", inClaude).outcome.kind, "nomatch");
});

test("built-in commands still work, in and out of Claude Desktop", () => {
  for (const clients of [inClaude, inTerminal]) {
    assert.equal(say("space 2", clients).actions[0].type, "hypr.focusWorkspace");
    assert.equal(say("move focused space 2", clients).actions[0].type, "hypr.moveWindowToWorkspace");
  }
});

test("'claude' is heard despite common mishearings", () => {
  assert.equal(keys("cloud settings", inTerminal).length, 2);
  assert.equal(keys("clod settings", inTerminal).length, 2);
});

test("session <name> types the name into the palette; the keywords still win", () => {
  assert.deepEqual(keys("Session Fix the login bug.", inClaude),
    ["-M ctrl -k k -m ctrl -s 350 fix the login bug -s 450 -k Return"]);
  assert.deepEqual(keys("session next", inClaude), ["-M ctrl -k Tab -m ctrl"]);
  assert.equal(say("session", inClaude).outcome.kind, "incomplete");
});

test("session <name> can type the name and leave Enter to you", () => {
  const { config } = parse('{"packs":{"claude":{"sessionSubmit":false,"paletteDelay":500}}}');
  assert.deepEqual(keys("session my project", inClaude, config), ["-M ctrl -k k -m ctrl -s 500 my project"]);
});

test("session <name> is focused-only: speech never reaches the palette from another app", () => {
  for (const text of ["session my project", "claude session my project"]) {
    const r = say(text, inTerminal);
    assert.equal(r.outcome.kind, "nomatch", text);
    assert.deepEqual(r.actions, [], text);
  }
  assert.equal(say("claude session my project", inClaude).outcome.kind, "nomatch");
});

test("typed session names carry no key syntax", () => {
  // normalisation reduces speech to letters and digits, so nothing option-like survives
  assert.equal(keys("session -k ctrl", inClaude)[0], "-M ctrl -k k -m ctrl -s 350 k ctrl -s 450 -k Return");
});

test("tab delays follow the config", () => {
  const { config } = parse('{"packs":{"claude":{"paletteDelay":500,"resultsDelay":700}}}');
  assert.deepEqual(keys("tab code", inClaude, config), ["-M ctrl -k k -m ctrl -s 500 code -s 700 -k Return"]);
});

test("the window class can be pointed elsewhere", () => {
  const { config } = parse('{"packs":{"claude":{"match":"^claude-scratch$"}}}');
  const scratch = [win("0x3", "claude-scratch", 0)];
  assert.deepEqual(keys("settings", scratch, config), ["-M ctrl -k comma -m ctrl"]);
  assert.equal(say("settings", inClaude, config).outcome.kind, "nomatch");
});

test("the claude pack can be disabled", () => {
  const { config } = parse('{"packs":{"claude":{"enabled":false}}}');
  assert.equal(say("settings", inClaude, config).outcome.kind, "nomatch");
  assert.equal(say("claude settings", inClaude, config).outcome.kind, "nomatch");
});
