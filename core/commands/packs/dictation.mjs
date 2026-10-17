// Commands: dictation. `dictate` doesn't act itself; it asks the session to type text into the
// focused window instead of treating it as a command (see listening/session.mjs for arming,
// expiry and the safety checks). Pure; ES2017-conservative.
//
//   dictate | input    arms dictation: the next utterance is typed
//   dictate <text>     types <text> straight away (`inline`); the session takes the text from the
//                      raw transcript, since the slot only carries normalised words
// `input` is accepted everywhere `dictate` is.

import { command, value } from "../dsl.mjs";
import { wordsSlot } from "../../interpretation/slots.mjs";

export var dictationPack = {
  id: "dictation",
  help: { title: "Dictation", words: ["dictate", "input"], groups: ["core"] },

  slotTypes: function () {
    return { words: wordsSlot() };
  },

  commands: function () {
    return [
      command("dictate", { words: ["input"], run: function () { return [{ type: "dictation.arm" }]; } }, [
        value("text", "words", { run: function () { return [{ type: "dictation.arm", inline: true }]; } }),
      ]),
    ];
  },
};
