import type { EngineInterface } from 'claude-code'
import type { Gains } from '../types'

import { impactLines, saveDone } from './done'
import { pickGains } from './goal'
import { MAX_STEPS, STEP_STATES, cleanSteps, serverOf, slug } from './render'
import type { StoredStep } from './render'
import { sessionKeyOf } from './route'

// Progress files written for Claude: the progress_report tool, the session's own task list (TodoWrite, TaskCreate,
// TaskUpdate) mirrored as one bar, and long or background Bash commands as a working row. Each file carries the
// session id and folder, so it shows in this session's Status panel (route.ts).

const DIR_REL = '.claude-progress'
// Data files in ~/.claude-progress that are never jobs, so no report may take their names.
const RESERVED = new Set(['inbox', 'actions', 'max-usage', 'channels', 'topology', 'goal'])

export const PROGRESS_TOOL = {
  name: 'progress_report',
  description: 'Show a progress bar for a job in this session\'s Status panel and status line. Call it when a job with several steps starts and after each step, with done and total. Pass finished: true when the job is over to remove the bar, with impact: what it changed. It writes ~/.claude-progress/<slug>.json with this session\'s id and folder filled in, so the bar shows in this session on any machine. For a subagent you brief, give it the slug to report under (the slug of its description) so the bar sits on its line.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Plain words for the improvement the job makes, the outcome not the mechanism. Example: Every board member counted, not just 25. Shown as the row\'s name in place of the agent\'s description. A new one replaces the stored title, and leaving it out keeps it. A new title with done 0 starts a new task on the row: its time, step and checklist start over.' },
      label: { type: 'string', description: 'Same as title (title wins when both are given).' },
      done: { type: 'number', description: 'Steps finished so far.' },
      total: { type: 'number', description: 'Steps in all, above 0.' },
      step: { type: 'string', description: 'A few words on the current step.' },
      why: { type: 'string', description: 'What the job unlocks for the person, in plain words. Shown dim under its row.' },
      parent: { type: 'string', description: 'Optional slug of the bigger job this is part of.' },
      slug: { type: 'string', description: 'Optional file name. Default: the slug of the title.' },
      reads: { type: 'string', description: 'Optional. What the job reads, a few words. Example: the orders table. Shown on the Topology tab.' },
      writes: { type: 'string', description: 'Optional. What the job writes, a few words. Example: Postgres on server-1. Shown on the Topology tab.' },
      impact: { type: 'string', description: 'How the finished job made things better: what the data or product now has or gets right, with the key number, one to three short lines (newlines split them). No commit ids or file names. Example: 1.65M more board seats, so board links and people search see whole boards. Shown when its DONE row is opened.' },
      area: { type: 'string', description: 'Which part of the goal (~/.claude-progress/goals/<project>.json areas) the job improves, by name. Example: Search. Set it whenever the project goal has areas, so the Status panel shows that area under the title of the job.' },
      gains: { type: 'object', description: 'What the job makes better, by lens: any of cost, quality, speed, each a short plain line with a number when possible. Example: {"quality": "1.65M more board seats counted", "speed": "labels in 7h instead of 12h"}. State the ones that apply.', properties: { cost: { type: 'string' }, quality: { type: 'string' }, speed: { type: 'string' } } },
      expect_minutes: { type: 'number', description: 'Optional. How many minutes the current step is expected to stay quiet (no new done count). Example: 90 for a remote job that runs about 1.5 h. The bar shows no stuck warning until then. It applies to this step only: the next report without it clears it.' },
      heartbeat: { type: 'string', description: 'Optional. A local file the job keeps writing, such as its log (~/ allowed). Each write counts as a sign of life, so a quiet step is not marked stuck while the file changes.' },
      steps: { type: 'array', items: { type: 'string' }, description: 'Optional. The job\'s steps in order, a few words each, up to 50. Pass it on the first call when the steps are known. The row shows them as a checklist: done, current, to do, from done. Later calls without steps keep the list.' },
      step_states: { type: 'array', items: { type: 'string', enum: ['done', 'active', 'todo', 'skipped', 'failed'] }, description: 'Optional. A state per step, same order as steps: done, active, todo, skipped or failed. Use it only to mark a step skipped or failed, or out of order. Steps without one follow done.' },
      finished: { type: 'boolean', description: 'true removes the bar once the job is over. Pass impact with it.' },
    },
  },
}

