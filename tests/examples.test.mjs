import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "../core/config.mjs";
import { interpret, registryErrors } from "../core/pipeline.mjs";

// The shipped example configs must stay valid as the code evolves.
const load = (name) => parse(readFileSync(new URL(`../config/${name}`, import.meta.url), "utf8"));

test("config.example.json is valid", () => {
  const { errors, ok, config } = load("config.example.json");
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
  assert.deepEqual(registryErrors(config), []);
});

test("custom-commands.example.json is valid and conflict-free", () => {
  const { errors, ok, config } = load("custom-commands.example.json");
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
  assert.deepEqual(registryErrors(config), []);
  assert.ok(config.commands.length >= 20);
});

test("custom-commands.example.json behaves per focused app", () => {
  const { config } = load("custom-commands.example.json");
  const clients = (cls) => ["chromium", "Spotify", "com.mitchellh.ghostty"].map((c) => ({
    address: "0x" + c, class: c, title: "", mapped: true, focusHistoryID: c === cls ? 0 : 1,
  }));
  const argv = (text, cls) => interpret(config, { clients: clients(cls) }, text).actions.map((a) => a.argv && a.argv.join(" "));

  assert.deepEqual(argv("lock screen", "com.mitchellh.ghostty"), ["omarchy-system-lock"]);
  assert.deepEqual(argv("next", "chromium"), ["wtype -M ctrl -k Tab -m ctrl"]);
  assert.deepEqual(argv("next", "Spotify"), ["wtype -M ctrl -k Right -m ctrl"]);
  assert.deepEqual(argv("next", "com.mitchellh.ghostty"), []);
  assert.deepEqual(argv("pause", "chromium"), []);
  assert.deepEqual(argv("pause", "Spotify"), ["wtype -k space"]);
  assert.equal(interpret(config, { clients: clients("chromium") }, "focus mode").outcome.commandId, "focus mode");
});
