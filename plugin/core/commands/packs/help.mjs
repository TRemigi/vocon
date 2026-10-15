// Commands: help. Opens a filterable menu of what can be said. Pure; ES2017-conservative.
//
//   help              every command
//   help <topic>      one pack's commands: slack, claude, keys, ... or `core` for the built-in ones
//
// A pack becomes a topic by being active and having commands; it can add `help: { title, words, groups }`
// (display name, extra spoken names, extra topics it belongs to). The rows come from the merged
// command tree (`ctx.registry`), so the menu can't drift from what the parser accepts.
// `help <topic>` is built from the pack list it is given, so a new pack needs no change here.

import { helpShow } from "../../execution/actions.mjs";
import { activePacks } from "../registry.mjs";
import { describe, rows, topicEntries } from "../listing.mjs";
import { command, keyword } from "../dsl.mjs";

function helpOf(pack) {
  return Object.assign({ title: pack.id, words: [], groups: [] }, pack.help || {});
}

// [{ name, title, words }]: one per active pack that has commands, then one per group they name.
function topicsOf(packs, config, self) {
  var out = [];
  var groups = [];
  activePacks(packs, config).forEach(function (pack) {
    if (pack === self || pack.commands(config).length === 0) return;
    var h = helpOf(pack);
    out.push({ name: pack.id, title: h.title, words: h.words });
    h.groups.forEach(function (g) { if (groups.indexOf(g) === -1) groups.push(g); });
  });
  return out.concat(groups.map(function (g) { return { name: g, title: g === "core" ? "Core commands" : g, words: [] }; }));
}

function titlesOf(packs) {
  var titles = {};
  packs.forEach(function (pack) { titles[pack.id] = helpOf(pack).title; });
  return titles;
}

export function makeHelpPack(packs) {
  var self = {
    id: "help",
    help: { title: "Help", groups: ["core"] },

    commands: function (config) {
      var topics = topicsOf(packs, config, self);
      var names = topics.map(function (t) { return t.name; });

      function show(topic, title) {
        return function (args, ctx) {
          // `help <topic>` lists a topic's commands; the topic words themselves are not commands.
          var entries = topicEntries(describe(ctx.registry), topic).filter(function (e) {
            return !(e.pack === "help" && e.segments.length > 1);
          });
          return [helpShow(title, rows(entries, titlesOf(packs)), names)];
        };
      }

      return [
        command("help", { run: show(null, "Commands") }, topics.map(function (t) {
          return keyword(t.name, { words: t.words, run: show(t.name, t.title) });
        })),
      ];
    },
  };
  return self;
}
