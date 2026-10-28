import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const home = process.env.HARNESSPRO_HOME || os.homedir();

function update(file, mutate) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(value);
  const backup = file + ".backup-before-harnesspro-project";
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

const piSettings = path.join(home, ".pi", "agent", "settings.json");
update(piSettings, (value) => {
  value.extensions ||= [];
  const extension = path.join(home, ".pi", "agent", "extensions", "harnesspro.js");
  if (!value.extensions.includes(extension)) value.extensions.push(extension);
});

const codexHooks = path.join(home, ".codex", "hooks.json");
update(codexHooks, (value) => {
  value.hooks ||= {};
  const command = `python3 "${path.join(home, ".config", "harnesspro", "adapters", "codex_hook.py")}"`;
  for (const event of ["PreToolUse", "PostToolUse"]) {
    value.hooks[event] ||= [];
    let registered = false;
    for (const group of value.hooks[event]) {
      for (const hook of group.hooks || []) {
        if (hook.command?.includes("harnesspro/codex_hook.py") || hook.command?.includes("harnesspro/adapters/codex_hook.py")) {
          hook.command = command;
          hook.timeout = 5;
          registered = true;
        }
      }
    }
    if (!registered) value.hooks[event].unshift({ hooks: [{ type: "command", command, timeout: 5 }] });
  }
});
