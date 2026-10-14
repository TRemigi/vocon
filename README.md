# vocon

Push-to-talk voice control for the [Omarchy](https://omarchy.org) 4 desktop. Hold a key, say a
command, release. vocon turns your speech into text with [VoxType](https://github.com/peteonrails/voxtype)
(**local only, nothing leaves your machine**), matches it against a list of known commands, and
runs the result: switch workspaces, move windows, open or focus apps, drive Slack, dictate text,
or run your own commands.

```
hold F10:   "space 2"                        ->  workspace 2 is focused
hold F10:   "move focused space 1"           ->  the focused window moves to workspace 1
hold F10:   "open slack"                     ->  Slack is focused, or started if it isn't running
hold F10:   "slack channel dev platform"     ->  jumps to #dev-platform in Slack
hold F10:   "dictate"   then   "Hi team..."  ->  your next utterance is typed into the focused window
```

Commands are CLI-like (`move focused space 1`), not free-form sentences, so they are predictable,
and new ones are easy to add.

**Contents:** [How it works](#how-it-works) · [Requirements](#requirements) ·
[Installation](#installation) · [Using vocon](#using-vocon) · [Command reference](#command-reference) ·
[Configuration](#configuration) · [Improving recognition](#improving-recognition) ·
[Troubleshooting](#troubleshooting) · [Updating and uninstalling](#updating-and-uninstalling) ·
[Command-line reference](#command-line-reference) · [Development](#development)

---

## How it works

```
key press  ->  Hyprland binding  ->  vocon (an Omarchy shell plugin)  ->  VoxType records
key release                                                              ->  transcript
transcript + the list of open windows  ->  parsed against the command tree  ->  actions
actions: hyprctl (windows/workspaces), uwsm-app (launch), wtype (keystrokes), notify-send
```

- **Speech-to-text** is VoxType, running locally. vocon only asks it to record and return text.
- **Matching** is deterministic: each word is checked against what is valid at that position in
  the command (`move` -> `focused` -> `space` -> a number). Nothing is guessed from similar-sounding
  whole sentences, and nothing runs unless a command definition produced it. Your speech is never
  passed to a shell.
- **Everything is configurable**: the key, apps, mishearing corrections, and your own commands.

## Requirements

| Needed | Notes |
|---|---|
| Omarchy 4 | Provides the Quickshell shell, Hyprland with its Lua config, `uwsm-app`, `omarchy-shell`. |
| Hyprland 0.56+ | Commands use its Lua dispatchers (`hl.dsp.focus(...)`). Verified on 0.56.2. |
| [VoxType](https://github.com/peteonrails/voxtype) | Installed by Omarchy's own installer (below). Verified on 1.1.0. |
| `wtype` | Sends keystrokes for Slack and dictation. The VoxType installer installs it. |
| `jq` | Used by the install scripts. Ships with Omarchy. |
| A microphone | A **non-Bluetooth** mic is strongly recommended, see [the mic note](#2-choose-your-microphone). |

Optional: `node` (any recent version) to run the unit tests.

## Installation

### 1. Install VoxType

```sh
omarchy-voxtype-install
```

(or in the Omarchy menu: Install -> AI -> Dictation). It installs VoxType and `wtype`, downloads
a speech model (about 150 MB), and starts the `voxtype` user service. Check it is running:

```sh
systemctl --user is-active voxtype      # -> active
```

vocon does **not** use VoxType's own hotkey. Omarchy binds F9 to VoxType dictation; vocon uses a
different key (F10 by default), and the two coexist.

### 2. Choose your microphone

**If you use Bluetooth headphones, read this first.** A Bluetooth headset switches from
high-quality playback to a low-quality call profile when its microphone opens, and sends about
1.5 seconds of silence while it switches. The start of what you say is cut off, so "space" is heard
as "pace" or "base". The mic hardware isn't the problem; the profile switch is. Keep the headset
for *listening* and record from another microphone (a webcam, the laptop mic, a USB mic).

List the microphones VoxType can use:

```sh
arecord -L | grep ^sysdefault
# sysdefault:CARD=Generic_1
# sysdefault:CARD=B101          <- a USB webcam here
# sysdefault:CARD=acp6x
```

Pick one (if unsure, try each and watch what vocon hears, see [Using vocon](#using-vocon)), then:

```sh
voxtype config set audio.device "sysdefault:CARD=B101"
systemctl --user restart voxtype
```

> **Use the ALSA name** (`sysdefault:CARD=...`), not a `pactl` source name, even though VoxType's
> config comment suggests `pactl`. A wrong name makes recording fail silently inside the daemon;
> vocon will tell you "VoxType didn't start recording" if that happens.

If you listen to music, also consider `voxtype config set audio.pause_media false`; by default
VoxType pauses media players for the duration of every recording.

### 3. Install the vocon plugin

Clone or copy this repository somewhere, then from its root:

```sh
bin/vocon-install --restart
```

This validates the plugin, copies it to `~/.config/omarchy/plugins/vocon/` (Omarchy rejects
symlinked plugins, so it copies), enables it in `~/.config/omarchy/shell.json` (a backup is made
first), and creates `~/.config/vocon/config.json` if you don't have one. `--restart` restarts the
Omarchy shell so it loads the plugin; your bar redraws for a moment. It is safe to run again at
any time.

### 4. Bind the push-to-talk key

```sh
bin/vocon-keybind            # uses pushToTalk.key from your config (default F10)
bin/vocon-keybind F11        # or name a key
```

This adds a marked block to `~/.config/hypr/bindings.lua`, reloads Hyprland, and **rolls back
automatically** if Hyprland reports a config error. A backup is saved next to the file. The binding
runs `omarchy-shell -q vocon start` when you press the key and `... stop` when you release it.

Prefer a plain key (F10, F11, ...). Combos that need a modifier held down can lose the key-release
event if the modifier comes up first, which leaves a recording running until the 15-second safety
limit cancels it.

### 5. Verify without speaking

```sh
omarchy-shell vocon status                  # -> idle
omarchy-shell vocon simulate "space 2"      # runs the real pipeline: workspace 2 is focused
omarchy-shell vocon simulate "space 1"      # and back
qs log -p /usr/share/omarchy/shell | grep vocon:
# vocon: heard "space 2" -> matched space (score 1.00)
```

`simulate` feeds text through exactly the same path as a spoken command, **including running the
resulting actions for real** (it will switch workspaces and send keystrokes to the focused window),
so try it with harmless commands first.

### 6. Try it by voice

Hold F10, wait a beat, say **"space 2"**, release. Workspace 2 should focus. Then try
"move focused space 1" and "open terminal". If something is off, see
[Troubleshooting](#troubleshooting).

## Using vocon

**The basic gesture:** hold the key, wait about half a second for VoxType to start capturing, speak
the command, release. Recognition takes a second or two on CPU (faster with a GPU or a smaller model).

**Speak commands in order, without filler.** `move focused space 1`, not "please move the focused
window to space one". Numbers can be digits or words ("space 3" / "space three"). Words that sound
like numbers ("to", "for", "won") are accepted where a number is expected.

**What you'll see:**

- Success is silent by default (the action just happens). Set `feedback.notifyOnSuccess` for a
  notification on every command.
- If something isn't understood you get a notification that says where it went wrong:
  - `"move" - missing after "move", expected: focused` (you stopped too early)
  - `"move window" - no match after "move", expected: focused` (a word that isn't valid there)
  - Slack commands such as `channel` simply aren't commands outside Slack.
- Failures of the machinery (VoxType down, busy, or failing to start recording) are reported with
  what to do next.
- Everything vocon hears is logged: `qs log -p /usr/share/omarchy/shell | grep vocon:`
  (dictated text is the exception; only its length is logged).

**Cancelling:** `omarchy-shell vocon cancel` stops a recording, and disarms dictation.

## Command reference

### Workspaces and windows

| Say | Does |
|---|---|
| `space <n>` (or `workspace <n>`) | focus workspace n |
| `move focused space <n>` | move the focused window to workspace n **and follow it** |

`<n>` is 1-10. `focused` also accepts `focus` and `current`; `space` also accepts `workspace`.
To move a window without following it, set `packs.hyprland.moveFollows` to `false`. Change the
workspace count with `packs.hyprland.workspaces`.

### Apps

| Say | Does |
|---|---|
| `open <app>` (or `launch`, `start`) | focus the app's window if it is open, otherwise start it |
| `focus <app>` | focus the app's window; tells you if it isn't running (never launches) |

Built-in apps: `terminal`, `browser`, `files` (or `nautilus`), `spotify`, `obsidian`. Add your own
in the [app catalog](#app-catalog). `open terminal` focuses the terminal you already have; for a
second one, add a command (see [custom commands](#custom-commands)).

### Dictation

| Say | Does |
|---|---|
| `dictate` | the **next** time you hold the key, your speech is typed into the focused window instead of being treated as a command |
| `cancel` (as the dictated phrase) | cancels dictation |

Dictation is deliberately constrained so words can't land somewhere unintended:

- It is **single-shot**: after one utterance is typed, vocon goes back to commands.
- It **expires** after 30 seconds (`dictation.armSeconds`).
- It is **discarded if the focused window changes** between saying `dictate` and speaking.
- Things Whisper makes up from silence ("Thank you for watching") are never typed
  (`dictation.ignore`).
- Recordings can run up to 60 seconds (`dictation.maxSeconds`).

Typical use in a chat app: focus the message box, hold the key and say "dictate", release, hold the
key again and say your message, release, then say `send` (in Slack) or press Enter.

### Slack

Slack is driven through its own keyboard shortcuts. Say these **while Slack is focused**. Navigation
commands also work from any app when prefixed with `slack` (`slack channel dev`), which focuses
Slack first.

| Say | Does | Slack shortcut |
|---|---|---|
| `channel <name>` (or `dm`, `person`, `conversation`) | switch to a channel or person by name | Ctrl+K, type, Enter |
| `unread` / `unread next` | next unread channel or DM | Alt+Shift+Down |
| `unread previous` | previous unread | Alt+Shift+Up |
| `unread all` | the All unreads view | Ctrl+Shift+A |
| `unread first` | first unread message in this conversation | Ctrl+J |
| `back`, `forward` | previous / next location in history | Alt+Left / Alt+Right |
| `message` | start navigating messages at the latest one | Up (from an empty composer) |
| `message up` / `down` | previous / next message | Up / Down |
| `message top` / `bottom` | oldest / newest message | Home / End |
| `message page up` / `page down` | scroll by a page | Page Up / Page Down |
| `message thread` / `message main` | into a thread / back to the conversation | Right / Left |
| `edit` | edit the focused message (yours) | E |
| `delete` | start deleting the focused message (opens Slack's confirmation) | Delete |
| `confirm` | accept Slack's confirmation | Enter |
| `send` | send the draft | Enter |
| `newline` | add a line in the draft | Shift+Enter |

**Safety:** `send`, `edit`, `delete`, `confirm` and `newline` exist **only while Slack is the
focused window**, so they only act on something you are looking at. `slack send` from another app
is rejected. Deleting takes two spoken steps by design.

**Limits** (from Slack's own keyboard-shortcut documentation):

- There is no shortcut to *focus the message field*, so vocon has no command for it. After
  switching conversations Slack normally leaves the composer focused.
- `message` presses Up from an empty composer. Depending on a Slack preference that either
  focuses your latest message or edits the last one you sent.
- `edit`/`delete` are single-key shortcuts that apply to a focused message you sent. With the
  cursor in the composer they act as ordinary keys.
- Esc marks a conversation read in Slack, so there is no command for it.
- If your Slack sends with Ctrl+Enter, set `packs.slack.send` to `"ctrl+Return"`.
- If Slack is slow to open its switcher, raise `packs.slack.switcherDelay` /
  `resultsDelay` (milliseconds).

### Custom commands

Add your own in the `commands` list of `~/.config/vocon/config.json`. They reload when you save.

```json
"commands": [
  { "say": "lock screen",  "exec":   ["omarchy-system-lock"] },
  { "say": "night light",  "exec":   ["omarchy-toggle-nightlight"] },
  { "say": "new terminal", "launch": ["xdg-terminal-exec"] },
  { "say": "volume up",    "exec":   ["wpctl", "set-volume", "-l", "1.0", "@DEFAULT_AUDIO_SINK@", "5%+"] },
  { "say": "volume down",  "exec":   ["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "5%-"] },
  { "say": "next",
    "exec": ["wtype", "-M", "ctrl", "-k", "Tab", "-m", "ctrl"],
    "when": { "activeClass": "^(chromium|firefox)$" } }
]
```

- `say`: the words to speak; each word is one level of the command (`lock` then `screen`).
- `exec`: an argv array, run directly with **no shell** (`["cmd", "arg", ...]`).
  `launch`: an argv array started through `uwsm-app --`, like Omarchy's own bindings.
  Give exactly one of the two.
- `when.activeClass` (optional): a regex on the focused window's class. The command exists only
  while that app is focused, so the same word can mean different things in different apps (above:
  `next` is "next tab" in a browser; another `next` entry could mean "next track" in Spotify).
  Find class names with `hyprctl clients -j | jq -r '.[].class'`.
- Commands that share a first word merge (`volume up`, `volume down`). A command can extend a
  built-in (`focus mode` next to `focus <app>`), and your keyword beats a generic argument
  (`open notes` beats `open <app>`). Defining the same words twice is reported; the first wins.

A larger, tested set is in [`config/custom-commands.example.json`](config/custom-commands.example.json):
system toggles, volume and brightness, browser tabs, Spotify, Obsidian. Copy the entries you want.

### App catalog

`open <app>` and `focus <app>` use the `apps` section of your config:

```json
"apps": {
  "slack": {},
  "visual studio code": { "match": "^code$", "launch": ["code"], "aliases": ["vs code"] },
  "files": { "launch": ["thunar"] },
  "obsidian": null
}
```

- The key is the spoken name (it may be several words).
- `match`: a regex tested against the window **class** (case-insensitive, word-bounded). Class
  only, so a browser tab titled "Slack" never counts as Slack. Default: the name.
- `launch`: argv started via `uwsm-app --` when no window matches. Default: the name (single-word
  names only). It comes from your config, never from speech.
- `aliases`: other spoken names. `{}` is enough for an app whose command and window class equal its name.
- An entry overrides a built-in field by field; `null` removes a built-in app.
- Invalid entries (bad regex, missing launch command, a name already taken) are reported when the
  config loads and skipped; the rest keep working.

## Configuration

Your config is `~/.config/vocon/config.json` (created on install from
[`config/config.example.json`](config/config.example.json)). **It reloads when you save**, no restart
needed, except `pushToTalk.key`, which also needs `bin/vocon-keybind` to be re-run. Every key is
optional; anything you omit uses the default.

If the file can't be used at all (invalid JSON), vocon shows a notification and **keeps the last good
configuration** rather than resetting. Problems inside an otherwise valid file (a bad entry, a
conflict) are reported and only that entry is skipped.

| Key | Default | Meaning |
|---|---|---|
| `pushToTalk.key` | `"F10"` | The key to hold. Re-run `bin/vocon-keybind` after changing it. |
| `voxtype.model` | `null` | Model for command recordings (`--model`). `null` = VoxType's default. Must be a model VoxType knows about. |
| `voxtype.showOsd` | `true` | Show VoxType's on-screen indicator while recording. |
| `voxtype.maxSeconds` | `15` | Longest command recording (1-120); a safety limit. |
| `voxtype.transcribeTimeoutSeconds` | `20` | How long to wait for a transcript. |
| `matching.threshold` | `0.8` | How close a mis-heard word must be to a command word (0-1; higher is stricter). Only words of 4+ letters are fuzzy-matched. |
| `matching.aliases` | `space: [pace, base, spice]`, `move: [moved, moves]` | Words the recogniser tends to produce for a command word. A list you set for a word **replaces** its default list. |
| `feedback.notifyOnNoMatch` | `true` | Notify when a command isn't understood. |
| `feedback.notifyOnSuccess` | `false` | Notify with the transcript on every successful command. |
| `packs.<id>.enabled` | `true` | Turn a command pack off: `hyprland`, `apps`, `slack`, `dictation`, `custom`. |
| `packs.hyprland.workspaces` | `10` | Highest workspace number you can say. |
| `packs.hyprland.moveFollows` | `true` | Whether `move focused space n` also switches to that workspace. |
| `packs.slack.match` | `"^slack$"` | Regex for the Slack window class. |
| `packs.slack.send` | `"Return"` | Key `send` presses (`"ctrl+Return"` for Ctrl+Enter). |
| `packs.slack.focusDelay` | `300` | ms to let Slack take focus (the `slack ...` form). |
| `packs.slack.switcherDelay` | `350` | ms for Slack's quick switcher to open before typing. |
| `packs.slack.resultsDelay` | `450` | ms for its results to settle before Enter. |
| `dictation.armSeconds` | `30` | How long `dictate` stays armed (5-300). |
| `dictation.maxSeconds` | `60` | Longest dictation recording (5-120). |
| `dictation.ignore` | `["thank you for watching", "thanks for watching", "you"]` | Whole utterances never typed (Whisper often invents these from silence). |
| `apps` | built-ins | The [app catalog](#app-catalog). |
| `commands` | `[]` | Your [custom commands](#custom-commands). |

Minimal example:

```json
{
  "pushToTalk": { "key": "F10" },
  "matching": { "aliases": { "claude": ["cloud", "clod"] } },
  "apps": { "slack": {}, "claude desktop": { "match": "^com.anthropic.Claude$", "launch": ["claude-desktop"], "aliases": ["claude"] } },
  "commands": [ { "say": "lock screen", "exec": ["omarchy-system-lock"] } ]
}
```

## Improving recognition

Most misrecognition is audio, not the model. In rough order of payoff:

1. **Record from a non-Bluetooth microphone** ([step 2](#2-choose-your-microphone)). Check what was
   heard with `qs log -p /usr/share/omarchy/shell | grep "vocon: heard"`.
2. **Add aliases for words you see mis-heard.** If you say "claude" and it logs "cloud", add
   `"matching": { "aliases": { "claude": ["cloud"] } }`. The key is the word in your app name or
   command; the list is what the recogniser produced.
3. **Use a larger model.** `base.en` is the smallest. Try `small.en` via `voxtype setup model`.
4. **Use the GPU.** `voxtype setup gpu --enable` (Vulkan) makes larger models fast.
5. **Bias the vocabulary** with VoxType's Whisper prompt, e.g.
   `voxtype config set whisper.initial_prompt "Commands: space 1, workspace 2, move focused space 3, open Slack."`
   then `systemctl --user restart voxtype`. This is a nudge, not a guarantee, and it also applies
   to VoxType's own dictation.
6. **Wait a beat** after pressing the key before you speak; VoxType takes a fraction of a second
   to start capturing.
7. **Voice-activity detection** (`voxtype setup vad`) can reduce phantom text from silence.

## Troubleshooting

First, always: `omarchy-shell vocon status` (should print `idle`) and
`qs log -p /usr/share/omarchy/shell | grep vocon:`.

| Symptom | Likely cause and fix |
|---|---|
| Pressing the key does nothing | Check the binding exists: `hyprctl binds -j \| jq '.[] \| select(.description\|test("vocon"))'`. Re-run `bin/vocon-keybind`. If `status` errors, the plugin isn't loaded: `bin/vocon-install --restart`. |
| Notification: "VoxType isn't running" | `systemctl --user start voxtype`, or run `omarchy-voxtype-install`. |
| Notification: "VoxType didn't start recording" | Almost always a wrong `audio.device`. Use an ALSA name from `arecord -L \| grep ^sysdefault`, then restart the `voxtype` service. See the daemon's complaint: `journalctl --user -u voxtype -n 20`. |
| Notification: "VoxType is busy" | Another recording or dictation is in progress (F9 dictation, or a stuck one). Wait, or `voxtype record cancel`. |
| It hears nothing / empty results | Wrong or muted mic. Test: `voxtype record start --file=/tmp/t.txt --no-osd; sleep 3; voxtype record stop --wait --json`. |
| "space" is heard as "pace"/"base"/"this" | Bluetooth mic clipping the first word ([step 2](#2-choose-your-microphone)); otherwise add an alias. |
| It types or runs "Thank you for watching" | Whisper inventing text from silence. In commands it just doesn't match; in dictation it is ignored (`dictation.ignore`). Try `voxtype setup vad`. |
| Changed plugin code but nothing changed | A running shell keeps the old code: `bin/vocon-install --restart`. |
| Config change ignored | A notification explains it. Bad JSON keeps the old config; check with `jq . ~/.config/vocon/config.json`. |
| Slack commands do nothing | Slack must be the focused window (except `slack ...`). Check its class: `hyprctl clients -j \| jq -r '.[].class'` and set `packs.slack.match` if it isn't `slack`. Make sure `wtype` is installed. Raise the Slack delays if the switcher is slow. |
| "Slack isn't running" | The `slack ...` form needs a Slack window; say `open slack` first. |
| Keystrokes went to the wrong window | Keystroke commands go to whichever window is focused when they run. Hyprland's focus follows the mouse by default, so a nudge of the mouse mid-command can change the target. |
| Music pauses on every command | `voxtype config set audio.pause_media false`, then restart `voxtype`. |
| Transcription is slow | Use a GPU (`voxtype setup gpu --enable`) or a smaller model. |
| A command you expect isn't recognised | Commands are strict: say the words in order with no filler. The notification lists what was expected next. Test it: `omarchy-shell vocon simulate "<what you said>"`. |

## Updating and uninstalling

**Update:** pull or copy the new version, then `bin/vocon-install --restart`. Your config is kept.
Re-run `bin/vocon-keybind` only if the key binding mechanism changed.

**Uninstall:**

```sh
omarchy plugin remove vocon --yes                    # disables it; folder moved to a backup
sed -i '/^-- vocon:begin$/,/^-- vocon:end$/d' ~/.config/hypr/bindings.lua && hyprctl reload
rm -rf ~/.config/vocon                               # optional: your vocon config
```

The `sed` line removes only the four-line block that `bin/vocon-keybind` added. VoxType itself is
left installed (`omarchy-voxtype-remove` removes it).

## Command-line reference

| Command | Does |
|---|---|
| `bin/vocon-install [--restart]` | Install/update the plugin, enable it, seed the config. `--restart` restarts the shell so new code loads. |
| `bin/vocon-keybind [key]` | Write the push-to-talk binding (default: `pushToTalk.key`). Backs up and rolls back on error. |
| `omarchy-shell vocon start` / `stop` | What the key binding calls on press / release. |
| `omarchy-shell vocon cancel` | Cancel a recording and disarm dictation. |
| `omarchy-shell vocon status` | `idle`, `listening` or `transcribing`. |
| `omarchy-shell vocon dictation` | `armed` or `off`. |
| `omarchy-shell vocon simulate "<text>"` | Run text through the real pipeline, **executing the actions for real**. |
| `qs log -p /usr/share/omarchy/shell \| grep vocon:` | What vocon heard and decided. |

## Development

```
plugin/                      what gets installed
  manifest.json  Service.qml   the Omarchy plugin entry; wires events to the pure core
  infra/                       the side-effecting edges: Process runner, VoxType, Hyprland, executor, config file
  core/                        pure ES modules, no Qt and no I/O
    listening/                   the push-to-talk session state machine (and dictation)
    interpretation/              normalising speech, word scoring, slot types, the command parser
    commands/                    the command tree DSL, the registry, and the packs (hyprland, apps, slack, dictation, custom)
    execution/                   action descriptors and their translators (hyprctl, wtype), window lookup
bin/                         vocon-install, vocon-keybind
config/                      example configs (validated by the tests)
tests/                       node:test unit tests, plus a QML smoke test of the core under Qt's engine
```

The design is a functional core and an imperative shell: everything under `plugin/core/` is pure
and testable with plain Node, and only `Service.qml` and `infra/` do anything. The constraints,
decisions and gotchas are written down in [`AGENTS.md`](AGENTS.md); **read it before changing code**.

```sh
node --test tests/*.test.mjs
QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -input tests/qml/tst_core.qml
omarchy plugin validate plugin
```

To add commands, write a **pack** (see `plugin/core/commands/packs/` and
`tests/adapter.test.mjs`, a worked example of an app-specific adapter), register it in
`packs/index.mjs`, and add tests.
