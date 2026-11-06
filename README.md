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
- **Status panel:** an optional docked pane beside the chat that anyone can read at a glance: the goal on top (`Making the generosity database better`), then TO-DO, RUNNING, WAITING and DONE, each row with the area it improves under its title (see **Goal view**). The status line shrinks to one line.
- **Area and gains:** a job says which part of the goal it improves (`area`) and which of cost, quality, speed it makes better (`gains`), so the panel can group it and tag it.
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
 "session": "2f6c1e0a-7d4b-4e8f-9a1c-5b3d2e7f8a90", "cwd": "/Users/me/code/docs",
 "area": "Tools", "gains": {"speed": "help pages build in 2m instead of 9m"},
 "impact": "Docs rebuilt: 412 pages\nSearch index 18% smaller"}
```

Easiest: Claude calls the plugin's `progress_report` tool (title, why, done, total, step, parent, slug, reads, writes, area, gains, impact, finished). With `finished: true` it saves the done record (below) and removes the file. It writes this file with `session`, `cwd` and `startedAt` filled in.

| Field | Does |
| --- | --- |
| `done`, `total` | Draw the bar. Leave them out and the line says `working` |
| `step` | A few words on the current step |
| `startedAt` | Optional, ms. Otherwise the file's birth time, else when the plugin first saw it |
| `title` | Optional plain-language name. The job's line shows the part before ` · ` or `: `, and the open card shows the id and badge. The part before ` · ` names the job in the Log tab and in `waiting on:` |
| `why` | Optional. What the job unlocks, shown dim under its row (`unlocks: …` in an opened DONE row) |
| `parent` | Optional slug of the job this one is part of. While both run, this job shows under the parent's line when the parent is open, marked `↳` |
| `session` | Optional. The Claude Code session id (`$CLAUDE_CODE_SESSION_ID` in Bash). The job shows only in that session while it is open |
| `cwd` | Optional. The absolute folder the job works for. The job shows in every session of that folder's project (same project as Per-project to-dos) |
| `reads`, `writes` | Optional short strings for the Topology tab: what the job reads and writes, like `nombot.board_members_history` or `Postgres via work-mac`. Without `reads` a job on a helper machine reads from the data host's database. Without `writes` it is not drawn writing anything |
| `area` | Which part of the goal the job improves, by name, from `~/.claude-progress/goal.json` (see **Goal view**). Example: `Boards & people`. Set it on every job. Without it the panel guesses from keywords in the title, why and impact, else `Other` |
| `gains` | Optional. What the job makes better, by lens: any of `cost`, `quality`, `speed`, each a short plain line with a number when possible. Example: `{"quality": "1.65M more board seats counted", "speed": "labels in 7h instead of 12h", "cost": "$14 of Jev instead of 34h of Claude"}`. Name only the ones that apply |
| `impact` | Optional, set it before the job ends. How the job made things better: what the data or product now has or gets right, with the key number, one to three short lines (a string with newlines, or a list). Skip commit ids and file names. Example: `1.65M more board seats, so board links and people search see whole boards`. Shown when its DONE row is opened |

- **Slug:** the job or subagent description, lowercased, each run of other characters turned into `-`. `Build docs!` becomes `build-docs`.
- **Name the improvement.** A `title` says what gets better, not how: `Every board member counted, not just 25` rather than `Board lists past 25 seats`. The `impact` answers how it is better now.
- **Delete the file when done.** Files older than 10 minutes are hidden. Write `impact` first and give it 5 seconds (one poll) before you delete the file, or call `progress_report` with `finished: true` and `impact`.
- **Done records:** when a job's file is gone, or it first reports `done` equal to `total`, the plugin saves `~/.claude-progress/.state/done/<slug>.json` with its `title`, `why`, `impact`, `area`, `gains`, `step`, `started`, `finished`, `machine` and `session`. The last 100 are kept, none over 7 days old. A file that is only stale (still there) is not a finish. Shell command rows (`shell-*`) keep none.
- **Agents:** a subagent's impact is its final report, cut short: its `SubagentHandback` message, else its last text in its transcript (read at SubagentStop). The first bold sentence (4 words or more, not a label ending in `:`), else its first 2 to 3 lines, as plain text up to 300 characters. An `impact` in its own progress file, or one `progress_report` saved in the last 30 minutes, wins.
- **Jobs that can't write the file** (a log-only job, a row from another tool) get the same fields from `~/.claude-progress/titles.txt`, one job per line, tab separated: `<job id><TAB><title><TAB><why><TAB><parent><TAB><area>` (area optional). The job id is the name the row shows. Empty columns are fine, `#` starts a comment. A progress file's own fields win.

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
- **Priority:** a leading `N. ` sets an item's place under its heading, `1.` first. Unnumbered items come after the numbered ones, in file order. The status line and the Status panel list items in this order. The panel numbers every item by its place, `1.` to `N.` in bold cyan, whether or not the file numbers it.
- **Blocked items:** an item ending `(after X)` waits while any RUNNING job's name or title holds every key word of X (case does not matter, small words like "the" are skipped). `(after 2019-20 load)` waits on `Load 2019-20 filings`. A blocked item shows dim. The Status panel hides the `(after X)` text and adds one dim `waits for <job>` line under the items that wait on that job.
- **Next:** the top ready item of each machine heading (any heading but `[you]`) is marked: `next` in the status line, a green `▶` in the Status panel.
- **Move up and Move down:** in the Status panel, press an item and pick `↑ Up` or `↓ Down`. Every open item under that heading is renumbered `1.` to `N.` in the new order. The item is found by its text, never by line number.

