import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { foldRepeatedLines, getProfile, reminder, transformResult } from "./core.mjs";

const policyPath = fileURLToPath(new URL("./policy.json", import.meta.url));

test("loads the selected shared profile", () => {
  assert.deepEqual(getProfile("lite", policyPath), { economy: 8, converge: 14, max: 22 });
});

test("folds only repeated runs longer than three lines", () => {
  assert.equal(foldRepeatedLines("a\na\na\nb"), "a\na\na\nb");
  assert.equal(foldRepeatedLines("a\na\na\na\na\nb"), "a\n[previous line repeated 4 more times]\nb");
});

test("adds phase reminders to the last text result", () => {
  const limits = { economy: 2, converge: 3, max: 4 };
  assert.match(reminder(2, limits), /Economy phase/);
  assert.match(reminder(3, limits), /Convergence phase/);
  assert.match(reminder(4, limits), /Tool budget reached/);
  const result = transformResult({ content: [{ type: "text", text: "x\nx\nx\nx" }] }, reminder(2, limits));
  assert.match(result.content[0].text, /previous line repeated 3 more times/);
  assert.match(result.content[0].text, /Economy phase/);
});
