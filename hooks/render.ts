// Pure helpers: no `$`, so tests import them directly.

import type { Gains, Meta, StepItem, StepState } from '../types'
import type { Life } from './alive'

export type Progress = { done: number | null; total: number | null; step: string; startedAt?: number }

export type Row = {
  id: string
  description: string
  status: string
  startedAt: number
  tools: number
  lastTool: string
  done: number | null
  total: number | null
  step: string
  /** Watched jobs only: drawn as ✔ done, ■ stopped (process gone early) or ✖ error (error pattern seen). */
  state?: 'running' | 'done' | 'stopped' | 'error'
  /** Watched jobs only: time left at the rate so far, e.g. `4m`. */
  eta?: string
  /** Waiting or pending agents only: why it waits and for how long (waiting.ts waitSegs). */
  wait?: string[]
  /** Signs of life beyond its numbers (alive.ts), written to .state/alive-<session>.json for the stuck mark. */
  life?: Life
}

/**
 * A watch file, `~/.claude-progress/<slug>.watch.json`: a bar read from a job's own log, for jobs that can't write
 * progress files (a psql script, a vendor tool, a remote job whose log is synced here). Two ways to count:
 * - `match`: a regex with two groups, done and total; the last match in the log wins (`(\d+)/(\d+) batches`).
 * - `count` + `total`: done is the number of lines matching `count` (one per finished step).
 * Optional: `step` (regex; group 1 or the whole last match is the step text), `error` (regex; a match marks the job
 * failed), `process` (a `pgrep -f` pattern; the job counts as stopped once nothing matches before it is done),
 * `label` (the name shown; the slug otherwise), `startedAt` (ms; for elapsed time and ETA).
 */