### Auto-next

When a RUNNING job finishes (a `<job> done` event in `events.jsonl`, logged once per finish by the grouper), the plugin picks the top ready to-do of that job's machine, plus any machine with an item that was waiting for that job, and asks Claude to start it with this prompt:

```
Next up from the to-do list: <item>. Start it with a progress bar, and mark it done on the to-do list (/progress-bar todo done) once it runs.
```

- **Still running:** a blocker counts as running while its progress file is fresh and has not reached `done` equal to `total`, even when its row says starting or its bar rounds to 100% during a last step. So an `(after X)` item never starts early.
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

- **New project:** with no file yet, the list is empty. The panel shows no TO-DO section and `/progress-bar todo` says `No to-dos for <project>`. The first add creates the file.
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
- It writes subagent lines to `~/.claude-progress/.lines/agents-<session>.txt` (one file per open session, so sessions never overwrite each other), jobs this session owns (by `session` or `cwd`) to `jobs-<session>.txt` and the rest to `jobs.txt`. Each session's status line shows only its own bars: `agents-<session>.txt` and any `.lines/*-<session>.txt` file. Shared files such as `jobs.txt` show only in the project `todos/lines.txt` gives them to, everywhere when there is no `lines.txt`, or everywhere after `echo all > ~/.claude-progress/.state/scope`. Each session's claims file (`.state/claims-<session>.txt`) names its project on its first line, so other sessions know where a `cwd` job shows. At most 6 lines each. A JSON file counts as a job only if it has `done` and `total` or a `step`, so data files like `inbox.json`, `actions.json` and `topology.json` never show as jobs. The grouper also drops an `inbox` row that an older plugin build in another session still writes. A machine status row with `helper healthy` (like `<host> ✓ helper healthy · load 0.22 on 12 cores · idle`) is not a job. It prints as one `machine <host> ...` line after RUNNING (in the Status panel, a small dim line under the tabs), never under DONE. The helper that writes it decides `idle` from the machine's load, so while a `<host>: ...` job runs or waits the line reads `busy: N jobs running` instead (busy `N% CPU` processes count only when no job does).
- The status line script prints every `.lines/*.txt` file changed in the last 2 minutes. Other tools can drop their own lines there too.
- `group.py` sorts those lines into sections, adds the to-dos and links, and remembers ended jobs in `~/.claude-progress/.state/group-seen-<session>.json`.
- With `events.py` beside it, `group.py` logs done, stuck and problem rows once each to `~/.claude-progress/events.jsonl` (sent keys in `.state/events-sent.json`) and starts a log folder scan in the background at most every 30 seconds (offsets in `.state/log-offsets.json`).

