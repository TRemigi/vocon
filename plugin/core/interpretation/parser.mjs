// Interpretation: parse tokens against the command tree, CLI-style. Pure; ES2017-conservative.
//
//   move focused space 1      ->  path [move, focused, space], args { n: 1 }
//
// The tree is nodes { kind: "keyword"|"value", name, words, children, run?, when? }.
// Each token is resolved against the current node's children only: keyword children by word
// (exact > alias > fuzzy), else the value child via its slot type. No backtracking, no phrase
// scoring. A node with `run` is a valid end of a command.
//
// result: { kind: "matched", node, path, args, score }
//       | { kind: "incomplete", path, expected }          ran out of words
//       | { kind: "nomatch", path, at, token, expected }  a word isn't valid here
//       | { kind: "ambiguous", path, at, candidates }     two sibling words fit one token equally
// `expected` lists what would be valid next: keyword names and "<type>" for values.

import { tokenScore, EXACT } from "./words.mjs";

// Sibling words closer in score than this are too close to call (only fuzzy matching can do this;
// the registry rejects identical sibling words).
var AMBIGUITY_MARGIN = 0.05;

export function describe(node) {
  return node.kind === "value" ? "<" + node.type + ">" : node.name;
}

function active(nodes, ctx) {
  return nodes.filter(function (n) { return !n.when || n.when(ctx); });
}

function expectedOf(nodes) {
  return nodes.map(describe);
}

// Resolve token i against sibling nodes: { kind: "ok", node, next, value? } | { kind: "ambiguous", candidates } | null
function resolve(siblings, slotTypes, tokens, i, opts) {
  var scored = siblings
    .filter(function (n) { return n.kind === "keyword"; })
    .map(function (n) { return { node: n, score: tokenScore(n.words, tokens[i], opts) }; })
    .filter(function (s) { return s.score > 0; })
    .sort(function (a, b) { return b.score - a.score; });

  if (scored.length > 0) {
    var close = scored.filter(function (s) { return scored[0].score - s.score < AMBIGUITY_MARGIN; });
    if (close.length > 1) return { kind: "ambiguous", candidates: close.map(function (s) { return s.node.name; }) };
    return { kind: "ok", node: scored[0].node, next: i + 1, score: scored[0].score };
  }

  var valueNode = siblings.filter(function (n) { return n.kind === "value"; })[0];
  var slot = valueNode && slotTypes[valueNode.type];
  var parses = slot ? slot.parse(tokens, i) : [];
  if (parses.length === 0) return null;
  return { kind: "ok", node: valueNode, next: parses[0].next, value: parses[0].value, score: 1, used: parses[0].next - i };
}

export function parse(roots, slotTypes, tokens, ctx, options) {
  var opts = options || EXACT;
  var siblings = active(roots, ctx);
  var path = [];
  var args = {};
  var node = null;
  var scoreSum = 0;
  var scoreCount = 0;
  var i = 0;

  while (i < tokens.length) {
    var step = resolve(siblings, slotTypes, tokens, i, opts);
    if (step === null) {
      return { kind: "nomatch", path: path, at: i, token: tokens[i], expected: expectedOf(siblings) };
    }
    if (step.kind === "ambiguous") {
      return { kind: "ambiguous", path: path, at: i, candidates: step.candidates };
    }
    node = step.node;
    if (node.kind === "value") args[node.name] = step.value;
    else path.push(node.name);
    var consumed = step.next - i;
    scoreSum += step.score * consumed;
    scoreCount += consumed;
    i = step.next;
    siblings = active(node.children || [], ctx);
  }

  if (node && node.run) {
    return { kind: "matched", node: node, path: path, args: args, score: scoreSum / scoreCount };
  }
  return { kind: "incomplete", path: path, expected: expectedOf(siblings) };
}
