import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env.HARNESSPRO_HOME || os.homedir();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function update(file, mutate) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(value);
  const backup = file + ".backup-before-harnesspro-project";
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

const orcaSettings = path.join(home, ".config", "orca", "profiles", "local-default", "orca-data.json");
update(orcaSettings, (value) => {
  value.settings ||= {};
  const oldPath = path.join(home, ".config", "harnesspro", "orca-plugin");
  const paths = value.settings.devPluginPaths || [];
  value.settings.devPluginPaths = [...new Set([...paths.filter((item) => item !== oldPath && item !== root), root])];
  value.settings.pluginSystemEnabled = true;
});

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
