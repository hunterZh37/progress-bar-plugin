import type { EngineInterface } from 'claude-code'

import { impactLines, saveDone } from './done'
import { slug } from './render'
import { sessionKeyOf } from './route'

// Progress files written for Claude: the progress_report tool, the session's own task list (TodoWrite, TaskCreate,
// TaskUpdate) mirrored as one bar, and long or background Bash commands as a working row. Each file carries the
// session id and folder, so it shows in this session's Status panel (route.ts).

const DIR_REL = '.claude-progress'
// Data files in ~/.claude-progress that are never jobs, so no report may take their names.
const RESERVED = new Set(['inbox', 'actions', 'max-usage', 'channels'])

export const PROGRESS_TOOL = {
  name: 'progress_report',
  description: 'Show a progress bar for a job in this session\'s Status panel and status line. Call it when a job with several steps starts and after each step, with done and total. Pass finished: true when the job is over to remove the bar, with impact: what it changed. It writes ~/.claude-progress/<slug>.json with this session\'s id and folder filled in, so the bar shows in this session on any machine. For a subagent you brief, give it the slug to report under (the slug of its description) so the bar sits on its line.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Plain words for what the job is. Example: Login fix, tests and deploy.' },
      done: { type: 'number', description: 'Steps finished so far.' },
      total: { type: 'number', description: 'Steps in all, above 0.' },
      step: { type: 'string', description: 'A few words on the current step.' },
      why: { type: 'string', description: 'What the job unlocks for the person. Shown as "unlocks: ...".' },
      parent: { type: 'string', description: 'Optional slug of the bigger job this is part of.' },
      slug: { type: 'string', description: 'Optional file name. Default: the slug of the title.' },
      impact: { type: 'string', description: 'What the finished job changed and why it matters, one to three short lines (newlines split them). Example: Board links rebuilt: 1.29M pairs, 109K split people merged. Shown when its DONE row is opened.' },
      finished: { type: 'boolean', description: 'true removes the bar once the job is over. Pass impact with it.' },
    },
    required: ['title'],
  },
}

export type ReportInput = { title: string; done?: number; total?: number; step?: string; why?: string; parent?: string; slug?: string; impact?: string; finished?: boolean }
export type Owner = { session: string; cwd: string }

/** The progress file's JSON for a report. `startedAt` comes from the file it replaces, else now. */
export function reportBody(i: ReportInput, owner: Owner, startedAt: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (typeof i.done === 'number' && typeof i.total === 'number' && i.total > 0) {
    out.done = Math.max(0, Math.min(i.done, i.total))
    out.total = i.total
  }
  out.step = (i.step ?? '').trim() || (out.done === undefined ? 'working' : '')
  out.startedAt = startedAt
  out.title = i.title.trim()
  if (i.why?.trim()) out.why = i.why.trim()
  if (i.parent?.trim()) out.parent = slug(i.parent)
  const impact = impactLines(i.impact)
  if (impact.length) out.impact = impact.join('\n')
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

async function startedAtOf($: EngineInterface, path: string, now: number): Promise<number> {
  try {
    const p = JSON.parse(String(await $.fs.read(path))) as { startedAt?: unknown }
    if (typeof p.startedAt === 'number') return p.startedAt
  } catch { /* new file */ }
  return now
}

/** Writes (or with `finished`, removes) one progress file. Returns what the model reads. */
export async function writeReport($: EngineInterface, h: string, i: ReportInput, owner?: Owner): Promise<string> {
  if (!h) return 'No home folder found ($HOME is unset).'
  const name = slug(i.slug || i.title || '')
  if (!name) return 'progress_report needs a title.'
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
      slug: name, title: i.title?.trim() || str(prev.title) || '', why: i.why?.trim() || str(prev.why), impact, step: str(prev.step),
      started: typeof prev.startedAt === 'number' ? prev.startedAt : undefined, finished: await $.clock.now(), session: o.session || undefined, kind: 'job',
    }).catch(() => undefined)
    await $.process.run(['rm', '-f', path]).catch(() => undefined)
    return `Removed the bar ${name}.${impact.length ? '' : ' Pass impact (what it changed) next time so its DONE row says so.'}`
  }
  const now = await $.clock.now()
  const body = reportBody(i, owner ?? await ownerOf($), await startedAtOf($, path, now))
  await $.fs.write(path, JSON.stringify(body))
  const pct = typeof body.done === 'number' ? ` ${body.done}/${body.total}` : ''
  return `Bar ${name}${pct} shows in this session's Status panel. Call again after each step, and with finished: true at the end.`
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
  const body = JSON.stringify(reportBody({ title: description || command.slice(0, 60), step: taskId ? 'running in the background' : 'running' }, owner, await $.clock.now()))
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

/** At a Stop: background shells no longer listed as running are over. */
export async function endBackground($: EngineInterface, running: readonly { id: string; status?: string }[]) {
  const ids = new Set(running.filter(t => !t.status || /running|pending/.test(t.status)).map(t => t.id))
  for (const [path, s] of [...liveShells]) if (s.taskId && !ids.has(s.taskId)) await endShell($, path)
}
