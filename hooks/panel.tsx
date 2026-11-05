import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, InputProps, On, RenderChildren, RenderInput } from 'claude-code'

import { AWAY_S, GAP_MS, OVERNIGHT_REL, dayOf, snapOf } from './checkpoint'
import { connSummary, readConns, refreshConns, resetConns } from './connectors'
import { EVENTS_REL, LOG_DIRS_REL, SEEN_REL, hhmm, insideDirs, parseEvents, parseLogDirs, unseenErrors } from './events'
import { GH_EVERY, openUrl, openWeb, readGh } from './github'
import { resolveHome } from './home'
import { ACTION_PANE, logEvent, canRun, cancelRun, closeAction, confirmRun, copyCommand, cut as cutA, ranIt, readActions, runAction } from './actions'
import { markRead, openLocal, readChannel } from './channel'
import { PAGE_LINES, kb, pageCount, readChat, selectChannel, sendChat, toggleOpen, when } from './chat'
import { markHandled, readInbox } from './inbox'
import { isDarwin } from './mac'
import { backfillAgent, clock, doneDetails, machineName, prettyName, readDone } from './done'
import { moveItem, nextPrompt, rankTodos, todoRows as layoutTodos } from './priority'
import { sessionProject } from './project'
import { DEFAULT_TOPOLOGY, queuesOf, readTopology, renderTopology, resolveMachine } from './topology'
import type { TopoJob } from './topology'
import { turnOnStatusLine } from './setup'
import { parseSaved } from './usage'
import type { UsageReading } from './usage'
import { FEW_STEPS, FRESH_MS, todoItems as parseTodo, parseTitles, pickMeta, slug } from './render'
import type { Action, ActionUi, Channel, ChatMsg, ChatState, Checkpoint, Conn, DoneRec, Ev, Health, Inbox, LogFilter, Meta, Recap, Snap, Todo } from '../types'

// The Status panel: the grouped status line, drawn in a docked pane beside the chat.
// It runs the plugin's own status line script with PB_FULL=1 every second while the pane is open.
// Section headers are buttons that fold or open the section through ~/.claude-progress/.state/folded.txt. Their hotkeys
// are 1, 2, 3... in the order they show.
// To-dos come straight from ~/.claude-progress/todo.txt: open ones under TO-DO, checked-off ones under DONE.
// Pressing one opens a menu: mark as done (or move back to to-do), move up or down, start now, or delete.
// Open to-dos show by priority ("N. " in todo.txt, see priority.ts) with their number. One that waits for a running
// job ("(after X)") shows dim with "waits for X". The top ready one of each machine is marked "next".
// RUNNING rows draw as one line per job (short title, a 10-cell bar, %, time left), the bars in one column.
// Pressing a line opens its card (runCard): id and badge, count, step, facts and what it unlocks, from `title`, `why`
// and `parent` in its progress file or ~/.claude-progress/titles.txt. A running child shows under its open parent.
// Six tabs: List (the sections), Connectors (see connectors.ts), GitHub (see github.ts), Log (events.ts), Chat
// (chat.ts: the secure channel as a chat room, one thread per channel, with a compose field) and Topology
// (topology.ts: the machines as boxes, their jobs and queued to-dos, and what data moves between them).
// Connector checks run only while the pane is open; GitHub reads only while its tab shows.
// Overnight recap: `/progress-bar checkpoint` (or checkpoint.py) saves the running jobs. Once you are back (4 h later, or
// a tick gap over 30 min shows the computer slept) the List tab opens with "While you were away": what finished, failed
// or moved since. Dismiss archives the checkpoint to .state/overnight-YYYY-MM-DD.json.
// Inbox (inbox.ts): items in ~/.claude-progress/inbox.json show first on the List tab. A press opens the https url,
// "✓ handled" hides the item.

export const PANE = 'progress-bar-status'
const TITLE = 'Status'
const COLUMNS = 52
const SCRIPT_REL = '.claude/progress-bar/statusline.sh'
export const PANEL_FLAG_REL = '.claude-progress/.state/panel-on'
// `/progress-bar panel off` leaves this, so the default (panel on for a new install) never turns it back on.
export const PANEL_OFF_REL = '.claude-progress/.state/panel-off'
// The one-time hint when the pane cannot open (a narrow terminal).
export const PANEL_HINT_REL = '.claude-progress/.state/panel-hint-shown'
const FOLDED_REL = '.claude-progress/.state/folded.txt'

export const SECTION_KEYS = ['todo', 'running', 'done', 'waiting', 'problems'] as const
type Key = (typeof SECTION_KEYS)[number]
const TITLES: Record<string, Key> = { 'TO-DO': 'todo', RUNNING: 'running', WAITING: 'waiting', DONE: 'done', PROBLEMS: 'problems' }
const ICON: Record<Key, string> = { todo: '☐', running: '▶', waiting: '⏸', done: '✔', problems: '✖' }

const foldedAtom = atom({ plugin: 'progress-bar', key: 'folded' } as const, [])
const linesAtom = atom({ plugin: 'progress-bar', key: 'lines' } as const, [])
const todosAtom = atom({ plugin: 'progress-bar', key: 'todos' } as const, [])
// This session's project (its to-do list's name), from project.ts.
const projectAtom = atom({ plugin: 'progress-bar', key: 'project' } as const, '')
const menuAtom = atom({ plugin: 'progress-bar', key: 'menuFor' } as const, -1)
// The same state connectors.ts writes; the scan wants each atom declared in the file that reads it.
const connsAtom = atom({ plugin: 'progress-bar', key: 'conns' } as const, { at: 0, checking: false, login: '', list: [] })
const tabAtom = atom({ plugin: 'progress-bar', key: 'tab' } as const, 'list')
// Topology tab: topology.json and heartbeat health, read each tick while the tab shows.
const topoAtom = atom({ plugin: 'progress-bar', key: 'topo' } as const, { cfg: DEFAULT_TOPOLOGY, health: {} })
const ghAtom = atom({ plugin: 'progress-bar', key: 'gh' } as const, { repos: [], sel: 0, at: 0 })
// Running jobs whose line is open to show its details, by slug.
const openAtom = atom({ plugin: 'progress-bar', key: 'openCards' } as const, [] as string[])
const metaAtom = atom({ plugin: 'progress-bar', key: 'meta' } as const, {} as Record<string, Meta>)
const logAtom = atom({ plugin: 'progress-bar', key: 'log' } as const, { events: [], filter: 'all', open: '', seenAt: 0, dirs: [] } as { events: Ev[]; filter: LogFilter; open: string; seenAt: number; dirs: string[] })
const recapAtom = atom({ plugin: 'progress-bar', key: 'recap' } as const, { cp: null, lastTick: 0, open: false } as Recap)
const inboxAtom = atom({ plugin: 'progress-bar', key: 'inbox' } as const, { checked: 0, items: [] } as Inbox)
const channelAtom = atom({ plugin: 'progress-bar', key: 'channel' } as const, { items: [] } as Channel)
const chatAtom = atom({ plugin: 'progress-bar', key: 'chat' } as const, { msgs: [], channels: [], sel: '', open: '', page: 0, full: [], sending: false, note: '', draft: '', n: 0 } as ChatState)
const actionsAtom = atom({ plugin: 'progress-bar', key: 'actions' } as const, [] as Action[])
const actionUiAtom = atom({ plugin: 'progress-bar', key: 'actionUi' } as const, { confirm: '', term: '', failId: '', fail: '' } as ActionUi)
// Why the panel or status line may show nothing (pollPanel, noteStatusLine), drawn as a short line.
const healthAtom = atom({ plugin: 'progress-bar', key: 'health' } as const, { script: '', statusOff: '', note: '' } as Health)
// Done records by slug (done.ts): what each finished job or agent changed.
const doneAtom = atom({ plugin: 'progress-bar', key: 'done' } as const, {} as Record<string, DoneRec>)
const DIR_REL = '.claude-progress'
// Holds why the status line was not switched over, once that was logged, so the Log tab says it once, not every
// session. The panel reads it for its "Turn on status line" line.
export const STATUS_OFF_REL = '.claude-progress/.state/statusline-off'

const firstLine = (t: string) => t.split('\n').map(l => l.trim()).find(Boolean)?.slice(0, 200) ?? ''

/** The panel's note for a status script run: '' when it printed, or said nothing with no error. */
export function scriptNote(r: { exitCode: number; stdout: string; stderr: string }): string {
  if (r.stdout.trim()) return ''
  const why = firstLine(r.stderr)
  if (r.exitCode !== 0) return `Status script failed (exit ${r.exitCode})${why ? `: ${why}` : ''}`
  return why ? `Status script returned nothing: ${why}` : ''
}

/**
 * Why the status line is not the plugin's script, or '' when it is: `applied` says the settings.read hook ran on the
 * engine's merge, `current` is the status line the settings files hold.
 */
export function statusOffReason(applied: boolean, current: string | undefined): string {
  return applied || current?.includes(SCRIPT_REL)
    ? ''
    : `The status line was not switched over${current ? ` (it still runs ${current})` : ''}. Another plugin's settings.read hook may run first.`
}

/** Log it once (the marker absent), clear the marker once it is on again, else nothing. */
export function statusOffAction(off: string, logged: boolean): 'log' | 'clear' | 'none' {
  return off && !logged ? 'log' : !off && logged ? 'clear' : 'none'
}

/**
 * At session start: whether the settings.read hook switched the status line over. Another plugin's settings.read hook
 * that answers first skips it, so the panel then offers "Turn on status line" and the Log tab says why, once.
 */