export type Watch = {
  log: string
  label?: string
  match?: string
  count?: string
  total?: number
  step?: string
  error?: string
  process?: string
  startedAt?: number
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/** Parses a watch file's text; null when it is not usable (no log, no way to count, or a bad regex). */
export function parseWatch(text: string): Watch | null {
  try {
    const w = JSON.parse(text) as Record<string, unknown>
    if (!w || typeof w !== 'object' || !str(w.log)) return null
    const total = typeof w.total === 'number' && w.total > 0 ? w.total : undefined
    if (!str(w.match) && !(str(w.count) && total)) return null
    for (const k of ['match', 'count', 'step', 'error'] as const) if (str(w[k])) new RegExp(w[k] as string)
    return {
      log: w.log as string, label: str(w.label), match: str(w.match), count: str(w.count), total,
      step: str(w.step), error: str(w.error), process: str(w.process),
      startedAt: typeof w.startedAt === 'number' ? w.startedAt : undefined,
    }
  } catch {
    return null
  }
}

const lastMatch = (re: string, text: string) => {
  let last: RegExpExecArray | null = null
  for (const m of text.matchAll(new RegExp(re, 'gm'))) last = m
  return last
}

/** Reads progress out of a log's text by the watch's patterns. */
export function readLog(w: Watch, text: string): { done: number | null; total: number | null; step: string; error: boolean } {
  let done: number | null = null
  let total: number | null = null
  if (w.match) {
    const m = lastMatch(w.match, text)
    if (m && m[1] !== undefined && m[2] !== undefined) {
      const d = Number(m[1]), t = Number(m[2])
      if (Number.isFinite(d) && Number.isFinite(t) && t > 0) { done = d; total = t }
    }
  } else if (w.count && w.total) {
    done = Math.min([...text.matchAll(new RegExp(w.count, 'gm'))].length, w.total)
    total = w.total
  }
  const s = w.step ? lastMatch(w.step, text) : null
  const step = s ? (s[1] ?? s[0]).trim().slice(0, 60) : ''
  const error = !!w.error && new RegExp(w.error, 'm').test(text)
  return { done, total, step, error }
}

/** How long a log-backed job counts as running after its log last changed, whatever process wrote it. */
export const LIVE_LOG_MS = 2 * 60_000

/** True when the log's last non-blank line says it finished: a line starting `done` or `finished`, or `N/N`. */
export function endsDone(text: string): boolean {
  const last = text.split('\n').reverse().find(l => l.trim()) ?? ''
  const m = /^\s*(\d+)\/(\d+)\b/.exec(last)
  return /^\s*(done|finished)\b/i.test(last) || (!!m && m[1] === m[2] && Number(m[2]) > 0)
}

/** A watched job's state. A log changed in the last LIVE_LOG_MS is running even when the process is not found,
 * and a stopped job whose log ends with a finish is done. */
export function watchState(p: { done: number | null; total: number | null; error: boolean }, alive: boolean | null, logAgeMs: number, text: string): 'running' | 'done' | 'stopped' | 'error' {
  if (p.error) return 'error'
  if (p.done !== null && p.total !== null && p.done >= p.total) return 'done'
  if (alive !== false || logAgeMs < LIVE_LOG_MS) return 'running'
  return endsDone(text) ? 'done' : 'stopped'
}

/** Time left at the rate so far, or '' when it can't be told yet. */
export function eta(elapsedMs: number, done: number | null, total: number | null): string {
  if (done === null || total === null || done <= 0 || done >= total || elapsedMs <= 0) return ''
  return ago((elapsedMs / done) * (total - done))
}

/**
 * What the poll remembers per job slug (~/.claude-progress/.state/job-track.json): `start`, when the job began (its
 * file's birth time, else when it was first seen), and a rate base, `at` and `done` when it was first seen, so the time
 * left comes from the rate (done since then over the time since then), never from a file's last write.
 * `seen` is when it was last seen, to drop old entries.
 */
export type Track = { start: number; at: number; done: number; seen: number }

/** Jobs with more steps than this are item counts, so a rate tells their time left. Fewer steps are uneven. */
export const FEW_STEPS = 20
/** The rate base must be this old before its rate counts. */
export const RATE_MIN_MS = 5 * 60_000

/** The job's track after this poll: new (born from `born` ms when known), reset when its count went back, else kept. */
export function trackJob(prev: Track | undefined, now: number, done: number | null, born?: number): Track {
  const d = done ?? 0
  if (!prev || d < prev.done) {
    const start = !prev && born && born > 0 && born <= now ? born : now
    return { start, at: now, done: d, seen: now }
  }
  return now - prev.seen > 3_600_000 ? { ...prev, seen: now } : prev
}

const UNIT_MS: Record<string, number> = { s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3_600_000, hr: 3_600_000, hour: 3_600_000 }

/** A rate the step text states, as items per ms ("7,196/h", "31/min"), or 0. */
export function stepRate(step: string): number {
  const m = /([\d,]+(?:\.\d+)?)\s*\/\s*(sec|s|min|m|hour|hr|h)\b/.exec(step)
  if (!m) return 0
  const n = Number(m[1]!.replace(/,/g, ''))
  return n > 0 ? n / UNIT_MS[m[2]!]! : 0
}

/**
 * Time left for an item-count job (over FEW_STEPS steps), or '' when it can't be told. By the rate since the track's
 * base (at least RATE_MIN_MS old), else a rate in the step text, else the average since a reported start.
 * A job of few steps gets none: its steps take uneven time, so no estimate beats a wrong one.
 */
export function rateLeft(t: Track | undefined, now: number, done: number | null, total: number | null, step = '', startedAt?: number): string {
  if (done === null || total === null || done >= total || total <= FEW_STEPS) return ''
  const left = total - done
  if (t && now - t.at >= RATE_MIN_MS && done > t.done) return ago((left * (now - t.at)) / (done - t.done))
  const r = stepRate(step)
  if (r > 0) return ago(left / r)
  if (startedAt && done > 0 && now > startedAt) return ago((left * (now - startedAt)) / done)
  return ''
}

/** Expands a leading `~/` to the home folder. */
export const expandHome = (p: string, home: string) => (p === '~' ? home : p.startsWith('~/') ? home + p.slice(1) : p)

export const MAX_LINES = 6
export const FRESH_MS = 10 * 60_000
/** A progress file stays shown this long after its last write. Agents write every 10 minutes and one long step
 * (a database refresh) can run past that, so a 10-minute limit dropped the bar and impact line of live jobs. */
export const FILE_FRESH_MS = 30 * 60_000

/** "Fix the Login bug!" -> "fix-the-login-bug" */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Words of a slug for loose matching: digits joined ("0-36b" and "036b" agree), a plural or verb "s" dropped. */
const words = (s: string) => new Set(slug(s).replace(/(\d)-(?=\d)/g, '$1').split('-').filter(Boolean).map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))

