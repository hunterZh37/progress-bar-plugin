---
name: progress-reporting
description: Report progress of multi-step work to the progress-bar status line. Use whenever you start a job likely to run over a minute (a background shell job, a database refresh or migration, a data load, a remote or GPU job), when running a job with several steps, or when briefing a subagent whose work has clear steps.
---

**Rule: every long job gets a bar when you start it, not when the person asks.** If the job can write a progress file, use that. If it can't (psql, a vendor tool, a job on another machine), write a watch file for its log (below). Postgres `REFRESH MATERIALIZED VIEW`, `CREATE INDEX` and big `UPDATE`s report nothing on their own: count finished statements from the psql log.

# Progress reporting

The progress-bar plugin draws a bar for every progress file in `~/.claude-progress/`. Write one so the person can see how far a job is.

**Already automatic:** your own task list (TodoWrite, TaskCreate, TaskUpdate) shows as one bar, a Bash command over a minute or in the background shows as a working row, and every subagent gets a line. Report on top of that for named jobs with steps.

## Always say which part of the goal gets better, and how

The Status panel groups every job under an area of the person's goal (`~/.claude-progress/goal.json`, for example "Making the generosity database better" with areas Organizations, Finances, Boards & people, Grants, Places, Causes, Answer quality, Tools). Anyone should be able to read it at a glance. On every job, set:

- **area**: the goal area it improves, by name (`Boards & people`). Pick from goal.json's areas. Never leave it out: a guess from keywords can land a job in the wrong place.
- **title**: the improvement itself, in plain words, not the machine or the mechanism (`Every board member counted, not just 25`).
- **gains**: which of cost, quality, speed the job makes better, each a short plain line with a number when possible: `{"quality": "1.65M more board seats counted", "speed": "labels in 7h instead of 12h", "cost": "$14 of Jev instead of 34h of Claude"}`. Name only the ones that apply.
- **impact** (before it ends): how the database, or whatever the goal names, is better now, with the key number.

## Easiest: the progress_report tool

Call `progress_report` (from the progress-bar plugin) when the job starts and after each step:

```
progress_report(title: "Every board member counted, not just 25", why: "board links and people search see whole boards", area: "Boards & people", gains: {"quality": "1.65M more board seats counted"}, done: 2, total: 5, step: "run tests")
```

- It writes `~/.claude-progress/<slug of title>.json` with this session's id, folder and `startedAt` filled in, so the bar shows in this session's Status panel on any machine.
- Pass `slug` to pick the file name, `parent` to nest it under a bigger job.
- Pass `reads` and `writes` for a job that moves data between machines (`reads: "nombot.board_members_history"`, `writes: "Postgres via work-mac"`). The Status panel's Topology tab shows them on the branch between machines.
- At the end call it with `finished: true` and `impact`: what the job changed and why it matters, one to three short lines (`Board links rebuilt: 1.29M pairs, 109K split people merged`). That removes the bar and keeps the impact on its DONE row.
- No tool (a shell script, a job on another machine)? Write the file yourself (below).

## The file

Path: `~/.claude-progress/<slug>.json`

```json
{"done": 2, "total": 5, "step": "run tests", "startedAt": 1767225600000,
 "title": "Login fix · tests and deploy", "why": "people can sign in again", "parent": "release-prep",
 "session": "<session id>", "cwd": "/absolute/working/dir",
 "area": "Tools", "gains": {"quality": "login works for all 3 providers"},
 "impact": "Login works again for all 3 providers\n41 tests added"}
```

