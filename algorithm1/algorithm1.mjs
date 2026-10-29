import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectCoreset } from "./dpp.mjs";
import { parseCodexUsage, selectCandidates } from "../evolution-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRepo = process.env.HARNESSPRO_PROJECT_REPO || "/home/zhaowang/Documents/01project/robotaxi_srv";
const harnessRepo = root;
const stateRoot = process.env.HARNESSPRO_ALGORITHM1_STATE_DIR || path.join(os.homedir(), ".local", "state", "harnesspro", "algorithm1");
const orca = process.env.ORCA_CLI_COMMAND || "orca-ide";
const initialPolicy = path.join(root, "policy.json");
const model = "gpt-6-luna";
const agent = process.env.HARNESSPRO_AGENT || "opencode2";

function execute(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: 100 * 1024 * 1024, ...options });
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function jobDir() {
  const value = process.env.HARNESSPRO_ALGORITHM1_JOB_DIR || path.join(stateRoot, "current");
  fs.mkdirSync(value, { recursive: true });
  return value;
}

function stage(name, extra = {}) {
  writeJson(path.join(jobDir(), "state.json"), { stage: name, updatedAt: new Date().toISOString(), ...extra });
}

function worktree(repo, directory, commit) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    execute("git", ["-C", repo, "worktree", "add", "--detach", directory, commit]);
  } else {
    execute("git", ["-C", directory, "reset", "--hard", commit]);
    execute("git", ["-C", directory, "clean", "-fd"]);
  }
  return directory;
}

function waitForWorker(runId, taskId, dispatchId) {
  const delivery = orcaJson(["check", "--run", runId, "--wait", "--types", "worker_done,escalation,question", "--timeout-ms", "900000"]);
  if (delivery.timedOut || delivery.connectionLost) throw new Error("Worker wait timed out or disconnected");
  let outcome = null;
  for (const message of delivery.messages || []) {
    const payload = typeof message.payload === "string" ? JSON.parse(message.payload) : message.payload;
    if (message.type === "question") throw new Error(`Worker asked for manual input: ${payload?.question || message.subject}`);
    if (message.type !== "worker_done" || payload?._orcaLifecycleRejection) continue;
    if (payload?.taskId && payload.taskId !== taskId) continue;
    if (payload?.dispatchId && payload.dispatchId !== dispatchId) continue;
    outcome = payload?.outcome || "failed";
  }
  orcaJson(["worker-release", "--dispatch", dispatchId]);
  orcaJson(["check", "--run", runId, "--ack", delivery.deliveryId]);
  if (!outcome) throw new Error("Worker finished without valid worker_done");
  if (outcome !== "succeeded") {
    const read = orcaJson(["worker-read", "--dispatch", dispatchId, "--limit", "20"]);
    const last = (read.transcript?.messages || []).at(-1);
    const detail = (last?.blocks || []).map((block) => block.text || block.output || "").filter(Boolean).join("\n").slice(-1000);
    throw new Error(`Worker reported ${outcome}${detail ? `: ${detail}` : ""}`);
  }
}

function runDppJudge(file, task, trajectory) {
  execute(agent, [
    "--standalone", "run", "--model", "omniroute/ponyai/gpt-6-luna#low", "--format", "json", "--auto",
    `Read ${trajectory} and only this task description: ${task.prompt}. Do not inspect the repository or ask questions. Write ${file} as {"difficulty": number 0..10, "embedding": number[8]}. Use an abstract failure fingerprint without task-specific names.`,
  ], { cwd: root });
}

function runWorker(runId, role, spec) {
  const task = orcaJson(["task-create", "--spec", spec]);
  const taskId = task.task?.id || task.taskId || task.id;
  const workerArgs = ["worker-start", "--task", taskId, "--worktree", "current", "--agent", agent];
  if (agent === "codex") workerArgs.push("--model", model, "--effort", "high");
  const receipt = orcaJson(workerArgs);
  if (receipt.state !== "ready") throw new Error(`${role} failed to start: ${receipt.lastError?.message || receipt.stage}`);
  waitForWorker(runId, taskId, receipt.dispatchId);
}

