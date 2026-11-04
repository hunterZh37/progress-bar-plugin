// The events log behind the Status panel's Log tab: ~/.claude-progress/events.jsonl, one JSON object per line.
// events.py (below) is written by `/progress-bar setup` beside group.py. group.py imports it to log done, stuck and
// problem rows once each, and to start a scan of the log folders at most every 30 s.
// tests/group_test.py runs this exact text. Keep it free of backticks and dollar-brace.

import type { Ev, Level } from '../types'

export const EVENTS_REL = '.claude-progress/events.jsonl'
export const SEEN_REL = '.claude-progress/.state/log-seen.txt'
export const LOG_DIRS_REL = '.claude-progress/log-dirs.txt'
export const LEVELS: Level[] = ['error', 'warning', 'success', 'info']
const DAY_S = 86_400

/** Parses events.jsonl (its last 400 lines), newest first. Bad lines are skipped, an unknown level reads as info. */
export function parseEvents(raw: string): Ev[] {
  const out: Ev[] = []
  for (const l of raw.split('\n').slice(-400)) {
    if (!l.trim()) continue
    try {
      const e = JSON.parse(l) as Record<string, unknown>
      if (!e || typeof e.ts !== 'number' || typeof e.title !== 'string') continue
      const level = LEVELS.includes(e.level as Level) ? (e.level as Level) : 'info'
      out.push({
        ts: e.ts, level, source: typeof e.source === 'string' ? e.source : '', title: e.title,
        ...(typeof e.detail === 'string' && e.detail ? { detail: e.detail } : {}),
        ...(typeof e.path === 'string' && e.path ? { path: e.path } : {}),
      })
    } catch { /* a bad line */ }
  }
  return out.sort((a, b) => b.ts - a.ts)
}

/** Errors from the last 24 h logged after the Log tab was last opened (`seenAt`, epoch s). */
export const unseenErrors = (events: Ev[], seenAt: number, nowS: number) =>
  events.filter(e => e.level === 'error' && e.ts > seenAt && nowS - e.ts < DAY_S).length

/** The folders in log-dirs.txt, one per line, `~` expanded, `#` comments and relative paths left out. */
export function parseLogDirs(text: string, home: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => l.replace(/^~(?=\/|$)/, home).replace(/\/+$/, ''))
    .filter(l => l.startsWith('/') && l.length > 1)
}

/** True when `path` is a plain absolute path inside one of `dirs`: no `..`, no `.` segments, no NUL. */
export function insideDirs(path: string, dirs: string[]): boolean {
  if (!path.startsWith('/') || path.includes('\0') || /(^|\/)\.\.?(\/|$)/.test(path)) return false
  return dirs.some(d => path.startsWith(`${d}/`) && path.length > d.length + 1)
}

