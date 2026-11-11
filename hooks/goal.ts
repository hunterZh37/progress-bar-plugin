import type { EngineInterface } from 'claude-code'

import { slug } from './render'
import type { Gains, Goal, GoalArea, GoalLens } from '../types'

// The goal view of the List tab: one anchor goal ("Make checkout faster"), the areas of it a job improves
// (Payments, Search, ...) and the lenses of "better" (lower cost, better quality, faster speed).
// Each project has its own: ~/.claude-progress/goals/<slug>.json, the slug as for its to-do list (desktop-myapp):
// {anchor, areas:[{id,name,tag,keywords}], lenses:[{id,name,keywords}]}. An `icon` from older files is read and ignored:
// the panel shows words, never emoji. A project with no file shows its folder name and no areas; nothing is written.
// ~/.claude-progress/goal.json is the old one-goal-for-everything file: only a session with no folder still reads it,
// so one project's goal no longer heads every project. It is never written.
// A job names its area with `area` and what it made better with `gains` ({cost, quality, speed}) in its progress file
// or progress_report. With no `area`, the area comes from keywords in its title, why and impact, else Other.
// With no `gains`, a finished job's lens comes from its impact wording (cost words, then speed words, else quality),
// marked as inferred.

export const GOAL_REL = '.claude-progress/goal.json'
export const GOALS_DIR_REL = '.claude-progress/goals'

/** The lenses of "better", the same for every goal. A goal file can rename them or change their keywords. */
const LENSES: GoalLens[] = [
  { id: 'cost', name: 'cost', keywords: ['$', 'cost', 'costs', 'cheaper', 'cheap', 'save', 'saved', 'saves', 'spend', 'free', 'budget'] },
  { id: 'quality', name: 'quality', keywords: [] },
  { id: 'speed', name: 'speed', keywords: ['faster', 'quicker', 'sooner', 'speed', 'hours', 'hour', 'minutes', 'mins', 'seconds'] },
]

/** The goal with no goal file: a neutral anchor, no areas (every job is Other), the usual lenses. Never written. */
export const DEFAULT_GOAL: Goal = { anchor: 'This project', areas: [], lenses: LENSES }

/** Where a job's area did not match any: its own name, else Other. */
export const OTHER: GoalArea = { id: 'other', name: 'Other', tag: 'Other', keywords: [] }
export const LENS_IDS = ['cost', 'quality', 'speed'] as const

const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : '')
const words = (x: unknown) => (Array.isArray(x) ? x.map(str).filter(Boolean).map(w => w.toLowerCase()) : [])

/** An area's short tag when goal.json names none: the first word of its name, at most 14 letters ("Search & filters" -> "Search"). */
export const tagOf = (name: string) => (name.split(/[^A-Za-z0-9]+/).find(Boolean) ?? name).slice(0, 14)

/** A project with no goal file: its folder name as the anchor, no areas (every job is Other), the usual lenses. */
export const projectGoal = (name: string): Goal => ({ anchor: name || DEFAULT_GOAL.anchor, areas: [], lenses: LENSES })

/** A goal file as a goal. A missing or bad part falls back to `fallback`'s (the defaults unless given). */
export function parseGoal(text: string, fallback: Goal = DEFAULT_GOAL): Goal {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(text) as Record<string, unknown> } catch { return fallback }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const areas = (Array.isArray(raw.areas) ? raw.areas : []).flatMap((a): GoalArea[] => {
    const r = (a ?? {}) as Record<string, unknown>
    const name = str(r.name)
    const id = slug(str(r.id) || name)
    return id && name ? [{ id, name, tag: str(r.tag) || tagOf(name), keywords: words(r.keywords) }] : []
  })
  const lenses = LENSES.map((d): GoalLens => {
    const r = ((Array.isArray(raw.lenses) ? raw.lenses : []) as Record<string, unknown>[]).find(x => x && str(x.id).toLowerCase() === d.id)
    return r ? { id: d.id, name: str(r.name) || d.name, keywords: Array.isArray(r.keywords) ? words(r.keywords) : d.keywords } : d
  })
  return { anchor: str(raw.anchor) || fallback.anchor, areas: areas.length ? areas : fallback.areas, lenses }
}

