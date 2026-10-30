// Config: defaults, parsing and validation. Pure; ES2017-conservative.
// parse(text) -> { config, errors, ok }. Invalid parts fall back to defaults and are reported;
// ok is false only when the text couldn't be used at all (bad JSON, not an object), so callers
// can keep the last good config instead of resetting to defaults.

import { normalize } from "./interpretation/utterance.mjs";
import { isValidPattern } from "./execution/windows.mjs";
import { isLoopbackEndpoint } from "./assistant/ollama.mjs";

export var defaults = {
  pushToTalk: { key: "F10" },
  voxtype: { model: null, showOsd: true, maxSeconds: 15, transcribeTimeoutSeconds: 20 },
  // aliases: spoken word -> extra words the recogniser commonly produces for it.
  matching: { threshold: 0.8, aliases: { space: ["pace", "base", "spice"], move: ["moved", "moves"], claude: ["cloud", "clod"] } },
  feedback: { notifyOnNoMatch: true, notifyOnSuccess: false },
  packs: { hyprland: {}, apps: {}, keys: {}, slack: {}, claude: {}, braindump: {}, dictation: {}, custom: {}, help: {} },
  // `dictate` types your next utterance into the focused window. armSeconds: how long it stays
  // armed; maxSeconds: longest dictation; ignore: whole utterances never typed (Whisper often
  // invents these from silence).
  dictation: { armSeconds: 30, maxSeconds: 60, ignore: ["thank you for watching", "thanks for watching", "you"] },
  // Assistant mode (its own push-to-talk key): window requests understood by a LOCAL model (Ollama).
  //   endpoint   must be a loopback address (http://127.0.0.1:<port> or http://[::1]:<port>)
  //   think      "off" | "low" | "medium" | "high" (gpt-oss only takes low|medium|high; qwen3 wants off)
  //   unlockMinutes  how long a fingerprint unlock lasts after its last use
  //   maxWindows / maxTitleChars  how much of the window list the model is shown
  assistant: {
    enabled: false, endpoint: "http://127.0.0.1:11434", model: "gpt-oss:20b", keepAlive: "10m", think: "low",
    contextTokens: 4096, timeoutSeconds: 30, unlockMinutes: 10, maxWindows: 40, maxTitleChars: 80,
  },
  // Your own commands, each one a path in the same command tree as the built-ins:
  //   { "say": "lock screen", "exec": ["omarchy-system-lock"] }          run a command
  //   { "say": "notes", "launch": ["obsidian"] }                         start an app (uwsm-app)
  //   { ..., "when": { "activeClass": "^firefox$" } }                    only while that app is focused
  commands: [],
  // App catalog for `open <app>` / `focus <app>`. Key = spoken name.
  //   match    regex tested (word-bounded, case-insensitive) against the window class
  //   launch   argv started via `uwsm-app --` when no window matches
  //   aliases  other spoken names
  // Only `{}` is needed for a single-word app whose command and window class equal its name.
  apps: {
    terminal: { match: "com.mitchellh.ghostty|Alacritty|kitty|foot", launch: ["xdg-terminal-exec"], aliases: [] },
    browser: { match: "^(chromium|brave-browser|google-chrome|firefox|zen)$", launch: ["omarchy-launch-browser"], aliases: [] },
    files: { match: "^org.gnome.Nautilus$", launch: ["nautilus"], aliases: ["nautilus"] },
    spotify: { match: "^spotify$", launch: ["spotify"], aliases: [] },
    obsidian: { match: "^obsidian$", launch: ["obsidian"], aliases: [] },
  },
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeSection(base, override, errors, path) {
  var out = Object.assign({}, base);
  if (override === undefined) return out;
  if (!isObject(override)) {
    errors.push(path + " must be an object");
    return out;
  }
  Object.keys(override).forEach(function (key) {
    var sameType = typeof override[key] === typeof base[key] || base[key] === null || base[key] === undefined;
    if (isObject(base[key])) out[key] = mergeSection(base[key], override[key], errors, path + "." + key);
    else if (sameType) out[key] = override[key];
    else errors.push(path + "." + key + " must be a " + typeof base[key]);
  });
  return out;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWords(list) {
  return Array.isArray(list) && list.every(function (w) { return typeof w === "string" && w.trim() !== ""; });
}

// User entries override defaults field by field; `null` removes an app.
function mergeApps(base, raw, errors) {
  var out = Object.assign({}, base);
  if (raw === undefined) return out;
  if (!isObject(raw)) {
    errors.push("apps must be an object");
    return out;
  }
  Object.keys(raw).forEach(function (key) {
    if (raw[key] === null) { delete out[key]; return; }
    if (!isObject(raw[key])) { errors.push("apps." + key + " must be an object (or null to remove it)"); return; }
    out[key] = Object.assign({}, out[key] || {}, raw[key]);
  });
  return out;
}

// Fill in defaults per entry and drop invalid ones (reported), so the rest keeps working.
function validateApps(apps, errors) {
  var clean = {};
  var spoken = {};
  // Built-in apps claim their spoken names first, so a clash rejects the newcomer, not the default.
  var order = Object.keys(apps).sort(function (a, b) {
    var builtIn = function (k) { return Object.prototype.hasOwnProperty.call(defaults.apps, k) ? 0 : 1; };
    return (builtIn(a) - builtIn(b)) || (a < b ? -1 : a > b ? 1 : 0);
  });
  order.forEach(function (key) {
    var entry = apps[key];
    var where = "apps." + key;
    if (normalize(key).length === 0) { errors.push(where + ": name has no speakable words"); return; }

    var match = entry.match === undefined ? escapeRegex(key) : entry.match;
    if (typeof match !== "string" || match === "" || !isValidPattern(match)) {
      errors.push(where + ".match must be a valid regular expression");
      return;
    }
    var launch = entry.launch === undefined && /^\S+$/.test(key) ? [key] : entry.launch;
    if (!isWords(launch) || launch.length === 0) {
      errors.push(where + ".launch must be a non-empty array of strings");
      return;
    }
    var aliases = entry.aliases === undefined ? [] : entry.aliases;
    if (!isWords(aliases)) { errors.push(where + ".aliases must be an array of strings"); return; }

    var forms = [key].concat(aliases).map(function (name) { return normalize(name).join(" "); });
    var clash = forms.filter(function (form) { return spoken[form] && spoken[form] !== key; })[0];
    if (clash !== undefined) {
      errors.push(where + ": \u201c" + clash + "\u201d is already the name of " + spoken[clash]);
      return;
    }
    forms.forEach(function (form) { spoken[form] = key; });
    clean[key] = { match: match, launch: launch, aliases: aliases };
  });
  return clean;
}

// Custom commands: keep the valid ones as { say, type: "exec"|"launch", argv, activeClass }.
function validateCommands(raw, errors) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push("commands must be an array");
    return [];
  }
  var clean = [];
  raw.forEach(function (entry, i) {
    var where = "commands[" + i + "]";
    if (!isObject(entry)) { errors.push(where + " must be an object"); return; }

    var words = typeof entry.say === "string" ? normalize(entry.say) : [];
    if (words.length === 0) { errors.push(where + ".say must contain at least one word"); return; }

    var kinds = ["exec", "launch"].filter(function (k) { return entry[k] !== undefined; });
    if (kinds.length !== 1) { errors.push(where + " needs exactly one of exec or launch"); return; }
    var argv = entry[kinds[0]];
    if (!isWords(argv) || argv.length === 0) {
      errors.push(where + "." + kinds[0] + " must be a non-empty array of strings");
      return;
    }

    var when = entry.when;
    if (when !== undefined && (!isObject(when) || typeof when.activeClass !== "string" || !isValidPattern(when.activeClass))) {
      errors.push(where + ".when must be { \"activeClass\": <valid regular expression> }");
      return;
    }
    clean.push({ say: words.join(" "), type: kinds[0], argv: argv, activeClass: when ? when.activeClass : null });
  });
  return clean;
}

