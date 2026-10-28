import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { copyTaskTests, parseCodexUsage, selectCandidates } from "./evolution-core.mjs";

test("filters dominated candidates and selects operating points", () => {
  const baseline = { passRate: 0.5, tokenCost: 100 };
  const candidates = [
    { profile: "lite", passRate: 0.5, tokenCost: 80 },
    { profile: "heavy", passRate: 0.6, tokenCost: 120 },
    { profile: "weak", passRate: 0.4, tokenCost: 50 },
    { profile: "dominated", passRate: 0.5, tokenCost: 90 },
  ];
  const result = selectCandidates(candidates, baseline);
  assert.deepEqual(result.frontier.map((item) => item.profile), ["lite", "heavy"]);
  assert.equal(result.selected.lite.profile, "lite");
  assert.equal(result.selected.medium.profile, "lite");
  assert.equal(result.selected.heavy.profile, "heavy");
});

test("copies only the tests for the current task", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesspro-test-isolation-"));
  const tests = path.join(root, "tests");
  fs.mkdirSync(tests, { recursive: true });
  fs.writeFileSync(path.join(tests, "test_add.py"), "# add");
  fs.writeFileSync(path.join(tests, "test_subtract.py"), "# subtract");
  const workdir = path.join(root, "work");
  copyTaskTests(tests, workdir, { id: "add" });
  assert.equal(fs.existsSync(path.join(workdir, "tests", "test_add.py")), true);
  assert.equal(fs.existsSync(path.join(workdir, "tests", "test_subtract.py")), false);
});

test("sums token usage across completed turns", () => {
  const jsonl = [
    "Reading additional input from stdin...",
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20 } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 50, output_tokens: 10 } }),
  ].join("\n");
  assert.equal(parseCodexUsage(jsonl), 180);
});
