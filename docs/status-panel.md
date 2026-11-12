# Status panel

The docked Status panel: the List tab, running cards, done rows, servers, stop and pause, the Log, Connectors and GitHub tabs, and folding.

## Goal view

The List tab reads in a few seconds: status first, then what needs you, then the work. Details wait until you press a row.

- **Status line first:** `2 running · 1 waiting · 2 needs you · 15 done today`, the counts that are not zero, right under the tabs. The `needs you` count is bold yellow. Nothing at all reads `Nothing running`. The goal's name is no longer shown: it repeated the project.
- **Chrome on the same line:** once Claude in Chrome has been used on this machine, the `Chrome:` line follows the counts, dim (yellow on a warning), with **[Check account]** after it when that applies. In a narrow pane the Chrome part is cut first, never the counts: the account is cut (`jane@exam…`), then dropped, then `this Mac`, then the browser name.
- **NEEDS YOU:** next, and only when something needs you (no empty heading). One line each, its verb first and bold: open actions (title, full command, **▶ Run**, **Copy**, **✓ I ran it**, **Skip**), your `[you]` to-dos (press for the to-do menu), a Chrome account warning (**Switch**, with **[Check account]** when it applies), stuck jobs (**Check**, press to open the job) and problems (**Fix**, red). Warnings and commands are never cut, they wrap.
- **Sections:** TO-DO (machines' to-dos: per machine, priorities, blockers, the menu), RUNNING, WAITING, DONE. Problems are NEEDS YOU lines, not a section. Headers have no hotkeys. Inside RUNNING and WAITING, rows cluster by area in the goal's order. To-dos keep their priority order.
- **Running rows, two lines:** the mark, the **bold** title, a thin bar and the percent, then time left, `⚠ stuck 14m`, `waiting on X` or `paused`. Line two, dim: the current step (or `a of b steps`) and how long it has run (`scoring · 42m`, never "so far"). Titles are cut to one line. The title column fits the longest title shown, so the bars still line up and the note keeps its room.
- **Press a row** to open it: line two wraps in full, then `<Area> · <why>` (no `Other` when the area is unknown), the machine, a watcher and the gains the job named. Press again to close.
- **Waiting rows:** `⏸` and the bold title, then why it waits and for how long, dim (`waiting on build · for 12m`).
- **DONE starts folded** to one line, `▸ DONE TODAY  15`. Press it to open it for this session. Open, each job is one line in normal weight, its outcome first, the finish time dim at the right edge. DONE shows the latest 5, then `+N more`, then checked-off to-dos folded to one dim line (see **Done rows**).
- **Gutter:** the status mark (`◐ ⏸ ✓ ⚠ ✖ ○ ↳`) sits in one column and the title in the next.
- **Plain titles:** the title is the improvement, with its machine left out (`Server-1 orders backfill` reads `Orders backfill`).
- **Lenses:** cost, quality and speed show only in an opened card, from the job's `gains`. A job that named none shows its likely lens from its title and why, `likely improves: speed`.
- **Machines:** the helper machine lines live on the Topology tab, not the List tab.
- **No emoji:** the panel and status line use words and single-width symbols only (`✓ ▸ ▾ ◐ ━ ┄ ⏸ ▶ ○ ·`), so every terminal draws them the same. No semicolons or em dashes in its copy.

### Per-project goals

Each project has its own goal: `~/.claude-progress/goals/<project>.json`, where `<project>` is the same slug as its to-do list (`~/code/myapp` is `code-myapp`). It sets the areas and the lenses (and an `anchor`, the goal's name, kept for older views). A project with no file puts every job under no area, so its open cards name none. The panel never writes or overwrites these files, so create and edit them freely. The old `~/.claude-progress/goal.json` is read only by a session with no folder:

```json
{
  "anchor": "Make checkout faster",
  "areas": [
    {"id": "search", "name": "Search & filters", "tag": "Search", "keywords": ["search", "filter", "index"]},
    {"id": "payments", "name": "Payments", "tag": "Pay", "keywords": ["payment", "card", "refund", "checkout"]}
  ],
  "lenses": [
    {"id": "cost", "name": "cost", "keywords": ["$", "cost", "cheaper", "saved"]},
    {"id": "quality", "name": "quality", "keywords": []},
    {"id": "speed", "name": "speed", "keywords": ["faster", "hours", "minutes"]}
  ]
}
```

- **Default:** none. A project with no goal file shows its folder name and no areas, and nothing is written.
- **Matching:** a job's `area` matches an area's id or name, any case, or the start of a name (`Search` finds `Search & filters`). A name that matches none becomes its own area. Without `area`, each keyword found as a whole word or its plural (`person` finds `persons`, not `personal`) counts 2 in the title and 1 in the why, impact or step. The top score wins, ties go to the area listed first.
- **Tags:** `tag` is the short area word in an opened card (`Search`, `Pay`), up to 8 letters. Without one, an area takes its name's first word. An `icon` from an older file is read and ignored.
- **Lenses:** the three ids are fixed (`cost`, `quality`, `speed`). Change their names or the words that infer them.
- `goal` is a data file name, so no progress file or `progress_report` slug may take it.

## Status panel

On by default. Shows the full groups in a docked pane named **Status**, and shrinks the status line to one summary line. `/progress-bar panel off` turns it off, `/progress-bar panel on` back on.

```
List  Connectors  GitHub  Log  Chat  Topology

1 running · 3 needs you · 1 done today · Chrome: Work · you@work.example · this Mac

NEEDS YOU  3
  ○ Review the deploy PR
  ○ Sign in to the dashboard
  ⚠ Check Nightly import, stuck 14m

▾ RUNNING  1
  ⚠ Nightly import   ━━━━━━━━──  80%  ⚠ stuck 14m
    ⎿ batch 4 · 2h

▸ DONE TODAY  1
```

The status line then reads:

```
▶ 2 running · ⚠ 1 stuck · ✖ 1 error · ☐ 3 to-do · full view in the Status panel
```

`✖ N errors` shows only while the Log tab has unseen errors.

- **Runs the script:** the panel runs `~/.claude/progress-bar/statusline.sh` with `PB_FULL=1` every second while it is open. The first session writes that script, and `panel on` refreshes it and `group.py` and keeps your chained status line.
- **Never blank:** when the script fails, or prints nothing but an error, the panel shows the reason (for example `Status script failed (exit 1): <first stderr line>`). A pane that cannot draw says why instead of nothing.
- **Fold:** press a header. Headers have no hotkeys, so no `1:` number prefixes clutter the panel. It writes `~/.claude-progress/.state/folded.txt`, the same file `/progress-bar fold` uses. DONE is the exception: it starts folded in the panel and a press opens it for the session.
- **On by default:** the first session writes `~/.claude-progress/.state/panel-on`. With that file the pane opens at session start and the status line prints the summary. `panel off` deletes it, writes `.state/panel-off` so the default never turns it back on, and closes the pane. `panel on` undoes that. With **Open the Status panel** off in `/config`, nothing is written and `/progress-bar` opens it once.
- **To-do menu:** click a to-do (under TO-DO, or your own under NEEDS YOU) for Done, Up, Down, Start (a ready machine item), Delete or Move back to to-do (a checked-off one). It edits this project's list, on the line that still holds that item's text, so a line added since the panel drew never hits the wrong item. TO-DO lists open items only. Checked-off ones move to DONE, after finished jobs, folded to one dim line, `▸ 15 checked-off to-dos`, and count there.
- **Rows:** clustered by area (see **Goal view**). To-dos one per line under each machine (yours under NEEDS YOU), running jobs a line and a dim step line each, a press opening the details (see **Running cards**), done jobs one line each with their impact and finish time (see **Done rows**).
- **Tied lines:** every dim line under a row starts with a dim `⎿ `, as Claude Code ties a command's output to it. Only the first line under a row gets it, the next ones line up under its text, and wrapped text indents under the text, not under `⎿`. This covers running and waiting rows, open cards, open DONE rows, `waits for` to-do lines, recap and inbox lines, Log details and Connectors accounts. One-line rows (LOCALHOST, to-dos) have none.
- **Status line on:** after **▶ Turn on status line**, the answer (`Status line on: ...`) shows for 3 minutes, then clears.
- **Tabs:** words, `List  Connectors  GitHub  Log  Chat  Topology`. The shown tab is bold cyan, the others dim. Connectors adds `!N` when N need attention (`Connectors !2`), Log adds `!N` for unseen errors, Chat adds the unread count (`Chat 3`). In a pane too narrow for the full names they shorten to `List  Conn  Git  Log  Chat  Topo`. **List** (the default) shows the goal view above. **Connectors** shows your connectors, **GitHub** your repos, **Log** the events log, **Topology** your machines.

## Done rows

DONE starts folded to `▸ DONE TODAY  N`. Open, each finished job is a button, one line: a green `✓`, the outcome in normal weight, the finish time dim at the right edge. A job shows its impact (its title when it reported none). An agent shows its title, the short name it gave `progress_report`, not a sentence cut from its report. The title comes from its done record, else its progress file or `titles.txt`, else its id made readable (`server-1: server-1-nightly-import` reads `Server-1: Nightly import`). Checked-off to-dos come last, folded to one dim line.

Press a job row to open what it changed:

```
  ✓ Board links rebuilt: 1.29M pairs                    11:50
    ⎿ Boards · Board links rebuild
      109K split people merged
      finished 11:50 · ran 1h20m · machine: Mac
      unlocks: people pages
```

- **Impact:** the job's `impact` lines, or an agent's short report, each wrapped under its indent. The first line is the row itself, and shows again in the card only when the row had to cut it. The card starts with `<Area> · <title>`. `no impact reported` when there is none. Named `gains` follow as `quality: …`.
- **Time and machine:** `finished HH:MM · ran 1h20m` from the record's `started` and `finished`, then `machine: X` (the record's, else the row's `<host>:`, else this machine).
- **Why:** `unlocks: …` when the job had a `why`.
- **Checked-off to-dos:** one dim `▸ N checked-off to-dos` line. Press it to open the first 5 in `todo.txt` order (it keeps no dates), dim, one line each, cut with `…`, then `+N more`. Press a to-do for its menu (Move back to to-do, Delete).
- **Agent impact:** a report is cut into sentences only where `.`, `!` or `?` is followed by a space and a word that does not start lower case, so version numbers and paths like `~/a.b` stay whole.
- **Which rows:** the grouper's finished rows (30 minutes), then done records from the last 12 hours not shown yet and not running again, newest first, 20 rows at most. The latest 5 show, `+N more` opens the rest. The header and the status line count them.
- **Older agents:** an agent that finished before the plugin kept records gets one from its transcript (this session's `subagents` folder) the first time its row is opened.
- **Remote jobs:** a `<host>: name` row has a record only on the machine that ran it. Here it opens to `no impact reported` with its finish time.

## Server rows

A background Bash shell that runs a server (`npm run dev`, `pnpm start`, `next dev`, `vite`, `uvicorn`, `gunicorn`, `flask run`, `manage.py runserver`, `rails s`, `python -m http.server`, `node server.js`, `docker compose up` and the like, or one whose description reads "Start/Run ... server", or a background shell whose port listens) stays up by design. It is not a RUNNING row: it shows once under LOCALHOST, in the row of its port, with its uptime and `[x]`. It ends when the shell exits.

    ▾ LOCALHOST  2
      ● localhost:3000  myapp dev server     up 0m [edit] [x]
      ● localhost:4000  myapp preview       up 16h02m [edit] [x]

- **One row per port:** a server shell joins the row of its port, so a port is never listed twice. A page you named keeps your name.
- **What it is for:** your name for the page when you set one with `[edit]`, else the shell's description without its leading verbs (`Build, swap and health-check myapp preview` reads `myapp preview`).
- **Port from the process tree:** when the command names no port (`npm run dev`), each listener's parent processes are walked up to the shell Claude started, and that shell's command is matched to the background shell's. So `npm run dev` that listens on :3000 shows as `localhost:3000`.
- **Port not known yet:** the row reads `localhost:?` with the shell's purpose, until its port listens.
- **RUNNING** keeps the other background jobs. When only servers run, RUNNING is not shown.

## Stop or pause a job

A RUNNING row with something to control ends with a dim `[x]`. Press it for `Cancel · Stop · Pause` under the row.

- **Cancel first:** the focus lands on Cancel, so a stray Enter stops nothing. To stop, move to Stop, then press Enter or click it.
- **Closes by itself:** with no choice in 8 seconds the confirm closes. Cancel, Escape, moving the focus away or leaving the panel close it too.
- **One row at a time:** `[x]` on another row moves the confirm there. `[x]` again on the same row closes it.
- **Never restored:** the confirm is not saved anywhere. After `/reload-plugins` it is gone.

- **Background shell** (dev servers too, from their LOCALHOST row's `[x]`): Stop sends SIGTERM to the shell Claude started for that command and its child processes. Pause sends SIGSTOP and the row reads `paused`, then the menu offers `Cancel · Resume · Stop`. If its process is not found, Stop asks Claude to TaskStop it.
- **Subagent:** Stop asks Claude, as a prompt, to stop it with TaskStop and say what it had done. There is no pause.
- **Progress-file job with a `pid`:** Stop (SIGTERM), Pause (SIGSTOP), Resume (SIGCONT), and Stop marks the file stopped.
- **Progress-file job without a `pid`:** Stop writes `"stopped": true, "stoppedAt": <ms>` into its file. The row moves to DONE as `stopped by you`. Scripts should read their file before each write and quit when `stopped` is true.
- Rows with nothing to control (another machine's jobs, rows with no file here) show no `[x]`.
- **Safety:** only processes this plugin recorded: its own background shells (by their exact command, started by Claude, never a look-alike in your terminal) and `pid`s from progress files. Never pid 1, the panel's own process or Claude, never another user's process. A job's pid must still hold its `cmd` and must have started before the job (a reused pid did not).
- Each stop, pause and resume is logged in the Log tab (`Stopped <title>`). Paused rows are kept in `~/.claude-progress/.state/paused.json`.

## Running cards

Each running job in the Status panel is two lines: the bold title, bar, percent and time left, then the current step and run time dim (`scoring · 42m`). The bars line up. Press a title to open its card with the details, press it again to close it.

Waiting jobs draw no bar: `⏸ <title>`, then a dim line with why it waits and for how long, cut with `…`. Press the title to read the whole reason with how long it has waited (`last action 4m ago: Bash, check log · for 12m`), then the same details card. `· waiting` shows only when nothing is known.

- **Why a waiting agent waits:** the best source it has, in this order.
  1. Its background tasks still running: a background Bash, a Monitor (`monitor: deploy goes green`) or a child agent (`agent: Grade the sample`), by their descriptions. When a task's words name a running job, its percent shows too: `waiting on Wait for the top-up run to finish (Mac import 2021-23 90%)`.
  2. A running job it watches: its transcript names the job's progress file (it writes or reads `~/.claude-progress/<job>.json`), the job's `parent` is the agent, or its name's key words name the job. `waiting on Mac import 2021-23 (90%)`. A background task of an agent that watches a job shows that job's percent too.
  3. Its own progress file's step.
  4. Its last tool call and when it ended: `last action 4m ago: Bash, check log`.
- **Where that comes from:** each tool call an agent makes (a background Bash's task id and description, a Monitor's task id and deadline), the child agents the harness lists, and the waiting agent's own transcript, read again only when it changes. In the transcript a task runs from its "running in background with ID" or "Monitor started" result until a task notice says completed, failed, killed or stopped, a Monitor expired, or a TaskStop names it. The transcript also gives the last call's description after a plugin reload, so `last action` always names what it did. A stop that lists the in-flight tasks also ends the ones it no longer lists.
- **Other waits say why too:** a pending agent reads `not started yet`, a step about a rate limit reads `paused by a rate limit: <step>`, a job's own `waiting on X` or `waits for X` reads `waiting on X`, and any other step reads `last step: <step>`. To-dos that wait on a job keep their `waits for <job>` line, and open actions show in the Action needed pane.
- **Status line:** the full view prints the same reason on the row, `Mac first pass for labels waiting · waiting on: <task> · waiting 12m`.

- **Finished agents leave:** an agent that handed its report back never shows as waiting, even after a plugin reload (the plugin remembers it). An agent the harness still lists as waiting with no tool call seen for 30 minutes is over too.
- **Watchers fold in:** a waiting agent whose name says `watcher`, `watch` or `monitor`, and whose other words name a running job (`Mac import watcher` and `mac-import-2021-23`), leaves WAITING. Its job's card says `watched by Mac import watcher`.

```
List  Connectors  GitHub  Log  Chat  Topology          Max 62% ━━━── 7d

2 running · 1 needs you

NEEDS YOU  1
  ⚠ Check Nightly import, stuck 14m

▾ RUNNING  2 (+1 sub-job)
  ◐ Search index rebuild  ━━━━━━━━──  64%  1h19m left
    scoring · 42m
  ◓ Release prep        ━━━━━━━━──  75%  waiting on …
    packaging · 22m
    waiting on: Train the model
    Tools · the weekly report
    machine: Server-1
      ↳ Train the model ┄┄┄┄┄┄┄┄┄┄
        epoch 3 · 20m
  ⚠ Nightly import      ━━━━━━━━──  80%  ⚠ stuck 14m
    batch 4 · 2h
```

- **Usage meter (off by default):** turn on **Usage meter** in `/config` under progress-bar. Off, no probe runs and no meter shows. On, a compact `Team 48% ━━─── 7d` (the plan's name, `Max` when unknown) sits at the right end of the tab row on every tab, even with nothing running. In a pane too narrow for both it gets its own line above the tabs, right-aligned. It reads `Max 7-day used N%` (or `7d N%`) from running lines. With no job reporting it, the last reading stays for up to 7 days (saved in `~/.claude-progress/.state/max-usage.json`). Once that reading is over 35 minutes old it adds its time, like `· as of 12:39`.
- **Per login:** a session started with `CLAUDE_CONFIG_DIR` (a second subscription, e.g. `~/.claude-personal`) reads and probes its own login, saved in `max-usage-<login>.json`. The default `~/.claude` login keeps `max-usage.json`.
- **Fresh every 30 min:** when the saved reading is over 30 minutes old, the plugin takes its own. At session start and every 5 minutes it checks the age. One session per machine does the check (a lock folder, `.state/max-usage.probe`).
  - **How:** one tiny Haiku call, `claude -p` with `--tools ""`, `--strict-mcp-config`, `--setting-sources ""` and `--no-session-persistence`, run in an empty temp folder. It reads the 7-day and 5-hour use from the reply's rate limit event.
  - **Login only:** it uses your default login. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CONFIG_DIR` are unset for the call, and a run that reports an API key is thrown away. It counts toward your plan's use, about 3.5k tokens a call (about $0.0006 at API prices), so about 48 calls a day at most.
  - **Plan name:** `claude auth status` gives the plan, so the meter reads `Team`, `Pro` and so on. No token is read.
  - **Failure:** offline or logged out, the old reading stays and nothing is shown.
- **Count:** the RUNNING header counts top-level lines and notes nested ones, as `RUNNING  4 (+3 sub-jobs)`.
- **Machine:** left out of the line (`Server-1 orders backfill` reads `Orders backfill`). The opened card names it on its own line, `machine: Server-1`. Remote machines come from `<host>: name` rows, the to-do headings and topology.json. The local one is the `[mac]` or `[local]` heading.
- **Line:** a mark, the bold title, a 10-cell bar and the percent, then time left (`59m left`), a yellow `⚠ stuck Nm`, `waiting on X`, `paused`, a run time or `just finished`, cut to what is left. Under it the step (or count) and run time, one dim line cut with `…`.
- **Run time:** from the job's real start: `startedAt` in its progress file, else the file's birth time, else when the plugin first saw it (kept in `~/.claude-progress/.state/job-track.json`). Never from the file's last write.
- **Time left:** a reported time left wins. An item count (over 20) gets one from its rate: items done since the plugin first saw it over the time since (once that is 5 minutes old), else a rate in its step (`7,196/h`), else its average since a known start. A job of 20 steps or fewer gets no estimate, since its steps take uneven time and no estimate beats a wrong one.
- **Short title:** `title` from the progress file or `titles.txt`, cut at ` · `, its machine word left out. Without a title the job id made readable.
- **Aligned bars:** the title column fits the longest title shown, at most what the pane has left after the bar, the percent and 14 columns for time, at least 3 characters. Longer titles end in `…`.
- **Open card:** line two in full, `waiting on: X` when line one cut it, `<Area> · <why>` (just the why when the area is unknown), `machine: X` when known, a watcher, and the gains the job named. Each line wraps under its own indent. Open cards stay open while the session runs.
- **Children:** a job whose `parent` is also running shows under the parent's line, marked `↳`, only while the parent is open. One level only: a parent that has a running parent of its own keeps its own line.
- **Remote jobs:** a `<host>: name` job without a `parent` nests under the one running job whose id starts with `<host>-` (such as `gpu-box: train.py` under `gpu-box-train`). With none or several such jobs it keeps its own line.
- **Stuck:** a row shows `⚠ stuck` only when its numbers, its step and every other sign of life (its file or heartbeat written, its agent's transcript, a quiet window from `expect_minutes`) are older than the threshold. See [progress-files.md](progress-files.md#stuck-and-signs-of-life).
- **Waiting on:** a parent whose numbers have not moved is not stuck while a child runs or changed in the last 10 minutes. Its line reads `waiting on <child title>` instead of `⚠ stuck`. The grouper does the same in the status line.
- **Abandoned waits:** an agent that has sat waiting for 6 hours with no change to its transcript is dropped from WAITING. The work it waited on ended long ago and its finished notices never reached it. A job that still writes its progress file keeps its own row.
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

## Connectors

The **Connectors** tab of the Status panel lists each MCP connector with its status.

```
 List  │  ▌Connectors !2  │   GitHub

CONNECTORS  7 ok · 2 need sign-in
  Claude: you@example.com · Your Org
  Chrome: Browser 2 · you@work.example · other computer  used 14:02
    Chrome is controlling you@work.example, which isn't signed in on this Mac. Run /chrome to switch.
    Also connected: Browser 1 · you@gmail.com
  ✔ Gmail
    you@gmail.com
  ✔ orders-db
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

### Chrome line

The `Chrome:` line says which browser Claude in Chrome drives for this session, under which Google account, and whether it is on this Mac.

- **Shows:** `Chrome: Browser 2 · you@gmail.com · this Mac`, `… · other computer` or `Chrome: Browser 1 · account unknown`. Nothing shows until Claude in Chrome is used once on this machine. After that, `Chrome: not connected` (dim) shows while the extension is not connected. `used 14:02` is the last Chrome call. Other connected browsers follow, dim.
- **Warning (yellow):** when the in-use browser's account is not signed in to any Chrome profile on this Mac, or the browser reports `onThisComputer: false`. On the List tab the warning is a NEEDS YOU line, `⚠ Switch Chrome is controlling …`, in full. A fine account is not shown there (the Connectors tab has it). The `Chrome:` line sits on the List tab's status line, after the counts, and an unknown account adds **[Check account]** after it. It refreshes every 5 seconds. `isLocal` is not trusted: it said true for a browser on another computer.
- **Browser in use:** read from the session's own `mcp__claude-in-chrome__*` results: `list_connected_browsers` (deviceId, name, isLocal, inUse, connectedAt), `select_browser` and `switch_browser`.
- **`/chrome` switches:** its output row (`Now using browser "Browser 2" for Chrome actions.`) is seen as the session stores it, and in the session transcript's new lines on each 5 second poll (so a switch made before a reload shows too, if it is in the transcript's last 4 MB and newer than the last Chrome call). The name maps to a browser through the last `list_connected_browsers`. A name not in that list shows `Chrome: Browser 2 · account unknown` until the next list. A `/chrome` output saying no browser is connected shows `Chrome: not connected`. Names are not stable across reconnects, so the mapping can be wrong until the next Chrome call.
- **Account:** the first email on a page read on `accounts.google.com` or `myaccount.google.com`, else a Gmail tab title (`Inbox - you@gmail.com - Gmail`). An account page wins over a Gmail title for a day. Saved per browser in `~/.claude-progress/.state/chrome-accounts.json`, shared by all sessions. Until Claude opens one of those pages in that browser, the account is unknown. The name on the line above the email (`Jane Doe`) is saved too, and the line then shows `Jane Doe (you@gmail.com)`. With the **Hide account emails** option on, emails show masked (`y•••@gmail.com`).
- **Check account button:** `[Check account]` shows after the `Chrome:` line (List and Connectors tabs) or the NEEDS YOU warning when the in-use browser's account is unknown, and after each `Also connected:` browser with no account (Connectors tab). Pressing it submits a prompt to this session, as auto-next does: Claude opens `https://myaccount.google.com/` in a new tab with Claude in Chrome, reads the email and name, and closes the tab. For another browser the prompt has Claude `select_browser` to it by deviceId first and back to the in-use browser after. The account is then saved as above. A pressed button hides for 2 minutes (`~/.claude-progress/.state/chrome-checks.json`, shared by all sessions). The check runs as a normal turn in this session, and the extension may ask for site permission on myaccount.google.com.
- **This Mac's accounts:** the `user_name` of each profile in Chrome's `Local State` file, read every 5 minutes, read only, names and emails only, merged with `~/.claude-progress/chrome-local-accounts.txt` (one email per line, `#` comments). macOS usually blocks reading `Local State`, so list this Mac's Google accounts in that file. With neither: no account check, and the Connectors tab shows a dim hint to add the file.
- **Expected account (optional):** add `"chromeAccount": "you@work.example"` to the project's `~/.claude-progress/goals/<slug>.json`. A different account then warns too.
- **Limits:** a Chrome profile signed in to Google on the web but not to Chrome itself looks like another computer. A page listing several accounts (the account chooser) gives the first one.

## GitHub tab

The **GitHub** tab of the Status panel shows the repo the session runs in.

```
 List  │   Connectors  │  ▌GitHub

‹  repo 1 of 2  ›

myapp  ↗
your-org

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
- In the Status panel DONE starts folded whatever the file says, and its header press opens it for the session.

## Attach files (macOS)

Press a shortcut, pick files in the macOS file picker, and they land in your prompt at the cursor. Works inside herdr too.

- **Command:** `/attach` opens the picker. It runs at once, even mid-turn.
- **Shortcut:** bind a chord to it in `~/.claude/keybindings.json`. `ctrl+x ctrl+f` is free in Claude Code's defaults:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+x ctrl+f": "command:attach" } }
  ]
}
```

- **What it inserts:** one `@` mention per file, separated by spaces, with a space after. A path with spaces is quoted, `@"/Users/you/My Shots/screen 1.png"`, the form Claude Code reads whole.
- **Images:** png, jpg, gif and webp attach as images, since Claude Code reads an `@` image path as an image.
- **Cancel** leaves the prompt as it was, with no message.
- **Opens fast:** your terminal shows the picker itself, in about 0.1 s. Focus goes back to the terminal after you pick or cancel. No Automation permission prompt, since an app may script itself. If the terminal can't show it, the picker falls back to `osascript`'s own window, which takes about 2 s.
- **While it's open** the terminal waits for the picker, so finish or cancel it before typing.
- **Pick several** with ⌘-click or shift-click in the picker.
- **Other systems:** `/attach` shows "File picker needs macOS".

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
