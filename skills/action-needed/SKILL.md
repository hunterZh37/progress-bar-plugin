---
name: action-needed
description: Ask the person to run a step only they can do (a deploy swap, a login, a command the permission system blocked, deleting a repo, a /plugin update) through the progress-bar action_add tool, so it shows an Action needed pane in Claude Code and holds their next prompt until done. Use whenever work cannot go on until the person runs something themselves.
---

# Action needed

When you need the person to run something before work can go on, add an **action**. Do not only write the command in chat. An action opens an Action needed pane inside Claude Code (never a system dialog, only a quiet macOS notification when they are in another app), shows a red box in the Status panel, and holds their next prompt until it is done or skipped.

## When

- A command the permission system or the classifier blocked, that the person must run themselves.
- A deploy swap, restart or cutover only they may do.
- A login, token refresh or `gh auth` scope change.
- Deleting or renaming something (a repo, a bucket, a branch on a protected remote).
- A slash command only they can type, such as `/plugin update`.

Not for questions, choices or nice-to-haves. Use it only when the work is blocked on them.

## How

Call the `action_add` tool (`mcp__progress-bar__action_add`):

- `title`: what to do, a few plain words. "Swap in the new build".
- `command`: the exact command or steps to run. Commands only. Never a token, password or other secret value.
- `why`: one line on what it unblocks.
- `check`: a **read-only** shell test that exits 0 once the step is done. It runs every 30 s (5 s timeout), so the action clears by itself when the person runs the command in a terminal. Examples: `grep -qx abc123 /abs/path/BUILD_ID`, `test -e /abs/path`, `gh repo view owner/repo >/dev/null 2>&1; test $? -ne 0`. Use absolute paths. Never put anything that changes state in a check. Add a check whenever you can.
- `global`: true only when it should hold prompts in every project. Default is this session's project.

Then tell the person in one line that an action is waiting and what it unblocks.

The plugin never runs `command` on its own. The person may press **▶ Run** in the Status panel or the Action needed pane, which asks them to confirm the full command in the pane and then runs it in a new visible terminal window. Only the person can press Run. You have no tool for it and must never try to trigger it, run the command yourself, or work around a block that made the action necessary. Write `command` so it runs as is in a terminal (slash commands like `/plugin update` get Copy, not Run).

Without the tool (another machine, a script), the same works with `/progress-bar action add <title> --command <cmd> --why <text> --check <test>`, or by writing `~/.claude-progress/actions.json`.

## After

The person types `done` (runs the check), `skip <reason>`, or runs the command so the check clears it. `/progress-bar action list` shows what is open. When an action you added clears, go on with the work it blocked.
