import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const register = fileURLToPath(new URL("./register.mjs", import.meta.url));

test("migrates the old Codex hook path without duplicate registrations", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "harnesspro-register-"));
  const oldCommand = `python3 "${home}/.config/harnesspro/codex_hook.py"`;
  const orcaFile = path.join(home, ".config/orca/profiles/local-default/orca-data.json");
  const piFile = path.join(home, ".pi/agent/settings.json");
  const hooksFile = path.join(home, ".codex/hooks.json");
  for (const file of [orcaFile, piFile, hooksFile]) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(orcaFile, JSON.stringify({ settings: { devPluginPaths: [] } }));
  fs.writeFileSync(piFile, JSON.stringify({ extensions: [] }));
  fs.writeFileSync(hooksFile, JSON.stringify({
    hooks: Object.fromEntries(["PreToolUse", "PostToolUse"].map((event) => [
      event,
      [{ hooks: [{ type: "command", command: oldCommand, timeout: 5 }] }],
    ])),
  }));
  const env = { ...process.env, HARNESSPRO_HOME: home };
  execFileSync(process.execPath, [register], { env });
  execFileSync(process.execPath, [register], { env });
  const hooks = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
  const expected = `python3 "${home}/.config/harnesspro/adapters/codex_hook.py"`;
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const commands = hooks.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command));
    assert.deepEqual(commands.filter((command) => command === expected), [expected]);
    assert.equal(commands.includes(oldCommand), false);
  }
});
