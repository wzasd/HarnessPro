import assert from "node:assert/strict";
import test from "node:test";
import extension from "./adapters/pi/harnesspro.js";

test("Pi enforces the shared profile and transforms tool results", async () => {
  const handlers = new Map();
  const pi = {
    on: (name, callback) => handlers.set(name, callback),
    registerCommand: () => {},
  };
  const old = process.env.HARNESSPRO_PROFILE;
  process.env.HARNESSPRO_PROFILE = "lite";
  try {
    extension(pi);
    const before = handlers.get("tool_call");
    const after = handlers.get("tool_result");
    for (let count = 1; count <= 22; count++) {
      assert.equal(await before({ toolCallId: `call-${count}`, toolName: "bash", input: {} }), undefined);
    }
    const changed = await after({
      toolCallId: "call-8",
      toolName: "bash",
      input: {},
      content: [{ type: "text", text: "x\nx\nx\nx" }],
      isError: false,
    });
    assert.match(changed.content[0].text, /previous line repeated 3 more times/);
    assert.match(changed.content[0].text, /Economy phase: 8/);
    const blocked = await before({ toolCallId: "call-23", toolName: "bash", input: {} });
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /22 calls/);
  } finally {
    if (old === undefined) delete process.env.HARNESSPRO_PROFILE;
    else process.env.HARNESSPRO_PROFILE = old;
  }
});
