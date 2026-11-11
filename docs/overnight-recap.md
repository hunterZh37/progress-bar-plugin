# Overnight recap

Optional. What happened while you were away.

## Overnight recap

Save a checkpoint when you stop for the day. When you come back, the List tab of the Status panel opens with what happened while you were away.

```
While you were away · since 6:40 PM (14h)
✓ 2 done  ✖ 1 error  ⚠ 2 warnings  ▶ 2 still running
✖ Nightly import crashed
  Traceback (most recent call last):
⚠ Train batch stuck
  no progress for 12m
⚠ Labels hit the usage limit
  resumed in 2h10m

▸ Show all 8   ✕ Dismiss
```

- **Save a checkpoint:** `/progress-bar checkpoint [label]` (or `/progress-bar away`). From any end-of-day script: `python3 ~/.claude/progress-bar/checkpoint.py [label]`. Either one writes `~/.claude-progress/.state/overnight.json` with the time and every RUNNING row (name, %, done and total), folded or not.
- **When it shows:** once the checkpoint is 4 hours old, or sooner when the panel sees a gap over 30 minutes between its ticks (the computer slept). The panel then marks the file `woke`.
- **What it counts:** finishes, errors and warnings from the Log tab since the checkpoint, plus jobs running then that sit in DONE now. The top 3 lines show, errors first. **Show all** adds every running job with its % then and now (`16% → 62%  · 6h left`), waiting jobs and finishes with their times.
- **Status line:** the one-line summary ends with `recap ready` while the recap shows.
- **Dismiss** moves the file to `~/.claude-progress/.state/overnight-YYYY-MM-DD.json` (the checkpoint's day) and hides the recap until the next checkpoint.
