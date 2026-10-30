import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce } from "../core/listening/session.mjs";
import { parse } from "../core/config.mjs";

const cfg = parse('{"assistant":{"enabled":true}}').config;
const MIN = 60000;
const T0 = 1000000;

const run = (state, ...events) =>
  events.reduce((acc, e) => {
    const r = reduce(acc.state, e);
    return { state: r.state, effects: acc.effects.concat(r.effects) };
  }, { state, effects: [] });
const types = (effects) => effects.map((e) => e.type);
const ofType = (effects, type) => effects.filter((e) => e.type === type);

// ---- a small desktop in hyprctl's shape; window numbers in the prompt = index here
const mk = (i, ws, cls, title, focus) => ({
  address: "0x" + (0x1000 + i).toString(16), mapped: true, hidden: false, focusHistoryID: focus,
  workspace: { id: ws, name: String(ws) }, class: cls, title,
});
const DESK = [
  mk(0, 1, "com.mitchellh.ghostty", "mogwai2: vocon", 0),
  mk(1, 2, "slack", "Apps - Slack", 1),
  mk(2, 3, "chromium", "Slack API - Chromium", 2),
  mk(3, 4, "beekeeper-studio", "Local - Beekeeper Studio", 3),
  mk(4, 4, "beekeeper-studio", "Production - Beekeeper Studio", 4),
];
const addr = (i) => "0x" + (0x1000 + i).toString(16);

const press = (at) => ({ type: "AssistPressed", at });
const release = (at) => ({ type: "AssistReleased", at });
const said = (text, at) => ({ type: "TranscriptReceived", text, at });
const snap = (clients, at, unlocked) => ({ type: "ClientsSnapshot", clients, unlocked: unlocked !== false, at });
const reply = (id, obj, at) => ({ type: "ModelReplied", id, text: typeof obj === "string" ? obj : JSON.stringify(obj), at });

// press, release, then the transcript and the window snapshot
const utter = (state, text, at, clients) =>
  run(state, press(at), release(at + 500), said(text, at + 1000), snap(clients || DESK, at + 1100));

const unlocked = () => run(initialState(cfg), press(T0), { type: "UnlockResult", ok: true, at: T0 + 500 }).state;
const thinking = (text) => utter(unlocked(), text || "go to the slack api window", T0 + 2000);
const asking = () => run(thinking("bring the database one here").state, reply(1, { verb: "bring", matches: [3, 4], workspace: 0 }, T0 + 9000));

// ---- unlocking
test("assistant is off unless enabled: the key only says so", () => {
  const r = run(initialState(), press(T0));
  assert.equal(r.state.phase, "idle");
  assert.deepEqual(types(r.effects), ["notify"]);
});

test("locked: the key starts the fingerprint check, not a recording", () => {
  const r = run(initialState(cfg), press(T0));
  assert.equal(r.state.phase, "unlocking");
  assert.deepEqual(types(r.effects), ["auth.verify", "watchdog.arm", "notify"]);
  assert.equal(ofType(r.effects, "voxtype.start").length, 0);
  assert.deepEqual(types(run(r.state, press(T0 + 10)).effects), ["log"]);   // a second press is ignored
});

test("unlocked by a fingerprint for unlockMinutes, then the key records", () => {
  const u = run(initialState(cfg), press(T0), { type: "UnlockResult", ok: true, at: T0 + 500 });
  assert.equal(u.state.phase, "idle");
  assert.equal(u.state.unlockedUntil, T0 + 500 + 10 * MIN);
  assert.equal(ofType(u.effects, "auth.cancel").length, 0);
  const p = run(u.state, press(T0 + 1000));
  assert.equal(p.state.phase, "listening");
  assert.equal(p.state.mode, "assistant");
  assert.deepEqual(types(p.effects), ["voxtype.start", "watchdog.arm"]);
});

