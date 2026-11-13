# Changelog

Versions of the progress-bar plugin, newest first. Each line is the release commit. Full detail is in the git history.

## 0.33.1

- **No repeated step:** the job's `step` shows once, on the step line. Before, every current (`◐`) item in the checklist ended with it too, inline and in the opened card.
- **Item notes:** a step item can carry its own `note` (`{"name": "build", "state": "active", "note": "needs review"}`), shown dim after its name. Only items with a note show one.
- **Run time:** when the step names a current item, only that item carries the run time, not every current one.

## 0.33.0

- **Inline checklist:** a running row with `steps` shows its checklist under the step line, no press needed. The first dim line takes the `⎿`, the rest line up under it.
- **Compact:** at most 5 items, one before the current item, the current one and up to 3 after, then `… N more` dim.
- **No repeats:** when the step is the current item's name, the checklist replaces the step line and the current item carries the run time.
- **Panel height:** at most 3 running rows show an inline checklist. The rest show only their step line.
- **Card:** an opened row shows the full list as before (up to 12 lines with a window).
- **Option:** **Inline step checklist** (`inlineSteps`) in `/config`, on by default. Off shows the list only in the opened card.
- **Unchanged:** waiting rows, DONE rows and the status line.

## 0.32.0

- **Step checklist:** a progress file can list its steps in order (`steps`). Press a running row's title and its card shows them under the step line: `✓` done and `○` to do dim, `◐` the current one in normal weight, `✖` failed in red, `·` skipped dim and struck through.
- **States:** an item follows `done` (before it done, at it current, after it to do), or names its own state with `{"name", "state"}`. When the list's length differs from `total`, the bar follows `total` and the list still shows.
- **Long lists:** up to 12 lines, a longer list as a window around the current item with `… N earlier` and `… N more`. Names are cut with `…` to the card.
- **progress_report:** takes `steps` (up to 50, more are cut) and `step_states`. Later calls without `steps` keep the stored list, `finished: true` clears it. A `steps` that is not a list is ignored with a note.
- **Subagents:** an agent row shows the checklist of its progress file (the slug of its description).
- **Skill:** the progress-reporting skill tells agents to pass `steps` on their first call when the steps are known.
- **Status line:** unchanged.

## 0.31.2

- **One project per list:** folders that `projects.txt` maps to the same list (like two folders on `todo.txt`) share one project. Before, each folder got its own name, so an action added from one folder never showed in a session of the other, and a `cwd` job from one fell back to the shared `jobs.txt`.
- **Worktrees:** a session or job in a git worktree uses its repo's project and list. Before, a worktree outside a mapped prefix got its own empty list. A `projects.txt` prefix on the worktree itself still wins.
- **Actions** are tagged with the list (`todo.txt`), so older builds match them too. Ones tagged with a folder name still show in every folder sharing that list.

## 0.31.1

- **Stop confirm never sticks:** the `[x]` confirm under a RUNNING row is no longer kept across `/reload-plugins`. It closes after 8 seconds with no choice, and on Cancel, Escape or the focus leaving it.
- **Cancel is the default:** the confirm reads `Cancel · Stop` with the focus on Cancel, so a stray Enter stops nothing. Stop takes a move to it first.
- **Exact row:** the confirm belongs to one row. `[x]` on another row moves it there.

## 0.31.0

- **No false stuck alarms:** a row reads `⚠ stuck` only when nothing shows it is alive. Its progress file or a heartbeat file written, its agent's transcript written, a background task of its agent still running, or a live background shell all count.
- **Quiet steps:** `progress_report` takes `expect_minutes` (written as `quietUntil`). No stuck warning until that time passes. It also takes `heartbeat`, a log whose writes count as life.
- **Finished shells clear:** the session's transcript path is checked once a minute. A saved path from another config or project folder is dropped for this session's newest transcript, so finished background shells leave RUNNING. Shell rows left from before a reload clear once the transcript shows them finished.
- **Real stalls still warn:** a row with no sign of life past the threshold shows `⚠ stuck` and logs one warning.

## 0.30.0

- **Any user, any project:** no author machines, projects or emails in defaults, examples or tests.
- **Topology:** with no `topology.json` the tab shows this machine alone (host name, no IPs, no services). The file is never written or overwritten.
- **Usage meter:** off by default. Turn on **Usage meter** in `/config`. Off, no `claude -p` probe runs and no meter shows.
- **Hide account emails:** a new option masks emails in the panel and the Chrome part.
- **Goal:** the default goal is the project folder name with no areas. `goal.json` is never written.
- **Caps:** the default is `local=3`. Other machines have no cap until `.state/caps` lists them.
- **Chrome line:** hidden until Claude in Chrome is used once on this machine.
- **Linux:** the inbox checker is POSIX `sh`, and process listing falls back to the Linux `ps` form.
- **README:** rewritten as a short guide. Feature detail moved to `docs/`.

## Earlier releases

