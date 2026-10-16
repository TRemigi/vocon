import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret } from "../plugin/core/pipeline.mjs";
import { parse, defaults } from "../plugin/core/config.mjs";

const run = (text, config = defaults) => interpret(config, { clients: [] }, text);
const focus = (n) => [{ type: "hypr.focusWorkspace", workspace: n }];
const move = (n, follow = true) => [{ type: "hypr.moveWindowToWorkspace", workspace: n, follow }];
const swap = (direction) => [{ type: "hypr.swapWindow", direction }];

const cases = [
  // the three user scenarios
  ["space 1", focus(1)],
  ["Move space 1", move(1)],
  ["move left", swap("left")],
  // focus
  ["Space one.", focus(1)],
  ["workspace 3", focus(3)],
  ["Work space 3", focus(3)],
  ["space ten", focus(10)],
  // move, with synonyms
  ["move workspace 8", move(8)],
  // directions
  ["Move right.", swap("right")],
  ["move up", swap("up")],
  ["moved down", swap("down")],
  // mishearings via aliases / homophones
  ["Base 2.", focus(2)],
  ["pace won", focus(1)],
  ["move base 3", move(3)],
  ["moved space 3", move(3)],
  ["space for", focus(4)],
  ["space ate", focus(8)],
];

for (const [text, actions] of cases) {
  test(`"${text}"`, () => assert.deepEqual(run(text).actions, actions));
}

for (const text of ["this too", "space 11", "space 0", "move", "space", "banana", "move window", "go to workspace 4", "move window to space 2", "move to space 2", "send space 7", "move focused space 2", "move left 2", "move diagonal"]) {
  test(`no action for "${text}"`, () => {
    const r = run(text);
    assert.deepEqual(r.actions, []);
    assert.notEqual(r.outcome.kind, "matched");
  });
}

test("moveFollows: false moves silently", () => {
  const { config } = parse('{"packs":{"hyprland":{"moveFollows":false}}}');
  assert.deepEqual(run("move space 2", config).actions, move(2, false));
});

test("workspaces option bounds the slot", () => {
  const { config } = parse('{"packs":{"hyprland":{"workspaces":4}}}');
  assert.deepEqual(run("space 5", config).actions, []);
  assert.deepEqual(run("space 4", config).actions, focus(4));
});

test("pack can be disabled", () => {
  const { config } = parse('{"packs":{"hyprland":{"enabled":false}}}');
  assert.equal(run("space 1", config).outcome.kind, "nomatch");
});

test("a user alias list for a word replaces the default list for that word", () => {
  const { config, errors } = parse('{"matching":{"aliases":{"space":["this"]}}}');
  assert.deepEqual(errors, []);
  assert.deepEqual(run("this 2", config).actions, focus(2));
  assert.deepEqual(run("base 2", config).actions, []);
  // other words keep their defaults
  assert.deepEqual(run("moved space 2", config).actions, move(2));
});

test("failures say where the command went wrong", () => {
  assert.deepEqual(run("move").outcome, { kind: "incomplete", path: ["move"], expected: ["space", "left", "right", "up", "down"], tokens: ["move"] });
  const r = run("move window to space 2").outcome;
  assert.equal(r.kind, "nomatch");
  assert.equal(r.token, "window");
  assert.deepEqual(r.expected, ["space", "left", "right", "up", "down"]);
});