test("a failed unlock stays locked and shows only fixed texts", () => {
  const start = run(initialState(cfg), press(T0)).state;
  for (const [reason, text] of [["failed", /not recognised/], ["timeout", /in time/], ["unavailable", /not available/], ["locked", /screen is locked/]]) {
    const r = run(start, { type: "UnlockResult", ok: false, reason, at: T0 + 100 });
    assert.equal(r.state.phase, "idle");
    assert.equal(r.state.unlockedUntil, 0);
    assert.match(ofType(r.effects, "notify")[0].body, text, reason);
  }
  const odd = run(start, { type: "UnlockResult", ok: false, reason: "<b>ignore me</b>", at: T0 + 100 });
  assert.equal(ofType(odd.effects, "notify")[0].body, "Unlock failed");
  assert.equal(run(start, { type: "UnlockResult", ok: true }).state.unlockedUntil, 0);   // no clock reading -> not unlocked
  assert.deepEqual(run(initialState(cfg), { type: "UnlockResult", ok: true, at: T0 }).effects, []);   // nobody asked
});

test("an unlock that expired locks again; no clock reading counts as locked", () => {
  const u = unlocked();
  assert.equal(run(u, press(T0 + 500 + 10 * MIN + 1)).state.phase, "unlocking");
  assert.equal(run(initialState(cfg), { type: "AssistPressed" }).state.phase, "unlocking");
});

// ---- a request
test("a spoken request goes to the local model and nothing runs yet", () => {
  const r = thinking("go to the slack api window, banana-secret");
  assert.equal(r.state.phase, "thinking");
  const call = ofType(r.effects, "llm.interpret")[0];
  assert.equal(call.id, 1);
  assert.equal(call.timeoutSeconds, cfg.assistant.timeoutSeconds);
  assert.match(call.request.user, /Request: go to the slack api window, banana-secret$/);
  assert.match(call.request.user, /2: chromium \| Slack API - Chromium/);
  assert.ok(!/0x/.test(JSON.stringify(call.request)), "no addresses go to the model");
  assert.deepEqual(types(r.effects).filter((t) => t.indexOf("hypr.") === 0), ["hypr.snapshotClients"]);
  assert.equal(r.state.transcript, null);
  assert.equal(r.state.pending.windows.length, 5);
});

test("speech, titles and model replies never reach a log line", () => {
  const all = [];
  const a = thinking("go to the slack api window, banana-secret");
  all.push(a.effects);
  const b = run(a.state, reply(1, { verb: "focus", matches: [2], workspace: 0 }, T0 + 9000));
  all.push(b.effects);
  const c = asking();
  all.push(c.effects);
  const d = run(c.state, press(T0 + 20000), release(T0 + 20500), said("uh banana-secret", T0 + 21000), snap(DESK, T0 + 21100));
  all.push(d.effects);
  const logs = [].concat(...all).filter((e) => e.type === "log").map((e) => e.message).join("\n");
  assert.ok(logs.length > 0);
  for (const word of ["banana", "secret", "Slack API", "Beekeeper", "vocon", "chromium"]) assert.ok(logs.indexOf(word) === -1, word);
});

test("the model's reply runs the plan, and every use pushes the unlock out", () => {
  const t = thinking();
  const r = run(t.state, reply(1, { verb: "focus", matches: [2], workspace: 0 }, T0 + 9000));
  assert.equal(r.state.phase, "idle");
  assert.equal(r.state.pending, null);
  assert.deepEqual(ofType(r.effects, "hypr.focusWindow"), [{ type: "hypr.focusWindow", address: addr(2) }]);
  assert.equal(ofType(r.effects, "llm.cancel").length, 0);
  assert.equal(ofType(r.effects, "assistant.clarify.hide").length, 0);
  assert.equal(r.state.unlockedUntil, T0 + 9000 + 10 * MIN);
  assert.ok(r.state.unlockedUntil > t.state.unlockedUntil);
});

test("a reply for another request, or none pending, is ignored", () => {
  const t = thinking();
  assert.deepEqual(run(t.state, reply(99, { verb: "focus", matches: [2], workspace: 0 }, T0 + 9000)).effects, []);
  assert.equal(run(t.state, reply(99, "x", T0 + 9000)).state.phase, "thinking");
  assert.deepEqual(run(unlocked(), reply(1, { verb: "focus", matches: [2], workspace: 0 }, T0 + 9000)).effects, []);
});

