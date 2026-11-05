// The status line grouper, written by `/progress-bar setup` to ~/.claude/progress-bar/group.py.
// System python3, stdlib only. The status line script falls back to plain lines when python3 is missing.
// tests/group_test.py runs this exact text. Keep it free of backticks and dollar-brace.

export const GROUP_PY = String.raw`#!/usr/bin/env python3
"""progress-bar grouper. Written by /progress-bar setup. Safe to edit or delete.

Reads status lines on stdin and prints:
  TO-DO (this project's list, see todo_file), then PROBLEMS / RUNNING / WAITING / DONE,
  then any line that is not a job (your own status line) as is.
Jobs that vanish stay under RUNNING as "just finished" for a minute, then show as "finished HH:MM" for 30 min, unless their last row said starting with no progress.
A machine status row ("<host> ✓ helper healthy · load 0.22 on 12 cores · idle") is not a job: it prints as one
"machine <host> ..." line after RUNNING. While a "<host>: ..." job runs or waits, its "idle" reads "busy: N jobs running".
Duplicate rows of one job are merged. A trailing status word (working, starting…) is not part of a job's name.
A stopped row (■) whose job log ends with a finish line counts as done, not a problem.
To-dos sort by a leading "N. " (1 first). One ending "(after X)" is dim while a running job matches X. The top ready one per machine says next.
Folded sections (~/.claude-progress/.state/folded.txt) show as one line with a count, unless PB_UNFOLD=1.
With --summary it prints one count line instead (the status line does this while the Status panel is on).
It starts with a red "! N actions needed" while ~/.claude-progress/actions.json has open actions for this project or none.
Then a yellow "inbox: N need you" while ~/.claude-progress/inbox.json lists items not in .state/inbox-handled.txt
(the full view, outside the Status panel, starts with that line too).
Then a cyan "channel: N new" while ~/.claude-progress/channel/received.json lists files not in .state/channel-read.txt (secure channel).
It ends with "recap ready" while an overnight checkpoint (.state/overnight.json) is 4 h old or the panel saw a sleep.
RUNNING rows get a spinner, or a yellow "stuck" mark when their numbers have not moved for
~/.claude-progress/.state/stuck-minutes (default 10) minutes. Stuck rows sort first.
Job names link to their progress file, or to a URL from ~/.claude-progress/links.txt ("<regex> | <url>").
A job with a "parent" (its progress file, or the 4th column of ~/.claude-progress/titles.txt) is that parent's child.
A stuck parent whose child runs, or changed in the last 10 min, is not stuck: its row ends "· waiting on: <child>".
A waiting watcher (its name says watcher, watch or monitor, and every other key word names a running job) folds into
that job's row as "· watched by: <name>", so WAITING holds only jobs that really wait.
With events.py beside this file, done, stuck and problem rows are logged once each to ~/.claude-progress/events.jsonl
(the Status panel's Log tab), a scan of the log folders starts at most every 30 s, and --summary counts unseen errors.
With ~/.claude-progress/.state/clicks-on (from /progress-bar setup mac-clicks), section headers link to
progressbar://toggle/<section>, which the ProgressBarToggle app turns into a fold or unfold.
"""
import json, os, re, subprocess, sys, time

HOME = os.path.expanduser('~')
ROOT = os.environ.get('PROGRESS_DIR') or os.path.join(HOME, '.claude-progress')
STATE = os.path.join(ROOT, '.state', 'group-seen.json')


def state_file():
    """Where the jobs seen are kept: per session (PB_SID from the status line script), so a job another
    session's view leaves out never counts as finished here. No session: the shared group-seen.json."""
    sid = re.sub(r'[^A-Za-z0-9_-]', '', os.environ.get('PB_SID', ''))[:12]
    return os.path.join(ROOT, '.state', 'group-seen-' + sid + '.json') if sid else STATE
KEEP = 30 * 60
LINGER = 60  # a job that just finished stays under RUNNING this long, so a short one does not just flash
MARKS = '▶✔✖■'
SPIN = '◐◓◑◒'  # 4 frames: a full turn every 4 s at refreshInterval 1
ELAPSED = re.compile(r'^(\d+h)?\d+m$|^\d+s$|^ETA ')
CPU = re.compile(r'\d+(\.\d+)?% CPU')
LIVE_CHILD = 10 * 60
AWAY = 4 * 3600


def load_events():
    """events.py beside this file, or None."""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        p = os.path.join(here, 'events.py')
        if not os.path.exists(p):
            return None
        import importlib.util
        spec = importlib.util.spec_from_file_location('progress_bar_events', p)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    except Exception:
        return None


def slugify(n):
    return re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')


def is_job(l):
    return l[:1] in MARKS or '█' in l or '░' in l


ANSI = re.compile(r'\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;]*m')
STUCK = re.compile(r'^\s*[◐◓◑◒]?\s*⚠\s*stuck(\s+\S+)?\s+')
OURS_HEAD = re.compile(r'^[▾▸]\s')
OURS_ROW = re.compile(r'^  (?:[◐◓◑◒⚠✖■✔▶]|[A-Z][A-Z0-9 _-]*: )')
OURS_BADGE = re.compile(r'^(?:(?:⛔ |! )?\d+ actions? needed|(?:✉ |inbox: )\d+ need you|(?:📨 |channel: )\d+ new|🖥 |machine \S+ [✓✗✖!])')


def plain(l):
    """The line without colors and links."""
    return ANSI.sub('', l)


def ours(lines):
    """Drops lines this grouper printed (a section header, its indented rows, a badge), so a status line chained
    twice can never feed grouped rows back in as jobs."""
    out, inside = [], False
    for l in lines:
        p = plain(l)
        if OURS_HEAD.match(p):
            inside = True
            continue
        if inside and p[:1].isspace():
            continue
        inside = False
        if OURS_ROW.match(p) or OURS_BADGE.match(p):
            continue
        out.append(l)
    return out


def name_of(l):
    l = STUCK.sub('', plain(l))
    s = re.sub(r'^[▶✔✖■]\s*(error\s*|stopped\s*)?', '', l)
    n = re.split(r'\s+[█░]|\s+·\s+', s, 1)[0].strip()
    # A status word is not part of the name: "job starting…" and "job" are one job.
    return re.sub(r'\s+(working|pending|waiting|running|starting)(…|\.\.\.)?$', '', n)


def ok_key(k):
    """A seen key worth keeping: not empty, not a bare number, no stuck mark."""
    return bool(k) and not k.isdigit() and 'stuck' not in k.split('-')[:1]


def clean_seen(seen):
    """Drops keys an older build saved from already grouped lines (a stuck mark, color codes, a bare number)."""
    if not isinstance(seen, dict):
        return {}
    return {k: v for k, v in seen.items() if ok_key(k) and not re.search(r'(^|-)\d+m-stuck(-|$)', k)
            and isinstance(v, dict) and not re.search('[\x1b⚠]', str(v.get('name', '')))}


def is_starting(l):
    """A row that says starting and shows no progress yet: its job has not done anything to finish."""
    return bool(re.search(r'\bstarting\b', l)) and not re.search(r'\d+/\d+|\d+(\.\d+)?%', l)


def kind(l):
    # Machine status ("<host> ✓ helper healthy · load 0.22 on 12 cores · idle"), not a job: a machine line, no bar.
    if 'helper healthy' in l:
        return 'info'
    if l.startswith('✖') or l.startswith('■') or ' ✗ ' in l:
        return 'problem'
    # "· done" only at the end or as "· done:", so "· done in 1h" (a time left) stays running.
    # "100% CPU" is a busy process, not a finished job.
    if l.startswith('✔') or re.search(r'\b100(\.0)?%(?!\s*CPU)', l) or re.search(r'· done(:|\s*$)', l):
        return 'done'
    if re.search(r'\b(waiting|pending)\b|\bwaits for\b', l):
        return 'waiting'
    return 'running'


def signature(l):
    """What counts as progress: the done/total numbers and the step text, else the line without elapsed-time fields."""
    m = re.findall(r'\d+/\d+|\d+ tools', l)  # an agent making tool calls is not stuck
    if m:
        # A new step text counts too: a long step whose job rewrites its step (items read, a time) is not stuck.
        step = [p.strip() for p in l.split(' · ')[1:] if p.strip() and not ELAPSED.match(p.strip()) and not re.match(r'^\d+/\d+$|^\d+ tools?$', p.strip())]
        return ' '.join(m) + ' | ' + ' · '.join(step)
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


NUM = re.compile(r'^(\d+)\.\s+')
AFTER = re.compile(r'\s*\(after\s+([^)]+)\)\s*$', re.I)
STOP = set('the a an and or of for to in on with is it its job run done finish finishes after'.split())


def key_words(x):
    return [w for w in re.split(r'[^a-z0-9]+', x.lower()) if w and w not in STOP]


def blocker(after, running):
    """The running name or title holding every key word of an "(after X)", or ''."""
    ks = key_words(after)
    if not ks:
        return ''
    for r in running:
        ws = set(re.split(r'[^a-z0-9]+', r.lower()))
        if all(k in ws for k in ks):
            return r
    return ''


def _slug(p):
    return re.sub(r'[^a-z0-9]+', '-', p.lower()).strip('-')


def _under(p, prefix):
    return p == prefix or p.startswith(prefix.rstrip('/') + '/')


def todo_file(cwd=None):
    """This project's to-do list, from PB_CWD (the session's folder the status line script passes).
    ~/.claude-progress/todos/projects.txt ("<path prefix><TAB><slug or file>", longest prefix wins) maps first,
    a value ending .txt being a file under ~/.claude-progress (todo.txt = the old single list).
    Else todos/<slug>.txt, the slug from the git root (or the folder) under home: ~/Desktop/NomBot -> desktop-nombot.
    No folder at all: todo.txt."""
    return os.path.join(ROOT, project_of(cwd)[0])


def _home_slug(r):
    h = HOME.rstrip('/')
    rel = r[len(h):] if _under(r, h) else r
    return _slug(rel) or ('home' if r == h else 'root')


def project_of(cwd=None):
    """(list file under ROOT, project slug), as hooks/project.ts resolves them."""
    cwd = (os.environ.get('PB_CWD', '') if cwd is None else cwd).rstrip('/')
    if not cwd:
        return ('todo.txt', 'todo.txt')
    best = None
    for l in (read(os.path.join(ROOT, 'todos', 'projects.txt')) or '').splitlines():
        l = l.strip()
        m = re.match(r'^(.+?)(?:\t+|\s{2,})(\S.*)$', l)
        if not l or l.startswith('#') or not m:
            continue
        pre = re.sub(r'^~(?=/|$)', lambda _: HOME, m.group(1).strip()).rstrip('/') or '/'
        if _under(cwd, pre) and (best is None or len(pre) > len(best[0])):
            best = (pre, m.group(2).strip())
    if best:
        v = best[1]
        f = v.lstrip('/') if v.endswith('.txt') else 'todos/' + _slug(v) + '.txt'
        if f == 'todo.txt':
            return (f, _home_slug(best[0]))
        return (f, re.sub(r'\.txt$', '', re.sub(r'^todos/', '', f)))
    root, d = '', cwd
    while d:
        if os.path.exists(os.path.join(d, '.git')):
            root = d
            break
        up = os.path.dirname(d)
        if up == d:
            break
        d = up
    sl = _home_slug(root or cwd)
    return ('todos/' + sl + '.txt', sl)


def action_count(cwd=None):
    """Open actions in actions.json (Action needed) for this session's project, or with no project (global)."""
    try:
        data = json.loads(read(os.path.join(ROOT, 'actions.json')) or 'null')
        if isinstance(data, dict):
            data = data.get('actions')
        if not isinstance(data, list):
            return 0
        f, sl = project_of(cwd)
        keys = {f, sl}
        n = 0
        for a in data:
            if not isinstance(a, dict) or not a.get('id') or not a.get('title') or a.get('status', 'open') not in ('open', None):
                continue
            p = str(a.get('project') or '')
            if not p or p in keys or 'todos/' + p + '.txt' == f:
                n += 1
        return n
    except Exception:
        return 0


def action_label(n):
    return '\033[1;31m! ' + str(n) + ' action' + ('' if n == 1 else 's') + ' needed\033[0m'


def parse_todo(text, running=()):
    """{heading: [rendered item]} for open items. "x " = done (hidden), "text | url" = clickable.
    "N. " = priority (1 first, unnumbered after). "(after X)" is dim with "waits for" while X runs.
    Under a machine heading that uses numbers or "(after", the first ready item is marked next."""
    todo, cur = {}, None
    for i, t in enumerate(text.splitlines()):
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
        text_ = text_.strip()
        n = NUM.match(text_)
        a = AFTER.search(text_)
        todo[cur].append((int(n.group(1)) if n else float('inf'), i, text_, url.strip(), a.group(1).strip() if a else ''))
    out = {}
    for h, items in todo.items():
        if not items:
            continue
        items.sort(key=lambda x: (x[0], x[1]))
        mark = h.lower() != 'you' and any(x[0] != float('inf') or x[4] for x in items)
        rows = []
        for num, _, text_, url, after in items:
            b = blocker(after, running) if after else ''
            if b:
                rows.append('\033[2m' + AFTER.sub(' (waits for ' + b.split(' · ')[0] + ')', text_) + '\033[0m')
                continue
            label = link(text_, url or None)
            if mark:
                label = '\033[32mnext\033[0m ' + label
                mark = False
            rows.append(label)
        out[h] = rows
    return out


def main(stdin, now, summary=False):
    raw = [l.rstrip('\n') for l in stdin if l.strip()]
    # inbox.json is data for the Inbox block, not a job. Older plugin builds in other sessions still write an
    # "inbox" row to the shared jobs list, so drop it here by name, not only in collect().
    raw = [l for l in raw if not re.match(r'^\W*(?:\x1b\][^\x07]*\x07|\x1b\]8;;[^\x1b]*\x1b\\)*(?:inbox|actions|max-usage|channels|topology|goal)\b', re.sub(r'\x1b\[[0-9;]*m', '', l))]
    raw = ours(raw)
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
        state = state_file()
        fresh = not os.path.exists(state)
        seen = clean_seen(json.loads(read(state) or '{}'))
    except Exception:
        state, fresh, seen = state_file(), False, {}
    ev = load_events()
    groups = {'info': [], 'problem': [], 'running': [], 'waiting': [], 'done': []}
    current = set()
    for l in jobs:
        n = name_of(l)
        k = kind(l)
        if l.startswith('■') and ev and ev.ended_ok(ev.log_of(n)):
            # Stopped, but its log ends with a finish: a success, not a problem.
            k, l = 'done', re.sub(r'^■\s*(stopped\s*)?', '✔ ', l)
        groups[k].append(l)
        if not ok_key(slugify(n)):
            continue
        current.add(slugify(n))
        sig = signature(l)
        prev = seen.get(slugify(n)) or {}
        changed = prev.get('changed', now) if prev.get('sig') == sig else now
        seen[slugify(n)] = {'name': n, 'at': now, 'kind': k, 'sig': sig, 'changed': changed, 'cpu': bool(CPU.search(l)), 'starting': is_starting(l)}
    # Jobs that disappeared count as finished, kept 30 min.
    for s, v in list(seen.items()):
        if s in current:
            continue
        if now - v.get('at', 0) > KEEP or v.get('cpu') or v.get('starting'):
            del seen[s]  # a busy process, or a job last seen starting, that ends is not a finished job
            continue
        if os.path.exists(os.path.join(ROOT, s + '.json')):
            continue  # still reporting, just not shown this poll
        if v.get('kind') not in ('problem', 'info'):
            if v.get('kind') == 'running' and now - v.get('at', 0) < LINGER:
                groups['running'].append('✔ ' + v.get('name', s) + ' ██████████ 100.0% · just finished')
            else:
                groups['done'].append('✔ ' + v.get('name', s) + ' · finished ' + time.strftime('%H:%M', time.localtime(v.get('at', now))))
    try:
        os.makedirs(os.path.dirname(state), exist_ok=True)
        tmp = state + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(seen, f)
        os.replace(tmp, state)
        if fresh:  # a new session: drop the files of sessions quiet for 2 days
            d = os.path.dirname(state)
            for x in os.listdir(d):
                if x != os.path.basename(state) and re.match(r'^group-seen-[A-Za-z0-9_-]+\.json$', x) and time.time() - os.path.getmtime(os.path.join(d, x)) > 2 * 86400:
                    os.remove(os.path.join(d, x))
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

    folded = set() if os.environ.get('PB_UNFOLD') == '1' else set((read(os.path.join(ROOT, '.state', 'folded.txt')) or '').split())
    out = []

    try:
        stuck_after = float((read(os.path.join(ROOT, '.state', 'stuck-minutes')) or '10').strip()) * 60
    except ValueError:
        stuck_after = 600

    tt = titles()
    running = set(slugify(name_of(l)) for l in groups['running'])

    parents = {}

    def parent_of(s):
        if s not in parents:
            p = progress_file(s).get('parent') or tt.get(s, ('', '', ''))[2]
            p = slugify(p) if isinstance(p, str) else ''
            parents[s] = p if p != s else ''
        return parents[s]

    def waiting_on(l):
        """The title of a child that runs or changed in the last 10 min, or ''."""
        k = slugify(name_of(l))
        for c, v in seen.items():
            if c == k or not isinstance(v, dict):
                continue
            if (c in running or now - v.get('changed', 0) < LIVE_CHILD) and parent_of(c) == k:
                return nice(c, v.get('name', c), tt)
        return ''

    def stuck_for(l):
        v = seen.get(slugify(name_of(l))) or {}
        d = now - v.get('changed', now)
        return d if d >= stuck_after and not waiting_on(l) else None

    def running_deco(i, body):
        if i.startswith('✔ '):
            return '✔ ' + body  # just finished (see LINGER): a check, never a spinner or "stuck"
        d = stuck_for(i)
        w = watchers.get(slugify(name_of(i)))
        by = ' · watched by: ' + ', '.join(w) if w else ''
        if d is None and now - (seen.get(slugify(name_of(i))) or {}).get('changed', now) >= stuck_after:
            return SPIN[int(now) % len(SPIN)] + ' ' + body + ' · waiting on: ' + waiting_on(i) + by
        mark = '\033[33m⚠ stuck ' + ago(d) + '\033[0m' if d is not None else SPIN[int(now) % len(SPIN)]
        return mark + ' ' + body + ('' if has_step(i) else ' · in progress') + by

    if ev:
        log_events(ev, groups, seen, now, stuck_for)
        try:
            if ev.due():
                subprocess.Popen([sys.executable, ev.__file__, 'scan'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except Exception:
            pass

    groups['running'].sort(key=lambda l: stuck_for(l) is None)
    watchers = fold_watchers(groups, tt)

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

    run_names = [name_of(l) for l in groups['running']]
    todo = parse_todo(read(todo_file()) or '', run_names + [nice(slugify(n), n, tt) for n in run_names])
    if summary:
        n_err = ev.unseen(now) if ev else 0
        line = summary_line(groups, sum(len(v) for v in todo.values()), sum(1 for l in groups['running'] if stuck_for(l) is not None), n_err)
        if recap_ready(now):
            line += ' · \033[2mrecap ready\033[0m'
        n_mail = inbox_count()
        n_chan = channel_count()
        if n_chan:
            line = '\033[36mchannel: ' + str(n_chan) + ' new\033[0m · ' + line
        if n_mail:
            line = '\033[33minbox: ' + str(n_mail) + ' need you\033[0m · ' + line
        n_act = action_count()
        if n_act:
            line = action_label(n_act) + ' · ' + line
        return [line] + other
    n_act = action_count()
    if n_act and os.environ.get('PB_FULL') != '1':
        out.append(action_label(n_act))
    n_mail = inbox_count()
    if n_mail and os.environ.get('PB_FULL') != '1':
        out.append('\033[33minbox: ' + str(n_mail) + ' need you\033[0m')
    n_chan = channel_count()
    if n_chan and os.environ.get('PB_FULL') != '1':
        out.append('\033[36mchannel: ' + str(n_chan) + ' new\033[0m')
    if todo:
        n_items = sum(len(v) for v in todo.values())
        if 'todo' in folded:
            out.append(header('▸ ☐ TO-DO (' + str(n_items) + ')', 'todo'))
        else:
            out.append(header('▾ ☐ TO-DO', 'todo'))
            out.extend('  ' + h.upper() + ': ' + ' · '.join(i) for h, i in todo.items())
    sec('✖ PROBLEMS', groups['problem'], 'problems')
    sec('▶ RUNNING', groups['running'], 'running', deco=running_deco)
    out.extend(machine_line(l, groups) for l in groups['info'])
    sec('⏸ WAITING', groups['waiting'], 'waiting')
    sec('✔ DONE', groups['done'], 'done')
    return out + other


def machine_line(l, groups):
    """A machine status row as "machine <host> ✓ helper healthy · load ...". The helper's own "idle" comes from its load
    alone, so while a "<host>: ..." job runs or waits here it reads "busy: N jobs running" (busy processes, "N% CPU"
    rows, count only when no job does)."""
    t = re.sub(r'^[▶✔]\s*', '', plain(l)).strip()
    host = t.split(' ', 1)[0].lower()
    # A just-finished row (✔, see LINGER) is not running any more: it does not make the host busy.
    rows = [r for r in groups['running'] + groups['waiting'] if not r.startswith('✔ ') and name_of(r).lower().startswith(host + ':')]
    jobs = [r for r in rows if not CPU.search(r)]
    n, what = (len(jobs), 'job') if jobs else (len(rows), 'process')
    if n:
        t = re.sub(r'\s*·\s*idle\s*$', '', t) + ' · busy: ' + str(n) + ' ' + what + ('' if n == 1 else ('es' if what == 'process' else 's')) + ' running'
    return 'machine ' + t


WATCHER = re.compile(r'\b(watcher|watching|watch|monitor|monitoring)\b', re.I)


def fold_watchers(groups, tt):
    """Takes waiting watcher rows out of WAITING. Returns {running job slug: [watcher names]}."""
    out, keep = {}, []
    for w in groups['waiting']:
        n = name_of(w)
        hit = ''
        if WATCHER.search(n):
            ks = key_words(WATCHER.sub(' ', n))
            for r in groups['running']:
                rn = name_of(r)
                ws = set(re.split(r'[^a-z0-9]+', (rn + ' ' + nice(slugify(rn), rn, tt)).lower()))
                if ks and all(k in ws for k in ks):
                    hit = slugify(rn)
                    break
        if hit:
            out.setdefault(hit, []).append(n)
        else:
            keep.append(w)
    groups['waiting'] = keep
    return out


def progress_file(slug):
    try:
        p = json.loads(read(os.path.join(ROOT, slug + '.json')) or '{}')
        return p if isinstance(p, dict) else {}
    except Exception:
        return {}


def titles():
    """job slug -> (title, why, parent) from ~/.claude-progress/titles.txt (<job id><TAB><title><TAB><why><TAB><parent>)."""
    out = {}
    for l in (read(os.path.join(ROOT, 'titles.txt')) or '').splitlines():
        if not l.strip() or l.startswith('#'):
            continue
        c = [x.strip() for x in l.split('\t')] + ['', '', '']
        if c[0]:
            out[slugify(c[0])] = tuple(c[1:4])
    return out


def nice(slug, name, tt):
    """A job's short title: its progress file's "title", else titles.txt, else its name. The part before " · "."""
    t = progress_file(slug).get('title')
    t = (t if isinstance(t, str) else '') or tt.get(slug, ('',))[0] or name
    return t.split(' · ')[0]


def log_events(ev, groups, seen, now, stuck_for):
    """Done, stuck and problem rows, each logged once per job (keys in .state/events-sent.json)."""
    try:
        sent = ev.sent()
        for l in groups['running']:
            n = name_of(l)
            k = slugify(n)
            if 'done:' + k in sent:
                ev.forget('done:' + k)  # running again: its next finish logs again
            d = stuck_for(l)
            if d is not None and 'stuck:' + k not in sent:
                ev.once('stuck:' + k, 'warning', n, ev.nice(n) + ' stuck', 'no progress for ' + ago(d) + '\n' + l, ev.log_of(n))
        for l in groups['done']:
            n = name_of(re.sub(r'^[✔]\s*', '', l))
            k = slugify(n)
            if 'done:' + k not in sent:
                ev.once('done:' + k, 'success', n, ev.nice(n) + ' done', re.sub(r'^✔\s*', '', l), ev.log_of(n), (seen.get(k) or {}).get('at'))
                ev.forget('stuck:' + k)
        for l in groups['problem']:
            n = name_of(l)
            k = slugify(n)
            if 'problem:' + k not in sent:
                ev.once('problem:' + k, 'error', n, ev.nice(n) + ': problem', l, ev.log_of(n))
    except Exception:
        pass


def inbox_count():
    """Items in inbox.json (any script may write it) whose id is not in .state/inbox-handled.txt."""
    try:
        data = json.loads(read(os.path.join(ROOT, 'inbox.json')) or 'null')
        handled = set((read(os.path.join(ROOT, '.state', 'inbox-handled.txt')) or '').split())
        items = data.get('items') if isinstance(data, dict) else None
        return sum(1 for i in items if isinstance(i, dict) and i.get('id') and str(i['id']) not in handled) if isinstance(items, list) else 0
    except Exception:
        return 0


def channel_count():
    """Files received through the secure channel (channel/received.json) whose id is not in .state/channel-read.txt."""
    try:
        items = json.loads(read(os.path.join(ROOT, 'channel', 'received.json')) or 'null')
        done = set((read(os.path.join(ROOT, '.state', 'channel-read.txt')) or '').split())
        return len({str(i['id']) for i in items if isinstance(i, dict) and i.get('id') and str(i['id']) not in done}) if isinstance(items, list) else 0
    except Exception:
        return 0


def recap_ready(now):
    """An overnight checkpoint (from checkpoint.py or /progress-bar checkpoint) that is 4 h old, or marked woke by the panel."""
    try:
        cp = json.loads(read(os.path.join(ROOT, '.state', 'overnight.json')) or 'null')
        return isinstance(cp, dict) and bool(cp.get('since')) and (bool(cp.get('woke')) or now - float(cp['since']) >= AWAY)
    except Exception:
        return False


def summary_line(groups, n_todo, n_stuck, n_err=0):
    """One line for the status line while the Status panel shows the full view."""
    out = ['▶ ' + str(len(groups['running'])) + ' running']
    if n_stuck:
        out.append('⚠ ' + str(n_stuck) + ' stuck')
    if groups['problem']:
        out.append('✖ ' + str(len(groups['problem'])) + ' problems')
    if n_err:
        out.append('✖ ' + str(n_err) + ' error' + ('' if n_err == 1 else 's'))
    if groups['waiting']:
        out.append('⏸ ' + str(len(groups['waiting'])) + ' waiting')
    out.append('☐ ' + str(n_todo) + ' to-do')
    out.append('full view in the Status panel')
    return ' · '.join(out)


if __name__ == '__main__':
    print('\n'.join(main(sys.stdin, time.time(), summary='--summary' in sys.argv[1:])))
`
