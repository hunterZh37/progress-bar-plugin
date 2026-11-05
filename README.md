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
- **Your own tasks:** when Claude keeps a task list (TodoWrite, TaskCreate, TaskUpdate) in the main session, the list shows as one bar: done of total, with the item in progress as its title. No skill or instructions needed.
- **Long commands:** a Bash command that runs over a minute, or in the background, shows as a working row with its description until it ends.
- **Real bars:** a subagent or shell job that writes `~/.claude-progress/<slug>.json` gets a bar with percent, count and step.
- **Bars from logs:** a job that only writes a log (psql, a vendor tool, a remote job) gets a bar from a watch file: done/total read from the log by regex, an ETA, and `■ stopped` or `✖ error` when it dies or fails.
- **Skill:** `progress-reporting` tells Claude to write those files for multi-step work and to ask subagents to do the same.
- **Groups:** lines sort into **TO-DO**, **PROBLEMS**, **RUNNING**, **WAITING** and **DONE**. A job that ends shows as `finished 14:05` for 30 minutes, unless its progress file still exists. Duplicate rows of one job merge. A row is **DONE** only on `✔`, `100%`, or `· done` at the end (or `· done:`), so `done in 1h` stays RUNNING. `waiting`, `pending` and `waits for` go to **WAITING**.
- **Spinner and stuck rows:** each RUNNING row gets a spinner (and `in progress` when it has no step). A row whose numbers have not moved for 10 minutes shows a yellow `⚠ stuck 14m` instead and sorts first. An agent's tool count and a new step text count as movement, so a job working through a long step that keeps updating its step is not stuck. Change the 10 in `~/.claude-progress/.state/stuck-minutes`.
- **To-dos:** each project's own list shows first (see Per-project to-dos). Claude keeps it current. Number items to set their priority, and mark what waits on a running job.
- **Auto-next:** when a job finishes, the top ready to-do of its machine starts by itself (or is suggested, the default).
- **Links:** job names open their progress file, or a URL you set in `links.txt`.
- **Status line:** a small script prints all this above your existing status line.
- **Status panel:** an optional docked pane beside the chat with the same groups, foldable headers and a one-line status line.
- **Connectors:** a second tab in the panel shows which MCP connectors are connected, need sign-in or failed.
- **GitHub:** a third tab shows the session repo's branch, other branches and recent commits. Click one to open it on GitHub.
- **Titles and parents:** a progress file can name its job in plain words (`title`), say what it unlocks (`why`) and point at a parent job (`parent`). Each running job is one line with its short title, and a child shows under its parent.
- **Action needed:** a step only you can run (a deploy swap, a login, a blocked command) opens an **Action needed** pane inside Claude Code and holds your next prompt until it is done or skipped. **▶ Run** runs it for you in a new terminal window after you confirm. A read-only check clears it by itself.
- **Secure channel:** send `.md` files (and PDFs, images) straight to a collaborator's Claude Code session, end-to-end encrypted, through a private GitHub repo. No more dragging files into chat apps.
- **Log:** a fourth tab lists errors, warnings and finishes from `~/.claude-progress/events.jsonl`, written by the grouper and by a scanner for your own log folders. Unseen errors show as `!N` on the tab and `✖ N errors` in the status line.

## Install

```
/plugin install progress-bar --marketplace hunterZh37/progress-bar-plugin
```

That's it. Answer `y` to add the marketplace and pick a scope. From the next session on, the status line shows the bars and the Status panel opens beside the chat. No setup command, no settings to edit.

**Opt-outs** (in `/config`, under progress-bar):

- **Progress status line** off: the plugin leaves your status line alone.
- **Open the Status panel** off: the panel stays closed until you run `/progress-bar`. `/progress-bar panel off` does the same.

**What the first session does:**

