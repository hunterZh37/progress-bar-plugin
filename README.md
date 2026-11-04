# progress-bar

Live progress bars and a to-do list in the Claude Code status line. One line per running subagent and per long job, grouped by state. Updates every 5 seconds.

```
▾ ☐ TO-DO
  YOU: Review the deploy PR · Sign in to the dashboard
  MAC: Load the 2026 batch
▾ ▶ RUNNING
  ⚠ stuck 14m nightly-import ████████████████░░░░ 80.0% · 4/5 · batch 4 · 31m
  ⠹ build-docs ████████░░░░░░░░░░░░ 40.0% · 2/5 · render pages · 3m · 14 tools
▸ ✔ DONE (2)
```

## What it does

- **Subagents:** every running subagent gets a line with its age, tool calls and last tool.
- **Real bars:** a subagent or shell job that writes `~/.claude-progress/<slug>.json` gets a bar with percent, count and step.
- **Bars from logs:** a job that only writes a log (psql, a vendor tool, a remote job) gets a bar from a watch file: done/total read from the log by regex, an ETA, and `■ stopped` or `✖ error` when it dies or fails.
- **Skill:** `progress-reporting` tells Claude to write those files for multi-step work and to ask subagents to do the same.
- **Groups:** lines sort into **TO-DO**, **PROBLEMS**, **RUNNING**, **WAITING** and **DONE**. A job that ends shows as `finished 14:05` for 30 minutes. Duplicate rows of one job merge.
- **Spinner and stuck rows:** each RUNNING row gets a spinner (and `in progress` when it has no step). A row whose numbers have not moved for 10 minutes shows a yellow `⚠ stuck 14m` instead and sorts first. Change the 10 in `~/.claude-progress/.state/stuck-minutes`.
- **To-dos:** `~/.claude-progress/todo.txt` shows first. Claude keeps it current.
- **Links:** job names open their progress file, or a URL you set in `links.txt`.
- **Status line:** a small script prints all this above your existing status line.
- **Status panel:** an optional docked pane beside the chat with the same groups, foldable headers and a one-line status line.
- **Connectors:** a second tab in the panel shows which MCP connectors are connected, need sign-in or failed.

## Install

At the prompt of a terminal session:

```
/plugin marketplace add hunterZh37/progress-bar-plugin
/plugin install progress-bar@progress-bar
```

Or in one line:

```
/plugin install progress-bar --marketplace hunterZh37/progress-bar-plugin
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install progress-bar --marketplace hunterZh37/progress-bar-plugin`.

## Set up the status line

```
/progress-bar setup
```

