# Progress files

How jobs report progress: the progress file format, watch files for log-only jobs, links and how the status line is built.

## File format

`~/.claude-progress/<slug>.json`:

```json
{"done": 2, "total": 5, "step": "render pages", "startedAt": 1767225600000,
 "title": "Docs site · all pages", "why": "the public help pages", "parent": "release-prep",
 "session": "2f6c1e0a-7d4b-4e8f-9a1c-5b3d2e7f8a90", "cwd": "/Users/me/code/docs",
 "area": "Tools", "gains": {"speed": "help pages build in 2m instead of 9m"},
 "impact": "Docs rebuilt: 412 pages\nSearch index 18% smaller",
 "steps": ["build", "render pages", "check links", "index", "publish"]}
```

Easiest: Claude calls the plugin's `progress_report` tool (title or its alias label, why, done, total, step, steps, step_states, parent, slug, reads, writes, area, gains, impact, expect_minutes, heartbeat, finished). With `finished: true` it saves the done record (below) and removes the file. It writes this file with `session`, `cwd` and `startedAt` filled in. A call without a title keeps the stored one. A new title with `done` 0 starts a new task on the same row: `startedAt` becomes now and the old `step` and `steps` are cleared, so a reused agent shows its current work and time.

| Field | Does |
| --- | --- |
| `done`, `total` | Draw the bar. Leave them out and the line says `working` |
| `step` | A few words on the current step |
| `steps` | Optional. The job's steps in order, a list of names (see **Step checklist**). The row shows them as a checklist inline, its card in full |
| `startedAt` | Optional, ms. Otherwise the file's birth time, else when the plugin first saw it |
| `title` | Optional plain-language name. The job's line shows the part before ` · ` or `: `, and the open card shows the id and badge. The part before ` · ` names the job in the Log tab and in `waiting on:` |
| `why` | Optional. What the job unlocks, shown dim under its row (`unlocks: …` in an opened DONE row) |
| `parent` | Optional slug of the job this one is part of. While both run, this job shows under the parent's line when the parent is open, marked `↳` |
| `session` | Optional. The Claude Code session id (`$CLAUDE_CODE_SESSION_ID` in Bash). The job shows only in that session while it is open |
| `cwd` | Optional. The absolute folder the job works for. The job shows in every session of that folder's project (same project as Per-project to-dos) |
| `reads`, `writes` | Optional short strings for the Topology tab: what the job reads and writes, like `orders table` or `Postgres on mac-mini`. Without `reads` a job on a helper machine reads from the data host's database. Without `writes` it is not drawn writing anything |
| `area` | Which part of the goal the job improves, by name, from the project's `~/.claude-progress/goals/<project>.json` (see **Goal view**). Example: `Search`. Set it on every job when the project's goal has areas. Without it the panel guesses from keywords in the title, why and impact, else `Other` |
| `gains` | Optional. What the job makes better, by lens: any of `cost`, `quality`, `speed`, each a short plain line with a number when possible. Example: `{"quality": "12K more orders matched", "speed": "import in 7h instead of 12h", "cost": "$14 of compute instead of $60"}`. Name only the ones that apply |
| `quietUntil` | Optional, epoch ms (seconds also work). The current step is expected to stay quiet until then, so the row shows no `⚠ stuck` before it. `progress_report` writes it from `expect_minutes`, and the next report without `expect_minutes` clears it. See **Stuck and signs of life** |
| `heartbeat` | Optional path to a local file the job keeps writing, such as its log (`~/` allowed). Each write counts as a sign of life |
| `impact` | Optional, set it before the job ends. How the job made things better: what the data or product now has or gets right, with the key number, one to three short lines (a string with newlines, or a list). Skip commit ids and file names. Example: `1.65M more board seats, so board links and people search see whole boards`. Shown when its DONE row is opened |

- **Slug:** the job or subagent description, lowercased, each run of other characters turned into `-`. `Build docs!` becomes `build-docs`.
- **Name the improvement.** A `title` says what gets better, not how: `Every board member counted, not just 25` rather than `Board lists past 25 seats`. The `impact` answers how it is better now.
- **Delete the file when done.** Files not written for 30 minutes are hidden, so a long step between 10-minute updates keeps its bar and impact line. Write `impact` first and give it 5 seconds (one poll) before you delete the file, or call `progress_report` with `finished: true` and `impact`.
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

## Step checklist

`steps` lists the job's steps in order. A running row shows up to 5 of them inline under its step line (see **Inline checklist** in [status-panel.md](status-panel.md#running-cards)). Press the row's title and its card shows them all, one per line:

```
  ◐ Docs site  ━━━━──────  40%  6m left
    ⎿ render pages · 3m
      ✓ build
      ◐ render pages
      ○ check links
      ○ index
      ○ publish
```