/**
 * The progress file an agent most likely writes when none is named exactly after its description: the agent may
 * pick a slightly different name ("server-1-orders-backfill-2024" for "Server-1 orders backfill 2024"). Picks the name
 * sharing the most words (at least 60% of the words in either, and at least 2), else null.
 */
export function closestFile(desc: string, names: string[]): string | null {
  const a = words(desc)
  let best: string | null = null
  let top = 0
  for (const n of names) {
    const b = words(n)
    let both = 0
    for (const w of a) if (b.has(w)) both++
    const score = both / (a.size + b.size - both || 1)
    if (both >= 2 && score >= 0.6 && score > top) { best = n; top = score }
  }
  return best
}

// A long-lived server: dev servers and app servers stay up by design, so their row is never "stuck".
const SERVER_CMD = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/,
  /\b(next|nuxt|nuxi|astro|remix)\s+(dev|start|preview)\b|\bvite\b(?!\s+build)|\b(webpack-dev-server|live-server|http-server)\b|\bparcel\b(?!\s+build)/,
  /\b(webpack|ng)\s+serve\b|\bgatsby\s+develop\b|\bexpo\s+start\b|\b(wrangler|vercel|netlify)\s+dev\b/,
  /\b(uvicorn|gunicorn|hypercorn|daphne)\b|\bstreamlit\s+run\b|\bjupyter\s+(lab|notebook)\b|\b(mkdocs|jekyll)\s+serve\b|\bhugo\s+server\b/,
  /\bflask\s+run\b|\bmanage\.py\s+runserver\b|\bfastapi\s+(dev|run)\b/,
  /\brails\s+(s|server)\b|\bbin\/dev\b|\bphp\s+(-S|artisan\s+serve)\b/,
  /\bpython3?\s+-m\s+(http\.server|SimpleHTTPServer)\b/,
  /\b(node|nodemon|tsx|ts-node|bun|deno\s+run)\s+(\S*\/)?server\.(m?[jt]s|cjs)\b/,
  /\bdocker[\s-]compose\s+up\b|\bcaddy\s+run\b|\bngrok\s+http\b/,
]

/**
 * Whether a background shell is a long-lived server, by its command or a "Start/Run ... server" description:
 * null when not, else the port read from the command (":3000"), or '' when none is given.
 */
export function serverOf(command: string, description = ''): string | null {
  const c = command.replace(/\s+/g, ' ')
  const byCmd = SERVER_CMD.some(re => re.test(c))
  const byDesc = /^\s*(start|run|launch|serve|boot)\b.*\bserver\b/i.test(description)
  if (!byCmd && !byDesc) return null
  const m = /(?:^|\s)(?:-p|--port)[ =](\d{2,5})\b/.exec(c) ?? /\bPORT=(\d{2,5})\b/.exec(c) ?? /\bhttp\.server\s+(\d{2,5})\b/.exec(c) ?? /(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{2,5})\b/.exec(c)
  return m ? `:${m[1]}` : ''
}

/** A progress file an agent may write under a name unlike its description (see pairFile). */
export type PairCandidate = { name: string; title: string; session: string; born: number }

const PAIR_STOP = new Set(['the', 'and', 'for', 'with', 'then', 'that', 'this', 'from', 'into', 'when', 'its', 'are', 'was', 'fix', 'add', 'run', 'make', 'check', 'update'])
const pairWords = (s: string) => new Set([...words(s)].filter(w => w.length >= 3 && !PAIR_STOP.has(w)))

/**
 * The progress file a live agent writes when none is named after its description: among this session's fresh files
 * no other agent claimed (not shell rows, not another session's), one created since the agent started (a minute of
 * slack; a file with no known birth, its startedAt or the file system's, never pairs) that shares at least two words with the agent's description through its name or title. Exactly one such
 * file pairs; with several, the one sharing the most pairs when it leads every other by two words. Else null.
 */