function evaluateGeneratedTests(workspace, task, testsDir) {
  if (!fs.existsSync(path.join(testsDir, `test_${task.id}.py`))) return false;
  const target = path.join(workspace, "tests_harnesspro");
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const testFile = path.join(testsDir, `test_${task.id}.py`);
  fs.copyFileSync(testFile, path.join(target, `test_${task.id}.py`));
  try {
    execute("python3", ["-m", "unittest", "discover", "-s", "tests_harnesspro", "-v"], { cwd: workspace });
    return true;
  } catch {
    return false;
  }
}

function evaluateOfficialTest(workspace, task) {
  try {
    execute(task.officialTest, {
      cwd: path.join(workspace, task.cwd),
      shell: true,
      env: { ...process.env, GOCACHE: "/tmp/harnesspro-go-cache", GOMODCACHE: "/tmp/harnesspro-go-mod-cache" },
    });
    return true;
  } catch {
    return false;
  }
}

function rollout(task, policyPath, testsDir, rolloutDir, official = false, profile = "medium") {
  worktree(projectRepo, rolloutDir, task.parent);
  const environment = {
    ...process.env,
    GOCACHE: "/tmp/harnesspro-go-cache",
    GOMODCACHE: "/tmp/harnesspro-go-mod-cache",
    PATH: `${os.homedir()}/.local/protoc/bin:${process.env.PATH}`,
  };
  if (task.cwd === "common_go") execute("make", ["gen_proto"], { cwd: path.join(rolloutDir, "common_go"), env: environment });
  const started = Date.now();
  const trajectory = path.join(rolloutDir, "trajectory.jsonl");
  let agentError = null;
  try {
    const effort = policyPath ? readJson(policyPath).profiles[profile]?.route?.opencode2?.effort || "high" : "high";
    const args = agent === "opencode2"
      ? ["--standalone", "run", "--model", `omniroute/ponyai/gpt-6-luna#${effort}`, "--format", "json", "--auto", `${task.prompt} 不要修改 tests_harnesspro 中的固定测试。`]
      : ["exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-hook-trust", "--sandbox", "workspace-write", "-C", rolloutDir, "-m", model, "-c", `model_reasoning_effort=${effort}`, `${task.prompt} 不要修改 tests_harnesspro 中的固定测试。`];
    const output = execute(agent, args, { env: environment, cwd: rolloutDir });
    fs.writeFileSync(trajectory, output);
  } catch (error) {
    agentError = error.message;
    fs.writeFileSync(trajectory, (error.stdout || "") + (error.stderr || ""));
  }
  const passed = official ? evaluateOfficialTest(rolloutDir, task) : evaluateGeneratedTests(rolloutDir, task, testsDir);
  const usageText = fs.existsSync(trajectory) ? fs.readFileSync(trajectory, "utf8") : "";
  const usage = usageText.split(/\r?\n/).reduce((result, line) => {
    try {
      const event = JSON.parse(line);
      if (event.type === "turn.completed") {
        result.uncached += event.usage?.input_tokens || 0;
        result.cached += event.usage?.cached_input_tokens || 0;
        result.output += event.usage?.output_tokens || 0;
      } else if (event.type === "step_finish" && event.part?.type === "step-finish") {
        const tokens = event.part.tokens || {};
        result.uncached += Math.max(0, (tokens.input || 0) - (tokens.cache?.read || 0));
        result.cached += tokens.cache?.read || 0;
        result.output += (tokens.output || 0) + (tokens.reasoning || 0);
      }
    } catch {}
    return result;
  }, { uncached: 0, cached: 0, output: 0 });
  const tokenCost = usage.uncached + usage.cached + usage.output;
  return {
    taskId: task.id,
    passRate: passed && !agentError ? 1 : 0,
    tokenCost,
    latencyMs: Date.now() - started,
    usage,
    trajectory,
    agentError,
    policyPath,
    rolloutDir,
  };
}

