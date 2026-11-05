import type { EngineInterface } from 'claude-code'

import { slug } from './render'
import type { Gains, Goal, GoalArea, GoalLens } from '../types'

// The goal view of the List tab: one anchor goal ("Making the generosity database better"), the areas of it a job
// improves (Organizations, Finances, ...) and the lenses of "better" (lower cost, better quality, faster speed).
// ~/.claude-progress/goal.json holds them per person: {anchor, areas:[{id,name,icon,keywords}], lenses:[{id,name,icon,keywords}]}.
// The panel writes the defaults once when the file is missing, and never overwrites it.
// A job names its area with `area` and what it made better with `gains` ({cost, quality, speed}) in its progress file
// or progress_report. With no `area`, the area comes from keywords in its title, why and impact, else Other.
// With no `gains`, a finished job's lens comes from its impact wording (cost words, then speed words, else quality),
// marked as inferred.

export const GOAL_REL = '.claude-progress/goal.json'

export const DEFAULT_GOAL: Goal = {
  anchor: 'Making the generosity database better',
  areas: [
    { id: 'organizations', name: 'Organizations', icon: '🏢', keywords: ['organization', 'duplicate', 'dedupe', 'merge', 'merged', 'ein', 'eins', 'ntee', 'pub78', 'who exists', 'org once', 'nonprofit list'] },
    { id: 'finances', name: 'Finances', icon: '💵', keywords: ['finance', 'financial', 'return', 'returns', '990', 'revenue', 'expense', 'assets', 'trend', 'trends', 'flag', 'flags', 'flagged', 'amended', 'filing', 'filings'] },
    { id: 'boards', name: 'Boards & people', icon: '👥', keywords: ['board', 'boards', 'people', 'person', 'officer', 'member', 'seat', 'seats', 'director', 'trustee', 'compensation', 'interlock'] },
    { id: 'grants', name: 'Grants', icon: '🎁', keywords: ['grant', 'grants', 'funder', 'funders', 'funds', 'schedule i', 'recipient', 'grantee'] },
    { id: 'places', name: 'Places', icon: '📍', keywords: ['place', 'places', 'where', 'serve', 'serves', 'location', 'county', 'city', 'geo', 'address', 'map', 'service area'] },
    { id: 'causes', name: 'Causes', icon: '💚', keywords: ['cause', 'causes', 'label', 'labels', 'labeling', 'classify', 'classifier', 'health care', 'healthcare', 'arts', 'sdg', 'jev', 'lightgbm', 'workforce', 'environment'] },
    { id: 'answers', name: 'Answer quality', icon: '💬', keywords: ['nombot', 'answer', 'answers', 'eval', 'evals', 'search', 'chat'] },
    { id: 'tools', name: 'Tools', icon: '🔧', keywords: ['plugin', 'panel', 'status line', 'topology', 'infra', 'setup', 'tools', 'install', 'venv', 'helper', 'machine'] },
  ],
  lenses: [
    { id: 'cost', name: 'cost', icon: '💲', keywords: ['$', 'cost', 'costs', 'cheaper', 'cheap', 'save', 'saved', 'saves', 'spend', 'free', 'budget'] },
    { id: 'quality', name: 'quality', icon: '💎', keywords: [] },
    { id: 'speed', name: 'speed', icon: '🚀', keywords: ['faster', 'quicker', 'sooner', 'speed', 'hours', 'hour', 'minutes', 'mins', 'seconds'] },
  ],
}

/** Where a job's area did not match any: its own name, else Other. */
export const OTHER: GoalArea = { id: 'other', name: 'Other', icon: '📦', keywords: [] }
export const LENS_IDS = ['cost', 'quality', 'speed'] as const

const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : '')
const words = (x: unknown) => (Array.isArray(x) ? x.map(str).filter(Boolean).map(w => w.toLowerCase()) : [])