test("an unusable reply does nothing and says why", () => {
  for (const text of ["", "not json", '{"verb":"close","matches":[1],"workspace":0}', '{"verb":"focus","matches":[99],"workspace":0}']) {
    const r = run(thinking().state, reply(1, text, T0 + 9000));
    assert.equal(r.state.phase, "idle", text);
    assert.deepEqual(types(r.effects).filter((t) => t.indexOf("hypr.") === 0), [], text);
    assert.equal(ofType(r.effects, "notify")[0].urgency, "normal");
  }
});

test("a request that cannot be carried out says why", () => {
  const r = run(thinking().state, reply(1, { verb: "focus", matches: [], workspace: 0 }, T0 + 9000));
  assert.match(ofType(r.effects, "notify")[0].body, /no window matches/);
  assert.equal(r.state.phase, "idle");
});

test("the model failing is reported and ends the request", () => {
  const t = thinking();
  const r = run(t.state, { type: "ModelFailed", id: 1, message: "connection refused", at: T0 + 9000 });
  assert.equal(r.state.phase, "idle");
  assert.match(ofType(r.effects, "notify")[0].body, /connection refused/);
  assert.equal(ofType(r.effects, "llm.cancel").length, 0);
  assert.deepEqual(run(t.state, { type: "ModelFailed", id: 7, message: "x", at: T0 + 9000 }).effects, []);
});

// ---- asking which window
test("several matches: the question is shown without addresses and times out", () => {
  const r = asking();
  assert.equal(r.state.phase, "clarifying");
  const show = ofType(r.effects, "assistant.clarify.show")[0];
  assert.equal(show.title, "Bring which window here?");
  assert.deepEqual(show.rows.map((x) => [x.number, x.workspace]), [[1, 4], [2, 4]]);
  assert.match(show.rows[1].text, /Production/);
  assert.ok(!/0x/.test(JSON.stringify(show)));
  assert.deepEqual(ofType(r.effects, "clarify.timer.arm"), [{ type: "clarify.timer.arm", ms: 30000 }]);
  assert.equal(ofType(r.effects, "hypr.moveWindow").length, 0);
});

test("answering by voice acts on the window you named and takes the question down", () => {
  const q = asking().state;
  const r = utter(q, "the second one", T0 + 20000);
  assert.equal(r.state.phase, "idle");
  assert.deepEqual(ofType(r.effects, "hypr.moveWindow"), [{ type: "hypr.moveWindow", address: addr(4), workspace: 1 }]);
  assert.equal(ofType(r.effects, "assistant.clarify.hide").length, 1);
  assert.equal(ofType(r.effects, "clarify.timer.disarm").length, 1);
});

test("the answer press keeps the question and records; 'here' follows where you are now", () => {
  const q = asking().state;
  const p = run(q, press(T0 + 20000));
  assert.equal(p.state.phase, "listening");
  assert.equal(p.state.mode, "assistant");
  assert.ok(p.state.pending.clarification);
  assert.equal(ofType(p.effects, "assistant.clarify.hide").length, 0);
  // the focused window is now on workspace 2
  const moved = DESK.map((d, i) => i === 0 ? { ...d, focusHistoryID: 5 } : i === 1 ? { ...d, focusHistoryID: 0 } : d);
  const r = run(p.state, release(T0 + 20500), said("one", T0 + 21000), snap(moved, T0 + 21100));
  assert.deepEqual(ofType(r.effects, "hypr.moveWindow"), [{ type: "hypr.moveWindow", address: addr(3), workspace: 2 }]);
});

test("a window that closed while you decided is not acted on", () => {
  const gone = DESK.filter((d) => d.address !== addr(4));
  const r = utter(asking().state, "two", T0 + 20000, gone);
  assert.equal(r.state.phase, "idle");
  assert.equal(ofType(r.effects, "hypr.moveWindow").length, 0);
  assert.match(ofType(r.effects, "notify")[0].body, /gone/);
  assert.equal(ofType(r.effects, "assistant.clarify.hide").length, 1);
});