## Goal view

The List tab answers one question for anyone who looks at it: how is each task making the goal better? One line names the goal, then the sections, most urgent first. Each row is its title on one line and `<Area> · <why or impact>` dim under it.

```
Making the generosity database better · 6 done today · 4 running

▾ RUNNING  4
  ◑ Places for more orgs                   ━━━━━─────  50%
    Places · Know where more orgs serve, beyond today's 77K, so near-me…
  ◑ Label top-ups 2021-23                  ━━━━━━━━━━  96%  59m left
    Causes · Cause labels for orgs added by the 2021-23 IRS load

▾ DONE  8
  ✓ Grants credited to the org that got them  13:26
    Grants · $18.1B of grants no longer credited back to the funder
    +3 more
```

- **Four levels:** the anchor is the one bold colored line. Section headers are bold and uppercase with a dim count. Row titles are plain and bright. Second lines are dim, under the title text, with the area word a step brighter. Never more than one blank line.
- **Anchor:** the goal, then done today and running, the counts that are not zero, on one line cut to the pane.
- **Sections:** PROBLEMS, TO-DO (per machine, priorities, blockers, the menu), RUNNING, WAITING, DONE. Headers have no hotkeys. Folding works as before. DONE shows the latest 5 in time order, then `+N more`. Inside RUNNING and WAITING, rows cluster by area in the goal's order, `Other` last. To-dos keep their priority order.
- **Gutter:** the status mark (`◐ ⏸ ✓ ⚠ ↳`) sits in one column and the title in the next. Nothing else uses those columns.
- **Running rows:** the title, a thin bar and the percent, lined up at the right, then time left or a stuck note when there is one (`59m left`, `⚠ stuck 14m`).
- **Second line:** `<Area> · <why>` for running jobs, `<Area> · <why it waits>` for waiting ones, `<Area> · <impact>` for done ones. It is one line, cut with `…` to fit, never wrapped. Press the row's title and that same line shows in full, wrapped.
- **Plain titles:** the title is the improvement, with its machine left out (`Hunty grants linked to own filer` reads `Grants linked to own filer`).
- **Opened card:** press a title. A running or waiting job shows its step (or what it waits on, or its count), its machine and its time. A done job shows the rest of its impact, finish and run time with its machine, and what it unlocked. Gains a job named show here, `quality: 1.65M more board seats counted`.
- **Lenses:** cost, quality and speed show only in an opened card, from the job's `gains`. A job that named none shows its likely lens from its title and why, `likely improves: speed`, so every card says which of the three it helps.
- **Machines:** the helper machine lines live on the Topology tab, not the List tab.
- **No emoji:** the panel and status line use words and single-width symbols only (`✓ ▸ ▾ ◐ ━ ┄ ⏸ ▶ ○ ·`), so every terminal draws them the same.

### goal.json

`~/.claude-progress/goal.json` sets the anchor, the areas and the lenses for you. The panel writes the defaults the first time and never overwrites the file, so edit it freely:

```json
{
  "anchor": "Making the generosity database better",
  "areas": [
    {"id": "organizations", "name": "Organizations", "tag": "Orgs", "keywords": ["duplicate", "merge", "ein", "ntee"]},
    {"id": "boards", "name": "Boards & people", "tag": "Boards", "keywords": ["board", "people", "person", "seat"]}
  ],
  "lenses": [
    {"id": "cost", "name": "cost", "keywords": ["$", "cost", "cheaper", "saved"]},
    {"id": "quality", "name": "quality", "keywords": []},
    {"id": "speed", "name": "speed", "keywords": ["faster", "hours", "minutes"]}
  ]
}
```

