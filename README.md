# vocon

Push-to-talk voice commands for the Omarchy 4 shell. Hold a key, speak, release: the
transcript (via [VoxType](https://github.com/peteonrails/voxtype)) is matched against known
commands and the resulting actions run through `hyprctl` / `uwsm-app`.

## Install

```sh
omarchy-voxtype-install   # once: VoxType + model + user service
bin/vocon-install         # copy plugin into ~/.config/omarchy/plugins/vocon, enable it, seed config
bin/vocon-keybind         # bind pushToTalk.key (default F10) in ~/.config/hypr/bindings.lua
```

Config lives in `~/.config/vocon/config.json` (see `config/config.example.json`); it is
reloaded on save. Re-run `bin/vocon-keybind` after changing `pushToTalk.key`, and
`bin/vocon-install --restart` after changing plugin code (a running shell keeps the old
code until it restarts; `--restart` runs `omarchy-restart-shell`). Avoid modifier combos for the key: if the
modifier is released first, the key-release event can be missed (a watchdog cancels it after
`voxtype.maxSeconds`).

## Try it without a microphone

```sh
omarchy-shell vocon simulate "space 2"     # runs the real pipeline + hyprctl
omarchy-shell vocon status                 # idle | listening | transcribing
```

Logs: `qs log -p /usr/share/omarchy/shell | grep vocon:`

## Commands

Commands are CLI-like: a command word followed by arguments, parsed left to right.

| Say | Does |
|---|---|
| `space <n>` | focus workspace n |
| `move focused space <n>` | move the focused window to workspace n and follow it (`packs.hyprland.moveFollows: false` to stay) |

| `open <app>` | focus the app's window if one is open, otherwise launch it |
| `focus <app>` | focus the app's window; just tells you if it isn't running |
| `dictate` | type your **next** utterance into the focused window instead of treating it as a command (see Dictation) |

`<n>` is 1-10, as a digit or a number word. Synonyms: `workspace` for `space`,
`focus`/`current` for `focused`. Free-form phrasing ("go to workspace 4", "move window
to space 2") is deliberately not accepted.

## App catalog

`<app>` is an entry of `apps` in `~/.config/vocon/config.json`, spoken by its name or an alias.
Built in: `terminal`, `browser`, `files`, `spotify`, `obsidian`. Add your own:

```json
"apps": {
  "slack": {},
  "visual studio code": { "match": "^code$", "launch": ["code"], "aliases": ["vs code"] },
  "files": { "launch": ["thunar"] },
  "obsidian": null
}
```

- `match`: regex tested against the window **class** (case-insensitive, word-bounded, like
  `omarchy-launch-or-focus`). Class only, so a browser tab titled "Slack" is not Slack. Default:
  the name. Find classes with `hyprctl clients -j | jq -r '.[].class'`.
- `launch`: argv run through `uwsm-app --` when no window matches. Default: the name (single-word
  names only). It comes from config only; speech just selects an entry, it never becomes a command.
- `aliases`: other spoken names. An entry overrides a built-in field by field; `null` removes one.
- Invalid entries (bad regex, no launch command, a spoken name already taken) are reported when
  the config loads and skipped; the rest keep working.

Each word is resolved only against what is valid at that point, so commands can't collide:
`move` can later gain `all` or `group` arguments (`move all space 2`, `move focused group dev`)
without affecting anything else. A word that doesn't fit is reported by position, e.g.
`"move window" - no match after "move", expected: focused`.

Mishearings are handled per word, not per phrase: near-misses of longer words (similarity >=
`matching.threshold`) and `matching.aliases` (command word -> words the recogniser tends to
produce, e.g. `"space": ["pace", "base"]`). A list you set for a word replaces its default list.

## Slack

Slack is driven through its own keyboard shortcuts (`plugin/core/commands/packs/slack.mjs`). Say
these while Slack is focused, or prefix any navigation command with `slack` to focus Slack first
from anywhere (`slack channel dev`).

| Say | Does | Slack shortcut |
|---|---|---|
| `channel <name>` (or `dm`, `person`) | switch by name | Ctrl+K, type, Enter |
| `unread` / `unread next` / `unread previous` | next / previous unread channel or DM | Alt+Shift+Down / Up |
| `unread all`, `unread first` | All unreads view; first unread message | Ctrl+Shift+A, Ctrl+J |
| `back`, `forward` | previous / next location in history | Alt+Left / Right |
| `message` (`up`, `down`, `top`, `bottom`, `page up`, `page down`) | move between messages | Up from an empty composer, then arrows, Home/End, Page keys |
| `message thread`, `message main` | into a thread / back to the conversation | Right / Left |
| `edit`, `delete`, `confirm` | act on the focused message (yours only) | E, Delete, Enter |
| `send`, `newline` | send the draft / add a line | Enter, Shift+Enter |

Only the navigation commands work from anywhere. `send`, `edit`, `delete` and `confirm` exist only
while Slack is focused, so they act on a window you are looking at. `delete` only opens Slack's
confirmation; `confirm` accepts it.

Settings, under `packs.slack` in your config: `match` (window class regex, default `^slack$`),
`send` (`"ctrl+Return"` if Slack sends with Ctrl+Enter), and the delays `focusDelay`,
`switcherDelay`, `resultsDelay` (ms) to raise if Slack is slow to open its switcher.

Limits, from Slack's shortcut documentation:

- **No "focus the message field"**: Slack documents no shortcut for it (F6 cycles sections in an
  undocumented order), so vocon doesn't offer one. Switching conversations normally leaves the
  composer focused.
- **`message`** presses Up from an empty composer; depending on a Slack preference that either
  focuses your latest message or edits your last sent one.
- **`edit` / `delete`** are single-key shortcuts (`E`, `Delete`) that apply to a focused message
  and only to messages you sent. With the cursor in the composer they act as plain keys.
- Esc marks the conversation read in Slack, so vocon has no command for it.

## Dictation

`dictate` makes your *next* press of the key a message to type instead of a command to run: it
is transcribed and typed into the focused window (any app; in Slack, follow with `send`).

- Single-shot, and it expires after `dictation.armSeconds` (default 30).
- It is discarded if the focused window changes, so words never land somewhere you didn't intend.
- Say `cancel` (or run `omarchy-shell vocon cancel`) to stop; `omarchy-shell vocon dictation`
  shows `armed` or `off`.
- Whisper invents phrases like "Thank you for watching" from silence; whole utterances listed in
  `dictation.ignore` are never typed. `dictation.maxSeconds` (default 60) is the longest recording.
- Typing uses `wtype` (installed with VoxType). Text goes through stdin, so it can't be mistaken
  for key presses, and the log records only its length.

## Custom commands

Add your own commands in `~/.config/vocon/config.json`; they join the same command tree as the
built-ins and reload on save:

```json
"commands": [
  { "say": "lock screen", "exec": ["omarchy-system-lock"] },
  { "say": "notes", "launch": ["obsidian"] },
  { "say": "tab next", "exec": ["my-script", "next"], "when": { "activeClass": "^firefox$" } }
]
```

A larger, tested set is in `config/custom-commands.example.json`: system toggles, volume and
brightness, launch variants, and per-app commands (browser tabs, Spotify, Obsidian) that
send each app its own shortcut with `wtype`. Copy the entries you want into your `commands` list.

- `say`: the words to speak (each word is one level of the tree, so `lock` then `screen`).
- `exec`: an argv array run directly (no shell). `launch`: an argv array started via `uwsm-app --`.
  Exactly one of the two. Argv comes from config only; speech just selects the command.
- `when.activeClass`: regex on the focused window's class; the command exists only while that
  app is focused, so the same words can mean different things in different apps.
- Commands sharing a first word merge (`lock screen`, `lock session`), and a command can extend a
  built-in one (`move all`). A keyword you define beats a value argument (`open notes` beats
  `open <app>`). Defining the same words twice is reported and the first definition wins.
- A pack can be switched off with `"packs": { "apps": { "enabled": false } }` (also `hyprland`,
  `custom`).

A config file that can't be used at all (bad JSON) is rejected with a notification and the last
good config stays active. Problems inside an otherwise valid file (a bad entry, a pack conflict)
are reported and just that entry is skipped.

## Writing a pack (app adapters)

A pack is a small module: `{ id, commands(config) -> [root nodes], slotTypes?(config) }`, listed in
`plugin/core/commands/packs/index.mjs`. An app adapter is a pack whose root nodes carry a `when`,
so its commands exist only while that app is focused (`tests/adapter.test.mjs` is the worked
example, with tests):

```js
const whenFirefox = (ctx) => classMatches(ctx.active, "^firefox$");   // ctx.active = focused window

export const firefoxAdapter = {
  id: "firefox",
  commands: () => [
    command("tab", { when: whenFirefox }, [
      keyword("next",     { run: () => [exec([...])] }),
      keyword("previous", { words: ["back"], run: () => [exec([...])] }),
    ]),
  ],
};
```

`run(args, ctx, path)` returns action descriptors, which the shell executes. Sending a keyboard
shortcut to an app is the natural action for adapters; it isn't built yet (Hyprland's
`send_shortcut` can leave keys stuck, see Omarchy's `default/hypr/bindings/clipboard.lua` for the
workaround), so the example uses `exec`.

## Troubleshooting

- Nothing happens on F10: `omarchy-shell vocon status`, then `qs log -p /usr/share/omarchy/shell | grep vocon:`.
  vocon reports VoxType being down, busy, or failing to start recording (e.g. a wrong
  `audio.device`). VoxType takes ALSA names (`sysdefault:CARD=...`), not `pactl` source names.
- Headset mics: Bluetooth headsets switch profile when the mic opens and send ~1.5 s of silence,
  clipping the first word. Record from another mic: `voxtype config set audio.device "sysdefault:CARD=<card>"`.

## Design

The constraints and the reasoning behind them are in [`AGENTS.md`](AGENTS.md); read it before changing code.

Functional core, imperative shell. Everything under `plugin/core/` is pure ES modules (no Qt,
no I/O), loaded by QML and by `node --test`; `plugin/Service.qml` + `plugin/infra/` are the
only code with side effects. The core is split by bounded context:

- `listening/` — push-to-talk session as a state machine: `reduce(state, event) -> { state, effects }`
- `interpretation/` — normalise transcripts; `parser.mjs` walks the command tree one word per level; `words.mjs` scores a heard word against a command word
- `commands/` — the command tree (`dsl.mjs`: `command` / `keyword` / `value` nodes), packs, and the registry that merges packs and rejects conflicts
- `execution/` — action descriptors and the `hyprctl` anti-corruption layer (descriptors -> argv)

Add commands by writing a pack (`{ id, commands(config) -> [root nodes], slotTypes?(config) }`)
in `plugin/core/commands/packs/` and listing it in `index.mjs`. Root nodes with the same name
merge across packs, so a pack can extend an existing command; `registryErrors()` reports
conflicts (duplicate `run`, colliding sibling words) and they are surfaced when config loads.
`tests/registry.test.mjs` shows a pack adding `move all space <n>` to the built-in `move`.

Speech text never reaches a shell: slots resolve to numbers or catalog entries, and every
exec is an argv array.

## Tests

```sh
node --test tests/*.test.mjs
QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -input tests/qml/tst_core.qml
```
