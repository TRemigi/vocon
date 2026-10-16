import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, registryErrors } from "../plugin/core/pipeline.mjs";
import { parse, defaults } from "../plugin/core/config.mjs";
import { activeWindow, classMatches } from "../plugin/core/execution/windows.mjs";
import { initialState, reduce } from "../plugin/core/listening/session.mjs";

const win = (address, cls, focusHistoryID) => ({ address, class: cls, title: "", mapped: true, focusHistoryID });
const clients = [win("0x1", "com.mitchellh.ghostty", 0), win("0x2", "firefox", 1), win("0x3", "slack", 2)];
const withActive = (cls) => clients.map((c) => ({ ...c, focusHistoryID: c.class === cls ? 0 : c.focusHistoryID + 1 }));

const cfg = (commands, extra = {}) => parse(JSON.stringify({ commands, ...extra }));
const say = (config, text, cs = clients) => interpret(config, { clients: cs }, text);

test("active window comes from focusHistoryID 0", () => {
  assert.equal(activeWindow(clients).address, "0x1");
  assert.equal(activeWindow(withActive("slack")).address, "0x3");
  assert.equal(activeWindow([]), null);
  assert.equal(activeWindow([{ ...win("0x1", "x", 0), mapped: false }]), null);
  assert.equal(classMatches(win("0x1", "Firefox", 0), "^firefox$"), true);
  assert.equal(classMatches(null, "x"), false);
});

