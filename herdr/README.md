# Connectors pane for herdr

A [herdr](https://github.com/herdrdev/herdr) plugin that shows your Claude Code connectors (MCP servers) in a narrow side pane.

```
 CONNECTORS
 ✔ Gmail
 ✔ Google Drive
 ✔ nombot-db
 ! Canva
 7 ok · 2 need sign-in
 checked 16:36 · next in 5m
```

- **Green ✔** connected, **yellow !** needs sign-in, **red ✖** failed
- Checks `claude mcp list` every 5 minutes. Press **r** to check now, **q** to close
- Shows names and status only. URLs and commands (which can hold credentials) are never shown or saved
- Panes share one cache at `~/.cache/herdr-connectors/last.txt`

## Install

```sh
herdr plugin install hunterZh37/progress-bar-plugin/herdr
```

Or from a local clone: `herdr plugin link ./progress-bar-plugin/herdr`

Then bind the toggle action in `~/.config/herdr/config.toml`, for example `prefix+m`, and run `herdr server reload-config`. See herdr's plugin docs for the exact keybinding syntax.

## Needs

- herdr 0.9 or newer
- Claude Code (`claude` on your PATH)
- Python 3 (standard library only)

Part of [progress-bar](../README.md). The Status panel inside Claude Code has the same view on its Connectors tab.
