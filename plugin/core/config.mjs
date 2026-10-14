// Config: defaults, parsing and validation. Pure; ES2017-conservative.
// parse(text) -> { config, errors }. Invalid parts fall back to defaults and are reported.

export var defaults = {
  pushToTalk: { key: "F10" },
  voxtype: { model: null, showOsd: true, maxSeconds: 15, transcribeTimeoutSeconds: 20 },
  // aliases: spoken word -> extra words the recogniser commonly produces for it.
  matching: { threshold: 0.8, aliases: { space: ["pace", "base", "spice"], move: ["moved", "moves"] } },
  feedback: { notifyOnNoMatch: true, notifyOnSuccess: false },
  packs: { hyprland: {} },
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
  if (typeof config.pushToTalk.key !== "string" || config.pushToTalk.key === "") {
    errors.push("pushToTalk.key must be a non-empty string");
    fixed = Object.assign({}, fixed, { pushToTalk: { key: defaults.pushToTalk.key } });
  }
  return fixed;
}

export function fromObject(raw) {
  var errors = [];
  if (!isObject(raw)) return { config: defaults, errors: ["config must be a JSON object"] };

  var merged = {
    pushToTalk: mergeSection(defaults.pushToTalk, raw.pushToTalk, errors, "pushToTalk"),
    voxtype: mergeSection(defaults.voxtype, raw.voxtype, errors, "voxtype"),
    matching: mergeSection(defaults.matching, raw.matching, errors, "matching"),
    feedback: mergeSection(defaults.feedback, raw.feedback, errors, "feedback"),
    packs: isObject(raw.packs) ? Object.assign({}, defaults.packs, raw.packs) : defaults.packs,
  };
  if (raw.packs !== undefined && !isObject(raw.packs)) errors.push("packs must be an object");
  return { config: checkRanges(merged, errors), errors: errors };
}

export function parse(text) {
  var raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { config: defaults, errors: ["invalid JSON: " + e.message] };
  }
  return fromObject(raw);
}
