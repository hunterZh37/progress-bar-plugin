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
- **Groups:** lines sort into **TO-DO**, **PROBLEMS**, **RUNNING**, **WAITING** and **DONE**. A job that ends shows as `finished 14:05` for 30 minutes, unless its progress file still exists. Duplicate rows of one job merge. A row is **DONE** only on `✔`, `100%`, or `· done` at the end (or `· done:`), so `done in 1h` stays RUNNING. `waiting`, `pending` and `waits for` go to **WAITING**.
- **Spinner and stuck rows:** each RUNNING row gets a spinner (and `in progress` when it has no step). A row whose numbers have not moved for 10 minutes shows a yellow `⚠ stuck 14m` instead and sorts first. An agent's tool count counts as movement, so an agent working through a long step is not stuck. Change the 10 in `~/.claude-progress/.state/stuck-minutes`.
- **To-dos:** `~/.claude-progress/todo.txt` shows first. Claude keeps it current. Number items to set their priority, and mark what waits on a running job.
- **Auto-next:** when a job finishes, the top ready to-do of its machine starts by itself (or is suggested, the default).
- **Links:** job names open their progress file, or a URL you set in `links.txt`.
- **Status line:** a small script prints all this above your existing status line.
- **Status panel:** an optional docked pane beside the chat with the same groups, foldable headers and a one-line status line.
- **Connectors:** a second tab in the panel shows which MCP connectors are connected, need sign-in or failed.
- **GitHub:** a third tab shows the session repo's branch, other branches and recent commits. Click one to open it on GitHub.
- **Titles and parents:** a progress file can name its job in plain words (`title`), say what it unlocks (`why`) and point at a parent job (`parent`). Each running job is one line with its short title, and a child shows under its parent.
- **Log:** a fourth tab lists errors, warnings and finishes from `~/.claude-progress/events.jsonl`, written by the grouper and by a scanner for your own log folders. Unseen errors show as `!N` on the tab and `✖ N errors` in the status line.

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
- **Grouping** runs through `~/.claude/progress-bar/group.py`, which setup writes beside the script with `events.py` (the events log) and `checkpoint.py` (the overnight recap). Both need only the system `python3`. Without it the lines print ungrouped.
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
| `/progress-bar autonext on\|off\|ask` | When a job finishes: start the next to-do (`on`), suggest it (`ask`, the default) or do nothing (`off`) |
| `/progress-bar panel` | Opens the Status panel. `panel on` opens it at every session start, `panel off` stops that |
| `/progress-bar checkpoint [label]` | Saves the running jobs for the overnight recap. `away` does the same |
| `/progress-bar fold <section>` | Folds a section to one line. `unfold` opens it, `toggle` flips it |

## File format

`~/.claude-progress/<slug>.json`:

```json
{"done": 2, "total": 5, "step": "render pages", "startedAt": 1767225600000,
 "title": "Docs site · all pages", "why": "the public help pages", "parent": "release-prep"}
```

| Field | Does |
| --- | --- |
| `done`, `total` | Draw the bar. Leave them out and the line says `working` |
| `step` | A few words on the current step |
| `startedAt` | Optional, ms. The file's time otherwise |
| `title` | Optional plain-language name. The job's line shows the part before ` · ` or `: `, and the open card shows the id and badge. The part before ` · ` names the job in the Log tab and in `waiting on:` |
| `why` | Optional. What the job unlocks, shown dim as `unlocks: …` |
| `parent` | Optional slug of the job this one is part of. While both run, this job shows under the parent's line when the parent is open, marked `↳` |

- **Slug:** the job or subagent description, lowercased, each run of other characters turned into `-`. `Build docs!` becomes `build-docs`.
- **Delete the file when done.** Files older than 10 minutes are hidden.
- **Jobs that can't write the file** (a log-only job, a row from another tool) get the same fields from `~/.claude-progress/titles.txt`, one job per line, tab separated: `<job id><TAB><title><TAB><why><TAB><parent>`. The job id is the name the row shows. Empty columns are fine, `#` starts a comment. A progress file's own fields win.

