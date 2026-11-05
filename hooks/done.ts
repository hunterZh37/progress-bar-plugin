import type { EngineInterface } from 'claude-code'

import { isDarwin } from './mac'
import { slug } from './render'
import type { DoneRec } from '../types'

// Done records: what a finished task changed. Jobs delete their progress file when done, so the plugin keeps one
// small record per finished job or agent in ~/.claude-progress/.state/done/<slug>.json (the last 100, 7 days).
// A job reports its impact with an `impact` field in its progress file (one to three short lines) before it ends.
// An agent's impact comes from its final report: its SubagentHandback message, else its last text in the transcript.
// The Status panel shows them when a DONE row is opened.

export const DONE_REL = '.claude-progress/.state/done'
export const DONE_KEEP = 100
export const DONE_DAYS_MS = 7 * 86_400_000
export const IMPACT_MAX = 300
const LINE_MAX = 200

/** A progress file's `impact`: a string (lines split on newlines) or a list, as up to three trimmed lines. */
export function impactLines(v: unknown): string[] {
  const raw = typeof v === 'string' ? v.split('\n') : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return raw.map(x => x.trim()).filter(Boolean).slice(0, 3).map(x => (x.length > LINE_MAX ? `${x.slice(0, LINE_MAX - 1)}…` : x))
}

