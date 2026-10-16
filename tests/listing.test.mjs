import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../plugin/core/commands/registry.mjs";
import { builtinPacks } from "../plugin/core/commands/packs/index.mjs";
import { describe, render } from "../plugin/core/commands/listing.mjs";
import { defaults, fromObject } from "../plugin/core/config.mjs";

const lines = (config, options) => render(describe(buildRegistry(builtinPacks, config)), options);

test("lists every runnable path, with arguments shown by name", () => {
  const out = lines(defaults);
  for (const phrase of ["space <n>", "move space <n>", "move left", "move right", "move up", "move down", "open <app>", "focus <app>", "dictate"]) {
    assert.ok(out.includes("  " + phrase), phrase);
  }
  // a node with children and a run is listed both bare and extended
  assert.ok(out.includes("  slack unread"));
  assert.ok(out.includes("  slack unread next"));
});

test("commands that only work in a focused app are grouped under their scope", () => {
  const out = lines(defaults);
  const at = out.indexOf("Only while Slack is focused:");
  assert.ok(at > out.indexOf("Available anywhere:"));
  assert.ok(out.slice(at).includes("  send"));
  // sending exists only in the scoped form, never under "anywhere"
  assert.ok(!out.slice(0, at).includes("  send"));
  assert.ok(!out.slice(0, at).includes("  slack send"));
});

test("reflects config: disabled packs, custom commands and their when-scope, the app catalog", () => {
  const { config } = fromObject({
    packs: { slack: { enabled: false } },
    apps: { notes: { launch: ["notes"] } },
    commands: [
      { say: "lock screen", exec: ["lock"] },
      { say: "tab next", exec: ["x"], when: { activeClass: "^firefox$" } },
    ],
  });
  const out = lines(config);
  assert.ok(!out.some((l) => /slack/i.test(l) && !l.startsWith("  <")));
  assert.ok(out.includes("  lock screen"));
  assert.ok(out.includes("Only while a window matching /^firefox$/ is focused:"));
  assert.ok(out.includes("  tab next"));
  assert.ok(out.some((l) => /^ {2}<app> +one of: .*\bnotes\b/.test(l)));
});

test("--synonyms shows every accepted spelling; the default shows one", () => {
  assert.ok(lines(defaults, { synonyms: true }).includes("  space|workspace <n>"));
  assert.ok(lines(defaults).includes("  space <n>"));
});

test("argument hints are listed once, aligned", () => {
  const args = lines(defaults).slice(lines(defaults).indexOf("Arguments:") + 1);
  assert.equal(args.filter((l) => l.includes("<n>")).length, 1);
  assert.ok(args.every((l) => /^ {2}<\w+> {2,}\S/.test(l)));
});

test("bin/vocon-commands prints the list for a config file, and rejects bad input", () => {
  const dir = mkdtempSync(join(tmpdir(), "vocon-cmds-"));
  const good = join(dir, "c.json");
  writeFileSync(good, JSON.stringify({ commands: [{ say: "lock screen", exec: ["lock"] }] }));
  const out = execFileSync("node", ["bin/vocon-commands", "--config", good], { encoding: "utf8" });
  assert.match(out, /^Available anywhere:/);
  assert.match(out, /^ {2}lock screen$/m);

  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{nope");
  const failed = spawnSync("node", ["bin/vocon-commands", "--config", bad], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /invalid JSON/);

  assert.equal(spawnSync("node", ["bin/vocon-commands", "--bogus"], { encoding: "utf8" }).status, 2);
});
