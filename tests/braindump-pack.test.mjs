import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, registryErrors } from "../plugin/core/pipeline.mjs";
import { parse, defaults } from "../plugin/core/config.mjs";
import { afterWords } from "../plugin/core/interpretation/utterance.mjs";
import { toArgv } from "../plugin/core/execution/notes.mjs";
import { initialState, reduce } from "../plugin/core/listening/session.mjs";
import { describe, rows } from "../plugin/core/commands/listing.mjs";
import { buildRegistry } from "../plugin/core/commands/registry.mjs";
import { builtinPacks } from "../plugin/core/commands/packs/index.mjs";

const say = (text, config = defaults) => interpret(config, { clients: [] }, text);
const withPack = (pack) => parse(JSON.stringify({ packs: { braindump: pack } })).config;

test("the braindump pack registers cleanly with the others", () => {
  assert.deepEqual(registryErrors(defaults), []);
});

test("afterWords drops leading words and their separators, keeping case and punctuation", () => {
  assert.equal(afterWords("Note: Renew my passport, by May.", 1), "Renew my passport, by May.");
  assert.equal(afterWords("Brain dump. Try ripgrep --json", 2), "Try ripgrep --json");
  assert.equal(afterWords("note", 1), "");
  assert.equal(afterWords("  Dictate, Hi team.", 1), "Hi team.");
});

// What was said (raw, after the command words) -> the text queued.
const captures = {
  "Note: Renew my passport, by May.": "Renew my passport, by May.",
  "note pick up the dry cleaning": "pick up the dry cleaning",
  "Brain dump. Try ripgrep with --json output": "Try ripgrep with --json output",
  "Braindump, look into JWT validation.": "look into JWT validation.",
  "note status page is down again": "status page is down again",
};

for (const [spoken, expected] of Object.entries(captures)) {
  test(`"${spoken}" queues the note verbatim`, () => {
    const { outcome, actions } = say(spoken);
    assert.equal(outcome.kind, "matched");
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "note.capture");
    assert.equal(actions[0].text, expected);
    assert.deepEqual(actions[0].argv, ["braindump", "capture"]);
  });
}

test("notes are marked private so nothing quotes them", () => {
  assert.equal(say("note buy milk").actions[0].private, true);
});

test("status is a keyword after braindump / brain dump, not a note", () => {
  for (const spoken of ["brain dump status", "Braindump status."]) {
    const { actions } = say(spoken);
    assert.equal(actions[0].type, "note.status", spoken);
    assert.deepEqual(actions[0].argv, ["braindump", "status"]);
  }
  assert.equal(say("brain dump status please").outcome.kind, "nomatch");   // status takes no argument
});

test("a note needs text: the bare command words fail with what is expected", () => {
  for (const spoken of ["note", "brain dump", "brain"]) {
    const { outcome, actions } = say(spoken);
    assert.equal(outcome.kind, "incomplete", spoken);
    assert.deepEqual(actions, []);
  }
});

test("a misheard command word does not capture", () => {
  assert.notEqual(say("nope buy milk").outcome.kind, "matched");
  assert.deepEqual(say("brand dump buy milk").actions, []);
});

test("config: command, state and vault come from packs.braindump", () => {
  const config = withPack({ command: "/home/me/go/bin/braindump", state: "/data/bd", vault: "/home/me/second-brain" });
  const cap = say("note hello there", config).actions[0];
  assert.deepEqual(cap.argv, ["/home/me/go/bin/braindump", "capture", "--state", "/data/bd"]);
  const st = say("brain dump status", config).actions[0];
  assert.deepEqual(st.argv, ["/home/me/go/bin/braindump", "status", "--state", "/data/bd", "--vault", "/home/me/second-brain"]);
});

test("config: an unusable command setting falls back to the default", () => {
  assert.deepEqual(say("note hello", withPack({ command: 42, state: 7 })).actions[0].argv, ["braindump", "capture"]);
  assert.deepEqual(say("note hello", withPack({ command: "  " })).actions[0].argv, ["braindump", "capture"]);
});

test("the pack can be switched off", () => {
  assert.notEqual(say("note buy milk", withPack({ enabled: false })).outcome.kind, "matched");
});

test("help lists it as a topic with its own rows", () => {
  const phrases = rows(describe(buildRegistry(builtinPacks, defaults))).filter((r) => r.topic === "braindump").map((r) => r.phrase);
  assert.deepEqual(phrases, [
    "note to <file> in <dir> <text>", "note to <file> <text>", "note <text>",
    "braindump status", "braindump to <file> in <dir> <text>", "braindump to <file> <text>", "braindump <text>",
    "brain dump status", "brain dump to <file> in <dir> <text>", "brain dump to <file> <text>", "brain dump <text>",
  ]);
  assert.equal(say("help braindump").outcome.kind, "matched");
});

// ---- placement: note to <file> [in <dir>] <text> ----