- Writes `~/.claude/progress-bar/statusline.sh`, with `group.py` (grouping), `events.py` (the events log) and `checkpoint.py` (the overnight recap) beside it. They need only the system `python3`. Without it the lines print ungrouped.
- Points the status line at that script through the plugin, with `refreshInterval: 1` so bars move while Claude is idle. Your settings files are never edited.
- Keeps a status line you already had: the script runs it after the bars, with the session JSON on stdin, so its lines print below the groups. A settings file that already names the script is left as it is.
- Never chains another progress status line. A command that is this script, or names a script (read up to 64 KB) mentioning `.claude-progress/.lines` or `group.py`, is skipped, and an install that chained one drops it at the next start. If a chained status line still prints our section headers (`▾ ▶ RUNNING` and the like), the script drops its output. `group.py` also ignores lines it printed itself (headers, indented rows, `⚠ stuck` marks), so its seen state stays clean.
- If another plugin's `settings.read` hook answers first, this plugin's hook is skipped and the status line is not switched over. The Log tab says so once (until it works again), and the Status panel shows **▶ Turn on status line**. That button writes the `statusLine` into the settings file that holds the winning one (local, then project, else `~/.claude/settings.json`).
- Opens the Status panel. A terminal under 144 columns keeps it waiting, and a one-time toast says `Progress panel: /progress-bar`.
- Each later session start rewrites the scripts with the plugin's version, so updates need nothing either.

`/progress-bar setup` still writes the scripts by hand and prints the settings line, for a status line you manage yourself.

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
| `/progress-bar` | Shows the bars as text and opens the Status panel |
| `/progress-bar panel` | Opens the Status panel. It opens at every session start by default. `panel off` stops that, `panel on` turns it back on |
| `/progress-bar checkpoint [label]` | Saves the running jobs for the overnight recap. `away` does the same |
| `/progress-bar action` | Lists open actions. `action add`, `done [n]`, `skip [n] <reason>`, `copy [n]`, `check`. See Action needed |
| `/progress-bar inbox` | Lists what needs you from `~/.claude-progress/inbox.json`. `inbox setup` writes the example Gmail checker |
| `/progress-bar channel invite <github-user> [name]` | Opens an encrypted channel with a collaborator. See Secure channel |
| `/progress-bar channel join <owner> [name]` | Accepts a channel invitation |
| `/progress-bar send <file> to <name>` | Sends a file through a channel |
| `/progress-bar say <name> <text>` | Sends a short chat line through a channel. See Chat |
| `/progress-bar channel list\|read\|check\|leave` | Lists channels, lists received files, checks now, leaves a channel |
| `/progress-bar fold <section>` | Folds a section to one line. `unfold` opens it, `toggle` flips it |

## File format

`~/.claude-progress/<slug>.json`:

```json
{"done": 2, "total": 5, "step": "render pages", "startedAt": 1767225600000,
 "title": "Docs site · all pages", "why": "the public help pages", "parent": "release-prep",
 "session": "2f6c1e0a-7d4b-4e8f-9a1c-5b3d2e7f8a90", "cwd": "/Users/me/code/docs"}
```

Easiest: Claude calls the plugin's `progress_report` tool (title, why, done, total, step, parent, slug, finished). It writes this file with `session`, `cwd` and `startedAt` filled in.

| Field | Does |
| --- | --- |
| `done`, `total` | Draw the bar. Leave them out and the line says `working` |
| `step` | A few words on the current step |
| `startedAt` | Optional, ms. The file's time otherwise |
| `title` | Optional plain-language name. The job's line shows the part before ` · ` or `: `, and the open card shows the id and badge. The part before ` · ` names the job in the Log tab and in `waiting on:` |
| `why` | Optional. What the job unlocks, shown dim as `unlocks: …` |
| `parent` | Optional slug of the job this one is part of. While both run, this job shows under the parent's line when the parent is open, marked `↳` |
| `session` | Optional. The Claude Code session id (`$CLAUDE_CODE_SESSION_ID` in Bash). The job shows only in that session while it is open |
| `cwd` | Optional. The absolute folder the job works for. The job shows in every session of that folder's project (same project as Per-project to-dos) |

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

