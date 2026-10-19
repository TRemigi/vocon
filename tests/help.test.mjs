import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, registryErrors } from "../core/pipeline.mjs";
import { defaults, fromObject } from "../core/config.mjs";
import { buildRegistry } from "../core/commands/registry.mjs";
import { builtinPacks } from "../core/commands/packs/index.mjs";
import { describe, rows, filterRows } from "../core/commands/listing.mjs";
import { initialState, reduce } from "../core/listening/session.mjs";

const help = (text, config = defaults) => {
  const r = interpret(config, { clients: [] }, text);
  return { outcome: r.outcome, action: r.actions[0], actions: r.actions };
};
const phrases = (action) => action.rows.map((r) => r.phrase);

test("`help` opens the menu with every command, as one help.show action", () => {
  const { outcome, actions, action } = help("help");
  assert.equal(outcome.kind, "matched");
  assert.equal(actions.length, 1);
  assert.equal(action.type, "help.show");
  for (const p of ["space <n>", "open <app>", "dictate", "slack channel <name>", "send"]) assert.ok(phrases(action).includes(p), p);
  assert.ok(action.rows.some((r) => r.topic === "Claude Desktop"));
  assert.ok(action.rows.some((r) => r.topic === "Keys"));
});

test("`help slack` lists only Slack's commands: the focused form and the from-anywhere form", () => {
  const { action } = help("help slack");
  assert.equal(action.title, "Slack");
  assert.ok(action.rows.length > 0);
  assert.ok(action.rows.every((r) => r.topic === "Slack"));
  assert.ok(phrases(action).includes("send"));
  assert.ok(phrases(action).includes("slack channel <name>"));
  assert.ok(!phrases(action).includes("space <n>"));
  assert.ok(!phrases(action).some((p) => p.startsWith("claude")));
  // the scope travels with the row, so the menu can say where a command works
  assert.equal(action.rows.find((r) => r.phrase === "send").scope, "while Slack is focused");
  assert.equal(action.rows.find((r) => r.phrase === "slack channel <name>").scope, null);
});

test("every app pack gets a topic, and `core` covers the built-in commands", () => {
  const claude = help("help claude").action;
  assert.ok(claude.rows.length > 0 && claude.rows.every((r) => r.topic === "Claude Desktop"));

  const core = help("help core").action;
  for (const p of ["space <n>", "move space <n>", "move left", "open <app>", "focus <app>", "dictate"]) assert.ok(phrases(core).includes(p), p);
  assert.ok(core.rows.some((r) => r.phrase.startsWith("up")), "arrow keys are core");
  assert.ok(!phrases(core).includes("send"));
  assert.ok(!phrases(core).includes("slack channel <name>"));

  assert.ok(phrases(help("help keys").action).some((p) => /^up\b/.test(p)));
});

test("topics can be said by their extra names and survive mishearing", () => {
  assert.equal(help("help workspaces").action.title, "Workspaces");
  assert.equal(help("help hyperland").action.title, "Workspaces");
  assert.equal(help("help windows").action.title, "Workspaces");
  assert.equal(help("Help, Slack.").action.title, "Slack");
});

test("the menu offers the topic names, and the topic commands themselves are not rows", () => {
  const { action } = help("help");
  for (const t of ["slack", "claude", "keys", "core"]) assert.ok(action.topics.includes(t), t);
  assert.ok(!phrases(action).some((p) => p.startsWith("help ")));
  assert.ok(phrases(action).includes("help"));
});

test("an unknown topic is a normal no-match, not an empty menu", () => {
  const r = interpret(defaults, { clients: [] }, "help banana");
  assert.equal(r.outcome.kind, "nomatch");
  assert.deepEqual(r.actions, []);
  assert.ok(r.outcome.expected.includes("slack"));
});

test("disabled packs are not topics and their commands are not listed", () => {
  const { config } = fromObject({ packs: { slack: { enabled: false } } });
  assert.ok(!help("help", config).action.topics.includes("slack"));
  assert.ok(!phrases(help("help", config).action).some((p) => p.includes("slack")));
  assert.equal(interpret(config, { clients: [] }, "help slack").outcome.kind, "nomatch");

  const off = fromObject({ packs: { help: { enabled: false } } }).config;
  assert.equal(interpret(off, { clients: [] }, "help").outcome.kind, "nomatch");
});

