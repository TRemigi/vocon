// Commands: Slack adapter, driven by Slack's own keyboard shortcuts (Windows/Linux).
// Pure; ES2017-conservative. Sources: slack.com/help/articles/201374536 and 115003340723.
//
// Two forms of the same commands:
//   channel dev          while Slack is focused (everything below)
//   slack channel dev    from anywhere: focuses Slack first (navigation only)
// Sending, editing and deleting exist only in the first form, so they act on a window you are
// looking at, never on one that merely happened to be open.
//
//   channel <name>       Ctrl+K, type the name, Enter   (also: dm / person / conversation)
//   unread [next|previous|all|first]    Alt+Shift+Down / Up, Ctrl+Shift+A, Ctrl+J
//   back | forward       Alt+Left / Alt+Right (history)
//   message [up|down|top|bottom|thread|main|page up|page down]   Up-arrow navigation
//   edit | delete | confirm | send | newline    on the focused message / composer
//
// Not available: a shortcut to focus the message field (Slack documents none; F6 cycles sections
// in an undocumented order). Switching conversations normally leaves the composer focused.

import { focusWindow, keysAction, notify } from "../../execution/actions.mjs";
import { combo, key, text, sleep } from "../../execution/keys.mjs";
import { classMatches, findWindow } from "../../execution/windows.mjs";
import { wordsSlot } from "../../interpretation/slots.mjs";
import { command, keyword, value } from "../dsl.mjs";

function options(config) {
  return Object.assign({
    match: "^slack$",          // window class of the Slack app
    send: "Return",            // "ctrl+Return" if Slack is set to send with Ctrl+Enter
    focusDelay: 300,           // ms to let Slack take focus (the `slack ...` form)
    switcherDelay: 350,        // ms for the quick switcher to open before typing
    resultsDelay: 450,         // ms for its results to settle before Enter
  }, (config.packs && config.packs.slack) || {});
}

// A node's run: `steps` is a key-step list or a function of the parsed args; `finish` decides how
// the steps are delivered (to the focused window, or after focusing Slack).
function leaf(finish, steps) {
  return {
    run: function (args, ctx) {
      return finish(typeof steps === "function" ? steps(args) : steps, ctx);
    },
  };
}

function navigation(o, finish) {
  var go = function (steps) { return leaf(finish, steps); };
  return [
    keyword("channel", { words: ["dm", "person", "conversation"] }, [
      value("name", "words", go(function (args) {
        return [combo("ctrl+k"), sleep(o.switcherDelay), text(args.name), sleep(o.resultsDelay), key("Return")];
      })),
    ]),

    keyword("unread", go([combo("alt+shift+Down")]), [
      keyword("next", go([combo("alt+shift+Down")])),
      keyword("previous", go([combo("alt+shift+Up")])),
      keyword("all", go([combo("ctrl+shift+a")])),
      keyword("first", go([combo("ctrl+j")])),
    ]),

    keyword("back", go([combo("alt+Left")])),
    keyword("forward", go([combo("alt+Right")])),

    // Up from an empty composer starts message navigation (or edits your last message, depending
    // on a Slack preference), so a bare "message" begins at the latest message.
    keyword("message", go([key("Up")]), [
      keyword("up", Object.assign({ words: ["previous"] }, go([key("Up")]))),
      keyword("down", Object.assign({ words: ["next"] }, go([key("Down")]))),
      keyword("top", Object.assign({ words: ["oldest"] }, go([key("Home")]))),
      keyword("bottom", Object.assign({ words: ["newest", "latest"] }, go([key("End")]))),
      keyword("page", {}, [
        keyword("up", go([key("Page_Up")])),
        keyword("down", go([key("Page_Down")])),
      ]),
      keyword("thread", go([key("Right")])),
      keyword("main", go([key("Left")])),
    ]),
  ];
}

// Act on the focused composer or message; deliberately not offered from other apps.
function actions(o, finish) {
  var go = function (steps) { return leaf(finish, steps); };
  return [
    keyword("edit", go([key("e")])),
    keyword("delete", go([key("Delete")])),      // opens Slack's confirmation; `confirm` accepts it
    keyword("confirm", go([key("Return")])),
    keyword("send", go([combo(o.send)])),
    keyword("newline", go([combo("shift+Return")])),
  ];
}

export var slackPack = {
  id: "slack",

  slotTypes: function () {
    return { words: wordsSlot() };
  },

  commands: function (config) {
    var o = options(config);

    // Slack is focused: send keys straight to it.
    var focused = function (steps) { return [keysAction(steps)]; };
    var whenSlack = function (ctx) { return classMatches(ctx.active, o.match); };

    // From anywhere: focus Slack, give it a moment, then send the keys.
    var anywhere = function (steps, ctx) {
      var window = findWindow(ctx.clients, o.match);
      if (!window) return [notify("Slack isn't running", "Say “open slack” to start it", "low")];
      return [focusWindow(window.address), keysAction([sleep(o.focusDelay)].concat(steps))];
    };

    var scoped = navigation(o, focused).concat(actions(o, focused)).map(function (node) {
      return Object.assign({}, node, { when: whenSlack });
    });
    return scoped.concat([command("slack", {}, navigation(o, anywhere))]);
  },
};
