// Interpretation: slot types shared by command packs. Pure; ES2017-conservative.

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
