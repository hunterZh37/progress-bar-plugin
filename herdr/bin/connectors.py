#!/usr/bin/env python3
"""Connectors panel: Claude Code MCP servers and their status.

Runs `claude mcp list` every 5 minutes in the background, caches only
name + status in ~/.cache/herdr-connectors/last.txt, and redraws from the
cache every half second. Keys: r = refresh now, q = quit.

Never prints or stores URLs or commands: only the server name (text before
the first ": ") and the status after the last " - " are kept.

Usage: connectors.py            interactive pane
       connectors.py --once     refresh once, print the panel, exit
       connectors.py --cached   print the panel from cache, exit
"""
import os
import re
import select
import shutil
import signal
import subprocess
import sys
import threading
import time

INTERVAL = 300  # seconds between automatic checks
TIMEOUT = 120  # max seconds for one `claude mcp list`
CACHE_DIR = os.path.expanduser("~/.cache/herdr-connectors")
CACHE = os.path.join(CACHE_DIR, "last.txt")
SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

GREEN, YELLOW, RED, DIM, BOLD, RESET = (
    "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[1m", "\033[0m")

# Map a status phrase to (kind, icon). kind: ok | auth | fail
def classify(status):
    s = status.lower()
    if "connected" in s and "fail" not in s and "not" not in s:
        return "ok"
    if "auth" in s or "sign" in s:
        return "auth"
    return "fail"

# A server line ends in " - <icon> <status>". Name is before the first ": ".
LINE_RE = re.compile(r"^(?P<name>[^:]+?): .* - (?P<status>[^\s].*)$")


def parse(output):
    """Return [(name, kind)] from `claude mcp list` output. Drops URLs/commands."""
    rows = []
    for raw in output.splitlines():
        m = LINE_RE.match(raw.strip())
        if not m:
            continue
        name = m.group("name").strip()
        if name.startswith("claude.ai "):
            name = name[len("claude.ai "):]
        # Defensive: a name must never carry a URL, path or credential.
        name = re.sub(r"\S*://\S*", "", name)
        name = re.sub(r"[^\w .+()&'-]", "", name).strip()[:40]
        if not name:
            continue
        status = m.group("status").lstrip("✔✓✗✖!⚠ ").strip()
        rows.append((name, classify(status)))
    return rows


def write_cache(rows, ts, error=""):
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = CACHE + ".tmp"
    with open(tmp, "w") as f:
        f.write(f"#checked\t{int(ts)}\n")
        if error:
            f.write(f"#error\t{error}\n")
        for name, kind in rows:
            f.write(f"{name}\t{kind}\n")
    os.replace(tmp, CACHE)


def read_cache():
    rows, ts, error = [], 0, ""
    try:
        with open(CACHE) as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) != 2:
                    continue
                if parts[0] == "#checked":
                    ts = int(parts[1])
                elif parts[0] == "#error":
                    error = parts[1]
                elif parts[1] in ("ok", "auth", "fail"):
                    rows.append((parts[0], parts[1]))
    except (OSError, ValueError):
        pass
    return rows, ts, error


class Refresher:
    def __init__(self):
        self.lock = threading.Lock()
        self.busy = False
        self.proc = None

    def start(self):
        with self.lock:
            if self.busy:
                return
            self.busy = True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            refresh_now(self)
        finally:
            self.busy = False
            self.proc = None

    def stop(self):
        p = self.proc
        if p and p.poll() is None:
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except OSError:
                pass


def refresh_now(owner=None):
    """Run `claude mcp list` once and update the cache."""
    old_rows, _, _ = read_cache()
    try:
        p = subprocess.Popen(
            ["claude", "mcp", "list"], cwd=os.path.expanduser("~"),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, start_new_session=True)
        if owner:
            owner.proc = p
        out, _ = p.communicate(timeout=TIMEOUT)
        rows = parse(out)
        if p.returncode != 0 and not rows:
            write_cache(old_rows, time.time(), "check failed")
        else:
            write_cache(rows, time.time())
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        write_cache(old_rows, time.time(), "check timed out")
    except FileNotFoundError:
        write_cache([], time.time(), "claude not on PATH")


def fit(text, width):
    return text if len(text) <= width else text[: max(1, width - 1)] + "…"


