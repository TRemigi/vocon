// Commands: assemble the active command tree and slot types from packs + config.
//
// A pack is { id, commands(config) -> [root nodes], slotTypes?(config) }; it is active unless
// config.packs[id].enabled === false. Root nodes from different packs that share a name merge
// recursively, which is how a pack extends another's command (e.g. adds `move all ...`).
//
// buildRegistry -> { roots, slotTypes, errors }. Errors are conflicts the registry resolved by
// keeping the first definition: duplicate `run` on one node, sibling words that collide, several
// value children under one node, dead-end nodes. Pure; ES2017-conservative.

function isEnabled(pack, config) {
  var settings = config.packs && config.packs[pack.id];
  return !(settings && settings.enabled === false);
}

function sameNode(a, b) {
  return a.kind === b.kind && a.name === b.name && !a.when && !b.when &&
    (a.kind === "keyword" || a.type === b.type);
}

function union(a, b) {
  return a.concat(b.filter(function (x) { return a.indexOf(x) === -1; }));
}

function mergeNode(a, b, path, errors) {
  if (a.run && b.run) errors.push("conflict: " + path.join(" ") + " is defined twice");
  return Object.assign({}, a, {
    words: union(a.words, b.words),
    run: a.run || b.run,
    children: mergeList(a.children, b.children, path, errors),
  });
}

function mergeList(existing, incoming, path, errors) {
  var out = existing.slice();
  incoming.forEach(function (node) {
    var at = -1;
    out.forEach(function (candidate, index) { if (at === -1 && sameNode(candidate, node)) at = index; });
    var here = path.concat([node.kind === "value" ? "<" + node.type + ">" : node.name]);
    if (at === -1) out.push(node);
    else out[at] = mergeNode(out[at], node, here, errors);
  });
  return out;
}

// Structural checks on a merged tree; returns messages, never throws.
export function validate(nodes, path) {
  var errors = [];
  var prefix = path || [];
  var values = nodes.filter(function (n) { return n.kind === "value"; });
  if (values.length > 1) errors.push("conflict: more than one value argument after " + (prefix.join(" ") || "the root"));

  var seen = {};
  nodes.forEach(function (n) {
    if (n.when) return;
    n.words.forEach(function (w) {
      if (seen[w] && seen[w] !== n) errors.push("conflict: '" + w + "' means both '" + seen[w].name + "' and '" + n.name + "' after " + (prefix.join(" ") || "the root"));
      else seen[w] = n;
    });
  });

  nodes.forEach(function (n) {
    var here = prefix.concat([n.kind === "value" ? "<" + n.type + ">" : n.name]);
    if (!n.run && n.children.length === 0) errors.push("dead end: " + here.join(" ") + " has no run and no arguments");
    errors = errors.concat(validate(n.children, here));
  });
  return errors;
}

export function buildRegistry(packs, config) {
  var active = packs.filter(function (pack) { return isEnabled(pack, config); });
  var errors = [];
  var roots = [];
  var slotTypes = {};
  active.forEach(function (pack) {
    roots = mergeList(roots, pack.commands(config), [], errors);
    if (pack.slotTypes) Object.assign(slotTypes, pack.slotTypes(config));
  });
  return { roots: roots, slotTypes: slotTypes, errors: errors.concat(validate(roots)) };
}