export function pairFile(agent: { description: string; startedAt: number }, cands: PairCandidate[], session: string): string | null {
  const a = pairWords(agent.description)
  const scored = cands
    .filter(c => !c.name.startsWith('shell-') && (!c.session || !session || c.session === session) && c.born > 0 && c.born >= agent.startedAt - 60_000)
    .map(c => { const b = new Set([...pairWords(c.name), ...pairWords(c.title)]); return { c, n: [...a].filter(w => b.has(w)).length } })
    .filter(x => x.n >= 2)
    .sort((x, y) => y.n - x.n)
  if (scored.length === 1) return scored[0]!.c.name
  if (scored.length > 1 && scored[0]!.n > scored[1]!.n + 1) return scored[0]!.c.name
  return null
}

export const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export const bar = (frac: number, w = 20) => {
  const f = Math.round(Math.max(0, Math.min(1, frac)) * w)
  return '█'.repeat(f) + '░'.repeat(w - f)
}

/** Parses a progress file's text; null when it is not usable JSON. */
export function parseProgress(text: string): Progress | null {
  try {
    const p = JSON.parse(text) as { done?: unknown; total?: unknown; step?: unknown; startedAt?: unknown }
    if (!p || typeof p !== 'object') return null
    const ok = typeof p.done === 'number' && typeof p.total === 'number' && p.total > 0
    return {
      done: ok ? (p.done as number) : null,
      total: ok ? (p.total as number) : null,
      step: typeof p.step === 'string' ? p.step : '',
      startedAt: typeof p.startedAt === 'number' ? p.startedAt : undefined,
    }
  } catch {
    return null
  }
}

/** The `title`, `why`, `parent`, `reads`, `writes`, `area` and `impact` strings, the `gains` and the `steps` checklist of a parsed progress file, the ones present and not empty. */
export function pickMeta(p: unknown): Meta {
  const m: Meta = {}
  if (!p || typeof p !== 'object') return m
  for (const k of ['title', 'why', 'parent', 'reads', 'writes', 'area', 'impact'] as const) {
    const v = (p as Record<string, unknown>)[k]
    if (typeof v === 'string' && v.trim()) m[k] = v.trim()
  }
  const raw = p as Record<string, unknown>
  const steps = stepItems(raw.steps, typeof raw.done === 'number' ? raw.done : undefined, typeof raw.total === 'number' ? raw.total : undefined)
  if (steps.length) m.steps = steps
  const g = (p as Record<string, unknown>).gains
  if (g && typeof g === 'object' && !Array.isArray(g)) {
    const gains: Gains = {}
    for (const k of ['cost', 'quality', 'speed'] as const) {
      const v = (g as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.trim()) gains[k] = v.trim()
    }
    if (Object.keys(gains).length) m.gains = gains
  }
  return m
}

// ---- A job's step checklist ----

/** At most this many steps are kept in a progress file. More are cut. */
export const MAX_STEPS = 50
/** A step's name is cut to this many characters when stored. */
export const MAX_STEP_NAME = 200
/** An open card lists at most this many checklist lines (items and "… N more" lines). */
export const CHECKLIST_MAX = 12
export const STEP_STATES: readonly StepState[] = ['done', 'active', 'todo', 'skipped', 'failed']
const isState = (x: unknown): x is StepState => typeof x === 'string' && (STEP_STATES as readonly string[]).includes(x)

/** A step's own note is cut to this many characters when stored. */
export const MAX_STEP_NOTE = 200

/**
 * One step as stored: a name, or `{name, state?, note?}` when its state or its own note was given. Null when it has
 * no name. `note` is the item's own dim text in the checklist. It never comes from the job's `step`.
 */
export type StoredStep = string | { name: string; state?: StepState; note?: string }
export function storedStep(x: unknown): StoredStep | null {
  const cut = (v: string, max: number) => { const t = v.replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t }
  if (typeof x === 'string') return cut(x, MAX_STEP_NAME) || null
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const o = x as Record<string, unknown>
    const name = typeof o.name === 'string' ? cut(o.name, MAX_STEP_NAME) : ''
    if (!name) return null
    const note = typeof o.note === 'string' ? cut(o.note, MAX_STEP_NOTE) : ''
    if (!isState(o.state) && !note) return name
    return { name, ...(isState(o.state) ? { state: o.state } : {}), ...(note ? { note } : {}) }
  }
  return null
}

