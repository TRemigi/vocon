import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChoice } from "../core/assistant/choice.mjs";

const choice = (n) => ({ kind: "choice", number: n });
const CANCEL = { kind: "cancel" };
const UNCLEAR = { kind: "unclear" };

test("parseChoice: numbers, number words and ordinals, as Whisper tends to write them", () => {
  const table = [
    ["two", 3, choice(2)], ["Two.", 3, choice(2)], ["2", 3, choice(2)], ["number three", 3, choice(3)],
    ["the second one", 3, choice(2)], ["first", 3, choice(1)], ["the third", 4, choice(3)], ["sixth", 6, choice(6)],
    ["the one on the left, number 1", 3, choice(1)],
    ["send it to the first one", 3, choice(1)],     // "to" is not read as 2 in a longer answer
  ];
  for (const [said, count, want] of table) assert.deepEqual(parseChoice(said, count), want, said);
});

test("parseChoice: mishearings of numbers are trusted only in a very short answer", () => {
  assert.deepEqual(parseChoice("to", 3), choice(2));
  assert.deepEqual(parseChoice("too", 3), choice(2));
  assert.deepEqual(parseChoice("for", 4), choice(4));
  assert.deepEqual(parseChoice("won", 3), choice(1));
  assert.deepEqual(parseChoice("I want to go for the window", 4), UNCLEAR);
});

test("parseChoice: cancelling is understood, and wins over a number", () => {
  for (const said of ["cancel", "Cancel.", "never mind", "nevermind", "forget it", "neither", "none of them", "stop", "cancel number two"]) {
    assert.deepEqual(parseChoice(said, 3), CANCEL, said);
  }
});

test("parseChoice: anything that does not name exactly one valid choice is unclear", () => {
  for (const said of ["", "   ", "thank you", "um", "one or two", "first and second", "seven", "0", "number 9", "the window with the database"]) {
    assert.deepEqual(parseChoice(said, 3), UNCLEAR, JSON.stringify(said));
  }
  assert.deepEqual(parseChoice("one one", 3), choice(1));            // the same number twice is still one choice
  assert.deepEqual(parseChoice(undefined, 3), UNCLEAR);
  assert.deepEqual(parseChoice(null, 3), UNCLEAR);
});
