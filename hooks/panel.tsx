import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { connSummary, readConns, refreshConns, resetConns } from './connectors'
import { EVENTS_REL, LOG_DIRS_REL, SEEN_REL, hhmm, insideDirs, parseEvents, parseLogDirs, unseenErrors } from './events'
import { GH_EVERY, openUrl, readGh } from './github'
import { resolveHome } from './home'
import { isDarwin } from './mac'
import { FRESH_MS, todoItems as parseTodo, parseTitles, pickMeta, slug } from './render'
import type { Conn, Ev, LogFilter, Meta, Todo } from '../types'

// The Status panel: the grouped status line, drawn in a docked pane beside the chat.
// It runs the plugin's own status line script with PB_FULL=1 every second while the pane is open.
// Section headers are buttons that fold or open the section through ~/.claude-progress/.state/folded.txt.
// To-dos come straight from ~/.claude-progress/todo.txt: open ones under TO-DO, checked-off ones under DONE.
// Pressing one opens a menu: mark as done (or move back to to-do) or delete.
// RUNNING rows draw as one line per job (short title, a 10-cell bar, %, time left), the bars in one column.
// Pressing a line opens its card (runCard): id and badge, count, step, facts and what it unlocks, from `title`, `why`
// and `parent` in its progress file or ~/.claude-progress/titles.txt. A running child shows under its open parent.
// Four tabs: List (the sections), Connectors (see connectors.ts), GitHub (see github.ts) and Log (events.ts).
// Connector checks run only while the pane is open; GitHub reads only while its tab shows.

export const PANE = 'progress-bar-status'
const TITLE = 'Status'
const COLUMNS = 52
const SCRIPT_REL = '.claude/progress-bar/statusline.sh'
export const PANEL_FLAG_REL = '.claude-progress/.state/panel-on'
const FOLDED_REL = '.claude-progress/.state/folded.txt'
const TODO_REL = '.claude-progress/todo.txt'

export const SECTION_KEYS = ['todo', 'running', 'done', 'waiting', 'problems'] as const
type Key = (typeof SECTION_KEYS)[number]
const TITLES: Record<string, Key> = { 'TO-DO': 'todo', RUNNING: 'running', WAITING: 'waiting', DONE: 'done', PROBLEMS: 'problems' }
const HOTKEYS: Record<Key, string> = { todo: '1', running: '2', done: '3', waiting: '4', problems: '5' }
const ICON: Record<Key, string> = { todo: '☐', running: '▶', waiting: '⏸', done: '✔', problems: '✖' }

const foldedAtom = atom({ plugin: 'progress-bar', key: 'folded' } as const, [])
const linesAtom = atom({ plugin: 'progress-bar', key: 'lines' } as const, [])
const todosAtom = atom({ plugin: 'progress-bar', key: 'todos' } as const, [])
const menuAtom = atom({ plugin: 'progress-bar', key: 'menuFor' } as const, -1)
// The same state connectors.ts writes; the scan wants each atom declared in the file that reads it.
const connsAtom = atom({ plugin: 'progress-bar', key: 'conns' } as const, { at: 0, checking: false, login: '', list: [] })
const tabAtom = atom({ plugin: 'progress-bar', key: 'tab' } as const, 'list')
const ghAtom = atom({ plugin: 'progress-bar', key: 'gh' } as const, { repos: [], sel: 0, at: 0 })
// Running jobs whose line is open to show its details, by slug.
const openAtom = atom({ plugin: 'progress-bar', key: 'openCards' } as const, [] as string[])
const metaAtom = atom({ plugin: 'progress-bar', key: 'meta' } as const, {} as Record<string, Meta>)
const logAtom = atom({ plugin: 'progress-bar', key: 'log' } as const, { events: [], filter: 'all', open: '', seenAt: 0, dirs: [] } as { events: Ev[]; filter: LogFilter; open: string; seenAt: number; dirs: string[] })
const DIR_REL = '.claude-progress'
const META_MS = 24 * 60 * 60_000

/** Removes terminal colors and OSC 8 links. */
export const stripAnsi = (s: string) =>
  s.replace(/\x1b\]8;;[^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '')

export type Section = { key: Key; title: string; folded: boolean; count: number; rows: string[] }

/** Splits the grouped output into sections (a header, then its indented rows) and the lines after them. */
export function parseSections(lines: string[]): { sections: Section[]; other: string[] } {
  const sections: Section[] = []
  const other: string[] = []
  for (const line of lines) {
    const head = /^([▾▸])\s+\S+\s+(TO-DO|RUNNING|WAITING|DONE|PROBLEMS)(?:\s+\((\d+)\))?\s*$/.exec(line)
    if (head) {
      sections.push({ key: TITLES[head[2]!]!, title: head[2]!, folded: head[1] === '▸', count: Number(head[3] ?? 0), rows: [] })
      continue
    }
    const last = sections[sections.length - 1]
    if (last && /^\s/.test(line)) last.rows.push(line.trim())
    else other.push(line.trim())
  }
  for (const s of sections) {
    if (s.folded) continue
    s.count = s.key === 'todo' ? s.rows.reduce((a, r) => a + todoItems(r).items.length, 0) : s.rows.length
  }
  return { sections, other }
}

/** "YOU: a · b" -> { who: 'You', items: ['a', 'b'] } */
export function todoItems(row: string): { who: string; items: string[] } {
  const m = /^([A-Z][A-Z0-9 _-]*):\s*(.*)$/.exec(row)
  const who = m ? m[1]!.charAt(0) + m[1]!.slice(1).toLowerCase() : ''
  return { who, items: (m ? m[2]! : row).split(' · ').map(s => s.trim()).filter(Boolean) }
}

