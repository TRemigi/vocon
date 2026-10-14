// Application: transcript -> outcome + actions. The single pure entry point the shell
// (and the tests) use to interpret an utterance. ES2017-conservative.

import { normalize } from "./interpretation/utterance.mjs";
import { parse } from "./interpretation/parser.mjs";
import { buildRegistry } from "./commands/registry.mjs";
import { builtinPacks } from "./commands/packs/index.mjs";

// Problems in the assembled command tree (pack conflicts etc.); [] when healthy.
export function registryErrors(config, packs) {
  return buildRegistry(packs || builtinPacks, config).errors;
}

// ctx: { clients: [...], ... } read-only facts about the desktop at release time.
// outcome.kind: "empty" | "matched" | "incomplete" | "nomatch" | "ambiguous"
// (see interpretation/parser.mjs); matched outcomes carry commandId ("move focused space"),
// args and score.
export function interpret(config, ctx, transcript, packs) {
  var tokens = normalize(transcript);
  if (tokens.length === 0) return { outcome: { kind: "empty" }, actions: [] };

  var registry = buildRegistry(packs || builtinPacks, config);
  var result = parse(registry.roots, registry.slotTypes, tokens, ctx, config.matching);
  if (result.kind !== "matched") {
    return { outcome: Object.assign({ tokens: tokens }, result), actions: [] };
  }
  return {
    outcome: { kind: "matched", commandId: result.path.join(" "), path: result.path, args: result.args, score: result.score },
    actions: result.node.run(result.args, ctx, result.path),
  };
}
