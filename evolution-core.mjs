import fs from "node:fs";
import path from "node:path";

export function copyTaskTests(testsDir, workdir, task) {
  fs.mkdirSync(path.join(workdir, "tests"), { recursive: true });
  fs.copyFileSync(path.join(testsDir, `test_${task.id}.py`), path.join(workdir, "tests", `test_${task.id}.py`));
}

export function parseCodexUsage(jsonl) {
  return jsonl.split(/\r?\n/).reduce((total, line) => {
    if (!line.trim()) return total;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return total;
    }
    if (event.type !== "turn.completed") return total;
    return total + (event.usage?.input_tokens || 0) + (event.usage?.output_tokens || 0);
  }, 0);
}

export function selectCandidates(candidates, baseline) {
  const eligible = candidates.filter((candidate) => candidate.passRate >= baseline.passRate);
  const frontier = eligible.filter((candidate) => !eligible.some((other) =>
    other !== candidate &&
    other.passRate >= candidate.passRate &&
    other.tokenCost <= candidate.tokenCost &&
    (other.passRate > candidate.passRate || other.tokenCost < candidate.tokenCost),
  ));
  if (!frontier.length) throw new Error("No candidate meets the baseline pass rate");

  const passRates = frontier.map((item) => item.passRate);
  const costs = frontier.map((item) => item.tokenCost);
  const minPass = Math.min(...passRates);
  const maxPass = Math.max(...passRates);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const normalize = (value, min, max) => max === min ? 0 : (value - min) / (max - min);
  const weights = {
    lite: [1, 2],
    medium: [1, 1],
    heavy: [2, 1],
  };
  const selected = {};
  for (const [profile, [performanceWeight, costWeight]] of Object.entries(weights)) {
    selected[profile] = frontier.reduce((best, candidate) => {
      const performanceDistance = normalize(maxPass - candidate.passRate, 0, maxPass - minPass);
      const costDistance = normalize(candidate.tokenCost - minCost, 0, maxCost - minCost);
      const score = performanceWeight * performanceDistance ** 2 + costWeight * costDistance ** 2;
      return !best || score < best.score ? { ...candidate, score } : best;
    }, null);
  }
  return { frontier, selected };
}
