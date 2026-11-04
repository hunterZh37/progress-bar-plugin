#!/usr/bin/env bash
# Pane entrypoint: remember which pane shows the panel (so toggle can close it), then run it.
dir="${HERDR_PLUGIN_STATE_DIR:-$HOME/.cache/herdr-connectors}"
mkdir -p "$dir"
if [ -n "${HERDR_TAB_ID:-}" ] && [ -n "${HERDR_PANE_ID:-}" ]; then
  printf '%s\n' "$HERDR_PANE_ID" > "$dir/tab-${HERDR_TAB_ID//:/_}.pane"
fi
cd "$(dirname "$0")" && exec python3 ./connectors.py
