import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const launcher = fileURLToPath(new URL("./bin/harnesspro", import.meta.url));

test("launcher exports the selected profile", () => {
  const output = execFileSync(launcher, ["lite", "/bin/sh", "-c", "printf %s \"$HARNESSPRO_PROFILE\""], { encoding: "utf8" });
  assert.equal(output, "lite");
});

test("launcher delegates check commands", () => {
  const stateDir = path.join(os.tmpdir(), `harnesspro-launcher-check-${process.pid}`);
  fs.rmSync(stateDir, { recursive: true, force: true });
  const env = {
    ...process.env,
    HARNESSPRO_CHECK_STATE_DIR: stateDir,
    HARNESSPRO_CHECK_COMMAND: 'node -e "setTimeout(() => {}, 10000)"',
  };
  const started = JSON.parse(execFileSync(launcher, ["checks", "start"], { env, encoding: "utf8" }));
  assert.equal(started.status, "running");
  const stopped = JSON.parse(execFileSync(launcher, ["checks", "stop"], { env, encoding: "utf8" }));
  assert.equal(stopped.status, "stopped");
});

test("launcher rejects an unknown profile", () => {
  assert.throws(
    () => execFileSync(launcher, ["unknown", "/bin/true"], { stdio: "pipe" }),
    (error) => error.status === 64,
  );
});
