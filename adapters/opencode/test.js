import assert from "node:assert/strict";
import test from "node:test";
import plugin, { foldRepeatedLines, reminder } from "./index.js";

const limits = { economy: 2, converge: 3, max: 4 };

test("folds only runs longer than three lines", () => {
  assert.equal(foldRepeatedLines("a\na\na\nb"), "a\na\na\nb");
  assert.equal(foldRepeatedLines("a\na\na\na\na\nb"), "a\n[previous line repeated 4 more times]\nb");
});

test("emits reminders at each threshold", () => {
  assert.match(reminder(2, limits), /Economy phase/);
  assert.match(reminder(3, limits), /Convergence phase/);
  assert.match(reminder(4, limits), /Tool budget reached/);
  assert.equal(reminder(1, limits), "");
});

test("counts per session and blocks calls beyond the budget", async () => {
  const hooks = new Map();
  const ctx = { tool: { hook: async (name, callback) => hooks.set(name, callback) } };
  const old = { ...process.env };
  Object.assign(process.env, {
    OPENCODE_HARNESS_BUDGET: "1",
    OPENCODE_HARNESS_ECONOMY: "2",
    OPENCODE_HARNESS_CONVERGE: "3",
    OPENCODE_HARNESS_MAX: "4",
  });
  try {
    await plugin.setup(ctx);
    const before = hooks.get("execute.before");
    const after = hooks.get("execute.after");
    const completed = [];
    for (let count = 1; count <= 4; count++) {
      await before({ sessionID: "one", tool: "shell", id: `call-${count}` });
      completed.push({
        sessionID: "one",
        id: `call-${count}`,
        status: "completed",
        result: { content: [{ type: "text", text: "x\nx\nx\nx\n" }] },
      });
    }
    for (let count = 4; count >= 1; count--) {
      const event = completed[count - 1];
      await after(event);
      assert.match(event.result.content[0].text, /previous line repeated 3 more times/);
      assert.equal(
        event.result.content.some((part) => part.text.includes("[harness-budget]")),
        count >= 2,
      );
    }
    assert.throws(() => before({ sessionID: "one", tool: "shell" }), /Tool budget exhausted/);
    await before({ sessionID: "two", tool: "shell" });
  } finally {
    process.env = old;
  }
});

test("loads the shared lite profile", async () => {
  const hooks = new Map();
  const ctx = { tool: { hook: async (name, callback) => hooks.set(name, callback) } };
  const old = process.env.HARNESSPRO_PROFILE;
  delete process.env.OPENCODE_HARNESS_BUDGET;
  process.env.HARNESSPRO_PROFILE = "lite";
  try {
    await plugin.setup(ctx);
    const before = hooks.get("execute.before");
    for (let count = 1; count <= 22; count++) {
      await before({ sessionID: "shared", tool: "shell", id: `shared-${count}` });
    }
    assert.throws(
      () => before({ sessionID: "shared", tool: "shell", id: "shared-23" }),
      /Tool budget exhausted \(22 calls\)/,
    );
  } finally {
    if (old === undefined) delete process.env.HARNESSPRO_PROFILE;
    else process.env.HARNESSPRO_PROFILE = old;
  }
});

test("shared off disables the plugin", async () => {
  const old = process.env.HARNESSPRO_PROFILE;
  process.env.HARNESSPRO_PROFILE = "off";
  try {
    const ctx = { tool: { hook: async () => assert.fail("hook must not register") } };
    await plugin.setup(ctx);
  } finally {
    if (old === undefined) delete process.env.HARNESSPRO_PROFILE;
    else process.env.HARNESSPRO_PROFILE = old;
  }
});

test("is disabled by default", async () => {
  delete process.env.OPENCODE_HARNESS_BUDGET;
  const ctx = { tool: { hook: async () => assert.fail("hook must not register") } };
  await plugin.setup(ctx);
});
