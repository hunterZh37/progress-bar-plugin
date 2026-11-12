// Stop or pause a running job from the List tab: the [x] at a RUNNING row's end opens "Cancel · Stop · Pause".
//
// What each kind of row can do:
// - shell: a background Bash shell this plugin recorded (its progress file holds `command` and `taskId`). Stop sends
//   SIGTERM to the shell and its child processes, Pause SIGSTOP, Resume SIGCONT. Only processes found by that exact
//   command, owned by this user, never pid 1 or Claude itself. No process found: Stop asks Claude to TaskStop it.
// - agent: a subagent. The engine has no stop call, so Stop submits a prompt asking Claude to TaskStop it. No pause.
// - job-pid: a progress file with a `pid` (and ideally `cmd`). Stop SIGTERM, Pause SIGSTOP, Resume SIGCONT, after
//   checking the pid is still that job (owner, not Claude, `cmd` in its command line, started before the job's file).
//   Stop also marks the file stopped.
// - job-file: a progress file without a pid. Stop writes `stopped: true, stoppedAt` into it: the row moves to DONE as
//   "stopped by you", and a script that checks `stopped` can quit. No pause.
// Paused rows are listed in ~/.claude-progress/.state/paused.json ({ "<row name>": <epoch ms> }).

import type { EngineInterface } from 'claude-code'

import type { StopAsk } from '../types'
import { logEvent } from './actions'
import { endShell } from './report'

export type CtlKind = 'shell' | 'agent' | 'job-pid' | 'job-file'
export type CtlInfo = { kind: CtlKind; paused: boolean }
export const PAUSED_REL = '.claude-progress/.state/paused.json'

/** What a RUNNING row can be controlled as, from its name, whether it is an agent row and its progress file. Null: no [x]. */
export function controlKind(name: string, isAgent: boolean, raw: Record<string, unknown> | undefined): CtlKind | null {
  if (isAgent) return 'agent'
  if (!raw || /^[A-Za-z0-9_.-]+:\s?\S/.test(name)) return null // no file here, or a job on another machine
  if (name.startsWith('shell-')) return typeof raw.command === 'string' && raw.command.trim() ? 'shell' : null
  return validPid(raw.pid) ? 'job-pid' : 'job-file'
}

const validPid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 1

/**
 * The choices under an open [x]: Cancel first (the focus lands there, so a stray Enter stops nothing), Pause only
 * where it can work, Resume once paused.
 */
export function controlOptions(kind: CtlKind, paused: boolean): string[] {
  if (kind === 'shell' || kind === 'job-pid') return paused ? ['Cancel', 'Resume', 'Stop'] : ['Cancel', 'Stop', 'Pause']
  return ['Cancel', 'Stop']
}

// ---- The open stop confirm: ephemeral, one row at a time ----
// It lives in the session's state only so the drawing redraws, never on disk. It belongs to this load of the code
// (LOAD_ID; a /reload-plugins starts a new one, so a confirm from before a reload never shows again), to one exact
// row key, and to a time: ASK_MS with no choice dismisses it. Cancel, Escape, the focus moving off it or the panel
// losing the keyboard close it too.

export type { StopAsk }
export const NO_ASK: StopAsk = { key: '', at: 0, load: '' }
/** How long an open confirm waits for a choice before it closes by itself. */
export const ASK_MS = 8000
/** This load of the module: module variables start over at a reload, the session's state does not. */
export const LOAD_ID = `load-${Math.random().toString(36).slice(2)}`

/** Whether the confirm for row `key` shows: opened for that row, in this load, after the last focus loss, within ASK_MS. */
export function askShown(a: StopAsk | undefined, key: string, now: number, load: string = LOAD_ID, blurAt = 0): boolean {
  if (!a || !a.key || a.key !== key || a.load !== load) return false
  if (a.at <= blurAt) return false
  return now >= a.at && now - a.at < ASK_MS
}

/** Whether a stored confirm is over (another load, past ASK_MS, or none) and should be cleared. */
export const askStale = (a: StopAsk | undefined, now: number, load: string = LOAD_ID, blurAt = 0) =>
  !!a?.key && !askShown(a, a.key, now, load, blurAt)

/** The [x] press: opens the confirm on this row (moving it from any other row), or closes it when already open here. */
export function toggleAsk(a: StopAsk | undefined, key: string, now: number, load: string = LOAD_ID, blurAt = 0): StopAsk {
  return askShown(a, key, now, load, blurAt) ? NO_ASK : { key, at: now, load }
}

