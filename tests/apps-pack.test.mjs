import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, registryErrors } from "../plugin/core/pipeline.mjs";
import { parse, defaults } from "../plugin/core/config.mjs";
import { findWindow, isValidPattern } from "../plugin/core/execution/windows.mjs";
import { toArgv } from "../plugin/core/execution/hyprctl.mjs";

const win = (address, cls, extra = {}) => ({ address, class: cls, title: "", mapped: true, ...extra });
const clients = [
  win("0x1", "com.mitchellh.ghostty"),
  win("0x2", "chromium", { title: "Slack | general - Chromium" }), // a tab titled "Slack" is not Slack
  win("0x3", "slack"),
  win("0x4", "chrome-app.todoist.com__app_inbox-Default"),
  win("0x5", "Spotify"),
];
const { config } = parse('{"apps":{"slack":{},"visual studio code":{"match":"^code$","launch":["code"],"aliases":["vs code"]}}}');
const run = (text, cs = clients, cfg = config) => interpret(cfg, { clients: cs }, text);

test("the catalog in the test config is valid", () => {
  assert.deepEqual(parse('{"apps":{"slack":{}}}').errors, []);
  assert.deepEqual(registryErrors(config), []);
});

test("scenario: 'open slack' focuses the running Slack window", () => {
  assert.deepEqual(run("Open Slack.").actions, [{ type: "hypr.focusWindow", address: "0x3" }]);
});

test("scenario: 'open slack' launches it when no window matches", () => {
  const without = clients.filter((c) => c.class !== "slack");
  assert.deepEqual(run("open slack", without).actions, [{ type: "app.launch", argv: ["slack"] }]);
});

test("open twice: launch, then focus once the window exists", () => {
  assert.equal(run("open slack", []).actions[0].type, "app.launch");
  assert.equal(run("open slack", [win("0x9", "slack")]).actions[0].type, "hypr.focusWindow");
});

test("focus: focuses if running, otherwise only notifies (never launches)", () => {
  assert.deepEqual(run("focus spotify").actions, [{ type: "hypr.focusWindow", address: "0x5" }]);
  const r = run("focus slack", []);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].type, "notify");
  assert.match(r.actions[0].title, /slack isn't running/);
});

test("matches window class only, so a browser tab titled Slack doesn't count", () => {
  assert.equal(findWindow(clients.filter((c) => c.class !== "slack"), "slack"), null);
});

test("webapp windows don't count as the browser; the real browser does", () => {
  assert.equal(run("open browser").actions[0].address, "0x2");
  assert.equal(run("open browser", [clients[3]]).actions[0].type, "app.launch");
});

test("multi-word names and aliases, longest wins", () => {
  const code = [win("0xc", "code")];
  assert.deepEqual(run("open visual studio code", code).actions, [{ type: "hypr.focusWindow", address: "0xc" }]);
  assert.deepEqual(run("open vs code", code).actions, [{ type: "hypr.focusWindow", address: "0xc" }]);
  assert.deepEqual(run("open vs code", []).actions, [{ type: "app.launch", argv: ["code"] }]);
});

test("verb synonyms and mishearings", () => {
  assert.equal(run("launch slack").actions[0].address, "0x3");
  assert.equal(run("start spotify").actions[0].address, "0x5");
  assert.equal(run("open slak").actions[0].address, "0x3"); // fuzzy
  assert.equal(run("open terminal").actions[0].address, "0x1");
});

test("an unknown app is a positional nomatch, nothing runs", () => {
  const r = run("open banana");
  assert.deepEqual(r.actions, []);
  assert.equal(r.outcome.kind, "nomatch");
  assert.deepEqual(r.outcome.expected, ["<app>"]);
  assert.equal(run("open").outcome.kind, "incomplete");
});

test("speech never reaches argv: only catalog launch commands are emitted", () => {
  const r = run("open slack; rm -rf /", []);
  assert.deepEqual(r.actions, []);
  for (const text of ["open terminal", "open files", "open slack"]) {
    for (const a of run(text, []).actions) assert.ok(a.type === "app.launch" && a.argv.every((x) => typeof x === "string"));
  }
});

test("window lookup: mapped only, word-bounded, case-insensitive, regex patterns", () => {
  assert.equal(findWindow([win("0x1", "slack", { mapped: false })], "slack"), null);
  assert.equal(findWindow([win("0x1", "Slack")], "slack").address, "0x1");
  assert.equal(findWindow([win("0x1", "chrome-slack.com__client-Default")], "slack").address, "0x1");
  assert.equal(findWindow([win("0x1", "slackware")], "slack"), null);
  assert.equal(findWindow([win("0x1", "obsidian")], "^obsidian$").address, "0x1");
  assert.equal(findWindow(null, "x"), null);
  assert.equal(isValidPattern("("), false);
});

test("focusWindow translates to a hyprctl dispatch", () => {
  assert.equal(toArgv(run("open slack").actions[0])[2], 'hl.dsp.focus({ window = "address:0x3" })');
});

// --- catalog config ---
test("a bare {} entry defaults match + launch to the name", () => {
  const c = parse('{"apps":{"discord":{}}}').config.apps.discord;
  assert.deepEqual(c, { match: "discord", launch: ["discord"], aliases: [] });
});

test("catalog entries override defaults field by field; null removes", () => {
  const c = parse('{"apps":{"files":{"launch":["thunar"]},"obsidian":null}}').config.apps;
  assert.deepEqual(c.files.launch, ["thunar"]);
  assert.equal(c.files.match, defaults.apps.files.match);
  assert.equal(c.obsidian, undefined);
});

test("invalid entries are reported and dropped, the rest keep working", () => {
  const { config: c, errors } = parse(JSON.stringify({ apps: {
    "multi word": {},                                  // needs launch
    bad: { match: "(", launch: ["x"] },                // bad regex
    nolaunch: { launch: [] },
    clash: { launch: ["c"], aliases: ["spotify"] },    // name already taken by a default
    fine: {},
  } }));
  assert.equal(errors.length, 4);
  assert.deepEqual(Object.keys(c.apps).filter((k) => ["multi word", "bad", "nolaunch", "clash"].includes(k)), []);
  assert.ok(c.apps.fine && c.apps.spotify);
});