export type ReportInput = { title: string; label?: string; done?: number; total?: number; step?: string; why?: string; parent?: string; slug?: string; reads?: string; writes?: string; impact?: string; area?: string; gains?: Gains; finished?: boolean; expectMinutes?: number; heartbeat?: string; steps?: unknown; stepStates?: unknown }

/** The title a report gives: `title`, else its alias `label`, trimmed. Empty when neither is given. */
export function titleOf(i: Pick<ReportInput, 'title' | 'label'>): string {
  return (typeof i.title === 'string' ? i.title.trim() : '') || (typeof i.label === 'string' ? i.label.trim() : '')
}

/**
 * Whether a report starts a new task on an existing row: it names a title unlike the stored one while nothing is done
 * yet (done 0 or not given). Then the row's start time, step and checklist start over.
 */
export function isNewTask(i: Pick<ReportInput, 'title' | 'label' | 'done'>, prev: Record<string, unknown>): boolean {
  const t = titleOf(i)
  if (!t || !Object.keys(prev).length) return false
  const before = typeof prev.title === 'string' ? prev.title.trim() : ''
  return t !== before && (i.done ?? 0) === 0
}

/** The longest quiet window a report may announce: one day. */
export const MAX_EXPECT_MIN = 24 * 60
export type Owner = { session: string; cwd: string }

/**
 * The checklist a report stores: its `steps` (else the file's, `prev`), with `stepStates` set by index. A step with a
 * state given is `{name, state}`, the rest plain names whose state follows `done`. Null when there is none.
 */
export function reportSteps(i: Pick<ReportInput, 'steps' | 'stepStates'>, prev?: unknown): StoredStep[] | null {
  const base = cleanSteps(i.steps) ?? cleanSteps(prev)
  if (!base?.length) return null
  const states = Array.isArray(i.stepStates) ? i.stepStates : null
  if (!states) return base
  return base.map((x, j) => {
    const name = typeof x === 'string' ? x : x.name
    const note = typeof x === 'string' ? undefined : x.note
    const st = states[j]
    const state = typeof st === 'string' && (STEP_STATES as readonly string[]).includes(st) ? st as (typeof STEP_STATES)[number] : typeof x === 'string' ? undefined : x.state
    return state || note ? { name, ...(state ? { state } : {}), ...(note ? { note } : {}) } : name
  })
}

/**
 * The progress file's JSON for a report. `startedAt` comes from the file it replaces, else now. `expectMinutes` becomes
 * `quietUntil` (epoch ms, from `now`): no stuck mark before then. `prevSteps`: the replaced file's `steps`, kept when
 * the report names none.
 */
export function reportBody(i: ReportInput, owner: Owner, startedAt: number, now = startedAt, prevSteps?: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (typeof i.done === 'number' && typeof i.total === 'number' && i.total > 0) {
    out.done = Math.max(0, Math.min(i.done, i.total))
    out.total = i.total
  }
  out.step = (i.step ?? '').trim() || (out.done === undefined ? 'working' : '')
  out.startedAt = startedAt
  out.title = titleOf(i)
  if (i.why?.trim()) out.why = i.why.trim()
  if (i.parent?.trim()) out.parent = slug(i.parent)
  if (i.reads?.trim()) out.reads = i.reads.trim()
  if (i.writes?.trim()) out.writes = i.writes.trim()
  const impact = impactLines(i.impact)
  if (impact.length) out.impact = impact.join('\n')
  if (i.area?.trim()) out.area = i.area.trim()
  const gains = pickGains(i.gains)
  if (gains) out.gains = gains
  if (typeof i.expectMinutes === 'number' && Number.isFinite(i.expectMinutes) && i.expectMinutes > 0) out.quietUntil = Math.round(now + Math.min(i.expectMinutes, MAX_EXPECT_MIN) * 60_000)
  if (i.heartbeat?.trim()) out.heartbeat = i.heartbeat.trim()
  const steps = reportSteps(i, prevSteps)
  if (steps) out.steps = steps
  if (owner.session) out.session = owner.session
  if (owner.cwd) out.cwd = owner.cwd
  return out
}

/** This session's id and folder. */
export async function ownerOf($: EngineInterface): Promise<Owner> {
  let session = ''
  let cwd = ''
  try { session = await $.session.id() } catch { session = '' }
  try { cwd = await $.session.cwd() } catch { cwd = '' }
  return { session, cwd }
}

async function prevOf($: EngineInterface, path: string): Promise<Record<string, unknown>> {
  try {
    const p = JSON.parse(String(await $.fs.read(path))) as unknown
    if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
  } catch { /* new file */ }
  return {}
}

