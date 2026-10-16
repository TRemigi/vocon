// Commands: built-in Hyprland pack. Pure; ES2017-conservative.
//
//   space <n>                    focus workspace n
//   move space <n>               move the focused window to workspace n
//   move left|right|up|down      swap the focused window with its neighbour in that direction
//
// `move` always acts on the focused window. Future arguments slot in as sibling nodes,
// e.g. `move all space <n>`, `move group <name>`.

import { focusWorkspace, moveWindowToWorkspace, swapWindow } from "../../execution/actions.mjs";
import { workspaceSlot } from "../../interpretation/slots.mjs";
import { command, keyword, value } from "../dsl.mjs";

function options(config) {
  // moveFollows: whether "move" also switches to the destination (Omarchy's SUPER+SHIFT+N does).
  return Object.assign({ workspaces: 10, moveFollows: true }, (config.packs && config.packs.hyprland) || {});
}

export var hyprlandPack = {
  id: "hyprland",
  help: { title: "Workspaces", words: ["hyperland", "workspaces", "windows"], groups: ["core"] },

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
        keyword("space", { words: ["workspace"] }, [
          value("n", "workspace", {
            run: function (args) { return [moveWindowToWorkspace(args.n, options(config).moveFollows)]; },
          }),
        ]),
      ].concat(["left", "right", "up", "down"].map(function (direction) {
        return keyword(direction, { run: function () { return [swapWindow(direction)]; } });
      }))),
    ];
  },
};
