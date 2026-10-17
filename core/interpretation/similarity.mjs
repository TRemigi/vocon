// Interpretation: string similarity for tolerant token matching. Pure; ES2017-conservative.

export function distance(a, b) {
  if (a === b) return 0;
  var prev = [];
  var i, j;
  for (j = 0; j <= b.length; j++) prev.push(j);
  for (i = 1; i <= a.length; i++) {
    var row = [i];
    for (j = 1; j <= b.length; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = row;
  }
  return prev[b.length];
}

// 1 = identical, 0 = nothing in common.
export function similarity(a, b) {
  var longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - distance(a, b) / longest;
}
