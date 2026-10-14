// Commands: Claude Desktop adapter, driven by the app's own keyboard shortcuts (Windows/Linux).
// Pure; ES2017-conservative. Sources: the shortcut table in code.claude.com/docs/en/desktop (Code
// tab) and the application menu of the installed Linux build (accelerators read from its bundle).
//
// Two forms of the same commands:
//   session next         while Claude Desktop is focused (everything below)
//   claude session next  from anywhere: focuses Claude Desktop first (navigation only)
// Anything that acts on a session or a prompt (close, stop, send, edit keys) exists only in the
// first form, so it acts on a window you are looking at.
//
//   tab home|code                        Ctrl+K, type the name, Enter (no tab shortcut exists)
//   session new|next|previous            Ctrl+N, Ctrl+Tab, Ctrl+Shift+Tab
//   pane diff|terminal                   Ctrl+Shift+D, Ctrl+`                      (toggles)
//   side chat                            Ctrl+;
//   menu model|permission|effort         Ctrl+Shift+I, Ctrl+Shift+M, Ctrl+Shift+E
//   view                                 Ctrl+O (cycle view modes)
//   palette | settings | sidebar | shortcuts    Ctrl+K, Ctrl+, , Ctrl+B, Ctrl+/
//   find [next|previous]                 Ctrl+F, Ctrl+G, Ctrl+Shift+G
//   zoom in|out|reset | fullscreen       Ctrl+=, Ctrl+-, Ctrl+0, F11
//   close session|pane | reopen          Ctrl+W, Ctrl+\, Ctrl+Shift+T          (focused only)
//   stop | send | newline | accept       Esc, Enter, Shift+Enter, Tab           (focused only)
//   choose <item>                        item 1-9 of the open menu              (focused only)
//   undo|redo|cut|copy|paste|select all  Ctrl+Z, Ctrl+Shift+Z, Ctrl+X/C/V/A     (focused only)

import { focusWindow, keysAction, notify } from "../../execution/actions.mjs";
import { combo, key, text, sleep } from "../../execution/keys.mjs";
import { classMatches, findWindow } from "../../execution/windows.mjs";
import { numberSlot } from "../../interpretation/slots.mjs";
import { command, keyword, value } from "../dsl.mjs";

function options(config) {
  return Object.assign({
    match: "^com.anthropic.Claude$",   // window class of Claude Desktop
    send: "Return",                    // key `send` presses
    focusDelay: 300,                   // ms to let the window take focus (the `claude ...` form)
    paletteDelay: 350,                 // ms for the command palette to open before typing
    resultsDelay: 450,                 // ms for its results to settle before Enter
  },(config.packs && config.packs.claude) || {});
}

// A node's run: `steps` is a key-step list or a function of the parsed args; `finish` decides how
// they are delivered (to the focused window, or after focusing Claude Desktop).
function leaf(finish, steps) {
  return {
    run: function (args, ctx) {
      return finish(typeof steps === "function" ? steps(args) : steps, ctx);
    },
  };
}

