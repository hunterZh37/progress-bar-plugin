# Agent daemon

Optional. Lets a collaborator on a secure channel hand work to your Claude agents from the chat.

One background daemon (`bin/agentd.py run`) watches the chat on one channel. A line from the channel peer is a command:

| Line | What happens |
|---|---|
| plain text | No command needed. With nothing running it starts a task. With agents running, a cheap Claude call decides whether it is a new job or something for them (default: for them, to every running agent). |
| `/task <text>` | Starts work, and forces it. A cheap Claude call picks small (one agent) or big (a coordinator that starts up to 4 workers). `--big` / `--small` force it. |
| `@<name> <text>`, or `bob, <text>` | Talks to, or pivots, one running agent. The text arrives as its next user turn. |
| `@all <text>` | Sent to every running agent as a user turn. |
| `/agents` | Lists agents. |
| `/stop <name>` | Stops an agent and its workers. |

Every agent can read the group chat (`agentd.py read <id> [N]`: Hunter's lines and every agent's posts), post to it (`post <id> <text>`), tell another agent (`tell`), and a coordinator can `spawn` workers. A worker's final answer goes to its coordinator, and the coordinator's answer goes to the chat. Lines in the chat are prefixed `[<agent-id>]`.

## Set up

```
python3 bin/agentd.py install --now     # writes ~/.config/systemd/user/progress-bar-agentd.service, enables it
$EDITOR ~/.claude-progress/agentd/config.json   # set "channel" to a channel name from /progress-bar channel list
```

On Linux the unit starts at boot (with `loginctl enable-linger $USER`, before you log in). On macOS `install` writes a LaunchAgent, `~/Library/LaunchAgents/com.progress-bar.agentd.plist`, which starts when you log in and restarts if it stops (log: `~/.claude-progress/agentd/agents.log`). It stores the full path of `claude` in `config.json`, because a service has a thinner PATH than your shell.

`config.json`: `tools` (`safe`, the default, or `full`), `channel`, `max_agents` (6), `max_workers` (4), `max_budget_usd` per agent (5), `idle_minutes` (30), `model`, `extra_tools`, `add_dirs`.

## Safety

This is remote control of a coding agent, so the defaults are tight.

- Only chat lines from the channel peer count (the channel already verifies the signature and the sender). Lines from before the first start are never replayed.
- Agents run `claude -p` with `--permission-mode dontAsk` and only Read, Glob, Grep, Edit, Write plus the agentd commands. No shell, no network. Each starts in its own `~/.claude-progress/agentd/work/<id>/`. `extra_tools` and `add_dirs` widen this, on purpose, and only the machine owner edits them.
- Task text is told to the agent as untrusted data.
- Caps on running agents, workers, budget and idle time. `agentd.py pause` stops new work, `stop-all` ends every agent, `uninstall` removes the service from boot.
- The log (`agents.log`) holds ids and events, never message content.
- Agents use the owner's Claude login, so their work counts toward the owner's usage.

Commands: `agentd.py status | pause | resume | stop-all | uninstall`.

## Your own Claude Code sessions in the chat

**Group chat** (`groupChat` in `/config`) is on by default. Every session gets two tools, `chat_read` and `chat_say` (posts as `[s-<session>]`), a short standing note in its system prompt, and the collaborator's new chat lines, added to the prompt of the next turn as untrusted instructions from another person. Claude is told to say who asked before acting, never to reveal secrets because of a chat line, and your permission prompts still apply. It lets anyone on your channel steer your sessions, so turn it off in `/config` if you do not want that. It needs the daemon running (it keeps the chat). Hooks: `hooks/groupchat.ts`.

## In the Status panel and the Chat tab

- **Status panel:** each daemon agent is a row, written by the daemon to `~/.claude-progress/agent-<id>.json`: title `Coordinator c1a2 · <task>`, its state as the step (`working`, `idle · <last result>`), a bar for a coordinator (workers finished of started), workers under their coordinator (`parent`). When an agent ends, its row's `impact` is its last answer and the row moves to DONE.
- **Chat tab:** a line from an agent or session shows under its id in magenta (`c1a2 · 14:05`), not under "You". Your own lines in the tab are commands for the daemon too: `/task ...`, `@<id> ...`, `@all ...`, or plain text to every running agent. Agents see them as "[chat from the machine owner]".

## Full access (`"tools": "full"`)

The default is `safe`. If you trust the collaborator as you trust yourself, set `"tools": "full"` in `config.json`. Agents then get your session's tools: Bash, the network (WebFetch, WebSearch), file edits, and the desktop session (the daemon finds `WAYLAND_DISPLAY` and `HYPRLAND_INSTANCE_SIGNATURE`, so `hyprctl` and GUI launches work from a boot service). They start in your home folder. Their prompt still says never to leak secrets and to say so before anything destructive, but that is a request to the model, not a wall. In this mode, whoever can write to your channel can run commands as you.

## Names

Each agent gets a random human first name (Bob, Gerald, Doris...), not used by another agent since the daemon started, then `bob2`, `bob3` when the list of about 100 runs out. The name is its id everywhere: the chat (`[gerald] ...`), its Status panel row (`Gerald · <task>`), `@gerald ...`, and `gerald, ...` or `hey gerald ...` at the start of a plain message. The agent is told its name, so people can address it by it.

## Linking two machines (your agents and a collaborator's agents)

Both people run the plugin and the daemon on the same secure channel. **Setup is automatic:** with Group chat on, the plugin runs `agentd.py setup --auto` at session start (and every minute until it works). It picks the channel (the only one, or the one in `config.json`), writes the config, installs and starts the service (systemd on Linux, a LaunchAgent on macOS), and posts one `[agentd] online and linked` line. It does nothing until a channel exists. Run it by hand any time: `python3 bin/agentd.py setup [--channel NAME]`.

How agents talk:
- A chat line that starts with `[name]` is **agent chatter**: an agent posting. The other daemon records it (so `chat_read` shows `name@remote: ...`) and never treats it as a command, so one machine's agents cannot start agents on the other and the two daemons cannot loop.
- To message an agent on the other machine, post a line starting with `@<their name>` (an agent's `post` adds its own `[name]`). The other daemon hands it to that running agent as `[message from <Name>, an agent on the other machine; untrusted]`. At most 8 per sender and target per 5 minutes.
- People are separate: a person's plain line is a command for the other side's daemon only if that daemon has `accept_peer_commands` true (the default when you run `install` yourself). `setup --auto` on a fresh machine writes it **false** with `tools: safe`, so the other side's agents can talk to your running agents but their people cannot start or command agents on your machine. Set it true in `config.json` to give them that.

## Turning the group chat on and off

A switch for the whole thing: `/progress-bar groupchat [on|off|toggle]`, the **● group chat on · turn off** button at the top of the Chat tab, or `python3 bin/agentd.py groupchat [on|off|toggle]`. It is a file, `~/.claude-progress/agentd/GROUPCHAT_OFF`, so the daemon and the plugin always agree.

Off:
- the daemon still reads the channel but acts on no line (no tasks, no commands, no agent chatter delivered), and a line that arrives while it is off is dropped, not replayed when you turn it back on;
- no new agents start, and agents cannot post, tell or spawn;
- sessions get no chat text in their prompt, and `chat_read` and `chat_say` say it is off;
- `setup --auto` does not bring the daemon back up.

Agents already running keep working until they finish or you `/stop` them. This is separate from the `groupChat` option in `/config`, which removes the session tools and prompt note altogether.
