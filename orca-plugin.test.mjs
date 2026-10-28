import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import activate from "./main.mjs";

test("manifest declares the Orca plugin entrypoints", () => {
  const manifestPath = fileURLToPath(new URL("./orca-plugin.json", import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.pluginApi, 1);
  assert.equal(manifest.main, "main.mjs");
  assert.equal(manifest.contributes.panels[0].entry, "panel.html");
  for (const file of ["main.mjs", "panel.html"]) {
    assert.ok(fs.existsSync(fileURLToPath(new URL(`./${file}`, import.meta.url))));
  }
});

test("worker starts and stops checks with a completion notification", async () => {
  const commands = new Map();
  const notifications = [];
  const stateDir = path.join(os.tmpdir(), `harnesspro-worker-${process.pid}`);
  fs.rmSync(stateDir, { recursive: true, force: true });
  process.env.HARNESSPRO_CHECK_STATE_DIR = stateDir;
  process.env.HARNESSPRO_CHECK_COMMAND = 'node -e "setTimeout(() => {}, 10000)"';
  activate({
    commands: { register: (id, handler) => commands.set(id, handler) },
    events: { on: () => {} },
    host: { call: async (method, params) => {
      if (method === "notifications.show") notifications.push(params);
      return { delivered: true };
    } },
    log: () => {},
  });
  const started = await commands.get("run-checks")();
  assert.equal(started.status, "running");
  const stopped = await commands.get("stop-checks")();
  assert.equal(stopped.status, "stopped");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(notifications.some((item) => item.body.includes("已停止")));
  delete process.env.HARNESSPRO_CHECK_COMMAND;
});