- **Defaults:** Organizations (who exists, duplicates, NTEE), Finances (returns, trends, flags), Boards & people, Grants (who funds whom), Places (where orgs serve), Causes (cause labels), Answer quality (NomBot answers, evals), Tools (plugin, infra, setup).
- **Matching:** a job's `area` matches an area's id or name, any case, or the start of a name (`Boards` finds `Boards & people`). A name that matches none becomes its own area. Without `area`, each keyword found as a whole word or its plural (`person` finds `persons`, not `personal`) counts 2 in the title and 1 in the why, impact or step. The top score wins, ties go to the area listed first.
- **Tags:** `tag` is the short word on second lines (`Orgs`, `Boards`, `Answers`), up to 8 letters. Without one, a default area keeps its default tag and any other takes its name's first word. An `icon` from an older file is read and ignored.
- **Lenses:** the three ids are fixed (`cost`, `quality`, `speed`). Change their names or the words that infer them.
- `goal` is a data file name, so no progress file or `progress_report` slug may take it.

## Status panel

On by default. Shows the full groups in a docked pane named **Status**, and shrinks the status line to one summary line. `/progress-bar panel off` turns it off, `/progress-bar panel on` back on.

```
List  Connectors  GitHub  Log  Chat  Topology

Making the generosity database better · 1 done today · 1 running

▾ RUNNING  1
  ⚠ Nightly import                   ━━━━━━━━──  80%  ⚠ stuck 14m
    Tools · the morning dashboard

▾ TO-DO  2
    You  2
  ○  1. Review the deploy PR
  ○  2. Sign in to the dashboard

▾ DONE  1
  ✓ Docs site  11:27
    Tools · Docs rebuilt: 412 pages
```

The status line then reads:

```
▶ 2 running · ⚠ 1 stuck · ✖ 1 error · ☐ 3 to-do · full view in the Status panel
```

`✖ N errors` shows only while the Log tab has unseen errors.

- **Runs the script:** the panel runs `~/.claude/progress-bar/statusline.sh` with `PB_FULL=1` every second while it is open. The first session writes that script, and `panel on` refreshes it and `group.py` and keeps your chained status line.
- **Never blank:** when the script fails, or prints nothing but an error, the panel shows the reason (for example `Status script failed (exit 1): <first stderr line>`). A pane that cannot draw says why instead of nothing.
- **Fold:** press a header. Headers have no hotkeys, so no `1:` number prefixes clutter the panel. It writes `~/.claude-progress/.state/folded.txt`, the same file `/progress-bar fold` uses.
- **On by default:** the first session writes `~/.claude-progress/.state/panel-on`. With that file the pane opens at session start and the status line prints the summary. `panel off` deletes it, writes `.state/panel-off` so the default never turns it back on, and closes the pane. `panel on` undoes that. With **Open the Status panel** off in `/config`, nothing is written and `/progress-bar` opens it once.
- **To-do menu:** click a to-do for Done, Up, Down, Start (a ready machine item), Delete or Move back to to-do (a checked-off one). It edits this project's list, on the line that still holds that item's text, so a line added since the panel drew never hits the wrong item. TO-DO lists open items only. Checked-off ones move to DONE under **Checked-off to-dos**, after finished jobs, and count there.
- **Rows:** each with its area word, clustered by area (see **Goal view**). To-dos one per line under each owner, running jobs a line and a dim why each, a press opening the details (see **Running cards**), done jobs with their finish time and impact (see **Done rows**).
- **Status line on:** after **▶ Turn on status line**, the answer (`Status line on: ...`) shows for 3 minutes, then clears.
- **Tabs:** words, `List  Connectors  GitHub  Log  Chat  Topology`. The shown tab is bold cyan, the others dim. Connectors adds `!N` when N need attention (`Connectors !2`), Log adds `!N` for unseen errors, Chat adds the unread count (`Chat 3`). In a pane too narrow for the full names they shorten to `List  Conn  Git  Log  Chat  Topo`. **List** (the default) shows the goal view above. **Connectors** shows your connectors, **GitHub** your repos, **Log** the events log, **Topology** your machines.

## Done rows

Each finished job under DONE is a button, `✓ <title>  11:27`, with `<Area> · <impact>` dim under it, one line. The title comes from its done record, else its progress file or `titles.txt`, else its id made readable (`hunty: hunty-board-cap-extract` reads `Hunty: Board cap extract`). Press it to open what it changed:

