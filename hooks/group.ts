// The status line grouper, written by `/progress-bar setup` to ~/.claude/progress-bar/group.py.
// System python3, stdlib only. The status line script falls back to plain lines when python3 is missing.
// tests/group_test.py runs this exact text. Keep it free of backticks and dollar-brace.

export const GROUP_PY = String.raw`#!/usr/bin/env python3
"""progress-bar grouper. Written by /progress-bar setup. Safe to edit or delete.

Reads status lines on stdin and prints:
  TO-DO (from ~/.claude-progress/todo.txt), then PROBLEMS / RUNNING / WAITING / DONE,
  then any line that is not a job (your own status line) as is.
Jobs that vanish show as "finished HH:MM" for 30 min. Duplicate rows of one job are merged.
Folded sections (~/.claude-progress/.state/folded.txt) show as one line with a count.
RUNNING rows get a spinner, or a yellow "stuck" mark when their numbers have not moved for
~/.claude-progress/.state/stuck-minutes (default 10) minutes. Stuck rows sort first.
Job names link to their progress file, or to a URL from ~/.claude-progress/links.txt ("<regex> | <url>").
With ~/.claude-progress/.state/clicks-on (from /progress-bar setup mac-clicks), section headers link to
progressbar://toggle/<section>, which the ProgressBarToggle app turns into a fold or unfold.
"""
import json, os, re, sys, time

HOME = os.path.expanduser('~')
ROOT = os.environ.get('PROGRESS_DIR') or os.path.join(HOME, '.claude-progress')
STATE = os.path.join(ROOT, '.state', 'group-seen.json')
KEEP = 30 * 60
MARKS = '▶✔✖■'
SPIN = '◐◓◑◒'  # 4 frames: a full turn every 4 s at refreshInterval 1
ELAPSED = re.compile(r'^(\d+h)?\d+m$|^\d+s$|^ETA ')


def slugify(n):
    return re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')


def is_job(l):
    return l[:1] in MARKS or '█' in l or '░' in l


def name_of(l):
    s = re.sub(r'^[▶✔✖■]\s*(error\s*|stopped\s*)?', '', l)
    n = re.split(r'\s+[█░]|\s+·\s+', s, 1)[0].strip()
    return re.sub(r'\s+(working|pending|waiting|running)$', '', n)


def kind(l):
    if l.startswith('✖') or l.startswith('■') or ' ✗ ' in l:
        return 'problem'
    if l.startswith('✔') or re.search(r'\b100(\.0)?%', l) or '· done' in l:
        return 'done'
    if re.search(r'\b(waiting|pending)\b', l):
        return 'waiting'
    return 'running'


def signature(l):
    """What counts as progress: the done/total numbers, else the line without elapsed-time fields."""
    m = re.search(r'(\d+)/(\d+)', l)
    if m:
        return m.group(0)
    return ' · '.join(p for p in l.split(' · ') if not ELAPSED.match(p.strip()))


def has_step(l):
    for p in l.split(' · ')[1:]:
        p = p.strip()
        if p and not ELAPSED.match(p) and not re.match(r'^\d+/\d+$|^\d+ tools?$', p):
            return True
    return False


def ago(sec):
    m = int(sec // 60)
    return str(m // 60) + 'h' + str(m % 60).zfill(2) + 'm' if m >= 60 else str(m) + 'm'


def link(text, url):
    return '\033]8;;' + url + '\033\\' + text + '\033]8;;\033\\' if url else text


def header(text, key):
    if not os.path.exists(os.path.join(ROOT, '.state', 'clicks-on')):
        return text
    return '\033]8;;progressbar://toggle/' + key + '\007' + text + '\033]8;;\007'


def read(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except Exception:
        return None


def load_links():
    out = []
    for t in (read(os.path.join(ROOT, 'links.txt')) or '').splitlines():
        t = t.strip()
        if not t or t.startswith('#') or ' | ' not in t:
            continue
        pat, _, url = t.rpartition(' | ')
        try:
            out.append((re.compile(pat.strip()), url.strip()))
        except re.error:
            pass
    return out


def parse_todo(text):
    """{heading: [rendered item]} for open items. "x " = done (hidden), "text | url" = clickable."""
    todo, cur = {}, None
    for t in text.splitlines():
        t = t.strip()
        if not t or t.startswith('#'):
            continue
        m = re.match(r'^\[(.+)\]$', t)
        if m:
            cur = m.group(1).strip()
            todo.setdefault(cur, [])
            continue
        if t.lower().startswith('x '):
            continue
        if cur is None:
            cur = 'todo'
            todo.setdefault(cur, [])
        text_, _, url = t.partition(' | ')
        todo[cur].append(link(text_.strip(), url.strip() or None))
    return {k: v for k, v in todo.items() if v}


def main(stdin, now):
    raw = [l.rstrip('\n') for l in stdin if l.strip()]
    jobs = [l for l in raw if is_job(l) and not l.startswith('…')]
    other = [l for l in raw if l not in jobs]

    # One row per job: the longest line wins.
    best = {}
    for l in jobs:
        k = slugify(name_of(l))
        if k and (k not in best or len(l) > len(best[k])):
            best[k] = l
    jobs = [l for l in jobs if best.get(slugify(name_of(l))) is l]

    try:
        seen = json.loads(read(STATE) or '{}')
    except Exception:
        seen = {}
    groups = {'problem': [], 'running': [], 'waiting': [], 'done': []}
    current = set()
    for l in jobs:
        n = name_of(l)
        k = kind(l)
        groups[k].append(l)
        current.add(slugify(n))
        sig = signature(l)
        prev = seen.get(slugify(n)) or {}
        changed = prev.get('changed', now) if prev.get('sig') == sig else now
        seen[slugify(n)] = {'name': n, 'at': now, 'kind': k, 'sig': sig, 'changed': changed}
    # Jobs that disappeared count as finished, kept 30 min.
    for s, v in list(seen.items()):
        if s in current:
            continue
        if now - v.get('at', 0) > KEEP:
            del seen[s]
            continue
        if os.path.exists(os.path.join(ROOT, s + '.json')):
            continue  # still reporting, just not shown this poll
        if v.get('kind') != 'problem':
            groups['done'].append('✔ ' + v.get('name', s) + ' · finished ' + time.strftime('%H:%M', time.localtime(v.get('at', now))))
    try:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        tmp = STATE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(seen, f)
        os.replace(tmp, STATE)
    except Exception:
        pass

    links = load_links()

    def linked(l):
        n = name_of(l)
        if not n:
            return l
        for pat, url in links:
            if pat.search(n):
                return l.replace(n, link(n, url), 1)
        f = os.path.join(ROOT, slugify(n) + '.json')
        return l.replace(n, link(n, 'file://' + f), 1) if os.path.exists(f) else l

    folded = set((read(os.path.join(ROOT, '.state', 'folded.txt')) or '').split())
    out = []

    try:
        stuck_after = float((read(os.path.join(ROOT, '.state', 'stuck-minutes')) or '10').strip()) * 60
    except ValueError:
        stuck_after = 600

    def stuck_for(l):
        v = seen.get(slugify(name_of(l))) or {}
        d = now - v.get('changed', now)
        return d if d >= stuck_after else None

    def running_deco(i, body):
        d = stuck_for(i)
        mark = '\033[33m⚠ stuck ' + ago(d) + '\033[0m' if d is not None else SPIN[int(now) % len(SPIN)]
        return mark + ' ' + body + ('' if has_step(i) else ' · in progress')

    groups['running'].sort(key=lambda l: stuck_for(l) is None)

    def sec(title, items, key, plain=False, deco=None):
        if not items:
            return
        if key in folded:
            out.append(header('▸ ' + title + ' (' + str(len(items)) + ')', key))
            return
        out.append(header('▾ ' + title, key))
        for i in items:
            body = i if plain else linked(re.sub(r'^[▶✔]\s*', '', i))
            out.append('  ' + (deco(i, body) if deco else body))

    todo = parse_todo(read(os.path.join(ROOT, 'todo.txt')) or '')
    if todo:
        n_items = sum(len(v) for v in todo.values())
        if 'todo' in folded:
            out.append(header('▸ ☐ TO-DO (' + str(n_items) + ')', 'todo'))
        else:
            out.append(header('▾ ☐ TO-DO', 'todo'))
            out.extend('  ' + h.upper() + ': ' + ' · '.join(i) for h, i in todo.items())
    sec('✖ PROBLEMS', groups['problem'], 'problems')
    sec('▶ RUNNING', groups['running'], 'running', deco=running_deco)
    sec('⏸ WAITING', groups['waiting'], 'waiting')
    sec('✔ DONE', groups['done'], 'done')
    return out + other


if __name__ == '__main__':
    print('\n'.join(main(sys.stdin, time.time())))
`
