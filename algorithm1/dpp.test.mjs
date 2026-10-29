import assert from "node:assert/strict";
import test from "node:test";
import { buildDppKernel, selectCoreset } from "./dpp.mjs";

test("selects challenging and diverse tasks with the paper kernel", () => {
  const tasks = [
    { id: "similar-a", difficulty: 8, embedding: [1, 0] },
    { id: "similar-b", difficulty: 9, embedding: [1, 0] },
    { id: "different", difficulty: 1, embedding: [0, 1] },
  ];
  const kernel = buildDppKernel(tasks);
  assert.equal(kernel.length, 3);
  const selected = selectCoreset(tasks, 2);
  assert.deepEqual(selected.map((task) => task.id), ["similar-b", "different"]);
});

test("normalizes fingerprint embeddings before cosine similarity", () => {
  const tasks = [
    { id: "a", difficulty: 8, embedding: [2, 0] },
    { id: "b", difficulty: 8, embedding: [1, 0] },
  ];
  const kernel = buildDppKernel(tasks);
  assert.ok(Math.abs(kernel[0][1] - kernel[1][1]) < 1e-9);
});
