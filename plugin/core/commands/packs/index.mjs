// Commands: the built-in packs. Adding a pack = import it here.

import { hyprlandPack } from "./hyprland.mjs";
import { appsPack } from "./apps.mjs";
import { customPack } from "./custom.mjs";

export var builtinPacks = [hyprlandPack, appsPack, customPack];
