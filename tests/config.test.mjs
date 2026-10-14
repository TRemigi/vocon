import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, defaults } from "../plugin/core/config.mjs";

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