```
# job id	title	why	parent
nightly-import	Nightly import · all files	the morning dashboard
box: train.py	Train the model	better search	release-prep
```

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
| `process` | Optional `pgrep -f` pattern. Gone before done, with the log quiet for 2 minutes and not ending in a finish line, shows `■ stopped` |
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
1. Verify and load the arts labels (after classify)
2. Review the Dependabot alerts
Load the 2026 batch
[hunty]
1. Finance trends per org (after 2019-20 load)
```

- **Headings:** any `[name]`, for a person or a machine. Each shows as one row: `YOU: item · item`.
- **Done:** prefix `x `. Done items are hidden in the status line and shown with `✓` under DONE in the Status panel. `/progress-bar todo clear` removes them.
- **Links:** `text | url` makes the text clickable in terminals that support links.
- **Priority:** a leading `N. ` sets an item's place under its heading, `1.` first. Unnumbered items come after the numbered ones, in file order. The status line and the Status panel list items in this order, with the number.
- **Blocked items:** an item ending `(after X)` waits while any RUNNING job's name or title holds every key word of X (case does not matter, small words like "the" are skipped). `(after 2019-20 load)` waits on `Load 2019-20 filings`. A blocked item shows dim. The Status panel hides the `(after X)` text and adds one dim `waits for <job>` line under the items that wait on that job.
- **Next:** the top ready item of each machine heading (any heading but `[you]`) is marked: `next` in the status line, a green `▶` in the Status panel.
- **Move up and Move down:** in the Status panel, press an item and pick `↑ Up` or `↓ Down`. Every open item under that heading is renumbered `1.` to `N.` in the new order. The item is found by its text, never by line number.

### Auto-next

When a RUNNING job finishes (a `<job> done` event in `events.jsonl`, logged once per finish by the grouper), the plugin picks the top ready to-do of that job's machine, plus any machine with an item that was waiting for that job, and asks Claude to start it with this prompt:

```
Next up from the to-do list: <item>. Start it with a progress bar, and take it off todo.txt once it runs.
```

- **Machine:** a `<host>: name` job, or a title that starts with a heading name (`Hunty CPU batch`), belongs to that heading. Any other job belongs to `[mac]` or `[local]`. `[you]` items never start on their own.
- **Mode:** `/progress-bar autonext on|off|ask`, saved in `~/.claude-progress/.state/autonext`. `on` sends the prompt. `ask` (the default) shows a toast and puts the prompt in the prompt box as a suggestion, so Tab starts it. `off` does nothing. The panel menu's `▶ Start` sends the same prompt for any ready item.
- **Caps:** `~/.claude-progress/.state/caps` holds one `machine=N` per line (default `mac=3`, `hunty=2`). A machine with N or more RUNNING rows waits, and the next one starts once a row finishes.
- **Once:** every open session checks every 5 seconds, and only one acts on a finish. It claims the finish with a folder under `~/.claude-progress/.state/autonext-claims/`, and holds the item for 6 hours so two finishes never start the same to-do. The session that ran the finished agent goes first. Others wait 20 seconds.
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
- With `events.py` beside it, `group.py` logs done, stuck and problem rows once each to `~/.claude-progress/events.jsonl` (sent keys in `.state/events-sent.json`) and starts a log folder scan in the background at most every 30 seconds (offsets in `.state/log-offsets.json`).

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
  ⚠ nightly-import  ⚙ job
    ████████████████░░░░ 80%  4 of 5 steps
    no progress for 14m
    ▸ batch 4
    ⏱ 31m so far

▸ ✔ DONE  2
```

The status line then reads:

```
▶ 2 running · ⚠ 1 stuck · ✖ 1 error · ☐ 3 to-do · full view in the Status panel
```

`✖ N errors` shows only while the Log tab has unseen errors.

