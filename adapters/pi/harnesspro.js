import { getProfile, reminder, transformResult } from "../../core.mjs";

export default function (pi) {
  let profileName = process.env.HARNESSPRO_PROFILE || "off";
  let limits = profileName === "off" ? null : getProfile(profileName);
  const counts = new Map();
  const callCounts = new Map();

  function reset() {
    counts.clear();
    callCounts.clear();
  }

  function select(name) {
    limits = name === "off" ? null : getProfile(name);
    profileName = name;
    reset();
  }

  pi.registerCommand("harnesspro", {
    description: "Set HarnessPro budget: /harnesspro off|lite|medium|heavy",
    handler: async (args, ctx) => {
      const name = args.trim() || "medium";
      try {
        select(name);
        ctx.ui.notify(`HarnessPro profile: ${profileName}`, "info");
      } catch (error) {
        ctx.ui.notify(error.message, "error");
      }
    },
  });

  pi.on("session_start", reset);

  pi.on("tool_call", async (event) => {
    if (!limits) return undefined;
    const count = (counts.get("session") || 0) + 1;
    counts.set("session", count);
    callCounts.set(event.toolCallId, count);
    if (count > limits.max) {
      return {
        block: true,
        reason: `Tool budget exhausted (${limits.max} calls). Finish with existing evidence.`,
      };
    }
    return undefined;
  });

  pi.on("tool_result", async (event) => {
    if (!limits || event.isError) return undefined;
    const count = callCounts.get(event.toolCallId) || 0;
    const result = transformResult({ content: event.content }, reminder(count, limits));
    return {
      content: result.content,
      ...(event.structuredContent !== undefined ? { structuredContent: event.structuredContent } : {}),
    };
  });
}