def render(width, busy=False, tick=0, color=True):
    rows, ts, error = read_cache()
    c = (lambda code: code) if color else (lambda code: "")
    w = max(16, width - 2)
    out = []
    spin = f" {c(DIM)}{SPIN[tick % len(SPIN)]}{c(RESET)}" if busy else ""
    out.append(f" {c(BOLD)}CONNECTORS{c(RESET)}{spin}")
    out.append(f" {c(DIM)}{'─' * min(w, 30)}{c(RESET)}")
    ok = [n for n, k in rows if k == "ok"]
    auth = [n for n, k in rows if k == "auth"]
    fail = [n for n, k in rows if k == "fail"]
    if not rows:
        out.append(f" {c(DIM)}{'checking…' if busy or not ts else 'no connectors'}{c(RESET)}")
    for n in sorted(ok, key=str.lower):
        out.append(f" {c(GREEN)}✔{c(RESET)} {fit(n, w - 2)}")
    if (auth or fail) and ok:
        out.append("")
    for n in sorted(auth, key=str.lower):
        out.append(f" {c(YELLOW)}!{c(RESET)} {fit(n, w - 2)}")
    for n in sorted(fail, key=str.lower):
        out.append(f" {c(RED)}✖{c(RESET)} {fit(n, w - 2)}")
    out.append("")
    counts = [f"{len(ok)} ok"]
    if auth:
        counts.append(f"{c(YELLOW)}{len(auth)} need sign-in{c(RESET)}")
    if fail:
        counts.append(f"{c(RED)}{len(fail)} failed{c(RESET)}")
    out.append(" " + " · ".join(counts))
    if error:
        out.append(f" {c(RED)}{fit(error, w)}{c(RESET)}")
    if ts:
        checked = time.strftime("%H:%M", time.localtime(ts))
        left = int(ts + INTERVAL - time.time())
        nxt = "now" if busy or left <= 0 else (
            f"{(left + 59) // 60}m" if left >= 60 else f"{left}s")
        out.append(f" {c(DIM)}checked {checked} · next {'…' if busy else 'in ' + nxt}{c(RESET)}")
    out.append(f" {c(DIM)}r refresh · q quit{c(RESET)}")
    return out


def interactive():
    import termios
    import tty

    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    ref = Refresher()
    tick = 0

    def cleanup(*_):
        ref.stop()
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        sys.stdout.write("\033[?25h\033[?1049l")
        sys.stdout.flush()
        os._exit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGHUP, cleanup)
    tty.setcbreak(fd)
    sys.stdout.write("\033[?1049h\033[?25l")
    try:
        _, ts, _ = read_cache()
        if time.time() - ts >= INTERVAL:
            ref.start()
        while True:
            _, ts, _ = read_cache()
            if not ref.busy and time.time() - ts >= INTERVAL:
                ref.start()
            cols, lines = shutil.get_terminal_size((30, 24))
            body = render(cols, ref.busy, tick)[:lines]
            sys.stdout.write("\033[H" + "".join(
                fit_ansi(l, cols) + "\033[K\r\n" for l in body) + "\033[J")
            sys.stdout.flush()
            tick += 1
            r, _, _ = select.select([fd], [], [], 0.25 if ref.busy else 1.0)
            if r:
                ch = os.read(fd, 32).decode(errors="ignore").lower()
                if "q" in ch:
                    break
                if "r" in ch:
                    ref.start()
    except KeyboardInterrupt:
        pass
    cleanup()


def fit_ansi(line, cols):
    """Trim a line with ANSI codes to cols visible characters."""
    out, vis, i = [], 0, 0
    while i < len(line):
        if line[i] == "\033":
            j = line.find("m", i)
            if j < 0:
                break
            out.append(line[i:j + 1])
            i = j + 1
            continue
        if vis >= cols:
            break
        out.append(line[i])
        vis += 1
        i += 1
    return "".join(out) + RESET


def main():
    args = sys.argv[1:]
    if "--once" in args or "--cached" in args:
        if "--once" in args:
            refresh_now()
        color = sys.stdout.isatty() or "--color" in args
        print("\n".join(render(30, color=color)))
        return
    if not sys.stdin.isatty():
        print("connectors.py: needs a terminal (or use --once)", file=sys.stderr)
        sys.exit(2)
    interactive()


if __name__ == "__main__":
    main()