- **done**, **total**: numbers, `total` above 0. Without them the line shows `working`.
- **step**: a few words on the current step.
- **startedAt**: optional, milliseconds since the epoch. Without it the file's time is used.
- **title**: plain words for the improvement the job makes, so a person knows at a glance why it runs. Name the outcome, not the mechanism: `Every board member counted, not just 25` rather than `Board lists past 25 seats`, `Know where more orgs serve` rather than `Service places round 3`. The Status panel shows it in bold above the slug.
- **area**: the goal area the job improves, by name from `~/.claude-progress/goal.json` (`Grants`, `Boards & people`). Always set it.
- **gains**: an object with any of `cost`, `quality`, `speed`, each a short plain line with a number when possible. State which of the three your job improves. They show as 💲 💎 🚀 tags on its row.
- **why**: what the job unlocks for the person (`the weekly report`). Shown dim under its row.
- **parent**: the slug of the bigger job this is part of. Set it when a subagent or script works for another job that has a progress file. While both run, the child draws inside the parent's card, and the parent reads `waiting on: <child>` instead of stuck.
- **session**: the Claude Code session id, so the bar shows only in this session. In Bash it is `$CLAUDE_CODE_SESSION_ID`. Add it whenever you can.
- **impact**: set it just before the job ends. Answer one question: how is the thing this job works on better now? Say what it now has or gets right, with the key number, and who or what benefits, one to three short lines (newlines split them). Example: `1.65M more board seats, so board links and people search see whole boards`. Skip mechanics like commit ids, accounts or file names. The Status panel shows it when the job's DONE row is opened. Without it the row says `no impact reported`.
- **reads**, **writes**: optional short strings, what the job reads and writes (`nombot.board_members_history`, `Postgres via work-mac`). The Topology tab shows them on the branch between machines and in the job's details. Without `reads` a job on a helper machine is drawn reading from the data host's database. Set `writes` only when the job writes back.
- **cwd**: always add it, the absolute folder you work in. The bar then shows in the sessions of that project, even when the session id is missing or that session has closed.
- Without `session` and `cwd`, the bar goes to the shared list, which may show in no session on a machine that routes it elsewhere.
- A job that can't write these (a log-only job) can get a line in `~/.claude-progress/titles.txt`: `<job id><TAB><title><TAB><why><TAB><parent><TAB><area>`.

**Slug rule:** lowercase the job's name and turn every run of characters other than `a-z` and `0-9` into `-`, trimming `-` at both ends. `Fix the Login bug!` becomes `fix-the-login-bug`.

## When to write it

- **Your own multi-step job:** write the file after each step, overwriting it. Count the steps up front.
- **Briefing a subagent:** name the slug from the subagent's `description` and add to its prompt: "After each step call `progress_report` with slug `<slug>`, area `<area>`, done N, total T and a short step, and `finished: true` at the end with impact and gains (which of cost, quality, speed got better, with a number). Without that tool, overwrite `~/.claude-progress/<slug>.json` with `{"done": N, "total": T, "step": "<short>", "area": "<area>", "session": "<$CLAUDE_CODE_SESSION_ID>", "cwd": "<absolute working dir>"}` and delete it when finished. Steps: ...". The plugin then puts the bar on that subagent's line.
- **Background shell jobs:** have the script write the file itself (below).

## Jobs that only write a log: watch files

Path: `~/.claude-progress/<slug>.watch.json`, written once when the job starts. The plugin reads the log every 5 seconds.

```json
{"log": "~/logs/import.log", "match": "(\\d+)/(\\d+) batches", "process": "import.py", "startedAt": 1767225600000}
```

- **Count by `match`:** a regex with two groups, done and total. The last match in the log wins.
- **Or by `count` + `total`:** done is how many lines match `count`, one per finished step.
- **`step`:** optional regex; group 1 of its last match (or the whole match) is shown as the step.
- **`error`:** optional regex; a match shows `✖ error`.
- **`process`:** optional `pgrep -f` pattern. Gone before done shows `■ stopped`. Pick a pattern that matches only the job, not your own shell (`^python .*import\.py`).
- **`startedAt`:** set it (`date +%s000`) to get an ETA.
- **`label`:** the name shown; the slug otherwise.
- Done shows `✔` and the row hides 10 minutes after the log's last write. Delete the watch file when you've reported the result.

**psql script, one step per statement:** run it with `-X -v ON_ERROR_STOP=1 -f job.sql > job.log 2>&1` and count result tags:

