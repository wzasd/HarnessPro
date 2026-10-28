import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const coordinator = fileURLToPath(new URL("./coordinator.mjs", import.meta.url));
const stateDir = path.join(os.tmpdir(), `harnesspro-check-${process.pid}`);
const env = {
  ...process.env,
  HARNESSPRO_CHECK_STATE_DIR: stateDir,
  HARNESSPRO_CHECK_COMMAND: 'node -e "setTimeout(() => {}, 10000)"',
};

function call(action) {
  return JSON.parse(execFileSync(process.execPath, [coordinator, action], { env, encoding: "utf8" }));
}

test("starts, reports, and stops a real check process", async () => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  const started = call("start");
  assert.equal(started.status, "running");
  assert.ok(started.pid > 0);
  assert.equal(call("status").status, "running");
  assert.equal(call("stop").status, "stopped");
  assert.equal(call("status").status, "stopped");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(call("status").status, "stopped");
});
