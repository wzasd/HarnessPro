import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getProfile(name, policyPath = process.env.HARNESSPRO_POLICY || path.join(os.homedir(), ".config", "harnesspro", "policy.json")) {
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  const profile = policy.profiles[name];
  if (!profile) throw new Error(`Unknown HarnessPro profile: ${name}`);
  return profile;
}

export function foldRepeatedLines(text) {
  const lines = text.split("\n");
  const output = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    let end = i + 1;
    while (end < lines.length && lines[end] === line) end++;
    output.push(line);
    if (end - i > 3) output.push(`[previous line repeated ${end - i - 1} more times]`);
    else for (let j = i + 1; j < end; j++) output.push(lines[j]);
    i = end;
  }
  return output.join("\n");
}

export function reminder(count, limits) {
  if (count === limits.economy) {
    return `Economy phase: ${count} tool calls used. Combine checks and avoid repeated exploration.`;
  }
  if (count === limits.converge) {
    return `Convergence phase: ${count} tool calls used. Stop broad exploration and verify the current result.`;
  }
  if (count === limits.max) {
    return `Tool budget reached: ${count} calls. Preserve the current files and finish with existing evidence.`;
  }
  return "";
}

export function annotate(text, note) {
  return foldRepeatedLines(text) + (note ? `\n\n[harness-budget] ${note}` : "");
}

export function transformResult(result, note) {
  const next = { ...result };
  if (typeof result.output === "string") next.output = annotate(result.output, note);
  if (typeof result.content === "string") next.content = annotate(result.content, note);
  if (Array.isArray(result.content)) {
    const lastText = result.content.findLastIndex((part) => part.type === "text");
    next.content = result.content.map((part, index) =>
      part.type === "text"
        ? { ...part, text: annotate(part.text, index === lastText ? note : "") }
        : part,
    );
  }
  return next;
}
