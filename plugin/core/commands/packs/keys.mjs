// Commands: arrow keys, in whatever window is focused. Pure; ES2017-conservative.
//
//   up | down | left | right            press the arrow once
//   down three | down 3                  press it that many times (1 to packs.keys.maxCount)
//
// Not tied to an app, so these work everywhere; app packs add their own scoped commands.

import { keysAction } from "../../execution/actions.mjs";
import { key } from "../../execution/keys.mjs";
import { numberSlot } from "../../interpretation/slots.mjs";
import { command, value } from "../dsl.mjs";

var ARROWS = { up: "Up", down: "Down", left: "Left", right: "Right" };
var HARD_MAX = 100;   // whatever the config says, a mishearing can't hold a key down for long

function options(config) {
  var o = Object.assign({ maxCount: 20 }, (config.packs && config.packs.keys) || {});
  var max = Number.isInteger(o.maxCount) && o.maxCount >= 1 ? o.maxCount : 20;
  return { maxCount: Math.min(max, HARD_MAX) };
}

function presses(name, count) {
  var steps = [];
  for (var i = 0; i < count; i++) steps.push(key(name));
  return [keysAction(steps)];
}

export var keysPack = {
  id: "keys",

  slotTypes: function (config) {
    return { count: numberSlot(options(config).maxCount, "number of presses") };
  },

  commands: function () {
    return Object.keys(ARROWS).map(function (word) {
      return command(word, { run: function () { return presses(ARROWS[word], 1); } }, [
        value("count", "count", { run: function (args) { return presses(ARROWS[word], args.count); } }),
      ]);
    });
  },
};
