import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const coordinator = path.join(path.dirname(new URL(import.meta.url).pathname), "coordinator.mjs");
const evolution = path.join(path.dirname(new URL(import.meta.url).pathname), "evolution.mjs");
const logPath = path.join(os.homedir(), ".local", "state", "harnesspro", "checks.log");
let watcher = null;
let evolutionWatcher = null;

function call(action) {
  const output = execFileSync(process.execPath, [coordinator, action], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  return JSON.parse(output);
}

function callEvolution(action, profile) {
  const args = [evolution, action];
  if (profile) args.push(profile);
  const output = execFileSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  return JSON.parse(output);
}

function watchEvolution(orca) {
  if (evolutionWatcher) return;
  evolutionWatcher = setInterval(async () => {
    const state = callEvolution("status");
    if (!["awaiting-approval", "applied", "failed", "stopped"].includes(state.status)) return;
    clearInterval(evolutionWatcher);
    evolutionWatcher = null;
    const body = state.status === "awaiting-approval"
      ? "候选已生成。请审核报告后选择是否采用。"
      : state.status === "applied"
        ? "候选策略已采用。"
        : state.status === "failed"
          ? "进化失败。请查看 evolution.log。"
          : "进化已停止。";
    await orca.host.call("notifications.show", { title: "HarnessPro 进化", body });
  }, 2000);
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
  orca.commands.register("start-evolution", async () => {
    const state = callEvolution("start");
    watchEvolution(orca);
    return state;
  });
  orca.commands.register("stop-evolution", async () => {
    const state = callEvolution("stop");
    watchEvolution(orca);
    return state;
  });
  orca.commands.register("status-evolution", async () => callEvolution("status"));
  orca.commands.register("apply-evolution", async () => {
    const state = callEvolution("apply", "medium");
    await orca.host.call("notifications.show", { title: "HarnessPro 进化", body: "已采用 Medium 候选策略。" });
    return state;
  });
}

export function deactivate() {
  if (watcher) clearInterval(watcher);
  if (evolutionWatcher) clearInterval(evolutionWatcher);
  watcher = null;
  evolutionWatcher = null;
}
