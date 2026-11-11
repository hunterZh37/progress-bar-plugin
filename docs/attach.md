# Attach files and click to fold (macOS)

Optional macOS extras.

## Attach files (macOS)

Press a shortcut, pick files in the macOS file picker, and they land in your prompt at the cursor. Works inside herdr too.

- **Command:** `/attach` opens the picker. It runs at once, even mid-turn.
- **Shortcut:** bind a chord to it in `~/.claude/keybindings.json`. `ctrl+x ctrl+f` is free in Claude Code's defaults:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+x ctrl+f": "command:attach" } }
  ]
}
```

- **What it inserts:** one `@` mention per file, separated by spaces, with a space after. A path with spaces is quoted, `@"/Users/you/My Shots/screen 1.png"`, the form Claude Code reads whole.
- **Images:** png, jpg, gif and webp attach as images, since Claude Code reads an `@` image path as an image.
- **Cancel** leaves the prompt as it was, with no message.
- **Opens fast:** your terminal shows the picker itself, in about 0.1 s. Focus goes back to the terminal after you pick or cancel. No Automation permission prompt, since an app may script itself. If the terminal can't show it, the picker falls back to `osascript`'s own window, which takes about 2 s.
- **While it's open** the terminal waits for the picker, so finish or cancel it before typing.
- **Pick several** with ⌘-click or shift-click in the picker.
- **Other systems:** `/attach` shows "File picker needs macOS".

## Click to fold (macOS)

Optional. Makes each section header a link that folds or unfolds that section.

```
/progress-bar setup mac-clicks
```

- **What it installs:** `~/Applications/ProgressBarToggle.app`, a tiny AppleScript app built with `osacompile`, signed ad hoc and registered for `progressbar://` URLs. Its source is at `~/.claude/progress-bar/ProgressBarToggle.applescript`. It runs only when you click and accepts only the five section names.
- **Turns on header links** by writing `~/.claude-progress/.state/clicks-on`. Without that file the headers stay plain text.
- **Needs a terminal that renders OSC 8 hyperlinks:** Ghostty, iTerm2, WezTerm or kitty. In Ghostty, ⌘-click the header.
- **Inside tmux or herdr** links may be stripped. Try `FORCE_HYPERLINK=1`, or turn on tmux's `hyperlinks` feature (`set -as terminal-features ',*:hyperlinks'`).
- **Remove it:** `/progress-bar setup mac-clicks off` unregisters and deletes the app and turns the links off.
- **Other systems:** use `/progress-bar fold <section>`.