This project's list (see Per-project to-dos below), shown first in the status line:

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
Next up from the to-do list: <item>. Start it with a progress bar, and mark it done on the to-do list (/progress-bar todo done) once it runs.
```

- **Machine:** a `<host>: name` job, or a title that starts with a heading name (`Hunty CPU batch`), belongs to that heading. Any other job belongs to `[mac]` or `[local]`. `[you]` items never start on their own.
- **Mode:** `/progress-bar autonext on|off|ask`, saved in `~/.claude-progress/.state/autonext`. `on` sends the prompt. `ask` (the default) shows a toast and puts the prompt in the prompt box as a suggestion, so Tab starts it. `off` does nothing. The panel menu's `▶ Start` sends the same prompt for any ready item.
- **Caps:** `~/.claude-progress/.state/caps` holds one `machine=N` per line (default `mac=3`, `hunty=2`). A machine with N or more RUNNING rows waits, and the next one starts once a row finishes.
- **Once:** every open session checks every 5 seconds, and only one acts on a finish. It claims the finish with a folder under `~/.claude-progress/.state/autonext-claims/`, and holds the item for 6 hours so two finishes never start the same to-do. The session that ran the finished agent goes first. Others wait 20 seconds.
- **Per project:** a session starts items from its own project's list only.
- **Claude keeps it current:** the skill tells Claude to add items when work is queued or handed to you and to mark them done when finished.

## Per-project to-dos

Each session shows the to-dos of its own project, and only its own running and done jobs.

- **Which list:** the session's folder picks it. The git root above that folder, as a path under home, names the list: a session in `~/code/shop/web` uses `~/.claude-progress/todos/code-shop.txt`. A folder outside any repo uses its own path.
- **Map folders:** `~/.claude-progress/todos/projects.txt` holds `<path prefix><TAB><project>` rows. The longest prefix that holds the folder wins. A project ending `.txt` is a file under `~/.claude-progress`, so `todo.txt` keeps the old single list for those folders. Any other name means `todos/<name>.txt`.

```
# prefix<TAB>project
~/Desktop/NomBot	todo.txt
~/label-logs	todo.txt
~/code/shop/web	shop-web
```

- **New project:** with no file yet, the list is empty. The panel says `No to-dos for <project>. Add one with /progress-bar todo add`. The first add creates the file.
- **Everywhere:** the status line TO-DO, the Status panel, the to-do menu, `/progress-bar todo ...` and auto-next all use the session's list. A run with no folder (a script, a test) reads `todo.txt`.
- **Owned jobs:** a progress file with `session` shows only in that session. One with `cwd` (and no open `session`) shows in the sessions of that folder's project. A session writes these to `.lines/jobs-<session>.txt`. A `cwd` whose project has no open session falls back to `jobs.txt`.
- **Shared job lines:** progress files with neither go to `jobs.txt`. With no `~/.claude-progress/todos/lines.txt` (a fresh machine), `jobs.txt` shows in every session. With it, `jobs.txt` and other machines' files (like `linux.txt`) show only in sessions of the project it gives them to, as `<line file><TAB><project>` with the project named as in `projects.txt`. `echo all > ~/.claude-progress/.state/scope` shows everything everywhere again.

```
linux.txt	todo.txt
jobs.txt	todo.txt
```

- **Panel too:** the Status panel runs the status line script as its own session (its id and folder on stdin), so RUNNING and DONE match that session's status line.
- **Ended jobs per session:** `group.py` keeps the jobs each session saw in `.state/group-seen-<session>.json`, so a job another session shows never counts as finished here.
- **Inbox:** stays one list for every session.
- **Updates:** each session start rewrites the status line script and `group.py` with the plugin's version.

## Links

Job names link to their progress file when one exists. To send a job somewhere else, add `~/.claude-progress/links.txt`, one `<regex> | <url>` per line, matched against the job name:

```
^deploy | http://localhost:3000
import | file:///Users/me/logs/import.log
```

The first match wins. Clicking needs a terminal with link support (iTerm2, WezTerm, Kitty, Ghostty, VS Code).

## How it works

- The plugin lists subagents, counts their tool calls and reads the progress files.
- It writes subagent lines to `~/.claude-progress/.lines/agents-<session>.txt` (one file per open session, so sessions never overwrite each other), jobs this session owns (by `session` or `cwd`) to `jobs-<session>.txt` and the rest to `jobs.txt`. Each session's status line shows only its own bars: `agents-<session>.txt` and any `.lines/*-<session>.txt` file. Shared files such as `jobs.txt` show only in the project `todos/lines.txt` gives them to, everywhere when there is no `lines.txt`, or everywhere after `echo all > ~/.claude-progress/.state/scope`. Each session's claims file (`.state/claims-<session>.txt`) names its project on its first line, so other sessions know where a `cwd` job shows. At most 6 lines each. A JSON file counts as a job only if it has `done` and `total` or a `step`, so data files like `inbox.json` and `actions.json` never show as jobs. The grouper also drops an `inbox` row that an older plugin build in another session still writes. A machine status row with `helper healthy` (like `<host> ✓ helper healthy · load 0.22 on 12 cores · idle`) shows under DONE with no bar, since it is not a job.
- The status line script prints every `.lines/*.txt` file changed in the last 2 minutes. Other tools can drop their own lines there too.
- `group.py` sorts those lines into sections, adds the to-dos and links, and remembers ended jobs in `~/.claude-progress/.state/group-seen-<session>.json`.
- With `events.py` beside it, `group.py` logs done, stuck and problem rows once each to `~/.claude-progress/events.jsonl` (sent keys in `.state/events-sent.json`) and starts a log folder scan in the background at most every 30 seconds (offsets in `.state/log-offsets.json`).

## Status panel

On by default. Shows the full groups in a docked pane named **Status**, and shrinks the status line to one summary line. `/progress-bar panel off` turns it off, `/progress-bar panel on` back on.

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

- **Runs the script:** the panel runs `~/.claude/progress-bar/statusline.sh` with `PB_FULL=1` every second while it is open. The first session writes that script, and `panel on` refreshes it and `group.py` and keeps your chained status line.
- **Never blank:** when the script fails, or prints nothing but an error, the panel shows the reason (for example `Status script failed (exit 1): <first stderr line>`). A pane that cannot draw says why instead of nothing.
- **Fold:** press a header, or its hotkey (`1` to-do, `2` running, `3` done, `4` waiting, `5` problems). It writes `~/.claude-progress/.state/folded.txt`, the same file `/progress-bar fold` uses.
- **On by default:** the first session writes `~/.claude-progress/.state/panel-on`. With that file the pane opens at session start and the status line prints the summary. `panel off` deletes it, writes `.state/panel-off` so the default never turns it back on, and closes the pane. `panel on` undoes that. With **Open the Status panel** off in `/config`, nothing is written and `/progress-bar` opens it once.
- **To-do menu:** click a to-do for Done, Up, Down, Start (a ready machine item), Delete or Move back to to-do (a checked-off one). It edits this project's list, on the line that still holds that item's text, so a line added since the panel drew never hits the wrong item. TO-DO lists open items only. Checked-off ones move to DONE under **Checked-off to-dos**, after finished jobs, and count there.
- **Rows:** to-dos one per line under each owner, running jobs one line each, a press opening the details (see **Running cards**), done jobs dimmed with their finish time.
- **Tabs:** `▌List  │   Connectors  │   GitHub  │   Log`, the shown one marked `▌`. **List** (the default) shows the sections above. **Connectors** shows your connectors, its label adding `!N` when N need attention. **GitHub** shows your repos. **Log** shows the events log, its label adding `!N` for unseen errors.

## Running cards

Each RUNNING job in the Status panel is one line: title, bar, percent and time left. The bars line up in one column. Press a title to open its card with the details, press it again to close it.

WAITING jobs use the same one-line card, with a dim yellow `⏸` in place of the spinner and a dim `waiting: <reason>` note (the text after "waiting on" or "waiting" in its step), cut with `…` so the line never wraps. Press it for the same details card. Machine labels (`Mac:`, `Hunty:`) show there too.

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
⚠ ▸ Nightly import           ████████░░  80%  ⚠ stuck 14m

Claude Max this week  ██████░░░░  62% used
```

- **Max meter:** `Claude Max this week` reads `Max 7-day used N%` (or `7d N%`) from running lines. With no job reporting it, the last reading stays for up to 7 days with its time, like `22% used · as of 12:39` (saved in `~/.claude-progress/.state/max-usage.json`).
- **Count:** the RUNNING header counts top-level lines and notes nested ones, as `RUNNING  4 (+3 sub-jobs)`.
- **Machine:** each line starts with its machine, like `Hunty: Similar orgs` or `Mac: Health care`. Remote machines come from `<host>: name` rows and the to-do headings. The local one is the `[mac]` or `[local]` heading. With no remote machine, lines show the plain title.
- **Line:** a mark, `▸ <short title>`, a 10-cell bar, the percent, then one dim note: `N left`, the run time, `Nm so far`, `waiting on X`, or a yellow `⚠ stuck Nm`. The note is cut with `…` to fit; the bar never wraps. A job that reports steps but no time left (an agent) shows an estimate, `~Nm left`, from its time so far per step done.
- **Short title:** `title` from the progress file or `titles.txt`, cut at ` · ` or `: `. A remote job keeps `<host>: name` whole. Without a title the job id is used.
- **Aligned bars:** the title column is 14 to 34 characters wide by pane width, keeping 13 columns for the note (fewer in a pane under 37). Longer titles end in `…`.
- **Open card:** the job id and kind badge, `a of b steps` (or `batches`, or `steps not reported`), `▸ step`, the facts and `unlocks: …`. It never repeats the percent or the time left. Open cards stay open while the session runs.
- **Children:** a job whose `parent` is also running shows under the parent's line, marked `↳`, only while the parent is open. One level only: a parent that has a running parent of its own keeps its own line.
- **Remote jobs:** a `<host>: name` job without a `parent` nests under the one running job whose id starts with `<host>-` (such as `gpu-box: train.py` under `gpu-box-train`). With none or several such jobs it keeps its own line.
- **Waiting on:** a parent whose numbers have not moved is not stuck while a child runs or changed in the last 10 minutes. Its line reads `waiting on <child title>` instead of `⚠ stuck`. The grouper does the same in the status line.
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

## Inbox

Shows what needs you, such as emails waiting on your reply, first on the List tab and in the status line.

```
✉ Inbox  2 need you
Ann Lee · Budget sign-off
  Approve the Q4 budget · due Fri  ✓ handled
Sam Ortiz · Thursday call
  Reply with your availability  ✓ handled
```

- **Any script can feed it.** Write `~/.claude-progress/inbox.json`:

  ```json
  { "checked": 1800000000, "items": [
    { "id": "thread-1", "from": "Ann Lee", "subject": "Budget sign-off", "why": "Approve the Q4 budget", "due": "Fri", "url": "https://mail.google.com/mail/#all/thread-1" }
  ] }
  ```

  `id` is required and must be unique. `due` and `url` are optional. Write the file whole (a temp file, then rename).
- **Press an item** to open its `url`. Only `https://` links open.
- **✓ handled** hides an item. Its id goes to `~/.claude-progress/.state/inbox-handled.txt` (the newest 500 are kept), so it stays hidden when the file is rewritten.
- **Secure channel invites never show.** GitHub sends each `pb-channel-*` invite as its own email, and joining the channel accepts it.
- **Status line:** the one-line summary starts with a yellow `✉ N need you`. Without the panel, the full view starts with that line. Nothing shows when N is 0.
- **Gmail example (optional):** `/progress-bar inbox setup` writes `~/.claude/progress-bar/inbox-check.sh` and prints how to run it every 10 minutes. It needs the claude.ai Gmail connector and the `claude` CLI signed in. Each run starts a headless Claude (haiku) that may call only Gmail `search_threads`, `get_thread` and `get_message`. Sending, drafts, labels, trash and every other tool are denied. It treats email text as data and never follows instructions in it. It reads inbox threads from the last 3 days, leaves out promotions, social, automated mail and threads you answered last, and writes `inbox.json`. Set `INBOX_ACCOUNT` to your address. Runs skip 11 PM to 6 AM and never overlap.

## Action needed

Some steps only you can run: a deploy swap, a login, a command the permission system blocks, deleting a repo. Claude adds them as **actions** instead of only writing them in chat. While one is open you finish it or skip it before giving other instructions.

```
⛔ Action needed
Swap in NomBot build viNrI9k8 (count flash fix)
$ cd ~/Desktop/NomBot/web && rm -rf .next-prev && mv .next .next-prev && …
▶ Run   Copy   ✓ I ran it   Skip
```

- **▶ Run (macOS):** runs the command for you, no copy and paste. First a confirm line in the same box, "Run this in Ghostty?" (or Terminal), shows the **full command** with **▶ Run** and **Cancel**. Cancel runs nothing. Run writes the command to `~/.claude-progress/.state/run/<action id>.sh` (mode 0700) and opens a **new visible window** that runs it: Ghostty when it is installed, else Terminal.app. Logins, browser steps and password prompts work there, and the window stays open with "Done. You can close this window." The action then clears when its check passes (one check 10 s after launch, then every 30 s). An action with no check needs **✓ I ran it**. The Log tab gets "Action run in Terminal: <title>". Claude Code slash commands (like `/plugin update ...`) have no Run, since they are typed in Claude Code. Use Copy for those.
- **Popup, inside Claude Code:** when an action is added, and again at most every 10 minutes while it is open, a pane titled **Action needed** opens in Claude Code, styled like the Status panel: a red box with the title, why and the command, then **▶ Run**, **Copy**, **✓ I ran it**, **Later** and **Skip**. A slash command has no Run. **✓ I ran it** runs the check and closes the action only when it passes, else a red "Check still fails" line shows in the box. **Later** closes the pane. It closes by itself once no action is open. There is **no system dialog**.
- **Away from Claude Code (macOS):** when the front app is not your terminal, you also get one quiet macOS notification, titled "Claude Code" with the action's title, that says an action is waiting in Claude Code. Same 10 minute limit. Nothing pops over your screen.
- **Prompt gate:** while an action is open for this session's project (or for every project), a prompt you type is held and you see the action, its command and how to go on:
  - `done` runs the check and clears the action when it passes. An action with no check clears at once.
  - `skip <reason>` clears it and logs a warning with your reason.
  - `/progress-bar action list` shows every open action.
  
  Slash commands always pass, so `/progress-bar ...` and `/plugin ...` keep working. Task notifications and messages from other sessions pass too. Your held message comes back in the prompt box once the last action is done.
- **Auto-clear:** checks run every 30 s, and again before a prompt is held (5 s timeout each). Run the command in any terminal and the action clears by itself with a toast "Action done: <title>".
- **Status panel:** the same red box at the very top of the List tab with **▶ Run**, **Copy**, **✓ I ran it** and **Skip**.
- **Status line:** the summary starts with a red `⛔ N actions needed`. Without the panel, the full view starts with that line.
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
   "project": "desktop-nombot", "status": "open" }]
```

`id`, `title` and `status` matter. `command`, `check` and `project` are optional. No `project` means every project. Closed actions keep `status` `done` or `skipped`, a `skipReason` and `closed`. The newest 50 closed ones are kept.

**Safety.**

- The plugin **never runs an action's `command` on its own**. Only you do, by hand or with **▶ Run**, which always asks first with the full command. Claude has **no tool or command for Run**, so it can never press it. Copy hands the command to `pbcopy` on stdin.
- Run hands the command to the script file on stdin, never through a shell string or AppleScript. The terminal AppleScript is fixed and gets only the script's path as an argument.
- It runs only `check`, with `/bin/sh` in your home folder, 5 s at most. A check must be a **read-only test** that exits 0 once the step is done, such as `grep -q`, `test -e`, `gh repo view`. Never put a command that changes anything in `check`.
- The notification text goes to `osascript` as arguments. The AppleScript source is fixed, so nothing in a title or command is ever read as AppleScript.
- Actions hold commands, **never secret values**. Write the command that fetches or logs in, such as `gh auth login`, never a token or a password.
- Commands and checks come from Claude or scripts on this machine. They are shown as text and quoted as text.

## Secure channel

Send files between two people's Claude Code sessions. Say "send this plan to Sam" in the chat, and it lands in Sam's Status panel within seconds.

```
✉ Channel  1 new
sam · launch-plan.md  ✓ read
```

### Setup

You (the inviter), once per collaborator:

```
/progress-bar channel invite <their-github-user> sam
```

This creates a private repo `<you>/pb-channel-<you>-<them>` and GitHub emails them an invitation. Add `--as <your-github-user>` when `gh` is logged in to several accounts (it is remembered).

Your collaborator, in 2 steps:

1. Install the plugin: `/plugin marketplace add hunterZh37/progress-bar-plugin`, then `/plugin install progress-bar@progress-bar`, then restart Claude Code.
2. Run `/progress-bar channel join <your-github-user>` (with `--as <their-github-user>` if they have several `gh` accounts). There is no need to click the email: join accepts the invitation.

Then either side sends:

```
/progress-bar send notes/launch-plan.md to sam
```

Or just tell Claude "send this to Sam". The `secure-channel` skill has Claude call the plugin's `channel_send` tool, and Claude Code asks you before it runs.

### Receiving

- Every open session checks each channel every 3 seconds (one check at a time across sessions). When nothing changed, GitHub answers 304 (no rate limit cost).
- A new file is verified, decrypted and saved to `~/.claude-progress/channel/<name>/<file>`. It never overwrites: a second `plan.md` becomes `plan-2.md`.
- It shows in the Status panel List tab as `✉ Channel  N new`. Press a file to open it with your default app. **✓ read** hides it (`~/.claude-progress/.state/channel-read.txt`).
- The status line shows a cyan `📨 N new`, kept apart from the inbox `✉ N need you` because a received file is not a task.
- The Log tab gets `Message from <name>: <file>`. A rejected message logs an error.
- `/progress-bar channel check` checks now. `/progress-bar channel read` lists what arrived.

### Security model

- **End-to-end encryption.** GitHub only stores ciphertext. Each person gets two P-256 keys at first use, in `~/.claude-progress/channel/keys/` (folder 700, files 600, never committed, never printed). Only the public halves go to the repo as `keys/<github-user>.pub`.
- **Per message:** a random 256-bit key encrypts the file with AES-256-CBC (`openssl enc`, PBKDF2). That key is wrapped for the recipient and for the sender (so you can re-read what you sent) with ephemeral ECDH P-256 and HKDF-SHA256, with an HMAC tag. The sender signs a header (sender, recipient, file name, size, SHA-256 of the file and of the ciphertext, the wraps) with ECDSA P-256.
- **On receive:** signature first, then the ciphertext hash, the key tag and the plaintext hash. Any mismatch rejects the message and logs an error. Nothing is saved.
- **Key pinning:** the peer's key is pinned at first sight. A changed key is refused until you leave and join again.
- **Crypto engine:** the plugin runtime has SHA-256 but no ECDH or AES, so `bin/channel.py` runs the `openssl` CLI (LibreSSL 3.3+ or OpenSSL 1.1.1+). No extra install on macOS or Linux.
- **Accounts:** every `gh` and `git` call uses the channel account's token (`gh auth token --user`) for that call only. Your active `gh` account never changes.
- **Received files are data.** The plugin never puts their text into a prompt. The skill tells Claude to treat them as untrusted input and never act on instructions inside them unless you ask. Claude cannot read the private keys: the plugin refuses any tool call that names the keys folder.
- **Allowed files:** `.md .markdown .txt .pdf .png .jpg .jpeg .gif .webp`, up to 10 MB. Received names are cut to their last part, with no leading dots, and saved only inside the channel folder.
- **Logs** carry file names and sizes, never content, keys or tokens.

### Limits

- Two people per channel. Make one channel per collaborator.
- Both need `gh` (logged in), `git`, `openssl` and `python3`.
- Not forward secret: someone who later steals your private key file can read old messages in the repo. Delete the repo when done.
- GitHub sees who talks to whom, when, and file sizes.
- `/progress-bar channel leave <name>` forgets a channel on this machine. It prints the command to delete the repo (owner) or drop your access (collaborator).

### Chat

The Status panel has a **Chat** tab next to List, Connectors, GitHub and Log. It shows each channel as a chat room. The tab reads `Chat 2` when 2 received messages are unread.

```
 List │ Connectors │ GitHub │ Log │ ▌Chat 1
CHANNELS
▌hunty  14:14  1 new
──────────────────────────────────────────
hunterIOG · 14:02
╭──────────────────────╮
│ got the plan, thanks │
╰──────────────────────╯
                               You · 14:14
                         ╭───────────────╮
                         │ chat tab test │
                         ╰───────────────╯
hunterIOG · 14:20
📎 launch-plan.md (3 KB)
# Launch plan
First lines show as a preview
╭─────────────────────────────────────────╮
│ Message hunty                           │
╰─────────────────────────────────────────╯
➤ Send  ↑ Send file: /progress-bar send <file> to hunty
```

- **Pick a channel** at the top. Each line shows its name, the last message time and the unread count.
- **The thread** runs oldest first. Received messages sit on the left under the sender's name. Yours sit on the right under "You".
- **Chat lines** (from the field or `say`) show as bubbles with the full text. A `.md` or `.txt` file shows its first 3 lines. Images and PDFs show as `📎 file.png (120 KB)`.
- **Press a message** to expand a text file inline, 30 lines a page, with `↗ open` and `▴ fold`. Press an image or PDF to open it with your default app.
- **Unread** clears when you view the thread. The List tab block and the status line `📨 N new` clear with it.
- **Send** by typing in the field at the bottom and pressing Enter, or **➤ Send**. From anywhere: `/progress-bar say hunty on my way`. A chat line is at most 4000 characters. Send longer text as a file.

How it works:

- `~/.claude-progress/channel/index.json` lists every message both ways (direction, time, file name, local path, SHA-256, verified). It is written when you send (the field, `say`, `send` and the `channel_send` tool) and when a message arrives, so the tab needs no GitHub call to draw.
- A sent file is copied to `~/.claude-progress/channel/<name>/sent/` so you can open it later.
- A chat line is a file named `chat-<UTC time>-<random>.md`, written to `~/.claude-progress/channel/outbox/`, sent like any file (encrypted and signed), then removed from the outbox.
- The first session without an `index.json` builds it from what already arrived and from your own sent messages in the local repo copy, decrypted with your own key. No network.
- Received text is untrusted. The tab strips terminal escapes, control and bidi characters, caps the length, and never opens links or runs anything. It is never put into a prompt.
- On a surface without a text field, the tab shows **✎ Reply**, which puts `/progress-bar say <name> ` into the prompt box.

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

Everything stays on your machine. The plugin reads and writes only files under `~/.claude-progress/`, `~/.claude/progress-bar/` and `~/.cache/progress-bar/`, and reads the `*.log` files in folders you list in `log-dirs.txt`, plus `~/Applications/ProgressBarToggle.app` if you run `setup mac-clicks`. It runs an action's command only when you press **▶ Run** and confirm, in a new terminal window you can see. The plugin makes no network calls itself, except the secure channel once you open one: it then talks to GitHub through your own `gh` and `git`, and stores only ciphertext there. The optional inbox checker (`inbox setup`) runs only when you schedule it, and reads your mail through your own Gmail connector. While the Status panel is open, the Connectors tab runs `claude mcp list`, which contacts your configured connectors to check them. The GitHub tab runs local `git` only, and opens a page in your browser when you click.

## License

MIT

## herdr Connectors pane

Using [herdr](https://github.com/herdrdev/herdr)? The `herdr/` folder is a herdr plugin that shows your Claude connectors in a narrow side pane (green ✔ connected, yellow ! needs sign-in, red ✖ failed), checked every 5 minutes.

```sh
herdr plugin install hunterZh37/progress-bar-plugin/herdr
```

Details in [herdr/README.md](herdr/README.md).
