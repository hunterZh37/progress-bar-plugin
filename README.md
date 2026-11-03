# progress-bar

Live progress bars in the Claude Code status line. One line per running subagent and per long job. Updates every 5 seconds.

```
▶ build-docs ████████░░░░░░░░░░░░ 40.0% · 2/5 · render pages · 3m · 14 tools
▶ fix-login-bug working · 1m · 6 tools · Edit
▶ nightly-import ████████████████░░░░ 80.0% · 4/5 · batch 4 · 12m
```

## What it does

- **Subagents:** every running subagent gets a line with its age, tool calls and last tool.
- **Real bars:** a subagent or shell job that writes `~/.claude-progress/<slug>.json` gets a bar with percent, count and step.
- **Skill:** `progress-reporting` tells Claude to write those files for multi-step work and to ask subagents to do the same.
- **Status line:** a small script prints the bars above your existing status line.

## Install

At the prompt of a terminal session:

```
/plugin marketplace add OWNER/progress-bar
/plugin install progress-bar@progress-bar
```

Or in one line:

```
/plugin install progress-bar --marketplace OWNER/progress-bar
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install progress-bar --marketplace OWNER/progress-bar`.

## Set up the status line

```
/progress-bar setup
```

This writes `~/.claude/progress-bar/statusline.sh`. It never edits your settings. Add the line it prints to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "~/.claude/progress-bar/statusline.sh" }
```

Already have a status line? Setup reads it and builds it into the script. The bars print first, then your old status line, which still gets the session JSON on stdin. Run setup before you change the setting.

## Commands

| Command | Does |
| --- | --- |
| `/progress-bar` | Shows the current bars and whether the status line is set up |
| `/progress-bar setup` | Writes the status line script |
| `/progress-bar demo` | Runs a 20 second demo job so you can see a bar |
| `/progress-bar clear` | Deletes stale progress files |

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

## How it works

- The plugin lists subagents, counts their tool calls and reads the progress files.
- It writes the lines to `~/.claude-progress/.lines/agents.txt`. At most 6 lines.
- The status line script prints every `.lines/*.txt` file changed in the last 2 minutes. Other tools can drop their own lines there too.

## Privacy

Everything stays on your machine. The plugin reads and writes only files under `~/.claude-progress/` and `~/.claude/progress-bar/`. No network calls.

## License

MIT
