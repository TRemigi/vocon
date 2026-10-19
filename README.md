# vocon

Push-to-talk voice control for the [Omarchy](https://omarchy.org) 4 desktop. Hold a key, say a
command, release. vocon turns your speech into text with [VoxType](https://github.com/peteonrails/voxtype)
(**local only, nothing leaves your machine**), matches it against a list of known commands, and
runs the result: switch workspaces, move windows, open or focus apps, drive Slack, dictate text,
or run your own commands.

```
hold F10:   "space 2"                        ->  workspace 2 is focused
hold F10:   "move space 1"                   ->  the focused window moves to workspace 1
hold F10:   "move left"                      ->  the focused window swaps places with its left neighbour
hold F10:   "open slack"                     ->  Slack is focused, or started if it isn't running
hold F10:   "slack channel dev platform"     ->  jumps to #dev-platform in Slack
hold F10:   "dictate Hi team..."             ->  "Hi team..." is typed into the focused window
```

Commands are CLI-like (`move space 1`), not free-form sentences, so they are predictable,
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

The standard way, using Omarchy's own plugin manager:

```sh
omarchy plugin add https://github.com/TRemigi/vocon.git --enable
```

This clones the repository into `~/.config/omarchy/plugins/vocon/`, validates it, and enables it.
No config file is needed to start: vocon runs on its defaults until you create
`~/.config/vocon/config.json` (see [Configuration](#configuration); copy
`config/config.example.json` from the plugin folder as a starting point). In the steps below,
`bin/...` means that folder:

```sh
cd ~/.config/omarchy/plugins/vocon
```

<details>
<summary>Alternative: install from a local clone (for development)</summary>

Clone or copy this repository somewhere, then from its root:

```sh
bin/vocon-install --restart
```

This validates the plugin, copies it to `~/.config/omarchy/plugins/vocon/` (Omarchy rejects
symlinked plugins, so it copies), enables it in `~/.config/omarchy/shell.json` (a backup is made
first), and creates `~/.config/vocon/config.json` if you don't have one. `--restart` restarts the
Omarchy shell so it loads the plugin; your bar redraws for a moment. It is safe to run again at
any time. The installed copy is not a git checkout, so `omarchy plugin update` does not apply to
it; re-run the script instead. Don't mix the two: `omarchy plugin add` refuses if `vocon` is
already installed (`omarchy plugin remove vocon` first).

</details>

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
# vocon: heard 2 word(s) -> matched space (score 1.00)
```

`simulate` feeds text through exactly the same path as a spoken command, **including running the
resulting actions for real** (it will switch workspaces and send keystrokes to the focused window),
so try it with harmless commands first.

### 6. Try it by voice

Hold F10, wait a beat, say **"space 2"**, release. Workspace 2 should focus. Then try
"move space 1" and "open terminal". If something is off, see
[Troubleshooting](#troubleshooting).

## Using vocon

**The basic gesture:** hold the key, wait about half a second for VoxType to start capturing, speak
the command, release. How long recognition takes depends on VoxType's engine, from about a second
on a CPU-only Whisper setup to a fraction of a second; see [Performance](#performance).

**Speak commands in order, without filler.** `move space 1`, not "please move the focused
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

**While the screen is locked, vocon does nothing.** It won't start recording, and a command that
finishes after the lock engaged is discarded (nothing runs or is typed, armed dictation is dropped,
the transcript isn't logged). That includes `omarchy-shell vocon simulate`. vocon asks
`omarchy-hyprland-session-locked`, and an "undetermined" answer counts as locked. You get a
low-priority "Voice commands are off" notification.

## Command reference

### Help

| Say | Does |
|---|---|
| `help` | open a filterable menu of every command |
| `help <topic>` | the same menu, for one topic |

Topics: `core` (the built-in commands: workspaces, apps, arrow keys and enter, dictation), one for each app
pack (`slack`, `claude`), `braindump` (also `note`), `custom` (your own commands, once you have some), and the built-in packs
by name (`hyprland` also answers to `workspaces` or `windows`, `keys` to `keyboard`, `apps` to
`applications`). Disabled packs are not topics. The footer of the menu lists what you can ask for.

Type to filter: every word you type must appear in the command, its other spellings, its topic or
where it works (`while slack`, `focused move`). Up/Down, PageUp/PageDown, Home/End move; **Esc**
clears the filter, then closes; Enter closes. The menu is a reference: it never runs anything. Each
row shows whether it works anywhere or only while an app is focused, and the footer explains
`<arguments>`. A new pack becomes a topic automatically. The menu is built from the same command
tree the parser uses, so it can't list something that won't work. While it is open it holds the
keyboard, so a command that types (`dictate`, `send`) lands in the menu's filter rather than in
another app. For a terminal, `bin/vocon-commands` prints the same list.

### Workspaces and windows

| Say | Does |
|---|---|
| `space <n>` (or `workspace <n>`) | focus workspace n |
| `move space <n>` | move the focused window to workspace n **and follow it** |
| `move left`, `move right`, `move up`, `move down` | swap the focused window with its neighbour in that direction, within the current workspace |

`<n>` is 1-10; `space` also accepts `workspace`. `move` always acts on the focused window. The
directional form is Hyprland's window swap (the same as Omarchy's SUPER+SHIFT+arrows), so it swaps
places with the window beside it rather than reshaping the layout.
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

### Arrow keys and Enter

| Say | Does |
|---|---|
| `up`, `down`, `left`, `right` | press that arrow key once in the focused window |
| `down three`, `up 5` | press it that many times (digit or number word) |
| `enter` | press Enter once in the focused window (no count: it submits and confirms) |

Works in any window. The count is 1-20; a larger or unrecognised count does nothing rather than
guess. Change the limit with `packs.keys.maxCount` (never above 100). Apps keep their own commands
alongside these (Slack's `message up` is separate). The recogniser sometimes hears "right" as
"write": if that happens to you, add `"right": ["write"]` under `matching.aliases`.

### Dictation

| Say | Does |
|---|---|
| `dictate <text>` (or `input <text>`) | types `<text>` into the focused window right away, in the same utterance. The word `dictate` itself is not typed |
| `dictate` / `input` (alone) | the **next** time you hold the key, your speech is typed into the focused window instead of being treated as a command |
| `cancel` (as the dictated phrase) | cancels dictation |

Dictation is deliberately constrained so words can't land somewhere unintended:

- It is **single-shot**: after one utterance is typed, vocon goes back to commands.
- `dictate <text>` is typed as you said it (capitalisation and punctuation kept). Like all dictated
  text it is never logged or shown in a notification (see [Privacy](#privacy)).
- It **expires** after 30 seconds (`dictation.armSeconds`).
- It is **discarded if the focused window changes** between saying `dictate` and speaking.
- Things Whisper makes up from silence ("Thank you for watching") are never typed
  (`dictation.ignore`).
- Recordings can run up to 60 seconds (`dictation.maxSeconds`).

Typical use in a chat app: focus the message box, hold the key and say "dictate hi team, standup is
moved to ten", release, then say `send` (in Slack) or press Enter.

### Notes (braindump)

Needs [braindump](https://github.com/TRemigi/brain-dump) installed and its organizer running (`braindump run`; see its
README). vocon only **queues** the note; braindump files it in the background.

| Say | Does |
|---|---|
| `note <text>` | queue `<text>` as a note |
| `note to <file> <text>` | queue it into that note (`braindump capture --file`) |
| `note to <file> in <dir> <text>` | queue it into that note in that folder (`--dir` and `--file`) |
| `brain dump <text>` (or `braindump <text>`) | the same, including the `to <file>` forms |
| `brain dump status` (or `braindump status`) | notify what is queued, waiting for review, and filed recently |

- The note is stored as you said it (capitalisation and punctuation kept), without the command
  words: "Note: renew my passport, by May." queues `renew my passport, by May.`
- It works from any window and touches none; nothing is typed.
- **Placing a note.** `<file>` and `<dir>` are vault paths you name in config, so only what *you*
  wrote there reaches braindump's command line (see the options below):
  ```json
  "packs": {
    "braindump": {
      "files": { "to do": "areas/to-do", "standup": "projects/Acme/Standup" },
      "dirs":  { "deep work": "areas/work" }
    }
  }
  ```
  "Note to standup ask about the SLA" adds to `projects/Acme/Standup`. `dirs` already knows braindump's
  folders (`inbox`, `projects`, `areas`, `resources`, `archives`).
- After `in <dir>`, `<file>` can also be any **one plain word**: "note to todo in areas email Sam" files
  into `areas/todo`. A configured file keeps its own name there ("note to standup in archives …" is
  `archives/Standup`). Folders must be known ones: "note to todo in the morning …" is refused rather
  than guessed.
- A file that isn't configured, with no `in <dir>`, isn't placed: "note to call mom" is queued as
  `to call mom` and a toast says no file matched. So `in` right after a file is a command word, and a
  note that starts with "to" is only placed if the next word names one of your files.
- Placement is braindump's call to honour: if it can't (the note exists but the agent wanted a new one,
  say), the capture lands in `inbox/` as a `Review - …` note.
- `status` is a command word, so a note that *starts* with "status" has to be said as
  `note status …`.
- A toast says "Note queued" (or why it couldn't be). It never quotes the note.
- vocon doesn't keep the note, but braindump does: it is written to braindump's queue and decision
  records, and then to your vault. That is the point, but it is a place speech is stored that
  [Privacy](#privacy) otherwise says there isn't.
- If `braindump` isn't on the shell's `PATH` (a Go install lands in `~/go/bin`), set
  `packs.braindump.command` to its absolute path.

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

### Claude Desktop

Claude Desktop is driven through its own keyboard shortcuts. The shortcuts come from the
[Claude Code desktop docs](https://code.claude.com/docs/en/desktop) and from the application menu of
the Linux build (checked against the installed app, not a third-party list). Say these **while
Claude Desktop is focused**. The navigation commands (the first group) also work from any app when
prefixed with `claude` (`claude session next`), which focuses Claude Desktop first.

| Say | Does | Shortcut |
|---|---|---|
| `tab home` / `tab code` | switch to the Home / Code tab | Ctrl+K, type the name, Enter (the app has no tab shortcut) |
| `session new` / `next` / `previous` | new session / cycle sessions | Ctrl+N / Ctrl+Tab / Ctrl+Shift+Tab |
| `session <name>` | jump to a session by (part of) its title | Ctrl+K, type the name, Enter |
| `palette <text>` (or `search <text>`) | search the palette, without choosing | Ctrl+K, type the text |
| `confirm` | choose the highlighted palette result | Enter |
| `pane diff` / `terminal` | toggle that pane | Ctrl+Shift+D / Ctrl+\` |
| `side chat` | open a side chat | Ctrl+; |
| `menu model` / `permission` / `effort` | open that menu | Ctrl+Shift+I / Ctrl+Shift+M / Ctrl+Shift+E |
| `view` | cycle view modes | Ctrl+O |
| `palette` (or `search`) | command palette | Ctrl+K |
| `settings`, `sidebar`, `shortcuts` | settings, toggle sidebar, show the shortcut list | Ctrl+, / Ctrl+B / Ctrl+/ |
| `find` / `find next` / `find previous` | find in the page | Ctrl+F / Ctrl+G / Ctrl+Shift+G |
| `zoom in` / `out` / `reset` | zoom | Ctrl+= / Ctrl+- / Ctrl+0 |
| `fullscreen` (or `full screen`) | toggle full screen | F11 |
| `close session` / `close pane` | close the session / the focused pane | Ctrl+W / Ctrl+\\ |
| `reopen` | reopen the last closed session | Ctrl+Shift+T |
| `stop` | stop Claude's response | Esc |
| `send` | send the prompt | Enter |
| `newline` | add a line in the prompt | Shift+Enter |
| `accept` | accept the suggested prompt (empty prompt box) | Tab |
| `choose <item>` | pick item 1-9 of an open menu (`menu model`, then `choose 2`) | 1-9 |
| `undo`, `redo` | edit history | Ctrl+Z / Ctrl+Shift+Z |
| `cut`, `copy`, `paste`, `select all` | clipboard and selection | Ctrl+X / C / V / A |

**Safety:** everything that acts on a session or the prompt (`close`, `reopen`, `stop`, `send`,
`newline`, `accept`, `choose` and the edit keys) exists **only while Claude Desktop is the focused
window**. `claude send` from another app is rejected. Pair `dictate <text>` with `send` to speak a
prompt and submit it.

**Limits:**

- Pane toggles, `view` and the menus act on the **Code tab**; in the chat tab they do nothing.
  There is no command for the Browser pane (Ctrl+Shift+B), since it doesn't apply to this setup.
- `choose` presses a digit; with no menu open the digit is typed into the prompt.
- `newline` (Shift+Enter) is not in the official shortcut table; it's the standard chat convention.
- The docs list no shortcut to focus the prompt box, so there is no command for it.
- `tab` goes through the command palette and presses Enter on its first result. That `code` gives
  the Code tab was confirmed by hand; `home` was not. If the palette is slow, raise
  `packs.claude.paletteDelay` / `resultsDelay`.
- `session <name>` types what you said into the palette and presses Enter on its first result.
  The palette also holds commands, so a misheard name could run one: it exists **only while Claude
  Desktop is focused**, and `packs.claude.sessionSubmit: false` types the name but leaves Enter to
  you. `next`, `previous` and `new` win over a title, so a session titled "new …" can't be reached
  this way. Spoken titles are lowercase words without punctuation; the palette's own search decides
  whether that matches.
- `palette <text>` only types, so you can read the results and pick one (arrow keys, or say
  `confirm`). Like `session <name>` it exists only while Claude Desktop is focused.
- If Claude Desktop is slow to take focus, raise `packs.claude.focusDelay` (milliseconds).
- Shortcuts that don't pass through the window (such as a global quick-entry hotkey) can't be
  sent by vocon.

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
| `packs.<id>.enabled` | `true` | Turn a command pack off: `hyprland`, `apps`, `keys`, `slack`, `claude`, `braindump`, `dictation`, `custom`, `help`. |
| `packs.hyprland.workspaces` | `10` | Highest workspace number you can say. |
| `packs.hyprland.moveFollows` | `true` | Whether `move space n` also switches to that workspace. |
| `packs.keys.maxCount` | `20` | Most presses an arrow command accepts (`down 20`). Capped at 100. |
| `packs.slack.match` | `"^slack$"` | Regex for the Slack window class. |
| `packs.slack.send` | `"Return"` | Key `send` presses (`"ctrl+Return"` for Ctrl+Enter). |
| `packs.slack.focusDelay` | `300` | ms to let Slack take focus (the `slack ...` form). |
| `packs.slack.switcherDelay` | `350` | ms for Slack's quick switcher to open before typing. |
| `packs.slack.resultsDelay` | `450` | ms for its results to settle before Enter. |
| `packs.claude.match` | `"^com.anthropic.Claude$"` | Regex for the Claude Desktop window class. |
| `packs.claude.send` | `"Return"` | Key `send` presses (`"ctrl+Return"` for Ctrl+Enter). |
| `packs.claude.focusDelay` | `300` | ms to let Claude Desktop take focus (the `claude ...` form). |
| `packs.claude.paletteDelay` | `350` | ms for the command palette to open before `tab` types. |
| `packs.claude.resultsDelay` | `450` | ms for its results to settle before Enter. |
| `packs.claude.sessionSubmit` | `true` | `session <name>` presses Enter on the first result; `false` only types the name. |
| `packs.braindump.command` | `"braindump"` | The braindump binary; an absolute path if it isn't on the shell's `PATH`. |
| `packs.braindump.state` | `""` | `--state` for capture and status, if you don't use braindump's default directory. Absolute path (no `~`). |
| `packs.braindump.files` | `{}` | Spoken name → vault path for `note to <file> …`, e.g. `{ "to do": "areas/to-do" }`. Relative to the vault, `/`-separated, `.md` optional; entries that are absolute, start with `-`, contain `..` or aren't strings are ignored. |
| `packs.braindump.dirs` | braindump's five folders | Spoken name → vault folder for `… in <dir> …`; your entries are added to (and win over) the defaults. |
| `packs.braindump.vault` | `""` | `--vault` for `status`, which then also counts review notes waiting in `inbox/`. Absolute path. |
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
   heard from the "Didn't understand" notification, which quotes the transcript (the vocon log does not).
2. **Add aliases for words you see mis-heard.** If you say "claude" and the notification shows "cloud", add
   `"matching": { "aliases": { "claude": ["cloud"] } }`. The key is the word in your app name or
   command; the list is what the recogniser produced.
3. **Use a larger model.** `base.en` is the smallest. Try `small.en` via `voxtype setup model`.
4. **Use the GPU.** `voxtype setup gpu --enable` (Vulkan) makes larger models fast.
5. **Bias the vocabulary** with VoxType's Whisper prompt, e.g.
   `voxtype config set whisper.initial_prompt "Commands: space 1, workspace 2, move space 3, open Slack."`
   then `systemctl --user restart voxtype`. This is a nudge, not a guarantee, and it also applies
   to VoxType's own dictation.
6. **Wait a beat** after pressing the key before you speak; VoxType takes a fraction of a second
   to start capturing.
7. **Voice-activity detection** (`voxtype setup vad`) can reduce phantom text from silence.

## Performance

When a command feels slow, the delay is almost always VoxType's speech-to-text step, not vocon.
vocon's own work after you release the key (parse the transcript, look up windows, run the
action) takes tens of milliseconds. So the way to speed things up is to change how VoxType
transcribes. These are the changes that helped on the machine vocon was developed on, in order of
payoff. VoxType changes its commands between releases, so this section describes the changes and
leaves the exact invocations to its own documentation: the
[VoxType README](https://github.com/peteonrails/voxtype#readme) (see "Supported Engines" and "GPU
Acceleration") and [voxtype.io](https://voxtype.io). Its `--help` output is the up-to-date
reference for your installed version.

Measured on a Ryzen laptop (AVX2 CPU, no AVX-512, Radeon 680M integrated GPU) with one- to
two-second commands such as "space one". Treat these as indicative: the sample is small and your
hardware will differ.

| VoxType setup | Transcription time |
|---|---|
| Whisper `base.en`, CPU (the default) | ~0.85 s, about the same for any short clip |
| Whisper `base.en`, GPU (Vulkan) | ~0.2 to 0.6 s (the first run after the daemon starts was the slowest) |
| Parakeet (English, int8 model), CPU | ~0.08 to 0.14 s |

1. **Switch to a faster engine, such as Parakeet.** Whisper pads every clip to a fixed 30-second
   window, so a two-word command costs about as much as a long sentence. Parakeet doesn't, and
   it was the biggest improvement here. English only.
   - VoxType's Whisper and "ONNX" engines (Parakeet, Moonshine and others) are separate binaries.
     Packaged installs, including the AUR's `voxtype-bin`, usually ship both, so you switch the
     active binary instead of compiling anything. If VoxType tells you an engine "requires the
     feature", it is running the wrong binary.
   - Download the model, choose the engine **and name the model explicitly** in VoxType's config,
     then restart the daemon. Without a model set, the daemon looks for a default you probably
     haven't downloaded and exits, which makes vocon report "VoxType isn't running". The
     daemon's journal (`journalctl --user -u voxtype`) shows why.
   - The daemon logs how long each transcription took, so you can compare engines yourself.
2. **If you stay on Whisper, turn on GPU acceleration** (Vulkan works across AMD, NVIDIA and
   Intel). VoxType's ONNX engines only get GPU builds for some hardware (they need AVX-512, or
   CUDA/MIGraphX), so on a machine like the one above it is a choice between Whisper on the GPU
   and Parakeet on the CPU. Parakeet on the CPU was faster here.
3. **A smaller Whisper model is faster but less accurate.** Only worth it if accuracy is already
   good, since `base.en` already struggles with some command words.
4. **Don't enable Parakeet's streaming mode for vocon.** It transcribes while you speak, but VoxType
   makes it toggle-to-talk (press to start, press again to stop), which doesn't fit vocon's
   hold-the-key gesture.

**After changing engines:**

- Different engines format text differently (capitalisation, punctuation, "1" versus "one", how
  names are spelled). vocon normalises transcripts, but you may need to add or adjust
  [aliases](#improving-recognition) for words that are now misheard. The "Didn't understand"
  notification shows what the engine produced.
- Speech-to-text stays local with every engine. VoxType downloads the model files once, and
  transcription itself doesn't use the network.
- vocon doesn't care which engine is running. It calls VoxType the same way for all of them, so
  nothing in vocon's config changes.

## Privacy

vocon keeps no record of what you say, and nothing it controls stores a transcript, with one
exception you ask for: the `note` commands hand what you said to braindump, which keeps it (see
[Notes](#notes-braindump)).

- **Its log** (`qs log ... | grep vocon:`) holds the word count and the outcome only, e.g.
  `heard 3 word(s) -> nomatch after “move”`. Dictated text is not logged, only its length.
- **The transcript file** VoxType writes for vocon (`$XDG_RUNTIME_DIR/vocon-utterance.txt`) is
  deleted as soon as the result has been read, on cancel, before each recording, and when the
  plugin starts.
- **Dictated text** is typed through a pipe and never appears in a notification. A note is piped to
  `braindump capture` the same way, and braindump's "Note queued" toast never quotes it.

Two things outside vocon do keep text, and vocon can't turn them off:

- A "Didn't understand" notification quotes what was heard, and Omarchy keeps its last 10
  notifications on disk (`~/.local/state/omarchy/notifications/history/`).
- VoxType logs every transcript to its own journal (`journalctl --user -u voxtype`) at INFO level.

## Troubleshooting

First, always: `omarchy-shell vocon status` (should print `idle`) and
`qs log -p /usr/share/omarchy/shell | grep vocon:`.

| Symptom | Likely cause and fix |
|---|---|
| Pressing the key does nothing | Is the screen locked? vocon is off while locked (`omarchy-hyprland-session-locked; echo $?` prints 1 when unlocked). Otherwise check the binding exists: `hyprctl binds -j \| jq '.[] \| select(.description\|test("vocon"))'`. Re-run `bin/vocon-keybind`. If `status` errors, the plugin isn't loaded: `omarchy plugin enable vocon` and `omarchy-restart-shell` (from a local clone: `bin/vocon-install --restart`). |
| Notification: "VoxType isn't running" | `systemctl --user start voxtype`, or run `omarchy-voxtype-install`. |
| Notification: "VoxType didn't start recording" | Almost always a wrong `audio.device`. Use an ALSA name from `arecord -L \| grep ^sysdefault`, then restart the `voxtype` service. See the daemon's complaint: `journalctl --user -u voxtype -n 20`. |
| Notification: "VoxType is busy" | Another recording or dictation is in progress (F9 dictation, or a stuck one). Wait, or `voxtype record cancel`. |
| It hears nothing / empty results | Wrong or muted mic. Test: `voxtype record start --file=/tmp/t.txt --no-osd; sleep 3; voxtype record stop --wait --json`. |
| "space" is heard as "pace"/"base"/"this" | Bluetooth mic clipping the first word ([step 2](#2-choose-your-microphone)); otherwise add an alias. |
| It types or runs "Thank you for watching" | Whisper inventing text from silence. In commands it just doesn't match; in dictation it is ignored (`dictation.ignore`). Try `voxtype setup vad`. |
| Changed plugin code but nothing changed | A running shell keeps the old code: `omarchy-restart-shell` (from a local clone: `bin/vocon-install --restart`). |
| Config change ignored | A notification explains it. Bad JSON keeps the old config; check with `jq . ~/.config/vocon/config.json`. |
| Slack commands do nothing | Slack must be the focused window (except `slack ...`). Check its class: `hyprctl clients -j \| jq -r '.[].class'` and set `packs.slack.match` if it isn't `slack`. Make sure `wtype` is installed. Raise the Slack delays if the switcher is slow. |
| "Slack isn't running" | The `slack ...` form needs a Slack window; say `open slack` first. |
| Keystrokes went to the wrong window | Keystroke commands go to whichever window is focused when they run. Hyprland's focus follows the mouse by default, so a nudge of the mouse mid-command can change the target. |
| Music pauses on every command | `voxtype config set audio.pause_media false`, then restart `voxtype`. |
| Transcription is slow | See [Performance](#performance): a faster engine or GPU acceleration. |
| A command you expect isn't recognised | Commands are strict: say the words in order with no filler. The notification lists what was expected next. Test it: `omarchy-shell vocon simulate "<what you said>"`. |

## Updating and uninstalling

**Update:** `omarchy plugin update vocon`, then `omarchy-restart-shell` (the running shell keeps the old
code). Your config is kept. From a local clone: pull, then `bin/vocon-install --restart`.
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
| `bin/vocon-commands [--synonyms] [--config <path>]` | List the voice commands currently available, from your config (disabled packs, your apps and custom commands included). Commands that only work while an app is focused are grouped by app. `--synonyms` shows every accepted spelling. Needs only `node`, not the running shell. |
| `omarchy-shell vocon cancel` | Cancel a recording and disarm dictation. |
| `omarchy-shell vocon status` | `idle`, `listening` or `transcribing`. |
| `omarchy-shell vocon dictation` | `armed` or `off`. |
| `omarchy-shell vocon simulate "<text>"` | Run text through the real pipeline, **executing the actions for real**. |
| `qs log -p /usr/share/omarchy/shell \| grep vocon:` | What vocon decided: word count, outcome, command id; never the words (see [Privacy](#privacy)). |

## Development

```
plugin/                      what gets installed
  manifest.json  Service.qml   the Omarchy plugin entry; wires events to the pure core
  Help.qml                     the `help` menu (an overlay; only draws what the help.show effect carries)
  infra/                       the side-effecting edges: Process runner, VoxType, Hyprland, executor, config file
  core/                        pure ES modules, no Qt and no I/O
    listening/                   the push-to-talk session state machine (and dictation)
    interpretation/              normalising speech, word scoring, slot types, the command parser
    commands/                    the command tree DSL, the registry, and the packs (hyprland, apps, keys, slack, claude, braindump, dictation, custom, help)
    execution/                   action descriptors and their translators (hyprctl, wtype), window lookup
bin/                         vocon-install, vocon-keybind, vocon-commands
config/                      example configs (validated by the tests)
tests/                       node:test unit tests, plus a QML smoke test of the core under Qt's engine
```

The design is a functional core and an imperative shell: everything under `core/` is pure
and testable with plain Node, and only `Service.qml` and `infra/` do anything. The constraints,
decisions and gotchas are written down in [`AGENTS.md`](AGENTS.md); **read it before changing code**.

```sh
node --test tests/*.test.mjs
QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -input tests/qml/tst_core.qml
omarchy plugin validate .
```

To add commands, write a **pack** (see `core/commands/packs/` and
`tests/adapter.test.mjs`, a worked example of an app-specific adapter), register it in
`packs/index.mjs`, and add tests.
