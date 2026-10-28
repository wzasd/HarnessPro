import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const coordinator = path.join(path.dirname(new URL(import.meta.url).pathname), "coordinator.mjs");
const logPath = path.join(os.homedir(), ".local", "state", "harnesspro", "checks.log");
let watcher = null;

function call(action) {
  const output = execFileSync(process.execPath, [coordinator, action], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  return JSON.parse(output);
}

function watch(orca) {
  if (watcher) return;
  watcher = setInterval(async () => {
    const state = call("status");
    if (!["succeeded", "failed", "stopped"].includes(state.status)) return;
    clearInterval(watcher);
    watcher = null;
    const body = state.status === "succeeded"
      ? `检查已通过。日志：${logPath}`
      : state.status === "failed"
        ? `检查失败。请查看日志：${logPath}`
        : "检查已停止。";
    await orca.host.call("notifications.show", { title: "HarnessPro 检查", body });
  }, 200);
}

export default function activate(orca) {
  orca.commands.register("run-checks", async () => {
    const state = call("start");
    watch(orca);
    return state;
  });
  orca.commands.register("stop-checks", async () => {
    const state = call("stop");
    watch(orca);
    return state;
  });
  orca.commands.register("status-checks", async () => call("status"));
}

export function deactivate() {
  if (watcher) clearInterval(watcher);
  watcher = null;
}
