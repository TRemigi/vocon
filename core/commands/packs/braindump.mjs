// Commands: braindump, the notes organiser (~/dev/brain-dump). Pure; ES2017-conservative.
// Nothing is filed here: `braindump capture` queues the text and its own background service files it.
//
//   note <text>              queue <text> as a note
//   brain dump <text>        same (also `braindump <text>`)
//   brain dump status        what is queued, waiting for review, and filed recently
//
// The note is taken from the raw transcript (see `afterWords`), so it keeps its case and punctuation;
// the slot only carries normalised words. `status` is a keyword and so wins over a note that starts
// with "status": say `note status ...` for that. Commands are global: capturing touches no window.
// Notes are meant to be kept, but by braindump (its queue and records), never by vocon: the text is
// not logged, shown in a toast, or written anywhere here (see `private` in actions.mjs).

import { noteCapture, noteStatus, notify } from "../../execution/actions.mjs";
import { afterWords } from "../../interpretation/utterance.mjs";
import { wordsSlot } from "../../interpretation/slots.mjs";
import { command, keyword, value } from "../dsl.mjs";

function options(config) {
  return Object.assign({
    command: "braindump",   // the binary; use an absolute path if the shell's PATH lacks it (~/go/bin)
    state: "",              // --state: queue/records directory, when not braindump's default
    vault: "",              // --vault for `status`: enables its "waiting for you" review count
  }, (config.packs && config.packs.braindump) || {});
}

function text(setting) {
  return typeof setting === "string" ? setting.trim() : "";
}

export var braindumpPack = {
  id: "braindump",
  help: { title: "Braindump notes", words: ["note", "braindump"] },

  slotTypes: function () {
    return { words: wordsSlot() };
  },

  commands: function (config) {
    var o = options(config);
    var bin = text(o.command) || "braindump";
    var withState = text(o.state) ? ["--state", text(o.state)] : [];
    var withVault = text(o.vault) ? ["--vault", text(o.vault)] : [];

    // `skip` = how many spoken words the command itself took (`note`: 1, `brain dump`: 2).
    var capture = function (skip) {
      return value("text", "words", {
        run: function (args, ctx) {
          var said = afterWords(ctx.transcript, skip);
          if (said === "") return [notify("Note", "Nothing to capture", "low")];
          return [noteCapture([bin, "capture"].concat(withState), said)];
        },
      });
    };
    var status = keyword("status", { run: function () {
      return [noteStatus([bin, "status"].concat(withState, withVault))];
    } });

    return [
      command("note", {}, [capture(1)]),
      command("braindump", {}, [status, capture(1)]),
      command("brain", {}, [keyword("dump", {}, [status, capture(2)])]),
    ];
  },
};
