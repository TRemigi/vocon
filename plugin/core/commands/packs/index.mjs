// Commands: the built-in packs. Adding a pack = import it here.

import { hyprlandPack } from "./hyprland.mjs";
import { appsPack } from "./apps.mjs";
import { slackPack } from "./slack.mjs";
import { claudePack } from "./claude.mjs";
import { keysPack } from "./keys.mjs";
import { dictationPack } from "./dictation.mjs";
import { customPack } from "./custom.mjs";
import { makeHelpPack } from "./help.mjs";

var commandPacks = [hyprlandPack, appsPack, keysPack, slackPack, claudePack, dictationPack, customPack];

// `help` lists the other packs as topics, so it is built from them.
export var builtinPacks = commandPacks.concat([makeHelpPack(commandPacks)]);