const placed = withPack({
  files: { "daily log": "areas/daily-log", standup: "projects/Acme/Standup", "Weekly Review": "areas/reviews/weekly.md" },
  dirs: { "deep work": "areas/work" },
});
const capture = (spoken, config = placed) => {
  const { outcome, actions } = say(spoken, config);
  assert.equal(outcome.kind, "matched", spoken);
  return actions;
};

// What was said -> [flags after `capture`, the text queued].
const placements = {
  "Note to daily log: Renew my passport, by May.": [["--file", "areas/daily-log"], "Renew my passport, by May."],
  "note to standup ask about the SLA": [["--file", "projects/Acme/Standup"], "ask about the SLA"],
  "brain dump to standup Ask Sam": [["--file", "projects/Acme/Standup"], "Ask Sam"],
  "braindump to weekly review shipped it": [["--file", "areas/reviews/weekly.md"], "shipped it"],
  "Note to todo in areas, email Sam.": [["--dir", "areas", "--file", "todo"], "email Sam."],
  "note to retry in resources notes on jitter": [["--dir", "resources", "--file", "retry"], "notes on jitter"],
  "note to ideas in deep work try ripgrep": [["--dir", "areas/work", "--file", "ideas"], "try ripgrep"],
  "note to standup in archives old one": [["--dir", "archives", "--file", "Standup"], "old one"],   // a known file lends its name
  "note to todo in project buy milk": [["--dir", "projects", "--file", "todo"], "buy milk"],
};

for (const [spoken, [flags, expected]] of Object.entries(placements)) {
  test(`"${spoken}" files the note ${flags.join(" ")}`, () => {
    const [action, ...rest] = capture(spoken);
    assert.equal(rest.length, 0);
    assert.equal(action.type, "note.capture");
    assert.equal(action.text, expected);
    assert.deepEqual(action.argv, ["braindump", "capture", ...flags]);
    assert.equal(action.private, true);
  });
}

test("placement flags come after --state and before the text, which stays on stdin", () => {
  const config = withPack({ state: "/data/bd", files: { standup: "projects/Acme/Standup" } });
  const [action] = capture("note to standup hello there", config);
  assert.deepEqual(action.argv, ["braindump", "capture", "--state", "/data/bd", "--file", "projects/Acme/Standup"]);
  const argv = toArgv(action);
  assert.equal(argv[4], "hello there");
  assert.deepEqual(argv.slice(5), action.argv);
});

test("a file that isn't known, with no folder, queues the note unplaced and says so", () => {
  const [action, toast, ...rest] = capture("Note to call mom about Sunday.");
  assert.equal(rest.length, 0);
  assert.equal(action.type, "note.capture");
  assert.equal(action.text, "to call mom about Sunday.");
  assert.deepEqual(action.argv, ["braindump", "capture"]);
  assert.equal(toast.type, "notify");
  assert.ok(!JSON.stringify(toast).includes("mom"));   // the toast never quotes the note
});

test("a folder must be a known one; a note is never filed under a mishearing", () => {
  for (const spoken of ["note to todo in the morning call mom", "note to todo in zebra stuff"]) {
    const { outcome, actions } = say(spoken, placed);
    assert.equal(outcome.kind, "nomatch", spoken);
    assert.deepEqual(actions, []);
  }
});

test("placement needs text", () => {
  for (const spoken of ["note to standup", "note to todo in areas", "note to", "note to todo in"]) {
    const { outcome, actions } = say(spoken, placed);
    assert.equal(outcome.kind, "incomplete", spoken);
    assert.deepEqual(actions, []);
  }
});

test("a spoken file name never reaches argv unless it is config or one plain word", () => {
  const spokenFlag = capture("note to --dir in areas hello")[0];   // normalised: "dir" is the word
  assert.deepEqual(spokenFlag.argv, ["braindump", "capture", "--dir", "areas", "--file", "dir"]);
  for (const action of capture("note to ../../etc in areas hello")) {
    assert.ok(action.argv.every((part) => !part.includes("..") && !part.includes("/etc")), JSON.stringify(action.argv));
  }
  assert.equal(capture("note to a/b in areas hi").length > 0, true);
  for (const a of capture("note to todo in areas $(rm -rf /) `x`")) {
    if (a.argv) assert.ok(a.argv.every((part) => /^[A-Za-z0-9/._ -]+$/.test(part)), JSON.stringify(a.argv));
  }
});

test("config: unusable file and folder entries are dropped, the rest still work", () => {
  const config = withPack({
    files: { bad1: "-rf", bad2: "/etc/passwd", bad3: "a/../b", bad4: 7, bad5: "", good: "areas/good" },
    dirs: { bad: "../x", mine: "areas/mine" },
  });
  assert.deepEqual(capture("note to good hi", config)[0].argv, ["braindump", "capture", "--file", "areas/good"]);
  assert.deepEqual(capture("note to x in mine hi", config)[0].argv, ["braindump", "capture", "--dir", "areas/mine", "--file", "x"]);
  assert.equal(capture("note to bad1 hi", config)[0].argv.includes("--file"), false);   // unknown: unplaced
  assert.equal(say("note to x in bad hi", config).outcome.kind, "nomatch");
});

