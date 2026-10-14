// Commands: user-defined commands from config.commands. Pure; ES2017-conservative.
//
//   { "say": "lock screen", "exec": ["omarchy-system-lock"] }
//
// Each `say` becomes a chain of keyword nodes (lock -> screen) in the same tree as the built-ins,
// so it merges with them: "move all" next to the built-in `move`, or a keyword that wins over a
// value argument ("open notes" beats "open <app>"). `when.activeClass` hides the whole chain unless
// that app is focused. Argv comes from config only; speech just selects the chain.

import { exec, launch } from "../../execution/actions.mjs";
import { classMatches } from "../../execution/windows.mjs";
import { keyword } from "../dsl.mjs";

function chain(entry) {
  var words = entry.say.split(" ");
  var action = entry.type === "launch" ? launch(entry.argv) : exec(entry.argv);
  var node = keyword(words[words.length - 1], { run: function () { return [action]; } });
  for (var i = words.length - 2; i >= 0; i--) node = keyword(words[i], {}, [node]);
  if (entry.activeClass) {
    node = Object.assign({}, node, {
      when: function (ctx) { return classMatches(ctx.active, entry.activeClass); },
      scope: "while a window matching /" + entry.activeClass + "/ is focused",
    });
  }
  return node;
}

export var customPack = {
  id: "custom",

  commands: function (config) {
    return (config.commands || []).map(chain);
  },
};
