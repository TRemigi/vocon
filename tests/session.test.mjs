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
const clients = { type: "ClientsSnapshot", clients: [], unlocked: true };

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
  assert.deepEqual(types(effects), ["notify", "log"]);
});

// --- screen lock: voice control is off while locked (fail closed) ---

const locked = { type: "ClientsSnapshot", clients: [], unlocked: false };
const sideEffects = ["voxtype.start", "voxtype.stop", "hypr.snapshotClients", "watchdog.arm", "watchdog.disarm", "dictation.timer.arm", "dictation.timer.disarm", "notify", "log", "voxtype.cancel"];
const lockedEffects = (effects) => effects.filter((e) => sideEffects.indexOf(e.type) === -1);

test("locked screen: a transcript is refused and nothing runs", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, transcript("space 1"), locked);
  assert.equal(state.phase, "idle");
  assert.deepEqual(lockedEffects(effects), []);
  assert.ok(types(effects).includes("notify"));
  assert.ok(effects.some((e) => e.type === "log" && e.message === "refused: screen locked"));
});

test("locked screen: refused regardless of event order, and the transcript is not logged", () => {
  const { effects } = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, locked, transcript("secret words"));
  assert.deepEqual(lockedEffects(effects), []);
  assert.ok(!JSON.stringify(effects).includes("secret words"));
});

test("a snapshot that doesn't say it is unlocked counts as locked", () => {
  const { effects } = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, transcript("space 1"), { type: "ClientsSnapshot", clients: [] });
  assert.deepEqual(lockedEffects(effects), []);
});

test("locking while dictation is armed drops it and types nothing", () => {
  const armedState = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, transcript("dictate"), clients).state;
  assert.ok(armedState.dictation);
  const { state, effects } = run(armedState, { type: "PttPressed" }, { type: "PttReleased" }, transcript("hello there"), locked);
  assert.equal(state.dictation, null);
  assert.ok(!types(effects).includes("text.type"));
  assert.ok(types(effects).includes("dictation.timer.disarm"));
});

test("ScreenLocked (press refused at the start) returns to idle without starting anything", () => {
  const { state, effects } = run(initialState(), { type: "PttPressed" }, { type: "ScreenLocked" });
  assert.equal(state.phase, "idle");
  assert.ok(types(effects).includes("watchdog.disarm"));
  assert.ok(!types(effects).includes("voxtype.stop"));
});

test("ScreenLocked while idle does nothing", () => {
  assert.deepEqual(run(initialState(), { type: "ScreenLocked" }).effects, []);
});

test("unlocked again: the next utterance runs normally", () => {
  const first = run(initialState(), { type: "PttPressed" }, { type: "PttReleased" }, transcript("space 1"), locked);
  const second = run(first.state, { type: "PttPressed" }, { type: "PttReleased" }, transcript("space 1"), clients);
  assert.deepEqual(second.effects.filter((e) => e.type === "hypr.focusWorkspace"), [{ type: "hypr.focusWorkspace", workspace: 1 }]);
});