- **Items:** each is a name (`"build"`), or `{"name": "build", "state": "done"}` to set its state. Add `"note"` for the item's own dim text (`◐ build · needs review`). Items never repeat the job's `step`. States: `done` (`✓`, dim), `active` (`◐`, normal weight), `todo` (`○`, dim), `skipped` (`·`, dim and struck through where the terminal can), `failed` (`✖`, red).
- **States from the count:** an item with no state follows `done`. Items before index `done` are done, the one at `done` is active, the rest are to do. Once `done` reaches `total` all are done.
- **Mismatch with `total`:** the bar always follows `done` and `total`. When the list is longer or shorter than `total`, the whole list still shows, with states from `done` as above.
- **The current step:** `step` still shows on the row's dim line. When it says more than the active item's name, the item adds it dim: `◐ render pages · page 40 of 412`.
- **Long lists:** a card shows at most 12 lines. A longer list shows a window around the active item (else the first failed, else the first to do), with `… N earlier` above it and `… N more` below.
- **Limits:** at most 50 items are kept, each name cut to 200 characters. Names wider than the card are cut with `…`.
- **With `progress_report`:** pass `steps` on the first call. A later call without `steps` keeps the stored list, and `finished: true` removes it with the file. `step_states` (same order as `steps`, `done|active|todo|skipped|failed`) sets states by index, also on its own for the stored list. A `steps` that is not a list is ignored, and the stored list stays.
- **Subagents:** an agent's row shows the checklist of its progress file, the one named after the slug of its description or paired with it.
- **Status line:** unchanged. The checklist shows only in the Status panel.

## Stuck and signs of life

A running row shows `⚠ stuck Nm` when nothing about it has moved for `.state/stuck-minutes` minutes (default 10). Its count and step text count, and so does any of these signs of life:

| Sign | Where it comes from |
| --- | --- |
| **Progress file written** | The job rewrote its file, even with the same numbers. A plain heartbeat works |
| **Heartbeat file written** | The file named in `heartbeat` changed, such as a log a remote job syncs here |
| **Quiet window** | `quietUntil` (from `progress_report` `expect_minutes`) is still ahead. The stuck clock starts when it ends |
| **Agent activity** | The owning subagent's transcript was written, or a background shell or Monitor it started still runs |
| **Background shell** | A shell row this session runs, while its checked transcript has no finished notice for it |
| **Watch log** | A watch file's log changed |

- **Real stalls still warn:** a row with no sign of life past the threshold, or whose quiet window ended that long ago, shows `⚠ stuck` and logs one warning to `events.jsonl`.
- **Example:** a step that starts a remote job of about 90 minutes reports `expect_minutes: 90`. The row stays a spinner until then, and warns only 10 minutes after that if nothing else moved.
- **How:** each session's plugin writes `.state/alive-<session>.json` every poll, one entry per row: `at` (the last sign of life, ms) and `until` (the quiet window, ms). `group.py` reads every such file written in the last 6 hours.
- **Transcript check:** the plugin finds this session's transcript once a minute: the last Stop's `transcript_path`, the saved path, and this session's file under its config folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`). Only a file named after this session's id counts, and the newest wins. A path saved while the session ran under another config or project folder is dropped, so finished background shells clear even when another plugin's hook skips this one's Stop hook. Shell rows left from before a `/reload-plugins` clear too, once the transcript shows them finished.

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

## Agents and their progress files

A subagent's bar sits on its line when its progress file is named after the slug of its Agent `description`, or close to it. When the name differs, the plugin pairs the agent with the one fresh file of its session created since the agent started whose name or title shares at least two of the description's words (with several, a clear leader by two words). Paired, the agent is one row with the file's title, area and progress. A file with no known birth (no `startedAt`, no file-system birth time) never pairs.

The plugin keeps the session's running agents (id, description, start, status, paired file) in `~/.claude-progress/.state/agents-<session>.json`, so after `/reload-plugins` the new copy still shows agents started before it, each paired with its file. A file named exactly the slug of a running agent's description is always that agent's, even with no `session` or `startedAt`. A paired file is stamped with the session in the plugin's own state, never in the job's file. Saved agents leave when they finish, hand their report back, or show no activity for 6 hours.

**One writer per session.** Each copy of the plugin claims its session at start in `.state/owner-<session>.json`. A copy that `/reload-plugins` replaced sees the newer claim at its next tick, stops its timers and writes nothing more, so two copies no longer take turns writing the line files (a row that came and went every few seconds). A copy also stops its timers when the session ends.

**LOCALHOST lists only real pages.** A port is listed when this session's background shell names it (`-p 3000`, `PORT=`), when a server inside the project folder or started by this project's session listens on it and answers HTTP, or when you added the page with [+ page]. System and infra listeners are never listed on their own: Docker Desktop (com.docker.backend, vpnkit, docker-proxy), OrbStack, colima/limactl, ControlCenter/AirPlay (5000, 7000), rapportd, Spotify, Dropbox, Code Helper, postgres, redis, mysqld. Hide more in `~/.claude-progress/localhost-ignore.txt`: one process name (prefix, any case) or port per line, `#` comments. A page you named stays listed. A name prompt closes when the focus leaves it or its row disappears.
