import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce } from "../plugin/core/listening/session.mjs";
import { parse, defaults } from "../plugin/core/config.mjs";
import { toArgv } from "../plugin/core/execution/keys.mjs";

const win = (address, cls, focus) => ({ address, class: cls, title: "", mapped: true, focusHistoryID: focus });
const slackFocused = [win("0x1", "slack", 0), win("0x2", "ghostty", 1)];
const otherFocused = [win("0x1", "slack", 1), win("0x2", "ghostty", 0)];

const run = (state, ...events) => events.reduce((acc, e) => {
  const r = reduce(acc.state, e);
  return { state: r.state, effects: acc.effects.concat(r.effects) };
}, { state, effects: [] });

// one full press -> release -> transcript -> windows cycle
const utter = (state, text, clients = slackFocused) => run(state,
  { type: "PttPressed" }, { type: "PttReleased" },
  { type: "TranscriptReceived", text }, { type: "ClientsSnapshot", clients, unlocked: true });

const types = (effects) => effects.map((e) => e.type);
const armed = () => utter(initialState(), "dictate").state;

test("'dictate' arms dictation for the focused window and notifies", () => {
  const r = utter(initialState(), "Dictate.");
  assert.deepEqual(r.state.dictation, { address: "0x1" });
  assert.equal(r.state.phase, "idle");
  assert.ok(types(r.effects).includes("dictation.timer.arm"));
  assert.ok(types(r.effects).includes("notify"));
  assert.ok(!types(r.effects).includes("dictation.arm")); // internal marker never reaches the shell
  const timer = r.effects.find((e) => e.type === "dictation.timer.arm");
  assert.equal(timer.ms, defaults.dictation.armSeconds * 1000);
});

test("the next utterance is typed, not interpreted, and dictation ends", () => {
  const r = utter(armed(), "Hey team, space 2 is ready.");
  const typed = r.effects.filter((e) => e.type === "text.type");
  assert.deepEqual(typed, [{ type: "text.type", text: "Hey team, space 2 is ready." }]);
  assert.ok(!types(r.effects).includes("hypr.focusWorkspace"));
  assert.equal(r.state.dictation, null);
  assert.ok(types(r.effects).includes("dictation.timer.disarm"));
});

test("it is single-shot: the utterance after that is a command again", () => {
  const first = utter(armed(), "some message");
  const second = utter(first.state, "space 3");
  assert.deepEqual(second.effects.filter((e) => e.type === "hypr.focusWorkspace"), [{ type: "hypr.focusWorkspace", workspace: 3 }]);
});

test("dictation uses its own, longer recording limit", () => {
  const r = run(armed(), { type: "PttPressed" });
  assert.equal(r.effects.find((e) => e.type === "watchdog.arm").ms, defaults.dictation.maxSeconds * 1000);
  const plain = run(initialState(), { type: "PttPressed" });
  assert.equal(plain.effects.find((e) => e.type === "watchdog.arm").ms, defaults.voxtype.maxSeconds * 1000);
});

test("saying 'cancel' cancels it without typing", () => {
  const r = utter(armed(), "Cancel.");
  assert.equal(r.state.dictation, null);
  assert.ok(!types(r.effects).includes("text.type"));
});

test("silence is not typed: empty and known hallucinations keep it armed", () => {
  for (const text of ["", "   ", "Thank you for watching!", "Thanks for watching.", "You"]) {
    const r = utter(armed(), text);
    assert.deepEqual(r.state.dictation, { address: "0x1" }, JSON.stringify(text));
    assert.ok(!types(r.effects).includes("text.type"), JSON.stringify(text));
  }
});

test("a changed focus discards the dictation instead of typing somewhere else", () => {
  const r = utter(armed(), "private message", otherFocused);
  assert.equal(r.state.dictation, null);
  assert.ok(!types(r.effects).includes("text.type"));
  assert.equal(r.effects.find((e) => e.type === "notify").body, "The focused window changed");
  assert.equal(utter(armed(), "x", []).effects.some((e) => e.type === "text.type"), false);
});

test("it expires", () => {
  const r = run(armed(), { type: "DictationExpired" });
  assert.equal(r.state.dictation, null);
  assert.ok(types(r.effects).includes("notify"));
  assert.deepEqual(run(initialState(), { type: "DictationExpired" }).effects, []);
});

