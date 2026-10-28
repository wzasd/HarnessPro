import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelArgs } from "./router.mjs";
import { copyTaskTests, parseCodexUsage, selectCandidates } from "./evolution-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const sharedPolicy = process.env.HARNESSPRO_POLICY || path.join(os.homedir(), ".config", "harnesspro", "policy.json");
const stateRoot = process.env.HARNESSPRO_EVOLUTION_STATE_DIR || path.join(os.homedir(), ".local", "state", "harnesspro");
const latestPath = path.join(stateRoot, "evolution.json");
const orca = process.env.ORCA_CLI_COMMAND || "orca-ide";

function execute(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    ...options,
  });
}

function callJson(command, args, options) {
  const envelope = JSON.parse(execute(command, args, options));
  if (envelope.ok === false) throw new Error(envelope.error?.message || `${command} failed`);
  return envelope.result ?? envelope;
}

function orcaJson(args) {
  return callJson(orca, ["orchestration", ...args, "--json"]);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + `.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function update(value) {
  const previous = readLatest();
  writeJson(latestPath, { ...previous, ...value });
}

function readLatest() {
  try {
    return JSON.parse(fs.readFileSync(latestPath, "utf8"));
  } catch {
    return { status: "idle" };
  }
}

function alive(state) {
  if (state.status !== "running") return false;
  try {
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function start() {
  const current = readLatest();
  if (alive(current)) return current;
  const jobDir = path.join(stateRoot, "evolution", `${Date.now()}-${process.pid}`);
  fs.mkdirSync(jobDir, { recursive: true });
  const output = fs.openSync(path.join(stateRoot, "evolution.log"), "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run"], {
    detached: true,
    stdio: ["ignore", output, output],
    env: { ...process.env, HARNESSPRO_EVOLUTION_JOB_DIR: jobDir },
  });
  child.unref();
  fs.closeSync(output);
  const state = { status: "running", stage: "starting", pid: child.pid, jobDir, startedAt: new Date().toISOString() };
  writeJson(latestPath, state);
  return state;
}

function stop() {
  const current = readLatest();
  if (current.currentDispatchId) {
    try {
      orcaJson(["worker-stop", "--dispatch", current.currentDispatchId]);
    } catch {}
  }
  if (alive(current)) {
    try {
      process.kill(-current.pid, "SIGTERM");
    } catch {}
  }
  const state = { ...current, status: "stopped", finishedAt: new Date().toISOString() };
  writeJson(latestPath, state);
  return state;
}

function waitForWorker(runId, dispatchId) {
  const delivery = orcaJson([
    "check", "--run", runId, "--wait", "--types", "worker_done,escalation,question",
    "--timeout-ms", "900000",
  ]);
  if (delivery.timedOut || delivery.connectionLost) throw new Error("Worker wait timed out or disconnected");
  let outcome = null;
  for (const message of delivery.messages || []) {
    const payload = typeof message.payload === "string" ? JSON.parse(message.payload) : message.payload;
    if (message.type === "question") throw new Error(`Worker asked for manual input: ${payload?.question || message.subject}`);
    if (message.type !== "worker_done" || payload?._orcaLifecycleRejection) continue;
    if (payload?.taskId && payload.taskId !== readLatest().currentTaskId) continue;
    if (payload?.dispatchId && payload.dispatchId !== dispatchId) continue;
    outcome = payload?.outcome || "failed";
  }
  orcaJson(["worker-release", "--dispatch", dispatchId]);
  orcaJson(["check", "--run", runId, "--ack", delivery.deliveryId]);
  if (!outcome) throw new Error("Worker finished without a valid worker_done");
  if (outcome !== "succeeded") {
    const read = orcaJson(["worker-read", "--dispatch", dispatchId, "--limit", "20"]);
    const messages = read.transcript?.messages || [];
    const last = messages.at(-1);
    const detail = (last?.blocks || []).map((block) => block.text || block.output || "").filter(Boolean).join("\n").slice(-1000);
    throw new Error(`Worker reported ${outcome}${detail ? `: ${detail}` : ""}`);
  }
}

function runWorker(runId, role, spec) {
  const task = orcaJson(["task-create", "--spec", spec]);
  const taskId = task.task?.id || task.taskId || task.id;
  update({ currentTaskId: taskId, stage: role });
  const receipt = orcaJson([
    "worker-start", "--task", taskId, "--worktree", "current", "--agent", "codex",
    "--model", "gpt-6-luna", "--effort", "medium",
  ]);
  if (receipt.state !== "ready") throw new Error(`${role} failed to start: ${receipt.lastError?.message || receipt.stage}`);
  update({ currentDispatchId: receipt.dispatchId });
  waitForWorker(runId, receipt.dispatchId);
  update({ currentDispatchId: null });
}

function evaluate(profile, task, workdir, testsDir, policyPath) {
  const started = Date.now();
  copyTaskTests(testsDir, workdir, task);
  const trajectory = path.join(workdir, "trajectory.jsonl");
  let agentError = null;
  try {
    const args = [
      "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-hook-trust",
      "--sandbox", "workspace-write", "-C", workdir,
      ...buildModelArgs("codex", profile, policyPath),
      task.prompt,
    ];
    const output = execute("codex", args, {
      env: { ...process.env, HARNESSPRO_PROFILE: profile, HARNESSPRO_POLICY: policyPath },
    });
    fs.writeFileSync(trajectory, output);
  } catch (error) {
    agentError = error.message;
    fs.writeFileSync(trajectory, (error.stdout || "") + (error.stderr || ""));
  }
  let passed = false;
  try {
    execute("python3", ["-m", "unittest", "discover", "-s", "tests", "-v"], { cwd: workdir });
    passed = !agentError;
  } catch {}
  return {
    profile,
    passRate: passed ? 1 : 0,
    tokenCost: fs.existsSync(trajectory) ? parseCodexUsage(fs.readFileSync(trajectory, "utf8")) : 0,
    latencyMs: Date.now() - started,
    policyPath,
    trajectory,
    agentError,
  };
}

function validateCandidatePolicy(file) {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const profile of ["lite", "medium", "heavy"]) {
    const candidate = policy.profiles?.[profile];
    if (!candidate?.route?.codex || !candidate.route.opencode2 || !candidate.route.pi) {
      throw new Error(`Candidate policy is incomplete: ${file}`);
    }
    for (const key of ["economy", "converge", "max"]) {
      if (!Number.isInteger(candidate[key]) || candidate[key] <= 0) throw new Error(`Invalid ${key} in ${file}`);
    }
  }
}

async function runEvolution() {
  const jobDir = process.env.HARNESSPRO_EVOLUTION_JOB_DIR;
  const tasks = JSON.parse(fs.readFileSync(process.env.HARNESSPRO_EVOLUTION_TASKS || path.join(root, "evolution", "tasks.json"), "utf8"));
  const testsDir = path.join(jobDir, "tests");
  const run = orcaJson(["run-create", "--objective", "HarnessPro evolution with fixed tests"]);
  const runId = run.run?.id || run.runId || run.id;

  runWorker(runId, "test-synthesizer", [
    `Create unittest files ${path.join(testsDir, "test_add.py")} and ${path.join(testsDir, "test_subtract.py")}.`,
    `For ${tasks.training.prompt}, write 3 independent tests for add(a, b).`,
    `For ${tasks.validation.prompt}, write 3 independent tests for subtract(a, b).`,
    "Use only the task descriptions as requirements. Do not run the tests before an implementation exists; keep the tests fixed for later candidate evaluation.",
    "Do not create add.py, subtract.py, or any implementation files outside the tests directory.",
  ].join(" "));

  update({ stage: "baseline" });
  const baseline = evaluate("medium", tasks.training, path.join(jobDir, "baseline"), testsDir, sharedPolicy);
  writeJson(path.join(jobDir, "baseline.json"), baseline);

  runWorker(runId, "trajectory-analyzer", [
    `Read ${path.join(jobDir, "baseline.json")} and ${baseline.trajectory}.`,
    `Write ${path.join(jobDir, "diagnosis.json")} with failure patterns, avoidable token use, evidence paths, and suggested harness changes.`,
    "Do not edit the shared policy or invent evidence.",
  ].join(" "));

  runWorker(runId, "evolution-planner", [
    `Read ${path.join(jobDir, "diagnosis.json")} and ${sharedPolicy}.`,
    `Write ${path.join(jobDir, "plan.json")} with cost-focused, balanced, and performance-focused changes.`,
    "Keep model mappings valid and make only generalizable harness changes.",
  ].join(" "));

  runWorker(runId, "harness-editor", [
    `Read ${path.join(jobDir, "plan.json")} and ${sharedPolicy}.`,
    `Create ${path.join(jobDir, "candidates", "lite", "policy.json")}, ${path.join(jobDir, "candidates", "medium", "policy.json")}, and ${path.join(jobDir, "candidates", "heavy", "policy.json")}.`,
    "Each file must be a complete policy with lite, medium, and heavy profiles, valid budgets, and codex/opencode2/pi routes.",
    "Do not modify the shared policy.",
  ].join(" "));

  const results = [];
  for (const profile of ["lite", "medium", "heavy"]) {
    update({ stage: `evaluate-${profile}` });
    const policyPath = path.join(jobDir, "candidates", profile, "policy.json");
    validateCandidatePolicy(policyPath);
    results.push(evaluate(profile, tasks.validation, path.join(jobDir, "evaluation", profile), testsDir, policyPath));
  }
  const selection = selectCandidates(results, baseline);
  const report = { baseline, results, ...selection, tokenCostNote: "Token counts include input and output tokens; no dollar estimate is made." };
  const reportPath = path.join(jobDir, "report.json");
  writeJson(reportPath, report);
  update({ status: "awaiting-approval", stage: "complete", reportPath, currentTaskId: null, currentDispatchId: null, finishedAt: new Date().toISOString() });
}

function apply(profile = "medium") {
  const current = readLatest();
  if (current.status !== "awaiting-approval") throw new Error("No completed evolution report is ready to apply");
  const report = JSON.parse(fs.readFileSync(current.reportPath, "utf8"));
  const selected = report.selected[profile];
  if (!selected) throw new Error(`Unknown profile: ${profile}`);
  const backup = sharedPolicy + ".backup-before-evolution";
  if (!fs.existsSync(backup)) fs.copyFileSync(sharedPolicy, backup);
  fs.copyFileSync(selected.policyPath, sharedPolicy);
  const state = { ...current, status: "applied", appliedProfile: profile, appliedAt: new Date().toISOString() };
  writeJson(latestPath, state);
  return state;
}

async function runGuarded() {
  try {
    await runEvolution();
  } catch (error) {
    update({ status: "failed", stage: "failed", error: error.stack || error.message, finishedAt: new Date().toISOString() });
  }
}

const actions = { start, stop, apply, run: runGuarded };
const action = actions[process.argv[2]];
if (process.argv[2] === "status") {
  process.stdout.write(JSON.stringify(readLatest()));
} else if (!action) {
  throw new Error("Usage: evolution.mjs <start|status|stop|apply|run> [profile]");
} else {
  const result = await action(process.argv[3]);
  if (result) process.stdout.write(JSON.stringify(result));
}
