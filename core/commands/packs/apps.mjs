// Commands: built-in apps pack. Pure; ES2017-conservative.
//
//   open <app>    focus the app's window if one is open, otherwise launch it
//   focus <app>   focus the app's window; say so if it isn't running
//
// <app> is a catalog entry (config.apps) spoken by name or alias.

import { focusWindow, launch, notify } from "../../execution/actions.mjs";
import { findWindow } from "../../execution/windows.mjs";
import { normalize } from "../../interpretation/utterance.mjs";
import { appSlot } from "../../interpretation/slots.mjs";
import { command, value } from "../dsl.mjs";

// Spoken forms of each entry (its name and aliases) as token lists.
function catalog(config) {
  var out = {};
  Object.keys(config.apps || {}).forEach(function (key) {
    var forms = [key].concat(config.apps[key].aliases || []).map(normalize);
    out[key] = { words: forms.filter(function (tokens) { return tokens.length > 0; }) };
  });
  return out;
}

export var appsPack = {
  id: "apps",
  help: { title: "Apps", words: ["applications"], groups: ["core"] },

  slotTypes: function (config) {
    return { app: appSlot(catalog(config), config.matching) };
  },

  commands: function (config) {
    function window(args, ctx) {
      return findWindow(ctx.clients, config.apps[args.app].match);
    }

    return [
      command("open", { words: ["launch", "start"] }, [
        value("app", "app", {
          run: function (args, ctx) {
            var found = window(args, ctx);
            return [found ? focusWindow(found.address) : launch(config.apps[args.app].launch)];
          },
        }),
      ]),

      command("focus", {}, [
        value("app", "app", {
          run: function (args, ctx) {
            var found = window(args, ctx);
            return [found ? focusWindow(found.address) : notify(args.app + " isn't running", "Say “open " + args.app + "” to start it", "low")];
          },
        }),
      ]),
    ];
  },
};
