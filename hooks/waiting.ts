// Why a waiting agent waits. Pure helpers: no `$`, so tests import them directly.
//
// What the engine gives: each tool call's input and result (a background Bash's `backgroundTaskId`, a Monitor's
// `taskId` and deadline), `$.agent.list()` (a child agent's `parentId`), and at every Stop and SubagentStop the
// session's in-flight background tasks (`background_tasks`, ids and descriptions). Nothing here reads a transcript's
// format: a transcript is only searched for a task id, to learn which agent started a task seen before a reload.

import { keyWords } from './priority'
import { ago, slug } from './render'

/** A background task an agent started: a shell (Bash run_in_background, or moved there) or a Monitor. */
export type BgTask = { id: string; desc: string; kind: 'shell' | 'monitor'; at: number; until?: number }

/** The session's in-flight background tasks as the last Stop or SubagentStop listed them, and when. */
export type BgSnap = { at: number; tasks: { id: string; desc: string; kind: string }[] }

/** A running progress-file job a waiting agent may watch: its slug name, title, percent and parent slug. */
export type Job = { name: string; title: string; pct: number | null; parent: string }

const MONITOR_MAX_MS = 30 * 60_000
const s = (v: unknown) => (typeof v === 'string' ? v : '')

/** One line, no " · " (the row separator), cut to `max` with "…". */
export function oneLine(x: string, max = 120): string {
  const t = x.replace(/\s+·\s+/g, ', ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** A few words for a tool call: its description, a file's name, a pattern, a URL, or a command's first line. */
export function toolWhat(input: Record<string, unknown>): string {
  const base = (p: string) => p.split('/').filter(Boolean).pop() ?? ''
  const what = s(input.description) || base(s(input.file_path)) || base(s(input.notebook_path)) || s(input.pattern) || s(input.url) || s(input.query) || s(input.command).split('\n')[0]!
  return oneLine(what, 60)
}

/** The background task a tool call started, from its input and result, or null. */
export function bgLaunch(tool: string, input: Record<string, unknown>, result: unknown, now: number): BgTask | null {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  if (tool === 'Bash' && s(r.backgroundTaskId)) {
    return { id: s(r.backgroundTaskId), desc: oneLine(s(input.description) || s(input.command).split('\n')[0]!, 80), kind: 'shell', at: now }
  }
  if (tool === 'Monitor' && s(r.taskId)) {
    const ms = r.persistent === true ? 0 : typeof r.timeoutMs === 'number' ? r.timeoutMs : typeof input.timeout_ms === 'number' ? input.timeout_ms : 0
    const t: BgTask = { id: s(r.taskId), desc: oneLine(s(input.description) || s(input.command).split('\n')[0]!, 80), kind: 'monitor', at: now }
    if (ms > 0) t.until = now + Math.min(ms, MONITOR_MAX_MS)
    return t
  }
  return null
}

/** The session's in-flight tasks from a Stop or SubagentStop's `background_tasks`, or null when the event has none. */
export function snapOf(list: unknown, now: number): BgSnap | null {
  if (!Array.isArray(list)) return null
  const tasks = list
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && !!s((t as Record<string, unknown>).id))
    .filter(t => !s(t.status) || /running|pending/.test(s(t.status)))
    .map(t => ({ id: s(t.id), desc: oneLine(s(t.description), 80), kind: s(t.type) }))
  return { at: now, tasks }
}

/** An agent's tasks still running: not past a Monitor's deadline, and listed by the last snapshot unless it began after that. */
export function aliveTasks(bg: readonly BgTask[], snap: BgSnap | null, now: number): BgTask[] {
  return bg.filter(t => !(t.until && now > t.until) && (!snap || t.at > snap.at || snap.tasks.some(x => x.id === t.id)))
}

const WAIT_WORDS = /\b(watcher|watching|watch|monitor|monitoring|wait|waits|waiting|until)\b/gi

/** The running job whose name or title holds every key word of `text` (a plural "s" either way), or null. */
export function watchedJob(text: string, jobs: readonly Job[]): Job | null {
  const ks = keyWords(text.replace(WAIT_WORDS, ' '))
  if (!ks.length) return null
  for (const j of jobs) {
    const ws = new Set(`${j.name} ${j.title}`.toLowerCase().split(/[^a-z0-9]+/))
    if (ks.every(k => ws.has(k) || ws.has(`${k}s`) || (k.endsWith('s') && ws.has(k.slice(0, -1))))) return j
  }
  return null
}

/** "Mac label top-ups 2021-23 (90%)", or "... 90%" inside other brackets. A running job's percent stops at 99, so the row never reads as done. */
export function jobText(j: Job, paren = true): string {
  if (j.pct === null) return j.title || j.name
  const pct = `${Math.min(99, Math.floor(j.pct))}%`
  return `${j.title || j.name} ${paren ? `(${pct})` : pct}`
}

export type WaitFacts = {
  desc: string
  status: string
  /** Its background tasks still running. */
  tasks: readonly BgTask[]
  /** Descriptions of its child agents still live. */
  kids: readonly string[]
  /** Running progress-file jobs. */
  jobs: readonly Job[]
  /** Its own progress file's step. */
  step: string
  lastTool: string
  lastWhat: string
  /** When its last tool call ended (ms), 0 when not known. */
  lastAt: number
  /** When it began to wait (ms), 0 when not known. */
  waitSince: number
}

/**
 * The row segments that say why an agent waits, best source first:
 * 1. its background tasks and child agents still running: `waiting on: <descriptions>`,
 * 2. a running job it watches (its name's key words, or a job whose parent is it): `waiting on: <title> (90%)`,
 * 3. its own progress file's step: left to the row's step, so nothing is added,
 * 4. its last tool call: `last action 4m ago: Bash, check log`.
 * Then `waiting 12m`, how long it has waited. A pending agent reads `not started yet`.
 */
export function waitSegs(w: WaitFacts, now: number): string[] {
  if (w.status === 'pending') return ['not started yet']
  if (w.status !== 'waiting') return []
  const out: string[] = []
  const on = [
    ...w.tasks.map(t => {
      const j = watchedJob(t.desc, w.jobs)
      return `${t.kind === 'monitor' ? 'monitor: ' : ''}${t.desc}${j ? ` (${jobText(j, false)})` : ''}`
    }),
    ...w.kids.map(k => `agent: ${k}`),
  ]
  const own = slug(w.desc)
  const job = on.length ? null : w.jobs.find(j => j.parent && j.parent === own) ?? watchedJob(w.desc, w.jobs)
  if (on.length) out.push(`waiting on: ${oneLine(on.join(', '), 200)}`)
  else if (job) out.push(`waiting on: ${oneLine(jobText(job), 200)}`)
  else if (!w.step && w.lastTool) {
    const when = w.lastAt ? ` ${ago(now - w.lastAt)} ago` : ''
    out.push(`last action${when}: ${w.lastTool}${w.lastWhat ? `, ${oneLine(w.lastWhat, 60)}` : ''}`)
  }
  if (w.waitSince) out.push(`waiting ${ago(now - w.waitSince)}`)
  return out
}

/** Task ids from `ids` that appear in a text (a transcript searched with grep -o -F). */
export function idsIn(text: string, ids: readonly string[]): string[] {
  const found = new Set(text.split('\n').map(l => l.trim()).filter(Boolean))
  return ids.filter(i => found.has(i))
}