/** What the model is told about a `steps` it passed that was cut or could not be used. */
export function stepsNote(steps: unknown): string {
  if (steps === undefined || steps === null) return ''
  if (!Array.isArray(steps)) return ' steps must be a list of step names, so it was ignored.'
  if (steps.length > MAX_STEPS) return ` Only the first ${MAX_STEPS} steps were kept.`
  return ''
}

/** Writes (or with `finished`, removes) one progress file. Returns what the model reads. */
export async function writeReport($: EngineInterface, h: string, i: ReportInput, owner?: Owner): Promise<string> {
  if (!h) return 'No home folder found ($HOME is unset).'
  const given = titleOf(i)
  const name = slug(i.slug || given)
  if (!name) return 'progress_report needs a title or a slug.'
  if (RESERVED.has(name)) return `"${name}" is a data file name. Pick another slug.`
  const path = `${h}/${DIR_REL}/${name}.json`
  if (i.finished) {
    // The done record keeps what the job changed after its file is gone.
    let prev: Record<string, unknown> = {}
    try { prev = JSON.parse(String(await $.fs.read(path))) as Record<string, unknown> } catch { prev = {} }
    const o = owner ?? await ownerOf($)
    const impact = impactLines(i.impact).length ? impactLines(i.impact) : impactLines(prev.impact)
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
    await saveDone($, h, {
      slug: name, title: given || str(prev.title) || '', why: i.why?.trim() || str(prev.why), impact, step: str(prev.step),
      area: i.area?.trim() || str(prev.area), gains: pickGains(i.gains) ?? pickGains(prev.gains),
      started: typeof prev.startedAt === 'number' ? prev.startedAt : undefined, finished: await $.clock.now(), session: o.session || undefined, kind: 'job',
    }).catch(() => undefined)
    await $.process.run(['rm', '-f', path]).catch(() => undefined)
    return `Removed the bar ${name}.${impact.length ? '' : ' Pass impact (what it changed) next time so its DONE row says so.'}`
  }
  const now = await $.clock.now()
  const prev = await prevOf($, path)
  // A title left out keeps the stored one. A new title with nothing done is a new task: the clock and checklist restart.
  const fresh = isNewTask(i, prev)
  const title = given || (typeof prev.title === 'string' ? prev.title.trim() : '')
  const started = !fresh && typeof prev.startedAt === 'number' ? prev.startedAt : now
  const body = reportBody({ ...i, title, label: undefined }, owner ?? await ownerOf($), started, now, fresh ? undefined : prev.steps)
  await $.fs.write(path, JSON.stringify(body))
  const pct = typeof body.done === 'number' ? ` ${body.done}/${body.total}` : ''
  const quiet = typeof body.quietUntil === 'number' ? ` No stuck warning for ${Math.round(((body.quietUntil as number) - now) / 60_000)} min.` : ''
  return `Bar ${name}${pct} shows in this session's Status panel.${quiet}${stepsNote(i.steps)} Call again after each step, and with finished: true at the end.`
}

// ---- The session's own task list as one bar ----

export type Task = { content: string; status: string; activeForm?: string }

/** The bar for a task list: done/total, the in-progress item as title and step. Null when empty or all done. */
export function taskProgress(tasks: readonly Task[]): Required<Pick<ReportInput, 'done' | 'total' | 'step' | 'title'>> | null {
  const live = tasks.filter(t => t.status !== 'deleted')
  if (!live.length) return null
  const done = live.filter(t => t.status === 'completed').length
  if (done === live.length) return null
  const cur = live.find(t => t.status === 'in_progress') ?? live.find(t => t.status !== 'completed')!
  return { done, total: live.length, title: cur.content, step: cur.activeForm || cur.content }
}

/** The task bar's file name: the project folder's name, then this session's key, so two sessions never share one. */
export function taskSlug(cwd: string, session: string): string {
  const base = slug(cwd.replace(/\/+$/, '').split('/').pop() ?? '') || 'session'
  return `${base}-tasks-${sessionKeyOf(session).slice(0, 4) || 'main'}`
}

// TaskCreate / TaskUpdate keep a task list by id; TodoWrite sends the whole list each time.
const tasks = new Map<string, Task>()

/** Writes the session's task bar, or removes it when the list is empty or all done. */
export async function mirrorTasks($: EngineInterface, h: string, list: readonly Task[]) {
  if (!h) return
  const owner = await ownerOf($)
  const name = taskSlug(owner.cwd, owner.session)
  const p = taskProgress(list)
  if (!p) {
    await $.process.run(['rm', '-f', `${h}/${DIR_REL}/${name}.json`]).catch(() => undefined)
    return
  }
  await writeReport($, h, { ...p, slug: name }, owner)
}

