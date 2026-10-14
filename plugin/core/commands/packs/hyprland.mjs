// Commands: built-in Hyprland pack. Pure; ES2017-conservative.
//
//   space <n>                    focus workspace n
//   move focused space <n>       move the focused window to workspace n
//
// Future arguments slot in as sibling nodes, e.g. `move all space <n>`, `move focused group <name>`.

import { focusWorkspace, moveWindowToWorkspace } from "../../execution/actions.mjs";
import { workspaceSlot } from "../../interpretation/slots.mjs";
import { command, keyword, value } from "../dsl.mjs";

function options(config) {
  // moveFollows: whether "move" also switches to the destination (Omarchy's SUPER+SHIFT+N does).
  return Object.assign({ workspaces: 10, moveFollows: true }, (config.packs && config.packs.hyprland) || {});
}

export var hyprlandPack = {
  id: "hyprland",

  slotTypes: function (config) {
    return { workspace: workspaceSlot(options(config).workspaces) };
  },

  commands: function (config) {
    return [
      command("space", { words: ["workspace"] }, [
        value("n", "workspace", {
          run: function (args) { return [focusWorkspace(args.n)]; },
        }),
      ]),

      command("move", {}, [
        keyword("focused", { words: ["focus", "current"] }, [
          keyword("space", { words: ["workspace"] }, [
            value("n", "workspace", {
              run: function (args) { return [moveWindowToWorkspace(args.n, options(config).moveFollows)]; },
            }),
          ]),
        ]),
      ]),
    ];
  },
};