- **Needs setup:** the panel runs `~/.claude/progress-bar/statusline.sh` with `PB_FULL=1` every second while it is open. `panel on` refreshes that script and `group.py` and keeps your chained status line.
- **Fold:** press a header, or its hotkey (`1` to-do, `2` running, `3` done, `4` waiting, `5` problems). It writes `~/.claude-progress/.state/folded.txt`, the same file `/progress-bar fold` uses.
- **Off by default:** `panel on` writes `~/.claude-progress/.state/panel-on`. With that file the pane opens at session start and the status line prints the summary. `panel off` deletes it and closes the pane. `/progress-bar panel` opens it once without turning it on.
- **To-do menu:** click a to-do for Done, Up, Down, Start (a ready machine item), Delete or Move back to to-do (a checked-off one). It edits `~/.claude-progress/todo.txt`, on the line that still holds that item's text, so a line added since the panel drew never hits the wrong item. TO-DO lists open items only. Checked-off ones move to DONE under **Checked-off to-dos**, after finished jobs, and count there.
- **Rows:** to-dos one per line under each owner, running jobs one line each, a press opening the details (see **Running cards**), done jobs dimmed with their finish time.
- **Tabs:** `▌List  │   Connectors  │   GitHub  │   Log`, the shown one marked `▌`. **List** (the default) shows the sections above. **Connectors** shows your connectors, its label adding `!N` when N need attention. **GitHub** shows your repos. **Log** shows the events log, its label adding `!N` for unseen errors.

## Running cards

Each RUNNING job in the Status panel is one line: title, bar, percent and time left. The bars line up in one column. Press a title to open its card with the details, press it again to close it.

```
◐ ▾ Health care labels       ████████░░  64%  1h19m left
    healthcare-classify   🏷  labeling
    1,234 of 2,000 batches
    ▸ scoring
    ⏱ 42m so far   ⚡ 31/min
    unlocks: the health care filter
◓ ▾ Release prep             ████████░░  75%  waiting on Train the model
    release-prep   🤖  Claude agent
    6 of 8 steps
    ⏱ 22m so far   🔧 52 actions
      ↳ ▸ Train the model    ░░███░░░░░       12:50 running
⚠ ▸ Nightly import           ████████░░  80%  ⚠ no progress 14m

Claude Max this week  ██████░░░░  62% used
```

- **Count:** the RUNNING header counts top-level lines and notes nested ones, as `RUNNING  4 (+3 sub-jobs)`.
- **Machine:** each line starts with its machine, like `Hunty: Similar orgs` or `Mac: Health care`. Remote machines come from `<host>: name` rows and the to-do headings. The local one is the `[mac]` or `[local]` heading. With no remote machine, lines show the plain title.
- **Line:** a mark, `▸ <short title>`, a 10-cell bar, the percent, then one dim note: `N left`, the run time, `Nm so far`, `waiting on X`, or a yellow `⚠ no progress Nm`. A job that reports steps but no time left (an agent) shows an estimate, `~Nm left`, from its time so far per step done.
- **Short title:** `title` from the progress file or `titles.txt`, cut at ` · ` or `: `. A remote job keeps `<host>: name` whole. Without a title the job id is used.
- **Aligned bars:** the title column is 14 to 26 characters wide by pane width. Longer titles end in `…`.
- **Open card:** the job id and kind badge, `a of b steps` (or `batches`, or `steps not reported`), `▸ step`, the facts and `unlocks: …`. It never repeats the percent or the time left. Open cards stay open while the session runs.
- **Children:** a job whose `parent` is also running shows under the parent's line, marked `↳`, only while the parent is open. One level only: a parent that has a running parent of its own keeps its own line.
- **Remote jobs:** a `<host>: name` job without a `parent` nests under the one running job whose id starts with `<host>-` (such as `gpu-box: train.py` under `gpu-box-train`). With none or several such jobs it keeps its own line.
- **Waiting on:** a parent whose numbers have not moved is not stuck while a child runs or changed in the last 10 minutes. Its line reads `waiting on <child title>` instead of `no progress`. The grouper does the same in the status line.
- **Kind badge:** 🏷  **labeling** for names ending `-classify`, `-verify`, `-judge` or `-candidates`. 🖥  **on host** for names starting `host:` or `host: ` (any `name:` prefix, such as `gpu-box: train.py`). 🤖  **Claude agent** when the row reports `N tools`. ⚙  **job** for the rest.
- **Busy processes:** a row detail `N% CPU` is never progress. The line shows the sliding piece and the run time, the card `⚙ N cores busy` and `⏱ 12:50 running`. A busy process that ends never shows as finished.
- **Name:** a trailing status word (`working`, `running`, `pending`, `waiting`, `starting`) is left out.
- **No percent:** a 3-block piece slides along the bar, so it still reads as working.
- **Facts:** `⚙ N cores busy`, `⏱ 12:50 running`, `⏱ Y so far`, `⚡ N/min`, `🔧 N actions · last: Tool`.
- **Claude Max meter:** one shared meter under RUNNING, from a row detail `7d N%` or `Max 7-day used N%` (the highest one). Green under 50%, yellow under 80%, red above.
- **Done at 100%:** a row that reached 100% but still reports shows under DONE as one dim line, `✓ <title>  finishing · 7/7`, without a bar.

