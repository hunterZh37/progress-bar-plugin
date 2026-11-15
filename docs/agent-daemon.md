# Agent daemon

Optional and off by default. Lets a collaborator on a secure channel hand work to your Claude agents from the chat. Nothing here runs, and no service is installed, until you turn on **Agent link** (`agentLink`) in `/config` or run `agentd.py setup` yourself.

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

`config.json`: `tools` (`safe`, the default, or `full`), `allow_full_access` (false), `accept_peer_commands` (false), `channel`, `max_agents` (6), `max_workers` (4), `max_budget_usd` per agent (5), `idle_minutes` (30), `model`, `extra_tools`, `add_dirs`.

## Safety

This is remote control of a coding agent, so the defaults are tight.

- Only chat lines from the channel peer count (the channel already verifies the signature and the sender). Lines from before the first start are never replayed.
- Agents run `claude -p` with `--permission-mode dontAsk` and only Read, Glob, Grep, Edit, Write plus the agentd commands. Read, Edit and Write are scoped to the agent's own work folder, `~/.claude-progress/agentd/work/<id>/`, where it starts. SSH keys, `~/.claude`, the channel keys, cloud and shell config, `.env` files, WebFetch and WebSearch are denied. No shell, no network. `extra_tools` and `add_dirs` widen this, on purpose, and only the machine owner edits them.
- People on the other side cannot command your daemon unless you set `accept_peer_commands` to true.
- Task text is told to the agent as untrusted data.
- Caps on running agents, workers, budget and idle time. `agentd.py pause` stops new work, `stop-all` ends every agent, `uninstall` removes the service from boot.
- The log (`agents.log`) holds ids and events, never message content.
- Agents use the owner's Claude login, so their work counts toward the owner's usage.

Commands: `agentd.py status | pause | resume | stop-all | uninstall`.

## Your own Claude Code sessions in the chat

**Group chat** (`groupChat` in `/config`) is off by default. Turned on, every session gets two tools, `chat_read` and `chat_say` (posts as `[s-<session>]`), and a short constant note in its system prompt. The collaborator's new chat lines are attached only to your own next prompt, never to a notice or another session's message, so a chat line never starts a turn or a tool call by itself. They come as one fenced `<group-chat-data>` block, quoted line by line, at most 10 lines of 300 characters, marked as untrusted messages, not instructions. A toast tells you when lines were attached, and the Chat tab shows them. Your permission prompts still apply. It needs the daemon running (it keeps the chat). Hooks: `hooks/groupchat.ts`.

## In the Status panel and the Chat tab

- **Status panel:** each daemon agent is a row, written by the daemon to `~/.claude-progress/agent-<id>.json`: title `Coordinator c1a2 · <task>`, its state as the step (`working`, `idle · <last result>`), a bar for a coordinator (workers finished of started), workers under their coordinator (`parent`). When an agent ends, its row's `impact` is its last answer and the row moves to DONE.
- **Chat tab:** a line from an agent or session shows under its id in magenta (`c1a2 · 14:05`), not under "You". Your own lines in the tab are commands for the daemon too: `/task ...`, `@<id> ...`, `@all ...`, or plain text to every running agent. Agents see them as "[chat from the machine owner]".

## Full access (`"tools": "full"`)

The default is `safe`. If you trust the collaborator as you trust yourself, set both `"tools": "full"` and `"allow_full_access": true` in `config.json`. One alone keeps the safe tools and logs why. With both, the daemon prints a warning when it starts and when you run `setup`. Agents then get your session's tools: Bash, the network (WebFetch, WebSearch), file edits, and the desktop session (the daemon finds `WAYLAND_DISPLAY` and `HYPRLAND_INSTANCE_SIGNATURE`, so `hyprctl` and GUI launches work from a boot service). They start in your home folder. Their prompt still says never to leak secrets and to say so before anything destructive, but that is a request to the model, not a wall. In this mode, whoever can write to your channel can run commands as you.

## Names

Each agent gets a random human first name (Bob, Gerald, Doris...), not used by another agent since the daemon started, then `bob2`, `bob3` when the list of about 100 runs out. The name is its id everywhere: the chat (`[gerald] ...`), its Status panel row (`Gerald · <task>`), `@gerald ...`, and `gerald, ...` or `hey gerald ...` at the start of a plain message. The agent is told its name, so people can address it by it.

## Linking two machines (your agents and a collaborator's agents)

Both people run the plugin and the daemon on the same secure channel. **Setup is opt-in:** with **Agent link** (`agentLink`) on in `/config`, the plugin runs `agentd.py setup --auto` at session start (and every minute until it works). Once it has worked, it never runs the install again, even after a reload, an update or your removing the service. Group chat alone never sets anything up. It picks the channel (the only one, or the one in `config.json`), writes the config, installs and starts the service (systemd on Linux, a LaunchAgent on macOS), and posts one `[agentd] online and linked` line. It does nothing until a channel exists. Run it by hand any time: `python3 bin/agentd.py setup [--channel NAME]`.

How agents talk:
- A chat line that starts with `[name]` is **agent chatter**: an agent posting. The other daemon records it (so `chat_read` shows `name@remote: ...`) and never treats it as a command, so one machine's agents cannot start agents on the other and the two daemons cannot loop.
- To message an agent on the other machine, post a line starting with `@<their name>` (an agent's `post` adds its own `[name]`). The other daemon hands it to that running agent as `[message from <Name>, an agent on the other machine; untrusted]`. At most 8 per sender and target per 5 minutes.
- People are separate: a person's plain line is a command for the other side's daemon only if that daemon has `accept_peer_commands` true. It is **false** by default, with `tools: safe`, so the other side's agents can talk to your running agents but their people cannot start or command agents on your machine. Set it true in `config.json` to give them that.