/** Markdown out: bold, code ticks, links, list marks and headings. */
export function plainMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*(#+|[-*+]|\d+\.)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const sentences = (s: string) => s.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map(x => x.trim()).filter(Boolean) ?? []

/** Lines cut to IMPACT_MAX characters in all, the last one ending in … when cut. */
function capLines(lines: string[]): string[] {
  const out: string[] = []
  let room = IMPACT_MAX
  for (const l of lines) {
    if (room <= 1) break
    out.push(l.length > room ? `${l.slice(0, room - 1)}…` : l)
    room -= l.length
  }
  return out
}

/**
 * A short impact from an agent's final report: its first bold sentence (a bold span of 4 or more words that is not a
 * label ending in ":"), else its first 2 to 3 prose lines (headings, bold-only labels and code left out), split into
 * sentences, cleaned of markdown and capped at IMPACT_MAX characters in all. At most three lines.
 */
export function summarize(report: string): string[] {
  const lines = report.replace(/```[\s\S]*?```/g, '').split('\n').map(l => l.trim()).filter(l => l && !/^#/.test(l))
  for (const l of lines) {
    for (const m of l.matchAll(/(\*\*|__)(.+?)\1/g)) {
      const t = plainMd(m[2]!)
      if (t.split(/\s+/).length >= 4 && !/:$/.test(t)) return capLines([t])
    }
  }
  const prose = lines.filter(l => !/^(\*\*|__)[^*_]+\1:?$/.test(l) && !/^[-=|]{3,}/.test(l))
  return capLines(prose.slice(0, 3).flatMap(l => sentences(plainMd(l))).filter(Boolean).slice(0, 3))
}

/** An agent's final report from its transcript: the last SubagentHandback message, else its last text. With the first and last timestamps. */
export function reportOf(transcript: string): { text: string; first: number; last: number } {
  let hand = '', said = '', first = 0, last = 0
  for (const l of transcript.split('\n')) {
    if (!l.startsWith('{')) continue
    let d: { message?: { role?: unknown; content?: unknown }; timestamp?: unknown; type?: unknown }
    try { d = JSON.parse(l) } catch { continue }
    const at = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : 0
    if (at) { if (!first) first = at; last = at }
    const c = d.message?.content
    if (d.type !== 'assistant' && d.message?.role !== 'assistant') continue
    if (typeof c === 'string' && c.trim()) { said = c; continue }
    if (!Array.isArray(c)) continue
    for (const x of c as Record<string, unknown>[]) {
      if (x.type === 'tool_use' && x.name === 'SubagentHandback') {
        const m = (x.input as { message?: unknown } | undefined)?.message
        if (typeof m === 'string' && m.trim()) hand = m
      } else if (x.type === 'text' && typeof x.text === 'string' && x.text.trim()) said = x.text
    }
  }
  return { text: hand || said, first, last }
}

/** A row name as a title when no record or progress file gives one: "hunty: hunty-board-cap-extract" -> "Hunty: Board cap extract". */
export function prettyName(name: string): string {
  const m = /^([A-Za-z0-9_.-]+):\s*(.+)$/.exec(name.trim())
  const host = m ? m[1]! : ''
  let rest = m ? m[2]! : name.trim()
  if (/^[a-z0-9_.-]+$/.test(rest)) {
    if (host && rest.toLowerCase().startsWith(`${host.toLowerCase()}-`)) rest = rest.slice(host.length + 1)
    rest = rest.replace(/[-_]+/g, ' ').trim()
  }
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
  return host ? `${cap(host)}: ${cap(rest)}` : cap(rest)
}

/** How long a task ran: "45s", "12m", "1h20m". */
export function ranFor(ms: number): string {
  if (!(ms > 0)) return ''
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`
  const m = Math.round(ms / 60_000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** "14:05" in local time. */
export const clock = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** What an opened DONE row shows, line by line: impact (or "no impact reported"), finish and run time with the machine badge, why. */
export function doneDetails(r: Pick<DoneRec, 'impact' | 'started' | 'finished' | 'why'> | undefined, at = '', machine = ''): string[] {
  const out = r?.impact?.length ? [...r.impact] : ['no impact reported']
  const fin = r?.finished ? clock(r.finished) : at
  const ran = r?.started && r.finished ? ranFor(r.finished - r.started) : ''
  const when = [fin && `finished ${fin}`, ran && `ran ${ran}`].filter(Boolean).join(' · ')
  if (when || machine) out.push([when, machine && `🖥  ${machine}`].filter(Boolean).join('   '))
  if (r?.why) out.push(`unlocks: ${r.why.replace(/^unlocks:?\s*/i, '')}`)
  return out
}

/** Parses a done record; null when it is not one. */
export function parseDone(text: string): DoneRec | null {
  try {
    const r = JSON.parse(text) as Partial<DoneRec>
    if (!r || typeof r !== 'object' || typeof r.slug !== 'string' || typeof r.finished !== 'number') return null
    return {
      slug: r.slug, title: typeof r.title === 'string' ? r.title : '', why: typeof r.why === 'string' ? r.why : undefined,
      impact: impactLines(r.impact), step: typeof r.step === 'string' ? r.step : undefined,
      started: typeof r.started === 'number' ? r.started : undefined, finished: r.finished,
      machine: typeof r.machine === 'string' ? r.machine : '', session: typeof r.session === 'string' ? r.session : undefined,
      kind: r.kind === 'agent' ? 'agent' : 'job',
    }
  } catch { return null }
}

/** Record files to delete: over 7 days old, or past the newest DONE_KEEP. */
export function pruneList(recs: { name: string; finished: number }[], now: number): string[] {
  const sorted = [...recs].sort((a, b) => b.finished - a.finished)
  return sorted.filter((r, i) => i >= DONE_KEEP || now - r.finished > DONE_DAYS_MS).map(r => r.name)
}

let machine = ''
/** This machine's name for the badge: Mac on macOS, else the short host name. */
export async function machineName($: EngineInterface): Promise<string> {
  if (machine) return machine
  if (await isDarwin($)) return (machine = 'Mac')
  try {
    const h = (await $.process.run(['hostname', '-s'], { timeoutMs: 3000 })).stdout.trim()
    machine = h ? h.charAt(0).toUpperCase() + h.slice(1) : 'local'
  } catch { machine = 'local' }
  return machine
}

/** Every done record, by slug. */
export async function readDone($: EngineInterface, h: string): Promise<Record<string, DoneRec>> {
  const dir = `${h}/${DONE_REL}`
  const out: Record<string, DoneRec> = {}
  let files: Awaited<ReturnType<EngineInterface['fs']['list']>> = []
  try { files = await $.fs.list(dir) } catch { return out }
  for (const f of files) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    try {
      const r = parseDone(String(await $.fs.read(`${dir}/${f.name}`)))
      if (r) out[r.slug] = r
    } catch { /* half written */ }
  }
  return out
}

/** Saves a record, keeping an impact an earlier save of the same run had, then prunes old ones. */
export async function saveDone($: EngineInterface, h: string, rec: Omit<DoneRec, 'machine'> & { machine?: string }): Promise<DoneRec> {
  const dir = `${h}/${DONE_REL}`
  const key = slug(rec.slug)
  const path = `${dir}/${key}.json`
  let prev: DoneRec | null = null
  try { prev = parseDone(String(await $.fs.read(path))) } catch { prev = null }
  const same = !!prev && !!rec.started && prev.started === rec.started
  const out: DoneRec = { ...rec, slug: key, machine: rec.machine || await machineName($), impact: rec.impact.length ? rec.impact : same ? prev!.impact : [] }
  if (!out.title && same) out.title = prev!.title
  await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5000 }).catch(() => undefined)
  await $.fs.write(path, JSON.stringify(out)).catch(() => undefined)
  try {
    const all = await readDone($, h)
    const drop = pruneList(Object.values(all).map(r => ({ name: r.slug, finished: r.finished })), out.finished)
    if (drop.length) await $.process.run(['rm', '-f', ...drop.map(n => `${dir}/${n}.json`)], { timeoutMs: 5000 }).catch(() => undefined)
  } catch { /* next save */ }
  return out
}

/**
 * A record for an agent that finished before the plugin kept records: its transcript in this session's subagents
 * folder, found by its description. Null when there is none.
 */
export async function backfillAgent($: EngineInterface, h: string, name: string, title = ''): Promise<DoneRec | null> {
  let base = ''
  try { base = `${h}/.claude/projects/${(await $.session.cwd()).replace(/[^A-Za-z0-9]/g, '-')}/${await $.session.id()}/subagents` } catch { return null }
  let files: Awaited<ReturnType<EngineInterface['fs']['list']>> = []
  try { files = await $.fs.list(base) } catch { return null }
  for (const f of files.filter(x => x.name.endsWith('.meta.json')).sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    let desc = ''
    try { desc = String((JSON.parse(String(await $.fs.read(`${base}/${f.name}`))) as { description?: unknown }).description ?? '') } catch { continue }
    if (!desc || slug(desc) !== slug(name)) continue
    const tx = `${base}/${f.name.replace(/\.meta\.json$/, '.jsonl')}`
    let text = ''
    try { text = (await $.process.run(['tail', '-c', String(4 * 1024 * 1024), tx], { timeoutMs: 5000 })).stdout } catch { return null }
    const r = reportOf(text)
    if (!r.last) return null
    let first = r.first
    try { first = reportOf((await $.process.run(['head', '-c', '65536', tx], { timeoutMs: 5000 })).stdout).first || first } catch { /* the tail's first */ }
    let session = ''
    try { session = await $.session.id() } catch { session = '' }
    return saveDone($, h, { slug: slug(desc), title: title || desc, impact: summarize(r.text), started: first || undefined, finished: r.last, session, kind: 'agent' })
  }
  return null
}
