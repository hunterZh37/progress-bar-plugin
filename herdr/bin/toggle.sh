#!/usr/bin/env bash
# Toggle the Connectors pane in the current tab: close it if open, else
# split it to the right of the focused pane and resize it to ~30 columns.
set -u
H="${HERDR_BIN_PATH:-herdr}"
WIDTH="${CONNECTORS_WIDTH:-30}"
dir="${HERDR_PLUGIN_STATE_DIR:-$HOME/.cache/herdr-connectors}"
tab="${HERDR_TAB_ID:-}"
target="${HERDR_PANE_ID:-}"
state="$dir/tab-${tab//:/_}.pane"

# Close if this tab already shows the panel.
if [ -n "$tab" ] && [ -f "$state" ]; then
  pane="$(cat "$state")"
  rm -f "$state"
  if "$H" pane get "$pane" 2>/dev/null | grep -q "\"tab_id\":\"$tab\""; then
    "$H" plugin pane close "$pane" >/dev/null
    exit 0
  fi
fi

args=(plugin pane open --plugin "${HERDR_PLUGIN_ID:-hunter.connectors}" --entrypoint panel
      --placement split --direction right --no-focus)
[ -n "$target" ] && args+=(--target-pane "$target")
out="$("$H" "${args[@]}")" || exit 1
pane="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["plugin_pane"]["pane"]["pane_id"])')" || exit 1

# Resize: move the split divider so the panel is ~WIDTH columns wide.
"$H" pane layout --pane "$pane" | python3 -c '
import json, sys
pane, width = sys.argv[1], int(sys.argv[2])
lay = json.load(sys.stdin)["result"]["layout"]
rect = next(p["rect"] for p in lay["panes"] if p["pane_id"] == pane)
# The split whose right edge matches the panel and that contains it.
cands = [s for s in lay["splits"] if s["direction"] == "right"
         and s["rect"]["x"] + s["rect"]["width"] == rect["x"] + rect["width"]
         and s["rect"]["x"] < rect["x"]]
if not cands:
    sys.exit(0)
s = min(cands, key=lambda s: s["rect"]["width"])
total = s["rect"]["width"]
want = max(0.1, min(0.9, 1 - (width + 1) / total))
delta = want - s["ratio"]
if abs(delta) > 0.005:
    print(("right" if delta > 0 else "left") + " " + f"{abs(delta):.4f}")
' "$pane" "$WIDTH" | {
  read -r dirn amount && "$H" pane resize --pane "$pane" --direction "$dirn" --amount "$amount" >/dev/null
}
exit 0