```
  ✓ Board links rebuild  11:50
    Boards · Board links rebuilt: 1.29M pairs, 109K split people merged
    50/50 merges right
    finished 11:50 · ran 1h20m · machine: Mac
    unlocks: people pages
```

- **Impact:** the job's `impact` lines, or an agent's short report, each wrapped under its indent. The first line shows before the row is opened, and again in the card only when the row had to cut it. `no impact reported` when there is none. Named `gains` follow as `quality: …`.
- **Time and machine:** `finished HH:MM · ran 1h20m` from the record's `started` and `finished`, then `machine: X` (the record's, else the row's `<host>:`, else this machine).
- **Why:** `unlocks: …` when the job had a `why`.
- **Which rows:** the grouper's finished rows (30 minutes), then done records from the last 12 hours not shown yet and not running again, newest first, 20 rows at most. The latest 5 show, `+N more` opens the rest. The header and the anchor count them.
- **Older agents:** an agent that finished before the plugin kept records gets one from its transcript (this session's `subagents` folder) the first time its row is opened.
- **Remote jobs:** a `<host>: name` row has a record only on the machine that ran it. Here it opens to `no impact reported` with its finish time.

## Running cards

Each running job in the Status panel is two lines: the title, bar, percent and time left, then `<Area> · <why>` dim. The bars line up at the right. Press a title to open its card with the details, press it again to close it.

Waiting jobs draw no bar: `⏸ <title>`, then a dim line `<Area> · <why it waits>`, cut with `…`. Press the title to read the whole reason with how long it has waited (`last action 4m ago: Bash, check log · for 12m`), then the same details card. `· waiting` shows only when nothing is known.

- **Why a waiting agent waits:** the best source it has, in this order.
  1. Its background tasks still running: a background Bash, a Monitor (`monitor: deploy goes green`) or a child agent (`agent: Grade the sample`), by their descriptions. When a task's words name a running job, its percent shows too: `waiting on Wait for the top-up run to finish (Mac label top-ups 2021-23 90%)`.
  2. A running job it watches: its transcript names the job's progress file (it writes or reads `~/.claude-progress/<job>.json`), the job's `parent` is the agent, or its name's key words name the job. `waiting on Mac label top-ups 2021-23 (90%)`. A background task of an agent that watches a job shows that job's percent too.
  3. Its own progress file's step.
  4. Its last tool call and when it ended: `last action 4m ago: Bash, check log`.
- **Where that comes from:** each tool call an agent makes (a background Bash's task id and description, a Monitor's task id and deadline), the child agents the harness lists, and the waiting agent's own transcript, read again only when it changes. In the transcript a task runs from its "running in background with ID" or "Monitor started" result until a task notice says completed, failed, killed or stopped, a Monitor expired, or a TaskStop names it. The transcript also gives the last call's description after a plugin reload, so `last action` always names what it did. A stop that lists the in-flight tasks also ends the ones it no longer lists.
- **Other waits say why too:** a pending agent reads `not started yet`, a step about a rate limit reads `paused by a rate limit: <step>`, a job's own `waiting on X` or `waits for X` reads `waiting on X`, and any other step reads `last step: <step>`. To-dos that wait on a job keep their `waits for <job>` line, and open actions show in the Action needed pane.
- **Status line:** the full view prints the same reason on the row, `Mac Jev first pass for labels waiting · waiting on: <task> · waiting 12m`.

- **Finished agents leave:** an agent that handed its report back never shows as waiting, even after a plugin reload (the plugin remembers it). An agent the harness still lists as waiting with no tool call seen for 30 minutes is over too.
- **Watchers fold in:** a waiting agent whose name says `watcher`, `watch` or `monitor`, and whose other words name a running job (`Mac label top-ups watcher` and `mac-label-top-ups-2021-23`), leaves WAITING. Its job's card says `watched by Mac label top-ups watcher`.

```
List  Connectors  GitHub  Log  Chat  Topology          Max 62% ━━━── 7d

  ◐ Health care labels                     ━━━━━━━━──  64%  1h19m left
    Causes · the health care filter
    scoring
    42m so far
  ◓ Release prep                           ━━━━━━━━──  75%  waiting on …
    Tools · the weekly report
    waiting on: Train the model
    machine: Hunty
    22m so far
      ↳ Train the model                    ┄┄┄┄┄┄┄┄┄┄
        Other
  ⚠ Nightly import                         ━━━━━━━━──  80%  ⚠ stuck 14m
    Tools · the morning dashboard
```

- **Usage meter:** a compact `Team 48% ━━─── 7d` (the plan's name, `Max` when unknown) sits at the right end of the tab row on every tab, even with nothing running. In a pane too narrow for both it gets its own line above the tabs, right-aligned. It reads `Max 7-day used N%` (or `7d N%`) from running lines. With no job reporting it, the last reading stays for up to 7 days (saved in `~/.claude-progress/.state/max-usage.json`). Once that reading is over 35 minutes old it adds its time, like `· as of 12:39`.
- **Fresh every 30 min:** when the saved reading is over 30 minutes old, the plugin takes its own. At session start and every 5 minutes it checks the age. One session per machine does the check (a lock folder, `.state/max-usage.probe`).
  - **How:** one tiny Haiku call, `claude -p` with `--tools ""`, `--strict-mcp-config`, `--setting-sources ""` and `--no-session-persistence`, run in an empty temp folder. It reads the 7-day and 5-hour use from the reply's rate limit event.
  - **Login only:** it uses your default login. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CONFIG_DIR` are unset for the call, and a run that reports an API key is thrown away. It counts toward your plan's use, about 3.5k tokens a call (about $0.0006 at API prices), so about 48 calls a day at most.
  - **Plan name:** `claude auth status` gives the plan, so the meter reads `Team`, `Pro` and so on. No token is read.
  - **Failure:** offline or logged out, the old reading stays and nothing is shown.
- **Count:** the RUNNING header counts top-level lines and notes nested ones, as `RUNNING  4 (+3 sub-jobs)`.
- **Machine:** left out of the line (`Hunty grants linked` reads `Grants linked`). The opened card names it on its own line, `machine: Hunty`. Remote machines come from `<host>: name` rows, the to-do headings and topology.json. The local one is the `[mac]` or `[local]` heading.
- **Line:** a mark, the title, a 10-cell bar and the percent, then time left (`59m left`), a yellow `⚠ stuck Nm`, `waiting on X`, a run time or `just finished`, cut to 12 columns. Under it `<Area> · <why>`, one line cut with `…`.
- **Time so far:** from the job's real start: `startedAt` in its progress file, else the file's birth time, else when the plugin first saw it (kept in `~/.claude-progress/.state/job-track.json`). Never from the file's last write.
- **Time left:** a reported time left wins. An item count (over 20) gets one from its rate: items done since the plugin first saw it over the time since (once that is 5 minutes old), else a rate in its step (`7,196/h`), else its average since a known start. A job of 20 steps or fewer gets no estimate, since its steps take uneven time and no estimate beats a wrong one.
- **Short title:** `title` from the progress file or `titles.txt`, cut at ` · `, its machine word left out. Without a title the job id made readable.
- **Aligned bars:** the title column is what the pane has left after the bar, the percent and 14 columns for time, at least 3 characters. Longer titles end in `…`.
- **Open card:** the step (or `waiting on: X`, or `a of b steps` when there is no step), `machine: X` when known, the time so far or run time, a watcher, and the gains the job named. Each line wraps under its own indent. Open cards stay open while the session runs.
- **Children:** a job whose `parent` is also running shows under the parent's line, marked `↳`, only while the parent is open. One level only: a parent that has a running parent of its own keeps its own line.
- **Remote jobs:** a `<host>: name` job without a `parent` nests under the one running job whose id starts with `<host>-` (such as `gpu-box: train.py` under `gpu-box-train`). With none or several such jobs it keeps its own line.
- **Waiting on:** a parent whose numbers have not moved is not stuck while a child runs or changed in the last 10 minutes. Its line reads `waiting on <child title>` instead of `⚠ stuck`. The grouper does the same in the status line.
- **Busy processes:** a row detail `N% CPU` is never progress. The line shows a still dotted bar and the run time. A busy process that ends never shows as finished.
- **Name:** a trailing status word (`working`, `running`, `pending`, `waiting`, `starting`) is left out.
- **No percent:** a still dotted bar `┄┄┄┄┄┄┄┄┄┄` with the run time. It used to slide, which read as flashing.
- **Usage meter:** one shared meter on the tab row (or above it in a narrow pane), from a row detail `7d N%` or `Max 7-day used N%` (the highest one). Green under 50%, yellow under 80%, red above.
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

## Topology tab

The **Topology** tab of the Status panel draws your machines as a tree: the data host on top, each helper below it, and what data moves on each branch. It redraws on the panel's refresh tick.

```
                               → Jev API  → Claude
                                   ● work-mac  data host · 1 job
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
            ▲▼ reads + writes                            ▼ reads
                    │                                       │
                 ● hunty                             ● personal-mac
          1 job · load 0.37/12                            1 job
```

Press a machine's name to open it below the tree. Press a job there to see what it moves:

```
▾ ● hunty  1 job · load 0.37/12
    ▾ Board lists past 25 seats         83%  reads + writes
        reads: nombot.board_members_history
        writes: Postgres via work-mac
    1 queued
```

- **Tree:** the data host is the root, helpers are leaves spread evenly across the width. More helpers add more leaves.
- **Branches:** `▼ reads` the helper reads from the data host, `▲ writes` it writes back, `▲▼ reads + writes` both, `(N)` when several jobs share it, `┊` nothing moving, `✕ offline`. A branch is green while data moves, dim when idle, red when offline.
- **Dots:** green busy, dim idle or unknown, red offline. Under each leaf: its job count and load.
- **Services:** `→ Jev API`, `→ Claude` or `→ GitHub` show dim above the root while a running job's name, title, step, reads or writes match their pattern.
- **Open machine:** below the tree, so the tree never breaks. Its running jobs, one row each with percent and what each moves, the services it calls and how many to-dos are queued for it. Waiting jobs show only when they say what they wait on.
- **Open job:** its reads, writes, what it waits on, its step, why and area tag (`area: Boards & people`, see **Goal view**).
- **Open state:** kept with the List tab's open cards, so a machine stays open across refreshes.
- **Jobs:** the same rows as the List tab, plus a DONE row that still has a bar (a job at 100% that still reports). A job's machine is its `<host>: ` row prefix, the machine word its title starts with (`Hunty board lists`, `Mac label top-ups`), or the first word of its slug (`mac-label-top-ups`), else this machine. `Mac` and `local` are aliases of `work-mac`.
- **Flows:** a job on a helper reads from the data host (its `reads` names what, else the data host's database as the read-only `dbRole`, `helper`). It writes back only when its progress file has `writes`.
- **Health:** this machine is online. A machine with a `status` file (hunty: `.lines/linux.txt`) is online while that file is under 2 minutes old and says `✓`, else offline. A machine without one is `unknown` until a job reports from it. The plugin runs no network checks of its own.
- **Machines:** `~/.claude-progress/topology.json`, written once with defaults. Each machine has an `id`, `ip`, `role` (`data` for the one that holds the database, else `compute`), `aliases` (other names in titles and to-do headings), `about` and an optional `status` heartbeat file. `services` lists `name`, `match` (a regex) and an optional `from`. Add `"self": "<id>"` when this machine's to-do headings do not say which one it is.
- **Width:** under 60 columns the tree runs down the left:

```
● work-mac  data host · 1 job  → Jev API
├─ ▲▼ reads + writes ── ● hunty  1 job
└─ ▼ reads ── ● personal-mac  1 job
```

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

## Inbox

Shows what needs you, such as emails waiting on your reply, first on the List tab and in the status line.

```
Inbox  2 need you
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
- **Status line:** the one-line summary starts with a yellow `inbox: N need you`. Without the panel, the full view starts with that line. Nothing shows when N is 0.
- **Gmail example (optional):** `/progress-bar inbox setup` writes `~/.claude/progress-bar/inbox-check.sh` and prints how to run it every 10 minutes. It needs the claude.ai Gmail connector and the `claude` CLI signed in. Each run starts a headless Claude (haiku) that may call only Gmail `search_threads`, `get_thread` and `get_message`. Sending, drafts, labels, trash and every other tool are denied. It treats email text as data and never follows instructions in it. It reads inbox threads from the last 3 days, leaves out promotions, social, automated mail and threads you answered last, and writes `inbox.json`. Set `INBOX_ACCOUNT` to your address. Runs skip 11 PM to 6 AM and never overlap.

## Action needed

Some steps only you can run: a deploy swap, a login, a command the permission system blocks, deleting a repo. Claude adds them as **actions** instead of only writing them in chat. While one is open you finish it or skip it before giving other instructions.

```
Action needed
Swap in NomBot build viNrI9k8 (count flash fix)
$ cd ~/Desktop/NomBot/web && rm -rf .next-prev && mv .next .next-prev && …
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
- **Status panel:** the same red box at the very top of the List tab with **▶ Run**, **Copy**, **✓ I ran it** and **Skip**.
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
Channel  1 new
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
- It shows in the Status panel List tab as `Channel  N new`. Press a file to open it with your default app. **✓ read** hides it (`~/.claude-progress/.state/channel-read.txt`).
- The status line shows a cyan `channel: N new`, kept apart from the inbox `inbox: N need you` because a received file is not a task.
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

The Status panel has a **Chat** tab next to List, Connectors, GitHub, Log and Topology. It shows each channel as a chat room. Its tab reads `Chat 2` when 2 received messages are unread.

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
file: launch-plan.md (3 KB)
# Launch plan
First lines show as a preview
╭─────────────────────────────────────────╮
│ Message hunty                           │
╰─────────────────────────────────────────╯
➤ Send  ↑ Send file: /progress-bar send <file> to hunty
```

- **Pick a channel** at the top. Each line shows its name, the last message time and the unread count.
- **The thread** runs oldest first. Received messages sit on the left under the sender's name. Yours sit on the right under "You".
- **Chat lines** (from the field or `say`) show as bubbles with the full text. A `.md` or `.txt` file shows its first 3 lines. Images and PDFs show as `file: file.png (120 KB)`.
- **Press a message** to expand a text file inline, 30 lines a page, with `↗ open` and `▴ fold`. Press an image or PDF to open it with your default app.
- **Unread** clears when you view the thread. The List tab block and the status line `channel: N new` clear with it.
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

CONNECTORS  7 ok · 2 need sign-in
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

Everything stays on your machine. The plugin reads and writes only files under `~/.claude-progress/`, `~/.claude/progress-bar/` and `~/.cache/progress-bar/`, and reads the `*.log` files in folders you list in `log-dirs.txt`, plus `~/Applications/ProgressBarToggle.app` if you run `setup mac-clicks`. It runs an action's command only when you press **▶ Run** and confirm, in a new terminal window you can see. The plugin makes no network calls itself, except the secure channel once you open one: it then talks to GitHub through your own `gh` and `git`, and stores only ciphertext there. The optional inbox checker (`inbox setup`) runs only when you schedule it, and reads your mail through your own Gmail connector. While the Status panel is open, the Connectors tab runs `claude mcp list`, which contacts your configured connectors to check them. The GitHub tab runs local `git` only, and opens a page in your browser when you click. Every 30 minutes one session on the machine runs a tiny `claude -p` Haiku call on your default login to refresh the usage meter (see Running cards).

## License

MIT

## herdr Connectors pane

Using [herdr](https://github.com/herdrdev/herdr)? The `herdr/` folder is a herdr plugin that shows your Claude connectors in a narrow side pane (green ✔ connected, yellow ! needs sign-in, red ✖ failed), checked every 5 minutes.

```sh
herdr plugin install hunterZh37/progress-bar-plugin/herdr
```

Details in [herdr/README.md](herdr/README.md).