test("a custom exec command runs through the same tree", () => {
  const { config, errors } = cfg([{ say: "lock screen", exec: ["omarchy-system-lock"] }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(say(config, "Lock screen.").actions, [{ type: "exec", argv: ["omarchy-system-lock"] }]);
  assert.deepEqual(say(config, "lock").outcome, { kind: "incomplete", path: ["lock"], expected: ["screen"], tokens: ["lock"] });
});

test("custom launch commands become app.launch actions", () => {
  const { config } = cfg([{ say: "notes", launch: ["obsidian", "--new"] }]);
  assert.deepEqual(say(config, "notes").actions, [{ type: "app.launch", argv: ["obsidian", "--new"] }]);
});

test("commands sharing a first word merge into one branch", () => {
  const { config } = cfg([
    { say: "lock screen", exec: ["a"] },
    { say: "lock session", exec: ["b"] },
  ]);
  assert.deepEqual(registryErrors(config), []);
  assert.deepEqual(say(config, "lock").outcome.expected, ["screen", "session"]);
  assert.deepEqual(say(config, "lock session").actions, [{ type: "exec", argv: ["b"] }]);
});

test("a custom command can extend a built-in one", () => {
  const { config } = cfg([{ say: "move all", exec: ["x"] }]);
  assert.deepEqual(registryErrors(config), []);
  assert.deepEqual(say(config, "move all").actions, [{ type: "exec", argv: ["x"] }]);
  assert.equal(say(config, "move space 2").actions[0].type, "hypr.moveWindowToWorkspace");
  assert.deepEqual(say(config, "move").outcome.expected, ["space", "left", "right", "up", "down", "all"]);
});

test("a custom keyword beats a value argument (open notes vs open <app>)", () => {
  const { config } = cfg([{ say: "open notes", launch: ["obsidian"] }]);
  assert.deepEqual(say(config, "open notes").actions, [{ type: "app.launch", argv: ["obsidian"] }]);
  assert.deepEqual(say(config, "open spotify").actions, [{ type: "app.launch", argv: ["spotify"] }]); // still the built-in <app>
  assert.equal(say(config, "open notes").outcome.commandId, "open notes");
});

test("a custom command can sit on a built-in prefix without disturbing it", () => {
  const { config } = cfg([{ say: "space", exec: ["x"] }]);
  assert.deepEqual(registryErrors(config), []);
  assert.deepEqual(say(config, "space").actions, [{ type: "exec", argv: ["x"] }]);
  assert.equal(say(config, "space 1").actions[0].type, "hypr.focusWorkspace");
});

test("defining the same words twice is reported and the first wins", () => {
  const { config } = cfg([{ say: "lock screen", exec: ["first"] }, { say: "lock screen", exec: ["second"] }]);
  assert.match(registryErrors(config).join(" "), /lock screen is defined twice/);
  assert.deepEqual(say(config, "lock screen").actions, [{ type: "exec", argv: ["first"] }]);
});

test("when.activeClass: only while that app is focused", () => {
  const { config, errors } = cfg([{ say: "tab next", exec: ["x"], when: { activeClass: "^firefox$" } }]);
  assert.deepEqual(errors, []);
  assert.equal(say(config, "tab next", withActive("firefox")).outcome.kind, "matched");
  assert.equal(say(config, "tab next", withActive("slack")).outcome.kind, "nomatch");
  assert.equal(say(config, "tab next", []).outcome.kind, "nomatch");
});

test("the same words can mean different things per focused app", () => {
  const { config } = cfg([
    { say: "next", exec: ["firefox-next"], when: { activeClass: "^firefox$" } },
    { say: "next", exec: ["slack-next"], when: { activeClass: "^slack$" } },
  ]);
  assert.deepEqual(say(config, "next", withActive("firefox")).actions, [{ type: "exec", argv: ["firefox-next"] }]);
  assert.deepEqual(say(config, "next", withActive("slack")).actions, [{ type: "exec", argv: ["slack-next"] }]);
});

test("regression: one first word shared by conditional and unconditional commands", () => {
  const { config } = cfg([
    { say: "vocon test", exec: ["plain"] },
    { say: "vocon scoped", exec: ["scoped"], when: { activeClass: "^firefox$" } },
  ]);
  // in firefox both branches are active: the second word decides, nothing is ambiguous
  assert.deepEqual(say(config, "vocon scoped", withActive("firefox")).actions, [{ type: "exec", argv: ["scoped"] }]);
  assert.deepEqual(say(config, "vocon test", withActive("firefox")).actions, [{ type: "exec", argv: ["plain"] }]);
  assert.deepEqual(say(config, "vocon", withActive("firefox")).outcome.expected, ["test", "scoped"]);
  // elsewhere only the unconditional one exists
  assert.deepEqual(say(config, "vocon test", withActive("slack")).actions, [{ type: "exec", argv: ["plain"] }]);
  assert.equal(say(config, "vocon scoped", withActive("slack")).outcome.kind, "nomatch");
  assert.deepEqual(say(config, "vocon", withActive("slack")).outcome.expected, ["test"]);
});

test("hints list each valid word once even when conditional commands repeat it", () => {
  const browser = "^firefox$";
  const { config } = cfg([
    { say: "tab close", exec: ["a"], when: { activeClass: browser } },
    { say: "tab reopen", exec: ["b"], when: { activeClass: browser } },
    { say: "next", exec: ["c"], when: { activeClass: browser } },
    { say: "next", exec: ["d"], when: { activeClass: "^slack$" } },
  ]);
  const expected = say(config, "banana", withActive("firefox")).outcome.expected;
  assert.equal(expected.filter((w) => w === "tab").length, 1);
  assert.equal(expected.filter((w) => w === "next").length, 1);
  assert.deepEqual(say(config, "tab", withActive("firefox")).outcome.expected, ["close", "reopen"]);
});

test("invalid entries are reported and dropped; valid ones survive", () => {
  const { config, errors } = cfg([
    "nope",
    { say: "", exec: ["x"] },
    { say: "both", exec: ["x"], launch: ["y"] },
    { say: "neither" },
    { say: "empty argv", exec: [] },
    { say: "bad when", exec: ["x"], when: { activeClass: "(" } },
    { say: "fine one", exec: ["ok"] },
  ]);
  assert.equal(errors.length, 6);
  assert.equal(config.commands.length, 1);
  assert.equal(config.commands[0].say, "fine one");
  assert.deepEqual(parse('{"commands":"x"}').errors, ["commands must be an array"]);
});

test("the custom pack can be disabled", () => {
  const { config } = cfg([{ say: "lock screen", exec: ["x"] }], { packs: { custom: { enabled: false } } });
  assert.equal(say(config, "lock screen").outcome.kind, "nomatch");
  assert.equal(say(config, "space 1").outcome.kind, "matched");
});

// --- config safety in the session ---
test("parse reports ok:false only for unusable text", () => {
  assert.equal(parse("{nope").ok, false);
  assert.equal(parse("[]").ok, false);
  assert.equal(parse("{}").ok, true);
  assert.equal(parse('{"voxtype":{"maxSeconds":"x"}}').ok, true);
});

test("an unusable config keeps the previous one instead of resetting to defaults", () => {
  const good = parse('{"apps":{"slack":{}}}');
  let s = reduce(initialState(), { type: "ConfigLoaded", ...good }).state;
  assert.ok(s.config.apps.slack);
  const bad = parse("{nope");
  const r = reduce(s, { type: "ConfigLoaded", config: bad.config, errors: bad.errors, ok: bad.ok });
  assert.equal(r.state.config, s.config);
  assert.deepEqual(r.effects.map((e) => e.type), ["notify", "log"]);
  assert.match(r.effects[0].body, /keeping the previous config/);
});

test("a config with problems still loads and reports them", () => {
  const { config, errors, ok } = cfg([{ say: "", exec: ["x"] }]);
  const r = reduce(initialState(), { type: "ConfigLoaded", config, errors, ok });
  assert.equal(r.state.config, config);
  assert.deepEqual(r.effects.map((e) => e.type), ["notify", "log"]);
});
