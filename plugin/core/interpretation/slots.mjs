// Interpretation: slot types shared by command packs. Pure; ES2017-conservative.

import { tokenScore } from "./words.mjs";

var NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  // common mis-hearings, only trusted where a number is expected
  won: 1, to: 2, too: 2, tu: 2, for: 4, fore: 4, ate: 8,
};

export function parseNumberToken(token) {
  if (/^[0-9]+$/.test(token)) return parseInt(token, 10);
  return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token) ? NUMBER_WORDS[token] : null;
}

// A workspace number 1..max, spoken as a digit or a number word.
export function workspaceSlot(max) {
  return {
    parse: function (tokens, index) {
      if (index >= tokens.length) return [];
      var n = parseNumberToken(tokens[index]);
      if (n === null || n < 1 || n > max) return [];
      return [{ value: n, next: index + 1 }];
    },
  };
}

// An app from the catalog, spoken by name or alias. A name may be several words
// ("visual studio code"); candidates come back longest first so the longest name wins.
// `apps` is the normalised catalog: { key: { words: [[token...], ...] } } (one token list per
// accepted spoken form); `options` is config.matching (fuzzy + mishearing aliases).
export function appSlot(apps, options) {
  return {
    parse: function (tokens, index) {
      var found = [];
      Object.keys(apps).sort().forEach(function (key) {
        apps[key].words.forEach(function (form) {
          if (index + form.length > tokens.length) return;
          var total = 0;
          for (var k = 0; k < form.length; k++) {
            var s = tokenScore([form[k]], tokens[index + k], options);
            if (s === 0) return;
            total += s;
          }
          found.push({ value: key, next: index + form.length, score: total / form.length });
        });
      });
      return found.sort(function (a, b) {
        return (b.next - a.next) || (b.score - a.score);
      }).map(function (c) { return { value: c.value, next: c.next }; });
    },
  };
}