## Log tab

The **Log** tab of the Status panel lists what happened to your jobs, newest first.

```
 List  │   Connectors  │   GitHub  │  ▌Log

✖ 1 error  ⚠ 1 warning  ✓ 3 done   last 24 h
▌All   Errors   Warnings   Done

✖ 14:02  Nightly import crashed  nightly-import
     Traceback (most recent call last):
     ValueError: bad row 1204
     ↗ open log
⚠ 13:40  Train the model stopped (restart or kill)  train
✓ 13:12  Docs site done  docs-site
```

- **Counts and filters:** errors, warnings and finishes from the last 24 hours. Filter by All, Errors, Warnings or Done. The newest 40 rows show.
- **Rows:** press one to show its detail (up to 12 lines). `↗ open log` shows only for a log file inside one of your log folders, and opens it with `open` (macOS) or `xdg-open`.
- **Unseen errors:** errors from the last 24 hours logged since you last opened the tab show as `!N` on its label and `✖ N errors` in the one-line status line. Opening the tab clears both (it writes `~/.claude-progress/.state/log-seen.txt`).
- **From the grouper:** a job that moves to DONE (success), a job stuck for the first time (warning) and a PROBLEMS row (error), each logged once. A lock keeps several status lines from logging the same event at the same moment. A parent waiting on a child is not logged as stuck. An agent that has handed its report back leaves WAITING.
- **From your logs (optional):** list folders in `~/.claude-progress/log-dirs.txt`, one per line (`~` works, `#` starts a comment). None by default. At most every 30 seconds, `events.py scan` reads each `*.log` there changed in the last 24 hours, from where it stopped last time. It logs a Python traceback or an `ERROR` line as an error, a run ended by `SIGTERM` or `SIGKILL` as a warning `stopped (restart or kill)` with `resumed in <newer log>` when a newer log of the same job made progress, a rate limit or billing line as a warning (at most every 30 minutes per log), and a finish (`N/N` or a line starting `done` or `finished`) as a success. A log named `job-20260101-1200.log` belongs to job `job`.
- **No false alarms:** one finish logs once, whether the scanner or the grouper sees it first. A `■ stopped` row whose log ends with a finish line counts as done. A watched job whose log changed in the last 2 minutes counts as running, whatever process wrote it. `starting` is a step, not part of a job's name, and a job last seen starting with no progress is never logged as done.
- **Your own events:** `python3 ~/.claude/progress-bar/events.py add <level> <source> <title> [detail] [path]`, or append one line to the file yourself.

### Events format

`~/.claude-progress/events.jsonl`, one JSON object per line. Only the newest 2,000 lines are kept.

