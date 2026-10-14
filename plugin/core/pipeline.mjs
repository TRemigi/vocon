// Application: transcript -> outcome + actions. The single pure entry point the shell
// (and the tests) use to interpret an utterance. ES2017-conservative.

import { normalize } from "./interpretation/utterance.mjs";
import { match } from "./interpretation/matcher.mjs";
import { buildRegistry } from "./commands/registry.mjs";
import { builtinPacks } from "./commands/packs/index.mjs";

// ctx: { clients: [...], ... } read-only facts about the desktop at release time.
// outcome.kind: "empty" | "nomatch" | "ambiguous" | "matched"
export function interpret(config, ctx, transcript, packs) {
  var tokens = normalize(transcript);
  if (tokens.length === 0) return { outcome: { kind: "empty" }, actions: [] };

  var registry = buildRegistry(packs || builtinPacks, config);
  var result = match(registry.commands, registry.slotTypes, tokens, ctx);
  if (result.kind !== "matched") {
    return { outcome: Object.assign({ tokens: tokens }, result), actions: [] };
  }
  return {
    outcome: { kind: "matched", commandId: result.command.id, slots: result.slots },
    actions: result.command.toActions(result.slots, ctx),
  };
}
