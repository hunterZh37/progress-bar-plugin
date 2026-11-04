// Priority to-dos and auto-next. Pure functions only, so tests run them without the engine.
//
// todo.txt items may start with "N. " (1 = highest, per heading). Unnumbered items sort after numbered ones, in file order.
// An item ending "(after X)" is blocked while a running row's name or title holds every key word of X.
// When a job finishes, autonext.ts starts the top ready item under that job's machine (never [you]).

export type PItem = {
  heading: string
  /** The line as written, trimmed, without "x ". */
  raw: string
  /** The item without its number and link: what menus match on. */
  body: string
  num: number | null
  after: string
  url: string
  line: number
}

const HEADING = /^\[(.+)\]$/
const NUM = /^(\d+)\.\s+/
const AFTER = /\s*\(after\s+([^)]+)\)\s*$/i
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'is', 'it', 'its', 'job', 'run', 'done', 'finish', 'finishes', 'after'])

/** "2. Grant links (after 2019-20 load) | https://x" -> its parts. */
export function parseItem(raw: string): { num: number | null; body: string; after: string; url: string } {
  const [text, ...rest] = raw.split(' | ')
  let t = text!.trim()
  const m = NUM.exec(t)
  const num = m ? Number(m[1]) : null
  if (m) t = t.slice(m[0].length)
  const a = AFTER.exec(t)
  return { num, body: t, after: a ? a[1]!.trim() : '', url: rest.join(' | ').trim() }
}

/** Open (not done) items in file order with their heading. */
export function openItems(text: string): PItem[] {
  const out: PItem[] = []
  let heading = 'todo'
  text.split('\n').forEach((l, i) => {
    const t = l.trim()
    if (!t || t.startsWith('#')) return
    const h = HEADING.exec(t)
    if (h) { heading = h[1]!.trim(); return }
    if (/^x\s/i.test(t)) return
    out.push({ heading, raw: t, line: i, ...parseItem(t) })
  })
  return out
}

/** Items of one heading sorted by priority: numbered first (low number first), then unnumbered, file order breaking ties. */
export function byPriority<T extends { num: number | null; line: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity) || a.line - b.line)
}

/** The key words of an "(after X)": lowercase words and numbers, common words left out. */
export function keyWords(x: string): string[] {
  return x.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w))
}

/** The running row (name or title) an "(after X)" waits for, or ''. Every key word of X must be in it. */
export function blocker(after: string, running: string[]): string {
  const ks = keyWords(after)
  if (!ks.length) return ''
  for (const r of running) {
    const ws = new Set(r.toLowerCase().split(/[^a-z0-9]+/))
    if (ks.every(k => ws.has(k))) return r
  }
  return ''
}

export type Ranked = PItem & { blockedBy: string; next: boolean }

/**
 * Every open item, by heading in file order and by priority within it, each marked blocked or ready.
 * The first ready item of each machine heading (not [you]) is `next`.
 */
export function ranked(text: string, running: string[]): Ranked[] {
  const items = openItems(text)
  const heads = [...new Set(items.map(i => i.heading))]
  return heads.flatMap(h => {
    let found = false
    return byPriority(items.filter(i => i.heading === h)).map(i => {
      const blockedBy = i.after ? blocker(i.after, running) : ''
      const next = !found && !blockedBy && h.toLowerCase() !== 'you'
      if (next) found = true
      return { ...i, blockedBy, next }
    })
  })
}

/** The top ready item under a heading (case-insensitive), or null. Never [you]. */
export function nextReady(text: string, heading: string, running: string[]): Ranked | null {
  if (!heading || heading.toLowerCase() === 'you') return null
  return ranked(text, running).find(i => i.next && i.heading.toLowerCase() === heading.toLowerCase()) ?? null
}

/**
 * Moves an item one place up or down within its heading and numbers every open item there 1..n in the new order.
 * The item is found by its text (`body`, or the line without its number), never by line number. Null when not found
 * or already at that end. Done items and other headings are left as they are.
 */
