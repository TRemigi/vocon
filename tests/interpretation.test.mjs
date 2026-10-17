import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../core/interpretation/utterance.mjs";
import { workspaceSlot, parseNumberToken } from "../core/interpretation/slots.mjs";
import { similarity, distance } from "../core/interpretation/similarity.mjs";
import { tokenScore } from "../core/interpretation/words.mjs";
import { parse } from "../core/interpretation/parser.mjs";
import { command, keyword, value } from "../core/commands/dsl.mjs";

test("normalize lowercases, strips punctuation and splits", () => {
  assert.deepEqual(normalize("Move focused Space 1."), ["move", "focused", "space", "1"]);
  assert.deepEqual(normalize("  Space-one!  "), ["space", "one"]);
  assert.deepEqual(normalize(""), []);
  assert.deepEqual(normalize(null), []);
});

test("normalize joins split compounds", () => {
  assert.deepEqual(normalize("Work space 3"), ["workspace", "3"]);
});

test("number tokens: digits, words, homophones", () => {
  assert.equal(parseNumberToken("7"), 7);
  assert.equal(parseNumberToken("three"), 3);
  assert.equal(parseNumberToken("won"), 1);
  assert.equal(parseNumberToken("for"), 4);
  assert.equal(parseNumberToken("banana"), null);
});

test("workspace slot enforces 1..max", () => {
  const slot = workspaceSlot(10);
  assert.deepEqual(slot.parse(["10"], 0), [{ value: 10, next: 1 }]);
  assert.deepEqual(slot.parse(["11"], 0), []);
  assert.deepEqual(slot.parse(["0"], 0), []);
  assert.deepEqual(slot.parse([], 0), []);
});

test("similarity", () => {
  assert.equal(distance("kitten", "sitting"), 3);
  assert.equal(similarity("space", "space"), 1);
  assert.equal(similarity("space", "pace"), 0.8);
  assert.equal(similarity("", ""), 1);
});

const fuzzy = { threshold: 0.8, aliases: { space: ["base", "pace"] } };

test("tokenScore: exact > alias > fuzzy; short words never fuzzy", () => {
  assert.equal(tokenScore(["space"], "space", fuzzy), 1);
  assert.equal(tokenScore(["space"], "base", fuzzy), 0.9);
  assert.ok(tokenScore(["workspace"], "workspaces", fuzzy) >= 0.9 && tokenScore(["workspace"], "workspaces", fuzzy) < 1);
  assert.equal(tokenScore(["space"], "this", fuzzy), 0);
  assert.equal(tokenScore(["go"], "so", fuzzy), 0);
  assert.equal(tokenScore(["workspace"], "workspaces"), 0); // exact mode
});

// --- parser over a small tree: move focused space <n> / space <n> / ping ---
const slotTypes = { workspace: workspaceSlot(10) };
const run = (tag) => (args) => [{ tag, args }];
const roots = [
  command("move", { words: ["send"] }, [
    keyword("focused", { words: ["current"] }, [
      keyword("space", { words: ["workspace"] }, [value("n", "workspace", { run: run("move") })]),
    ]),
  ]),
  command("space", { words: ["workspace"] }, [value("n", "workspace", { run: run("focus") })]),
  command("ping", { run: run("ping") }),
];
const go = (tokens, options, rs = roots, ctx = {}) => parse(rs, slotTypes, tokens, ctx, options);

test("parser: walks the tree one token per level", () => {
  const r = go(["move", "focused", "space", "3"]);
  assert.equal(r.kind, "matched");
  assert.deepEqual(r.path, ["move", "focused", "space"]);
  assert.deepEqual(r.args, { n: 3 });
  assert.equal(r.score, 1);
  assert.deepEqual(r.node.run(r.args), [{ tag: "move", args: { n: 3 } }]);
});

test("parser: top-level command with a value, and one with no args", () => {
  assert.deepEqual(go(["space", "one"]).args, { n: 1 });
  assert.equal(go(["ping"]).kind, "matched");
});

test("parser: synonyms resolve to the canonical path", () => {
  assert.deepEqual(go(["send", "current", "workspace", "2"]).path, ["move", "focused", "space"]);
});

test("parser: incomplete says what would be valid next", () => {
  assert.deepEqual(go(["move"]), { kind: "incomplete", path: ["move"], expected: ["focused"] });
  assert.deepEqual(go(["move", "focused", "space"]), { kind: "incomplete", path: ["move", "focused", "space"], expected: ["<workspace>"] });
});

test("parser: a word that isn't valid here is a positional nomatch", () => {
  const r = go(["move", "banana", "space", "1"]);
  assert.equal(r.kind, "nomatch");
  assert.equal(r.at, 1);
  assert.equal(r.token, "banana");
  assert.deepEqual(r.path, ["move"]);
  assert.deepEqual(r.expected, ["focused"]);
});

test("parser: arguments are not interchangeable between commands", () => {
  assert.equal(go(["space", "focused", "1"]).kind, "nomatch");
  assert.equal(go(["focused", "move", "space", "1"]).kind, "nomatch");
});

test("parser: extra trailing words fail (a value with no children is the end)", () => {
  assert.equal(go(["space", "1", "now"]).kind, "nomatch");
});

test("parser: value out of range is a nomatch expecting the value", () => {
  const r = go(["space", "11"]);
  assert.equal(r.kind, "nomatch");
  assert.deepEqual(r.expected, ["<workspace>"]);
});

test("parser: mishearings via aliases and fuzzy matching, scored below exact", () => {
  const r = go(["move", "focused", "base", "2"], fuzzy);
  assert.equal(r.kind, "matched");
  assert.ok(r.score < 1 && r.score > 0.9);
  assert.equal(go(["workspaces", "2"], fuzzy).kind, "matched");
  assert.equal(go(["base", "2"]).kind, "nomatch"); // exact mode
});

test("parser: sibling words too similar to call are ambiguous, not guessed", () => {
  const rs = [command("alpha", { run: run("a") }), command("alpho", { run: run("b") })];
  const r = go(["alphx"], { threshold: 0.7, aliases: {} }, rs);
  assert.equal(r.kind, "ambiguous");
  assert.deepEqual(r.candidates, ["alpha", "alpho"]);
  assert.equal(go(["alpha"], { threshold: 0.7, aliases: {} }, rs).kind, "matched"); // exact wins
});

test("parser: when(ctx) hides a node", () => {
  const rs = [command("only", { when: (ctx) => ctx.app === "x", run: run("o") })];
  assert.equal(go(["only"], undefined, rs, { app: "y" }).kind, "nomatch");
  assert.equal(go(["only"], undefined, rs, { app: "x" }).kind, "matched");
});