/** A `steps` value as stored: names or `{name, state}`, empties dropped, at most MAX_STEPS. Null when not an array. */
export function cleanSteps(v: unknown): StoredStep[] | null {
  if (!Array.isArray(v)) return null
  return v.map(storedStep).filter((x): x is StoredStep => x !== null).slice(0, MAX_STEPS)
}

/**
 * A progress file's `steps` with each item's state and own note. A state given in the file wins. Otherwise it comes from `done`:
 * an index below it is done, the one at it is active, the rest to do. Without `done` the first item is active.
 * `total` is not used: when it differs from the list's length the bar follows `total` and the list still shows.
 */
export function stepItems(v: unknown, done?: number, total?: number): StepItem[] {
  const list = cleanSteps(v)
  if (!list?.length) return []
  const d = typeof done === 'number' && Number.isFinite(done) ? Math.max(0, Math.floor(done)) : 0
  const finished = typeof total === 'number' && total > 0 && typeof done === 'number' && done >= total
  const byCount = (i: number): StepState => (finished || i < d ? 'done' : i === d ? 'active' : 'todo')
  return list.map((x, i) => {
    if (typeof x === 'string') return { name: x, state: byCount(i) }
    return { name: x.name, state: x.state ?? byCount(i), ...(x.note ? { note: x.note } : {}) }
  })
}

/** A checklist line: an item with its index, or "… N earlier" above the window, or "… N more" below it. */
export type CheckLine = { kind: 'item'; item: StepItem; index: number } | { kind: 'more'; n: number; where: 'before' | 'after' }

/**
 * The lines an open card shows for a checklist, at most `max`. A longer list shows a window around the active item
 * (else the first failed, else the first to do, else the end), with "… N earlier" above it and "… N more" below.
 */
export function checklistLines(items: readonly StepItem[], max = CHECKLIST_MAX): CheckLine[] {
  const all = items.map((item, index) => ({ kind: 'item' as const, item, index }))
  if (items.length <= max) return all
  const find = (s: StepState) => items.findIndex(x => x.state === s)
  const at = [find('active'), find('failed'), find('todo')].find(i => i >= 0) ?? items.length - 1
  const n = items.length
  // Two items of context before the anchor, then fill the rest after it.
  let start = Math.max(0, at - 2)
  let w = max - (start > 0 ? 1 : 0) - 1
  if (start + w >= n) { w = max - 1; start = n - w }
  const out: CheckLine[] = []
  if (start > 0) out.push({ kind: 'more', n: start, where: 'before' })
  out.push(...all.slice(start, start + w))
  if (start + w < n) out.push({ kind: 'more', n: n - start - w, where: 'after' })
  return out
}

/** A running row's inline checklist (closed card) lists at most this many items, then "… N more". */
export const INLINE_MAX = 5
/** At most this many running rows show an inline checklist. The rest show only their step line. */
export const INLINE_ROWS = 3

/**
 * The lines a closed running row shows inline: up to `max` items around the active one (else the first failed,
 * else the first to do, else the end): one before it, it, and the ones after it. Earlier items fold away. Later
 * ones past the window become one "… N more" line.
 */
export function inlineLines(items: readonly StepItem[], max = INLINE_MAX): CheckLine[] {
  const all = items.map((item, index) => ({ kind: 'item' as const, item, index }))
  const n = items.length
  if (n <= max) return all
  const find = (s: StepState) => items.findIndex(x => x.state === s)
  const at = [find('active'), find('failed'), find('todo')].find(i => i >= 0) ?? n - 1
  let start = Math.max(0, at - 1)
  const end = Math.min(n, start + max)
  start = Math.max(0, end - max)
  const out: CheckLine[] = all.slice(start, end)
  if (end < n) out.push({ kind: 'more', n: n - end, where: 'after' })
  return out
}