- 0.32.0: running cards show the job's step checklist (`steps`), done, current and to do
- 0.31.2: folders sharing a list are one project, worktrees use their repo's list
- 0.31.1: the stop confirm never sticks or comes back after a reload, Cancel is focused first, 8 s timeout
- 0.31.0: no false stuck alarms, expect_minutes and heartbeat for quiet steps, finished shells clear when the saved transcript path is stale
- 0.30.0: neutral defaults for any user, usage meter opt-in, hideEmails, Chrome line after first use
- 0.29.1: /attach picker opens in about 0.1 s, not 2 s, by asking the frontmost terminal to show it, and focus returns to the terminal after pick or cancel
- 0.29.0: /attach opens the macOS file picker and adds the chosen files to the prompt as @ mentions, bindable to a chord
- 0.28.15: DONE TODAY is calmer, checked-off to-dos fold to one dim line, agent rows show their title, version numbers no longer split report sentences
- 0.28.14: Chrome shows on the List tab's status line after the counts, cut before them, no line under LOCALHOST
- 0.28.13: dim lines under a panel row start with ⎿, like Claude Code's transcript
- 0.28.12: servers show once under LOCALHOST (port, purpose, uptime, [x]), no SERVERS section, npm run dev finds its port from the process tree
- 0.28.11: LOCALHOST hides Docker and system listeners, honors localhost-ignore.txt, name prompt closes on focus loss
- 0.28.10: one writer per session after /reload-plugins, running agents survive a reload
- 0.28.9: LOCALHOST folds, opens pages in the browser, and lists named pages (edit, + page)
- 0.28.8: List tab always ends with LOCALHOST (this project's servers, up or down) and the Chrome account line
- 0.28.7: ADHD-friendly List tab: status at a glance, NEEDS YOU first, two-line rows, DONE folded
- 0.28.6: server rows are never stuck, an agent and its differently named progress file are one row, [x] stops or pauses a job
- 0.28.5: a Check account button on the Chrome line asks Claude to read the browser's Google account
- 0.28.4: the Chrome line follows /chrome switches and warns when the account is not on this Mac
- 0.28.3: the List tab always shows which Chrome browser and account Claude drives, refreshed every poll
- 0.28.2: the Connectors tab shows which Chrome browser and Google account Claude in Chrome drives
- 0.27.13: usage meter follows the session's own login (CLAUDE_CONFIG_DIR)
- 0.28.0: the goal line is per project (goals/<slug>.json), else the folder name
- 0.27.12: agents waiting 6h with no transcript change leave WAITING
- 0.27.11: background command rows end when the transcript shows they finished
- 0.27.10: a progress file named a little differently joins its agent's row, no double rows
- 0.27.9: keep progress files shown for 30 minutes so long steps keep their bar and impact line
- 0.27.6: an open row expands its line in place instead of repeating it
- 0.27.5: opening a row shows its whole why or impact, wrapped
- 0.27.4: TO-DO sits above RUNNING
- 0.27.3: section headers lose their hotkeys, so no 1: 2: prefixes
- 0.27.2: a calmer List tab: one-line goal, urgent sections first, two plain lines per row that never wrap apart
- 0.27.1: no emoji anywhere in the panel or status line: areas, lenses, tabs and card details are words
- 0.27.0: the familiar TO-DO, RUNNING, WAITING and DONE sections are back under the goal, with area chips that filter them and an area icon on every row
- 0.26.0: the List tab reads at a glance: the goal on top, jobs grouped by the area they improve, gains as cost, quality, speed tags
- 0.25.4: titles name the improvement and impact says how things are better now
- 0.25.3: topology.json is a data file, never a running job row
- 0.25.2: Topology is a tree again, and the data host counts its own jobs
- 0.25.1: Topology opens one row per machine, the tab bar shows icons
- 0.25.0: a Topology tab draws the machines, their jobs and what data moves
- 0.24.3: the Run confirm shows the command once and hides the other buttons until you choose
- 0.24.2: the plugin type-checks clean again
- 0.24.1: a job that just finished stays under RUNNING for a minute
- 0.24.0: DONE rows open to show what each task changed
- 0.23.5: every to-do is numbered by its place, in bold cyan
- 0.23.4: a waiting agent's reason comes from its transcript too: running tasks, last call, and the job file it writes
- 0.23.3: waiting rows say what they wait on and for how long
- 0.23.2: the usage meter uses the same thin line bar
- 0.23.1: thin line bars in the Status panel, so stacked rows stay apart
- 0.23.0: a calmer Status panel
- 0.22.9: the usage meter sits in the panel's top right corner on every tab, even with nothing running
- 0.22.8: the usage meter refreshes itself every 30 min with a tiny Haiku call on the default login, and is named by the plan
- 0.22.7: a new step text counts as progress, so long steps that keep reporting are never flagged stuck
- 0.22.6: secure channel chat checks every 3 seconds instead of 60, so messages show within seconds
- 0.22.5: secure channel invite emails never show in the inbox
- 0.22.4: Log tab rows get unique keys, so long or repeated events never blank the panel
- 0.22.3: the three old test failures fixed
- 0.22.2: a running job's bar stays on one line at any pane width
- 0.22.1: never chain another progress status line
- 0.22.0: zero setup, progress files belong to their session
- 0.21.0: Chat tab, the secure channel as a chat room in the Status panel
- 0.20.0: Action needed opens a pane in Claude Code, WAITING rows as cards
- 0.19.2: actions.json and other data files never show as running jobs
- 0.19.1: Run button for actions, runs the step in a new terminal window after you confirm
- 0.19.0: action needed, steps only you can run pop up and hold your prompts until done
- 0.18.0: secure channel, send files to a collaborator's session end-to-end encrypted
- 0.17.1: the Claude Max meter keeps its last reading when no job reports one
- 0.17.0: per-project to-dos, and the panel shows only its session's jobs
- 0.16.1: plain /progress-bar also opens the Status panel
- 0.16.0: each session's status line shows only its own bars
- 0.15.1: data files like inbox.json no longer show as running jobs
- 0.15.0: Inbox block and "✉ N need you" indicator
- 0.14.0: priority to-dos, blocked items and auto-next
- 0.13.3: press a connector to open its web page as the connected account
- 0.13.2: running lines name their machine (Mac: / Server-1: ...)
- 0.13.1: no false stuck or duplicate Log events, handed-back agents leave WAITING
- 0.13.0: overnight recap in the Status panel
- 0.12.2: agent rows show ~time left (version bump so installs pick it up)
- 0.12.1: agent cards show an estimated time left
- 0.12.1: no false problems, no duplicate done events
- 0.12.0: one line per running job, details on click
- 0.11.0: job titles, parents and a Log tab in the Status panel
- 0.10.0: running cards in the Status panel, stricter done and waiting detection in the grouper
- 0.9.0: GitHub tab in the Status panel, to-do actions re-find their line by text
- 0.8.0: herdr Connectors pane (herdr/ folder, install with herdr plugin install hunterZh37/progress-bar-plugin/herdr)
- 0.7.0: Connectors tab in the Status panel (name and status only, shared cache)
- 0.6.2: checked-off to-dos move from TO-DO to DONE in the Status panel
- 0.6.1: click a to-do in the Status panel to mark it done, reopen it or delete it
- 0.6.0: docked Status panel with foldable headers, one-line status line while it is on
- 0.5.1: faster-looking spinner (4 frames, a full turn every 4 s)
- 0.5.0: click-to-fold section headers on macOS, spinner and stuck marks for running rows
- 0.4.0: grouped status line (TO-DO / PROBLEMS / RUNNING / WAITING / DONE) and /progress-bar todo
- 0.3.0: /progress-bar fold, unfold and toggle for status line sections
- 0.2.2: no duplicate bars across sessions (agents claim their progress files), agent timers survive a reload
- 0.2.1: one agents file per session so two open sessions don't overwrite each other's bars

## Screens from earlier releases

### 0.28.7: the List tab reads in a few seconds

**Before (0.28.6)**

```
Make checkout faster · 1 done today · 2 ru…

▾ TO-DO  2
    You  1
     1. review the deploy PR

    Mac  1
  ▶  1. run import

▾ RUNNING  2
  ◐ Search index rebuild         ━━━━━━────  64%  1h19m l… [x]
    Search · faster product search
  ⚠ Nightly import             ━━━━━━━━──  80%  ⚠ stuck… [x]
    Other · the morning dashboard

▾ DONE  1
  ✓ Orders rematch  10:12
    Orders · 42K more orders matched to their customers…
```

**After (0.28.7)**

```
2 running · 2 needs you · 1 done today

NEEDS YOU  2
  ○ Review the deploy PR
  ⚠ Check Nightly import, stuck 14m

▾ TO-DO  1
    Mac  1
  ▶  1. run import

▾ RUNNING  2
  ◐ Search index rebuild  ━━━━━━────  64%  1h19m left [x]
    scoring batch 16 · 42m
  ⚠ Nightly import      ━━━━━━━━──  80%  ⚠ stuck 14m [x]
    batch 4 · 2h

▸ DONE TODAY  1
```

### 0.28.15: calmer DONE TODAY

**Before (0.28.14)**

```
▾ DONE TODAY  22
  ✓ 12) in ~/Desktop/progress-bar-plugin.  10:11
  ✓ 13 is out: every dim line under a Status panel row now starts with a …   10:19
    +2 more
    Checked-off to-dos
  ✓ Set up MFA on the AWS root login
  ✓ 1. Match more orders to customers, rematch new accounts (after
Server-1 backfill for the next 98K orders)
  ... 13 more, all bright
```

**After (0.28.15), folded**

```
▾ DONE TODAY  22
  ✓ Servers show once, under LOCALHOST                  10:11
  ✓ Status panel sub-lines start with ⎿                 10:19
    +2 more
    ▸ 15 checked-off to-dos
```

**After (0.28.15), to-dos opened** (dim, one line each, no `1.` places)

```
    ▾ 15 checked-off to-dos
  ✓ Set up MFA on the AWS root login
  ✓ Save a setup token on the laptop so it can …
  ✓ Let the laptop read the database: run the two Act…
  ✓ Match more orders to customers, rematch…
  ✓ Board links for people on more than 8 boards in a s…
    +10 more
```