export type RunCard = {
  mark: string
  stuck: string
  name: string
  pct: number | null
  count: string
  kind: { icon: string; text: string }
  step: string
  facts: string
  maxUsed: number | null
  /** "waiting on: X" from the grouper: the child job a quiet parent waits on. */
  waitOn: string
  /** Time left (from "X left", "ETA X" or "done in X"), ps run time and time so far, for the one-line view. */
  left: string
  ran: string
  elapsed: string
}

/**
 * A running row as a card: a kind badge, the bar's numbers, then labeled facts, so every kind of job reads the same way.
 * Kinds: 🏷 labeling (names ending -classify, -verify, -judge or -candidates), 🖥 a remote job ("host:" or "host: " before the name),
 * 🤖 a Claude agent (it reports "N tools"), else ⚙ job. Claude Max weekly use ("7d N%", "Max 7-day used N%") is pulled out
 * for one shared meter under RUNNING. "N% CPU" is a busy process, never progress: it shows as cores busy, and a ps
 * run time (`12:50`, `1-02:03:04`) as how long it has run.
 */
export function runCard(row: string): RunCard {
  const stuck = /^⚠ stuck (\S+)\s*/.exec(row)
  const spin = /^([◐◓◑◒])\s*/.exec(row)
  const clean = row.slice((stuck ?? spin)?.[0].length ?? 0)
  const rawName = clean.split(/\s+[█░]|\s+·\s+/)[0]!.trim()
  const name = rawName.replace(/\s+(working|pending|waiting|running|starting)(…|\.\.\.)?$/, '')
  const pctM = /(\d+(?:\.\d+)?)%(?!\s*CPU)/.exec(clean.replace(/·\s*(7d|Max 7-day used) \d+%/g, ''))
  const parts = clean.slice(rawName.length).replace(/^[\s█░·]+/, '').split(' · ').map(x => x.trim()).filter(x => x && !/^\d+(\.\d+)?%$/.test(x))
  const host = /^([A-Za-z0-9_.-]+):\s?\S/.exec(name)?.[1]
  const isAgent = parts.some(x => /^\d+ tools?$/.test(x))
  const kind = /-(classify|verify|judge|candidates)$/.test(name) ? { icon: '🏷', text: 'labeling' }
    : host ? { icon: '🖥', text: `on ${host}` }
    : isAgent ? { icon: '🤖', text: 'Claude agent' }
    : { icon: '⚙', text: 'job' }
  let count = '', step = '', elapsed = '', left = '', speed = '', actions = '', last = '', cores = '', ran = '', waitOn = ''
  let maxUsed: number | null = null
  for (const x of parts) {
    let m: RegExpExecArray | null
    if ((m = /^waiting on: (.+)$/.exec(x))) waitOn = m[1]!
    else if ((m = /^(\d+(?:\.\d+)?)% CPU$/.exec(x))) cores = `${(Number(m[1]) / 100).toFixed(1)} cores busy`
    else if (/^(\d+-)?\d+:\d\d(:\d\d)?$/.test(x)) ran = x
    else if ((m = /^Max 7-day used (\d+)%$/.exec(x)) || (m = /^7d (\d+)%$/.exec(x))) maxUsed = Math.max(maxUsed ?? 0, Number(m[1]))
    else if ((m = /^(\d+)\/(\d+)( batches)?$/.exec(x))) count = `${Number(m[1]).toLocaleString('en-US')} of ${Number(m[2]).toLocaleString('en-US')}${m[3] ? ' batches' : ' steps'}`
    else if ((m = /^done in (.+)$/.exec(x)) || (m = /^ETA (.+)$/.exec(x)) || (m = /^(.+) left$/.exec(x))) left = m[1]!
    else if (/\/min$/.test(x)) speed = x
    else if ((m = /^(\d+) tools?$/.exec(x))) actions = `${m[1]} actions`
    else if (/^(\d+h)?\d+m$|^\d+s$/.test(x)) elapsed = x
    else if (isAgent && /^[A-Z][A-Za-z]+$/.test(x)) last = x
    else step = step ? `${step} · ${x}` : x
  }
  if (last) actions = actions ? `${actions} · last: ${last}` : `last: ${last}`
  // Time left shows on the job's line, so the facts leave it out.
  const facts = [cores && `⚙ ${cores}`, ran && `⏱ ${ran} running`, elapsed && `⏱ ${elapsed} so far`, speed && `⚡ ${speed}`, actions && `🔧 ${actions}`].filter(Boolean).join('   ')
  return {
    mark: stuck ? '⚠' : spin ? spin[1]! : '•',
    stuck: stuck ? stuck[1]! : '',
    name,
    pct: pctM ? Number(pctM[1]) : null,
    count,
    kind,
    step,
    facts,
    maxUsed,
    waitOn,
    left,
    ran,
    elapsed,
  }
}