/** A folder's last part, for the anchor of a project with no goal file: /Users/a/Desktop/agentic-scheduling -> agentic-scheduling. */
export const folderName = (root: string) => root.replace(/\/+$/, '').split('/').pop() ?? ''

/**
 * The session's goal. In a project (`slug`), goals/<slug>.json, else the folder name and no areas; never written.
 * With no project (a script run without a session), the old goal.json when it is there, else the neutral default.
 */
export async function readGoal($: EngineInterface, h: string, project?: { slug: string; root: string }): Promise<Goal> {
  if (project?.slug && project.slug !== 'todo.txt') {
    const fallback = projectGoal(folderName(project.root))
    // A projects.txt value can be any path ("../x.txt"); only a plain slug names a goal file.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(project.slug)) return fallback
    try { return parseGoal(String(await $.fs.read(`${h}/${GOALS_DIR_REL}/${project.slug}.json`)), fallback) } catch { return fallback }
  }
  const path = `${h}/${GOAL_REL}`
  try { return parseGoal(String(await $.fs.read(path))) } catch { return DEFAULT_GOAL }
}

/** Whether `kw` is a word in `text` (both lower case), or its plural ("person" finds "persons", not "personal"). A keyword that starts with a sign ("$") matches anywhere. */
function hits(text: string, kw: string): boolean {
  if (!/^[a-z0-9]/.test(kw)) return text.includes(kw)
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}(s|es)?(?![a-z0-9])`).test(text)
}

export type AreaText = { area?: string; title?: string; why?: string; impact?: string; step?: string }

/**
 * A job's area. A named `area` matches an area by id or name (any case, "Search" finds "Search & filters"); a name that
 * matches none is an area of its own. Else keywords: each keyword found counts 2 in the title, 1 in the why, impact or
 * step, and the highest score wins (ties go to the area listed first). Nothing found: Other.
 */
export function areaOf(goal: Goal, t: AreaText): GoalArea {
  const named = str(t.area)
  if (named) {
    const k = slug(named)
    const hit = goal.areas.find(a => a.id === k || slug(a.name) === k)
      ?? goal.areas.find(a => slug(a.name).startsWith(k) || k.startsWith(a.id))
    if (hit) return hit
    if (k === OTHER.id) return OTHER
    return { id: k, name: named, tag: tagOf(named), keywords: [] }
  }
  const title = str(t.title).toLowerCase()
  const rest = [t.why, t.impact, t.step].map(x => str(x).toLowerCase()).join(' \n ')
  let best: GoalArea = OTHER
  let top = 0
  for (const a of goal.areas) {
    const score = a.keywords.reduce((n, kw) => n + (hits(title, kw) ? 2 : 0) + (hits(rest, kw) ? 1 : 0), 0)
    if (score > top) { top = score; best = a }
  }
  return best
}

/** A progress file's or record's `gains`: the cost, quality and speed lines it has, trimmed. Undefined when none. */
export function pickGains(v: unknown): Gains | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Gains = {}
  for (const k of LENS_IDS) {
    const s = str((v as Record<string, unknown>)[k])
    if (s) out[k] = s.length > 160 ? `${s.slice(0, 159)}…` : s
  }
  return Object.keys(out).length ? out : undefined
}

/** One lens a job made better: its name, the line when the job said it, and whether it was inferred. */
export type LensTag = { id: GoalLens['id']; name: string; text: string; inferred: boolean }

/** The lens an impact's wording points to: cost words first, then speed words, else quality. */
export function inferLens(goal: Goal, impact: string): GoalLens['id'] {
  const t = impact.toLowerCase()
  for (const id of ['cost', 'speed'] as const) {
    const l = goal.lenses.find(x => x.id === id)
    if (l && l.keywords.some(kw => hits(t, kw))) return id
    // "in 7h instead of 12h", "3m per batch": a time is speed.
    // Units in lower case only, so "1.65M" (millions) is not minutes.
    if (id === 'speed' && /(^|[^A-Za-z0-9$])\d+(\.\d+)?\s?(h|m|s|min)\b/.test(impact)) return id
  }
  return 'quality'
}

/**
 * The lens tags for a job, in the goal's lens order: the ones its `gains` names, else (for a job with an impact) the
 * one its impact's wording points to, marked inferred. None when it says nothing.
 */
export function lensTags(goal: Goal, gains: Gains | undefined, impact = ''): LensTag[] {
  const g = pickGains(gains)
  if (g) return goal.lenses.filter(l => g[l.id]).map(l => ({ id: l.id, name: l.name, text: g[l.id]!, inferred: false }))
  if (!impact.trim()) return []
  const id = inferLens(goal, impact)
  const l = goal.lenses.find(x => x.id === id)!
  return [{ id, name: l.name, text: '', inferred: true }]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The anchor, one line: "Make checkout faster · 6 done today · 3 running", the counts that are not zero. */
export function anchorLine(anchor: string, done: number, running: number): string {
  return [anchor, done ? `${done} done today` : '', running ? `${running} running` : ''].filter(Boolean).join(' · ')
}

/** The anchor's progress line: "4 improvements done today · 3 in progress · 7 queued", the parts that are not zero. */
export function anchorSummary(done: number, live: number, queued: number): string {
  const parts = [
    done ? `${plural(done, 'improvement')} done today` : '',
    live ? `${live} in progress` : '',
    queued ? `${queued} queued` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing moving yet today'
}

/** Today's count per lens, most first: "today: 5 quality · 2 speed · 1 cost". Empty with none. */
export function lensSummary(goal: Goal, tags: LensTag[][]): string {
  const n = (id: string) => tags.filter(t => t.some(x => x.id === id)).length
  const order = [...goal.lenses].sort((a, b) => n(b.id) - n(a.id))
  const parts = order.filter(l => n(l.id)).map(l => `${n(l.id)} ${l.name}`)
  return parts.length ? `today: ${parts.join(' · ')}` : ''
}

/** An area header's plain words: "1 improving, 2 done today, 3 queued", the parts that are not zero. */
export function areaSummary(c: { live: number; done: number; queued: number }): string {
  return [c.live ? `${c.live} improving` : '', c.done ? `${c.done} done today` : '', c.queued ? `${c.queued} queued` : ''].filter(Boolean).join(', ')
}

/**
 * Items grouped under their areas, in the goal's area order, then any area named only by a job, then Other.
 * Areas with no items are left out.
 */
export function groupByArea<T extends { area: GoalArea }>(goal: Goal, items: T[]): { area: GoalArea; items: T[] }[] {
  const order = [...goal.areas.map(a => a.id)]
  for (const it of items) if (!order.includes(it.area.id) && it.area.id !== OTHER.id) order.push(it.area.id)
  order.push(OTHER.id)
  return order.flatMap(id => {
    const mine = items.filter(it => it.area.id === id)
    return mine.length ? [{ area: mine[0]!.area, items: mine }] : []
  })
}

/**
 * A title without the machine in front, for the plain view: "Server-1 nightly import" -> "Nightly
 * import", "server-1: x" -> "X". `hosts` are the known machine names (lower case). Cut at " · ".
 */
export function plainTitle(title: string, hosts: string[]): string {
  let t = title.split(' · ')[0]!.trim()
  const m = /^([A-Za-z0-9_.-]+)(:\s*|\s+)(.+)$/.exec(t)
  if (m && hosts.includes(m[1]!.toLowerCase())) t = m[3]!.trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title
}
