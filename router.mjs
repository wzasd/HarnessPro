import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultPolicy = path.join(os.homedir(), ".config", "harnesspro", "policy.json");

export function classifyTask(text) {
  const task = text.toLowerCase();
  // ponytail: keyword routing is a fallback; replace with a measured classifier when misroutes accumulate
  if (/race|concurrency|distributed|production|deadlock|security|migration|data loss|performance|并发|死锁|生产|安全|迁移|数据丢失|性能/.test(task)) return "heavy";
  if (/typo|readme|comment|rename|format|small|minor|文案|注释|重命名|格式|小修改/.test(task)) return "lite";
  return "medium";
}

export function routeFor(agent, profile, policyPath = process.env.HARNESSPRO_POLICY || defaultPolicy) {
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  const key = agent === "opencode" ? "opencode2" : agent;
  const route = policy.profiles[profile]?.route?.[key];
  if (!route) throw new Error(`No HarnessPro route for ${agent} in ${profile}`);
  return { profile, model: route.model, effort: route.effort };
}

export function buildModelArgs(agent, profile, policyPath) {
  const route = routeFor(agent, profile, policyPath);
  if (agent === "opencode" || agent === "opencode2") return ["--model", route.model];
  if (agent === "codex") return ["-m", route.model, "-c", `model_reasoning_effort=${route.effort}`];
  if (agent === "pi") return ["--model", route.model, "--thinking", route.effort];
  throw new Error(`Unsupported HarnessPro agent: ${agent}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [agent, task = ""] = process.argv.slice(2);
  const route = routeFor(agent, classifyTask(task));
  process.stdout.write(`${route.profile}\n${route.model}\n${route.effort}\n`);
}
