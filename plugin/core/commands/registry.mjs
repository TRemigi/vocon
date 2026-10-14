// Commands: assemble the active commands and slot types from packs + config.
// A pack is { id, commands(config), slotTypes?(config) }; it is active unless
// config.packs[id].enabled === false. Pure; ES2017-conservative.

function isEnabled(pack, config) {
  var settings = config.packs && config.packs[pack.id];
  return !(settings && settings.enabled === false);
}

export function buildRegistry(packs, config) {
  var active = packs.filter(function (pack) { return isEnabled(pack, config); });
  var commands = [];
  var slotTypes = {};
  active.forEach(function (pack) {
    commands = commands.concat(pack.commands(config));
    if (pack.slotTypes) Object.assign(slotTypes, pack.slotTypes(config));
  });
  return { commands: commands, slotTypes: slotTypes };
}
