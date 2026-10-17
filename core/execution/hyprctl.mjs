// Execution: anti-corruption layer for Hyprland (0.56+ takes Lua dispatchers).
// Translates action descriptors to argv arrays; nothing here touches a shell.
// Pure; ES2017-conservative.

function dispatch(luaExpression) {
  return ["hyprctl", "dispatch", luaExpression];
}

function assertWorkspace(workspace) {
  if (!Number.isInteger(workspace) || workspace < 1) {
    throw new Error("invalid workspace: " + workspace);
  }
  return String(workspace);
}

function assertAddress(address) {
  if (!/^0x[0-9a-f]+$/.test(String(address))) throw new Error("invalid window address: " + address);
  return address;
}

var DIRECTIONS = { left: "l", right: "r", up: "u", down: "d" };

function assertDirection(direction) {
  if (!Object.prototype.hasOwnProperty.call(DIRECTIONS, direction)) throw new Error("invalid direction: " + direction);
  return DIRECTIONS[direction];
}

// Returns argv for a Hyprland action, or null when the action isn't a Hyprland one.
export function toArgv(action) {
  switch (action.type) {
    case "hypr.focusWorkspace":
      return dispatch('hl.dsp.focus({ workspace = "' + assertWorkspace(action.workspace) + '" })');
    case "hypr.moveWindowToWorkspace":
      return dispatch(
        'hl.dsp.window.move({ workspace = "' + assertWorkspace(action.workspace) + '"' +
          (action.follow === false ? ", follow = false" : "") + " })"
      );
    case "hypr.swapWindow":
      return dispatch('hl.dsp.window.swap({ direction = "' + assertDirection(action.direction) + '" })');
    case "hypr.focusWindow":
      return dispatch('hl.dsp.focus({ window = "address:' + assertAddress(action.address) + '" })');
    default:
      return null;
  }
}
