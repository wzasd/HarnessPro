#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

link_source() {
  source=$1
  target=$2
  if [ -L "$target" ] && [ "$(readlink -f "$target")" = "$source" ]; then
    return
  fi
  if [ -e "$target" ] || [ -L "$target" ]; then
    backup="${target}.backup-before-project"
    if [ ! -e "$backup" ]; then cp -a "$target" "$backup"; fi
    rm -rf "$target"
  fi
  mkdir -p "$(dirname -- "$target")"
  ln -s "$source" "$target"
}

write_pi_entry() {
  source=$1
  target=$2
  desired="export { default } from \"$source\";"
  if [ -f "$target" ] && [ ! -L "$target" ] && [ "$(cat "$target")" = "$desired" ]; then
    return
  fi
  mkdir -p "$(dirname -- "$target")"
  rm -rf "$target"
  printf '%s\n' "$desired" > "$target"
}

link_source "$root" "$HOME/.config/harnesspro"
link_source "$root/adapters/opencode" "$HOME/.config/opencode/plugins/harness-budget"
# pi resolves extension-relative imports against the given path, so a symlinked
# entry breaks the adapter's "../../core.mjs" import. Generate a real file that
# re-exports the adapter from its absolute repository path instead.
write_pi_entry "$root/adapters/pi/harnesspro.js" "$HOME/.pi/agent/extensions/harnesspro.js"
link_source "$root/bin/harnesspro" "$HOME/.local/bin/harnesspro"
node "$root/scripts/register.mjs"
printf 'HarnessPro adapters linked from %s\n' "$root"
printf 'In Orca Plugins, install HarnessPro from this local path: %s\n' "$root"
