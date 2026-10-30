import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, defaults } from "../core/config.mjs";

test("empty object yields defaults", () => {
  const { config, errors } = parse("{}");
  assert.deepEqual(config, defaults);
  assert.deepEqual(errors, []);
});

test("overrides merge section by section", () => {
  const { config, errors } = parse('{"pushToTalk":{"key":"F11"},"voxtype":{"maxSeconds":30}}');
  assert.equal(config.pushToTalk.key, "F11");
  assert.equal(config.voxtype.maxSeconds, 30);
  assert.equal(config.voxtype.showOsd, true);
  assert.deepEqual(errors, []);
});

test("bad JSON falls back to defaults with an error", () => {
  const { config, errors } = parse("{nope");
  assert.deepEqual(config, defaults);
  assert.match(errors[0], /invalid JSON/);
});

test("wrong types and out-of-range values are reported and defaulted", () => {
  const { config, errors } = parse('{"voxtype":{"maxSeconds":"long"},"matching":{"threshold":5}}');
  assert.equal(config.voxtype.maxSeconds, defaults.voxtype.maxSeconds);
  assert.equal(config.matching.threshold, defaults.matching.threshold);
  assert.equal(errors.length, 2);
});

test("a null default accepts a string (voxtype.model)", () => {
  assert.equal(parse('{"voxtype":{"model":"tiny.en"}}').config.voxtype.model, "tiny.en");
});

test("bad alias lists are reported and dropped", () => {
  const { config, errors } = parse('{"matching":{"aliases":{"go":"went","stop":[1]}}}');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /go, stop/);
  assert.equal(config.matching.aliases.go, undefined);
  assert.equal(config.matching.aliases.stop, undefined);
  assert.ok(config.matching.aliases.space.length > 0);
});

test("assistant: off by default, local endpoint, defaults need no config", () => {
  assert.equal(defaults.assistant.enabled, false);
  assert.equal(parse("{}").config.assistant.endpoint, "http://127.0.0.1:11434");
});

test("assistant: the endpoint must be a loopback address, nothing else is accepted", () => {
  for (const ok of ["http://127.0.0.1:11434", "http://127.0.0.1", "http://[::1]:8080"]) {
    const { config, errors } = parse(JSON.stringify({ assistant: { endpoint: ok } }));
    assert.equal(config.assistant.endpoint, ok);
    assert.deepEqual(errors, [], ok);
  }
  for (const bad of [
    "http://example.com:11434", "https://127.0.0.1:11434", "http://localhost:11434", "http://127.0.0.1.evil.com",
    "http://127.0.0.1@evil.com", "http://evil.com#@127.0.0.1", "http://127.0.0.1:11434/", "http://127.0.0.1:11434/api",
    "http://0.0.0.0:11434", "http://192.168.1.5:11434", "", "127.0.0.1:11434",
  ]) {
    const { config, errors } = parse(JSON.stringify({ assistant: { endpoint: bad } }));
    assert.equal(config.assistant.endpoint, defaults.assistant.endpoint, bad);
    assert.match(errors.join(";"), /assistant\.endpoint must be a loopback address/, bad);
  }
});

test("assistant: bad values are reported and defaulted one by one", () => {
  const { config, errors } = parse(JSON.stringify({ assistant: { enabled: true, model: " ", think: "max", keepAlive: "soon", unlockMinutes: 0, maxWindows: 500, timeoutSeconds: "slow" } }));
  assert.equal(config.assistant.enabled, true);
  for (const key of ["model", "think", "keepAlive", "unlockMinutes", "maxWindows", "timeoutSeconds"]) {
    assert.equal(config.assistant[key], defaults.assistant[key], key);
    assert.ok(errors.some((e) => e.indexOf("assistant." + key) === 0), key);
  }
});

test("assistant.key: a single plain key, different from the push-to-talk key", () => {
  assert.equal(defaults.assistant.key, "F8");
  assert.equal(parse('{"assistant":{"key":"F7"}}').config.assistant.key, "F7");
  for (const bad of ["SHIFT + F8", "F8 F9", 'F8"', "", "F10"]) {
    const { config, errors } = parse(JSON.stringify({ assistant: { key: bad } }));
    assert.equal(config.assistant.key, "F8", JSON.stringify(bad));
    assert.ok(errors.some((e) => e.indexOf("assistant.key") === 0), JSON.stringify(bad));
  }
  const clash = parse('{"pushToTalk":{"key":"F8"}}');
  assert.ok(clash.errors.some((e) => /assistant\.key must differ/.test(e)));
});

test("assistant.unlock: password by default, fingerprint optional, anything else is reported", () => {
  assert.equal(defaults.assistant.unlock, "password");
  assert.equal(parse('{"assistant":{"unlock":"fingerprint"}}').config.assistant.unlock, "fingerprint");
  for (const bad of ["none", "pin", "", "Password"]) {
    const { config, errors } = parse(JSON.stringify({ assistant: { unlock: bad } }));
    assert.equal(config.assistant.unlock, "password", bad);
    assert.ok(errors.some((e) => e.indexOf("assistant.unlock") === 0), bad);
  }
  assert.ok(parse('{"assistant":{"unlockTimeoutSeconds":5}}').errors.some((e) => /unlockTimeoutSeconds/.test(e)));
});
