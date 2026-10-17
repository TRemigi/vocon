// A worked example of an app adapter: a pack whose commands exist only while one app is focused.
// A real adapter would return a "send keyboard shortcut" action where this returns `exec`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, registryErrors } from "../core/pipeline.mjs";
import { defaults } from "../core/config.mjs";
import { builtinPacks } from "../core/commands/packs/index.mjs";
import { command, keyword } from "../core/commands/dsl.mjs";
import { classMatches } from "../core/execution/windows.mjs";
import { exec } from "../core/execution/actions.mjs";

// 1. Decide when the adapter applies. ctx.active is the focused window (or null).
const whenFirefox = (ctx) => classMatches(ctx.active, "^firefox$");

// 2. Describe its commands as a tree, like any pack. `when` on a root hides the whole branch.
const firefoxAdapter = {
  id: "firefox",
  commands: () => [
    command("tab", { when: whenFirefox }, [
      keyword("next", { run: () => [exec(["shortcut", "CTRL", "Tab"])] }),
      keyword("previous", { words: ["back"], run: () => [exec(["shortcut", "CTRL+SHIFT", "Tab"])] }),
      keyword("close", { run: () => [exec(["shortcut", "CTRL", "W"])] }),
    ]),
  ],
};

const packs = builtinPacks.concat([firefoxAdapter]);
const win = (cls, focus) => ({ address: "0x" + cls, class: cls, title: "", mapped: true, focusHistoryID: focus });
const inFirefox = [win("firefox", 0), win("slack", 1)];
const inSlack = [win("firefox", 1), win("slack", 0)];
const say = (text, clients) => interpret(defaults, { clients }, text, packs);

test("the adapter registers cleanly alongside the built-ins", () => {
  assert.deepEqual(registryErrors(defaults, packs), []);
});

test("its commands work while the app is focused", () => {
  assert.deepEqual(say("tab next", inFirefox).actions, [exec(["shortcut", "CTRL", "Tab"])]);
  assert.deepEqual(say("tab back", inFirefox).actions, [exec(["shortcut", "CTRL+SHIFT", "Tab"])]);
  assert.equal(say("tab close", inFirefox).outcome.commandId, "tab close");
});

test("...and do not exist anywhere else", () => {
  const r = say("tab next", inSlack);
  assert.equal(r.outcome.kind, "nomatch");
  assert.deepEqual(r.actions, []);
  assert.equal(say("tab next", []).outcome.kind, "nomatch");
});

test("built-in commands are unaffected either way", () => {
  assert.equal(say("space 2", inFirefox).actions[0].type, "hypr.focusWorkspace");
  assert.equal(say("space 2", inSlack).actions[0].type, "hypr.focusWorkspace");
});

test("failures inside the adapter say what is valid there", () => {
  assert.deepEqual(say("tab", inFirefox).outcome.expected, ["next", "previous", "close"]);
});
