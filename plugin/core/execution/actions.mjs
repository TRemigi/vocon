// Execution: action descriptors. Commands emit these; the shell interprets them.
// Constructors keep the shape in one place. Pure; ES2017-conservative.

export function focusWorkspace(workspace) {
  return { type: "hypr.focusWorkspace", workspace: workspace };
}

export function moveWindowToWorkspace(workspace, follow) {
  return { type: "hypr.moveWindowToWorkspace", workspace: workspace, follow: follow !== false };
}

export function focusWindow(address) {
  return { type: "hypr.focusWindow", address: address };
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