/** The keys of a row's [x] and its confirm's buttons, unique per row. */
export const askKeys = (key: string) => ({ x: `xb-${key}`, opt: (o: string) => `xo-${key}-${o.toLowerCase()}` })

/** Whether the focus ring landing on `element` keeps the confirm for row `key` open: only its own [x] or buttons. */
export function focusKeeps(key: string, element: string | undefined): boolean {
  if (!key || !element) return false
  const k = askKeys(key)
  return element === k.x || ['Cancel', 'Stop', 'Pause', 'Resume'].some(o => element === k.opt(o))
}

export type Proc = { pid: number; ppid: number; uid: number; startMs: number; command: string }

/** `ps -x -ww -o pid=,ppid=,uid=,lstart=,command=` lines (lstart is 5 words: "Sat Nov  8 10:00:00 2026"). */
export function parsePs(text: string): Proc[] {
  const out: Proc[] = []
  for (const l of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(l)
    if (!m) continue
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), uid: Number(m[3]), startMs: Date.parse(m[4]!) || 0, command: m[5]! })
  }
  return out
}

export const norm = (s: string) => s.replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim()
/** Claude Code itself: never signalled. */
export const isClaude = (command: string) => /(^|\/)claude(\s|$)|\/claude\/versions\//.test(command.split(' ')[0] ?? '') || /^claude\b/.test(command)

/**
 * Why a pid must not be signalled, or '' when it is safe: it exists, is this user's, is not pid 1, this process or
 * Claude, its command line holds the recorded command (when one is recorded), and it started no later than the job
 * (a reused pid starts after).
 */
export function pidCheck(pid: number, procs: Proc[], ctx: { uid: number; self: number[]; cmd?: string; startedAt?: number }): string {
  if (!validPid(pid)) return 'not a valid pid'
  if (ctx.self.includes(pid)) return 'that is this process'
  const p = procs.find(x => x.pid === pid)
  if (!p) return 'no such process'
  if (p.uid !== ctx.uid) return 'another user owns it'
  if (isClaude(p.command)) return 'that is Claude itself'
  if (ctx.cmd && !norm(p.command).includes(norm(ctx.cmd))) return 'its command no longer matches'
  if (ctx.startedAt && p.startMs && p.startMs > ctx.startedAt + 120_000) return 'it started after the job (a reused pid)'
  return ''
}

/** A background shell's processes: the outermost one Claude started whose command line holds the recorded command, then its children. */
export function shellTree(command: string, procs: Proc[], uid: number, self: number[]): number[] {
  const c = norm(command)
  if (!c) return []
  const hit = procs.filter(p => p.uid === uid && p.pid > 1 && !self.includes(p.pid) && !isClaude(p.command) && norm(p.command).includes(c))
  // Only a shell Claude started: its parent is this process or a Claude process, never a terminal of the person's own.
  const byClaude = (p: Proc) => self.includes(p.ppid) || isClaude(procs.find(q => q.pid === p.ppid)?.command ?? '')
  const roots = hit.filter(p => !hit.some(q => q.pid === p.ppid) && byClaude(p))
  const out = new Set<number>()
  const add = (pid: number) => {
    if (out.has(pid) || self.includes(pid) || pid <= 1) return
    out.add(pid)
    for (const k of procs) if (k.ppid === pid && !isClaude(k.command)) add(k.pid)
  }
  for (const r of roots) add(r.pid)
  return [...out]
}

/** Every process with its start time. macOS ps takes -x; procps on Linux rejects it, so -e is tried next. */
export async function psList($: EngineInterface): Promise<{ stdout: string }> {
  const cols = 'pid=,ppid=,uid=,lstart=,command='
  for (const argv of [['ps', '-x', '-ww', '-o', cols], ['ps', '-e', '-ww', '-o', cols]]) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 5000 })
      if (r.exitCode === 0 && r.stdout.trim()) return r
    } catch { /* try the next form */ }
  }
  return { stdout: '' }
}

async function procs($: EngineInterface): Promise<{ list: Proc[]; uid: number; self: number[] }> {
  const ps = await psList($)
  const id = await $.process.run(['id', '-u'], { timeoutMs: 3000 })
  const me = await $.process.run(['/bin/sh', '-c', 'echo $PPID'], { timeoutMs: 3000 })
  const self = [Number(me.stdout.trim())].filter(n => n > 1)
  return { list: parsePs(ps.stdout), uid: Number(id.stdout.trim()), self }
}

