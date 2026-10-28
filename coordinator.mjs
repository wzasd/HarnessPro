import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);
const stateDir = process.env.HARNESSPRO_CHECK_STATE_DIR || path.join(os.homedir(), ".local", "state", "harnesspro");
const statePath = path.join(stateDir, "checks.json");
const logPath = path.join(stateDir, "checks.log");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { status: "idle" };
  }
}

function writeState(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const temporary = statePath + `.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, statePath);
}

function running(state) {
  if (state.status !== "running") return false;
  try {
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function start() {
  const current = readState();
  if (running(current)) return current;
  fs.mkdirSync(stateDir, { recursive: true });
  const output = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [self, "run"], {
    detached: true,
    stdio: ["ignore", output, output],
    env: process.env,
  });
  child.unref();
  fs.closeSync(output);
  const state = { status: "running", pid: child.pid, startedAt: new Date().toISOString() };
  writeState(state);
  return state;
}

function status() {
  return readState();
}

function stop() {
  const current = readState();
  if (!running(current)) return current;
  try {
    process.kill(-current.pid, "SIGTERM");
  } catch {}
  const state = { ...current, status: "stopped", finishedAt: new Date().toISOString() };
  writeState(state);
  return state;
}

async function run() {
  const home = os.homedir();
  const command = process.env.HARNESSPRO_CHECK_COMMAND || [
    `node --test "${home}/.config/harnesspro/core.test.mjs" "${home}/.config/harnesspro/router.test.mjs" "${home}/.config/harnesspro/evolution-core.test.mjs" "${home}/.config/opencode/plugins/harness-budget/test.js" "${home}/.config/harnesspro/pi-extension.test.mjs" "${home}/.config/harnesspro/launcher.test.mjs" "${home}/.config/harnesspro/orca-plugin.test.mjs" "${home}/.config/harnesspro/scripts/register.test.mjs`,
    `python3 -m unittest discover -s "${home}/.config/harnesspro" -p 'test_codex_hook.py' -v`,
  ].join(" && ");
  const child = spawn(command, { shell: true, stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    const current = readState();
    writeState({
      ...current,
      status: code === 0 ? "succeeded" : "failed",
      exitCode: code,
      signal,
      finishedAt: new Date().toISOString(),
    });
  });
}

const actions = { start, status, stop, run };
const action = actions[process.argv[2]];
if (!action) throw new Error("Usage: coordinator.mjs <start|status|stop|run>");
const result = await action();
if (result) process.stdout.write(JSON.stringify(result));
