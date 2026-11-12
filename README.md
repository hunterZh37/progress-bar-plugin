# progress-bar

Live progress bars, a to-do list and a docked Status panel for Claude Code. One line per running subagent and per long job, grouped by state, updated every 5 seconds.

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

### Core

- **Subagents:** every running subagent gets a line with its age, tool calls and last tool.
- **Your task list:** when Claude keeps a task list (TodoWrite, TaskCreate, TaskUpdate), it shows as one bar.
- **Long commands:** a Bash command that runs over a minute, or in the background, shows as a row until it ends.
- **Real bars:** a job that writes `~/.claude-progress/<slug>.json` gets a bar with percent, count, step and time left. See [docs/progress-files.md](docs/progress-files.md).
- **Bars from logs:** a job that only writes a log gets a bar from a watch file, with `■ stopped` or `✖ error` when it dies.
- **Groups:** lines sort into TO-DO, PROBLEMS, RUNNING, WAITING and DONE. A row that has not moved for 10 minutes, with no other sign of life, shows `⚠ stuck`. A long quiet step can say how long it takes (`expect_minutes`) or name a log that keeps changing (`heartbeat`). See [docs/progress-files.md](docs/progress-files.md#stuck-and-signs-of-life).
- **To-dos:** each project has its own list, with priorities, blockers and auto-next. See [docs/todos.md](docs/todos.md).
- **Status panel:** a docked pane beside the chat with List, Connectors, GitHub, Log, Chat and Topology tabs. See [docs/status-panel.md](docs/status-panel.md).
- **Action needed:** a step only you can run holds your next prompt until it is done or skipped. See [docs/action-needed.md](docs/action-needed.md).
- **Skills:** `progress-reporting` has Claude report multi-step work, `action-needed` has it hand you steps it cannot run.

### Optional extras

Each one stays out of the way until you set it up.

| Extra | What it does | Docs |
| --- | --- | --- |
| **Topology** | Draws your machines and what data moves between them. Shows this machine alone until you write `topology.json` | [docs/topology.md](docs/topology.md) |
| **Inbox** | Lists what needs you, from any script that writes `inbox.json`, with an example Gmail checker | [docs/inbox.md](docs/inbox.md) |
| **Overnight recap** | Shows what happened while you were away, from a checkpoint you save | [docs/overnight-recap.md](docs/overnight-recap.md) |
| **Secure channel** | Sends files to a collaborator's Claude Code session, end-to-end encrypted, over a private GitHub repo | [docs/secure-channel.md](docs/secure-channel.md) |
| **Chat** | Chat lines over a secure channel, in the panel's Chat tab | [docs/secure-channel.md](docs/secure-channel.md) |
| **herdr** | A connectors side pane for the herdr terminal workspace | [herdr/README.md](herdr/README.md) |
| **/attach** | macOS file picker that adds files to your prompt as `@` mentions | [docs/attach.md](docs/attach.md) |
| **Usage meter** | Your plan's 7-day usage in the panel. Off by default, see Configuration | [docs/status-panel.md](docs/status-panel.md) |

## Install

In Claude Code, one command:

```
/plugin install progress-bar --marketplace hunterZh37/progress-bar-plugin
```

Or add the marketplace first, then install:

```
/plugin marketplace add hunterZh37/progress-bar-plugin
/plugin install progress-bar@progress-bar
```

Restart Claude Code. From the next session on, the status line shows the bars and the Status panel opens beside the chat. No setup command and no settings to edit.

The first session writes `~/.claude/progress-bar/statusline.sh` with its Python helpers, and points the status line at it through the plugin. Your settings files are not edited. A status line you already had still prints below the bars. `/progress-bar setup` prints the settings line for a status line you manage yourself.

## Requirements

- **Claude Code** with plugin support.
- **python3** on the `PATH` for grouping. Without it the lines print ungrouped.
- **macOS** is the main platform. Everything works there.
- **Linux:** the status line, the panel, to-dos, progress files, topology, the inbox checker and the secure channel work. `/attach`, click to fold, **▶ Run** for actions and the away notification need macOS.
- **Windows** is not supported.
- **Secure channel only:** `gh` (logged in), `git` and `openssl` (LibreSSL 3.3+ or OpenSSL 1.1.1+).

## Commands

| Command | Does |
| --- | --- |
| `/progress-bar` | Shows the bars as text and opens the Status panel |
| `/progress-bar setup` | Writes the status line script and prints the settings line |
| `/progress-bar setup mac-clicks` | macOS: click a section header to fold it. `off` removes it |
| `/progress-bar demo` | Runs a 20 second demo job |
| `/progress-bar clear` | Deletes stale progress files |
| `/progress-bar todo` | Lists to-dos. `add [name] <text>`, `done <n\|text>`, `clear` |
| `/progress-bar autonext on\|off\|ask` | What happens when a job finishes: start the next to-do, suggest it (default) or nothing |
| `/progress-bar panel` | Opens the Status panel. `panel off` stops it opening at start, `panel on` turns it back on |
| `/progress-bar checkpoint [label]` | Saves the running jobs for the overnight recap. `away` does the same |
| `/progress-bar action` | Lists open actions. `action add`, `done [n]`, `skip [n] <reason>`, `copy [n]`, `check` |
| `/progress-bar inbox` | Lists what needs you. `inbox setup` writes the example Gmail checker |
| `/progress-bar channel invite\|join\|list\|read\|check\|leave` | Manages secure channels |
| `/progress-bar send <file> to <name>` | Sends a file through a channel |
| `/progress-bar say <name> <text>` | Sends a chat line through a channel |
| `/progress-bar fold <section>` | Folds a section to one line. `unfold` opens it, `toggle` flips it |
| `/attach` | macOS: picks files and adds them to your prompt |

## Reporting progress

Claude calls the plugin's `progress_report` tool. A script writes the file itself:

```sh
progress() { mkdir -p ~/.claude-progress; printf '{"done":%s,"total":%s,"step":"%s"}\n' "$2" "$3" "$4" > ~/.claude-progress/"$1".json; }
progress nightly-import 2 5 "batch 3"
```

Delete the file when the job ends. Add `steps` (the step names in order) and the job's row shows them as a checklist under it, its card in full. The full format, with `title`, `why`, `parent`, `steps`, `impact` and watch files, is in [docs/progress-files.md](docs/progress-files.md).

## Configuration

### Options

Set these in `/config`, under progress-bar.

| Option | Default | Does |
| --- | --- | --- |
| **Progress status line** (`statusLine`) | on | Shows the bars in the status line. Off leaves your status line alone |
| **Open the Status panel** (`openPanel`) | on | Opens the panel at session start. Off keeps it closed until `/progress-bar` |
| **Usage meter** (`usageMeter`) | off | Shows your plan's 7-day usage in the panel. On, one session per machine runs a tiny `claude -p` Haiku call every 30 minutes on your login to read it |
| **Hide account emails** (`hideEmails`) | off | Masks account emails in the panel and the Chrome part, such as `j•••@example.com`, for screen sharing |
| **Inline step checklist** (`inlineSteps`) | on | Shows a running job's `steps` under its row (up to 5 items, on up to 3 rows). Off shows them only in the opened card |

### Environment variables

| Variable | Does |
| --- | --- |
| `PROGRESS_DIR` | Where the status line's Python helpers (`group.py`, `events.py`, `checkpoint.py`) read and write. Default `~/.claude-progress`. The plugin itself always uses `~/.claude-progress` |
| `PB_CHANNEL_HOME` | Where the secure channel keeps keys, repos and received files. Default `~/.claude-progress/channel` |
| `PB_FULL`, `PB_UNFOLD` | Set by the panel when it runs the status line script: the full view, every section open |
| `PB_SID`, `PB_CWD` | Set by the status line script for its helpers: the session id and folder |
| `INBOX_ACCOUNT` | The Gmail address for the example inbox checker |
| `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_STATE_DIR` | Set by herdr for the herdr pane |

### Files you can edit

All under `~/.claude-progress/`. None is needed. Each is read only when it exists.

| File | Does |
| --- | --- |
| `todos/<project>.txt` | This project's to-do list. `todos/projects.txt` maps folders to lists |
| `goals/<project>.json` | The project's goal and areas for the List tab |
| `topology.json` | Your machines and services for the Topology tab |
| `titles.txt` | Titles for jobs that cannot write a progress file |
| `links.txt` | Where a job name links to |
| `log-dirs.txt` | Log folders the Log tab scans for errors |
| `repos.txt` | More repos for the GitHub tab |
| `connector-accounts.txt` | Which account each connector uses |
| `chrome-local-accounts.txt` | This Mac's Google accounts, for the Chrome warning |
| `localhost-ignore.txt` | Processes or ports to leave out of LOCALHOST |
| `.state/caps` | `machine=N` lines: how many jobs auto-next runs at once per machine. Default `local=3` |
| `.state/stuck-minutes` | Minutes with no sign of life before a row reads stuck. Default 10 |

## Privacy

Everything stays on your machine unless you turn on a feature that says otherwise.

- **Local files only:** the plugin reads and writes under `~/.claude-progress/`, `~/.claude/progress-bar/` and `~/.cache/progress-bar/`, plus log folders you list.
- **Read only:** Chrome's `Local State` file (profile emails), and the session transcript's latest lines for `/chrome` switches.
- **No network of its own,** with these exceptions:
  - **Usage meter (off by default):** when you turn it on, one session per machine runs `claude -p --model haiku` every 30 minutes (at most 48 calls a day) on your default login, with no tools, no MCP and no settings. It counts toward your plan's usage, about 3.5k tokens a call. API keys are unset for the call.
  - **Connectors tab:** while the panel is open, it runs `claude mcp list` (which contacts your connectors) and `claude auth status`, at most every 5 minutes. Only names, status, email and org are kept.
  - **Secure channel:** once you open one, it talks to GitHub through your own `gh` and `git` and stores only ciphertext there.
  - **Inbox checker:** runs only when you schedule it, through your own Gmail connector.
- **Commands you approve:** an action's command runs only when you press **▶ Run** and confirm, in a terminal window you can see.
- **Emails on screen:** the Chrome line and Connectors tab show account emails. Turn on **Hide account emails** to mask them.

## Uninstall

1. Run `/plugin uninstall progress-bar@progress-bar` and restart Claude Code.
2. If you ran `/progress-bar setup` or pressed **▶ Turn on status line**, a settings file has `"statusLine"` pointing at `~/.claude/progress-bar/statusline.sh`. Put back your old command (the script's `prev=` line holds it) or remove the entry.
3. Remove the data, if you want it gone:

```sh
rm -rf ~/.claude-progress ~/.claude/progress-bar ~/.cache/progress-bar
```

4. macOS, if you ran `setup mac-clicks`: run `/progress-bar setup mac-clicks off` before uninstalling, or delete `~/Applications/ProgressBarToggle.app`.
5. If you bound `/attach` to a key, remove the `command:attach` line from `~/.claude/keybindings.json`.

`~/.claude-progress` holds your to-do lists, goals and secure channel keys. Keep a copy first if you want them.

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