```sh
cat > ~/.claude-progress/db-refresh.watch.json <<EOF
{"log": "$PWD/job.log", "count": "^(REFRESH MATERIALIZED VIEW|CREATE INDEX|UPDATE \\\\d+|\\\\(1 row\\\\))$", "total": 5,
 "error": "^(psql:.*)?ERROR", "process": "psql .*job\\\\.sql", "startedAt": $(date +%s000)}
EOF
```

**Job on another machine:** sync its log here in the background (`while sleep 20; do scp -q host:job.log ~/logs/job.log; done`) and watch the copy.

## When done

Write `impact` and `gains` into the file, wait 5 seconds (one poll, so the plugin saves it), then delete the file. Or call `progress_report` with `finished: true`, `impact` and `gains`. A file untouched for 10 minutes stops showing anyway.

**Subagents:** your final report is your impact. Start it with one bold sentence on how the work made things better, with numbers (`**One person is one person now: 109K split board members merged, so board links stop double counting.**`). The plugin keeps that sentence, or your first 2 to 3 lines.

## Events: the Status panel's Log tab

Finishes, stuck jobs and problem rows are logged on their own. To log something else (a failure you caught, a result worth seeing later), append an event:

```sh
python3 ~/.claude/progress-bar/events.py add error nightly-import "Nightly import crashed" "ValueError: bad row 1204" ~/logs/nightly-import.log
```

Levels: `error`, `warning`, `success`, `info`. Keep the title to a few plain words. To have job logs scanned for errors, add their folder to `~/.claude-progress/log-dirs.txt`.

## To-dos: keep this project's list current

Each project has its own list: `~/.claude-progress/todos/<project>.txt` (the slug of the git root under home, so `~/code/shop` is `code-shop.txt`), unless `~/.claude-progress/todos/projects.txt` maps the folder to another file such as `todo.txt`. `/progress-bar todo` shows which list this session uses. The status line shows open to-dos first, in a `☐ TO-DO` section. Keep the list true to what is left to do.

```
[you]
Review the deploy PR | https://github.com/org/repo/pull/12
[mac]
Load the 2026 batch (after import)
x Rebuild the index
```

- **Add an item** when work is queued for later, or handed to the person (a review, a decision).
- **Blocked on the person?** When work cannot go on until they run something (a blocked command, a deploy swap, a login, deleting a repo), add an action with the `action_add` tool instead (see the `action-needed` skill). It pops up and holds their next prompt until done.
- **Mark it done** when finished: prefix `x ` (hidden from the status line). Don't delete other people's items.
- **Short items:** a few words, the action first. Add ` | <url>` to make it clickable.
- **Group by owner or machine** under `[name]` headings (`[you]`, `[mac]`, `[server]`). Any name works.
- **Priority:** start machine items with `1. `, `2. ` (1 first). End one with `(after <job words>)` when it must wait for a running job. When a job finishes, the plugin may send "Next up from the to-do list: <item>": start that item with a progress bar and take it off the list.
- Prefer `/progress-bar todo add [name] <text>`, `todo done <n|text>`, `todo clear`, which always pick this project's list. Edit the file directly only when you know which one it is.

## Shell helper

```sh
progress() { # progress <slug> <done> <total> <step>
  mkdir -p ~/.claude-progress
  printf '{"done":%s,"total":%s,"step":"%s","session":"%s","cwd":"%s"}\n' "$2" "$3" "$4" "$CLAUDE_CODE_SESSION_ID" "$PWD" > ~/.claude-progress/"$1".json
}

for i in 1 2 3; do
  progress nightly-import "$((i-1))" 3 "batch $i"
  ./import.sh "batch-$i"
done
# impact: what the run changed, then a poll's time for the plugin to save it
printf '{"done":3,"total":3,"step":"done","impact":"Loaded 3 batches","session":"%s","cwd":"%s"}\n' "$CLAUDE_CODE_SESSION_ID" "$PWD" > ~/.claude-progress/nightly-import.json
sleep 6
rm -f ~/.claude-progress/nightly-import.json
```

Keep `step` free of double quotes so the JSON stays valid.
