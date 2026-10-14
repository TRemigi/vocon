# AGENTS.md — vocon

Guidance for anyone (human or agent) changing this repo. It records the constraints we
committed to and the decisions behind them. **Read it before changing code; update it when you
change a decision.** `README.md` is the user-facing doc; this file is the "why" and the rules.

## What vocon is

A push-to-talk voice-control plugin for the **Omarchy 4** Quickshell shell. Hold a configurable
key, speak, release: the transcript is matched against a known set of commands and the resulting
actions run (focus/move workspaces and windows, open/focus apps, drive Slack, dictate text, run
user-defined commands).

### Hard requirements (do not weaken)

1. **Push-to-talk via a configurable key** (default F10), press and release both handled.
2. **VoxType does the speech-to-text, and it stays local-only.** No cloud STT, no network calls
   for transcription. Engine/model choice is the user's config, not ours.
3. **Transcripts are matched against a list of known commands.** Nothing is executed that a
   command definition didn't explicitly produce.
4. **DDD style, functional-leaning.** Pure core, side effects isolated at the edge.
5. **Configurable, pluggable, extensible.** New features arrive as packs/adapters/config, not by
   editing the core.

## Architecture: functional core, imperative shell

```
Hyprland key press/release
  -> `omarchy-shell -q vocon start|stop`            (bin/vocon-keybind writes the binding)
  -> Service.qml  IpcHandler "vocon"                (composition root; only dispatches events)
  -> Session.reduce(state, event) -> { state, effects }      PURE  (core/listening/session.mjs)
        TranscriptReceived + ClientsSnapshot  ->  pipeline.interpret()   PURE
              normalize -> parser.parse over the command tree -> node.run -> action descriptors
  -> Executor.qml interprets effect/action descriptors (the ONLY place that does things)
        voxtype / hyprctl / wtype / notify-send / uwsm-app via Process + execDetached
```

- **Everything under `plugin/core/` is pure ES modules (`.mjs`).** No Qt, no Quickshell, no I/O,
  no clocks, no randomness, no mutation of inputs. They are loaded by QML *and* by `node --test`.
- **Side effects live only in `plugin/Service.qml` and `plugin/infra/`.** `infra/Run.qml` wraps
  `Process`; `Voxtype.qml`, `Hyprland.qml`, `ConfigStore.qml`, `Executor.qml` are the edges.
- **Effects are data.** The core returns descriptors (`{ type: "keys.send", steps }`); the shell
  interprets them. A new capability = a new descriptor type + a translator + an executor handler
  (see "Adding an action type"). The core never calls a shell function.
- **Elm-style session.** All state transitions are `reduce(state, event)`; the QML only feeds it
  events (`PttPressed`, `PttReleased`, `TranscriptReceived`, `ClientsSnapshot`, `RecordingFailed`,
  `WatchdogExpired`, `Cancelled`, `ConfigLoaded`, `DictationExpired`) and runs the effects.
- **Bounded contexts** (directories under `plugin/core/`):
  | Context | Owns |
  |---|---|
  | `listening/` | the push-to-talk session state machine, dictation arming |
  | `interpretation/` | normalising transcripts, word scoring, slot types, the tree parser |
  | `commands/` | the command tree DSL, the registry/merging, all packs |
  | `execution/` | action descriptors and their translators (hyprctl, wtype), window lookup |
  | `config.mjs`, `pipeline.mjs` | config parse/validate/defaults; the single `interpret()` entry point |
- **JS dialect: ES2017-conservative, `var` + function expressions** (the existing style). QML's V4
  engine loads these files. Avoid object spread, `flatMap`, optional chaining, etc.; use
  `Object.assign` and `reduce`. `tests/qml/tst_core.qml` loads the real core under Qt's engine and
  is the guard — add to it when you add a module or a new syntax form. `.mjs` modules importing
  each other works under Qt 6.11 (verified).
- **No new runtime dependencies** in the core. Node/QML test tooling only.

## The command model (decided in slice 2; do not regress)

Commands are **CLI-like**: a command word, then arguments, parsed left to right — not free-form
phrases. Example: `move focused space 1` = `move` → `focused` → `space` → `<workspace>`.

- The command set is a **tree of nodes** (`commands/dsl.mjs`): `command`/`keyword(name, opts,
  children)` and `value(name, slotType, opts)`. A node with `run(args, ctx, path) -> actions` is a
  valid end of a command. Options: `words` (synonyms), `when(ctx)`, `run`.
- **`parser.mjs` resolves one token per level against only that node's children.** No
  backtracking, no scoring of whole phrases against each other. Consequently commands cannot
  "compete"; future arguments (`move all`, `move focused group dev`) are just more nodes.