test("custom commands get a `custom` topic only when there are some", () => {
  assert.equal(interpret(defaults, { clients: [] }, "help custom").outcome.kind, "nomatch");

  const { config } = fromObject({ commands: [{ say: "lock screen", exec: ["lock"] }, { say: "tab next", exec: ["x"], when: { activeClass: "^firefox$" } }] });
  const { action } = help("help custom", config);
  assert.deepEqual(phrases(action).sort(), ["lock screen", "tab next"]);
  assert.equal(action.rows.find((r) => r.phrase === "tab next").scope, "while a window matching /^firefox$/ is focused");
  assert.ok(help("help", config).action.topics.includes("custom"));
});

test("a pack added later becomes a topic with no change to help", () => {
  const extra = {
    id: "memos",
    help: { title: "Memo app" },
    commands: () => [{ kind: "keyword", name: "memo", words: ["memo"], children: [], run: () => [{ type: "exec", argv: ["memos"] }] }],
  };
  const packs = builtinPacks.slice(0, -1).concat([extra, builtinPacks[builtinPacks.length - 1]]);
  // the help pack was built from the original list, so rebuild it from the new one
  return import("../core/commands/packs/help.mjs").then(({ makeHelpPack }) => {
    const all = packs.slice(0, -1);
    const withHelp = all.concat([makeHelpPack(all)]);
    const r = interpret(defaults, { clients: [] }, "help memos", withHelp);
    assert.equal(r.outcome.kind, "matched");
    assert.equal(r.actions[0].title, "Memo app");
    assert.deepEqual(phrases(r.actions[0]), ["memo"]);
  });
});

test("the descriptor is plain data built from the grammar, never from speech", () => {
  const { action } = help("help slack");
  assert.deepEqual(JSON.parse(JSON.stringify(action)), action);
  const text = JSON.stringify(action).toLowerCase();
  assert.ok(!text.includes("help slack"), "the transcript is not echoed");
  assert.deepEqual(Object.keys(action).sort(), ["rows", "title", "topics", "type"]);
});

test("help only opens a menu: it types, runs and focuses nothing", () => {
  for (const t of ["help", "help slack", "help core", "help claude"]) {
    const { actions } = help(t);
    assert.deepEqual(actions.map((a) => a.type), ["help.show"], t);
  }
});

test("the registry stays conflict-free with help in it", () => {
  assert.deepEqual(registryErrors(defaults), []);
});

// --- row building and filtering ---

const allRows = rows(describe(buildRegistry(builtinPacks, defaults)), { hyprland: "Workspaces" });

test("filter: every word must appear, in any order and case", () => {
  assert.deepEqual(filterRows(allRows, "").length, allRows.length);
  assert.deepEqual(filterRows(allRows, "   ").length, allRows.length);
  const hits = filterRows(allRows, "SPACE move");
  assert.ok(hits.some((r) => r.phrase === "move space <n>"));
  assert.ok(hits.every((r) => /move/.test(r.search) && /space/.test(r.search)));
  assert.deepEqual(filterRows(allRows, "zzzz"), []);
});

test("filter: matches every accepted spelling, the topic and the scope", () => {
  assert.ok(filterRows(allRows, "workspace").some((r) => r.phrase === "space <n>"));
  assert.ok(filterRows(allRows, "workspaces").some((r) => r.phrase === "space <n>"), "topic title");
  assert.ok(filterRows(allRows, "while slack").some((r) => r.phrase === "send"), "scope text");
});

test("rows carry argument hints for the footer", () => {
  assert.equal(allRows.find((r) => r.phrase === "space <n>").hint, "<n>: workspace number, 1-10");
  assert.equal(allRows.find((r) => r.phrase === "dictate").hint, "");
});

// --- through the session: same lock gate as every other command ---

const run = (...events) => events.reduce((acc, e) => {
  const r = reduce(acc.state, e);
  return { state: r.state, effects: acc.effects.concat(r.effects) };
}, { state: initialState(), effects: [] });
const said = (text, unlocked) => run({ type: "PttPressed" }, { type: "PttReleased" }, { type: "TranscriptReceived", text }, { type: "ClientsSnapshot", clients: [], unlocked });

test("session: `help slack` emits the menu effect when unlocked", () => {
  const { effects } = said("help slack", true);
  const shown = effects.filter((e) => e.type === "help.show");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, "Slack");
  assert.ok(effects.some((e) => e.type === "log" && /heard 2 word\(s\) -> matched help slack/.test(e.message)));
  assert.ok(!JSON.stringify(effects.filter((e) => e.type === "log")).includes("slack channel"), "logs carry no rows");
});

test("session: help is refused while the screen is locked", () => {
  const { effects } = said("help slack", false);
  assert.deepEqual(effects.filter((e) => e.type === "help.show"), []);
});
