// Commands: the built-in packs. Adding a pack = import it here.

import { hyprlandPack } from "./hyprland.mjs";
import { appsPack } from "./apps.mjs";
import { slackPack } from "./slack.mjs";
import { dictationPack } from "./dictation.mjs";
import { customPack } from "./custom.mjs";

export var builtinPacks = [hyprlandPack, appsPack, slackPack, dictationPack, customPack];