/** TaskCreate's result names the new task's id. */
export function taskCreated(input: { subject?: unknown; activeForm?: unknown }, result: unknown) {
  const id = (result as { task?: { id?: unknown } } | undefined)?.task?.id
  if (typeof id !== 'string' || typeof input.subject !== 'string') return
  tasks.set(id, { content: input.subject, status: 'pending', activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined })
}

/** TaskUpdate changes one task's status, subject or activeForm. "deleted" drops it. */
export function taskUpdated(input: { taskId?: unknown; status?: unknown; subject?: unknown; activeForm?: unknown }) {
  if (typeof input.taskId !== 'string') return
  const t = tasks.get(input.taskId) ?? { content: typeof input.subject === 'string' ? input.subject : `task ${input.taskId}`, status: 'pending' }
  if (input.status === 'deleted') { tasks.delete(input.taskId); return }
  if (typeof input.status === 'string') t.status = input.status
  if (typeof input.subject === 'string') t.content = input.subject
  if (typeof input.activeForm === 'string') t.activeForm = input.activeForm
  tasks.set(input.taskId, t)
}

export const taskList = (): Task[] => [...tasks.values()]

// ---- Long and background Bash commands as a working row ----

export const LONG_BASH_MS = 60_000

/** Files of shell commands still running, by path, rewritten each poll so they stay fresh. */
export const liveShells = new Map<string, { body: string; taskId?: string }>()

export function shellSlug(description: string, command: string): string {
  return `shell-${slug(description || command).slice(0, 40).replace(/-+$/, '') || 'command'}`
}

/** Writes a working row for a shell command. Returns its path. */
export async function startShell($: EngineInterface, h: string, description: string, command: string, taskId?: string): Promise<string> {
  const owner = await ownerOf($)
  const name = shellSlug(description, command)
  const path = `${h}/${DIR_REL}/${name}.json`
  // A background server (npm run dev, uvicorn...) stays up by design: its step "serving[ :port]" makes it a server row, never stuck.
  const server = taskId ? serverOf(command, description) : null
  const step = server !== null ? `serving${server ? ` ${server}` : ''}` : taskId ? 'running in the background' : 'running'
  // A background shell keeps its command and task id, so the panel's [x] can stop or pause exactly that shell.
  const body = JSON.stringify({ ...reportBody({ title: description || command.slice(0, 60), step }, owner, await $.clock.now()), ...(taskId ? { command, taskId } : {}) })
  liveShells.set(path, { body, taskId })
  await $.fs.write(path, body).catch(() => undefined)
  return path
}

export async function endShell($: EngineInterface, path: string) {
  liveShells.delete(path)
  await $.process.run(['rm', '-f', path]).catch(() => undefined)
}

/** Keeps running shells' files fresh. */
export async function touchShells($: EngineInterface) {
  for (const [path, s] of liveShells) await $.fs.write(path, s.body).catch(() => undefined)
}

/** The task ids of background shells still shown as working rows. */
export const backgroundShellIds = () => [...liveShells.values()].map(s => s.taskId).filter((t): t is string => !!t)

/** Ends the rows of background shells whose task ids are in `done` (finished, failed or stopped). */
export async function endShellsFor($: EngineInterface, done: ReadonlySet<string>) {
  for (const [path, s] of [...liveShells]) if (s.taskId && done.has(s.taskId)) await endShell($, path)
}

/** Task ids the session transcript reports as over: `<task-id>X</task-id> ... <status>completed|failed|killed|stopped`. */
export function finishedTaskIds(text: string, ids: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const id of ids) {
    const re = new RegExp(`<task-id>${id.replace(/[^A-Za-z0-9_-]/g, '')}</task-id>[\\s\\S]{0,600}?<status>(completed|failed|killed|stopped|error)`, 'i')
    if (re.test(text)) out.add(id)
  }
  return out
}

/** At a Stop: background shells no longer listed as running are over. */
export async function endBackground($: EngineInterface, running: readonly { id: string; status?: string }[]) {
  const ids = new Set(running.filter(t => !t.status || /running|pending/.test(t.status)).map(t => t.id))
  for (const [path, s] of [...liveShells]) if (s.taskId && !ids.has(s.taskId)) await endShell($, path)
}