let inlineOn = true
/** Turns inline checklists under running rows on or off (the inlineSteps option, on by default). */
export function setInlineSteps(on: boolean) { inlineOn = on }
/** True when the inlineSteps option is on. */
export const inlineStepsOn = () => inlineOn

/** A checklist item's mark: single-width symbols only. */
export const STEP_MARK: Record<StepState, string> = { done: '✓', active: '◐', todo: '○', skipped: '·', failed: '✖' }

/** ~/.claude-progress/titles.txt: `<job id><TAB><title><TAB><why><TAB><parent><TAB><area>` per line (area optional), keyed by the job id's slug. */
export function parseTitles(text: string): Record<string, Meta> {
  const out: Record<string, Meta> = {}
  for (const l of text.split('\n')) {
    if (!l.trim() || l.startsWith('#')) continue
    const [id = '', title = '', why = '', parent = '', area = ''] = l.split('\t').map(x => x.trim())
    const m = pickMeta({ title, why, parent, area })
    if (slug(id) && Object.keys(m).length) out[slug(id)] = m
  }
  return out
}

/** One status-line row: `▶ name ████████░░░░░░░░░░░░ 40.0% · 2/5 · step · 3m`. */
export function line(r: Row, now: number): string {
  const tools = r.id.startsWith('file:') || r.id.startsWith('watch:') ? '' : ` · ${r.tools} tools`
  const meta = ` · ${ago(now - r.startedAt)}${tools}`
  const step = r.step ? ` · ${r.step}` : ''
  const mark = r.state === 'done' ? '✔' : r.state === 'stopped' ? '■ stopped' : r.state === 'error' ? '✖ error' : '▶'
  const left = r.eta && r.state !== 'done' ? ` · ETA ${r.eta}` : ''
  if (r.done !== null && r.total !== null) {
    const frac = r.done / r.total
    return `${mark} ${r.description} ${bar(frac)} ${(frac * 100).toFixed(1)}% · ${r.done}/${r.total}${step}${meta}${left}`
  }
  if (r.state && r.state !== 'running') return `${mark} ${r.description}${step}${meta}`
  const state = r.status === 'running' ? 'working' : r.status
  const wait = r.wait?.length ? ` · ${r.wait.join(' · ')}` : ''
  return `▶ ${r.description} ${state}${wait}${step}${meta}${r.lastTool ? ` · ${r.lastTool}` : ''}`
}

/** Rendered lines, capped; the overflow is summed up on the last line. */
export function lines(rows: Row[], now: number, max = MAX_LINES): string[] {
  const out = rows.slice(0, max).map(r => line(r, now))
  if (rows.length > max) out[max - 1] = `… ${rows.length - max + 1} more`
  return out
}

/** Quotes a string for POSIX sh inside single quotes. */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** The chained command inside an installed script (its `prev=` line), so a rewrite keeps it. */
export function prevOf(script: string): string | undefined {
  const m = /^prev='((?:[^']|'\\'')*)'$/m.exec(script)
  const v = m ? m[1]!.replace(/'\\''/g, "'") : ''
  return v || undefined
}