// Bad values fall back to the default one by one (reported), like the other sections.
function checkAssistant(assistant, errors) {
  var fixed = Object.assign({}, assistant);
  var bad = function (key, why) {
    errors.push("assistant." + key + " " + why);
    fixed[key] = defaults.assistant[key];
  };
  var inRange = function (key, min, max) {
    if (!(Number.isInteger(fixed[key]) && fixed[key] >= min && fixed[key] <= max)) bad(key, "must be a whole number between " + min + " and " + max);
  };
  if (!isLoopbackEndpoint(fixed.endpoint)) bad("endpoint", "must be a loopback address like http://127.0.0.1:11434 (the assistant's model stays local)");
  if (typeof fixed.model !== "string" || fixed.model.trim() === "") bad("model", "must be a non-empty string");
  if (typeof fixed.keepAlive !== "string" || !/^[0-9]+[smh]$/.test(fixed.keepAlive)) bad("keepAlive", "must look like 10m, 30s or 1h");
  if (["off", "low", "medium", "high"].indexOf(fixed.think) === -1) bad("think", "must be off, low, medium or high");
  inRange("contextTokens", 1024, 32768);
  inRange("timeoutSeconds", 5, 300);
  inRange("unlockMinutes", 1, 120);
  inRange("maxWindows", 1, 100);
  inRange("maxTitleChars", 20, 200);
  return fixed;
}

