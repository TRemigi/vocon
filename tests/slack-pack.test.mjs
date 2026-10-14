import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, registryErrors } from "../plugin/core/pipeline.mjs";
import { parse, defaults } from "../plugin/core/config.mjs";
import { toArgv } from "../plugin/core/execution/keys.mjs";

const win = (address, cls, focus) => ({ address, class: cls, title: "", mapped: true, focusHistoryID: focus });
const inSlack = [win("0x1", "slack", 0), win("0x2", "com.mitchellh.ghostty", 1)];
const inTerminal = [win("0x1", "slack", 1), win("0x2", "com.mitchellh.ghostty", 0)];
const noSlack = [win("0x2", "com.mitchellh.ghostty", 0)];

const say = (text, clients, config = defaults) => interpret(config, { clients }, text);
const keys = (text, clients, config) => {
  const r = say(text, clients, config);
  return r.actions.map((a) => (a.type === "keys.send" ? toArgv(a).slice(1).join(" ") : a.type));
};

test("the slack pack registers cleanly with the others", () => {
  assert.deepEqual(registryErrors(defaults), []);
});

// --- the requested capabilities, in Slack ---
test("switch to a channel by name: Ctrl+K, type, Enter", () => {
  assert.deepEqual(keys("channel dev platform", inSlack),
    ["-M ctrl -k k -m ctrl -s 350 dev platform -s 450 -k Return"]);
  assert.deepEqual(keys("Channel general.", inSlack), ["-M ctrl -k k -m ctrl -s 350 general -s 450 -k Return"]);
  assert.equal(keys("dm alice", inSlack)[0], "-M ctrl -k k -m ctrl -s 350 alice -s 450 -k Return");
});

test("next unread item and its variants", () => {
  assert.deepEqual(keys("unread", inSlack), ["-M alt -M shift -k Down -m shift -m alt"]);
  assert.deepEqual(keys("unread next", inSlack), ["-M alt -M shift -k Down -m shift -m alt"]);
  assert.deepEqual(keys("unread previous", inSlack), ["-M alt -M shift -k Up -m shift -m alt"]);
  assert.deepEqual(keys("unread all", inSlack), ["-M ctrl -M shift -k a -m shift -m ctrl"]);
  assert.deepEqual(keys("unread first", inSlack), ["-M ctrl -k j -m ctrl"]);
});

test("previous location: history back and forward", () => {
  assert.deepEqual(keys("back", inSlack), ["-M alt -k Left -m alt"]);
  assert.deepEqual(keys("forward", inSlack), ["-M alt -k Right -m alt"]);
});

test("navigate messages", () => {
  const nav = { "message": "-k Up", "message up": "-k Up", "message previous": "-k Up", "message down": "-k Down",
    "message next": "-k Down", "message top": "-k Home", "message oldest": "-k Home", "message bottom": "-k End",
    "message latest": "-k End", "message page up": "-k Page_Up", "message page down": "-k Page_Down",
    "message thread": "-k Right", "message main": "-k Left" };
  for (const [text, expected] of Object.entries(nav)) assert.deepEqual(keys(text, inSlack), [expected], text);
});

test("edit, delete (opens Slack's confirmation), confirm, send, newline", () => {
  assert.deepEqual(keys("edit", inSlack), ["-k e"]);
  assert.deepEqual(keys("delete", inSlack), ["-k Delete"]);
  assert.deepEqual(keys("confirm", inSlack), ["-k Return"]);
  assert.deepEqual(keys("send", inSlack), ["-k Return"]);
  assert.deepEqual(keys("newline", inSlack), ["-M shift -k Return -m shift"]);
});

test("send follows the configured key", () => {
  const { config } = parse('{"packs":{"slack":{"send":"ctrl+Return"}}}');
  assert.deepEqual(keys("send", inSlack, config), ["-M ctrl -k Return -m ctrl"]);
});

// --- scoping and safety ---
test("short forms exist only while Slack is focused", () => {
  for (const text of ["channel dev", "unread", "back", "message up", "edit", "delete", "confirm", "send", "newline"]) {
    const r = say(text, inTerminal);
    assert.equal(r.outcome.kind, "nomatch", text);
    assert.deepEqual(r.actions, [], text);
  }
});

test("from anywhere: 'slack ...' focuses Slack first, then sends the keys", () => {
  const r = say("slack channel dev", inTerminal);
  assert.equal(r.actions.length, 2);
  assert.deepEqual(r.actions[0], { type: "hypr.focusWindow", address: "0x1" });
  assert.equal(toArgv(r.actions[1]).slice(1).join(" "), "-s 300 -M ctrl -k k -m ctrl -s 350 dev -s 450 -k Return");
  assert.deepEqual(keys("slack unread previous", inTerminal)[1], "-s 300 -M alt -M shift -k Up -m shift -m alt");
});

test("'slack ...' says so when Slack isn't running", () => {
  const r = say("slack back", noSlack);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].type, "notify");
  assert.match(r.actions[0].title, /Slack isn't running/);
});

test("sending, editing and deleting are never available from other apps", () => {
  for (const text of ["slack send", "slack edit", "slack delete", "slack confirm", "slack newline"]) {
    const r = say(text, inTerminal);
    assert.equal(r.outcome.kind, "nomatch", text);
    assert.deepEqual(r.actions, [], text);
  }
  assert.deepEqual(say("slack", inTerminal).outcome.expected, ["channel", "unread", "back", "forward", "message"]);
});

test("built-in commands still work, in and out of Slack", () => {
  for (const clients of [inSlack, inTerminal]) {
    assert.equal(say("space 2", clients).actions[0].type, "hypr.focusWorkspace");
    assert.equal(say("move focused space 2", clients).actions[0].type, "hypr.moveWindowToWorkspace");
  }
});

test("a channel name needs words; typed text can't carry key syntax", () => {
  assert.equal(say("channel", inSlack).outcome.kind, "incomplete");
  // normalisation reduces speech to letters and digits, so nothing option-like survives
  assert.equal(keys("channel -k ctrl", inSlack)[0], "-M ctrl -k k -m ctrl -s 350 k ctrl -s 450 -k Return");
});

test("the slack pack can be disabled", () => {
  const { config } = parse('{"packs":{"slack":{"enabled":false}}}');
  assert.equal(say("channel dev", inSlack, config).outcome.kind, "nomatch");
  assert.equal(say("slack back", inSlack, config).outcome.kind, "nomatch");
});
