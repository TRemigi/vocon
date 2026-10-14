// Interpretation: pick the command an utterance refers to. Pure; ES2017-conservative.
//
// result: { kind: "matched", command, slots }
//       | { kind: "ambiguous", candidates: [commandId] }
//       | { kind: "nomatch" }
//
// `commands` are CommandDefinitions: { id, phrases: [template], when?(ctx), ... }.

import { compile, matchAll } from "./grammar.mjs";

export function findMatches(commands, slotTypes, tokens, ctx) {
  var found = [];
  commands.forEach(function (command) {
    if (command.when && !command.when(ctx)) return;
    command.phrases.forEach(function (phrase) {
      matchAll(compile(phrase), tokens, slotTypes).forEach(function (m) {
        found.push({ command: command, slots: m.slots });
      });
    });
  });
  return found;
}

// The same command matched through several phrases with the same slots is one match.
function dedupe(matches) {
  var seen = {};
  return matches.filter(function (m) {
    var key = m.command.id + JSON.stringify(m.slots);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

export function match(commands, slotTypes, tokens, ctx) {
  var matches = dedupe(findMatches(commands, slotTypes, tokens, ctx));
  if (matches.length === 0) return { kind: "nomatch" };
  if (matches.length > 1) {
    return { kind: "ambiguous", candidates: matches.map(function (m) { return m.command.id; }) };
  }
  return { kind: "matched", command: matches[0].command, slots: matches[0].slots };
}
