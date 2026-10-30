# Assistant mode: remaining work

Written 2026-10-30 after slices 1-3 and the README docs. The decisions and rules live in `AGENTS.md`
(section "Assistant mode" and the decisions log) and the user docs in `README.md` ("Assistant mode
(optional)"). This file is the task list, the live-test recipe and the loose ends. Delete or update it as
items are done.

## Where things stand

Built: slice 1 `e860556` (pure core), slice 2 `8e7718e` (session logic), slice 3 `83edef6` (live edge:
Auth/Llm/IPC/keybind/unlock), then the README docs and a fix to two stale "touch the sensor" toast texts.
At that point: 325 node tests, 18 QML tests, `omarchy plugin validate .` exit 0.
The owner commits (AGENTS.md "Working agreements"); give a one-line `git add -A && git commit -m ...` at the
end of each slice. A pre-commit hook in Claude Code sessions blocks committing on `main`.

What works (verified live with the real model on throwaway windows): password unlock via floating terminal,
send/bring/focus, ambiguous question answered by `choose 2`, by a spoken "the first one", and cancel.
Latency: ~13 s first request after the model unloaded, ~6-8 s warm, ~0.6 s for a spoken answer.

## Remaining slices, in suggested order

### Slice 4: the "which window?" overlay (+ fold in the security fixes)
Replaces the stand-in toast (`assistant.clarify.show` in `infra/Executor.qml`; `hide` is a no-op today).
- `manifest.json` has ONE overlay entry (`Help.qml`), summoned with `shell.summon("vocon", json)`. Either
  make that entry handle a payload `kind` (help | clarify) or find out whether a second overlay is allowed.
  Read `Help.qml` first: it holds exclusive keyboard focus and draws a filterable list.
- Rows are `{ number, text, workspace }` (built by `clarifyRows` in `core/assistant/windows.mjs`; no addresses).
  Keys 1-6 -> IPC `choose(n)` / `ChoiceSelected`; Esc -> `Cancelled`; `assistant.clarify.hide` closes it.
  The voice answer (assistant key + "the second one") must keep working while it is open.
- Order the rows by recency or title, not Hyprland's address order (today "choose 2" is arbitrary).
- Show the workspace and class next to the title. Overlay text is drawn by Qt: titles are untrusted.
- Live-test with scratch windows (recipe below); do not screenshot-trust, also exercise Esc and number keys.

### Security findings to fix (from the 2026-10-30 review of `3756683..HEAD`; none exploitable, all low)
1. **Lock re-probe** (real regression of AGENTS.md invariant 8). `finish()` in `core/assistant/session.mjs`
   runs actions from `ModelReplied` and `ChoiceSelected` without a fresh screen-lock check; the probe ran up to
   30 s + 30 s earlier. Fix: `Service.qml` probes `ScreenLock` before dispatching those two events and stamps
   `unlocked`; the reducer refuses unless `event.unlocked === true` (fail closed, like `ClientsSnapshot`).
   Add tests (locked at reply time -> no actions, toast; same for choose).
2. **Markup in toasts.** `label(win)` puts a raw window title into `notify` bodies (success and "nothing to do").
   Only the clarify toast escapes. Escape `& < >` in the `notify` handler of `Executor.qml` for assistant bodies
   (or all). Older toasts quoting a transcript have the same property (pre-existing).
3. **Redirects.** `infra/Llm.qml`: treat any 3xx `xhr.status` as a failure (Qt's XHR may follow a redirect from the
   loopback port to another host; unverified). Optionally sanity-check the reply shape.

### Config hot reload (investigate; README and AGENTS.md disagree)
README says the config "reloads when you save"; the live test showed it did NOT (neither `jq > tmp && mv`
nor an in-place `cat > file`; no `config loaded` log line; a shell restart loads it). `infra/ConfigStore.qml`
uses `FileView { watchChanges: true; onFileChanged: reload() }`. Find out why (path binding? Quickshell 0.3.2
FileView semantics? the plugin's FileView only reloads on some event?), fix it, or correct the README lines
(~444 and ~500) and the Troubleshooting row. The new assistant docs already tell users to restart the shell.

### Smaller items
- `bring` with nothing focused says it can't tell the current workspace. Add `hyprctl activeworkspace -j` to the
  snapshot (`infra/Hyprland.qml` -> `ClientsSnapshot.workspace`) and use it in `currentWorkspace`.
- Live checks never done: real microphone + keybind (run `bin/vocon-keybind`, hold/release F8; the keybind was
  only tested against a stubbed `hyprctl`), Ollama down (stop the service: "Couldn't reach Ollama"), the question
  timing out (`clarifySeconds`), the fingerprint method (owner has no reachable sensor, lid shut), the toast's
  visual rendering.
- Three wrong passwords can trip faillock; if you test the failure path, do ONE wrong attempt at most.

## Ideas, not started
- A deterministic fast path that skips the model when the words match exactly one window (cuts ~6 s).
- More capabilities on the same engine. The owner chose windows first; Slack is blocked (no permission to
  install Slack apps; workflows can't read or reply as the user; the Slack MCP costs 10-30x per request and goes
  to the cloud). `gh` here is logged in as `lendio-catalyst-bot` (GH_TOKEN), not the owner, so a GitHub-PR use
  case needs the owner's own login first. Notes: the existing braindump pack already covers capture.
- Any outward-facing action (sending text) needs its own show-the-exact-text-then-confirm step; AGENTS.md rule 4.

## How to resume

Read: `AGENTS.md` (Assistant mode section + decisions log), then `core/assistant/*.mjs`,
`core/listening/session.mjs` (`settle`, `step`), `infra/Auth.qml`, `infra/Llm.qml`, `infra/Executor.qml`, `Service.qml`.

Commands:
```sh
node --test $(ls tests/*.test.mjs)                                        # 325 at last run
QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -input tests/qml/tst_core.qml   # 18
omarchy plugin validate .
bin/vocon-install --restart      # copies the repo into ~/.config/omarchy/plugins/vocon and restarts the shell
```
After any plugin change the running shell keeps the old code until `omarchy-restart-shell`. Confirm new code is
live before trusting a live test (e.g. a new IPC function answers).

Live-test recipe (AGENTS.md "Live testing rules"): back up `~/.config/vocon/config.json`, set
`"assistant": {"enabled": true}`, restart the shell, `omarchy-shell vocon assistStart` (type the sudo password in
the small terminal), then drive `assistSimulate "<text>"` against two throwaway `ghostty --class=com.vocon.scratch*
-e sleep 600` windows; check `hyprctl clients -j`; restore focus and the config afterwards. Never inject keystrokes
into real apps.

## Environment this was built and tested on
- Omarchy 4, Hyprland 0.56, Quickshell 0.3.2; Ryzen 7 7735U with the integrated Radeon 680M; 61 GB RAM; lid
  shut and docked (no reachable fingerprint sensor, hence the password unlock).
- Ollama (official `ollama` + `ollama-vulkan`) with `OLLAMA_IGPU_ENABLE=1`; models `gpt-oss:20b` (used) and
  `qwen3:8b` (compared). F9 is VoxType's key and F10 vocon's; the assistant defaults to F8.
- The plugin was installed as a dev copy (`bin/vocon-install`, no `.git`), so re-run it after changes.
- The benchmark and live-check scripts used during development were throwaway and are not in the repo. Their
  results are summarised in the AGENTS.md decisions log. If the live check is worth keeping, turn it into a
  script under `tests/` that spawns the scratch terminals, drives `assistSimulate`, asserts with
  `hyprctl clients -j`, and restores focus.