/** Minutes in "1h05m", "12m" or "45s", else 0. */
const toMin = (t: string) => {
  const m = /^(?:(\d+)h)?(\d+)m$/.exec(t)
  if (m) return Number(m[1] ?? 0) * 60 + Number(m[2])
  const sec = /^(\d+)s$/.exec(t)
  return sec ? Number(sec[1]) / 60 : 0
}
const fmtMin = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${String(Math.round(n % 60)).padStart(2, '0')}m` : `${Math.max(1, Math.round(n))}m`)

/**
 * The time on a job's one-line card. A reported time left wins ("12m left"). A row with step counts and no time left
 * (an agent) gets an estimate from its time so far per step done ("~8m left", while 0 < done < total). Else its ps run
 * time ("12:50 running"), else "Nm so far".
 */
export function timeTail(r: Pick<RunCard, 'left' | 'ran' | 'elapsed' | 'count'>): string {
  if (r.left) return `${r.left} left`
  const c = /^([\d,]+) of ([\d,]+)/.exec(r.count)
  const done = c ? Number(c[1]!.replace(/,/g, '')) : 0
  const total = c ? Number(c[2]!.replace(/,/g, '')) : 0
  const so = toMin(r.elapsed)
  if (so > 0 && done > 0 && done < total) return `~${fmtMin((so / done) * (total - done))} left`
  if (r.ran) return `${r.ran} running`
  return r.elapsed ? `${r.elapsed} so far` : ''
}

/** A job's short title: cut at " · " or ": ", keeping "<host>: name" whole for a remote job. */
export function shortTitle(t: string): string {
  const s = t.split(' · ')[0]!
  const remote = /^[A-Za-z0-9_.-]+:\s?\S/.test(s)
  return s.split(': ').slice(0, remote ? 2 : 1).join(': ')
}

/** The label column on a job's line: 14 to 26 characters by pane width, less a child's indent, so every bar lines up. */
export const labelCol = (width: number, ind = 0) => Math.max(10, Math.max(14, Math.min(26, width - 30)) - ind)

/** A label cut or padded to its column. */
export const fitLabel = (s: string, col: number) => (s.length > col ? `${s.slice(0, col - 1)}…` : s.padEnd(col))

/** The badge after a card's name or id: icon, two spaces, text. */
export const badge = (k: RunCard['kind']) => `${k.icon}  ${k.text}`

/**
 * Which rows nest: a row whose job names a running parent draws inside that parent's card, one level deep.
 * A remote "<host>: name" row without a parent of its own nests under the one running job whose slug starts
 * with "<host>-" (none or several: it keeps its own card).
 * A parent that itself has a running parent keeps its own card, so a loop never hides both.
 * Returns the top rows in order, each with its children.
 */
export function nestRows(names: string[], meta: Record<string, Meta>): { i: number; kids: number[] }[] {
  const slugs = names.map(slug)
  const at = new Map(slugs.map((s, i) => [s, i]))
  const hostOf = (n: string) => /^([A-Za-z0-9_.-]+):\s?\S/.exec(n)?.[1] ?? ''
  const parentOf = (i: number) => {
    const p = slug(meta[slugs[i]!]?.parent ?? '')
    if (p) return p !== slugs[i] && at.has(p) ? at.get(p)! : -1
    const host = slug(hostOf(names[i]!))
    if (!host) return -1
    const owners = names.map((_, j) => j).filter(j => j !== i && !hostOf(names[j]!) && slugs[j]!.startsWith(`${host}-`))
    return owners.length === 1 ? owners[0]! : -1
  }
  const nests = (i: number) => { const p = parentOf(i); return p >= 0 && parentOf(p) < 0 }
  return names.map((_, i) => i).filter(i => !nests(i)).map(i => ({ i, kids: names.map((_, j) => j).filter(j => nests(j) && parentOf(j) === i) }))
}

/** The RUNNING header count: top-level job lines, nested ones noted, as "4 (+3 sub-jobs)". */
export function runCount(names: string[], meta: Record<string, Meta>): string {
  const top = nestRows(names, meta)
  const kids = names.length - top.length
  return `${top.length}${kids ? ` (+${kids} sub-job${kids === 1 ? '' : 's'})` : ''}`
}

/** The indeterminate bar for a job with no %: a 3-block piece that slides one cell a second. Returns [before, after] widths. */
export function slide(nowMs: number, barW: number): [number, number] {
  const at = Math.floor(nowMs / 1000) % (barW - 3)
  return [at, barW - 3 - at]
}

/** The shared Claude Max meter: 10 cells, green under 50%, yellow under 80%, else red. */
export function maxMeter(used: number): { filled: number; color: 'green' | 'yellow' | 'red' } {
  return { filled: Math.round((Math.min(100, used) / 100) * 10), color: used >= 80 ? 'red' : used >= 50 ? 'yellow' : 'green' }
}

/** Titles, why and parent per job slug: titles.txt, then progress files changed in the last day (they win). */
async function readMeta($: EngineInterface, h: string) {
  const dir = `${h}/${DIR_REL}`
  let meta: Record<string, Meta> = {}
  try { meta = parseTitles(String(await $.fs.read(`${dir}/titles.txt`))) } catch { meta = {} }
  try {
    const now = await $.clock.now()
    for (const f of await $.fs.list(dir)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name.endsWith('.watch.json') || now - f.mtimeMs > Math.max(META_MS, FRESH_MS)) continue
      try {
        const m = pickMeta(JSON.parse(String(await $.fs.read(`${dir}/${f.name}`))))
        const k = f.name.slice(0, -5)
        if (Object.keys(m).length) meta[k] = { ...meta[k], ...m }
      } catch { /* half written */ }
    }
  } catch { /* no folder */ }
  const prev = await read($, metaAtom)
  if (JSON.stringify(prev) !== JSON.stringify(meta)) await update($, metaAtom, () => meta)
}

/** The events log, the time the Log tab was last opened and the log folders. */
async function readEvents($: EngineInterface, h: string) {
  let raw = '', seen = 0, dirs: string[] = []
  try { raw = String(await $.fs.read(`${h}/${EVENTS_REL}`)) } catch { raw = '' }
  try { seen = Number(String(await $.fs.read(`${h}/${SEEN_REL}`)).trim()) || 0 } catch { seen = 0 }
  try { dirs = parseLogDirs(String(await $.fs.read(`${h}/${LOG_DIRS_REL}`)), h) } catch { dirs = [] }
  const events = parseEvents(raw).slice(0, 200)
  const prev = await read($, logAtom)
  if (JSON.stringify(prev.events) !== JSON.stringify(events) || prev.seenAt < seen || prev.dirs.join('\n') !== dirs.join('\n')) {
    await update($, logAtom, l => ({ ...l, events, dirs, seenAt: Math.max(l.seenAt, seen) }))
  }
}

/** Opening the Log tab marks every error seen: the "!N" badge and the status line's "✖ N errors" clear. */
async function markSeen($: EngineInterface, h: string) {
  const now = Math.floor((await $.clock.now()) / 1000)
  await update($, logAtom, l => ({ ...l, seenAt: now }))
  try { await $.fs.write(`${h}/${SEEN_REL}`, String(now)) } catch { /* next open */ }
}

/** Opens a job's log in the default app, only when it lies inside a folder from log-dirs.txt. */
export async function openLog($: EngineInterface, path: string, dirs: string[]) {
  if (!insideDirs(path, dirs)) return
  try { await $.process.run([(await isDarwin($)) ? 'open' : 'xdg-open', path], { timeoutMs: 5000 }) } catch { /* gone */ }
}

/** A row's id in the Log tab. */
export const evId = (e: Ev) => `${e.ts}-${slug(e.source)}-${slug(e.title)}`.slice(0, 80)

async function readFolded($: EngineInterface, h: string): Promise<string[]> {
  let keys: string[] = []
  try { keys = String(await $.fs.read(`${h}/${FOLDED_REL}`)).split(/\s+/).filter(Boolean) } catch { keys = [] }
  const prev = await read($, foldedAtom)
  if (prev.join() !== keys.join()) await update($, foldedAtom, () => keys)
  return keys
}

/** Reads todo.txt into the to-dos atom, done ones included. */
async function readTodos($: EngineInterface, h: string) {
  let raw = ''
  try { raw = String(await $.fs.read(`${h}/${TODO_REL}`)) } catch { raw = '' }
  const out: Todo[] = parseTodo(raw).map(t => ({ owner: t.heading, text: t.text.split(' | ')[0]!.trim(), done: t.done, line: t.line }))
  const prev = await read($, todosAtom)
  if (JSON.stringify(prev) !== JSON.stringify(out)) await update($, todosAtom, () => out)
}

/** "3 weeks" -> "3w", "2 hours" -> "2h", "4 months" -> "4mo": a commit's age, short. */
export const shortAge = (w: string) => {
  const m = /^(\d+) (\w+)/.exec(w)
  if (!m) return w
  return `${m[1]}${m[2]!.startsWith('mo') ? 'mo' : m[2]!.charAt(0)}`
}

/** A todo.txt line's item text: no "x " mark, no " | link". */
const itemText = (l: string) => l.trim().replace(/^x\s+/i, '').split(' | ')[0]!.trim()

/**
 * One menu action on a to-do: mark done, mark to-do (reopen) or delete.
 * Acts on the line that still holds the item's text: the file can change between drawing and the press
 * (another session adds a line), so the line number alone could hit the wrong item.
 */
export async function todoAction($: EngineInterface, h: string, line: number, action: 'done' | 'todo' | 'delete', text = '') {
  const file = `${h}/${TODO_REL}`
  try {
    const lines = String(await $.fs.read(file)).split('\n')
    const same = (l: string) => itemText(l) === text.trim()
    if (text && !(line < lines.length && same(lines[line]!))) line = lines.findIndex(same)
    if (line >= 0 && line < lines.length) {
      const body = lines[line]!.trim().replace(/^x\s+/i, '')
      if (action === 'delete') lines.splice(line, 1)
      else lines[line] = action === 'done' ? `x ${body}` : body
      await $.fs.write(file, lines.join('\n'))
    }
  } catch { /* next press */ }
  await update($, menuAtom, () => -1)
  await pollPanel($, h)
}

/** Runs the status line script in full and keeps its lines. */
export async function pollPanel($: EngineInterface, h: string) {
  if (!h) return
  try {
    const { stdout } = await $.process.run(['/bin/sh', `${h}/${SCRIPT_REL}`], { stdin: '{}', env: { PB_FULL: '1' }, timeoutMs: 8000 })
    const lines = stripAnsi(stdout).split('\n').filter(l => l.trim())
    const prev = await read($, linesAtom)
    if (prev.join('\n') !== lines.join('\n')) await update($, linesAtom, () => lines)
  } catch { /* next tick */ }
  await readFolded($, h)
  await readTodos($, h)
  await readMeta($, h)
  await readEvents($, h)
  if ((await read($, tabAtom)) === 'log') {
    const l = await read($, logAtom)
    if (unseenErrors(l.events, l.seenAt, Math.floor((await $.clock.now()) / 1000))) await markSeen($, h)
  }
  await readConns($, h)
  void refreshConns($, h)
}

async function flip($: EngineInterface, h: string, key: Key) {
  const cur = new Set(await readFolded($, h))
  if (cur.has(key)) cur.delete(key)
  else cur.add(key)
  try { await $.fs.write(`${h}/${FOLDED_REL}`, [...cur].join('\n')) } catch { /* next press */ }
  await update($, foldedAtom, () => [...cur])
  await pollPanel($, h)
}

export async function openPanel($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

export async function isPanelOn($: EngineInterface, h: string): Promise<boolean> {
  return h ? $.fs.exists(`${h}/${PANEL_FLAG_REL}`).catch(() => false) : false
}

/** `/progress-bar panel [on|off]`. */
export async function panelCommand($: EngineInterface, h: string, arg: string): Promise<string> {
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  if (arg === 'on') {
    await $.fs.write(`${h}/${PANEL_FLAG_REL}`, 'on\n')
    await pollPanel($, h)
    await openPanel($)
    return 'Status panel on: it opens at session start, and the status line shows one summary line.'
  }
  if (arg === 'off') {
    await $.process.run(['rm', '-f', `${h}/${PANEL_FLAG_REL}`]).catch(() => undefined)
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return 'Status panel off: the status line shows the full groups again.'
  }
  if (arg) return 'Usage: /progress-bar panel [on | off]'
  await pollPanel($, h)
  await openPanel($)
  return (await isPanelOn($, h))
    ? 'Status panel opened.'
    : 'Status panel opened. `/progress-bar panel on` opens it at every session start.'
}

/** At session start: poll every second while the pane is open, and open it when the panel is on. */
export async function startPanel($: EngineInterface, h: string) {
  await resetConns($)
  $.clock.every(1000, async () => {
    const open = await $.ui.panes().then(ps => ps.some(p => p.id === PANE)).catch(() => false)
    if (open) await pollPanel($, h)
  })
  $.clock.every(GH_EVERY, async () => {
    if ((await read($, tabAtom)) !== 'github') return
    const open = await $.ui.panes().then(ps => ps.some(p => p.id === PANE)).catch(() => false)
    if (open) await readGh($, h)
  })
  if (await isPanelOn($, h)) {
    await pollPanel($, h)
    void openPanel($)
  }
}

/** Draws the pane. */
export function registerPanel(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const homeDir = await resolveHome($)
    const lines = await read($, linesAtom)
    const folded = new Set(await read($, foldedAtom))
    const todos = await read($, todosAtom)
    const menuFor = await read($, menuAtom)
    const conns = await read($, connsAtom)
    const tab = await read($, tabAtom)
    const openTodos = todos.filter(t => !t.done).length
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    const barW = Math.min(20, Math.max(10, width - 30))
    const { sections: parsed, other } = parseSections(lines)
    // TO-DO shows only while something is open. Checked-off to-dos go under DONE, so DONE shows if they exist.
    const doneTodos = todos.filter(t => t.done)
    const sections = parsed.filter(s => s.key !== 'todo' || openTodos > 0)
    if (openTodos > 0 && !sections.some(s => s.key === 'todo')) sections.unshift({ key: 'todo', title: 'TO-DO', folded: false, count: 0, rows: [] })
    if (doneTodos.length && !sections.some(s => s.key === 'done')) sections.push({ key: 'done', title: 'DONE', folded: false, count: 0, rows: [] })

    // One to-do as a button. Pressing it opens its menu below it.
    const todoItem = (t: Todo) => [
      <Button key={`t-${t.line}`} plain onPress={() => update($, menuAtom, v => (v === t.line ? -1 : t.line))}>
        {`    ${t.done ? '✓' : '○'} ${t.text}`}
      </Button>,
      menuFor === t.line
        ? <Box key={`m-${t.line}`}>
            <Text dimColor>{'      '}</Text>
            {t.done
              ? <Button key={`a-todo-${t.line}`} plain onPress={() => todoAction($, homeDir, t.line, 'todo', t.text)}>{'○ Move back to to-do  '}</Button>
              : <Button key={`a-done-${t.line}`} plain onPress={() => todoAction($, homeDir, t.line, 'done', t.text)}>{'✓ Mark as done  '}</Button>}
            <Button key={`a-del-${t.line}`} plain onPress={() => todoAction($, homeDir, t.line, 'delete', t.text)}>{'✕ Delete  '}</Button>
            <Button key={`a-x-${t.line}`} plain onPress={() => update($, menuAtom, () => -1)}>{'Cancel'}</Button>
          </Box>
        : null,
    ].filter(Boolean)

    // Each owner with open items, then those items.
    const todoRows = () => [...new Set(todos.map(t => t.owner))].flatMap(owner => {
      const items = todos.filter(t => t.owner === owner && !t.done)
      if (!items.length) return []
      return [
        <Text key={`w-${owner}`} bold color="magenta">{`  ${owner.charAt(0).toUpperCase()}${owner.slice(1).toLowerCase()}`}</Text>,
        ...items.flatMap(todoItem),
      ]
    })

    // Finished jobs, then the checked-off to-dos.
    const doneRows = (rows: string[]) => [
      ...plainRows(rows, 'done'),
      ...(doneTodos.length ? [<Text key="w-checked" bold color="magenta">{'  Checked-off to-dos'}</Text>, ...doneTodos.flatMap(todoItem)] : []),
    ]

    // Running jobs: one line each by default (mark, "▸ <short title>" padded to one column, a 10-cell bar, %, then time
    // left, run time, what it waits on or how long it has not moved). Pressing the title opens the card's details below
    // it: id and badge, count, step, facts and what it unlocks. A running child shows under its parent only while the
    // parent is open, marked ↳.
    const nowMs = await $.clock.now()
    const meta = await read($, metaAtom)
    const openCards = new Set(await read($, openAtom))
    const metaOf = (name: string): Meta => meta[slug(name)] ?? {}
    const short = (t: string) => t.split(' · ')[0]!
    const MINI = 10
    const card = (r: RunCard, k: string, ind: string, child: boolean, kid: string) => {
      const m0 = metaOf(r.name)
      const key = slug(r.name)
      const isOpen = openCards.has(key)
      const stuck = kid ? '' : r.stuck // a parent with a busy child is waiting, not stuck
      const waitOn = kid || r.waitOn
      const frac = r.pct === null ? null : Math.min(1, r.pct / 100)
      const filled = frac === null ? 0 : Math.round(frac * MINI)
      const [before, after] = slide(nowMs, MINI)
      const mark = stuck ? '⚠' : child ? '↳' : r.mark === '⚠' ? '•' : r.mark
      const pad = `${ind}    `
      const why = m0.why ? `unlocks: ${m0.why.replace(/^unlocks:?\s*/i, '')}` : ''
      const label = fitLabel(shortTitle(m0.title || r.name), labelCol(width, ind.length))
      const tail = stuck ? `⚠ no progress ${stuck}` : waitOn ? `waiting on ${short(waitOn)}` : timeTail(r)
      return [
        <Box key={`r${k}`}>
          <Text color={stuck ? 'yellow' : 'cyan'}>{`${ind}  ${mark} `}</Text>
          <Button key={`open-${key}`} plain onPress={() => update($, openAtom, l => (l.includes(key) ? l.filter(x => x !== key) : [...l, key]))}>
            {`${isOpen ? '▾' : '▸'} ${label}`}
          </Button>
          {frac === null
            ? [
                <Text key="a" dimColor>{`  ${'░'.repeat(before)}`}</Text>,
                <Text key="b" color={stuck ? 'yellow' : 'cyan'}>{'███'}</Text>,
                <Text key="c" dimColor>{'░'.repeat(after)}</Text>,
                <Text key="d">{'     '}</Text>,
              ]
            : [
                <Text key="a" color={stuck ? 'yellow' : 'green'}>{`  ${'█'.repeat(filled)}`}</Text>,
                <Text key="b" dimColor>{'░'.repeat(MINI - filled)}</Text>,
                <Text key="c" bold>{` ${String(Math.round(r.pct!)).padStart(3)}%`}</Text>,
              ]}
          {tail ? <Text color={stuck ? 'yellow' : undefined} dimColor={!stuck}>{`  ${tail}`}</Text> : null}
        </Box>,
        ...(isOpen
          ? [
              <Text key={`id${k}`} dimColor>{`${pad}${r.name}   ${badge(r.kind)}`}</Text>,
              r.count || frac === null ? <Text key={`c${k}`} dimColor>{`${pad}${r.count || 'steps not reported'}`}</Text> : null,
              waitOn ? <Text key={`t${k}`}>{`${pad}▸ waiting on: ${waitOn}`}</Text> : r.step ? <Text key={`t${k}`}>{`${pad}▸ ${r.step}`}</Text> : null,
              r.facts ? <Text key={`f${k}`} dimColor>{`${pad}${r.facts}`}</Text> : null,
              why ? <Text key={`w${k}`} dimColor>{`${pad}${why}`}</Text> : null,
            ].filter(Boolean)
          : []),
      ].filter(Boolean)
    }
    const runRows = (rows: string[]) => {
      const cards = rows.map(runCard)
      const used = cards.reduce<number | null>((a, c) => (c.maxUsed === null ? a : Math.max(a ?? 0, c.maxUsed)), null)
      const out = nestRows(cards.map(c => c.name), meta).flatMap(({ i, kids }) => {
        const c = cards[i]!
        const k0 = kids.length ? cards[kids[0]!]! : undefined
        const kid = k0 && c.stuck ? short(metaOf(k0.name).title || k0.name) : ''
        const open = openCards.has(slug(c.name))
        return [...card(c, `${i}`, '', false, kid), ...(open ? kids.flatMap(j => card(cards[j]!, `${i}c${j}`, '    ', true, '')) : [])]
      })
      if (used === null) return out
      const m = maxMeter(used)
      return [
        ...out,
        <Box key="maxmeter" marginTop={1}>
          <Text dimColor>{'  Claude Max this week  '}</Text>
          <Text color={m.color}>{'█'.repeat(m.filled)}</Text>
          <Text dimColor>{'░'.repeat(10 - m.filled)}</Text>
          <Text>{`  ${used}% used`}</Text>
        </Box>,
      ]
    }

    // Done rows: "✓ <title>  14:05" for a finished job, one dim line "✓ <title>  finishing · a/b" for a row at 100% that
    // still reports (no bar).
    const plainRows = (rows: string[], key: Key) => rows.map((row, i) => {
      const fin = /^(.*?) · finished (\d\d:\d\d)$/.exec(row)
      if (fin) return <Text key={`p${i}`} dimColor>{`  ✓ ${short(metaOf(fin[1]!).title || fin[1]!)}  ${fin[2]}`}</Text>
      if (key === 'done' && /[█░]/.test(row)) {
        const name = runCard(row.replace(/^[✔✓]\s*/, '')).name
        const c = /(\d+)\/(\d+)/.exec(row)
        return <Text key={`p${i}`} dimColor wrap="truncate-end">{`  ✓ ${short(metaOf(name).title || name)}  finishing${c ? ` · ${c[1]}/${c[2]}` : ''}`}</Text>
      }
      return <Text key={`p${i}`} color={key === 'problems' ? 'red' : undefined} dimColor={key === 'done'}>{`  ${row}`}</Text>
    })

    // The tab bar: List, Connectors (with "!N" when N need sign-in or failed), GitHub and Log (with "!N" unseen errors).
    // The shown tab has a bar mark.
    const badN = conns.list.filter(c => c.kind !== 'ok').length
    const log = await read($, logAtom)
    const nowS = Math.floor(nowMs / 1000)
    const unseen = unseenErrors(log.events, log.seenAt, nowS)
    const mark = (t: string) => (tab === t ? '▌' : ' ')
    const tabBar = (
      <Box key="tabs" marginBottom={1}>
        <Button key="tab-list" plain onPress={() => update($, tabAtom, () => 'list')}>{`${mark('list')}List`}</Button>
        <Text dimColor>{'  │  '}</Text>
        <Button key="tab-connectors" plain onPress={() => update($, tabAtom, () => 'connectors')}>{`${mark('connectors')}Connectors${badN ? ` !${badN}` : ''}`}</Button>
        <Text dimColor>{'  │  '}</Text>
        <Button key="tab-github" plain onPress={async () => { await update($, tabAtom, () => 'github'); await readGh($, homeDir) }}>{`${mark('github')}GitHub`}</Button>
        <Text dimColor>{'  │  '}</Text>
        <Button key="tab-log" plain onPress={async () => { await update($, tabAtom, () => 'log'); await markSeen($, homeDir) }}>{`${mark('log')}Log${unseen ? ` !${unseen}` : ''}`}</Button>
      </Box>
    )

    if (tab === 'github') {
      const gh = await read($, ghAtom)
      const n = gh.repos.length
      const repo = gh.repos[gh.sel]
      const [owner = '', slugName = ''] = repo?.url ? repo.url.replace('https://github.com/', '').split('/') : []
      const others = repo ? repo.branches.filter(b => !b.current) : []
      const msgW = Math.max(16, width - 8)
      const cut = (s: string) => (s.length > msgW ? `${s.slice(0, msgW - 1)}…` : s)
      const link = (path: string) => (repo?.url ? `${repo.url}${path}` : '')
      return (
        <Box flexDirection="column">
          {tabBar}
          {n > 1 && (
            <Box key="repo-pick" marginBottom={1}>
              <Button key="repo-prev" plain onPress={() => update($, ghAtom, g => ({ ...g, sel: (g.sel - 1 + n) % n }))}>{'‹  '}</Button>
              <Text dimColor>{`repo ${gh.sel + 1} of ${n}`}</Text>
              <Button key="repo-next" plain onPress={() => update($, ghAtom, g => ({ ...g, sel: (g.sel + 1) % n }))}>{'  ›'}</Button>
            </Box>
          )}
          {!repo && <Text dimColor>No git repo found.</Text>}
          {repo && [
            <Button key="gh-repo" plain onPress={() => openUrl($, repo.url)}>{`${slugName || repo.name}  ↗`}</Button>,
            owner ? <Text key="gh-owner" dimColor>{owner}</Text> : null,
            <Box key="gh-state" marginTop={1}>
              <Text color="green" bold>{`● ${repo.branch}`}</Text>
              <Text color={repo.ahead || repo.behind ? 'yellow' : undefined} dimColor={!repo.ahead && !repo.behind}>{`   ↑${repo.ahead} ↓${repo.behind}`}</Text>
              <Text color={repo.dirty ? 'yellow' : 'green'}>{repo.dirty ? `   ✎ ${repo.dirty} changed` : '   ✓ clean'}</Text>
            </Box>,
            <Text key="gh-bh" bold color="cyan">{`\nOTHER BRANCHES  ${others.length}`}</Text>,
            ...others.map(b => (
              <Button key={`br-${b.name}`} plain onPress={() => openUrl($, link(`/tree/${encodeURIComponent(b.name)}`))}>
                {`  ○ ${b.name}${b.ahead ? `  ↑${b.ahead}` : ''}${b.behind ? `  ↓${b.behind}` : ''}`}
              </Button>
            )),
            others.length ? null : <Text key="gh-nob" dimColor>{'  none'}</Text>,
            <Text key="gh-ch" bold color="cyan">{'\nRECENT COMMITS'}</Text>,
            ...repo.commits.map(c => (
              <Box key={`c-${c.sha}`}>
                <Button key={`cb-${c.sha}`} plain onPress={() => openUrl($, link(`/commit/${c.sha}`))}>{`  ${cut(c.subject)}`}</Button>
                <Text dimColor>{`  ${shortAge(c.when)}`}</Text>
              </Box>
            )),
            <Text key="gh-foot" dimColor>{`\n  click to open on GitHub${repo.commits[0]?.author ? ` · latest by ${repo.commits[0].author}` : ''}`}</Text>,
            <Button key="gh-refresh" plain onPress={() => readGh($, homeDir)}>{'  ↻ refresh'}</Button>,
          ].filter(Boolean)}
        </Box>
      )
    }

    if (tab === 'log') {
      // Counts for the last 24 h, filters, the newest 40 rows. A press shows a row's detail and, for a log inside a
      // folder from log-dirs.txt, an "open log" button.
      const ICONS: Record<string, [string, string]> = { error: ['✖', 'red'], warning: ['⚠', 'yellow'], success: ['✓', 'green'], info: ['•', 'cyan'] }
      const recent = log.events.filter(ev => nowS - ev.ts < 86_400)
      const n = (lv: string) => recent.filter(ev => ev.level === lv).length
      const FILTERS: [LogFilter, string][] = [['all', 'All'], ['error', 'Errors'], ['warning', 'Warnings'], ['success', 'Done']]
      const shown = log.events.filter(ev => log.filter === 'all' || ev.level === log.filter).slice(0, 40)
      return (
        <Box flexDirection="column">
          {tabBar}
          <Box key="log-counts">
            <Text color="red">{`✖ ${n('error')} error${n('error') === 1 ? '' : 's'}  `}</Text>
            <Text color="yellow">{`⚠ ${n('warning')} warning${n('warning') === 1 ? '' : 's'}  `}</Text>
            <Text color="green">{`✓ ${n('success')} done`}</Text>
            <Text dimColor>{'   last 24 h'}</Text>
          </Box>
          <Box key="log-filters" marginBottom={1}>
            {FILTERS.flatMap(([f, label], k) => [
              k ? <Text key={`lf-gap-${f}`} dimColor>{'  '}</Text> : null,
              <Button key={`lf-${f}`} plain onPress={() => update($, logAtom, l => ({ ...l, filter: f, open: '' }))}>{`${log.filter === f ? '▌' : ' '}${label}`}</Button>,
            ]).filter(Boolean)}
          </Box>
          {shown.length === 0 && <Text dimColor>{'  Nothing logged yet.'}</Text>}
          {shown.flatMap(ev => {
            const id = evId(ev)
            const [icon, color] = ICONS[ev.level] ?? ['•', 'cyan']
            const canOpen = !!ev.path && insideDirs(ev.path, log.dirs)
            return [
              <Button key={`ev-${id}`} plain onPress={() => update($, logAtom, l => ({ ...l, open: l.open === id ? '' : id }))}>
                <Text color={color}>{`${icon} `}</Text>
                <Text dimColor>{`${hhmm(ev.ts)}  `}</Text>
                <Text bold>{ev.title}</Text>
                {ev.source ? <Text dimColor>{`  ${ev.source}`}</Text> : null}
              </Button>,
              ...(log.open === id
                ? [
                    ...(ev.detail ?? '').split('\n').filter(Boolean).slice(0, 12).map((d, k) => <Text key={`evd-${id}-${k}`} dimColor>{`     ${d}`}</Text>),
                    ev.detail ? null : <Text key={`evd-${id}-none`} dimColor>{'     no details'}</Text>,
                    canOpen ? <Button key={`evo-${id}`} plain onPress={() => openLog($, ev.path!, log.dirs)}>{'     ↗ open log'}</Button> : null,
                  ].filter(Boolean)
                : []),
            ]
          })}
        </Box>
      )
    }

    if (tab === 'connectors') {
      const hhmm = (ms: number) => { const t = new Date(ms); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` }
      const ordered = [...conns.list.filter(c => c.kind === 'ok'), ...conns.list.filter(c => c.kind !== 'ok')]
      const COLOR = { ok: 'green', auth: 'yellow', fail: 'red' } as const
      const MARK = { ok: '✔', auth: '!', fail: '✖' } as const
      const connRow = (c: Conn) => [
        <Box key={`c-${c.name}`}>
          <Text color={COLOR[c.kind]}>{`  ${MARK[c.kind]} `}</Text>
          <Text bold>{c.name}</Text>
          {c.kind !== 'ok' ? <Text color={COLOR[c.kind]}>{c.kind === 'auth' ? '  needs sign-in' : '  failed'}</Text> : null}
        </Box>,
        c.account ? <Text key={`c-a-${c.name}`} dimColor>{`    ${c.account}`}</Text> : null,
      ].filter(Boolean)
      return (
        <Box flexDirection="column">
          {tabBar}
          <Text bold color="cyan">{`⚡ CONNECTORS  ${connSummary(conns.list)}`}</Text>
          {conns.login ? <Text dimColor>{`  Claude: ${conns.login}`}</Text> : null}
          {conns.list.length === 0 && <Text dimColor>{conns.checking ? '  checking…' : '  No check yet.'}</Text>}
          {ordered.flatMap(connRow)}
          <Box key="c-foot">
            <Text dimColor>{`  ${conns.checking ? 'checking…' : conns.at ? `checked ${hhmm(conns.at)}` : 'not checked'}  `}</Text>
            <Button key="c-refresh" plain onPress={() => refreshConns($, homeDir, true)}>{'↻ refresh'}</Button>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {tabBar}
        {sections.length === 0 && <Text dimColor>Nothing running.</Text>}
        {sections.map((sec, n) => {
          const isFolded = folded.has(sec.key) || sec.folded
          return (
            <Box key={`s-${sec.key}`} flexDirection="column" marginBottom={n < sections.length - 1 || other.length ? 1 : 0}>
              <Button key={`h-${sec.key}`} hotkey={HOTKEYS[sec.key]} plain onPress={() => flip($, homeDir, sec.key)}>
                {`${isFolded ? '▸' : '▾'} ${ICON[sec.key]} ${sec.title}  ${sec.key === 'todo' ? openTodos : sec.key === 'done' ? sec.count + doneTodos.length : sec.key === 'running' && sec.rows.length ? runCount(sec.rows.map(r => runCard(r).name), meta) : sec.count}`}
              </Button>
              {!isFolded && (sec.key === 'todo' ? todoRows() : sec.key === 'running' ? runRows(sec.rows) : sec.key === 'done' ? doneRows(sec.rows) : plainRows(sec.rows, sec.key))}
            </Box>
          )
        })}
        {other.map((l, i) => <Text key={`o${i}`} dimColor>{l}</Text>)}
      </Box>
    )
  })
}