function checkRanges(config, errors) {
  var fixed = config;
  if (!(config.voxtype.maxSeconds >= 1 && config.voxtype.maxSeconds <= 120)) {
    errors.push("voxtype.maxSeconds must be between 1 and 120");
    fixed = Object.assign({}, fixed, { voxtype: Object.assign({}, fixed.voxtype, { maxSeconds: defaults.voxtype.maxSeconds }) });
  }
  if (!(config.matching.threshold > 0 && config.matching.threshold <= 1)) {
    errors.push("matching.threshold must be in (0, 1]");
    fixed = Object.assign({}, fixed, { matching: Object.assign({}, fixed.matching, { threshold: defaults.matching.threshold }) });
  }
  var dictation = config.dictation;
  if (!(dictation.armSeconds >= 5 && dictation.armSeconds <= 300)) {
    errors.push("dictation.armSeconds must be between 5 and 300");
    dictation = Object.assign({}, dictation, { armSeconds: defaults.dictation.armSeconds });
  }
  if (!(dictation.maxSeconds >= 5 && dictation.maxSeconds <= 120)) {
    errors.push("dictation.maxSeconds must be between 5 and 120");
    dictation = Object.assign({}, dictation, { maxSeconds: defaults.dictation.maxSeconds });
  }
  if (!isWords(dictation.ignore)) {
    errors.push("dictation.ignore must be an array of strings");
    dictation = Object.assign({}, dictation, { ignore: defaults.dictation.ignore });
  }
  dictation = Object.assign({}, dictation, { ignore: dictation.ignore.map(function (w) { return normalize(w).join(" "); }) });
  fixed = Object.assign({}, fixed, { dictation: dictation });

  var aliases = config.matching.aliases;
  var badAliases = Object.keys(aliases).filter(function (word) {
    var list = aliases[word];
    return !Array.isArray(list) || !list.every(function (w) { return typeof w === "string"; });
  });
  if (badAliases.length) {
    errors.push("matching.aliases." + badAliases.join(", ") + " must be an array of strings");
    var kept = {};
    Object.keys(aliases).forEach(function (word) {
      if (badAliases.indexOf(word) === -1) kept[word] = aliases[word];
    });
    fixed = Object.assign({}, fixed, { matching: Object.assign({}, fixed.matching, { aliases: kept }) });
  }
  fixed = Object.assign({}, fixed, { assistant: checkAssistant(config.assistant, errors) });
  if (typeof config.pushToTalk.key !== "string" || config.pushToTalk.key === "") {
    errors.push("pushToTalk.key must be a non-empty string");
    fixed = Object.assign({}, fixed, { pushToTalk: { key: defaults.pushToTalk.key } });
  }
  return fixed;
}

export function fromObject(raw) {
  var errors = [];
  if (!isObject(raw)) return { config: defaults, errors: ["config must be a JSON object"], ok: false };

  var merged = {
    pushToTalk: mergeSection(defaults.pushToTalk, raw.pushToTalk, errors, "pushToTalk"),
    voxtype: mergeSection(defaults.voxtype, raw.voxtype, errors, "voxtype"),
    matching: mergeSection(defaults.matching, raw.matching, errors, "matching"),
    feedback: mergeSection(defaults.feedback, raw.feedback, errors, "feedback"),
    dictation: mergeSection(defaults.dictation, raw.dictation, errors, "dictation"),
    assistant: mergeSection(defaults.assistant, raw.assistant, errors, "assistant"),
    packs: isObject(raw.packs) ? Object.assign({}, defaults.packs, raw.packs) : defaults.packs,
    apps: validateApps(mergeApps(defaults.apps, raw.apps, errors), errors),
    commands: validateCommands(raw.commands, errors),
  };
  if (raw.packs !== undefined && !isObject(raw.packs)) errors.push("packs must be an object");
  return { config: checkRanges(merged, errors), errors: errors, ok: true };
}

export function parse(text) {
  var raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { config: defaults, errors: ["invalid JSON: " + e.message], ok: false };
  }
  return fromObject(raw);
}
