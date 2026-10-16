import { test } from "node:test";
import assert from "node:assert/strict";
import { toArgv } from "../plugin/core/execution/hyprctl.mjs";
import * as A from "../plugin/core/execution/actions.mjs";

test("focus workspace -> hl.dsp.focus", () => {
  assert.deepEqual(toArgv(A.focusWorkspace(3)), ["hyprctl", "dispatch", 'hl.dsp.focus({ workspace = "3" })']);
});

test("move window follows by default, silent when asked", () => {
  assert.equal(toArgv(A.moveWindowToWorkspace(2))[2], 'hl.dsp.window.move({ workspace = "2" })');
  assert.equal(toArgv(A.moveWindowToWorkspace(2, false))[2], 'hl.dsp.window.move({ workspace = "2", follow = false })');
});

test("focus window validates the address", () => {
  assert.equal(toArgv(A.focusWindow("0x55aa"))[2], 'hl.dsp.focus({ window = "address:0x55aa" })');
  assert.throws(() => toArgv(A.focusWindow('0x1" }) os.execute("x')), /invalid window address/);
});

test("workspace must be a positive integer", () => {
  assert.throws(() => toArgv(A.focusWorkspace('1" })')), /invalid workspace/);
  assert.throws(() => toArgv(A.focusWorkspace(0)), /invalid workspace/);
});

test("swapWindow maps spoken directions to Hyprland's", () => {
  for (const [word, d] of [["left", "l"], ["right", "r"], ["up", "u"], ["down", "d"]]) {
    assert.deepEqual(toArgv(A.swapWindow(word)), ["hyprctl", "dispatch", `hl.dsp.window.swap({ direction = "${d}" })`]);
  }
});

test("swapWindow rejects anything but the four directions", () => {
  for (const bad of ["l", "diagonal", 'left" })', "", undefined, "constructor", "__proto__"]) {
    assert.throws(() => toArgv(A.swapWindow(bad)), /invalid direction/, String(bad));
  }
});

test("non-hyprland actions are left alone", () => {
  assert.equal(toArgv(A.exec(["true"])), null);
});
