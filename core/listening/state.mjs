// Listening: small helpers shared by the command session (session.mjs) and the assistant's
// (assistant/session.mjs). Pure; ES2017-conservative.

export function log(message) {
  return { type: "log", message: message };
}

export function result(state, effects) {
  return { state: state, effects: effects || [] };
}

// Back to rest. `mode` returns to "command" and any assistant request in flight is forgotten
// (`reduce` adds the effects that cancel what that request had started).
export function idle(state) {
  return Object.assign({}, state, { phase: "idle", mode: "command", transcript: null, clients: null, unlocked: false, pending: null });
}
