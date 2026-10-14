// Interpretation: how well a heard token stands in for a command word. Pure; ES2017-conservative.
//
//   exact                          score 1
//   listed in options.aliases[w]   score ALIAS_SCORE   (mishearings, from config)
//   similarity >= options.threshold (both words >= MIN_FUZZY_LENGTH chars)   score = similarity
// options = config.matching: { threshold, aliases }. Score 0 = not this word.

import { similarity } from "./similarity.mjs";

var ALIAS_SCORE = 0.9;
var MIN_FUZZY_LENGTH = 4;

export var EXACT = { threshold: 1, aliases: {} };

export function tokenScore(words, token, options) {
  var opts = options || EXACT;
  var aliases = opts.aliases || {};
  var best = 0;
  words.forEach(function (word) {
    var score = 0;
    if (word === token) score = 1;
    else if (aliases[word] && aliases[word].indexOf(token) !== -1) score = ALIAS_SCORE;
    else if (word.length >= MIN_FUZZY_LENGTH && token.length >= MIN_FUZZY_LENGTH) {
      var sim = similarity(word, token);
      if (sim >= opts.threshold) score = sim;
    }
    if (score > best) best = score;
  });
  return best;
}
