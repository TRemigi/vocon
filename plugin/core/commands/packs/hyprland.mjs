// Commands: built-in Hyprland pack (workspace focus / move). Pure; ES2017-conservative.

import { focusWorkspace } from "../../execution/actions.mjs";
import { workspaceSlot } from "../../interpretation/slots.mjs";

function options(config) {
  return Object.assign({ workspaces: 10 }, (config.packs && config.packs.hyprland) || {});
}

export var hyprlandPack = {
  id: "hyprland",

  slotTypes: function (config) {
    return { workspace: workspaceSlot(options(config).workspaces) };
  },

  commands: function (config) {
    return [
      {
        id: "hyprland.focusWorkspace",
        phrases: [
          "space {n:workspace}",
          "workspace {n:workspace}",
          "go|switch [to] space|workspace {n:workspace}",
        ],
        toActions: function (slots) {
          return [focusWorkspace(slots.n)];
        },
      },
    ];
  },
};