function averageMetrics(results) {
  return {
    passRate: results.reduce((sum, item) => sum + item.passRate, 0) / results.length,
    tokenCost: results.reduce((sum, item) => sum + item.tokenCost, 0) / results.length,
    latencyMs: results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length,
  };
}

function validateTests(file) {
  const text = fs.readFileSync(file, "utf8");
  const count = (text.match(/def test_case_\d{4}\(/g) || []).length;
  if (count !== 10) throw new Error(`Expected 10 generated tests in ${file}, found ${count}`);
}

function validatePolicy(file) {
  const policy = readJson(file);
  for (const profile of ["lite", "medium", "heavy"]) {
    const value = policy.profiles?.[profile];
    for (const key of ["economy", "converge", "max"]) {
      if (!Number.isInteger(value?.[key]) || value[key] <= 0) throw new Error(`Invalid ${key} in ${file}`);
    }
  }
}

async function runAlgorithm() {
  const dir = jobDir();
  const tasks = readJson(path.join(root, "algorithm1", "tasks.json"));
  const initialDir = path.join(dir, "initial");
  const testsDir = path.join(dir, "tests");
  const run = orcaJson(["run-create", "--objective", "HarnessPro Algorithm 1 on robotaxi_srv"]);
  const runId = run.run?.id || run.runId || run.id;

  stage("initial-rollouts");
  const initialTrajectories = tasks.map((task) => {
    const file = path.join(initialDir, `${task.id}.json`);
    if (fs.existsSync(file)) return readJson(file);
    const result = rollout(task, initialPolicy, testsDir, path.join(initialDir, task.id));
    writeJson(file, result);
    return result;
  });

  stage("dpp-judges");
  const judged = tasks.map((task, index) => {
    const file = path.join(initialDir, `${task.id}-judge.json`);
    if (!fs.existsSync(file)) {
      runDppJudge(file, task, initialTrajectories[index].trajectory);
    }
    const judge = readJson(file);
    if (!Number.isFinite(judge.difficulty) || !Array.isArray(judge.embedding) || judge.embedding.length !== 8) {
      throw new Error(`Invalid DPP judge output: ${file}`);
    }
    return { ...task, difficulty: judge.difficulty, embedding: judge.embedding };
  });
  const training = selectCoreset(judged, 10);
  const remaining = judged.filter((task) => !training.some((selected) => selected.id === task.id));
  const validation = remaining.slice(0, 1);
  const heldout = remaining.slice(1, 2);
  writeJson(path.join(dir, "coreset.json"), { training: training.map((task) => task.id), validation: validation.map((task) => task.id), heldout: heldout.map((task) => task.id) });

  stage("test-synthesis");
  for (const task of [...training, ...validation]) {
    const file = path.join(testsDir, `test_${task.id}.py`);
    if (!fs.existsSync(file)) {
      const initial = initialTrajectories.find((item) => item.taskId === task.id);
      runWorker(runId, "test-synthesizer", [
        `Read ${initial.trajectory} and the task: ${task.prompt}`,
        `Write ${file} with exactly test_case_0001 through test_case_0010 as unittest.TestCase methods.`,
        "Generate tests from the description and trajectory only. Do not use official tests or the reference patch. Do not run tests before an implementation exists.",
      ].join(" "));
    }
    validateTests(file);
  }

  stage("baseline-validation");
  const baselineFile = path.join(dir, "baseline.json");
  if (!fs.existsSync(baselineFile)) {
    const baseline = averageMetrics(validation.map((task) => rollout(task, initialPolicy, testsDir, path.join(dir, "baseline", task.id))));
    writeJson(baselineFile, baseline);
  }
  const baseline = readJson(baselineFile);
  let candidates = [{ policyPath: initialPolicy, parent: null, profile: "medium" }];
  let history = [];

  for (let epoch = 0; epoch < 3; epoch++) {
    stage(`epoch-${epoch + 1}-rollouts`, { epoch: epoch + 1 });
    const epochDir = path.join(dir, `epoch-${epoch + 1}`);
    for (const candidate of candidates) {
      for (const task of training) {
        const results = [];
        for (let rolloutIndex = 0; rolloutIndex < 3; rolloutIndex++) {
          const file = path.join(epochDir, "rollouts", `${path.basename(path.dirname(candidate.policyPath))}-${task.id}-${rolloutIndex}.json`);
          if (fs.existsSync(file)) results.push(readJson(file));
          else {
            const result = rollout(task, candidate.policyPath, testsDir, path.join(epochDir, "rollouts", `${path.basename(path.dirname(candidate.policyPath))}-${task.id}-${rolloutIndex}`), false, candidate.profile);
            writeJson(file, result);
            results.push(result);
          }
        }
        const diagnosisFile = path.join(epochDir, "diagnoses", `${path.basename(path.dirname(candidate.policyPath))}-${task.id}.json`);
        if (!fs.existsSync(diagnosisFile)) {
          runWorker(runId, "trajectory-analyzer", [
            `Read these 3 rollout records: ${results.map((item) => item.trajectory).join(", ")}.`,
            `Write ${diagnosisFile} with identified problems, performance and cost impact, sources, and evidence paths.`,
            "Compare all 3 trajectories rather than relying on one attempt.",
          ].join(" "));
        }
      }
    }

    stage(`epoch-${epoch + 1}-plan-edit`, { epoch: epoch + 1 });
    const produced = [];
    for (const candidate of candidates) {
      const plansFile = path.join(epochDir, "plans", `${path.basename(path.dirname(candidate.policyPath))}.json`);
      if (!fs.existsSync(plansFile)) {
        const diffs = candidates.filter((other) => other !== candidate).map((other) => {
          try {
            return execute("git", ["diff", "--no-index", candidate.policyPath, other.policyPath]);
          } catch (error) {
            return error.stdout || "";
          }
        }).join("\n");
        runWorker(runId, "evolution-planner", [
          `Read ${candidate.policyPath}, ${path.join(epochDir, "diagnoses")}, and these candidate diffs: ${diffs}`,
          `Write ${plansFile} with cost-focused, balanced, and performance-focused plans.`,
          "Propose generalizable harness changes only. Keep validation and heldout tasks hidden.",
        ].join(" "));
      }
      const plans = readJson(plansFile);
      for (const [index, mode] of ["lite", "medium", "heavy"].entries()) {
        const candidateDir = path.join(epochDir, "candidates", `${path.basename(path.dirname(candidate.policyPath))}-${mode}`);
        const policyPath = path.join(candidateDir, "policy.json");
        if (!fs.existsSync(policyPath)) {
          worktree(harnessRepo, candidateDir, "HEAD");
          runWorker(runId, "harness-editor", [
            `Read ${candidate.policyPath}, ${plansFile}, and ${path.join(epochDir, "diagnoses")}.`,
            `Implement the ${mode} plan in ${candidateDir}. Only modify harness files, not project task files.`,
            `Write a complete valid policy.json with lite, medium, and heavy profiles and commit it with git -C ${candidateDir} commit -am 'HarnessPro ${mode} candidate'.`,
          ].join(" "));
        }
        validatePolicy(policyPath);
        produced.push({ policyPath, parent: candidate.policyPath, mode, profile: mode });
      }
    }

    stage(`epoch-${epoch + 1}-select`, { epoch: epoch + 1 });
    const all = [...candidates, ...produced];
    const evaluated = all.map((candidate) => {
      const metrics = averageMetrics(validation.map((task) => rollout(task, candidate.policyPath, testsDir, path.join(epochDir, "validation", `${path.basename(path.dirname(candidate.policyPath))}-${task.id}`))));
      return { ...candidate, ...metrics };
    });
    const selection = selectCandidates(evaluated, baseline);
    history.push({ epoch: epoch + 1, evaluated, selection });
    writeJson(path.join(epochDir, "selection.json"), selection);
    candidates = ["lite", "medium", "heavy"].map((mode) => selection.selected[mode]).filter((candidate, index, array) => array.findIndex((other) => other.policyPath === candidate.policyPath) === index);
  }

  stage("final-official-test");
  const finalResults = candidates.map((candidate) => {
    const metrics = averageMetrics(heldout.map((task) => rollout(task, candidate.policyPath, testsDir, path.join(dir, "final", `${path.basename(path.dirname(candidate.policyPath))}-${task.id}`), true)));
    return { ...candidate, ...metrics };
  });
  const report = { baseline, history, finalResults, coreset: readJson(path.join(dir, "coreset.json")) };
  writeJson(path.join(dir, "report.json"), report);
  stage("awaiting-approval", { reportPath: path.join(dir, "report.json") });
}

async function runGuarded() {
  try {
    await runAlgorithm();
  } catch (error) {
    stage("failed", { error: error.stack || error.message, finishedAt: new Date().toISOString() });
  }
}

const actions = {
  start: async () => {
    const current = path.join(stateRoot, "current");
    const state = fs.existsSync(path.join(current, "state.json")) ? readJson(path.join(current, "state.json")) : {};
    if (state.pid) {
      try {
        process.kill(state.pid, 0);
        return state;
      } catch {}
    }
    fs.mkdirSync(current, { recursive: true });
    const output = fs.openSync(path.join(stateRoot, "algorithm1.log"), "a");
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run"], {
      detached: true,
      stdio: ["ignore", output, output],
      env: { ...process.env, HARNESSPRO_ALGORITHM1_JOB_DIR: current },
    });
    child.unref();
    fs.closeSync(output);
    const next = { stage: "running", status: "running", pid: child.pid, startedAt: new Date().toISOString() };
    writeJson(path.join(current, "state.json"), next);
    return next;
  },
  status: () => {
    const state = fs.existsSync(path.join(stateRoot, "current", "state.json")) ? readJson(path.join(stateRoot, "current", "state.json")) : { stage: "idle" };
    return { ...state, status: state.stage };
  },
  stop: () => {
    const state = actions.status();
    if (state.pid) {
      try { process.kill(-state.pid, "SIGTERM"); } catch {}
    }
    const next = { ...state, stage: "stopped", status: "stopped", finishedAt: new Date().toISOString() };
    writeJson(path.join(stateRoot, "current", "state.json"), next);
    return next;
  },
  run: runGuarded,
  apply: (profile = "medium") => {
    const state = actions.status();
    if (state.stage !== "awaiting-approval") throw new Error("No completed Algorithm 1 report is ready to apply");
    const report = readJson(state.reportPath);
    const selected = report.finalResults.find((candidate) => candidate.profile === profile) || report.finalResults[0];
    if (!selected) throw new Error("No selected harness is available");
    const backup = initialPolicy + ".backup-before-algorithm1";
    if (!fs.existsSync(backup)) fs.copyFileSync(initialPolicy, backup);
    fs.copyFileSync(selected.policyPath, initialPolicy);
    const next = { ...state, stage: "applied", appliedProfile: selected.profile, appliedAt: new Date().toISOString() };
    writeJson(path.join(stateRoot, "current", "state.json"), next);
    return next;
  },
};

const action = actions[process.argv[2]];
if (!action) throw new Error("Usage: algorithm1.mjs <start|status|stop|run>");
const result = await action();
if (result) process.stdout.write(JSON.stringify(result));