// Opens or toggles something in the UI; safe to say from any app.
function navigation(o, finish) {
  var go = function (steps) { return leaf(finish, steps); };
  // The app has no shortcut for its tabs, so go through the command palette: the first result for
  // the tab's name is the tab itself.
  var viaPalette = function (name) {
    return go([combo("ctrl+k"), sleep(o.paletteDelay), text(name), sleep(o.resultsDelay), key("Return")]);
  };
  return [
    keyword("tab", {}, [
      keyword("home", viaPalette("home")),
      keyword("code", viaPalette("code")),
    ]),

    keyword("session", {}, [
      keyword("new", go([combo("ctrl+n")])),
      keyword("next", go([combo("ctrl+Tab")])),
      keyword("previous", go([combo("ctrl+shift+Tab")])),
    ]),

    keyword("pane", {}, [
      keyword("diff", go([combo("ctrl+shift+d")])),
      keyword("terminal", go([combo("ctrl+grave")])),
    ]),

    keyword("side", {}, [keyword("chat", go([combo("ctrl+semicolon")]))]),

    keyword("menu", {}, [
      keyword("model", go([combo("ctrl+shift+i")])),
      keyword("permission", Object.assign({ words: ["permissions", "mode"] }, go([combo("ctrl+shift+m")]))),
      keyword("effort", go([combo("ctrl+shift+e")])),
    ]),

    keyword("view", Object.assign({ words: ["views"] }, go([combo("ctrl+o")]))),

    keyword("palette", Object.assign({ words: ["search"] }, go([combo("ctrl+k")]))),
    keyword("settings", go([combo("ctrl+comma")])),
    keyword("sidebar", go([combo("ctrl+b")])),
    keyword("shortcuts", go([combo("ctrl+slash")])),

    keyword("find", go([combo("ctrl+f")]), [
      keyword("next", go([combo("ctrl+g")])),
      keyword("previous", go([combo("ctrl+shift+g")])),
    ]),

    // The menu's own "Zoom In" is Ctrl+Plus, which needs Shift on most layouts; the app also
    // registers Ctrl+= for it.
    keyword("zoom", {}, [
      keyword("in", go([combo("ctrl+equal")])),
      keyword("out", go([combo("ctrl+minus")])),
      keyword("reset", Object.assign({ words: ["actual", "normal"] }, go([combo("ctrl+0")]))),
    ]),

    // "full screen" is two words to the recogniser as often as one.
    keyword("fullscreen", go([key("F11")])),
    keyword("full", {}, [keyword("screen", go([key("F11")]))]),
  ];
}

// Act on a session or the prompt; deliberately not offered from other apps.
function actions(o, finish) {
  var go = function (steps) { return leaf(finish, steps); };
  return [
    keyword("close", {}, [
      keyword("session", go([combo("ctrl+w")])),
      keyword("pane", go([combo("ctrl+backslash")])),
    ]),
    keyword("reopen", go([combo("ctrl+shift+t")]), [keyword("session", go([combo("ctrl+shift+t")]))]),

    keyword("stop", go([key("Escape")])),          // stops Claude's response
    keyword("send", go([combo(o.send)])),
    keyword("newline", go([combo("shift+Return")])),
    keyword("accept", go([key("Tab")])),           // the suggested prompt, in an empty prompt box

    // Digits select an item in an open menu (`menu model`, then `choose 2`); with no menu open
    // they would be typed into the prompt, hence focused-only like the rest.
    keyword("choose", {}, [
      value("item", "item", go(function (args) { return [key(String(args.item))]; })),
    ]),

    keyword("undo", go([combo("ctrl+z")])),
    keyword("redo", go([combo("ctrl+shift+z")])),
    keyword("cut", go([combo("ctrl+x")])),
    keyword("copy", go([combo("ctrl+c")])),
    keyword("paste", go([combo("ctrl+v")])),
    keyword("select", {}, [keyword("all", go([combo("ctrl+a")]))]),
  ];
}

export var claudePack = {
  id: "claude",

  slotTypes: function () {
    return { item: numberSlot(9, "menu item number") };
  },

  commands: function (config) {
    var o = options(config);

    // Claude Desktop is focused: send keys straight to it.
    var focused = function (steps) { return [keysAction(steps)]; };
    var whenClaude = function (ctx) { return classMatches(ctx.active, o.match); };

    // From anywhere: focus Claude Desktop, give it a moment, then send the keys.
    var anywhere = function (steps, ctx) {
      var window = findWindow(ctx.clients, o.match);
      if (!window) return [notify("Claude Desktop isn't running", "Start it first, then try again", "low")];
      return [focusWindow(window.address), keysAction([sleep(o.focusDelay)].concat(steps))];
    };

    var scoped = navigation(o, focused).concat(actions(o, focused)).map(function (node) {
      return Object.assign({}, node, { when: whenClaude, scope: "while Claude Desktop is focused" });
    });
    return scoped.concat([command("claude", {}, navigation(o, anywhere))]);
  },
};