export async function noteStatusLine($: EngineInterface, h: string, applied: boolean, current: string | undefined) {
  if (!h) return
  const off = statusOffReason(applied, current)
  const marker = `${h}/${STATUS_OFF_REL}`
  const logged = await $.fs.exists(marker).catch(() => false)
  const act = statusOffAction(off, logged)
  if (act === 'log') {
    await logEvent($, h, 'warning', 'Status line not switched over', `${off}\nPress "Turn on status line" in the Status panel, or run /progress-bar setup.`)
    await $.fs.write(marker, `${off}\n`).catch(() => undefined)
  } else if (act === 'clear') {
    await $.process.run(['rm', '-f', marker]).catch(() => undefined)
  }
}

/** The panel's copy of the status-line-off reason, from the marker noteStatusLine leaves. */
async function readStatusOff($: EngineInterface, h: string) {
  let statusOff = ''
  try { statusOff = firstLine(String(await $.fs.read(`${h}/${STATUS_OFF_REL}`))) } catch { statusOff = '' }
  if ((await read($, healthAtom)).statusOff !== statusOff) await update($, healthAtom, x => ({ ...x, statusOff }))
}

async function turnOn($: EngineInterface, h: string) {
  let note = ''
  try { note = await turnOnStatusLine($, h) } catch (err) { note = `Could not turn on the status line: ${firstLine(String(err))}` }
  const on = note.startsWith('Status line on')
  if (on && h) await $.process.run(['rm', '-f', `${h}/${STATUS_OFF_REL}`]).catch(() => undefined)
  const noteAt = await $.clock.now()
  await update($, healthAtom, x => ({ ...x, note, noteAt, statusOff: on ? '' : x.statusOff }))
}

/** How long the answer to "Turn on status line" stays on the List tab. */
export const NOTE_MS = 3 * 60_000

/** Whether that answer still shows: set less than NOTE_MS ago (a note with no time is from an older build: stale). */
export const noteShows = (h: { note: string; noteAt?: number }, now: number) => !!h.note && !!h.noteAt && now - h.noteAt < NOTE_MS
const META_MS = 24 * 60 * 60_000

/** Removes terminal colors and OSC 8 links. */
export const stripAnsi = (s: string) =>
  s.replace(/\x1b\]8;;[^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '')

export type Section = { key: Key; title: string; folded: boolean; count: number; rows: string[] }

/**
 * Splits the grouped output into sections (a header, then its indented rows), the machine status lines ("🖥 ...")
 * and the lines after them.
 */
