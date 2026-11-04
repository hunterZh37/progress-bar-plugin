// The overnight checkpoint behind the Status panel's "While you were away" recap.
// `/progress-bar checkpoint` (or `away`) and checkpoint.py (written by `/progress-bar setup` beside group.py, for
// end-of-day scripts) both write ~/.claude-progress/.state/overnight.json = { since, label, running: [{ name, pct, done, total }] }
// from the RUNNING rows the status line shows now. tests/group_test.py runs CHECKPOINT_PY. Keep it free of backticks and dollar-brace.

import type { Snap } from '../types'

export const OVERNIGHT_REL = '.claude-progress/.state/overnight.json'
/** The recap shows once the checkpoint is this old (seconds), or after a clock gap of GAP_MS (the computer slept). */
export const AWAY_S = 4 * 3600
export const GAP_MS = 30 * 60_000

/** "◑ arts-classify ███░ 15.7% · 1420/9034 batches · 13h35m left" -> name, pct, done, total. */
export function snapOf(row: string): Snap {
  const r = row.trim().replace(/^⚠ stuck \S+\s*/, '').replace(/^[◐◓◑◒•▶]\s*/, '')
  const name = r.split(/\s+[█░]|\s+·\s+/)[0]!.trim().replace(/\s+(working|pending|waiting|running|starting)(…|\.\.\.)?$/, '')
  const out: Snap = { name }
  const pct = /(\d+(?:\.\d+)?)%(?!\s*CPU)/.exec(r.replace(/·\s*(7d|Max 7-day used) \d+%/g, ''))
  if (pct) out.pct = Number(pct[1])
  const c = /(?:^|·\s)(\d+)\/(\d+)(?: batches)?(?:\s|$)/.exec(r)
  if (c) { out.done = Number(c[1]); out.total = Number(c[2]) }
  return out
}

/** The local date of an epoch-seconds time, YYYY-MM-DD: the archive name on Dismiss. */
export function dayOf(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const CHECKPOINT_PY = String.raw`#!/usr/bin/env python3
"""progress-bar overnight checkpoint. Written by /progress-bar setup. Safe to edit or delete.

Writes ~/.claude-progress/.state/overnight.json = {since, label, running: [{name, pct, done, total}]}
from the RUNNING rows of the status line beside this file. The Status panel's List tab shows a
"While you were away" recap from it once you are back (4 h later, or after the computer slept).
Call it from any end-of-day script:
  python3 ~/.claude/progress-bar/checkpoint.py [label]
"""
import json, os, re, subprocess, sys, time

HOME = os.path.expanduser('~')
ROOT = os.environ.get('PROGRESS_DIR') or os.path.join(HOME, '.claude-progress')
OUT = os.path.join(ROOT, '.state', 'overnight.json')
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'statusline.sh')
ESC = re.compile(r'\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;]*m')


def parse_row(row):
    """'◑ arts-classify ███░ 15.7% · 1420/9034 batches · ...' -> {name, pct, done, total}."""
    r = re.sub(r'^⚠ stuck \S+\s*', '', row.strip())
    r = re.sub(r'^[◐◓◑◒•▶]\s*', '', r)
    name = re.split(r'\s+[█░]|\s+·\s+', r)[0].strip()
    name = re.sub(r'\s+(working|pending|waiting|running|starting)(…|\.\.\.)?$', '', name)
    out = {'name': name}
    m = re.search(r'(\d+(?:\.\d+)?)%(?!\s*CPU)', re.sub(r'·\s*(7d|Max 7-day used) \d+%', '', r))
    if m:
        out['pct'] = float(m.group(1))
    m = re.search(r'(?:^|·\s)(\d+)/(\d+)(?: batches)?(?:\s|$)', r)
    if m:
        out['done'], out['total'] = int(m.group(1)), int(m.group(2))
    return out


def running_rows(text):
    """The rows under the RUNNING header of the grouped status line."""
    rows, sec = [], None
    for line in ESC.sub('', text).splitlines():
        if re.match(r'^[▾▸]', line):
            sec = 'running' if 'RUNNING' in line else 'other'
        elif sec == 'running' and line.strip():
            rows.append(parse_row(line))
    return [r for r in rows if r['name']]


def status_text():
    env = dict(os.environ, PB_FULL='1', PB_UNFOLD='1')
    try:
        return subprocess.run(['/bin/sh', SCRIPT], input='{}', capture_output=True, text=True, timeout=20, env=env).stdout
    except Exception:
        return ''


def main(argv):
    label = ' '.join(argv) or 'checkpoint'
    data = {'since': int(time.time()), 'label': label, 'running': running_rows(status_text())}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, OUT)
    print('overnight checkpoint: ' + str(len(data['running'])) + ' running')


if __name__ == '__main__':
    main(sys.argv[1:])
`