/** The status line script `/progress-bar setup` writes. `prev` is a command to chain after the bars. */
export function statusScript(prev?: string): string {
  return [
    '#!/bin/sh',
    '# progress-bar status line. Written by `/progress-bar setup`. Safe to edit or delete.',
    '# Prints each fresh (<2 min) ~/.claude-progress/.lines/*.txt, then the previous status line if any,',
    '# grouped into TO-DO / PROBLEMS / RUNNING / WAITING / DONE by group.py beside this script.',
    '# Without python3 the lines print ungrouped.',
    '# While the Status panel is on (~/.claude-progress/.state/panel-on) it prints one summary line,',
    '# unless PB_FULL=1 (the panel itself runs it that way for the full view).',
    '# Each session shows only its own bars: agents-<session>.txt and any *-<session>.txt line file.',
    '# Shared files (jobs.txt, other machines) show only when ~/.claude-progress/.state/scope says "all",',
    '# or in the project todos/lines.txt gives them to. Without lines.txt, jobs.txt shows everywhere.',
    'input=$(cat)',
    `prev=${shQuote(prev ?? '')}`,
    'sid=$(printf \'%s\' "$input" | sed -n \'s/.*"session_id" *: *"\\([^"]*\\)".*/\\1/p\' | head -1 | tr -cd \'A-Za-z0-9_-\' | cut -c1-12)',
    'scope=$(cat "$HOME/.claude-progress/.state/scope" 2>/dev/null || echo session)',
    '# The session\'s folder picks its project\'s to-do list in group.py (workspace.current_dir, else cwd).',
    'PB_CWD=$(printf \'%s\' "$input" | sed -n \'s/.*"current_dir" *: *"\\([^"]*\\)".*/\\1/p\' | head -1)',
    '[ -n "$PB_CWD" ] || PB_CWD=$(printf \'%s\' "$input" | sed -n \'s/.*"cwd" *: *"\\([^"]*\\)".*/\\1/p\' | head -1)',
    'export PB_CWD',
    '# group.py keeps the jobs this session saw apart from other sessions (.state/group-seen-<session>.json).',
    'PB_SID=$sid; export PB_SID',
    '# Shared line files (jobs.txt, linux.txt...) show in a project listed for them in todos/lines.txt:',
    '# "<line file><TAB><project>", the project as todos/projects.txt names it (the longest prefix holding the folder).',
    'todos="$HOME/.claude-progress/todos"',
    'proj=$(awk -F \'\\t+|  +\' -v c="$PB_CWD" -v h="$HOME" \'/^[ \\t]*(#|$)/ { next } NF >= 2 { p = $1; sub(/^[ \\t]+/, "", p); sub(/[ \\t]+$/, "", p); if (substr(p, 1, 1) == "~") p = h substr(p, 2); sub(/\\/+$/, "", p); if (p != "" && (c == p || index(c, p "/") == 1) && length(p) > b) { b = length(p); r = $NF } } END { print r }\' "$todos/projects.txt" 2>/dev/null)',
    'shared=$( [ -n "$PB_CWD" ] && [ -n "$proj" ] && awk -F \'\\t+|  +\' -v p="$proj" \'/^[ \\t]*#/ { next } NF >= 2 && $NF == p { print $1 }\' "$todos/lines.txt" 2>/dev/null | tr \'\\n\' \' \')',
    '# No todos/lines.txt (a fresh machine): the shared jobs.txt shows in every session.',
    '[ -f "$todos/lines.txt" ] || shared="$shared jobs.txt"',
    'lines() {',
    '  dir="$HOME/.claude-progress/.lines"',
    '  for f in "$dir"/*.txt; do',
    '    [ -s "$f" ] || continue',
    '    if [ "$scope" != all ] && [ -n "$sid" ]; then',
    '      case "$(basename "$f" .txt)" in *-"$sid") ;; *) case " $shared " in *" $(basename "$f") "*) ;; *) continue ;; esac ;; esac',
    '    fi',
    '    [ -n "$(find "$f" -mmin -2 2>/dev/null)" ] || continue',
    '    cat "$f"; echo',
    '  done',
    '  # A chained status line that prints our own groups is a second progress status line: drop its output.',
    '  if [ -n "$prev" ]; then',
    '    p=$(printf \'%s\' "$input" | sh -c "$prev")',
    '    if [ -n "$p" ] && ! printf \'%s\\n\' "$p" | grep -qE \'(▾|▸) (☐ TO-DO|▶ RUNNING|✔ DONE|✖ PROBLEMS|⏸ WAITING)\'; then printf \'%s\\n\' "$p"; fi',
    '  fi',
    '}',
    'group="$HOME/.claude/progress-bar/group.py"',
    'if [ -f "$group" ] && command -v python3 >/dev/null 2>&1; then',
    '  out=$(lines)',
    '  mode=',
    '  if [ -f "$HOME/.claude-progress/.state/panel-on" ] && [ "$PB_FULL" != 1 ]; then mode=--summary; fi',
    '  printf \'%s\\n\' "$out" | python3 "$group" $mode 2>/dev/null || printf \'%s\\n\' "$out"',
    'else',
    '  lines',
    'fi',
    '',
  ].join('\n')
}

