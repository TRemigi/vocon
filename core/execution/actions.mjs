// Execution: action descriptors. Commands emit these; the shell interprets them.
// Constructors keep the shape in one place. Pure; ES2017-conservative.

export function focusWorkspace(workspace) {
  return { type: "hypr.focusWorkspace", workspace: workspace };
}

export function moveWindowToWorkspace(workspace, follow) {
  return { type: "hypr.moveWindowToWorkspace", workspace: workspace, follow: follow !== false };
}

// direction: "left" | "right" | "up" | "down"; swaps the focused window with its neighbour.
export function swapWindow(direction) {
  return { type: "hypr.swapWindow", direction: direction };
}

export function focusWindow(address) {
  return { type: "hypr.focusWindow", address: address };
}

// Move one specific window to a workspace and stay where you are (`follow = false`). Unlike
// moveWindowToWorkspace this does not act on the focused window. The address comes from the
// hyprctl snapshot, never from speech or from a model.
export function moveWindow(address, workspace) {
  return { type: "hypr.moveWindow", address: address, workspace: workspace };
}

// Never built from speech text: argv comes from the app catalog or user config only.
export function exec(argv) {
  return { type: "exec", argv: argv };
}

export function notify(title, body, urgency) {
  return { type: "notify", title: title, body: body || "", urgency: urgency || "normal" };
}

// Start an app. argv comes from the app catalog (config), never from speech.
export function launch(argv) {
  return { type: "app.launch", argv: argv };
}

// Keyboard input to the focused window; see execution/keys.mjs for the steps.
export function keysAction(steps) {
  return { type: "keys.send", steps: steps };
}

// Type arbitrary (dictated) text into the focused window.
export function typeText(text) {
  return { type: "text.type", text: text };
}

// Open the filterable command menu. `rows` come from commands/listing.mjs (grammar and config
// text only, never speech); `topics` are the names `help <topic>` accepts.
export function helpShow(title, rows, topics) {
  return { type: "help.show", title: title, rows: rows, topics: topics };
}

// Queue what was said as a braindump note. `argv` is the configured braindump command (config only);
// `text` is the one speech-derived part, sent on stdin. `private` keeps it out of toasts and logs.
export function noteCapture(argv, text) {
  return { type: "note.capture", argv: argv, text: text, private: true };
}

// Ask braindump what is queued and filed. `argv` is the configured command and flags (config only).
export function noteStatus(argv) {
  return { type: "note.status", argv: argv };
}