- **Misrecognition is handled per word**, via `words.mjs`: exact (1) > alias (0.9, from
  `config.matching.aliases`) > fuzzy (similarity >= `matching.threshold`, only words >= 4 chars).
  Aliases are keyed by the *command word* and map to what the recogniser tends to produce
  ("space" <- "pace", "base"; "claude" <- "cloud", "clod").
- **Ambiguity** can only occur when two sibling words with *different names* fit one token about
  equally (fuzzy only). It is reported, never guessed. Same-named siblings (e.g. one first word
  under different `when`s) are **joined** and the next word decides (`joinSiblings`).
- **Keyword children are tried before the value child**, so a user keyword (`open notes`) beats the
  generic `open <app>`.
- **`words` slot (`wordsSlot`) consumes the rest of the utterance** → it must be the last word.
- **Synonyms must not collide across active nodes.** (We removed `send` as a synonym of `move`
  because the Slack `send` needs the word.) The registry flags identical sibling words, but not
  words shared with a `when`-scoped node, so check by hand and by test.
- **Failures are positional**: `incomplete` / `nomatch` carry `path` and `expected` (each word once)
  and become notifications ("missing after “move”, expected: focused").
- The registry **merges same-named root nodes across packs** (this is how a pack extends another's
  command) and reports conflicts (`defined twice`, colliding sibling words, several value children,
  dead ends). On a conflict the first definition wins. Nodes with `when` are never merged.

## Safety invariants (security-relevant; tests exist for each — keep them)

1. **Speech never becomes a command.** Slots resolve to numbers, catalog keys, or normalised
   words. Every `exec`/`app.launch` argv comes from **config or pack code only**, never from the
   transcript. Everything is an argv array; there is no shell string built from speech.
2. **Translators validate and throw** rather than pass bad data on: workspace = positive integer;
   window address = `0x[0-9a-f]+`; key names `[A-Za-z0-9_]+`; modifiers from a fixed list; typed
   text may not start with `-` or contain control characters (wtype would read it as an option /
   press Enter).
3. **Dictated text is arbitrary**, so it goes `sh -c 'printf %s "$1" | wtype -'` (stdin, one
   argument), is flattened (newlines → spaces; a newline would press Enter) and trimmed, and
   **is never logged** — only its length.
4. **Destructive or sending commands exist only in the focused-app form.** `send`, `edit`,
   `delete`, `confirm` work only while Slack is focused; the `slack …` from-anywhere form is
   navigation only. `delete` only opens Slack's confirmation; `confirm` accepts it. Keep new
   high-impact commands scoped the same way.
5. **Dictation is single-shot, time-limited, and focus-bound**: expires (`dictation.armSeconds`),
   discarded if the focused window changed, `cancel` stops it, and `dictation.ignore` drops
   Whisper's silence hallucinations ("thank you for watching").
6. **An unusable config never wipes the working one.** Bad JSON → notification + keep previous
   config (`parse().ok === false`). Problems inside a valid file drop only the bad entry and report.
   Config validation **returns errors; it never throws.**
7. **Never run `stop` after a failed start**, and never cancel a recording vocon didn't start:
   `Voxtype.qml` checks the daemon is up and idle first and verifies 0.8 s later that it really
   began recording.

## Packs, adapters and how to extend

A **pack** is `{ id, commands(config) -> [root nodes], slotTypes?(config) -> { name: slotType } }`,
registered in `plugin/core/commands/packs/index.mjs`. It is active unless
`config.packs[id].enabled === false`. Built in: `hyprland`, `apps`, `slack`, `dictation`, `custom`.

- **App adapters** are packs whose root nodes carry `when(ctx)`; `ctx.active` is the focused
  window (derived from `hyprctl clients` `focusHistoryID === 0`), `ctx.clients` all windows.
  `tests/adapter.test.mjs` is the worked example; `packs/slack.mjs` is the full one.
- **User commands** (`config.commands`) become chains of keyword nodes (`custom.mjs`); `say` is the
  words, with `exec` | `launch` and optional `when.activeClass`.
- **App catalog** (`config.apps`) feeds `open <app>` / `focus <app>`: `match` (regex on window
  *class*), `launch` (argv), `aliases`. Built-in apps claim their spoken names first.
- **Slot types**: `workspace` (1..N), `app` (catalog, longest name wins), `words` (rest of
  utterance). A slot's `parse(tokens, i)` returns candidates `[{ value, next }]`, longest first.