export function parseSections(lines: string[]): { sections: Section[]; other: string[]; machines: string[] } {
  const sections: Section[] = []
  const other: string[] = []
  const machines: string[] = []
  for (const line of lines) {
    if (line.startsWith('🖥 ')) { machines.push(line.trim()); continue }
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
  return { sections, other, machines }
}

/** Finished jobs from the done records shown under DONE besides the grouper's rows: the last 12 h, up to DONE_MAX rows in all. */
export const DONE_SHOW_MS = 12 * 3_600_000
export const DONE_MAX = 20

export type DoneItem = { key: string; name: string; at: string; finishing?: string; text?: string }

/**
 * The DONE rows: the grouper's (finished "name · finished HH:MM", a row at 100% still reporting as finishing, any
 * other row as plain text), then done records from the last 12 h not shown yet and not running or waiting again,
 * newest first, up to DONE_MAX in all.
 */
export function doneItems(rows: string[], recs: Record<string, DoneRec>, live: Set<string>, now: number): DoneItem[] {
  const out: DoneItem[] = rows.map(row => {
    const fin = /^(.*?) · finished (\d\d:\d\d)$/.exec(row)
    if (fin) return { key: slug(fin[1]!), name: fin[1]!, at: fin[2]! }
    if (/[█░]/.test(row)) {
      const name = runCard(row.replace(/^[✔✓]\s*/, '')).name
      const c = /(\d+)\/(\d+)/.exec(row)
      return { key: slug(name), name, at: '', finishing: `finishing${c ? ` · ${c[1]}/${c[2]}` : ''}` }
    }
    return { key: '', name: '', at: '', text: row }
  })
  const shown = new Set(out.map(x => x.key).filter(Boolean))
  const extra = Object.values(recs)
    .filter(r => now - r.finished < DONE_SHOW_MS && !shown.has(r.slug) && !live.has(r.slug))
    .sort((a, b) => b.finished - a.finished)
    .map(r => ({ key: r.slug, name: r.slug, at: clock(r.finished) }))
  return [...out, ...extra].slice(0, Math.max(out.length, DONE_MAX))
}

/** A DONE row's title: its record's, else its progress file's or titles.txt's, else its name made readable. */
export function doneTitle(name: string, rec: DoneRec | undefined, metaTitle = ''): string {
  return (rec?.title || metaTitle || prettyName(name)).split(' · ')[0]!
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
  /** "watched by: X" from the grouper: a waiting watcher agent folded into the job it watches. */
  watchedBy: string
  /** A waiting agent's "waiting 12m": how long it has waited. */
  waited: string
  /** A waiting agent's "last action 4m ago: Bash, check log", or a pending one's "not started yet". */
  note: string
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
  // ✔: a job that just finished, kept under RUNNING for a minute by the grouper (LINGER).
  const spin = /^([◐◓◑◒✔])\s*/.exec(row)
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
  let count = '', step = '', elapsed = '', left = '', speed = '', actions = '', last = '', cores = '', ran = '', waitOn = '', watchedBy = '', waited = '', note = ''
  let maxUsed: number | null = null
  for (const x of parts) {
    let m: RegExpExecArray | null
    if ((m = /^waiting on: (.+)$/.exec(x))) waitOn = m[1]!
    else if ((m = /^watched by: (.+)$/.exec(x))) watchedBy = m[1]!
    else if ((m = /^waiting ((?:\d+h)?\d+m)$/.exec(x))) waited = m[1]!
    else if (/^last action\b.+$|^not started yet$/.test(x)) note = x
    else if ((m = /^(\d+(?:\.\d+)?)% CPU$/.exec(x))) cores = `${(Number(m[1]) / 100).toFixed(1)} cores busy`
    else if (/^(\d+-)?\d+:\d\d(:\d\d)?$/.test(x)) ran = x
    else if ((m = /^Max 7-day used (\d+)%$/.exec(x)) || (m = /^7d (\d+)%$/.exec(x))) maxUsed = Math.max(maxUsed ?? 0, Number(m[1]))
    else if ((m = /^(\d+)\/(\d+)( batches)?$/.exec(x))) count = `${Number(m[1]).toLocaleString('en-US')} of ${Number(m[2]).toLocaleString('en-US')}${m[3] ? ' batches' : Number(m[2]) > FEW_STEPS ? ' items' : ' steps'}`
    else if ((m = /^done in (.+)$/.exec(x)) || (m = /^ETA (.+)$/.exec(x)) || (m = /^(.+) left$/.exec(x))) left = m[1]!
    else if (/\/min$/.test(x)) speed = x
    else if ((m = /^(\d+) tools?$/.exec(x))) actions = `${m[1]} actions`
    else if (/^(\d+h)?\d+m$|^\d+[sh]$/.test(x)) elapsed = x
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
    watchedBy,
    waited,
    note,
    left,
    ran,
    elapsed,
  }
}

/**
 * Whether a job's raw name says what its title says: the same words, any case, a machine prefix ("Hunty: ") or a
 * leading machine word left out. "Hunty: similar orgs" and "Hunty similar orgs" are the same, so is "mac-label-x" and
 * "Mac: Mac label x".
 */
export function sameName(name: string, title: string): boolean {
  const words = (x: string) => x.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const a = words(name), b = words(title)
  const eq = (x: string[], y: string[]) => x.length === y.length && x.every((w, i) => w === y[i])
  return eq(a, b) || eq(a, b.slice(1)) || eq(a.slice(1), b) || eq(a.slice(1), b.slice(1))
}

/**
 * Why a WAITING row waits: "waiting on: X" from the grouper, else the text after "waiting on", "waiting for", "waits for"
 * or "waiting" in its step, name or row, up to the next " · ". Empty when it gives no reason.
 */
export function waitReason(r: Pick<RunCard, 'waitOn' | 'step' | 'name'>, row = ''): string {
  if (r.waitOn) return r.waitOn
  for (const s of [r.step, r.name, row]) {
    const m = /\bwait(?:ing|s)\b(?:\s+(?:on|for))?:?\s*([^·]*)/i.exec(s)
    if (m && m[1]!.trim()) return m[1]!.trim()
  }
  return ''
}

/**
 * The whole reason a WAITING row waits, as it reads on the row: a rate limit pause, "waiting on X" (waitReason), a
 * waiting agent's last action, its step, or '' when nothing is known.
 */
export function waitPhrase(r: Pick<RunCard, 'waitOn' | 'step' | 'name' | 'note'>, row = ''): string {
  const rate = /\b(rate[- ]?limit\w*|429|throttl\w*)/i
  if (rate.test(r.step)) return `paused by a rate limit: ${r.step}`
  if (rate.test(row)) return 'paused by a rate limit'
  const on = waitReason(r, row)
  if (on) return `waiting on ${on}`
  if (r.note) return r.note
  return r.step ? `last step: ${r.step}` : ''
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
 * The time on a job's one-line card. A reported time left wins ("12m left"). An item count (over FEW_STEPS) with no
 * time left gets an estimate from its time so far per item done ("~8m left", while 0 < done < total). A job of few
 * steps gets none: its steps take uneven time, so no estimate beats a wrong one. Else its ps run time
 * ("12:50 running"), else "Nm so far".
 */
export function timeTail(r: Pick<RunCard, 'left' | 'ran' | 'elapsed' | 'count'>): string {
  if (r.left) return `${r.left} left`
  const c = /^([\d,]+) of ([\d,]+)/.exec(r.count)
  const done = c ? Number(c[1]!.replace(/,/g, '')) : 0
  const total = c ? Number(c[2]!.replace(/,/g, '')) : 0
  const so = toMin(r.elapsed)
  if (so > 0 && done > 0 && done < total && total > FEW_STEPS) return `~${fmtMin((so / done) * (total - done))} left`
  if (r.ran) return `${r.ran} running`
  return r.elapsed ? `${r.elapsed} so far` : ''
}

/** A job's short title: cut at " · " or ": ", keeping "<host>: name" whole for a remote job. */
export function shortTitle(t: string): string {
  const s = t.split(' · ')[0]!
  const remote = /^[A-Za-z0-9_.-]+:\s?\S/.test(s)
  return s.split(': ').slice(0, remote ? 2 : 1).join(': ')
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/**
 * Machines for row labels: remote hosts are "<host>: name" row prefixes plus to-do headings ([mac], [hunty], ...).
 * The local one is the heading named mac or local, else the first heading that is neither "you" nor a remote host.
 */
export function machines(rowNames: string[], owners: string[]): { local: string; remote: string[] } {
  const prefixes = rowNames.map(n => /^([a-z0-9_.-]+):\s/.exec(n)?.[1]).filter((x): x is string => !!x)
  const heads = [...new Set(owners.map(o => o.toLowerCase()))].filter(o => o !== 'you')
  const local = heads.find(h => h === 'mac' || h === 'local') ?? heads.find(h => !prefixes.includes(h)) ?? ''
  const remote = [...new Set([...prefixes, ...heads])].filter(h => h !== local)
  return { local: local ? (local === 'mac' ? 'Mac' : cap(local)) : '', remote }
}

/**
 * A running job's label with its machine in front: "Hunty: Similar orgs" or "Mac: Health care". The machine comes
 * from the row name ("hunty: x"), else a title starting with a remote host ("Hunty CPU batch"), else the local one.
 * With no remote machine known, it is the plain short title.
 */
export function machineTitle(name: string, title: string, m: { local: string; remote: string[] }): string {
  const t = shortTitle(title)
  if (!m.remote.length || !m.local) return t
  const host = (x: string) => m.remote.find(h => x.toLowerCase() === h)
  const n = /^([A-Za-z0-9_.-]+):\s/.exec(name)?.[1]
  const lead = /^([A-Za-z0-9_.-]+)(?::|\s|$)/.exec(t)?.[1] ?? ''
  const h = host(lead) ?? (n ? host(n) : undefined)
  if (!h) return `${m.local}: ${t}`
  const rest = lead.toLowerCase() === h ? t.slice(lead.length).replace(/^[\s:]+/, '') : t
  return `${cap(h)}: ${cap(rest || t)}`
}

/**
 * The label column on a job's line: 14 to 34 characters by pane width (fewer in a pane under 37), less a child's
 * indent, so every bar lines up.
 * It leaves 13 columns after the bar for the note ("  3:10 running", "  ⚠ stuck 12m"): a row wider than the pane makes every part shrink,
 * and the bar's Texts then wrap onto two lines.
 */
export const labelCol = (width: number, ind = 0) => {
  // The row is 23 columns plus the parent's label (a child's indent comes out of its own label), so a pane too narrow
  // for 14 shrinks the label to fit; below 37 columns the note is dropped (fit() returns '').
  const base = Math.max(14, Math.min(34, width - 38))
  return Math.max(3, Math.min(base, width - 23) - ind)
}

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

/** A saved reading younger than this shows no time: it is current enough. */
export const STALE_READING_MS = 35 * 60_000

/**
 * The usage meter's value: the live reading while a job reports one, else the last saved reading (up to 7 days),
 * with its time ("as of 12:39") once it is over STALE_READING_MS old. `save` is set when the saved reading should be
 * updated.
 */
export function maxReading(live: number | null, saved: { pct: number; at: number } | null, now: number): { used: number | null; asOf: string; save: boolean } {
  if (live !== null) return { used: live, asOf: '', save: !saved || saved.pct !== live || now - saved.at > 60_000 }
  if (saved && typeof saved.pct === 'number' && now - saved.at < 7 * 86_400_000) {
    const t = new Date(saved.at)
    const asOf = now - saved.at > STALE_READING_MS ? `as of ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : ''
    return { used: saved.pct, asOf, save: false }
  }
  return { used: null, asOf: '', save: false }
}

/** The meter's name: the saved plan ("Team"), "Max" when the plan is not known. */
export function meterLabel(plan?: string): string {
  return plan && /^[A-Za-z][A-Za-z0-9 ]{0,19}$/.test(plan) ? plan : 'Max'
}

/** The usage meter's cells: `cells` wide, green under 50%, yellow under 80%, else red. */
export function maxMeter(used: number, cells = 10): { filled: number; color: 'green' | 'yellow' | 'red' } {
  return { filled: Math.round((Math.min(100, used) / 100) * cells), color: used >= 80 ? 'red' : used >= 50 ? 'yellow' : 'green' }
}

/** The compact meter's cells. */
export const METER_CELLS = 5

/** The compact meter's text, "Team 48% ━━━── 7d", with " · as of 07:38" for an old reading. */
export function meterText(plan: string | undefined, used: number, asOf: string): string {
  const f = maxMeter(used, METER_CELLS).filled
  return `${meterLabel(plan)} ${used}% ${'━'.repeat(f)}${'─'.repeat(METER_CELLS - f)} 7d${asOf ? ` · ${asOf}` : ''}`
}

/** The tab row's text width: the tab labels and the " │ " between them. */
export const tabsWidth = (labels: string[]) => labels.reduce((a, l) => a + l.length, 0) + 3 * Math.max(0, labels.length - 1)

/** Where the meter goes: on the tab row when it fits after the tabs with two spaces to spare, else its own line. */
export const meterOnTabRow = (tabsW: number, meterW: number, width: number) => tabsW + 2 + meterW <= width

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
/** A stable, unique key for a Log event: readable head plus a hash of the whole event, so long titles never collide. */
export const evId = (e: Ev) => {
  const full = `${e.ts}|${e.level}|${e.source}|${e.title}|${e.detail ?? ''}`
  let h = 5381
  for (let i = 0; i < full.length; i++) h = ((h << 5) + h + full.charCodeAt(i)) >>> 0
  return `${`${e.ts}-${slug(e.source)}-${slug(e.title)}`.slice(0, 60)}-${h.toString(36)}`
}

async function readFolded($: EngineInterface, h: string): Promise<string[]> {
  let keys: string[] = []
  try { keys = String(await $.fs.read(`${h}/${FOLDED_REL}`)).split(/\s+/).filter(Boolean) } catch { keys = [] }
  const prev = await read($, foldedAtom)
  if (prev.join() !== keys.join()) await update($, foldedAtom, () => keys)
  return keys
}

/** Reads this project's to-do list (project.ts) into the to-dos atom, done ones included. */
async function readTodos($: EngineInterface, h: string) {
  const p = await sessionProject($, h)
  if ((await read($, projectAtom)) !== p.slug) await update($, projectAtom, () => p.slug)
  let raw = ''
  try { raw = String(await $.fs.read(p.path)) } catch { raw = '' }
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
  const file = (await sessionProject($, h)).path
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

/** Move up or Move down: renumbers the item's heading in todo.txt. Matches the item by its text. */
export async function todoMove($: EngineInterface, h: string, text: string, dir: 'up' | 'down') {
  const file = (await sessionProject($, h)).path
  try {
    const out = moveItem(String(await $.fs.read(file)), text, dir)
    if (out !== null) await $.fs.write(file, out)
  } catch { /* next press */ }
  await pollPanel($, h)
}

/**
 * The status line's stdin for this session: its id and folder, so the script shows this session's bars
 * (agents-<session>.txt, and shared files todos/lines.txt gives its project) and group.py its project's to-dos.
 */
export async function sessionInput($: EngineInterface, h: string): Promise<string> {
  let session_id = ''
  try { session_id = await $.session.id() } catch { session_id = '' }
  const { cwd } = await sessionProject($, h)
  return JSON.stringify({ session_id, cwd, workspace: { current_dir: cwd } })
}

async function setScriptNote($: EngineInterface, script: string) {
  if ((await read($, healthAtom)).script !== script) await update($, healthAtom, x => ({ ...x, script }))
}

/** Runs the status line script in full, as this session, and keeps its lines. */
export async function pollPanel($: EngineInterface, h: string) {
  if (!h) return
  try {
    const r = await $.process.run(['/bin/sh', `${h}/${SCRIPT_REL}`], { stdin: await sessionInput($, h), env: { PB_FULL: '1' }, timeoutMs: 8000 })
    const lines = stripAnsi(r.stdout).split('\n').filter(l => l.trim())
    const prev = await read($, linesAtom)
    if (prev.join('\n') !== lines.join('\n')) await update($, linesAtom, () => lines)
    await setScriptNote($, scriptNote(r))
  } catch (err) {
    await setScriptNote($, `Status script could not run: ${firstLine(String(err)) || 'unknown error'}`)
  }
  await readStatusOff($, h)
  const hl = await read($, healthAtom)
  if (hl.note && !noteShows(hl, await $.clock.now())) await update($, healthAtom, x => ({ ...x, note: '' }))
  await readFolded($, h)
  await readTodos($, h)
  await readMeta($, h)
  const done = await readDone($, h)
  if (JSON.stringify(await read($, doneAtom)) !== JSON.stringify(done)) await update($, doneAtom, () => done)
  await readEvents($, h)
  await readActions($, h)
  await readInbox($, h)
  await readChannel($, h)
  await readChat($, h)
  if ((await read($, tabAtom)) === 'log') {
    const l = await read($, logAtom)
    if (unseenErrors(l.events, l.seenAt, Math.floor((await $.clock.now()) / 1000))) await markSeen($, h)
  }
  if ((await read($, tabAtom)) === 'topology') await readTopo($, h)
  await readConns($, h)
  // Runs on past this poll (claude mcp list can take a minute), so a reload or session end can cut it off: never an unhandled rejection.
  void refreshConns($, h).catch(() => undefined)
}

/** Reads topology.json and the heartbeat files into the Topology tab's state. */
async function readTopo($: EngineInterface, h: string) {
  const t = await readTopology($, h)
  if (JSON.stringify(await read($, topoAtom)) !== JSON.stringify(t)) await update($, topoAtom, () => t)
}

async function flip($: EngineInterface, h: string, key: Key) {
  const cur = new Set(await readFolded($, h))
  if (cur.has(key)) cur.delete(key)
  else cur.add(key)
  try { await $.fs.write(`${h}/${FOLDED_REL}`, [...cur].join('\n')) } catch { /* next press */ }
  await update($, foldedAtom, () => [...cur])
  await pollPanel($, h)
}

/** overnight.json as a checkpoint, or null when it is missing or has no `since`. */
export function toCheckpoint(raw: unknown): Checkpoint | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const since = Number(r.since)
  if (!since) return null
  const running = (Array.isArray(r.running) ? r.running : [])
    .map(x => (typeof x === 'string' ? snapOf(x) : x))
    .filter((x): x is Snap => !!x && typeof x === 'object' && typeof (x as Snap).name === 'string' && !!(x as Snap).name)
  return { since, label: String(r.label ?? 'checkpoint'), running, ...(Number(r.woke) ? { woke: Number(r.woke) } : {}) }
}

/** Reads the checkpoint each tick. A tick that comes over 30 min after the last one, after the checkpoint, means the computer slept: it marks the file woke. */
export async function tickRecap($: EngineInterface, h: string) {
  if (!h) return
  const now = await $.clock.now()
  const file = `${h}/${OVERNIGHT_REL}`
  let raw: Record<string, unknown> | null = null
  try { raw = JSON.parse(String(await $.fs.read(file))) as Record<string, unknown> } catch { raw = null }
  let cp = toCheckpoint(raw)
  const prev = await read($, recapAtom)
  if (raw && cp && !cp.woke && prev.lastTick && now - prev.lastTick > GAP_MS && prev.lastTick >= cp.since * 1000) {
    cp = { ...cp, woke: Math.floor(now / 1000) }
    try { await $.fs.write(file, JSON.stringify({ ...raw, woke: cp.woke })) } catch { /* shown anyway this session */ }
  }
  await update($, recapAtom, r => ({ ...r, cp, lastTick: now, open: cp ? r.open : false }))
}

/** Dismiss: moves overnight.json to .state/overnight-YYYY-MM-DD.json (the checkpoint's day) and hides the banner. */
async function dismissRecap($: EngineInterface, h: string) {
  const cp = (await read($, recapAtom)).cp
  if (cp && h) {
    const file = `${h}/${OVERNIGHT_REL}`
    try { await $.process.run(['mv', '-f', file, file.replace(/overnight\.json$/, `overnight-${dayOf(cp.since)}.json`)], { timeoutMs: 5000 }) } catch { /* next press */ }
  }
  await update($, recapAtom, r => ({ ...r, cp: null, open: false }))
}

/** `/progress-bar checkpoint [label]` (or `away`): saves the RUNNING rows the status line shows now, folded or not. */
export async function checkpointCommand($: EngineInterface, h: string, label: string): Promise<string> {
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  if (!(await $.fs.exists(`${h}/${SCRIPT_REL}`).catch(() => false))) return 'The checkpoint reads the status line script. Run `/progress-bar setup` first.'
  let out = ''
  try { out = (await $.process.run(['/bin/sh', `${h}/${SCRIPT_REL}`], { stdin: '{}', env: { PB_FULL: '1', PB_UNFOLD: '1' }, timeoutMs: 8000 })).stdout } catch { out = '' }
  const rows = parseSections(stripAnsi(out).split('\n').filter(l => l.trim())).sections.find(x => x.key === 'running')?.rows ?? []
  const running = rows.map(snapOf).filter(x => x.name)
  const since = Math.floor((await $.clock.now()) / 1000)
  await $.fs.write(`${h}/${OVERNIGHT_REL}`, JSON.stringify({ since, label: label || 'checkpoint', running }))
  await update($, recapAtom, r => ({ ...r, cp: { since, label: label || 'checkpoint', running }, open: false }))
  return `Checkpoint saved: ${running.length} running. The Status panel shows what happened since once you are back (4 h on, or after the computer sleeps).`
}

const clock12 = (ts: number) => { const d = new Date(ts * 1000); const h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const span = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h` : `${Math.max(1, Math.floor(s / 60))}m`)
export type RecapLine = { kind: 'done' | 'error' | 'warning' | 'running' | 'waiting'; text: string; sub?: string }
export type RecapList = { done: RecapLine[]; errors: RecapLine[]; warnings: RecapLine[]; running: RecapLine[]; waiting: RecapLine[] }

/** Whether the banner shows: a checkpoint 4 h old, or one the panel saw the computer wake from. */
export const recapDue = (cp: Checkpoint | null, nowS: number) => !!cp && (!!cp.woke || nowS - cp.since >= AWAY_S)

/**
 * What happened since the checkpoint: done, error and warning events since `since` (errors and warnings newest first),
 * jobs running then that sit in DONE now, every running job with its % then and now, and waiting jobs.
 */
export function buildRecap(cp: Checkpoint, events: Ev[], lines: string[], meta: Record<string, Meta>): RecapList {
  const titleOf = (name: string) => (meta[slug(name)]?.title || name).split(' · ')[0]!
  const evs = events.filter(e => e.ts >= cp.since).sort((a, b) => a.ts - b.ts)
  const firstLine = (s?: string) => (s ?? '').split('\n').map(x => x.trim()).find(Boolean)
  const done: RecapLine[] = []
  const seen = new Set<string>()
  for (const e of evs.filter(x => x.level === 'success')) {
    const k = slug(e.source || e.title)
    if (seen.has(k)) continue
    seen.add(k)
    const t = e.source && meta[slug(e.source)]?.title ? titleOf(e.source) : e.title.replace(/\s+done$/i, '')
    done.push({ kind: 'done', text: t, sub: clock12(e.ts) })
  }
  const secs = parseSections(lines).sections
  const rowsOf = (k: string) => secs.find(x => x.key === k)?.rows ?? []
  // A job running at checkpoint time that sits in DONE now finished, even with no event for it.
  const before = new Set(cp.running.map(r => slug(r.name)))
  for (const row of rowsOf('done')) {
    const name = runCard(row.replace(/^[✔✓]\s*/, '')).name
    const k = slug(name)
    if (!before.has(k) || seen.has(k)) continue
    seen.add(k)
    const at = / · finished (\d\d:\d\d)$/.exec(row)?.[1]
    done.push({ kind: 'done', text: titleOf(name), ...(at ? { sub: at } : {}) })
  }
  const issue = (kind: 'error' | 'warning') => evs.filter(e => e.level === kind).reverse()
    .map(e => { const sub = firstLine(e.detail); return { kind, text: e.title, ...(sub ? { sub } : {}) } })
  const then = new Map(cp.running.map(r => [slug(r.name), r]))
  const pct = (n: number) => `${Math.round(n)}%`
  const running: RecapLine[] = rowsOf('running').map(row => {
    const c = runCard(row)
    const was = then.get(slug(c.name))?.pct
    const moved = c.pct === null ? 'still going' : was === undefined ? `new · ${pct(c.pct)}` : `${pct(was)} → ${pct(c.pct)}`
    const lm = /^(?:(\d+)h)?(\d+)m$/.exec(c.left)
    const left = lm ? (Number(lm[1] ?? 0) > 0 ? `${Number(lm[1])}h left` : `${Number(lm[2])}m left`) : c.left ? `${c.left} left` : ''
    return { kind: 'running' as const, text: titleOf(c.name), sub: left ? `${moved}  · ${left}` : moved }
  })
  const waiting = rowsOf('waiting').map(row => ({ kind: 'waiting' as const, text: titleOf(runCard(row).name) }))
  return { done, errors: issue('error'), warnings: issue('warning'), running, waiting }
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
    await $.process.run(['rm', '-f', `${h}/${PANEL_OFF_REL}`]).catch(() => undefined)
    await pollPanel($, h)
    await openPanel($)
    return 'Status panel on: it opens at session start, and the status line shows one summary line.'
  }
  if (arg === 'off') {
    await $.process.run(['rm', '-f', `${h}/${PANEL_FLAG_REL}`]).catch(() => undefined)
    await $.fs.write(`${h}/${PANEL_OFF_REL}`, 'off\n').catch(() => undefined)
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

/**
 * At session start: poll every second while the pane is open, and open it when the panel is on.
 * `defaultOn` (a new install): the panel is on unless `/progress-bar panel off` turned it off.
 */
export async function startPanel($: EngineInterface, h: string, defaultOn = false) {
  if (h && defaultOn && !(await isPanelOn($, h)) && !(await $.fs.exists(`${h}/${PANEL_OFF_REL}`).catch(() => false))) {
    await $.fs.write(`${h}/${PANEL_FLAG_REL}`, 'on\n').catch(() => undefined)
  }
  await resetConns($)
  // The recap ticks whether the pane is open or not, so a sleep shows as a gap between two ticks.
  await tickRecap($, h)
  $.clock.every(2000, () => tickRecap($, h))
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
    void openPanel($).then(r => (r && !r.isPlaced ? panelHint($, h) : undefined)).catch(() => undefined)
  }
}

/** Once per machine: the pane waits for a wider terminal, so say how to open it. */
async function panelHint($: EngineInterface, h: string) {
  if (!h || (await $.fs.exists(`${h}/${PANEL_HINT_REL}`).catch(() => false))) return
  await $.fs.write(`${h}/${PANEL_HINT_REL}`, 'shown\n').catch(() => undefined)
  await $.ui.toast('Progress panel: /progress-bar')
}

/** Draws the pane. */
type RenderEv = Parameters<EngineInterface['ui']['resolve']>[0]

/**
 * The red Action needed box: title, why, the command, then ▶ Run, Copy, ✓ I ran it, Later (popup only) and Skip.
 * Run shows a confirm line with the full command ("Run this in Ghostty?" Run, Cancel). A failing check shows in red.
 * Drawn first on the Status panel's List tab and as the whole Action needed pane.
 */
async function actionBox($: EngineInterface, e: RenderEv, homeDir: string, width: number, popup: boolean): Promise<RenderChildren[]> {
  const { Box, Button, Text } = $.ui.resolve(e)
  const acts = await read($, actionsAtom)
  if (!acts.length) return popup ? [<Text key="act-none" dimColor>{'No actions needed. Press Later to close.'}</Text>, <Button key="act-later" plain onPress={() => $.ui.close({ id: ACTION_PANE })}>{'Later'}</Button>] : []
  const ui = await read($, actionUiAtom)
  const w = Math.max(16, width - 6)
  const gap = (k: string) => <Text key={k} dimColor>{'   '}</Text>
  return [
    <Box key="act" flexDirection="column" borderStyle="bold" borderColor="red" paddingX={1} marginBottom={1}>
      <Text key="act-h" bold color="red">{`⛔ Action needed${acts.length > 1 ? `  ${acts.length}` : ''}`}</Text>
      {acts.slice(0, popup ? 1 : 3).flatMap(a => [
        <Text key={`act-t-${a.id}`} bold>{cutA(a.title, w)}</Text>,
        popup && a.why ? <Text key={`act-w-${a.id}`} dimColor>{cutA(`Why: ${a.why}`, w * 2)}</Text> : null,
        a.command ? <Text key={`act-c-${a.id}`} color="red">{cutA(`$ ${a.command}`, popup ? w * 4 : w)}</Text> : null,
        ui.confirm === a.id
          ? <Box key={`act-q-${a.id}`} flexDirection="column">
              <Text key="q" bold>{`Run this in ${ui.term || 'Terminal'}?`}</Text>
              {/* The full command again only when the line above was cut short. */}
              {cutA(`$ ${a.command ?? ''}`, popup ? w * 4 : w) !== `$ ${a.command ?? ''}` ? <Text key="qc" color="red">{`$ ${a.command ?? ''}`}</Text> : null}
              <Box key="qb">
                <Button key={`act-yes-${a.id}`} plain onPress={() => confirmRun($, homeDir, a)}>{'▶ Run'}</Button>
                {gap('g0')}
                <Button key={`act-no-${a.id}`} plain onPress={() => cancelRun($)}>{'Cancel'}</Button>
              </Box>
            </Box>
          : null,
        ui.failId === a.id && ui.fail ? <Text key={`act-f-${a.id}`} color="red">{cutA(ui.fail, w * 2)}</Text> : null,
        // While Run waits for its confirm, only the confirm's Run and Cancel show.
        ui.confirm === a.id ? null : <Box key={`act-b-${a.id}`}>
          {canRun(a) ? <Button key={`act-run-${a.id}`} plain onPress={() => runAction($, homeDir, a)}>{'▶ Run'}</Button> : null}
          {canRun(a) ? gap('g1') : null}
          {a.command ? <Button key={`act-copy-${a.id}`} plain onPress={() => copyCommand($, a)}>{'Copy'}</Button> : null}
          {a.command ? gap('g2') : null}
          <Button key={`act-ran-${a.id}`} plain onPress={() => ranIt($, homeDir, a)}>{'✓ I ran it'}</Button>
          {popup ? gap('g3') : null}
          {popup ? <Button key={`act-later-${a.id}`} plain onPress={() => $.ui.close({ id: ACTION_PANE })}>{'Later'}</Button> : null}
          {gap('g4')}
          <Button key={`act-skip-${a.id}`} plain onPress={() => closeAction($, homeDir, a.id, 'skipped', popup ? 'skipped in the Action needed pane' : 'skipped in the Status panel')}>{'Skip'}</Button>
        </Box>,
      ].filter(Boolean) as RenderChildren[])}
      {acts.length > (popup ? 1 : 3) ? <Text key="act-more" dimColor>{`+${acts.length - (popup ? 1 : 3)} more. /progress-bar action list`}</Text> : null}
    </Box>,
  ]
}

export function registerPanel(on: On) {
  // The Action needed pane: the popup inside Claude Code (actions.ts popup), never a system dialog.
  on('ui.render', { component: 'Pane', requestId: 'progress-bar-action' }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    const homeDir = await resolveHome($)
    await readActions($, homeDir)
    return <Box flexDirection="column">{await actionBox($, e, homeDir, Math.max(30, e.props.bodyColumns ?? 60), true)}</Box>
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // The panel never draws blank: a failure to draw shows why.
    try { return await drawPane($, e) } catch (err) {
      const { Text } = $.ui.resolve(e)
      return <Text color="yellow">{`Status panel could not draw: ${firstLine(String(err)) || 'unknown error'}`}</Text>
    }
  })
}

/** The Status panel's List, Connectors, GitHub, Log, Chat and Topology tabs. */
async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  {
    const { Box, Button, Text } = $.ui.resolve(e)
    const homeDir = await resolveHome($)
    const maxFile = `${homeDir}/${DIR_REL}/.state/max-usage.json`
    let maxSaved: UsageReading | null = null
    try { maxSaved = parseSaved(String(await $.fs.read(maxFile))) } catch { maxSaved = null }
    const lines = await read($, linesAtom)
    const folded = new Set(await read($, foldedAtom))
    const todos = await read($, todosAtom)
    const project = await read($, projectAtom)
    const menuFor = await read($, menuAtom)
    const conns = await read($, connsAtom)
    const tab = await read($, tabAtom)
    const openTodos = todos.filter(t => !t.done).length
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    const barW = Math.min(20, Math.max(10, width - 30))
    const { sections: parsed, other, machines: machineLines } = parseSections(lines)
    // TO-DO shows only while something is open. Checked-off to-dos go under DONE, so DONE shows if they exist.
    const doneTodos = todos.filter(t => t.done)
    const sections = parsed.filter(s => s.key !== 'todo' || openTodos > 0)
    if (openTodos > 0 && !sections.some(s => s.key === 'todo')) sections.unshift({ key: 'todo', title: 'TO-DO', folded: false, count: 0, rows: [] })
    const recs = await read($, doneAtom)
    const nowDone = await $.clock.now()
    const liveKeys = new Set(sections.filter(s => s.key === 'running' || s.key === 'waiting').flatMap(s => s.rows).map(r => slug(runCard(r).name)))
    const doneList = doneItems(sections.find(s => s.key === 'done')?.rows ?? [], recs, liveKeys, nowDone)
    if ((doneTodos.length || doneList.length) && !sections.some(s => s.key === 'done')) sections.push({ key: 'done', title: 'DONE', folded: false, count: 0, rows: [] })
    const localMachine = await machineName($)

    // Running names and titles: what an "(after X)" to-do waits for.
    const runNames = (sections.find(x => x.key === 'running')?.rows ?? []).map(x => runCard(x).name)
    const metaNow = await read($, metaAtom)
    const running = runNames.flatMap(n => [n, metaNow[slug(n)]?.title ?? ''].filter(Boolean))

    // A checked-off to-do (under DONE) as a button. Pressing it opens its menu below it.
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

    // Open to-dos, one line each, never wrapped: per machine "Mac  2", then by priority a marker (green ▶ next, dim ⏸
    // blocked), its place as "1." in a 3-wide column (bold cyan) and the title without its "(after X)". Blocked items that wait on the same
    // job get one dim "waits for <job>" line under the last of them. Pressing an item opens its menu below it.
    const jobLabel = (b: string) => (runNames.includes(b) ? metaNow[slug(b)]?.title ?? b : b)
    const todoRows = () => layoutTodos(rankTodos(todos.filter(t => !t.done), running), width, jobLabel).flatMap(row => {
      if (row.kind === 'gap') return [<Text key={`g-${row.owner}`}>{' '}</Text>]
      if (row.kind === 'head') {
        return [<Box key={`w-${row.owner}`}><Text bold color="magenta">{`  ${row.owner.charAt(0).toUpperCase()}${row.owner.slice(1).toLowerCase()}`}</Text><Text dimColor>{`  ${row.count}`}</Text></Box>]
      }
      if (row.kind === 'waits') return [<Text key={`wf-${row.at}`} dimColor>{`          ${row.text}`}</Text>]
      const t = row.item
      return [
        <Box key={`tr-${t.line}`}>
          <Text color={row.marker === '▶' ? 'green' : undefined} dimColor={row.marker === '⏸'}>{`    ${row.marker} `}</Text>
          <Button key={`t-${t.line}`} plain onPress={() => update($, menuAtom, v => (v === t.line ? -1 : t.line))}>
            {row.dim
              ? <Text dimColor>{`${row.num}  ${row.title}`}</Text>
              : [<Text key="n" bold color="cyan">{row.num}</Text>, `  ${row.title}`]}
          </Button>
        </Box>,
        menuFor === t.line
          ? <Box key={`m-${t.line}`}>
              <Text dimColor>{'          '}</Text>
              <Button key={`a-done-${t.line}`} plain onPress={() => todoAction($, homeDir, t.line, 'done', t.text)}>{'✓ Done  '}</Button>
              <Button key={`a-up-${t.line}`} plain onPress={() => todoMove($, homeDir, t.text, 'up')}>{'↑ Up  '}</Button>
              <Button key={`a-dn-${t.line}`} plain onPress={() => todoMove($, homeDir, t.text, 'down')}>{'↓ Down  '}</Button>
              {!t.blockedBy && t.owner.toLowerCase() !== 'you'
                ? <Button key={`a-go-${t.line}`} plain onPress={async () => { await update($, menuAtom, () => -1); void $.prompt.submit({ text: nextPrompt(t.body) }) }}>{'▶ Start  '}</Button>
                : null}
              <Button key={`a-del-${t.line}`} plain onPress={() => todoAction($, homeDir, t.line, 'delete', t.text)}>{'✕ Delete  '}</Button>
              <Button key={`a-x-${t.line}`} plain onPress={() => update($, menuAtom, () => -1)}>{'Cancel'}</Button>
            </Box>
          : null,
      ].filter(Boolean)
    })

    // Finished jobs, then the checked-off to-dos.
    const doneRows = () => [
      ...doneList.flatMap(finishedRow),
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
    const mach = machines(sections.filter(x => x.key === 'running' || x.key === 'waiting').flatMap(x => x.rows).map(x => runCard(x).name), todos.map(t => t.owner))
    const MINI = 10
    // A detail line under an open card: wrapped with a hanging indent, so long text never runs back to column 0.
    const hang = (key: string, pad: string, text: string, dim = true) => (
      <Box key={key} paddingLeft={pad.length}><Text dimColor={dim}>{text}</Text></Box>
    )
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
      const col = labelCol(width, ind.length)
      const full = machineTitle(r.name, m0.title || r.name, mach)
      const label = fitLabel(full, col)
      // Room left on the line after mark, label and bar (4 + 2 + col + 17) and the note's two spaces.
      const room = width - ind.length - col - 25
      const fit = (x: string) => (x.length > room ? (room > 1 ? `${x.slice(0, room - 1)}…` : '') : x)
      const finished = r.mark === '✔'
      const tail = fit(finished ? 'just finished' : stuck ? `⚠ stuck ${stuck}` : waitOn ? `waiting on ${short(waitOn)}` : timeTail(r))
      // The id line names the job only when the title does not already say it: the full title when the label was cut,
      // else the raw name when it differs. The badge always shows.
      const idName = full.length > col ? full : sameName(r.name, full) ? '' : r.name
      return [
        <Box key={`r${k}`}>
          <Box flexShrink={0}>
          <Text color={stuck ? 'yellow' : finished ? 'green' : 'cyan'}>{`${ind}  ${mark} `}</Text>
          <Button key={`open-${key}`} plain onPress={() => toggleCard(key)}>
            {`${isOpen ? '▾' : '▸'} ${label}`}
          </Button>
          {frac === null
            ? [
                <Text key="a" dimColor>{`  ${'─'.repeat(before)}`}</Text>,
                <Text key="b" color={stuck ? 'yellow' : 'cyan'}>{'━━━'}</Text>,
                <Text key="c" dimColor>{'─'.repeat(after)}</Text>,
                <Text key="d">{'     '}</Text>,
              ]
            : [
                <Text key="a" color={stuck ? 'yellow' : 'green'}>{`  ${'━'.repeat(filled)}`}</Text>,
                <Text key="b" dimColor>{'─'.repeat(MINI - filled)}</Text>,
                <Text key="c" bold>{` ${String(Math.round(r.pct!)).padStart(3)}%`}</Text>,
              ]}
          </Box>
          {tail ? <Text color={stuck ? 'yellow' : undefined} dimColor={!stuck} wrap="truncate-end">{`  ${tail}`}</Text> : null}
        </Box>,
        ...(isOpen ? details(r, k, pad, waitOn, why, idName) : []),
      ].filter(Boolean)
    }
    const toggleCard = (key: string) => update($, openAtom, l => (l.includes(key) ? l.filter(x => x !== key) : [...l, key]))
    // An open card's details: id and badge, count, step, facts, watcher and what it unlocks, each wrapped under its indent.
    const details = (r: RunCard, k: string, pad: string, waitOn: string, why: string, idName: string) => [
      hang(`id${k}`, pad, idName ? `${idName}   ${badge(r.kind)}` : badge(r.kind)),
      r.count || r.pct === null ? hang(`c${k}`, pad, r.count || 'steps not reported') : null,
      waitOn ? hang(`t${k}`, pad, `waiting on: ${waitOn}`, false) : r.step ? hang(`t${k}`, pad, r.step, false) : null,
      r.facts ? hang(`f${k}`, pad, r.facts) : null,
      r.watchedBy ? hang(`wb${k}`, pad, `watched by ${r.watchedBy}`) : null,
      why ? hang(`w${k}`, pad, why) : null,
    ].filter(Boolean)
    const runRows = (rows: string[]) => {
      const cards = rows.map(runCard)
      const out = nestRows(cards.map(c => c.name), meta).flatMap(({ i, kids }) => {
        const c = cards[i]!
        const k0 = kids.length ? cards[kids[0]!]! : undefined
        const kid = k0 && c.stuck ? short(metaOf(k0.name).title || k0.name) : ''
        const open = openCards.has(slug(c.name))
        return [...card(c, `${i}`, '', false, kid), ...(open ? kids.flatMap(j => card(cards[j]!, `${i}c${j}`, '    ', true, '')) : [])]
      })
      return out
    }

    // Waiting rows draw no bar: "⏸ <title> · waiting on <what>", one line. Pressing the title opens the same details.
    const waitRows = (rows: string[]) => rows.flatMap((row, i) => {
      const c = runCard(row)
      const key = slug(c.name)
      const isOpen = openCards.has(key)
      const phrase = waitPhrase(c, row)
      const title = machineTitle(c.name, metaOf(c.name).title || c.name, mach)
      const m0 = metaOf(c.name)
      const why = m0.why ? `unlocks: ${m0.why.replace(/^unlocks:?\s*/i, '')}` : ''
      // Open: the whole reason with how long it has waited, then the card's details (its step only when not said yet).
      const full = `${phrase || 'waiting, no reason reported'}${c.waited ? ` · for ${c.waited}` : ''}`
      const said = phrase.replace(/^(waiting on |last step: |paused by a rate limit: )/, '')
      const inStep = !c.waited && !!said && c.step.includes(said)
      return [
        <Box key={`rw${i}`}>
          <Text color="yellow" dimColor>{'  ⏸ '}</Text>
          <Button key={`open-${key}`} plain onPress={() => toggleCard(key)}>{title}</Button>
          <Text dimColor wrap="truncate-end">{` · ${c.waited ? `${c.waited} · ` : ''}${phrase || 'waiting'}`}</Text>
        </Box>,
        ...(isOpen ? [inStep ? null : hang(`wr${i}`, '    ', full, false), ...details(c, `w${i}`, '    ', '', why, sameName(c.name, title) ? '' : c.name)].filter(Boolean) : []),
      ]
    })

    // A finished job: "✓ ▸ <title>  14:05", a button. Open, it shows what the job changed (its impact, else "no impact
    // reported"), "finished 14:05 · ran 1h20m" with its machine badge, and what it unlocks, each wrapped under its
    // indent. An agent that finished before records were kept gets one from its transcript when first opened.
    const finishedRow = (d: DoneItem, i: number) => {
      if (d.text !== undefined) return [<Text key={`dn${i}`} dimColor>{`  ${d.text}`}</Text>]
      const rec = recs[d.key]
      const title = doneTitle(d.name, rec, metaOf(d.name).title)
      if (d.finishing) return [<Text key={`dn${i}`} dimColor wrap="truncate-end">{`  ✓ ${title}  ${d.finishing}`}</Text>]
      const k = `done:${d.key}`
      const isOpen = openCards.has(k)
      const host = /^([A-Za-z0-9_.-]+):\s/.exec(d.name)?.[1]
      const mach = rec?.machine || (host ? host.charAt(0).toUpperCase() + host.slice(1) : localMachine)
      const press = async () => {
        if (!isOpen && !rec) {
          await backfillAgent($, homeDir, d.name, metaOf(d.name).title).catch(() => null)
          const all = await readDone($, homeDir)
          await update($, doneAtom, () => all)
        }
        await toggleCard(k)
      }
      return [
        <Box key={`dn${i}`}>
          <Text dimColor>{'  ✓ '}</Text>
          <Button key={`dno-${d.key}`} plain onPress={press}><Text dimColor>{`${isOpen ? '▾' : '▸'} ${title}`}</Text></Button>
          <Text dimColor>{d.at ? `  ${d.at}` : ''}</Text>
        </Box>,
        ...(isOpen ? doneDetails(rec, d.at, mach).map((t, j) => hang(`dd${i}-${j}`, '      ', t, !rec?.impact.length || j >= rec.impact.length)) : []),
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
    const chat = await read($, chatAtom)
    const chatUnread = chat.msgs.filter(m => m.unread).length
    const sep = (k: string) => <Text key={k} dimColor>{' │ '}</Text>
    // The usage meter sits in the top right corner on every tab: a running job's live reading, else the saved one.
    const liveUsed = (sections.find(x => x.key === 'running')?.rows ?? []).map(runCard)
      .reduce<number | null>((a, c) => (c.maxUsed === null ? a : Math.max(a ?? 0, c.maxUsed)), null)
    const reading = maxReading(liveUsed, maxSaved, nowMs)
    if (reading.save && liveUsed !== null) void $.fs.write(maxFile, JSON.stringify({ pct: liveUsed, at: nowMs, ...(maxSaved?.plan ? { plan: maxSaved.plan } : {}) })).catch(() => undefined)
    // The tab labels, then the usage meter: on the tab row's right end when it fits, else right-aligned on its own line.
    // In a pane too narrow for every label, Topology reads Topo, then Connectors reads Conn.
    const labelsAt = (n: number) => [
      `${mark('list')}List`,
      `${mark('connectors')}${n < 2 ? 'Connectors' : 'Conn'}${badN ? ` !${badN}` : ''}`,
      `${mark('github')}GitHub`,
      `${mark('log')}Log${unseen ? ` !${unseen}` : ''}`,
      `${mark('chat')}Chat${chatUnread ? ` ${chatUnread}` : ''}`,
      `${mark('topology')}${n < 1 ? 'Topology' : 'Topo'}`,
    ]
    const tabLabels = [0, 1, 2].map(labelsAt).find(l => tabsWidth(l) <= width) ?? labelsAt(2)
    const meter = (() => {
      const used = reading.used
      if (used === null) return null
      const m = maxMeter(used, METER_CELLS)
      const text = meterText(maxSaved?.plan, used, reading.asOf)
      return {
        width: text.length,
        parts: [
          <Text key="mt-n" dimColor>{`${meterLabel(maxSaved?.plan)} `}</Text>,
          <Text key="mt-p">{`${used}% `}</Text>,
          <Text key="mt-f" color={m.color}>{'━'.repeat(m.filled)}</Text>,
          <Text key="mt-e" dimColor>{`${'─'.repeat(METER_CELLS - m.filled)} 7d${reading.asOf ? ` · ${reading.asOf}` : ''}`}</Text>,
        ],
      }
    })()
    const tabsW = tabsWidth(tabLabels)
    const inline = !!meter && meterOnTabRow(tabsW, meter.width, width)
    const tabBar = (
      <Box key="tabs" flexDirection="column" marginBottom={1}>
      {meter && !inline ? <Box key="maxmeter"><Text>{' '.repeat(Math.max(0, width - meter.width))}</Text>{meter.parts}</Box> : null}
      <Box key="tabrow">
        <Button key="tab-list" plain onPress={() => update($, tabAtom, () => 'list')}>{tabLabels[0]!}</Button>
        {sep('sep-1')}
        <Button key="tab-connectors" plain onPress={() => update($, tabAtom, () => 'connectors')}>{tabLabels[1]!}</Button>
        {sep('sep-2')}
        <Button key="tab-github" plain onPress={async () => { await update($, tabAtom, () => 'github'); await readGh($, homeDir) }}>{tabLabels[2]!}</Button>
        {sep('sep-3')}
        <Button key="tab-log" plain onPress={async () => { await update($, tabAtom, () => 'log'); await markSeen($, homeDir) }}>{tabLabels[3]!}</Button>
        {sep('sep-4')}
        <Button key="tab-chat" plain onPress={async () => { await update($, tabAtom, () => 'chat'); await readChat($, homeDir) }}>{tabLabels[4]!}</Button>
        {sep('sep-5')}
        <Button key="tab-topology" plain onPress={async () => { await update($, tabAtom, () => 'topology'); await readTopo($, homeDir) }}>{tabLabels[5]!}</Button>
        {meter && inline ? <Text key="mt-gap">{' '.repeat(Math.max(2, width - tabsW - meter.width))}</Text> : null}
        {meter && inline ? meter.parts : null}
      </Box>
      </Box>
    )

    if (tab === 'chat') {
      // Channel picker (name, last message time, unread count), the thread oldest first (received left with the
      // peer's name, sent right as "You"), then the compose field. All text was sanitized in chat.ts.
      const { Input } = $.ui.resolve(e) as { Input?: ElementConstructor<InputProps> }
      const sel = chat.sel
      const thread = chat.msgs.filter(m => m.channel === sel).slice(-40)
      const bubbleW = Math.max(16, Math.floor(width * 0.8))
      const cutC = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
      const pick = chat.channels.map(name => {
        const ms = chat.msgs.filter(m => m.channel === name)
        const last = ms[ms.length - 1]
        const un = ms.filter(m => m.unread).length
        return (
          <Box key={`chp-${name}`}>
            <Button key={`chs-${name}`} plain onPress={() => selectChannel($, homeDir, name)}>{`${name === sel ? '▌' : ' '}${name}`}</Button>
            <Text dimColor>{`  ${last ? when(last.sent, nowMs) : 'no messages'}`}</Text>
            {un ? <Text color="cyan" bold>{`  ${un} new`}</Text> : null}
          </Box>
        )
      })
      const msgRow = (m: ChatMsg) => {
        const out = m.dir === 'out'
        const who = out ? 'You' : m.from || sel
        const isText = /\.(md|markdown|txt)$/i.test(m.filename)
        const open = chat.open === m.id
        const head = `${who} · ${when(m.sent, nowMs)}${m.unread ? '  ●' : ''}`
        const press = () => (isText ? toggleOpen($, homeDir, m) : openLocal($, homeDir, m.path))
        const body: RenderChildren[] = []
        if (open) {
          const pages = pageCount(chat.full.length)
          const pg = Math.min(chat.page, pages - 1)
          body.push(
            <Box key={`chf-${m.id}`} flexDirection="column" borderStyle="round" borderColor={out ? 'green' : 'cyan'} paddingX={1} width={Math.max(20, width - 2)}>
              <Text>{chat.full.slice(pg * PAGE_LINES, (pg + 1) * PAGE_LINES).join('\n') || ' '}</Text>
            </Box>,
            <Box key={`chn-${m.id}`}>
              {pages > 1 && pg > 0 ? <Button key={`chpv-${m.id}`} plain onPress={() => update($, chatAtom, c => ({ ...c, page: Math.max(0, c.page - 1) }))}>{'‹ back  '}</Button> : null}
              {pages > 1 ? <Text dimColor>{`page ${pg + 1} of ${pages}  `}</Text> : null}
              {pages > 1 && pg < pages - 1 ? <Button key={`chnx-${m.id}`} plain onPress={() => update($, chatAtom, c => ({ ...c, page: c.page + 1 }))}>{'more ›  '}</Button> : null}
              <Button key={`cho-${m.id}`} plain onPress={() => openLocal($, homeDir, m.path)}>{'↗ open  '}</Button>
              <Button key={`chc-${m.id}`} plain onPress={() => toggleOpen($, homeDir, m)}>{'▴ fold'}</Button>
            </Box>,
          )
        } else if (m.chat) {
          const lines = (m.text || ' ').split('\n')
          const w = Math.min(bubbleW, Math.max(...lines.map(l => l.length)) + 4)
          body.push(
            <Box key={`chb-${m.id}`} borderStyle="round" borderColor={out ? 'green' : 'cyan'} paddingX={1} width={w}>
              <Button key={`chm-${m.id}`} plain onPress={press}>{m.text || ' '}</Button>
            </Box>,
          )
        } else {
          body.push(
            <Button key={`chm-${m.id}`} plain onPress={press}>{cutC(`📎 ${m.filename} (${kb(m.size)})`, bubbleW)}</Button>,
            m.text ? <Box key={`chpr-${m.id}`} width={bubbleW}><Text dimColor>{m.text}</Text></Box> : null,
          )
        }
        return (
          <Box key={`chr-${m.id}`} flexDirection="column" alignItems={out && !open ? 'flex-end' : 'flex-start'} marginBottom={1}>
            <Text dimColor bold={!out} color={out ? undefined : 'cyan'}>{head}</Text>
            {body.filter(Boolean)}
          </Box>
        )
      }
      const field = Input
        ? <Input key={`chat-in-${sel}-${chat.n}`} placeholder={sel ? `Message ${sel}` : 'No channel yet'} submitLabel="send" value={chat.draft}
            onInput={(v: string) => update($, chatAtom, c => ({ ...c, draft: v }))}
            onSubmit={(v: string) => sendChat($, homeDir, v)} />
        : null
      return (
        <Box flexDirection="column">
          {tabBar}
          {chat.channels.length === 0
            ? <Text dimColor>{'No channels yet. /progress-bar channel invite <github-user> [name]'}</Text>
            : [
                <Text key="ch-title" bold color="cyan">{'CHANNELS'}</Text>,
                ...pick,
                <Text key="ch-rule" dimColor>{'─'.repeat(Math.max(10, width - 2))}</Text>,
                thread.length === 0 ? <Text key="ch-empty" dimColor>{'  No messages yet. Say hi below.'}</Text> : null,
                ...thread.map(msgRow),
                sel && field ? <Box key="ch-in" borderStyle="round" borderColor="gray" paddingX={1}>{field}</Box> : null,
                <Box key="ch-act">
                  {sel && field
                    ? <Button key="ch-send" plain onPress={() => sendChat($, homeDir, chat.draft)}>{chat.sending ? '… sending  ' : '➤ Send  '}</Button>
                    : sel ? <Button key="ch-reply" plain onPress={() => $.prompt.suggest({ text: `/progress-bar say ${sel} ` })}>{'✎ Reply  '}</Button> : null}
                  {sel ? <Text dimColor>{`↑ Send file: /progress-bar send <file> to ${sel}`}</Text> : null}
                </Box>,
                chat.note ? <Text key="ch-note" color={chat.sending ? undefined : 'yellow'} dimColor={chat.sending}>{`  ${chat.note}`}</Text> : null,
                <Text key="ch-safe" dimColor>{'  End-to-end encrypted and signed. Received text is shown, never run.'}</Text>,
              ].filter(Boolean)}
        </Box>
      )
    }

    if (tab === 'topology') {
      // The same running and waiting rows the List tab draws, with each job's title, reads and writes.
      const topo = await read($, topoAtom)
      const live = sections.filter(x => x.key === 'running' || x.key === 'waiting').flatMap(x => x.rows.map(row => ({ row, wait: x.key === 'waiting' })))
      const jobs: TopoJob[] = live.map(({ row, wait }) => {
        const c = runCard(row)
        const m0 = metaOf(c.name)
        return { name: c.name, title: m0.title || c.name, pct: c.pct, mark: wait ? '⏸' : c.mark === '✔' ? '✔' : c.stuck ? '⚠' : '▶', step: c.step, reads: m0.reads, writes: m0.writes, proc: /\d% CPU\b/.test(row) }
      })
      const self = topo.cfg.self || resolveMachine(topo.cfg, mach.local) || resolveMachine(topo.cfg, localMachine) || topo.cfg.machines.find(m => m.role === 'data')?.id || 'local'
      const queues = queuesOf(topo.cfg, rankTodos(todos.filter(t => !t.done), running).map(t => ({ owner: t.owner, text: t.text })), self)
      const drawn = renderTopology({ cfg: topo.cfg, self, jobs, health: topo.health, queues, extra: mach.remote }, width)
      return (
        <Box flexDirection="column">
          {tabBar}
          {drawn.map((l, i) => (
            <Box key={`tp${i}`}>
              {l.map((sg, k) => <Text key={`tp${i}-${k}`} color={sg.color} dimColor={sg.dim} bold={sg.bold} wrap="truncate-end">{sg.text || ' '}</Text>)}
            </Box>
          ))}
        </Box>
      )
    }

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
          {shown.flatMap((ev, n) => {
            const id = `${evId(ev)}-${n}`
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
          {c.url
            ? <Button key={`c-open-${c.name}`} plain onPress={() => openWeb($, c.url!)}>{`${c.name}  ↗`}</Button>
            : <Text bold>{c.name}</Text>}
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

    // "While you were away": a checkpoint 4 h old, or one the computer slept through.
    const recap = await read($, recapAtom)
    const cp = recap.cp
    // Why the panel or status line may show nothing, and the fallback when the settings.read hook was skipped.
    const health = await read($, healthAtom)
    const healthBlock: RenderChildren[] = [
      health.script ? <Text key="h-script" color="yellow">{health.script}</Text> : null,
      health.statusOff
        ? <Box key="h-off" flexDirection="column" marginBottom={1}>
            <Text dimColor>{health.statusOff}</Text>
            <Button key="h-turn-on" plain onPress={() => turnOn($, homeDir)}>{'▶ Turn on status line'}</Button>
          </Box>
        : null,
      noteShows(health, nowMs) ? <Text key="h-note" dimColor>{health.note}</Text> : null,
    ].filter(Boolean)
    let banner: RenderChildren[] = []
    if (cp && recapDue(cp, nowS)) {
      const r = buildRecap(cp, log.events, lines, meta)
      const LOOK: Record<string, [string, string]> = { error: ['✖', 'red'], warning: ['⚠', 'yellow'], running: ['▶', 'green'], waiting: ['⏸', 'yellow'], done: ['✓', 'green'] }
      const all = [...r.errors, ...r.warnings, ...r.running, ...r.waiting, ...r.done]
      const shown = recap.open ? all : all.slice(0, 3)
      const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
      const issue = (l: RecapLine) => l.kind === 'error' || l.kind === 'warning'
      banner = [
        <Box key="recap" flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
          <Text key="rc-h" bold color="yellow">{`☀ While you were away · since ${clock12(cp.since)} (${span(nowS - cp.since)})`}</Text>
          <Box key="rc-n">
            <Text color="green">{`✓ ${r.done.length} done  `}</Text>
            <Text color={r.errors.length ? 'red' : undefined} dimColor={!r.errors.length}>{`✖ ${plural(r.errors.length, 'error')}  `}</Text>
            <Text color={r.warnings.length ? 'yellow' : undefined} dimColor={!r.warnings.length}>{`⚠ ${plural(r.warnings.length, 'warning')}  `}</Text>
            <Text color="green">{`▶ ${r.running.length} still running`}</Text>
            {r.waiting.length ? <Text color="yellow">{`  ⏸ ${r.waiting.length} waiting`}</Text> : null}
          </Box>
          {all.length === 0 ? <Text key="rc-none" dimColor>{'  Nothing happened.'}</Text> : null}
          {shown.flatMap((l, k) => {
            const [icon, color] = LOOK[l.kind]!
            return [
              <Box key={`rc-${k}`}>
                <Text color={color}>{`${icon} `}</Text>
                <Text>{cut(l.text, Math.max(16, width - 22))}</Text>
                {l.sub && !issue(l) ? <Text dimColor>{`  ${l.sub}`}</Text> : null}
              </Box>,
              l.sub && issue(l) ? <Text key={`rc-${k}-d`} dimColor>{`  ${cut(l.sub, Math.max(16, width - 8))}`}</Text> : null,
            ].filter(Boolean)
          })}
          <Box key="rc-b" marginTop={1}>
            {all.length > 3 ? <Button key="recap-more" plain onPress={() => update($, recapAtom, x => ({ ...x, open: !x.open }))}>{recap.open ? '▾ Show less' : `▸ Show all ${all.length}`}</Button> : null}
            {all.length > 3 ? <Text dimColor>{'   '}</Text> : null}
            <Button key="recap-dismiss" plain onPress={() => dismissRecap($, homeDir)}>{'✕ Dismiss'}</Button>
          </Box>
        </Box>,
      ]
    }

    // Inbox: what needs you, first. A press opens the item (https only), "✓ handled" hides it.
    const inbox = await read($, inboxAtom)
    const cutI = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
    const inboxBlock: RenderChildren[] = inbox.items.length === 0 ? [] : [
      <Box key="inbox" flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
        <Text key="ib-h" bold color="yellow">{`✉ Inbox  ${inbox.items.length} need you`}</Text>
        {inbox.items.flatMap(it => [
          it.url
            ? <Button key={`ib-o-${it.id}`} plain onPress={() => openWeb($, it.url)}>{cutI(`${it.from} · ${it.subject}`, Math.max(16, width - 8))}</Button>
            : <Text key={`ib-o-${it.id}`}>{cutI(`${it.from} · ${it.subject}`, Math.max(16, width - 8))}</Text>,
          <Box key={`ib-w-${it.id}`}>
            <Text dimColor>{cutI(`  ${it.why}${it.due ? ` · due ${it.due}` : ''}  `, Math.max(16, width - 20))}</Text>
            <Button key={`ib-x-${it.id}`} plain onPress={() => markHandled($, homeDir, it.id)}>{'✓ handled'}</Button>
          </Box>,
        ])}
      </Box>,
    ]

    // Channel: files a collaborator sent (channel.ts). A press opens the local copy with the default app, "✓ read" hides it.
    const chan = await read($, channelAtom)
    const chanBlock: RenderChildren[] = chan.items.length === 0 ? [] : [
      <Box key="chan" flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text key="ch-h" bold color="cyan">{`✉ Channel  ${chan.items.length} new`}</Text>
        {chan.items.flatMap(it => [
          <Box key={`ch-r-${it.id}`}>
            <Button key={`ch-o-${it.id}`} plain onPress={() => openLocal($, homeDir, it.path)}>{cutI(`${it.channel} · ${it.filename}`, Math.max(16, width - 18))}</Button>
            <Text dimColor>{'  '}</Text>
            <Button key={`ch-x-${it.id}`} plain onPress={() => markRead($, homeDir, it.id)}>{'✓ read'}</Button>
          </Box>,
        ])}
      </Box>,
    ]

    // Action needed: steps only the person can run, first of all (actions.ts). Run asks first with the full command,
    // then opens a new visible terminal window. Slash commands have no Run (they are typed in Claude Code).
    const actBlock = await actionBox($, e, homeDir, width, false)

    return (
      <Box flexDirection="column">
        {tabBar}
        {machineLines.length ? <Box key="machines" flexDirection="column" marginBottom={1}>{machineLines.map((l, i) => <Text key={`mc${i}`} dimColor wrap="truncate-end">{l}</Text>)}</Box> : null}
        {actBlock}
        {inboxBlock}
        {chanBlock}
        {banner}
        {healthBlock}
        {openTodos === 0 && <Text key="no-todos" dimColor>{`No to-dos for ${project || 'this project'}. Add one with /progress-bar todo add`}</Text>}
        {sections.length === 0 && <Text dimColor>Nothing running.</Text>}
        {sections.map((sec, n) => {
          const isFolded = folded.has(sec.key) || sec.folded
          return (
            <Box key={`s-${sec.key}`} flexDirection="column" marginBottom={n < sections.length - 1 || other.length ? 1 : 0}>
              <Button key={`h-${sec.key}`} hotkey={String(n + 1)} plain onPress={() => flip($, homeDir, sec.key)}>
                {`${isFolded ? '▸' : '▾'} ${ICON[sec.key]} ${sec.title}  ${sec.key === 'todo' ? openTodos : sec.key === 'done' ? (isFolded ? sec.count : doneList.length) + doneTodos.length : sec.key === 'running' && sec.rows.length ? runCount(sec.rows.map(r => runCard(r).name), meta) : sec.count}`}
              </Button>
              {!isFolded && (sec.key === 'todo' ? todoRows() : sec.key === 'running' ? runRows(sec.rows) : sec.key === 'waiting' ? waitRows(sec.rows) : sec.key === 'done' ? doneRows() : plainRows(sec.rows, sec.key))}
            </Box>
          )
        })}
        {other.map((l, i) => <Text key={`o${i}`} dimColor>{l}</Text>)}
      </Box>
    )
  }
}
