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
`bin/vocon-install` after changing plugin code. Avoid modifier combos for the key: if the
modifier is released first, the key-release event can be missed (a watchdog cancels it after
`voxtype.maxSeconds`).

## Try it without a microphone

```sh
omarchy-shell vocon simulate "space 2"     # runs the real pipeline + hyprctl
omarchy-shell vocon status                 # idle | listening | transcribing
```

Logs: `qs log -p /usr/share/omarchy/shell | grep vocon:`

## Commands

| Say | Does |
|---|---|
| "space 1", "workspace 1", "go to space 1" | focus workspace 1 |

## Design

Functional core, imperative shell. Everything under `plugin/core/` is pure ES modules (no Qt,
no I/O), loaded by QML and by `node --test`; `plugin/Service.qml` + `plugin/infra/` are the
only code with side effects. The core is split by bounded context:

- `listening/` — push-to-talk session as a state machine: `reduce(state, event) -> { state, effects }`
- `interpretation/` — normalise transcripts, compile phrase templates, match (`matched | ambiguous | nomatch`)
- `commands/` — command packs (`{ id, commands(config), slotTypes?(config) }`) and the registry
- `execution/` — action descriptors and the `hyprctl` anti-corruption layer (descriptors → argv)

Add commands by writing a pack in `plugin/core/commands/packs/` and listing it in `index.mjs`.
Speech text never reaches a shell: slots resolve to numbers or catalog entries, and every
exec is an argv array.

## Tests

```sh
node --test tests/interpretation.test.mjs tests/execution.test.mjs tests/config.test.mjs tests/session.test.mjs
QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner -input tests/qml/tst_core.qml
```
