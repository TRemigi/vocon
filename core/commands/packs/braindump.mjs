// Commands: braindump, the notes organiser (~/dev/brain-dump). Pure; ES2017-conservative.
// Nothing is filed here: `braindump capture` queues the text and its own background service files it.
//
//   note <text>                       queue <text> as a note
//   note to <file> <text>             ...into that note (`braindump capture --file`)
//   note to <file> in <dir> <text>    ...into that note in that folder (`--dir` and `--file`)
//   brain dump <text>                 same (also `braindump <text>`)
//   brain dump status                 what is queued, waiting for review, and filed recently
//
// <file> and <dir> are vault paths named in config (`packs.braindump.files` / `.dirs`, spoken name ->
// path; `dirs` starts with braindump's own roots), so what reaches braindump's argv is a config value.
// The one exception is a <file> that is a single plain word, accepted only together with `in <dir>`
// ("note to todo in areas ..."): a normalised [a-z0-9]+ word can't be a flag or a path. A file that
// isn't known and has no `in <dir>` ("note to call mom") is queued unplaced, as before, with a toast.
// The note is taken from the raw transcript (see `afterWords`), so it keeps its case and punctuation;
// the slot only carries normalised words. `status` is a keyword and so wins over a note that starts
// with "status": say `note status ...` for that. Commands are global: capturing touches no window.
// Notes are meant to be kept, but by braindump (its queue and records), never by vocon: the text is
// not logged, shown in a toast, or written anywhere here (see `private` in actions.mjs).

import { noteCapture, noteStatus, notify } from "../../execution/actions.mjs";
import { afterWords } from "../../interpretation/utterance.mjs";
import { normalize } from "../../interpretation/utterance.mjs";
import { appSlot, wordsSlot } from "../../interpretation/slots.mjs";
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

// braindump's own top-level folders; what you can say after `in` without configuring anything.
var DEFAULT_DIRS = {
  inbox: "inbox",
  projects: "projects", project: "projects",
  areas: "areas", area: "areas",
  resources: "resources", resource: "resources",
  archives: "archives", archive: "archives",
};

// A vault-relative path from config, or "" when it isn't usable (braindump checks the rest and
// refuses a bad one before queueing anything).
function vaultPath(setting) {
  var path = text(setting).replace(/\/+$/, "");
  var usable = path !== "" && !/^[-\/]/.test(path) && !/[\u0000-\u001f]/.test(path)
    && path.split("/").indexOf("..") === -1;
  return usable ? path : "";
}

// Spoken name -> vault path, with the spoken name normalised the way transcripts are.
function pathsOf(map) {
  var out = {};
  Object.keys(map || {}).forEach(function (name) {
    var spoken = normalize(name).join(" ");
    var path = vaultPath(map[name]);
    if (spoken !== "" && path !== "") out[spoken] = path;
  });
  return out;
}

// A catalog slot whose value says what was said and how many words it took (the note text is
// read from the raw transcript past them). `freeWord` also accepts any single word as an unknown
// name, for the caller to use or refuse.
function placeSlot(paths, options, hint, freeWord) {
  var catalog = {};
  Object.keys(paths).forEach(function (spoken) { catalog[spoken] = { words: [spoken.split(" ")] }; });
  var known = appSlot(catalog, options);
  return {
    hint: hint,
    parse: function (tokens, index) {
      var found = known.parse(tokens, index).map(function (c) {
        return { value: { name: c.value, count: c.next - index, known: true }, next: c.next };
      });
      if (found.length === 0 && freeWord && index < tokens.length) {
        found = [{ value: { name: tokens[index], count: 1, known: false }, next: index + 1 }];
      }
      return found;
    },
  };
}

function distinct(values) {
  return values.filter(function (v, i, all) { return all.indexOf(v) === i; }).sort();
}

export var braindumpPack = {
  id: "braindump",
  help: { title: "Braindump notes", words: ["note", "braindump"] },

  slotTypes: function (config) {
    var o = options(config);
    var files = pathsOf(o.files);
    var dirs = pathsOf(Object.assign({}, DEFAULT_DIRS, o.dirs));
    var fileHint = "a note from packs.braindump.files" + (Object.keys(files).length ? " (" + Object.keys(files).sort().join(", ") + ")" : "") + ", or any one word with “in <dir>”";
    var dirHint = "a vault folder: " + distinct(Object.keys(dirs).map(function (k) { return dirs[k]; })).join(", ");
    return {
      words: wordsSlot(),
      noteFile: placeSlot(files, config.matching, fileHint, true),
      noteDir: placeSlot(dirs, config.matching, dirHint, false),
    };
  },

  commands: function (config) {
    var o = options(config);
    var bin = text(o.command) || "braindump";
    var withState = text(o.state) ? ["--state", text(o.state)] : [];
    var withVault = text(o.vault) ? ["--vault", text(o.vault)] : [];
    var files = pathsOf(o.files);
    var dirs = pathsOf(Object.assign({}, DEFAULT_DIRS, o.dirs));

    // braindump's placement flags for what was said after `to`, or null when the file isn't one we
    // can place: unknown, and no folder to put a plain word in. With a folder, a known file
    // contributes its own name, so "note to todo in work" is work/<name of todo>.
    var placement = function (file, dir) {
      var name = file.known ? files[file.name].split("/").pop() : file.name;
      if (dir) return ["--dir", dirs[dir.name], "--file", name];
      return file.known ? ["--file", files[file.name]] : null;
    };

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
    // The text after `to <file>` (and `in <dir>` when `withDir`).
    var captureTo = function (skip, withDir) {
      return value("text", "words", {
        run: function (args, ctx) {
          var place = placement(args.file, withDir ? args.dir : null);
          if (place === null) {
            var rest = afterWords(ctx.transcript, skip);
            return [noteCapture([bin, "capture"].concat(withState), rest),
              notify("Note", "No note file by that name after “to”; queued without a place", "low")];
          }
          var taken = skip + 1 + args.file.count + (withDir ? 1 + args.dir.count : 0);
          var said = afterWords(ctx.transcript, taken);
          if (said === "") return [notify("Note", "Nothing to capture", "low")];
          return [noteCapture([bin, "capture"].concat(withState, place), said)];
        },
      });
    };
    var to = function (skip) {
      return keyword("to", {}, [
        value("file", "noteFile", {}, [
          keyword("in", {}, [value("dir", "noteDir", {}, [captureTo(skip, true)])]),
          captureTo(skip, false),
        ]),
      ]);
    };
    var status = keyword("status", { run: function () {
      return [noteStatus([bin, "status"].concat(withState, withVault))];
    } });

    return [
      command("note", {}, [to(1), capture(1)]),
      command("braindump", {}, [status, to(1), capture(1)]),
      command("brain", {}, [keyword("dump", {}, [status, to(2), capture(2)])]),
    ];
  },
};