export function moveItem(text: string, body: string, dir: 'up' | 'down'): string | null {
  const items = openItems(text)
  const want = body.trim().split(' | ')[0]!.trim()
  const it = items.find(i => i.body === want || i.raw.split(' | ')[0]!.trim() === want)
  if (!it) return null
  const order = byPriority(items.filter(i => i.heading === it.heading))
  const at = order.indexOf(it)
  const to = dir === 'up' ? at - 1 : at + 1
  if (to < 0 || to >= order.length) return null
  ;[order[at], order[to]] = [order[to]!, order[at]!]
  const lines = text.split('\n')
  // The heading's item lines, in file order, now hold the items in priority order.
  const slots = order.map(i => i.line).sort((a, b) => a - b)
  slots.forEach((ln, k) => {
    const i = order[k]!
    lines[ln] = `${k + 1}. ${i.body}${i.url ? ` | ${i.url}` : ''}`
  })
  return lines.join('\n')
}

/** The heading a finished job belongs to: a "host: name" prefix or a title starting with a heading, else the local one. */
export function jobMachine(name: string, title: string, headings: string[]): string {
  const heads = [...new Set(headings)].filter(h => h.toLowerCase() !== 'you')
  const find = (w: string) => heads.find(h => h.toLowerCase() === w.toLowerCase())
  const pre = /^([A-Za-z0-9_.-]+):\s/.exec(name)?.[1]
  const lead = /^([A-Za-z0-9_.]+)/.exec(title || name)?.[1] ?? ''
  const nameLead = /^([A-Za-z0-9_.]+)/.exec(name)?.[1] ?? ''
  const local = heads.find(h => /^(mac|local)$/i.test(h)) ?? ''
  const hit = (pre && find(pre)) || find(lead) || find(nameLead)
  return hit || local || heads[0] || ''
}

export type Mode = 'on' | 'off' | 'ask'

/** .state/autonext: on, off or ask. Anything else reads as ask. */
export const parseMode = (s: string): Mode => {
  const t = s.trim().toLowerCase()
  return t === 'on' || t === 'off' ? t : 'ask'
}

export const DEFAULT_CAPS: Record<string, number> = { mac: 3, hunty: 2 }

/** .state/caps: "mac=3" lines (or "mac: 3"). Defaults: mac 3, hunty 2. Other machines have no cap. */
export function parseCaps(s: string): Record<string, number> {
  const out = { ...DEFAULT_CAPS }
  for (const l of s.split('\n')) {
    const m = /^\s*([A-Za-z0-9_.-]+)\s*[=:]\s*(\d+)\s*$/.exec(l)
    if (m) out[m[1]!.toLowerCase()] = Number(m[2])
  }
  return out
}

/** The prompt auto-next sends. */
export const nextPrompt = (body: string, url = '') =>
  `Next up from the to-do list: ${body}${url ? ` (${url})` : ''}. Start it with a progress bar, and mark it done on the to-do list (/progress-bar todo done) once it runs.`

/** A status line row's job name, as group.py reads it. */
export function rowName(l: string): string {
  const s = l.replace(/^[▶✔✖■◐◓◑◒⚠]\s*(stuck \S+\s*)?(error\s*|stopped\s*)?/, '')
  const n = s.split(/\s+[█░]|\s+·\s+/)[0]!.trim()
  return n.replace(/\s+(working|pending|waiting|running|starting)(…|\.\.\.)?$/, '')
}

/** A status line row still running: a job row that is not done, a problem, waiting, a busy process or a health line. */
export function isRunningRow(l: string): boolean {
  if (!/^[▶]/.test(l) && !/[█░]/.test(l)) return false
  if (/^[✔✖■]/.test(l) || / ✗ /.test(l)) return false
  if (/\b100(\.0)?%(?!\s*CPU)/.test(l) || /· done(:|\s*$)/.test(l)) return false
  if (/\b(waiting|pending)\b|\bwaits for\b/.test(l)) return false
  if (/% CPU|helper healthy/.test(l)) return false
  return true
}

