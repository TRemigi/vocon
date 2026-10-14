// Commands: dictation. `dictate` doesn't act itself; it asks the session to treat the next
// utterance as text to type into the focused window instead of as a command (see
// listening/session.mjs for arming, expiry and the safety checks). Pure; ES2017-conservative.

import { command } from "../dsl.mjs";

export var dictationPack = {
  id: "dictation",

  commands: function () {
    return [
      command("dictate", { run: function () { return [{ type: "dictation.arm" }]; } }),
    ];
  },
};
