// Commands: small constructors for the command tree, so packs read like the CLI they define.
//
//   command("move", { words: ["send"] }, [
//     keyword("focused", {}, [
//       keyword("space", { words: ["workspace"] }, [
//         value("n", "workspace", { run: function (args) { return [...]; } }) ]) ]) ])
//
// opts: words (extra accepted spellings), run(args, ctx, path) -> Action[], when(ctx) -> bool.
// Pure; ES2017-conservative.

export function keyword(name, opts, children) {
  var o = opts || {};
  return {
    kind: "keyword",
    name: name,
    words: [name].concat(o.words || []),
    children: children || [],
    run: o.run,
    when: o.when,
  };
}

// A top-level keyword.
export var command = keyword;

// A typed argument: `type` names a slot type (e.g. "workspace") provided by a pack.
export function value(name, type, opts, children) {
  var o = opts || {};
  return { kind: "value", name: name, type: type, words: [], children: children || [], run: o.run, when: o.when };
}