/** "HH:MM" of an epoch-seconds time, local. */
export const hhmm = (ts: number) => {
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const EVENTS_PY = String.raw`#!/usr/bin/env python3
"""progress-bar events log. Written by /progress-bar setup beside group.py. Safe to edit or delete.

The Status panel's Log tab shows ~/.claude-progress/events.jsonl, one JSON object per line:
  {"ts": 1767225600, "level": "error", "source": "nightly-import", "title": "Nightly import crashed",
   "detail": "optional, newlines allowed", "path": "/abs/path/to/the.log"}
Levels: error, warning, success, info. Only the newest 2,000 lines are kept.

  events.py add <level> <source> <title> [detail] [path]   append one event
  events.py scan                                           scan the log folders now
  events.py unseen                                         errors in the last 24 h not yet seen in the Log tab

Log folders: one per line in ~/.claude-progress/log-dirs.txt (none by default, ~ allowed, # comments).
A scan reads each *.log there changed in the last 24 h from where the last scan stopped
(offsets in .state/log-offsets.json) and logs: a Traceback or ERROR line (error), a run ended by
SIGTERM or SIGKILL (warning "stopped (restart or kill)", naming newer logs of the same job that resumed it),
a rate limit or billing line (warning, at most every 30 min per log) and a finish (success, once per job,
under the same key as the grouper's done row).
group.py imports this file. It logs done, stuck and problem rows once each and starts a scan at most every 30 s.
"""
import glob, json, os, re, sys, time
try:
    import fcntl
except ImportError:  # Windows: no lock
    fcntl = None

HOME = os.path.expanduser('~')
ROOT = os.environ.get('PROGRESS_DIR') or os.path.join(HOME, '.claude-progress')
EVENTS = os.path.join(ROOT, 'events.jsonl')
STATE = os.path.join(ROOT, '.state')
SENT = os.path.join(STATE, 'events-sent.json')
OFFSETS = os.path.join(STATE, 'log-offsets.json')
SEEN = os.path.join(STATE, 'log-seen.txt')
STAMP = os.path.join(STATE, 'log-scan.stamp')
CAP = 2000
SCAN_EVERY = 30
LEVELS = ('error', 'warning', 'success', 'info')


def slugify(n):
    return re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')


def _load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def _save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    os.replace(tmp, path)


def emit(level, source, title, detail='', path='', ts=None):
    """Appends one event and keeps the newest CAP lines."""
    ev = {'ts': int(ts or time.time()), 'level': level if level in LEVELS else 'info', 'source': source, 'title': title}
    if detail:
        ev['detail'] = detail[:2000]
    if path:
        ev['path'] = path
    os.makedirs(STATE, exist_ok=True)
    with open(EVENTS, 'a+', encoding='utf-8') as f:
        if fcntl:
            fcntl.flock(f, fcntl.LOCK_EX)
        f.write(json.dumps(ev, ensure_ascii=False) + '\n')
        f.flush()
        f.seek(0)
        lines = f.readlines()
        if len(lines) > CAP:
            f.seek(0)
            f.truncate()
            f.writelines(lines[-CAP:])
        if fcntl:
            fcntl.flock(f, fcntl.LOCK_UN)


def sent():
    return _load(SENT, {})


def once(key, level, source, title, detail='', path='', ts=None):
    """emit() unless an event with this key was sent in the last 2 days. True when sent."""
    s = sent()
    now = time.time()
    s = {k: v for k, v in s.items() if now - v < 2 * 86400}
    if key in s:
        return False
    s[key] = now
    _save(SENT, s)
    emit(level, source, title, detail, path, ts)
    return True


def forget(key):
    s = sent()
    if s.pop(key, None) is not None:
        _save(SENT, s)


def titles():
    """job slug -> (title, why, parent) from titles.txt: <job id><TAB><title><TAB><why><TAB><parent>."""
    out = {}
    try:
        with open(os.path.join(ROOT, 'titles.txt'), encoding='utf-8') as f:
            for l in f:
                if not l.strip() or l.startswith('#'):
                    continue
                c = [x.strip() for x in l.rstrip('\n').split('\t')] + ['', '', '']
                if c[0]:
                    out[slugify(c[0])] = tuple(c[1:4])
    except Exception:
        pass
    return out


def nice(name):
    """A job's short title (its progress file, else titles.txt), else its name. The part before " · "."""
    slug = slugify(name)
    p = _load(os.path.join(ROOT, slug + '.json'), {})
    t = p.get('title') if isinstance(p, dict) and isinstance(p.get('title'), str) else ''
    t = t or titles().get(slug, ('',))[0] or name
    return t.split(' · ')[0]


def log_dirs():
    out = []
    try:
        with open(os.path.join(ROOT, 'log-dirs.txt'), encoding='utf-8') as f:
            for l in f:
                l = l.strip()
                if l and not l.startswith('#'):
                    d = os.path.expanduser(l).rstrip('/')
                    if os.path.isabs(d) and os.path.isdir(d):
                        out.append(d)
    except Exception:
        pass
    return out


def log_of(name):
    """The newest <job>.log or <job>-*.log in the log folders, or ''."""
    found = []
    for d in log_dirs():
        found += glob.glob(os.path.join(d, glob.escape(name) + '.log')) + glob.glob(os.path.join(d, glob.escape(name) + '-*.log'))
    found = [g for g in found if job_of(g) == name]
    return max(found, key=os.path.getmtime) if found else ''


def due():
    """True (and the stamp touched) when log folders exist and the last scan started SCAN_EVERY s ago or more."""
    if not log_dirs():
        return False
    try:
        if time.time() - os.path.getmtime(STAMP) < SCAN_EVERY:
            return False
    except OSError:
        pass
    os.makedirs(STATE, exist_ok=True)
    with open(STAMP, 'w') as f:
        f.write('')
    return True


# ---- log scanner ----
WARN = re.compile(r'rate.?limit|usage limit|billing|quota exceeded|"limited"\s*:\s*true', re.I)
PROG = re.compile(r'^\s*(\d+)/(\d+)\b')
DONE = re.compile(r'^\s*(done|finished)\b', re.I)
ERR = re.compile(r'CalledProcessError|\bERROR\b|^\s*FATAL\b')
SIGNAL = re.compile(r'died with <Signals\.SIG(TERM|KILL|INT|HUP)|\bSIG(TERM|KILL)\b')


def job_of(path):
    """build-20260101-1200.log -> build. A log without a time stamp is its own job."""
    return re.sub(r'(-\d{8}-\d{4,6})?\.log$', '', os.path.basename(path))


def resumed(path):
    """Newer logs of the same job that made progress: "resumed in a.log, then b.log"."""
    job = job_of(path)
    newer = []
    for g in sorted(glob.glob(os.path.join(os.path.dirname(path), glob.escape(job) + '-*.log'))):
        if g == path or job_of(g) != job or os.path.basename(g) <= os.path.basename(path):
            continue
        try:
            with open(g, errors='replace') as f:
                if any(PROG.match(l) for l in f):
                    newer.append(os.path.basename(g))
        except OSError:
            pass
    return ('resumed in ' + ', then '.join(newer)) if newer else ''


def stopped_or_error(ev, job, path, text, detail):
    """A run ended by a signal (a restart, a kill) is a warning. Any other failure is an error."""
    if SIGNAL.search(text):
        ev('warning', nice(job) + ' stopped (restart or kill)', '\n'.join(x for x in (resumed(path), detail) if x))
    else:
        ev('error', nice(job) + ' crashed', detail)


def ended_ok(path):
    """True when the log's last line says it finished: a line starting done or finished, or N/N."""
    if not path:
        return False
    try:
        with open(path, 'rb') as f:
            f.seek(max(0, os.path.getsize(path) - 4096))
            tail = f.read().decode('utf-8', 'replace')
    except OSError:
        return False
    last = next((l for l in reversed(tail.split('\n')) if l.strip()), '')
    m = PROG.match(last)
    return bool(DONE.match(last) or (m and m.group(1) == m.group(2) and int(m.group(2)) > 0))


def scan_file(path, o, now):
    st = os.stat(path)
    if st.st_size < o['off']:
        o = {'off': 0, 'warn': 0}  # the file was replaced
    if st.st_size == o['off']:
        return o
    with open(path, 'rb') as f:
        f.seek(o['off'])
        chunk = f.read()
    end = chunk.rfind(b'\n') + 1  # whole lines only
    text = chunk[:end].decode('utf-8', 'replace')
    job = job_of(path)
    ts = st.st_mtime if now - st.st_mtime > 120 else now  # a finished log: its events happened by its last write

    def ev(level, title, detail):
        emit(level, job, title, detail, path, ts)
    lines = text.split('\n')
    consumed = end
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith('Traceback'):
            # The block runs to the first unindented line after it: the exception itself.
            j = next((k for k in range(i + 1, len(lines)) if lines[k].strip() and not lines[k].startswith((' ', '\t'))), None)
            if j is None and now - st.st_mtime < 60:
                consumed = len(('\n'.join(lines[:i]) + '\n').encode()) if i else 0  # still being written: next scan
                break
            e = j if j is not None else len(lines) - 1
            block = [x for x in lines[i:e + 1] if x.strip()]
            stopped_or_error(ev, job, path, '\n'.join(block), '\n'.join(block[-8:]))
            i = e + 1
            continue
        m = PROG.match(l)
        if ERR.search(l):
            if SIGNAL.search(l):
                stopped_or_error(ev, job, path, l, l.strip()[:500])
            else:
                ev('error', nice(job) + ': error', l.strip()[:500])
        elif SIGNAL.search(l):
            stopped_or_error(ev, job, path, l, l.strip()[:500])
        elif WARN.search(l):
            if now - o.get('warn', 0) > 1800:
                o['warn'] = now
                ev('warning', nice(job) + ': usage limit or billing', l.strip()[:500])
        elif not o.get('ok') and (DONE.match(l) or (m and m.group(1) == m.group(2) and int(m.group(2)) > 0)):
            o['ok'] = 1  # one finish per log
            # The grouper's key: one finish logs once, whether the scanner or the grouper sees it first.
            once('done:' + slugify(job), 'success', job, nice(job) + ' done', l.strip()[:500], path, ts)
        i += 1
    o['off'] = o['off'] + consumed
    return o


def scan():
    offs = _load(OFFSETS, {})
    now = time.time()
    for d in log_dirs():
        for path in glob.glob(os.path.join(d, '*.log')):
            try:
                if now - os.path.getmtime(path) > 86400:
                    continue
                offs[path] = scan_file(path, offs.get(path) or {'off': 0, 'warn': 0}, now)
            except OSError:
                continue
    _save(OFFSETS, {p: v for p, v in offs.items() if os.path.exists(p)})


def unseen(now=None):
    now = now or time.time()
    try:
        with open(SEEN) as f:
            seen = float(f.read().strip() or 0)
    except Exception:
        seen = 0
    cut = max(seen, now - 86400)
    n = 0
    try:
        with open(EVENTS, encoding='utf-8') as f:
            for l in f:
                try:
                    e = json.loads(l)
                except Exception:
                    continue
                if isinstance(e, dict) and e.get('level') == 'error' and float(e.get('ts', 0)) > cut:
                    n += 1
    except Exception:
        pass
    return n


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['scan']:
        scan()
    elif a[:1] == ['unseen']:
        print(unseen())
    elif a[:1] == ['add'] and len(a) >= 4:
        emit(a[1], a[2], a[3], *a[4:6])
    else:
        print(__doc__)
        sys.exit(2)
`