/** Done events ("<job> done", success) from events.jsonl lines newer than `since` (epoch s). */
export function doneEvents(raw: string, since: number): { ts: number; source: string; title: string }[] {
  const out: { ts: number; source: string; title: string }[] = []
  for (const l of raw.split('\n').slice(-400)) {
    try {
      const e = JSON.parse(l) as { ts?: unknown; level?: unknown; source?: unknown; title?: unknown }
      if (e && e.level === 'success' && typeof e.ts === 'number' && e.ts > since && typeof e.source === 'string' && typeof e.title === 'string' && / done$/.test(e.title)) {
        out.push({ ts: e.ts, source: e.source, title: e.title.replace(/ done$/, '') })
      }
    } catch { /* a bad line */ }
  }
  return out
}

export type RankedTodo<T> = T & { num: number | null; body: string; blockedBy: string; next: boolean; after: string }

/**
 * The panel's open to-dos ({ owner, text, line }, text without its link) per owner in file order, each owner's items
 * by priority, marked blocked (by a running name or title) or next (the first ready item of a machine, never [you]).
 */
export function rankTodos<T extends { owner: string; text: string; line: number }>(todos: T[], running: string[]): RankedTodo<T>[] {
  const owners = [...new Set(todos.map(t => t.owner))]
  return owners.flatMap(o => {
    let found = false
    const items = todos.filter(t => t.owner === o).map(t => ({ ...t, ...parseItem(t.text) }))
    return byPriority(items).map(i => {
      const blockedBy = i.after ? blocker(i.after, running) : ''
      const next = !found && !blockedBy && o.toLowerCase() !== 'you'
      if (next) found = true
      const { url: _u, ...rest } = i
      return { ...rest, blockedBy, next } as RankedTodo<T>
    })
  })
}

/** A job's short title for "after X:": the part before " · ", then before ": " unless that is only a host prefix. */
export function shortJob(s: string): string {
  const a = s.split(' · ')[0]!.trim()
  const i = a.indexOf(': ')
  return i > 8 ? a.slice(0, i) : a
}

/** A to-do's shown title: no "(after X)" (the file keeps it). */
export const shownTitle = (body: string) => body.replace(AFTER, '').trim()

/** Cut to `n` characters with "…", never wrapping. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

export type TodoRow<T> =
  | { kind: 'head'; owner: string; count: number }
  | { kind: 'gap'; owner: string }
  | { kind: 'waits'; owner: string; text: string; at: number }
  | { kind: 'item'; owner: string; item: RankedTodo<T>; marker: '▶' | '⏸' | ' '; num: string; title: string; dim: boolean }

/**
 * The TO-DO section as rows, one line each at `width` columns: per owner a "Mac  2" heading, then items by priority.
 * Marker column: green ▶ on the next item, dim ⏸ on a blocked one. Number column 2 wide. Blocked items that wait on
 * the same job in a row get one dim "waits for <job>" line under the last of them. A blank row between owners.
 * `label` turns a blocker (a running name or title) into the job's title to show.
 */
export function todoRows<T extends { owner: string; text: string; line: number }>(ranked: RankedTodo<T>[], width: number, label: (b: string) => string = b => b): TodoRow<T>[] {
  const out: TodoRow<T>[] = []
  const owners = [...new Set(ranked.map(t => t.owner))]
  const room = Math.max(8, width - 10)
  owners.forEach((owner, k) => {
    const items = ranked.filter(t => t.owner === owner)
    if (k) out.push({ kind: 'gap', owner })
    out.push({ kind: 'head', owner, count: items.length })
    const bOf = (t: RankedTodo<T> | undefined) => (t?.blockedBy ? shortJob(label(t.blockedBy)) : '')
    items.forEach((t, i) => {
      const b = bOf(t)
      out.push({ kind: 'item', owner, item: t, marker: t.next ? '▶' : b ? '⏸' : ' ', num: (t.num === null ? '' : String(t.num)).padStart(2), title: clip(shownTitle(t.body), room), dim: !!b })
      if (b && bOf(items[i + 1]) !== b) out.push({ kind: 'waits', owner, text: clip(`waits for ${b}`, room), at: t.line })
    })
  })
  return out
}