### Adding a pack (checklist)
1. Write `plugin/core/commands/packs/<id>.mjs` (pure; `var`/functions; ES2017).
2. Register it in `packs/index.mjs`; add `<id>: {}` to `defaults.packs` in `config.mjs`.
3. Tests: behaviour per context, safety cases, registry stays conflict-free (`registryErrors`),
   disable switch works. Extend `tests/qml/tst_core.qml` if it introduces new syntax or modules.
4. Document the commands and any limits in `README.md`.

### Adding an action type
1. Constructor in `execution/actions.mjs`.
2. Pure translator to argv in `execution/` (validate; throw on bad input; return `null` for
   types it doesn't own) — see `hyprctl.mjs`, `keys.mjs`.
3. `Executor.qml`: a `handlers` entry for effects the shell performs, or rely on the existing
   fallthrough (`Hyprctl.toArgv(effect) || Keys.toArgv(effect)` → detached run).
4. Unit-test the translator including the rejection cases.

## Platform facts and gotchas (all learned the hard way)

**Omarchy / Quickshell**
- Plugin = `plugin/` copied to `~/.config/omarchy/plugins/vocon/`. **Symlinks are rejected**, so
  `bin/vocon-install` copies. Third-party plugins are enabled by an **object** `{"id":"vocon"}` in
  `shell.json` `plugins[]` (not a bare string). Plugin ids may not start with `omarchy.`.
- **A running shell keeps the old service code** after a reinstall (the QML engine caches
  modules); disable/enable does not help. Use `bin/vocon-install --restart`
  (`omarchy-restart-shell`, the bar redraws briefly). Always confirm new code is live (e.g. a log
  line you just added) before trusting a live test.
- Service plugins get **no injected settings** and aren't reachable via `omarchy-shell shell call`;
  vocon declares `IpcHandler { target: "vocon" }`: `start`, `stop`, `cancel`, `status`,
  `dictation`, `simulate <text>`. `omarchy-shell` has a **2 s IPC timeout** → handlers only
  dispatch events and return.
- **`Process.onExited` can fire before `StdioCollector` has its text.** Never read output in
  `onExited`; use `infra/Run.qml` (reports once the process exited *and* streams drained).
- Config lives in `~/.config/vocon/config.json` (JSON, hot-reloaded via `FileView`). Logs:
  `qs log -p /usr/share/omarchy/shell | grep vocon:` (transcripts appear as `vocon: heard "…"`).

**VoxType**
- Text comes back to a caller with `voxtype record start --file=<path> --no-osd` then
  `voxtype record stop --wait --json` → `{"status":"ok|empty|…","text":…}`. There is no stdout
  output mode. State: `$XDG_RUNTIME_DIR/voxtype/state` (`idle|recording|streaming|transcribing`).
- **`audio.device` takes ALSA names** (`sysdefault:CARD=B101`), *not* `pactl` source names, despite
  the config comment. A wrong name makes `record start` exit 0 and then fail silently in the daemon.
- **Bluetooth headsets lose ~1.2–1.6 s of audio** when the mic opens (A2DP → headset profile
  switch), clipping the first word ("space" → "pace"/"base"). Record from another mic; keep the
  headset for output. This is why accuracy problems are usually audio, not the model.
- Whisper hallucinates on silence ("Thank you for watching!"). `base.en` is the smallest model;
  `whisper.initial_prompt` biases vocabulary; GPU/VAD (`voxtype setup gpu|vad`) are untried.

**Hyprland 0.56 (Lua config)**
- Dispatch with Lua expressions: `hyprctl dispatch 'hl.dsp.focus({ workspace = "1" })'`,
  `hl.dsp.window.move({ workspace = "1" })`, `hl.dsp.focus({ window = "address:0x…" })`,
  `hl.dsp.window.close()`. Keybindings are `o.bind(...)` in `~/.config/hypr/bindings.lua`;
  push-to-talk = a press binding plus `{ release = true }`.
- **`follow_mouse = 1`**: focus follows the pointer, so anything that injects keystrokes can land
  in the wrong window if the mouse moves. See "Testing".
- Window matching is on **class only**, with Omarchy's `\bpattern\b` case-insensitive regex.
  Title matching was rejected: a browser tab titled "Slack" must not count as Slack. Don't let the
  browser pattern match bare `chrome` (webapps are `chrome-<site>-Default`).
- Apps launch via `setsid uwsm-app -- <argv>`, like Omarchy's own bindings.

**Keyboard injection (`wtype`)**
- `wtype -M ctrl -k Tab -m ctrl -s 300 "text" -k Return` (installed with VoxType). Omarchy's own
  `clipboard.lua` notes Hyprland's `send_shortcut` can leave keys stuck, so we do **not** use it.
- Slack shortcuts come from Slack's docs (Windows/Linux). **There is no documented "focus the
  message field" shortcut**, so none is offered. Esc marks a conversation read, so it's not exposed.
  Slack's send key is Enter by default (`packs.slack.send` to change); switcher timing is
  configurable (`switcherDelay`, `resultsDelay`, `focusDelay`).

## Testing and verification

- **Unit tests** (`node:test`, no deps), one file per area: `tests/*.test.mjs`. Run files by path,
  e.g. `node --test tests/slack-pack.test.mjs tests/session.test.mjs …` (some environments block
  directory-wide test runs). The README lists the full command. **QML guard:**
  `QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -input tests/qml/tst_core.qml`.
  `omarchy plugin validate plugin` must pass.
- `tests/examples.test.mjs` validates both shipped example configs, so they cannot rot.
- **Test the pure core, table-driven.** Cover: each user scenario, mishearings, negative cases,
  safety/rejection cases, and "does nothing when out of scope".
- **Live testing rules** (keystrokes are real and focus follows the mouse):
  - Drive the real pipeline without a microphone: `omarchy-shell vocon simulate "<text>"`.
  - **Never inject keystrokes into a real app (Slack, a chat, an editor).** Use throwaway
    terminals running `stty raw -echo; cat -v > log` that record what they receive (the
    `packs.slack.match` setting can point the Slack pack at a scratch window class). Add a decoy
    window, re-check the focused window before *every* injection, and abort on mismatch.
  - Ask the user before injecting keys on their live desktop; restore focus and config afterwards;
    back up `~/.config/vocon/config.json` before editing and restore it.
  - Gate any command that acts on "the focused window" on the focused window actually being the
    expected one before running it.

## Working agreements (the owner's preferences)

- The owner commits. Don't commit or push unless asked; at the end of each slice, give a
  **single-line `git add -A && git commit -m …` command**.
- When something is unavailable or risky (a missing shortcut, an unverified behaviour), say so
  plainly rather than shipping a guess. Report test gaps as gaps.
- Keep `README.md` in step with behaviour; keep this file in step with decisions.
- Prefer `Edit` over rewriting files; match the surrounding style and comment density.

## Decisions log (what we chose, and what we rejected)

| Decision | Why / alternative rejected |
|---|---|
| Functional core in `.mjs`, shell in QML | Testable with plain node; one place for side effects. |
| CLI-style command tree instead of phrase templates + scoring | Slice 1–2 used whole-phrase templates and scored ties; the owner wanted deterministic, CLI-like, easily-extended commands. Strict grammar: free-form phrasing is intentionally unsupported. |
| Per-word fuzzy/alias matching | Whisper mishears single words (space→base/pace, claude→cloud); fix it where it happens. |
| `omarchy-launch-or-focus` **not** used directly (for now) | It needs the spoken word to equal class *and* binary, doesn't validate names, `eval`s its launch string, matches titles, and can't focus-only. We own `findWindow` + `app.launch` with a catalog instead. The considered alternative: discover apps from `DesktopEntries` and delegate to the script — deferred, not rejected on merit. |
| Class-only window matching | Avoid browser-tab-titled-"Slack" false positives. |
| `keys.send` via `wtype`, not Hyprland `send_shortcut` | Stuck-key quirk documented in Omarchy; `wtype` is already a VoxType dependency. |
| Dictation as session state, single-shot, focus-bound | A later command must never be typed into a window; VoxType's own typing mode would collide with vocon's recording. |
| Slack: scoped short forms + `slack …` navigation-only form | Hands-free from anywhere, but sending/deleting only on a window the user is looking at. |
| Invalid config keeps last good | Bad JSON used to reset to defaults and silently drop the user's apps. |
| Dropped `send` as a synonym of `move` | Collided with Slack's `send`. |

## Known limitations and backlog

- Slack: no "focus message field"; real-Slack behaviour of the shortcuts/timings is documented but
  was only verified against scratch windows. `message` depends on a Slack preference.
- The match score logged for `open <app>` ignores alias/fuzzy matches *inside* the app name
  (value nodes always count as 1).
- `when` takes one regex per command; there is no grouping (the browser regex repeats).
- Custom commands have no typed arguments yet (`say: "volume <n>"`); only packs do.
- No automatic re-run of `vocon-keybind` when `pushToTalk.key` changes (re-run it by hand).
- Ideas not built: installed-app discovery from desktop entries; a score that reflects in-slot
  fuzziness; `whisper.initial_prompt` with the command vocabulary; `small.en`/GPU/VAD tuning;
  a real per-app shortcut adapter for browsers/Spotify beyond the `custom-commands` examples.
