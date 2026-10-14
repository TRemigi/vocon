// Interpretation: phrase templates and the matcher that runs them over tokens.
//
// Template syntax (space separated):
//   word          literal token
//   a|b           one of several literal tokens
//   [word]        optional literal;  [a|b] optional alternatives
//   {name:type}   slot, resolved by slotTypes[type]
//
// A slot type is { parse(tokens, index) -> [{ value, next }] } returning every way the
// slot could consume tokens starting at `index` (`next` is the index after the slot).
// Pure; ES2017-conservative.

function splitAlternatives(text) {
  return text.split("|").filter(function (s) { return s !== ""; });
}

export function compile(template) {
  return String(template)
    .trim()
    .split(/\s+/)
    .map(function (part) {
      var slot = /^\{([a-zA-Z_][a-zA-Z0-9_]*):([a-zA-Z_][a-zA-Z0-9_]*)\}$/.exec(part);
      if (slot) return { kind: "slot", name: slot[1], type: slot[2] };
      var optional = /^\[(.+)\]$/.exec(part);
      if (optional) return { kind: "optional", options: splitAlternatives(optional[1]) };
      return { kind: "literal", options: splitAlternatives(part) };
    });
}

// Every full match of `elements` against `tokens`, as slot bindings: [{ slots: { name: value } }]
export function matchAll(elements, tokens, slotTypes) {
  var results = [];

  function step(ei, ti, slots) {
    if (ei === elements.length) {
      if (ti === tokens.length) results.push({ slots: slots });
      return;
    }
    var el = elements[ei];
    if (el.kind === "literal") {
      if (ti < tokens.length && el.options.indexOf(tokens[ti]) !== -1) step(ei + 1, ti + 1, slots);
    } else if (el.kind === "optional") {
      if (ti < tokens.length && el.options.indexOf(tokens[ti]) !== -1) step(ei + 1, ti + 1, slots);
      step(ei + 1, ti, slots);
    } else {
      var type = slotTypes[el.type];
      if (!type) return;
      type.parse(tokens, ti).forEach(function (candidate) {
        var next = Object.assign({}, slots);
        next[el.name] = candidate.value;
        step(ei + 1, candidate.next, next);
      });
    }
  }

  step(0, 0, {});
  return results;
}