This writes `~/.claude/progress-bar/statusline.sh`. It never edits your settings. Add the line it prints to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/progress-bar/statusline.sh", "refreshInterval": 1 }
```

- **`refreshInterval: 1`** redraws the status line every second, so bars move while Claude is idle.
- **Grouping** runs through `~/.claude/progress-bar/group.py`, which setup writes beside the script. It needs only the system `python3`. Without it the lines print ungrouped.
- **Updating the plugin?** Run setup again to get the new scripts.

Already have a status line? Setup reads it and builds it into the script. The bars print first, then your old status line, which still gets the session JSON on stdin. Its lines print as is, below the groups. Run setup before you change the setting.

## Commands

| Command | Does |
| --- | --- |
| `/progress-bar` | Shows the current bars and whether the status line is set up |
| `/progress-bar setup` | Writes the status line script |
| `/progress-bar setup mac-clicks` | macOS: click a section header to fold it. `off` removes it |
| `/progress-bar demo` | Runs a 20 second demo job so you can see a bar |
| `/progress-bar clear` | Deletes stale progress files |
| `/progress-bar todo` | Lists to-dos with numbers |
| `/progress-bar todo add [name] <text>` | Adds a to-do under `[name]` (default: the last heading, or `[todo]`) |
| `/progress-bar todo done <n\|text>` | Marks a to-do done by number or by text it contains |
| `/progress-bar todo clear` | Removes done to-dos |
| `/progress-bar panel` | Opens the Status panel. `panel on` opens it at every session start, `panel off` stops that |
| `/progress-bar fold <section>` | Folds a section to one line. `unfold` opens it, `toggle` flips it |

## File format

`~/.claude-progress/<slug>.json`:

```json
{"done": 2, "total": 5, "step": "render pages", "startedAt": 1767225600000}
```

- **Slug:** the job or subagent description, lowercased, each run of other characters turned into `-`. `Build docs!` becomes `build-docs`.
- **done** and **total** draw the bar. Leave them out and the line says `working`.
- **startedAt** is optional, in milliseconds.
- **Delete the file when done.** Files older than 10 minutes are hidden.

Shell helper:

```sh
progress() { mkdir -p ~/.claude-progress; printf '{"done":%s,"total":%s,"step":"%s"}\n' "$2" "$3" "$4" > ~/.claude-progress/"$1".json; }
progress nightly-import 2 5 "batch 3"
```

## Watch files: bars from a log

`~/.claude-progress/<slug>.watch.json`, written once when the job starts:

```json
{"log": "~/logs/import.log", "match": "(\\d+)/(\\d+) batches", "process": "^python .*import\\.py", "startedAt": 1767225600000}
```

| Field | Does |
| --- | --- |
| `log` | The log to read (`~/` allowed). Logs over 4 MB are read from their end |
| `match` | Regex with two groups, done and total. The last match wins |
| `count` + `total` | Or: done = lines matching `count` (one per finished step) |
| `step` | Optional regex. Its last match (group 1) is shown as the step |
| `error` | Optional regex. A match shows `✖ error` |
| `process` | Optional `pgrep -f` pattern. Gone before done shows `■ stopped` |
| `startedAt` | Optional, ms. Adds an ETA |
| `label` | Optional name, the slug otherwise |

A psql script, one step per statement (`REFRESH MATERIALIZED VIEW` reports no progress of its own):

```json
{"log": "~/logs/refresh.log", "count": "^(REFRESH MATERIALIZED VIEW|\\(1 row\\))$", "total": 5, "error": "ERROR"}
```

```
▶ import ████████████░░░░░░░░ 61.0% · 5713/9366 · 2h10m · ETA 1h23m
✔ db-refresh ████████████████████ 100.0% · 5/5 · 9m
```

## To-dos

`~/.claude-progress/todo.txt`, shown first in the status line:

```
# comments start with #
[you]
Review the deploy PR | https://github.com/org/repo/pull/12
x Rotate the token
[mac]
Load the 2026 batch
```

- **Headings:** any `[name]`, for a person or a machine. Each shows as one row: `YOU: item · item`.
- **Done:** prefix `x `. Done items are hidden in the status line and shown with `✓` under DONE in the Status panel. `/progress-bar todo clear` removes them.
- **Links:** `text | url` makes the text clickable in terminals that support links.
- **Claude keeps it current:** the skill tells Claude to add items when work is queued or handed to you and to mark them done when finished.

## Links

Job names link to their progress file when one exists. To send a job somewhere else, add `~/.claude-progress/links.txt`, one `<regex> | <url>` per line, matched against the job name:

```
^deploy | http://localhost:3000
import | file:///Users/me/logs/import.log
```

The first match wins. Clicking needs a terminal with link support (iTerm2, WezTerm, Kitty, Ghostty, VS Code).

## How it works

- The plugin lists subagents, counts their tool calls and reads the progress files.
- It writes subagent lines to `~/.claude-progress/.lines/agents-<session>.txt` (one file per open session, so sessions never overwrite each other) and job lines to `jobs.txt`. At most 6 lines each.
- The status line script prints every `.lines/*.txt` file changed in the last 2 minutes. Other tools can drop their own lines there too.
- `group.py` sorts those lines into sections, adds the to-dos and links, and remembers ended jobs in `~/.claude-progress/.state/group-seen.json`.

## Status panel

Optional. Shows the full groups in a docked pane named **Status**, and shrinks the status line to one summary line.

```
/progress-bar panel on
```

```
▾ ☐ TO-DO  3
  You
    ○ Review the deploy PR
    ○ Sign in to the dashboard

▾ ▶ RUNNING  2
  ⚠ 14m nightly-import
    ████████████████░░░░ 80.0%
    4/5 · batch 4 · 31m

▸ ✔ DONE  2
```

The status line then reads:

```
▶ 2 running · ⚠ 1 stuck · ☐ 3 to-do · full view in the Status panel
```

- **Needs setup:** the panel runs `~/.claude/progress-bar/statusline.sh` with `PB_FULL=1` every second while it is open. `panel on` refreshes that script and `group.py` and keeps your chained status line.
- **Fold:** press a header, or its hotkey (`1` to-do, `2` running, `3` done, `4` waiting, `5` problems). It writes `~/.claude-progress/.state/folded.txt`, the same file `/progress-bar fold` uses.
- **Off by default:** `panel on` writes `~/.claude-progress/.state/panel-on`. With that file the pane opens at session start and the status line prints the summary. `panel off` deletes it and closes the pane. `/progress-bar panel` opens it once without turning it on.
- **To-do menu:** click a to-do for Mark as done, Move back to to-do or Delete. It edits `~/.claude-progress/todo.txt`. TO-DO lists open items only. Checked-off ones move to DONE under **Checked-off to-dos**, after finished jobs, and count there.
- **Rows:** to-dos one per line under each owner, running jobs as name, bar and details (stuck ones in yellow), done jobs dimmed with their finish time.
- **Tabs:** `[ List ]` (hotkey `l`, the default) shows the sections above. `Connectors` (hotkey `c`) shows your connectors. Its label adds `!N` when N need attention.

## Connectors

The **Connectors** tab of the Status panel lists each MCP connector with its status.

```
[ List ]   Connectors !2

⚡ CONNECTORS  7 ok · 2 need sign-in
  Claude: you@example.com · Your Org
  ✔ Gmail
    you@gmail.com
  ✔ nombot-db
  ! Canva  needs sign-in
  checked 14:05  ↻ refresh
```

- **How it checks:** runs `claude mcp list` in your home folder (90 s timeout) and `claude auth status` for the login line. At most every 5 minutes, only while the panel is open, never two checks at once. `↻ refresh` checks now.
- **Status:** `✔` connected, `!` needs sign-in, `✖` failed. A leading `claude.ai ` and a trailing ` for creativity` are dropped from names.
- **Names and status only:** the URL or command of each connector is dropped as the output is read. It is never stored or shown, since it can hold passwords or tokens. From `claude auth status` only the email and organization name are kept.
- **Shared cache:** `~/.cache/progress-bar/connectors.txt` holds `name<TAB>status` lines, the login and the check time. Every open session reads it, so one check serves all of them.
- **Accounts (optional):** write `~/.claude-progress/connector-accounts.txt` to show which account each connector uses, on a dim line under it. One `name<TAB>account` per line, names as the tab shows them. Lines starting with `#` are comments.

```
# connector<TAB>account
Gmail	you@gmail.com
Google Drive	work@example.com
```

## Fold sections

- `/progress-bar fold done` hides a section as `▸ ✔ DONE (3)`. An open one shows `▾`. `unfold` opens it, `toggle` flips it. Sections: `todo`, `running`, `waiting`, `done`, `problems`, `all`.
- The choice is saved in `~/.claude-progress/.state/folded.txt`, which `group.py` reads.

## Click to fold (macOS)

Optional. Makes each section header a link that folds or unfolds that section.

```
/progress-bar setup mac-clicks
```

- **What it installs:** `~/Applications/ProgressBarToggle.app`, a tiny AppleScript app built with `osacompile`, signed ad hoc and registered for `progressbar://` URLs. Its source is at `~/.claude/progress-bar/ProgressBarToggle.applescript`. It runs only when you click and accepts only the five section names.
- **Turns on header links** by writing `~/.claude-progress/.state/clicks-on`. Without that file the headers stay plain text.
- **Needs a terminal that renders OSC 8 hyperlinks:** Ghostty, iTerm2, WezTerm or kitty. In Ghostty, ⌘-click the header.
- **Inside tmux or herdr** links may be stripped. Try `FORCE_HYPERLINK=1`, or turn on tmux's `hyperlinks` feature (`set -as terminal-features ',*:hyperlinks'`).
- **Remove it:** `/progress-bar setup mac-clicks off` unregisters and deletes the app and turns the links off.
- **Other systems:** use `/progress-bar fold <section>`.

## Privacy

Everything stays on your machine. The plugin reads and writes only files under `~/.claude-progress/`, `~/.claude/progress-bar/` and `~/.cache/progress-bar/`, plus `~/Applications/ProgressBarToggle.app` if you run `setup mac-clicks`. The plugin makes no network calls itself. While the Status panel is open, the Connectors tab runs `claude mcp list`, which contacts your configured connectors to check them.

## License

MIT