test("an unclear answer keeps asking; 'cancel' ends it", () => {
  const unclear = utter(asking().state, "uh banana", T0 + 20000);
  assert.equal(unclear.state.phase, "clarifying");
  assert.ok(unclear.state.pending.clarification);
  assert.equal(ofType(unclear.effects, "assistant.clarify.hide").length, 0);
  assert.equal(ofType(unclear.effects, "clarify.timer.arm").length, 1);
  assert.equal(ofType(unclear.effects, "hypr.moveWindow").length, 0);
  const silent = utter(asking().state, "   ", T0 + 20000);
  assert.equal(silent.state.phase, "clarifying");

  const cancelled = utter(unclear.state, "never mind", T0 + 30000);
  assert.equal(cancelled.state.phase, "idle");
  assert.equal(ofType(cancelled.effects, "assistant.clarify.hide").length, 1);
  assert.equal(ofType(cancelled.effects, "hypr.moveWindow").length, 0);
});

test("a number pressed in the overlay acts; anything else is ignored", () => {
  const q = asking().state;
  const r = run(q, { type: "ChoiceSelected", number: 1, at: T0 + 20000 });
  assert.deepEqual(ofType(r.effects, "hypr.moveWindow"), [{ type: "hypr.moveWindow", address: addr(3), workspace: 1 }]);
  assert.equal(ofType(r.effects, "assistant.clarify.hide").length, 1);
  for (const number of [0, 3, -1, 1.5, "1", undefined, null]) {
    const ignored = run(q, { type: "ChoiceSelected", number, at: T0 + 20000 });
    assert.equal(ignored.state.phase, "clarifying", String(number));
    assert.equal(ofType(ignored.effects, "hypr.moveWindow").length, 0);
    assert.equal(ofType(ignored.effects, "assistant.clarify.hide").length, 0);
  }
  assert.deepEqual(run(unlocked(), { type: "ChoiceSelected", number: 1, at: T0 + 20000 }).effects, []);
});

test("an unanswered question expires and takes itself down; a late expiry while you answer is ignored", () => {
  const q = asking().state;
  const r = run(q, { type: "ClarifyExpired", at: T0 + 40000 });
  assert.equal(r.state.phase, "idle");
  assert.equal(ofType(r.effects, "assistant.clarify.hide").length, 1);
  const answering = run(q, press(T0 + 20000));
  assert.equal(run(answering.state, { type: "ClarifyExpired", at: T0 + 40000 }).state.phase, "listening");
  assert.deepEqual(run(unlocked(), { type: "ClarifyExpired", at: T0 + 40000 }).effects, []);
});

// ---- cancelling and timing out: only what vocon started is cancelled
test("cancel while the model thinks cancels the model request, never a recording", () => {
  const r = run(thinking().state, { type: "Cancelled", at: T0 + 5000 });
  assert.equal(r.state.phase, "idle");
  assert.equal(ofType(r.effects, "llm.cancel").length, 1);
  assert.equal(ofType(r.effects, "voxtype.cancel").length, 0);
});

test("cancel while unlocking cancels the fingerprint check, not a recording", () => {
  const r = run(initialState(cfg), press(T0), { type: "Cancelled", at: T0 + 100 });
  assert.equal(ofType(r.effects, "auth.cancel").length, 1);
  assert.equal(ofType(r.effects, "voxtype.cancel").length, 0);
});

test("cancel while a question is up takes it down; while recording it cancels the recording", () => {
  const q = run(asking().state, { type: "Cancelled", at: T0 + 20000 });
  assert.equal(q.state.phase, "idle");
  assert.equal(ofType(q.effects, "assistant.clarify.hide").length, 1);
  assert.equal(ofType(q.effects, "voxtype.cancel").length, 0);
  const rec = run(unlocked(), press(T0 + 2000), { type: "Cancelled", at: T0 + 2500 });
  assert.equal(ofType(rec.effects, "voxtype.cancel").length, 1);
  assert.equal(rec.state.mode, "command");
});

