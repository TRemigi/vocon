// Commands: a readable list of everything that can currently be said. Pure; ES2017-conservative.
//
//   describe(registry)                -> [{ segments, scope, pack, topics }]   one entry per runnable path
//   render(entries, { synonyms })     -> string[]                lines for a terminal
//   topicEntries(entries, topic)      -> entries                 the ones a help topic covers (null = all)
//   rows(entries, titles)             -> [{ phrase, search, topic, scope, hint }]   for the help menu
//   filterRows(rows, query)           -> rows                    every word of the query must appear
//
// A segment is { words } for a keyword or { arg, hint } for a typed argument. `scope` is null for
// commands that work anywhere, else the guarded node's `scope` text (or a generic fallback).
// `pack` is the pack that defined the command; `topics` are the help topics that cover it.

function segment(node, slotTypes) {
  if (node.kind === "value") {
    var slot = slotTypes[node.type];
    return { arg: node.name, hint: slot && slot.hint ? slot.hint : null };
  }
  return { words: node.words };
}

export function describe(registry) {
  var entries = [];
  function walk(nodes, trail, scope) {
    nodes.forEach(function (node) {
      var here = trail.concat([segment(node, registry.slotTypes)]);
      var inScope = scope || (node.when ? node.scope || "only in some contexts" : null);
      if (node.run) entries.push({ segments: here, scope: inScope, pack: node.pack, topics: node.topics || [] });
      walk(node.children, here, inScope);
    });
  }
  walk(registry.roots, [], null);
  return entries;
}

function phrase(entry, synonyms) {
  return entry.segments.map(function (s) {
    if (s.arg) return "<" + s.arg + ">";
    return synonyms ? s.words.join("|") : s.words[0];
  }).join(" ");
}

function hints(entries) {
  var seen = {};
  var out = [];
  entries.forEach(function (entry) {
    entry.segments.forEach(function (s) {
      var key = s.arg + "\u0000" + s.hint;
      if (s.arg && s.hint && !seen[key]) { seen[key] = true; out.push({ name: "<" + s.arg + ">", hint: s.hint }); }
    });
  });
  var width = out.reduce(function (w, h) { return Math.max(w, h.name.length); }, 0);
  return out.map(function (h) { return h.name + new Array(width - h.name.length + 3).join(" ") + h.hint; });
}

// Commands that work anywhere come first, then one group per scope in the order first seen.
export function render(entries, options) {
  var synonyms = !!(options && options.synonyms);
  var scopes = [null];
  entries.forEach(function (e) { if (scopes.indexOf(e.scope) === -1) scopes.push(e.scope); });

  var lines = [];
  scopes.forEach(function (scope) {
    var group = entries.filter(function (e) { return e.scope === scope; });
    if (group.length === 0) return;
    if (lines.length) lines.push("");
    lines.push(scope ? "Only " + scope + ":" : "Available anywhere:");
    group.forEach(function (e) { lines.push("  " + phrase(e, synonyms)); });
  });

  var argLines = hints(entries);
  if (argLines.length) {
    lines = lines.concat(["", "Arguments:"], argLines.map(function (l) { return "  " + l; }));
  }
  return lines;
}

// The entries a help topic covers; no topic means everything.
export function topicEntries(entries, topic) {
  if (!topic) return entries;
  return entries.filter(function (e) { return e.topics.indexOf(topic) !== -1; });
}

// One row per entry for the help menu. `search` is what the filter looks at: every spelling of the
// command, its topic and its scope. `hint` explains the arguments ("<n>: workspace number, 1-10").
// `titles` maps a pack id to the name shown for it.
export function rows(entries, titles) {
  return entries.map(function (entry) {
    var topic = (titles && titles[entry.pack]) || entry.pack || "";
    var hint = entry.segments.filter(function (s) { return s.arg && s.hint; })
      .map(function (s) { return "<" + s.arg + ">: " + s.hint; }).join("; ");
    return {
      phrase: phrase(entry, false),
      search: [phrase(entry, true).replace(/\|/g, " "), topic, entry.scope || ""].join(" ").toLowerCase(),
      topic: topic,
      scope: entry.scope,
      hint: hint,
    };
  });
}

// Keeps the rows whose `search` text contains every word of the query (any order, any case).
export function filterRows(list, query) {
  var terms = String(query || "").toLowerCase().split(/\s+/).filter(function (t) { return t !== ""; });
  if (terms.length === 0) return list;
  return list.filter(function (row) {
    return terms.every(function (t) { return row.search.indexOf(t) !== -1; });
  });
}
