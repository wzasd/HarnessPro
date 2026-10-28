import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildModelArgs, classifyTask, routeFor } from "./router.mjs";

const policyPath = fileURLToPath(new URL("./policy.json", import.meta.url));

test("classifies tasks without a model call", () => {
  assert.equal(classifyTask("Fix a typo in the README"), "lite");
  assert.equal(classifyTask("Add unit tests for the parser"), "medium");
  assert.equal(classifyTask("Debug a production race condition in the distributed lock"), "heavy");
  assert.equal(classifyTask(""), "medium");
});

test("maps each profile to agent-specific models", () => {
  assert.deepEqual(routeFor("opencode2", "heavy", policyPath), {
    profile: "heavy",
    model: "omniroute/ponyai/claude-opus-5#high",
    effort: "high",
  });
  assert.equal(routeFor("codex", "heavy", policyPath).model, "gpt-6-luna");
  assert.deepEqual(buildModelArgs("codex", "medium", policyPath), [
    "-m", "gpt-6-luna", "-c", "model_reasoning_effort=medium",
  ]);
  assert.deepEqual(buildModelArgs("pi", "lite", policyPath), [
    "--model", "omniroute/ponyai/gpt-5.6-luna", "--thinking", "low",
  ]);
});
