# Action needed

Steps only you can run, held until done or skipped.

## Action needed

Some steps only you can run: a deploy swap, a login, a command the permission system blocks, deleting a repo. Claude adds them as **actions** instead of only writing them in chat. While one is open you finish it or skip it before giving other instructions.

```
Action needed
Swap in myapp build a1b2c3 (login fix)
$ cd ~/code/myapp/web && rm -rf .next-prev && mv .next .next-prev && …
▶ Run   Copy   ✓ I ran it   Skip
```

- **▶ Run (macOS):** runs the command for you, no copy and paste. First a confirm line in the same box, "Run this in Ghostty?" (or Terminal), shows the **full command** with **▶ Run** and **Cancel**. The command shows once (a second copy only when the line above was cut short), and the other buttons hide until you choose. Cancel runs nothing. Run writes the command to `~/.claude-progress/.state/run/<action id>.sh` (mode 0700) and opens a **new visible window** that runs it: Ghostty when it is installed, else Terminal.app. Logins, browser steps and password prompts work there, and the window stays open with "Done. You can close this window." The action then clears when its check passes (one check 10 s after launch, then every 30 s). An action with no check needs **✓ I ran it**. The Log tab gets "Action run in Terminal: <title>". Claude Code slash commands (like `/plugin update ...`) have no Run, since they are typed in Claude Code. Use Copy for those.
- **Popup, inside Claude Code:** when an action is added, and again at most every 10 minutes while it is open, a pane titled **Action needed** opens in Claude Code, styled like the Status panel: a red box with the title, why and the command, then **▶ Run**, **Copy**, **✓ I ran it**, **Later** and **Skip**. A slash command has no Run. **✓ I ran it** runs the check and closes the action only when it passes, else a red "Check still fails" line shows in the box. **Later** closes the pane. It closes by itself once no action is open. There is **no system dialog**.
- **Away from Claude Code (macOS):** when the front app is not your terminal, you also get one quiet macOS notification, titled "Claude Code" with the action's title, that says an action is waiting in Claude Code. Same 10 minute limit. Nothing pops over your screen.
- **Prompt gate:** while an action is open for this session's project (or for every project), a prompt you type is held and you see the action, its command and how to go on:
  - `done` runs the check and clears the action when it passes. An action with no check clears at once.
  - `skip <reason>` clears it and logs a warning with your reason.
  - `/progress-bar action list` shows every open action.
  
  Slash commands always pass, so `/progress-bar ...` and `/plugin ...` keep working. Task notifications and messages from other sessions pass too. Your held message comes back in the prompt box once the last action is done.
- **Auto-clear:** checks run every 30 s, and again before a prompt is held (5 s timeout each). Run the command in any terminal and the action clears by itself with a toast "Action done: <title>".
- **Status panel:** a NEEDS YOU line at the top of the List tab, its verb bold (**Swap** in the new build), the full command wrapped under it, then **▶ Run**, **Copy**, **✓ I ran it** and **Skip**.
- **Status line:** the summary starts with a red `! N actions needed`. Without the panel, the full view starts with that line.
- **Log tab:** each action logs when it is added, done and skipped.

Claude adds one with the `action_add` tool (the `action-needed` skill says when). You or a script can add one too:

```
/progress-bar action add Swap in the new build --command make swap --why users see the fix --check grep -qx abc123 web/.next/BUILD_ID
```

Values run to the next `--flag`. `--global` makes it hold prompts in every project. By default it holds only this session's project (the same project as Per-project to-dos).

**File format.** `~/.claude-progress/actions.json` is a list. Any script on this machine may write it (a temp file, then rename):

```json
[{ "id": "swap-1", "title": "Swap in the new build", "command": "make swap", "why": "users see the fix",
   "check": "grep -qx abc123 /path/to/BUILD_ID", "priority": "high", "created": 1800000000,
   "project": "code-myapp", "status": "open" }]
```

`id`, `title` and `status` matter. `command`, `check` and `project` are optional. No `project` means every project. Closed actions keep `status` `done` or `skipped`, a `skipReason` and `closed`. The newest 50 closed ones are kept.

**Safety.**

- The plugin **never runs an action's `command` on its own**. Only you do, by hand or with **▶ Run**, which always asks first with the full command. Claude has **no tool or command for Run**, so it can never press it. Copy hands the command to `pbcopy` on stdin.
- Run hands the command to the script file on stdin, never through a shell string or AppleScript. The terminal AppleScript is fixed and gets only the script's path as an argument.
- It runs only `check`, with `/bin/sh` in your home folder, 5 s at most. A check must be a **read-only test** that exits 0 once the step is done, such as `grep -q`, `test -e`, `gh repo view`. Never put a command that changes anything in `check`.
- The notification text goes to `osascript` as arguments. The AppleScript source is fixed, so nothing in a title or command is ever read as AppleScript.
- Actions hold commands, **never secret values**. Write the command that fetches or logs in, such as `gh auth login`, never a token or a password.
- Commands and checks come from Claude or scripts on this machine. They are shown as text and quoted as text.
