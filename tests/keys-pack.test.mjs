import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, registryErrors } from "../plugin/core/pipeline.mjs";
import { parse, defaults } from "../plugin/core/config.mjs";
import { toArgv } from "../plugin/core/execution/keys.mjs";

const win = (address, cls, focus) => ({ address, class: cls, title: "", mapped: true, focusHistoryID: focus });
const inTerminal = [win("0x1", "com.mitchellh.ghostty", 0)];
const inSlack = [win("0x2", "slack", 0), win("0x1", "com.mitchellh.ghostty", 1)];
const inClaude = [win("0x3", "com.anthropic.Claude", 0), win("0x1", "com.mitchellh.ghostty", 1)];
const nothing = [];

const say = (text, clients = inTerminal, config = defaults) => interpret(config, { clients }, text);
const keys = (text, clients, config) => {
  const r = say(text, clients, config);
  return r.actions.map((a) => (a.type === "keys.send" ? toArgv(a).slice(1).join(" ") : a.type));
};
const repeat = (arrow, n) => [Array(n).fill("-k " + arrow).join(" ")];

test("the keys pack registers cleanly with the others", () => {
  assert.deepEqual(registryErrors(defaults), []);
});

test("an arrow on its own presses it once", () => {
  assert.deepEqual(keys("down"), ["-k Down"]);
  assert.deepEqual(keys("up"), ["-k Up"]);
  assert.deepEqual(keys("left"), ["-k Left"]);
  assert.deepEqual(keys("right"), ["-k Right"]);
  assert.deepEqual(keys("Down."), ["-k Down"]);
});

test("a count presses it that many times, as a digit or a number word", () => {
  assert.deepEqual(keys("down three"), repeat("Down", 3));
  assert.deepEqual(keys("down 3"), repeat("Down", 3));
  assert.deepEqual(keys("Up five."), repeat("Up", 5));
  assert.deepEqual(keys("left 12"), repeat("Left", 12));
  assert.deepEqual(keys("right one"), repeat("Right", 1));
  assert.deepEqual(keys("down to"), repeat("Down", 2));   // "two" is often heard as "to"
});

test("the count is limited, by default to 20", () => {
  assert.deepEqual(keys("down 20"), repeat("Down", 20));
  for (const text of ["down 21", "down 0", "down 100", "down lots", "down three more"]) {
    const r = say(text);
    assert.equal(r.outcome.kind, "nomatch", text);
    assert.deepEqual(r.actions, [], text);
  }
});

test("the limit follows the config, and cannot be raised past a hard cap", () => {
  const small = parse('{"packs":{"keys":{"maxCount":3}}}').config;
  assert.deepEqual(keys("down 3", inTerminal, small), repeat("Down", 3));
  assert.equal(say("down 4", inTerminal, small).outcome.kind, "nomatch");

  const huge = parse('{"packs":{"keys":{"maxCount":100000}}}').config;
  assert.deepEqual(keys("down 100", inTerminal, huge), repeat("Down", 100));
  assert.equal(say("down 101", inTerminal, huge).outcome.kind, "nomatch");

  const bad = parse('{"packs":{"keys":{"maxCount":"many"}}}').config;
  assert.equal(keys("down 20", inTerminal, bad).length, 1);
  assert.equal(say("down 21", inTerminal, bad).outcome.kind, "nomatch");
});

test("they work in any window, including ones with their own commands", () => {
  for (const clients of [inTerminal, inSlack, inClaude, nothing]) {
    assert.deepEqual(keys("down two", clients), repeat("Down", 2));
  }
});

test("app-scoped commands still work next to them", () => {
  assert.deepEqual(keys("message down", inSlack), ["-k Down"]);
  assert.deepEqual(keys("session next", inClaude), ["-M ctrl -k Tab -m ctrl"]);
  assert.equal(say("space 2").actions[0].type, "hypr.focusWorkspace");
});

test("a mishearing of the count never presses anything", () => {
  assert.equal(say("down dev").outcome.kind, "nomatch");
  assert.deepEqual(say("down dev").actions, []);
});

test("the keys pack can be disabled", () => {
  const { config } = parse('{"packs":{"keys":{"enabled":false}}}');
  assert.equal(say("down", inTerminal, config).outcome.kind, "nomatch");
  assert.equal(say("down three", inTerminal, config).outcome.kind, "nomatch");
});
