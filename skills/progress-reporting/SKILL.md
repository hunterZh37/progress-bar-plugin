---
name: progress-reporting
description: Report progress of multi-step work to the progress-bar status line. Use when running a job with several steps, a long shell or background job, or when briefing a subagent whose work has clear steps.
---

# Progress reporting

The progress-bar plugin draws a bar for every progress file in `~/.claude-progress/`. Write one so the person can see how far a job is.

## The file

Path: `~/.claude-progress/<slug>.json`

```json
{"done": 2, "total": 5, "step": "run tests", "startedAt": 1767225600000}
```

- **done**, **total**: numbers, `total` above 0. Without them the line shows `working`.
- **step**: a few words on the current step.
- **startedAt**: optional, milliseconds since the epoch. Without it the file's time is used.

**Slug rule:** lowercase the job's name and turn every run of characters other than `a-z` and `0-9` into `-`, trimming `-` at both ends. `Fix the Login bug!` becomes `fix-the-login-bug`.

## When to write it

- **Your own multi-step job:** write the file after each step, overwriting it. Count the steps up front.
- **Briefing a subagent:** name the slug from the subagent's `description` and add to its prompt: "After each step overwrite `~/.claude-progress/<slug>.json` with `{"done": N, "total": T, "step": "<short>"}`. Delete it when finished. Steps: ...". The plugin then puts the bar on that subagent's line.
- **Background shell jobs:** have the script write the file itself (below).

## When done

Delete the file. A file untouched for 10 minutes stops showing anyway.

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