/** goal.json as a goal. A missing or bad part falls back to the default's. */
export function parseGoal(text: string): Goal {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(text) as Record<string, unknown> } catch { return DEFAULT_GOAL }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_GOAL
  const areas = (Array.isArray(raw.areas) ? raw.areas : []).flatMap((a): GoalArea[] => {
    const r = (a ?? {}) as Record<string, unknown>
    const name = str(r.name)
    const id = slug(str(r.id) || name)
    return id && name ? [{ id, name, icon: str(r.icon) || '•', keywords: words(r.keywords) }] : []
  })
  const lenses = DEFAULT_GOAL.lenses.map((d): GoalLens => {
    const r = ((Array.isArray(raw.lenses) ? raw.lenses : []) as Record<string, unknown>[]).find(x => x && str(x.id).toLowerCase() === d.id)
    return r ? { id: d.id, name: str(r.name) || d.name, icon: str(r.icon) || d.icon, keywords: Array.isArray(r.keywords) ? words(r.keywords) : d.keywords } : d
  })
  return { anchor: str(raw.anchor) || DEFAULT_GOAL.anchor, areas: areas.length ? areas : DEFAULT_GOAL.areas, lenses }
}

/** Reads goal.json, writing the defaults first when it is missing. Never overwrites a file that is there. */
export async function readGoal($: EngineInterface, h: string): Promise<Goal> {
  const path = `${h}/${GOAL_REL}`
  try { return parseGoal(String(await $.fs.read(path))) } catch { /* missing */ }
  if (!(await $.fs.exists(path).catch(() => true))) await $.fs.write(path, `${JSON.stringify(DEFAULT_GOAL, null, 2)}\n`).catch(() => undefined)
  return DEFAULT_GOAL
}

/** Whether `kw` is a word in `text` (both lower case), or its plural ("person" finds "persons", not "personal"). A keyword that starts with a sign ("$") matches anywhere. */
function hits(text: string, kw: string): boolean {
  if (!/^[a-z0-9]/.test(kw)) return text.includes(kw)
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}(s|es)?(?![a-z0-9])`).test(text)
}

export type AreaText = { area?: string; title?: string; why?: string; impact?: string; step?: string }

/**
 * A job's area. A named `area` matches an area by id or name (any case, "Boards" finds "Boards & people"); a name that
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
    return { id: k, name: named, icon: '•', keywords: [] }
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

/** One lens a job made better: its icon and name, the line when the job said it, and whether it was inferred. */
export type LensTag = { id: GoalLens['id']; icon: string; name: string; text: string; inferred: boolean }

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
  if (g) return goal.lenses.filter(l => g[l.id]).map(l => ({ id: l.id, icon: l.icon, name: l.name, text: g[l.id]!, inferred: false }))
  if (!impact.trim()) return []
  const id = inferLens(goal, impact)
  const l = goal.lenses.find(x => x.id === id)!
  return [{ id, icon: l.icon, name: l.name, text: '', inferred: true }]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The anchor's progress line: "4 improvements done today · 3 in progress · 7 queued", the parts that are not zero. */
export function anchorSummary(done: number, live: number, queued: number): string {
  const parts = [
    done ? `${plural(done, 'improvement')} done today` : '',
    live ? `${live} in progress` : '',
    queued ? `${queued} queued` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing moving yet today'
}

/** Today's count per lens, in the goal's order: "today: 💎 5 quality · 🚀 2 speed · 💲 1 cost". Empty with none. */
export function lensSummary(goal: Goal, tags: LensTag[][]): string {
  const n = (id: string) => tags.filter(t => t.some(x => x.id === id)).length
  const order = [...goal.lenses].sort((a, b) => n(b.id) - n(a.id))
  const parts = order.filter(l => n(l.id)).map(l => `${l.icon} ${n(l.id)} ${l.name}`)
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
 * A title without the machine in front, for the plain view: "Hunty grants linked to own filer" -> "Grants linked to own
 * filer", "hunty: x" -> "X". `hosts` are the known machine names (lower case). Cut at " · ".
 */
export function plainTitle(title: string, hosts: string[]): string {
  let t = title.split(' · ')[0]!.trim()
  const m = /^([A-Za-z0-9_.-]+)(:\s*|\s+)(.+)$/.exec(t)
  if (m && hosts.includes(m[1]!.toLowerCase())) t = m[3]!.trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title
}
