---
name: progress-reporting
description: Report progress of multi-step work to the progress-bar status line. Use whenever you start a job likely to run over a minute (a background shell job, a database refresh or migration, a data load, a remote or GPU job), when running a job with several steps, or when briefing a subagent whose work has clear steps.
---

**Rule: every long job gets a bar when you start it, not when the person asks.** If the job can write a progress file, use that. If it can't (psql, a vendor tool, a job on another machine), write a watch file for its log (below). Postgres `REFRESH MATERIALIZED VIEW`, `CREATE INDEX` and big `UPDATE`s report nothing on their own: count finished statements from the psql log.

# Progress reporting

The progress-bar plugin draws a bar for every progress file in `~/.claude-progress/`. Write one so the person can see how far a job is.

## The file

Path: `~/.claude-progress/<slug>.json`

```json
{"done": 2, "total": 5, "step": "run tests", "startedAt": 1767225600000,
 "title": "Login fix · tests and deploy", "why": "people can sign in again", "parent": "release-prep"}
```

- **done**, **total**: numbers, `total` above 0. Without them the line shows `working`.
- **step**: a few words on the current step.
- **startedAt**: optional, milliseconds since the epoch. Without it the file's time is used.
- **title**: plain words for what the job is, so a person knows it at a glance. The Status panel shows it in bold above the slug.
- **why**: what the job unlocks for the person (`the weekly report`). Shown as `unlocks: …`.
- **parent**: the slug of the bigger job this is part of. Set it when a subagent or script works for another job that has a progress file. While both run, the child draws inside the parent's card, and the parent reads `waiting on: <child>` instead of stuck.
- A job that can't write these (a log-only job) can get a line in `~/.claude-progress/titles.txt`: `<job id><TAB><title><TAB><why><TAB><parent>`.

**Slug rule:** lowercase the job's name and turn every run of characters other than `a-z` and `0-9` into `-`, trimming `-` at both ends. `Fix the Login bug!` becomes `fix-the-login-bug`.

## When to write it

- **Your own multi-step job:** write the file after each step, overwriting it. Count the steps up front.
- **Briefing a subagent:** name the slug from the subagent's `description` and add to its prompt: "After each step overwrite `~/.claude-progress/<slug>.json` with `{"done": N, "total": T, "step": "<short>"}`. Delete it when finished. Steps: ...". The plugin then puts the bar on that subagent's line.
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

Delete the file. A file untouched for 10 minutes stops showing anyway.

## Events: the Status panel's Log tab

Finishes, stuck jobs and problem rows are logged on their own. To log something else (a failure you caught, a result worth seeing later), append an event:

```sh
python3 ~/.claude/progress-bar/events.py add error nightly-import "Nightly import crashed" "ValueError: bad row 1204" ~/logs/nightly-import.log
```

Levels: `error`, `warning`, `success`, `info`. Keep the title to a few plain words. To have job logs scanned for errors, add their folder to `~/.claude-progress/log-dirs.txt`.

## To-dos: keep `~/.claude-progress/todo.txt` current

The status line shows open to-dos first, in a `☐ TO-DO` section. Keep the list true to what is left to do.

```
[you]
Review the deploy PR | https://github.com/org/repo/pull/12
[mac]
Load the 2026 batch (after import)
x Rebuild the index
```

- **Add an item** when work is queued for later, or handed to the person (a review, a sign-in, a decision).
- **Mark it done** when finished: prefix `x ` (hidden from the status line). Don't delete other people's items.
- **Short items:** a few words, the action first. Add ` | <url>` to make it clickable.
- **Group by owner or machine** under `[name]` headings (`[you]`, `[mac]`, `[server]`). Any name works.
- Edit the file directly, or use `/progress-bar todo add [name] <text>`, `todo done <n|text>`, `todo clear`.

## Shell helper

```sh
progress() { # progress <slug> <done> <total> <step>
  mkdir -p ~/.claude-progress
  printf '{"done":%s,"total":%s,"step":"%s"}\n' "$2" "$3" "$4" > ~/.claude-progress/"$1".json
}

for i in 1 2 3; do
  progress nightly-import "$((i-1))" 3 "batch $i"
  ./import.sh "batch-$i"
done
rm -f ~/.claude-progress/nightly-import.json
```

Keep `step` free of double quotes so the JSON stays valid.
