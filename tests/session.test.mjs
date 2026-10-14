import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce } from "../plugin/core/listening/session.mjs";
import { parse } from "../plugin/core/config.mjs";

const run = (state, ...events) =>
  events.reduce((acc, e) => {
    const r = reduce(acc.state, e);
    return { state: r.state, effects: acc.effects.concat(r.effects) };
  }, { state, effects: [] });

const types = (effects) => effects.map((e) => e.type);
const transcript = (text) => ({ type: "TranscriptReceived", text });
const clients = { type: "ClientsSnapshot", clients: [] };

test("press starts recording and arms the watchdog", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" });
  assert.equal(state.phase, "listening");
  assert.deepEqual(types(effects), ["voxtype.start", "watchdog.arm"]);
});

test("release stops recording and snapshots clients", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" });
  assert.equal(state.phase, "transcribing");
  assert.deepEqual(types(effects), ["voxtype.start", "watchdog.arm", "voxtype.stop", "hypr.snapshotClients", "watchdog.arm"]);
});

test("scenario: 'space 1' focuses workspace 1 (transcript first)", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, transcript("Space 1."), clients);
  assert.equal(state.phase, "idle");
  assert.deepEqual(effects.filter((e) => e.type === "hypr.focusWorkspace"), [{ type: "hypr.focusWorkspace", workspace: 1 }]);
});

test("completes regardless of event order (snapshot first)", () => {
  const { effects } = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, clients, transcript("space two"));
  assert.deepEqual(effects.filter((e) => e.type === "hypr.focusWorkspace"), [{ type: "hypr.focusWorkspace", workspace: 2 }]);
});

test("press while busy is ignored", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "PttPressed" });
  assert.equal(state.phase, "listening");
  assert.equal(types(effects).filter((t) => t === "voxtype.start").length, 1);
});

test("release while idle does nothing", () => {
  assert.deepEqual(run(initialState(), { type: "PttReleased" }).effects, []);
});

test("no match notifies by default and runs no action", () => {
  const { effects } = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, transcript("banana"), clients);
  assert.ok(types(effects).includes("notify"));
  assert.ok(!types(effects).includes("hypr.focusWorkspace"));
});

test("no match is silent when feedback.notifyOnNoMatch is off", () => {
  const { config } = parse('{"feedback":{"notifyOnNoMatch":false}}');
  const { effects } = run(initialState(config), { type: "PttPressed" }, { type: "PttReleased" }, transcript("banana"), clients);
  assert.ok(!types(effects).includes("notify"));
});

test("empty transcript (accidental tap) is silent", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, transcript(""), clients);
  assert.equal(state.phase, "idle");
  assert.ok(!types(effects).includes("notify"));
});

test("recording failure returns to idle with a notification", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "RecordingFailed", message: "daemon down" });
  assert.equal(state.phase, "idle");
  assert.ok(types(effects).includes("notify"));
});

test("watchdog cancels a stuck recording", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "WatchdogExpired" });
  assert.equal(state.phase, "idle");
  assert.ok(types(effects).includes("voxtype.cancel"));
});

test("late events after returning to idle are ignored", () => {
  const { state, effects } = run(initialState(), transcript("space 1"), clients);
  assert.equal(state.phase, "idle");
  assert.deepEqual(effects, []);
});

test("explicit cancel while listening", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "Cancelled" });
  assert.equal(state.phase, "idle");
  assert.ok(types(effects).includes("voxtype.cancel"));
});

test("ConfigLoaded swaps config and surfaces errors", () => {
  const { config, errors } = parse('{"matching":{"threshold":9}}');
  const { state, effects } = run(initialState(), { type: "ConfigLoaded", config, errors });
  assert.equal(state.config, config);
  assert.deepEqual(types(effects), ["notify"]);
});
