import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../plugin/core/interpretation/utterance.mjs";
import { compile, matchAll } from "../plugin/core/interpretation/grammar.mjs";
import { workspaceSlot, parseNumberToken } from "../plugin/core/interpretation/slots.mjs";
import { match } from "../plugin/core/interpretation/matcher.mjs";

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

const slotTypes = { workspace: workspaceSlot(10) };

test("grammar: literals, alternatives, optionals and slots", () => {
  const t = compile("go|switch [to] space {n:workspace}");
  assert.deepEqual(matchAll(t, ["go", "to", "space", "2"], slotTypes), [{ slots: { n: 2 } }]);
  assert.deepEqual(matchAll(t, ["switch", "space", "two"], slotTypes), [{ slots: { n: 2 } }]);
  assert.deepEqual(matchAll(t, ["space", "2"], slotTypes), []);
  assert.deepEqual(matchAll(t, ["go", "to", "space", "2", "now"], slotTypes), []);
});

test("grammar: unknown slot type never matches", () => {
  assert.deepEqual(matchAll(compile("open {a:app}"), ["open", "x"], {}), []);
});

const cmd = (id, phrases) => ({ id, phrases });

test("matcher: matched, nomatch, ambiguous", () => {
  const a = cmd("a", ["space {n:workspace}"]);
  const b = cmd("b", ["space {n:workspace}"]);
  assert.equal(match([a], slotTypes, ["space", "1"], {}).kind, "matched");
  assert.equal(match([a], slotTypes, ["banana"], {}).kind, "nomatch");
  assert.deepEqual(match([a, b], slotTypes, ["space", "1"], {}), { kind: "ambiguous", candidates: ["a", "b"] });
});

test("matcher: several phrases of one command with equal slots are not ambiguous", () => {
  const a = cmd("a", ["space {n:workspace}", "[go] space {n:workspace}"]);
  assert.equal(match([a], slotTypes, ["space", "1"], {}).kind, "matched");
});

test("matcher: when() filters commands by context", () => {
  const a = { id: "a", phrases: ["space {n:workspace}"], when: (ctx) => ctx.app === "x" };
  assert.equal(match([a], slotTypes, ["space", "1"], { app: "y" }).kind, "nomatch");
  assert.equal(match([a], slotTypes, ["space", "1"], { app: "x" }).kind, "matched");
});
