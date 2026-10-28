import { Plugin } from "@opencode/plugin";
import { Error as ToolError } from "@opencode/plugin/promise/tool";
import { getProfile, reminder, transformResult } from "../../core.mjs";

export { foldRepeatedLines, reminder, transformResult } from "../../core.mjs";

function legacyLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function selectedProfile() {
  if (process.env.HARNESSPRO_PROFILE) {
    return process.env.HARNESSPRO_PROFILE === "off" ? null : getProfile(process.env.HARNESSPRO_PROFILE);
  }
  if (process.env.OPENCODE_HARNESS_BUDGET !== "1") return null;
  return {
    economy: legacyLimit("OPENCODE_HARNESS_ECONOMY", 14),
    converge: legacyLimit("OPENCODE_HARNESS_CONVERGE", 26),
    max: legacyLimit("OPENCODE_HARNESS_MAX", 44),
  };
}

export default Plugin.define({
  id: "harness-budget",
  async setup(ctx) {
    const limits = selectedProfile();
    if (!limits) return;

    const counts = new Map();
    const callCounts = new Map();
    const key = (event) => event.sessionID || "default";

    await ctx.tool.hook("execute.before", (event) => {
      const count = (counts.get(key(event)) || 0) + 1;
      counts.set(key(event), count);
      callCounts.set(event.id, count);
      if (count > limits.max) {
        throw new ToolError({
          message: `Tool budget exhausted (${limits.max} calls). Finish with existing evidence.`,
        });
      }
    });

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed") return;
      const count = callCounts.get(event.id) || counts.get(key(event)) || 0;
      event.result = transformResult(event.result, reminder(count, limits));
    });
  },
});
