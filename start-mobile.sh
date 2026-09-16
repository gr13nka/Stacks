#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

if [[ ! -d node_modules ]]; then
  npm ci
fi

# The native backend is macOS-only. Expose the mock frontend on the local
# network so it can be opened from a phone or mobile browser.
export VITE_STACKS_MOCK=1
exec npm run dev -- --host 0.0.0.0