```json
{"ts": 1767225600, "level": "error", "source": "nightly-import", "title": "Nightly import crashed", "detail": "Traceback ...", "path": "/Users/me/logs/nightly-import.log"}
```

| Field | Does |
| --- | --- |
| `ts` | Epoch seconds |
| `level` | `error`, `warning`, `success` or `info` (anything else reads as `info`) |
| `source` | The job id or progress-file slug |
| `title` | A few plain words |
| `detail` | Optional. More lines, shown when the row is pressed |
| `path` | Optional. The log file, for `↗ open log` |

## Overnight recap

Save a checkpoint when you stop for the day. When you come back, the List tab of the Status panel opens with what happened while you were away.

```
☀ While you were away · since 6:40 PM (14h)
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
- **Status line:** the one-line summary ends with `☀ recap ready` while the recap shows.
- **Dismiss** moves the file to `~/.claude-progress/.state/overnight-YYYY-MM-DD.json` (the checkpoint's day) and hides the recap until the next checkpoint.

## Connectors

The **Connectors** tab of the Status panel lists each MCP connector with its status.

```
 List  │  ▌Connectors !2  │   GitHub

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
- **Open a connector:** press its name (marked `↗`) to open its web page. Google connectors open as the account in the accounts file (`?authuser=<email>`), so Gmail opens the right inbox. Add a third column, `name<TAB>account<TAB>https://...`, to set or change a connector's page.

```
# connector<TAB>account
Gmail	you@gmail.com
Google Drive	work@example.com
```

## GitHub tab

The **GitHub** tab of the Status panel shows the repo the session runs in.

```
 List  │   Connectors  │  ▌GitHub

‹  repo 1 of 2  ›

progress-bar-plugin  ↗
hunterZh37

● main   ↑0 ↓0   ✓ clean

OTHER BRANCHES  1
  ○ feature/x  ↓2

RECENT COMMITS
  Add the GitHub tab  2h
  First commit  3w

  click to open on GitHub · latest by Ann
  ↻ refresh
```

- **Click to open:** the repo name opens the repo, a branch opens `/tree/<branch>`, a commit opens `/commit/<sha>`. It runs `open` on macOS and `xdg-open` on Linux, and only ever for `https://github.com/` pages. A repo whose origin is not on GitHub still shows, but nothing opens.
- **Local git only:** reads `git -C <folder>` for the branch, changed files, the 8 most recent branches with ahead/behind and the 8 latest commits. No network and no token.
- **Credentials dropped:** a `https://user:token@github.com/...` remote becomes `https://github.com/owner/repo`. The token is never stored or shown.
- **When it reads:** on opening the tab, every 30 s while the tab shows and the pane is open, and on `↻ refresh`.
- **More repos (optional):** list folders in `~/.claude-progress/repos.txt`, one per line (`~` works, `#` starts a comment). The session's repo comes first. With more than one, `‹ ›` steps through them.

```
# one repo folder per line
~/code/api
/srv/site
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

Everything stays on your machine. The plugin reads and writes only files under `~/.claude-progress/`, `~/.claude/progress-bar/` and `~/.cache/progress-bar/`, and reads the `*.log` files in folders you list in `log-dirs.txt`, plus `~/Applications/ProgressBarToggle.app` if you run `setup mac-clicks`. The plugin makes no network calls itself. While the Status panel is open, the Connectors tab runs `claude mcp list`, which contacts your configured connectors to check them. The GitHub tab runs local `git` only, and opens a page in your browser when you click.

## License

MIT

## herdr Connectors pane

Using [herdr](https://github.com/herdrdev/herdr)? The `herdr/` folder is a herdr plugin that shows your Claude connectors in a narrow side pane (green ✔ connected, yellow ! needs sign-in, red ✖ failed), checked every 5 minutes.

```sh
herdr plugin install hunterZh37/progress-bar-plugin/herdr
```

Details in [herdr/README.md](herdr/README.md).
