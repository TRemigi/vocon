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

`<n>` is 1-10, as a digit or a number word. Synonyms: `workspace` for `space`, `send` for
`move`, `focus`/`current` for `focused`. Free-form phrasing ("go to workspace 4", "move window
to space 2") is deliberately not accepted.

Each word is resolved only against what is valid at that point, so commands can't collide:
`move` can later gain `all` or `group` arguments (`move all space 2`, `move focused group dev`)
without affecting anything else. A word that doesn't fit is reported by position, e.g.
`"move window" - no match after "move", expected: focused`.

Mishearings are handled per word, not per phrase: near-misses of longer words (similarity >=
`matching.threshold`) and `matching.aliases` (command word -> words the recogniser tends to
produce, e.g. `"space": ["pace", "base"]`). A list you set for a word replaces its default list.

## Troubleshooting

- Nothing happens on F10: `omarchy-shell vocon status`, then `qs log -p /usr/share/omarchy/shell | grep vocon:`.
  vocon reports VoxType being down, busy, or failing to start recording (e.g. a wrong
  `audio.device`). VoxType takes ALSA names (`sysdefault:CARD=...`), not `pactl` source names.
- Headset mics: Bluetooth headsets switch profile when the mic opens and send ~1.5 s of silence,
  clipping the first word. Record from another mic: `voxtype config set audio.device "sysdefault:CARD=<card>"`.

## Design

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
node --test tests/interpretation.test.mjs tests/execution.test.mjs tests/config.test.mjs tests/session.test.mjs
QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -input tests/qml/tst_core.qml
```