test("a note that starts with 'to' still works when no file is configured", () => {
  const [action] = capture("note to buy milk", defaults);
  assert.equal(action.text, "to buy milk");
  assert.deepEqual(action.argv, ["braindump", "capture"]);
});

test("placed notes are private and leave no words in logs or toasts", () => {
  const config = parse(JSON.stringify({ feedback: { notifyOnSuccess: true }, packs: { braindump: { files: { standup: "projects/Acme/Standup" } } } })).config;
  const { effects } = run(initialState(config), ...press, saying("Note to standup zebrasecret"), unlocked);
  assert.ok(effects.some((e) => e.type === "note.capture" && e.text === "zebrasecret"));
  for (const e of effects.filter((x) => x.type === "log" || x.type === "notify")) {
    assert.ok(!JSON.stringify(e).includes("zebrasecret"), JSON.stringify(e));
  }
});

// ---- the translator ----

test("capture sends the text on stdin as one argument, after the configured command", () => {
  const argv = toArgv({ type: "note.capture", argv: ["braindump", "capture"], text: "- [ ] it's $HOME `x` \"y\"; rm -rf /" });
  assert.deepEqual(argv.slice(0, 4), ["sh", "-c", "text=$1; shift; printf '%s' \"$text\" | \"$@\"", "vocon-note"]);
  assert.equal(argv[4], "- [ ] it's $HOME `x` \"y\"; rm -rf /");
  assert.deepEqual(argv.slice(5), ["braindump", "capture"]);
});

test("the note text never appears in the script itself", () => {
  const argv = toArgv({ type: "note.capture", argv: ["braindump", "capture"], text: "zebrasecret" });
  assert.ok(!argv[2].includes("zebrasecret"));
});

test("translator rejects bad input", () => {
  const ok = { type: "note.capture", argv: ["braindump", "capture"], text: "hi" };
  assert.throws(() => toArgv(Object.assign({}, ok, { text: "   " })), /nothing to capture/);
  assert.throws(() => toArgv(Object.assign({}, ok, { text: "a\u0000b" })), /not acceptable/);
  assert.throws(() => toArgv(Object.assign({}, ok, { text: "x".repeat(200001) })), /not acceptable/);
  assert.throws(() => toArgv(Object.assign({}, ok, { argv: [] })), /invalid braindump command/);
  assert.throws(() => toArgv(Object.assign({}, ok, { argv: ["braindump", ""] })), /invalid braindump command/);
  assert.throws(() => toArgv(Object.assign({}, ok, { argv: "braindump capture" })), /invalid braindump command/);
  assert.throws(() => toArgv({ type: "note.status", argv: null }), /invalid braindump command/);
  assert.equal(toArgv({ type: "hypr.focusWorkspace", workspace: 1 }), null);
});

test("status runs the configured argv unchanged", () => {
  assert.deepEqual(toArgv({ type: "note.status", argv: ["braindump", "status"] }), ["braindump", "status"]);
});

// ---- through the session ----

const run = (state, ...events) =>
  events.reduce((acc, e) => {
    const r = reduce(acc.state, e);
    return { state: r.state, effects: acc.effects.concat(r.effects) };
  }, { state, effects: [] });
const press = [{ type: "PttPressed" }, { type: "PttReleased" }];
const unlocked = { type: "ClientsSnapshot", clients: [], unlocked: true };
const saying = (text) => ({ type: "TranscriptReceived", text });

test("a note leaves no trace of its words in logs or toasts, even with notifyOnSuccess", () => {
  const config = parse(JSON.stringify({ feedback: { notifyOnSuccess: true } })).config;
  const { effects } = run(initialState(config), ...press, saying("Note: zebrasecret passport"), unlocked);
  assert.ok(effects.some((e) => e.type === "note.capture" && e.text === "zebrasecret passport"));
  for (const e of effects.filter((x) => x.type === "log" || x.type === "notify")) {
    assert.ok(!JSON.stringify(e).includes("zebrasecret"), JSON.stringify(e));
  }
});

test("other commands still get the success toast", () => {
  const config = parse(JSON.stringify({ feedback: { notifyOnSuccess: true } })).config;
  const { effects } = run(initialState(config), ...press, saying("Space 1."), unlocked);
  assert.ok(effects.some((e) => e.type === "notify"));
});

test("nothing is captured while the screen is locked", () => {
  const { effects } = run(initialState(), ...press, saying("note zebrasecret"), { type: "ClientsSnapshot", clients: [], unlocked: false });
  assert.ok(!effects.some((e) => e.type === "note.capture"));
});

test("armed dictation types the words instead of capturing them", () => {
  const armed = run(initialState(), ...press, saying("dictate"), unlocked);
  const { effects } = run(armed.state, ...press, saying("note buy milk"), unlocked);
  assert.ok(effects.some((e) => e.type === "text.type"));
  assert.ok(!effects.some((e) => e.type === "note.capture"));
});
