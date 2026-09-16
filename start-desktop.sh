#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

# This project requires the Homebrew Rust toolchain rather than rustup's copy.
export PATH="/usr/local/bin:$PATH"
export STACKS_DESKTOP=1
export VITE_STACKS_DESKTOP=1

if [[ ! -d node_modules ]]; then
  npm ci
fi

desktop_config='{"app":{"windows":[{"label":"main","title":"stacks","width":1280,"height":720,"minWidth":960,"minHeight":540,"resizable":true,"decorations":true,"titleBarStyle":"Overlay","hiddenTitle":true,"trafficLightPosition":{"x":12,"y":12}}]}}'
exec npm run tauri -- dev --config "$desktop_config"
