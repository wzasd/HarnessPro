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

link_source "$root" "$HOME/.config/harnesspro"
link_source "$root/adapters/opencode" "$HOME/.config/opencode/plugins/harness-budget"
link_source "$root/adapters/pi/harnesspro.js" "$HOME/.pi/agent/extensions/harnesspro.js"
link_source "$root/bin/harnesspro" "$HOME/.local/bin/harnesspro"
node "$root/scripts/register.mjs"
printf 'HarnessPro linked from %s\n' "$root"
