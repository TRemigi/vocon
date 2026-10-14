import { test } from "node:test";
import assert from "node:assert/strict";
import { toArgv, combo, key, text, sleep } from "../plugin/core/execution/keys.mjs";
import { keysAction, typeText } from "../plugin/core/execution/actions.mjs";
import { wordsSlot } from "../plugin/core/interpretation/slots.mjs";

const argv = (...steps) => toArgv(keysAction(steps));

test("a plain key and a modifier combo", () => {
  assert.deepEqual(argv(key("Return")), ["wtype", "-k", "Return"]);
  assert.deepEqual(argv(combo("ctrl+k")), ["wtype", "-M", "ctrl", "-k", "k", "-m", "ctrl"]);
});

test("modifiers are released in reverse order", () => {
  assert.deepEqual(argv(combo("ctrl+shift+Tab")), ["wtype", "-M", "ctrl", "-M", "shift", "-k", "Tab", "-m", "shift", "-m", "ctrl"]);
});

test("a switcher sequence: keys, waits and text in one call", () => {
  assert.deepEqual(argv(combo("ctrl+k"), sleep(350), text("dev platform"), sleep(450), key("Return")),
    ["wtype", "-M", "ctrl", "-k", "k", "-m", "ctrl", "-s", "350", "dev platform", "-s", "450", "-k", "Return"]);
});

test("invalid steps are rejected, never passed on", () => {
  assert.throws(() => argv(combo("ctrl+k; rm -rf /")), /invalid key name/);
  assert.throws(() => argv(combo("hyper+k")), /invalid modifier/);
  assert.throws(() => argv(sleep(-1)), /invalid sleep/);
  assert.throws(() => argv(sleep(99999)), /invalid sleep/);
  assert.throws(() => argv({ nope: 1 }), /unknown key step/);
});

test("typed text can't smuggle wtype options or key presses", () => {
  assert.throws(() => argv(text("-k ctrl")), /invalid text/);
  assert.throws(() => argv(text("line\nbreak")), /invalid text/);
  assert.throws(() => argv(text("")), /invalid text/);
});

test("dictated text goes through stdin, flattened and trimmed", () => {
  const a = toArgv(typeText("  hello\nthere -k ctrl  "));
  assert.deepEqual(a, ["sh", "-c", "printf '%s' \"$1\" | wtype -", "vocon-type", "hello there -k ctrl"]);
  assert.throws(() => toArgv(typeText(" \n ")), /nothing to type/);
});

test("other actions are left alone", () => {
  assert.equal(toArgv({ type: "exec", argv: ["x"] }), null);
});

test("words slot takes the rest of the utterance", () => {
  const slot = wordsSlot();
  assert.deepEqual(slot.parse(["dev", "platform"], 0), [{ value: "dev platform", next: 2 }]);
  assert.deepEqual(slot.parse(["a", "b", "c"], 1), [{ value: "b c", next: 3 }]);
  assert.deepEqual(slot.parse(["a"], 1), []);
});
