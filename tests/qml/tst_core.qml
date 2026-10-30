import QtQuick
import QtTest
import "../../core/pipeline.mjs" as Pipeline
import "../../core/listening/session.mjs" as Session
import "../../core/execution/hyprctl.mjs" as Hyprctl
import "../../core/config.mjs" as Config
import "../../core/execution/keys.mjs" as Keys
import "../../core/execution/notes.mjs" as Notes
import "../../core/commands/registry.mjs" as Registry
import "../../core/commands/packs/index.mjs" as Packs
import "../../core/commands/listing.mjs" as Listing
import "../../core/assistant/windows.mjs" as AssistWindows
import "../../core/assistant/ollama.mjs" as Ollama
import "../../core/assistant/choice.mjs" as AssistChoice

// Loads the real core under Qt's V4 engine: catches syntax/import forms V4 rejects.
TestCase {
  name: "core under QML"

  function test_pipeline_space_one() {
    var r = Pipeline.interpret(Config.defaults, { clients: [] }, "Space 1.")
    compare(r.outcome.kind, "matched")
    compare(r.actions.length, 1)
    compare(r.actions[0].type, "hypr.focusWorkspace")
    compare(r.actions[0].workspace, 1)
  }

  function test_pipeline_move_focused_space_one() {
    var r = Pipeline.interpret(Config.defaults, { clients: [] }, "Move space 1.")
    compare(r.outcome.kind, "matched")
    compare(r.actions.length, 1)
    compare(r.actions[0].type, "hypr.moveWindowToWorkspace")
    compare(r.actions[0].workspace, 1)
    compare(r.actions[0].follow, true)
  }

  function test_pipeline_fuzzy_alias() {
    var r = Pipeline.interpret(Config.defaults, { clients: [] }, "Base 2.")
    compare(r.outcome.kind, "matched")
    compare(r.actions[0].workspace, 2)
  }

  function test_pipeline_open_app_focuses_or_launches() {
    var cfg = Config.parse('{"apps":{"slack":{}}}').config
    var running = [{ address: "0xabc", "class": "slack", title: "x", mapped: true }]

    var focus = Pipeline.interpret(cfg, { clients: running }, "Open Slack.")
    compare(focus.outcome.kind, "matched")
    compare(focus.actions[0].type, "hypr.focusWindow")
    compare(focus.actions[0].address, "0xabc")

    var launch = Pipeline.interpret(cfg, { clients: [] }, "Open Slack.")
    compare(launch.actions[0].type, "app.launch")
    compare(launch.actions[0].argv[0], "slack")
  }

  function test_custom_command_with_when() {
    var cfg = Config.parse('{"commands":[{"say":"tab next","exec":["x"],"when":{"activeClass":"^firefox$"}}]}').config
    var inFirefox = [{ address: "0x1", "class": "firefox", title: "", mapped: true, focusHistoryID: 0 }]
    var inSlack = [{ address: "0x2", "class": "slack", title: "", mapped: true, focusHistoryID: 0 }]

    var hit = Pipeline.interpret(cfg, { clients: inFirefox }, "Tab next.")
    compare(hit.outcome.kind, "matched")
    compare(hit.actions[0].type, "exec")
    compare(Pipeline.interpret(cfg, { clients: inSlack }, "Tab next.").outcome.kind, "nomatch")
  }

  function test_arrow_keys_under_v4() {
    var anywhere = [{ address: "0x1", "class": "com.mitchellh.ghostty", title: "", mapped: true, focusHistoryID: 0 }]
    compare(Keys.toArgv(Pipeline.interpret(Config.defaults, { clients: anywhere }, "Down.").actions[0]).join(" "),
            "wtype -k Down")
    compare(Keys.toArgv(Pipeline.interpret(Config.defaults, { clients: anywhere }, "Down three.").actions[0]).join(" "),
            "wtype -k Down -k Down -k Down")
    compare(Pipeline.interpret(Config.defaults, { clients: anywhere }, "Down 21.").outcome.kind, "nomatch")
  }

  function test_claude_pack_under_v4() {
    var claude = [{ address: "0x1", "class": "com.anthropic.Claude", title: "", mapped: true, focusHistoryID: 0 }]
    var terminal = [{ address: "0x2", "class": "com.mitchellh.ghostty", title: "", mapped: true, focusHistoryID: 0 },
                    { address: "0x1", "class": "com.anthropic.Claude", title: "", mapped: true, focusHistoryID: 1 }]

    var hit = Pipeline.interpret(Config.defaults, { clients: claude }, "Session next.")
    compare(hit.outcome.kind, "matched")
    compare(Keys.toArgv(hit.actions[0]).join(" "), "wtype -M ctrl -k Tab -m ctrl")

    var far = Pipeline.interpret(Config.defaults, { clients: terminal }, "Claude settings.")
    compare(far.actions[0].type, "hypr.focusWindow")
    compare(Pipeline.interpret(Config.defaults, { clients: terminal }, "Close session.").outcome.kind, "nomatch")
  }

  function test_braindump_pack_under_v4() {
    var hit = Pipeline.interpret(Config.defaults, { clients: [] }, "Brain dump. Renew my passport, by May.")
    compare(hit.outcome.kind, "matched")
    compare(hit.actions[0].type, "note.capture")
    compare(hit.actions[0].text, "Renew my passport, by May.")
    var argv = Notes.toArgv(hit.actions[0])
    compare(argv[0], "sh")
    compare(argv[4], "Renew my passport, by May.")
    compare(argv.slice(5).join(" "), "braindump capture")
    compare(Notes.toArgv(Pipeline.interpret(Config.defaults, { clients: [] }, "Braindump status.").actions[0]).join(" "), "braindump status")
  }

  function test_slack_keys_and_dictation_under_v4() {
    var cfg = Config.defaults
    var slack = [{ address: "0x1", "class": "slack", title: "", mapped: true, focusHistoryID: 0 }]

    var ch = Pipeline.interpret(cfg, { clients: slack }, "Channel dev platform.")
    compare(ch.outcome.kind, "matched")
    var argv = Keys.toArgv(ch.actions[0])
    compare(argv[0], "wtype")
    verify(argv.indexOf("dev platform") !== -1)

    var s = Session.initialState()
    var steps = [{ type: "PttPressed" }, { type: "PttReleased" },
                 { type: "TranscriptReceived", text: "dictate" }, { type: "ClientsSnapshot", clients: slack, unlocked: true },
                 { type: "PttPressed" }, { type: "PttReleased" },
                 { type: "TranscriptReceived", text: "hello there" }, { type: "ClientsSnapshot", clients: slack, unlocked: true }]
    var effects = []
    for (var i = 0; i < steps.length; i++) {
      var r = Session.reduce(s, steps[i]); s = r.state; effects = effects.concat(r.effects)
    }
    var typed = effects.filter(function (e) { return e.type === "text.type" })
    compare(typed.length, 1)
    compare(Keys.toArgv(typed[0])[4], "hello there")
    compare(s.dictation, null)
  }

  function test_command_listing_under_v4() {
    var registry = Registry.buildRegistry(Packs.builtinPacks, Config.defaults)
    var lines = Listing.render(Listing.describe(registry), { synonyms: false })
    verify(lines.indexOf("  space <n>") !== -1)
    verify(lines.indexOf("Only while Slack is focused:") !== -1)
  }

  function test_unusable_config_is_flagged() {
    compare(Config.parse("{nope").ok, false)
    compare(Config.parse("{}").ok, true)
  }

  function test_assistant_windows_under_v4() {
    var cfg = Config.defaults
    var clients = [
      { address: "0x1000", mapped: true, hidden: false, focusHistoryID: 0, workspace: { id: 1 }, "class": "chromium", title: "Jira board" },
      { address: "0x1001", mapped: true, hidden: false, focusHistoryID: 1, workspace: { id: 2 }, "class": "spotify", title: "Spotify" }
    ]
    var windows = AssistWindows.candidates(clients, cfg)
    compare(windows.length, 2)
    var parsed = AssistWindows.parseIntent('{"verb":"send","matches":[1],"workspace":3}', windows.length)
    verify(parsed.ok)
    var planned = AssistWindows.plan(parsed.intent, windows, { workspace: 1 })
    compare(planned.kind, "act")
    compare(Hyprctl.toArgv(planned.actions[0])[2], 'hl.dsp.window.move({ workspace = "3", follow = false, window = "address:0x1001" })')
    var body = Ollama.chatBody(AssistWindows.buildRequest(windows, "send spotify to workspace three"), cfg)
    compare(body.think, "low")
    verify(Ollama.isLoopbackEndpoint(cfg.assistant.endpoint))
    verify(!Ollama.isLoopbackEndpoint("http://example.com:11434"))
  }

  function test_assistant_session_under_v4() {
    var cfg = Config.parse('{"assistant":{"enabled":true}}').config
    var s = Session.initialState(cfg)
    var r = Session.reduce(s, { type: "AssistPressed", at: 1000000 })
    compare(r.state.phase, "unlocking")
    r = Session.reduce(r.state, { type: "UnlockResult", ok: true, at: 1000500 })
    compare(r.state.phase, "idle")
    verify(r.state.unlockedUntil > 1000500)
    var clients = [{ address: "0x1000", mapped: true, hidden: false, focusHistoryID: 0, workspace: { id: 1 }, "class": "chromium", title: "Jira" }]
    var events = [{ type: "AssistPressed", at: 1002000 }, { type: "AssistReleased", at: 1002500 },
      { type: "TranscriptReceived", text: "go to jira", at: 1003000 },
      { type: "ClientsSnapshot", clients: clients, unlocked: true, at: 1003100 }]
    var state = r.state
    var effects = []
    for (var i = 0; i < events.length; i++) {
      var step = Session.reduce(state, events[i])
      state = step.state
      effects = effects.concat(step.effects)
    }
    compare(state.phase, "thinking")
    var call = effects.filter(function (e) { return e.type === "llm.interpret" })[0]
    compare(call.id, 1)
    var done = Session.reduce(state, { type: "ModelReplied", id: 1, text: '{"verb":"focus","matches":[0],"workspace":0}', at: 1009000 })
    compare(done.effects.filter(function (e) { return e.type === "hypr.focusWindow" })[0].address, "0x1000")
    compare(AssistChoice.parseChoice("the second one", 3).number, 2)
  }

  function test_hyprctl_argv() {
    var argv = Hyprctl.toArgv({ type: "hypr.focusWorkspace", workspace: 2 })
    compare(argv[0], "hyprctl")
    compare(argv[2], 'hl.dsp.focus({ workspace = "2" })')
  }

  function test_session_flow() {
    var s = Session.initialState()
    var steps = [{ type: "PttPressed" }, { type: "PttReleased" },
                 { type: "TranscriptReceived", text: "space three" },
                 { type: "ClientsSnapshot", clients: [], unlocked: true }]
    var effects = []
    for (var i = 0; i < steps.length; i++) {
      var r = Session.reduce(s, steps[i])
      s = r.state
      effects = effects.concat(r.effects)
    }
    compare(s.phase, "idle")
    var focus = effects.filter(function (e) { return e.type === "hypr.focusWorkspace" })
    compare(focus.length, 1)
    compare(focus[0].workspace, 3)
  }

  function test_help_menu_rows_and_filter() {
    var r = Pipeline.interpret(Config.defaults, { clients: [] }, "help slack")
    compare(r.outcome.kind, "matched")
    compare(r.actions.length, 1)
    compare(r.actions[0].type, "help.show")
    compare(r.actions[0].title, "Slack")
    verify(r.actions[0].rows.length > 0)
    var hits = Listing.filterRows(r.actions[0].rows, "channel")
    verify(hits.length > 0)
    compare(Listing.filterRows(r.actions[0].rows, "zzzz").length, 0)
  }
}
