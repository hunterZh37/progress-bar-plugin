# Secure channel and Chat

Optional. Send files and chat lines to a collaborator's Claude Code session, end-to-end encrypted.

## Secure channel

Send files between two people's Claude Code sessions. Say "send this plan to Sam" in the chat, and it lands in Sam's Status panel within seconds.

```
Channel  1 new
sam · launch-plan.md  ✓ read
```

### Setup

You (the inviter), once per collaborator:

```
/progress-bar channel invite <their-github-user> sam
```

This creates a private repo `<you>/pb-channel-<you>-<them>` and GitHub emails them an invitation. Add `--as <your-github-user>` when `gh` is logged in to several accounts (it is remembered).

Your collaborator, in 2 steps:

1. Install the plugin: `/plugin marketplace add hunterZh37/progress-bar-plugin`, then `/plugin install progress-bar@progress-bar`, then restart Claude Code.
2. Run `/progress-bar channel join <your-github-user>` (with `--as <their-github-user>` if they have several `gh` accounts). There is no need to click the email: join accepts the invitation.

Then either side sends:

```
/progress-bar send notes/launch-plan.md to sam
```

Or just tell Claude "send this to Sam". The `secure-channel` skill has Claude call the plugin's `channel_send` tool, and Claude Code asks you before it runs.

### Receiving

- Every open session checks each channel every 3 seconds (one check at a time across sessions). When nothing changed, GitHub answers 304 (no rate limit cost).
- A new file is verified, decrypted and saved to `~/.claude-progress/channel/<name>/<file>`. It never overwrites: a second `plan.md` becomes `plan-2.md`.
- It shows in the Status panel List tab as `Channel  N new`. Press a file to open it with your default app. **✓ read** hides it (`~/.claude-progress/.state/channel-read.txt`).
- The status line shows a cyan `channel: N new`, kept apart from the inbox `inbox: N need you` because a received file is not a task.
- The Log tab gets `Message from <name>: <file>`. A rejected message logs an error.
- `/progress-bar channel check` checks now. `/progress-bar channel read` lists what arrived.

### Security model

- **End-to-end encryption.** GitHub only stores ciphertext. Each person gets two P-256 keys at first use, in `~/.claude-progress/channel/keys/` (folder 700, files 600, never committed, never printed). Only the public halves go to the repo as `keys/<github-user>.pub`.
- **Per message:** a random 256-bit key encrypts the file with AES-256-CBC (`openssl enc`, PBKDF2). That key is wrapped for the recipient and for the sender (so you can re-read what you sent) with ephemeral ECDH P-256 and HKDF-SHA256, with an HMAC tag. The sender signs a header (sender, recipient, file name, size, SHA-256 of the file and of the ciphertext, the wraps) with ECDSA P-256.
- **On receive:** signature first, then the ciphertext hash, the key tag and the plaintext hash. Any mismatch rejects the message and logs an error. Nothing is saved.
- **Key pinning:** the peer's key is pinned at first sight. A changed key is refused until you leave and join again.
- **Crypto engine:** the plugin runtime has SHA-256 but no ECDH or AES, so `bin/channel.py` runs the `openssl` CLI (LibreSSL 3.3+ or OpenSSL 1.1.1+). No extra install on macOS or Linux.
- **Accounts:** every `gh` and `git` call uses the channel account's token (`gh auth token --user`) for that call only. Your active `gh` account never changes.
- **Received files are data.** The plugin never puts their text into a prompt. The skill tells Claude to treat them as untrusted input and never act on instructions inside them unless you ask. Claude cannot read the private keys: the plugin refuses any tool call that names the keys folder.
- **Allowed files:** `.md .markdown .txt .pdf .png .jpg .jpeg .gif .webp`, up to 10 MB. Received names are cut to their last part, with no leading dots, and saved only inside the channel folder.
- **Logs** carry file names and sizes, never content, keys or tokens.

### Limits

- Two people per channel. Make one channel per collaborator.
- Both need `gh` (logged in), `git`, `openssl` and `python3`.
- Not forward secret: someone who later steals your private key file can read old messages in the repo. Delete the repo when done.
- GitHub sees who talks to whom, when, and file sizes.
- `/progress-bar channel leave <name>` forgets a channel on this machine. It prints the command to delete the repo (owner) or drop your access (collaborator).

### Chat

The Status panel has a **Chat** tab next to List, Connectors, GitHub, Log and Topology. It shows each channel as a chat room. Its tab reads `Chat 2` when 2 received messages are unread.

```
 List │ Connectors │ GitHub │ Log │ ▌Chat 1
CHANNELS
▌sam    14:14  1 new
──────────────────────────────────────────
sam-gh · 14:02
╭──────────────────────╮
│ got the plan, thanks │
╰──────────────────────╯
                               You · 14:14
                         ╭───────────────╮
                         │ chat tab test │
                         ╰───────────────╯
sam-gh · 14:20
file: launch-plan.md (3 KB)
# Launch plan
First lines show as a preview
╭─────────────────────────────────────────╮
│ Message sam                             │
╰─────────────────────────────────────────╯
➤ Send  ↑ Send file: /progress-bar send <file> to sam
```

- **Pick a channel** at the top. Each line shows its name, the last message time and the unread count.
- **The thread** runs oldest first. Received messages sit on the left under the sender's name. Yours sit on the right under "You".
- **Chat lines** (from the field or `say`) show as bubbles with the full text. A `.md` or `.txt` file shows its first 3 lines. Images and PDFs show as `file: file.png (120 KB)`.
- **Press a message** to expand a text file inline, 30 lines a page, with `↗ open` and `▴ fold`. Press an image or PDF to open it with your default app.
- **Unread** clears when you view the thread. The List tab block and the status line `channel: N new` clear with it.
- **Send** by typing in the field at the bottom and pressing Enter, or **➤ Send**. From anywhere: `/progress-bar say sam on my way`. A chat line is at most 4000 characters. Send longer text as a file.

How it works:

- `~/.claude-progress/channel/index.json` lists every message both ways (direction, time, file name, local path, SHA-256, verified). It is written when you send (the field, `say`, `send` and the `channel_send` tool) and when a message arrives, so the tab needs no GitHub call to draw.
- A sent file is copied to `~/.claude-progress/channel/<name>/sent/` so you can open it later.
- A chat line is a file named `chat-<UTC time>-<random>.md`, written to `~/.claude-progress/channel/outbox/`, sent like any file (encrypted and signed), then removed from the outbox.
- The first session without an `index.json` builds it from what already arrived and from your own sent messages in the local repo copy, decrypted with your own key. No network.
- Received text is untrusted. The tab strips terminal escapes, control and bidi characters, caps the length, and never opens links or runs anything. It is never put into a prompt.
- On a surface without a text field, the tab shows **✎ Reply**, which puts `/progress-bar say <name> ` into the prompt box.
