import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistry, validate } from "../plugin/core/commands/registry.mjs";
import { builtinPacks } from "../plugin/core/commands/packs/index.mjs";
import { command, keyword, value } from "../plugin/core/commands/dsl.mjs";
import { interpret, registryErrors } from "../plugin/core/pipeline.mjs";
import { defaults } from "../plugin/core/config.mjs";
import { workspaceSlot } from "../plugin/core/interpretation/slots.mjs";

const leaf = (tag) => ({ run: () => [{ type: "t", tag }] });

test("built-in packs form a healthy tree", () => {
  assert.deepEqual(registryErrors(defaults), []);
});

// A future pack extends `move` with a new argument; it merges into the existing branch.
const extensionPack = {
  id: "extension",
  commands: () => [
    command("move", {}, [
      keyword("all", {}, [keyword("space", { words: ["workspace"] }, [value("n", "workspace", leaf("move-all"))])]),
      keyword("group", {}, [value("n", "workspace", leaf("move-group"))]),
    ]),
  ],
};
const packs = builtinPacks.concat([extensionPack]);
const say = (text) => interpret(defaults, {}, text, packs);

test("a later pack extends an existing command without touching the first", () => {
  assert.deepEqual(registryErrors(defaults, packs), []);
  assert.equal(say("move all space 2").actions[0].tag, "move-all");
  assert.equal(say("move group 3").actions[0].tag, "move-group");
  // the original branch still works, and sees the merged siblings
  assert.equal(say("move space 4").actions[0].type, "hypr.moveWindowToWorkspace");
  assert.deepEqual(say("move").outcome.expected, ["space", "left", "right", "up", "down", "all", "group"]);
  assert.deepEqual(say("move all").outcome.expected, ["space"]);
});

test("registry reports a command defined twice, keeps the first", () => {
  const dup = { id: "dup", commands: () => [command("space", {}, [value("n", "workspace", leaf("dup"))])] };
  const { errors } = buildRegistry(builtinPacks.concat([dup]), defaults);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /space <workspace> is defined twice/);
  assert.equal(interpret(defaults, {}, "space 1", builtinPacks.concat([dup])).actions[0].type, "hypr.focusWorkspace");
});

test("validate flags colliding sibling words, several values, and dead ends", () => {
  const a = keyword("a", { words: ["x"], run: () => [] });
  const b = keyword("b", { words: ["x"], run: () => [] });
  assert.match(validate([a, b])[0], /'x' means both 'a' and 'b'/);

  const v1 = value("n", "workspace", leaf("1"));
  const v2 = value("m", "workspace", leaf("2"));
  assert.match(validate([keyword("p", {}, [v1, v2])])[0], /more than one value argument after p/);

  assert.match(validate([keyword("empty", {})])[0], /dead end: empty/);
});

test("disabling a pack removes its commands", () => {
  const config = Object.assign({}, defaults, { packs: { hyprland: { enabled: false } } });
  assert.equal(interpret(config, {}, "space 1").outcome.kind, "nomatch");
});

test("pack slot types are collected", () => {
  const { slotTypes } = buildRegistry(builtinPacks, defaults);
  assert.deepEqual(slotTypes.workspace.parse(["3"], 0), workspaceSlot(10).parse(["3"], 0));
});