test("the watchdog only cancels a recording; a hung model request is cancelled instead", () => {
  const wait = run(thinking().state, { type: "WatchdogExpired", at: T0 + 60000 });
  assert.equal(wait.state.phase, "idle");
  assert.equal(ofType(wait.effects, "llm.cancel").length, 1);
  assert.equal(ofType(wait.effects, "voxtype.cancel").length, 0);
  const auth = run(initialState(cfg), press(T0), { type: "WatchdogExpired", at: T0 + 30000 });
  assert.equal(ofType(auth.effects, "auth.cancel").length, 1);
  assert.equal(ofType(auth.effects, "voxtype.cancel").length, 0);
  const rec = run(unlocked(), press(T0 + 2000), { type: "WatchdogExpired", at: T0 + 20000 });
  assert.equal(ofType(rec.effects, "voxtype.cancel").length, 1);
});

// ---- the screen lock and the unlock still gate everything
test("a locked screen at completion refuses: nothing is interpreted or sent to the model", () => {
  const r = run(unlocked(), press(T0 + 2000), release(T0 + 2500), said("go to slack", T0 + 3000), snap(DESK, T0 + 3100, false));
  assert.equal(r.state.phase, "idle");
  assert.equal(ofType(r.effects, "llm.interpret").length, 0);
  assert.equal(ofType(r.effects, "notify")[0].title, "Voice commands are off");
});

test("a screen that locks while the model thinks drops the request", () => {
  const r = run(thinking().state, { type: "ScreenLocked", at: T0 + 5000 });
  assert.equal(r.state.phase, "idle");
  assert.equal(ofType(r.effects, "llm.cancel").length, 1);
});

test("an unlock that lapsed while you were speaking sends nothing to the model", () => {
  const short = parse('{"assistant":{"enabled":true,"unlockMinutes":1}}').config;
  const u = run(initialState(short), press(T0), { type: "UnlockResult", ok: true, at: T0 }).state;
  const r = run(u, press(T0 + 1000), release(T0 + 2000), said("go to slack", T0 + 62000), snap(DESK, T0 + 62100));
  assert.equal(r.state.phase, "idle");
  assert.equal(ofType(r.effects, "llm.interpret").length, 0);
  assert.equal(ofType(r.effects, "notify")[0].title, "Assistant locked");
});

test("nothing heard, or no windows, ends quietly without calling the model", () => {
  const none = utter(unlocked(), "  ", T0 + 2000);
  assert.equal(none.state.phase, "idle");
  assert.equal(ofType(none.effects, "llm.interpret").length, 0);
  const empty = utter(unlocked(), "go to slack", T0 + 2000, []);
  assert.equal(empty.state.phase, "idle");
  assert.equal(ofType(empty.effects, "llm.interpret").length, 0);
});

// ---- the two keys never mix
test("the assistant key drops an armed dictation instead of typing into it", () => {
  const armed = Object.assign({}, unlocked(), { dictation: { address: "0x1" } });
  const r = run(armed, press(T0 + 2000));
  assert.equal(r.state.dictation, null);
  assert.equal(ofType(r.effects, "dictation.timer.disarm").length, 1);
});

test("a key release only counts for the key that was pressed", () => {
  const assistant = run(unlocked(), press(T0 + 2000));
  assert.equal(run(assistant.state, { type: "PttReleased" }).state.phase, "listening");
  const command = run(initialState(cfg), { type: "PttPressed" });
  assert.equal(run(command.state, release(T0 + 2500)).state.phase, "listening");
});

test("the normal command key still works after an assistant request", () => {
  const done = run(thinking().state, reply(1, { verb: "focus", matches: [2], workspace: 0 }, T0 + 9000)).state;
  const r = run(done, { type: "PttPressed" }, { type: "PttReleased" }, said("space 2", T0 + 12000), snap(DESK, T0 + 12100));
  assert.deepEqual(ofType(r.effects, "hypr.focusWorkspace"), [{ type: "hypr.focusWorkspace", workspace: 2 }]);
});
