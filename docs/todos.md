# To-dos

The per-project to-do list, priorities, blockers and auto-next.

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
[server-1]
1. Rebuild the search index (after 2019-20 load)
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
- **Machine:** a `<host>: name` job, or a title that starts with a heading name (`Server-1 CPU batch`), belongs to that heading. Any other job belongs to `[mac]` or `[local]`. `[you]` items never start on their own.
- **Mode:** `/progress-bar autonext on|off|ask`, saved in `~/.claude-progress/.state/autonext`. `on` sends the prompt. `ask` (the default) shows a toast and puts the prompt in the prompt box as a suggestion, so Tab starts it. `off` does nothing. The panel menu's `▶ Start` sends the same prompt for any ready item.
- **Caps:** `~/.claude-progress/.state/caps` holds one `machine=N` per line (default `local=3`, other machines have no cap until listed, such as `server-1=2`). A machine with N or more RUNNING rows waits, and the next one starts once a row finishes.
- **Once:** every open session checks every 5 seconds, and only one acts on a finish. It claims the finish with a folder under `~/.claude-progress/.state/autonext-claims/`, and holds the item for 6 hours so two finishes never start the same to-do. The session that ran the finished agent goes first. Others wait 20 seconds.
- **Per project:** a session starts items from its own project's list only.
- **Claude keeps it current:** the skill tells Claude to add items when work is queued or handed to you and to mark them done when finished.

## Per-project to-dos

Each session shows the to-dos of its own project, and only its own running and done jobs.

- **Which list:** the session's folder picks it. The git root above that folder, as a path under home, names the list: a session in `~/code/shop/web` uses `~/.claude-progress/todos/code-shop.txt`. A folder outside any repo uses its own path.
- **Map folders:** `~/.claude-progress/todos/projects.txt` holds `<path prefix><TAB><project>` rows. The longest prefix that holds the folder wins. A project ending `.txt` is a file under `~/.claude-progress`, so `todo.txt` keeps the old single list for those folders. Any other name means `todos/<name>.txt`.

```
# prefix<TAB>project
~/code/myapp	todo.txt
~/scripts	todo.txt
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