export type TodoItem = { index: number; heading: string; text: string; done: boolean; line: number }

const HEADING = /^\[(.+)\]$/
const TODO_HEADER = '# To-dos shown in the status line. One per line under a [name] heading. "x " marks done. "text | url" links.\n'

/** Every to-do item in file order, numbered from 1. Items before any heading go under `todo`. */
export function todoItems(text: string): TodoItem[] {
  const out: TodoItem[] = []
  let heading = 'todo'
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim()
    if (!t || t.startsWith('#')) return
    const m = HEADING.exec(t)
    if (m) { heading = m[1]!.trim(); return }
    const done = /^x\s/i.test(t)
    out.push({ index: out.length + 1, heading, text: done ? t.slice(2).trim() : t, done, line: i })
  })
  return out
}

/** Numbered list for `/progress-bar todo`. */
export function todoList(text: string): string {
  const items = todoItems(text)
  if (!items.length) return 'No to-dos. Add one: /progress-bar todo add [name] <text>'
  const out: string[] = []
  let cur = ''
  for (const it of items) {
    if (it.heading !== cur) { cur = it.heading; out.push(`[${cur}]`) }
    out.push(`  ${it.index}. ${it.done ? '[x] ' : ''}${it.text}`)
  }
  return out.join('\n')
}

const headings = (lines: string[]) => lines.map(l => HEADING.exec(l.trim())?.[1]?.trim()).filter((h): h is string => !!h)

/**
 * Adds an item. `rest` is `[name] text`, `name text` when name is an existing heading, or `text`
 * (under the last heading in the file, or [todo]).
 */
export function todoAdd(text: string, rest: string): { text: string; heading: string } {
  const lines = text ? text.replace(/\n+$/, '').split('\n') : TODO_HEADER.trimEnd().split('\n')
  const known = headings(lines)
  let heading: string | undefined
  let item = rest.trim()
  const br = /^\[([^\]]+)\]\s*(.*)$/.exec(item)
  if (br) { heading = br[1]!.trim(); item = br[2]!.trim() }
  else {
    const [first = '', ...more] = item.split(/\s+/)
    const hit = known.find(h => h.toLowerCase() === first.toLowerCase())
    if (hit && more.length) { heading = hit; item = item.slice(first.length).trim() }
  }
  heading ??= known[known.length - 1] ?? 'todo'
  const at = lines.findIndex(l => l.trim().toLowerCase() === `[${heading!.toLowerCase()}]`)
  if (at < 0) {
    lines.push(`[${heading}]`, item)
  } else {
    let end = at + 1
    while (end < lines.length && !HEADING.test(lines[end]!.trim())) end++
    while (end > at + 1 && !lines[end - 1]!.trim()) end--
    lines.splice(end, 0, item)
  }
  return { text: lines.join('\n') + '\n', heading }
}

/** Marks an item done by its number or by text it contains (first open match). Null when nothing matches. */
export function todoDone(text: string, which: string): { text: string; item: TodoItem } | null {
  const items = todoItems(text)
  const w = which.trim()
  const item = /^\d+$/.test(w)
    ? items.find(i => i.index === Number(w))
    : items.find(i => !i.done && i.text.toLowerCase().includes(w.toLowerCase()))
  if (!item || !w) return null
  const lines = text.split('\n')
  if (!item.done) lines[item.line] = `x ${lines[item.line]!.trim()}`
  return { text: lines.join('\n'), item }
}

/** Removes done items, and headings left with no items. */
export function todoClear(text: string): { text: string; removed: number } {
  const lines = text.split('\n')
  const keep: string[] = []
  let removed = 0
  for (const l of lines) {
    if (/^x\s/i.test(l.trim())) { removed++; continue }
    keep.push(l)
  }
  const out = keep.filter((l, i) => {
    if (!HEADING.test(l.trim())) return true
    for (let j = i + 1; j < keep.length; j++) {
      const t = keep[j]!.trim()
      if (HEADING.test(t)) return false
      if (t && !t.startsWith('#')) return true
    }
    return false
  })
  return { text: out.join('\n'), removed }
}