test("the cancel event disarms it, idle or mid-recording", () => {
  const idle = run(armed(), { type: "Cancelled" });
  assert.equal(idle.state.dictation, null);
  assert.ok(types(idle.effects).includes("dictation.timer.disarm"));
  const busy = run(armed(), { type: "PttPressed" }, { type: "Cancelled" });
  assert.equal(busy.state.dictation, null);
  assert.ok(types(busy.effects).includes("voxtype.cancel"));
});

test("dictated text becomes a safe typing command", () => {
  const typed = utter(armed(), "-k ctrl\nrm -rf /").effects.find((e) => e.type === "text.type");
  const argv = toArgv(typed);
  assert.deepEqual(argv.slice(0, 3), ["sh", "-c", "printf '%s' \"$1\" | wtype -"]);
  assert.equal(argv[4], "-k ctrl rm -rf /"); // one argument on stdin, newline flattened
});

test("the log never contains dictated text", () => {
  const logs = utter(armed(), "my secret message").effects.filter((e) => e.type === "log").map((e) => e.message).join(" ");
  assert.ok(!logs.includes("secret"));
});

test("dictation config is validated", () => {
  const { config, errors } = parse('{"dictation":{"armSeconds":1,"maxSeconds":999,"ignore":[1]}}');
  assert.equal(errors.length, 3);
  assert.deepEqual(config.dictation, defaults.dictation);
  const custom = parse('{"dictation":{"ignore":["Okay.","Bye!"]}}').config.dictation.ignore;
  assert.deepEqual(custom, ["okay", "bye"]);
});

// --- inline: "dictate <text>" types straight away, without a second key press ---

const typedText = (effects) => effects.filter((e) => e.type === "text.type").map((e) => e.text);

test("'dictate <text>' types the text without the command word and without arming", () => {
  for (const [said, typed] of [
    ["Dictate hey team, space 2 is ready.", "hey team, space 2 is ready."],
    ["Dictate, Hi team.", "Hi team."],
    ["dictate: ship it", "ship it"],
    ["  Dictate   (note) fine ", "(note) fine"],
  ]) {
    const r = utter(initialState(), said);
    assert.deepEqual(typedText(r.effects), [typed], said);
    assert.equal(r.state.dictation, null, said);
    assert.equal(r.state.phase, "idle", said);
    assert.ok(!types(r.effects).includes("dictation.arm"), said);
    assert.ok(!types(r.effects).includes("hypr.focusWorkspace"), said); // not interpreted as a command
  }
});

test("inline dictation keeps the other safeguards", () => {
  assert.deepEqual(typedText(utter(initialState(), "dictate cancel").effects), []);
  assert.deepEqual(typedText(utter(initialState(), "dictate you").effects), []);
  const kept = utter(initialState(), "dictate thanks for watching");
  assert.deepEqual(kept.state.dictation, { address: "0x1" }); // ignored text keeps it armed...
  assert.ok(types(kept.effects).includes("dictation.timer.arm")); // ...with its expiry timer
});

test("inline dictation never logs or notifies the dictated text", () => {
  const r = utter(initialState(), "dictate my secret message");
  assert.deepEqual(typedText(r.effects), ["my secret message"]);
  const visible = r.effects.filter((e) => e.type === "log" || e.type === "notify").map((e) => JSON.stringify(e)).join(" ");
  assert.ok(!visible.includes("secret"));
  const loud = utter(initialState(), "dictate my secret message", slackFocused).effects; // feedback.notifyOnSuccess must not echo it
  assert.ok(!loud.some((e) => e.type === "notify" && JSON.stringify(e).includes("secret")));
});

test("bare 'dictate' still arms for the next press", () => {
  const r = utter(initialState(), "dictate");
  assert.deepEqual(r.state.dictation, { address: "0x1" });
  assert.deepEqual(typedText(r.effects), []);
});

test("the dictation pack alone supplies the slot, and can be disabled", () => {
  const off = parse('{"packs":{"slack":{"enabled":false}}}').config;
  assert.deepEqual(typedText(utter(initialState(off), "dictate hello there").effects), ["hello there"]);
  const none = parse('{"packs":{"dictation":{"enabled":false}}}').config;
  assert.deepEqual(typedText(utter(initialState(none), "dictate hello there").effects), []);
});
