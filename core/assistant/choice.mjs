// Assistant: the spoken answer to "which window?". Pure; ES2017-conservative.
//
//   parseChoice("the second one", 3) -> { kind: "choice", number: 2 }
//   parseChoice("never mind", 3)     -> { kind: "cancel" }
//   parseChoice("thank you", 3)      -> { kind: "unclear" }      (also: two different numbers, none, out of range)
//
// "cancel" wins over a number: cancelling is the harmless reading. Mishearings of numbers ("to", "for")
// are only trusted in a very short answer, so "send it to the first one" is not read as 2.

import { normalize } from "../interpretation/utterance.mjs";
import { parseNumberToken } from "../interpretation/slots.mjs";

var ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
var MISHEARD = { won: 1, to: 2, too: 2, tu: 2, for: 4, fore: 4, ate: 8 };
var CANCEL_WORDS = ["cancel", "stop", "neither", "none", "nevermind", "abort"];
var SHORT_ANSWER = 3;

function has(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key);
}

function wantsCancel(tokens) {
  if (tokens.some(function (t) { return CANCEL_WORDS.indexOf(t) !== -1; })) return true;
  for (var i = 0; i + 1 < tokens.length; i++) {
    if ((tokens[i] === "never" && tokens[i + 1] === "mind") || (tokens[i] === "forget" && tokens[i + 1] === "it")) return true;
  }
  return false;
}

export function parseChoice(transcript, count) {
  var tokens = normalize(transcript);
  if (wantsCancel(tokens)) return { kind: "cancel" };
  var found = [];
  tokens.forEach(function (t, i) {
    var n = null;
    // "the second one": that "one" is a pronoun, not the number 1
    if ((t === "one" || t === "ones") && i > 0 && has(ORDINALS, tokens[i - 1])) return;
    if (has(ORDINALS, t)) n = ORDINALS[t];
    else if (has(MISHEARD, t)) n = tokens.length <= SHORT_ANSWER ? MISHEARD[t] : null;
    else n = parseNumberToken(t);
    if (n !== null && n >= 1 && n <= count && found.indexOf(n) === -1) found.push(n);
  });
  return found.length === 1 ? { kind: "choice", number: found[0] } : { kind: "unclear" };
}
