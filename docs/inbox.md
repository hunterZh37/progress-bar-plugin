# Inbox

Optional. Show what needs you, such as emails waiting on a reply.

## Inbox

Shows what needs you, such as emails waiting on your reply, first on the List tab and in the status line.

```
Inbox  2 need you
Ann Lee · Budget sign-off
  Approve the Q4 budget · due Fri  ✓ handled
Sam Ortiz · Thursday call
  Reply with your availability  ✓ handled
```

- **Any script can feed it.** Write `~/.claude-progress/inbox.json`:

  ```json
  { "checked": 1800000000, "items": [
    { "id": "thread-1", "from": "Ann Lee", "subject": "Budget sign-off", "why": "Approve the Q4 budget", "due": "Fri", "url": "https://mail.google.com/mail/#all/thread-1" }
  ] }
  ```

  `id` is required and must be unique. `due` and `url` are optional. Write the file whole (a temp file, then rename).
- **Press an item** to open its `url`. Only `https://` links open.
- **✓ handled** hides an item. Its id goes to `~/.claude-progress/.state/inbox-handled.txt` (the newest 500 are kept), so it stays hidden when the file is rewritten.
- **Secure channel invites never show.** GitHub sends each `pb-channel-*` invite as its own email, and joining the channel accepts it.
- **Status line:** the one-line summary starts with a yellow `inbox: N need you`. Without the panel, the full view starts with that line. Nothing shows when N is 0.
- **Gmail example (optional):** `/progress-bar inbox setup` writes `~/.claude/progress-bar/inbox-check.sh` and prints how to run it every 10 minutes. It needs the claude.ai Gmail connector and the `claude` CLI signed in. Each run starts a headless Claude (haiku) that may call only Gmail `search_threads`, `get_thread` and `get_message`. Sending, drafts, labels, trash and every other tool are denied. It treats email text as data and never follows instructions in it. It reads inbox threads from the last 3 days, leaves out promotions, social, automated mail and threads you answered last, and writes `inbox.json`. Set `INBOX_ACCOUNT` to your address. Runs skip 11 PM to 6 AM and never overlap.