async function signal($: EngineInterface, sig: 'TERM' | 'STOP' | 'CONT', pids: number[]): Promise<boolean> {
  if (!pids.length) return false
  const r = await $.process.run(['kill', `-${sig}`, ...pids.map(String)], { timeoutMs: 5000 })
  return r.exitCode === 0
}

export async function readPaused($: EngineInterface, h: string): Promise<Record<string, number>> {
  try { const p = JSON.parse(String(await $.fs.read(`${h}/${PAUSED_REL}`))) as Record<string, number>; return p && typeof p === 'object' ? p : {} } catch { return {} }
}

async function setPaused($: EngineInterface, h: string, name: string, at: number | null) {
  const p = await readPaused($, h)
  if (at === null) delete p[name]
  else p[name] = at
  await $.fs.write(`${h}/${PAUSED_REL}`, JSON.stringify(p)).catch(() => undefined)
}

/** Marks a progress file stopped (merged into what is there), so its row moves to DONE as "stopped by you". */
export async function markStopped($: EngineInterface, path: string, now: number) {
  let raw: Record<string, unknown> = {}
  try { raw = JSON.parse(String(await $.fs.read(path))) as Record<string, unknown> } catch { raw = {} }
  await $.fs.write(path, JSON.stringify({ ...raw, stopped: true, stoppedAt: now }))
}

/**
 * Runs a choice from a row's [x] menu. Returns what happened, for a toast. `name` is the row's name, `title` what the
 * person sees, `raw` its progress file (shells and jobs), `path` that file.
 */
export async function runControl($: EngineInterface, h: string, choice: string, kind: CtlKind, name: string, title: string, raw: Record<string, unknown>, path: string): Promise<string> {
  const now = await $.clock.now()
  if (kind === 'agent') {
    if (choice !== 'Stop') return ''
    void $.prompt.submit({ text: `Stop the background agent "${name}" (TaskStop) and tell me what it had done.` })
    await logEvent($, h, 'info', `Stopped ${title}`, 'asked Claude to stop the agent')
    return `Asked Claude to stop ${title}`
  }
  if (kind === 'job-file') {
    if (choice !== 'Stop') return ''
    await markStopped($, path, now)
    await logEvent($, h, 'info', `Stopped ${title}`, 'marked stopped in its progress file')
    return `Stopped ${title}`
  }
  const sig = choice === 'Stop' ? 'TERM' : choice === 'Pause' ? 'STOP' : choice === 'Resume' ? 'CONT' : null
  if (!sig) return ''
  const ps = await procs($)
  let pids: number[] = []
  if (kind === 'shell') pids = shellTree(String(raw.command ?? ''), ps.list, ps.uid, ps.self)
  else {
    const why = pidCheck(raw.pid as number, ps.list, { uid: ps.uid, self: ps.self, cmd: typeof raw.cmd === 'string' ? raw.cmd : undefined, startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : undefined })
    if (why) {
      if (sig !== 'TERM') return `Not paused: ${why}`
      await markStopped($, path, now)
      await logEvent($, h, 'info', `Stopped ${title}`, `pid ${String(raw.pid)} not signalled: ${why}; marked stopped`)
      return `Stopped ${title} (marked; ${why})`
    }
    pids = [raw.pid as number]
  }
  if (!pids.length) {
    if (sig !== 'TERM') return 'Not paused: its process was not found'
    const task = typeof raw.taskId === 'string' ? raw.taskId : ''
    void $.prompt.submit({ text: `Stop the background shell ${task ? `${task} ` : ''}"${title}" (TaskStop).` })
    await logEvent($, h, 'info', `Stopped ${title}`, 'process not found; asked Claude to stop it')
    return `Asked Claude to stop ${title}`
  }
  // A stopped process can't act on SIGTERM until it runs again.
  if (sig === 'TERM') { await signal($, 'TERM', pids); await signal($, 'CONT', pids).catch(() => false) }
  else await signal($, sig, pids)
  const verb = sig === 'TERM' ? 'Stopped' : sig === 'STOP' ? 'Paused' : 'Resumed'
  await setPaused($, h, name, sig === 'STOP' ? now : null)
  if (sig === 'TERM') {
    if (kind === 'shell') await endShell($, path)
    else await markStopped($, path, now)
  }
  await logEvent($, h, 'info', `${verb} ${title}`, `pid ${pids.join(', ')}`)
  return `${verb} ${title}`
}
