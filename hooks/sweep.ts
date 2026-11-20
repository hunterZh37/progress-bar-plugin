// Ghost rows: a row shows as running only while something live backs it. Pure helpers: no `$`, so tests import them.
//
// A background shell's row (shell-*.json) used to end only when the session that started it read the task's finished
// notice in its own transcript. When that session restarted or exited first, nobody ever ended it: the row stayed
// "running in the background" until its file went stale (30 min), and the file stayed on disk forever.
// Now every session checks every shell file against the process list (one batched ps per poll):
// - a process of it still runs (the Bash tool's shell for it, a pid it was seen with, or an orphan running a part of
//   its command) -> live, whoever owns it. A live process is never hidden.
// - no process, past the launch grace -> over. Its own live session ends it; a file whose session is gone (or this
//   session's own, left by a copy before a reload) is archived to .archive/shells/, not deleted.
// - no ps (it failed) -> no verdict: nothing is removed without evidence.
// Other progress files whose owner session is gone, with no live pid, quiet window or heartbeat, and unwritten for an
// hour (past the 30 min they stop showing plus group.py's 30 min "finished" memory) are archived the same way.

import { livePidsIn, normCmd, START_SLACK_MS, taskProc, type Proc } from './alive'

/** A task launched this recently may not be in ps yet. */
export const SHELL_GRACE_MS = 30_000
/** Sessions whose claims file was written this recently are open (each open session writes it every 5 s poll, and
 * removes it when it ends). The same 30 s collect() uses to route rows. */
export const SESSION_LIVE_MS = 30_000
/** How often the sweep runs. With the 5 s poll a finished shell's row closes within about 15 s. */
export const SWEEP_EVERY_MS = 10_000
/** A non-shell progress file with no live owner is archived only after this long unwritten. */
export const STALE_FILE_MS = 60 * 60_000
export const ARCHIVE_REL = '.archive'
/** An open session rewrites its running shells' files every 5 s poll; one unwritten this long is not tracked by it. */
export const OWNER_TOUCH_MS = 2 * 60_000

export type ShellFile = { session: string; taskId: string; command: string; startedAt: number; pids: number[] }

/** The parts of a shell row's file the sweep needs. */
export function parseShellFile(raw: unknown): ShellFile {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const pids = Array.isArray(r.pids) ? r.pids.filter((p): p is number => typeof p === 'number' && Number.isInteger(p) && p > 1).slice(0, 16) : []
  return { session: str(r.session), taskId: str(r.taskId), command: str(r.command) || str(r.fg), startedAt: typeof r.startedAt === 'number' ? r.startedAt : 0, pids }
}

/** The top-level parts of a command (split on ; && || | & and newlines), each normalised, at least 8 characters. */
export function commandParts(cmd: string): string[] {
  return cmd.split(/\n|;|&&|\|\||\||&/).map(p => normCmd(p).replace(/^((do|then|else|time|nohup|exec)\s+)+/, '')).filter(p => p.length >= 8 && !/^(done|fi|esac)\b/.test(p))
}

/**
 * The live process of a background shell, or null. In order: the Bash tool's shell for it (taskProc), a pid it was seen
 * with earlier (still alive, started before the file's last write), or an orphan (parent pid 1) running one part of
 * its command that started after the launch (its shell died, the work goes on).
 */
export function shellProc(f: ShellFile, procs: readonly Proc[], writtenAt: number, now: number): Proc | null {
  if (f.command) {
    const p = taskProc(f.command, procs, f.startedAt, now)
    if (p) return p
    // The Bash tool's shell when a hook rewrote the command (a prefix such as `rtk `): its eval still holds the command.
    const key = cmdKey(f.command)
    const w = procs.find(q => !q.stat.startsWith('Z') && (!f.startedAt || now - q.ageMs >= f.startedAt - START_SLACK_MS) && /\beval\b/.test(q.command) && wordAt(normCmd(q.command), key))
    if (w) return w
  }
  const alive = livePidsIn(f.pids, procs, writtenAt, now)
  if (alive.size) return procs.find(p => alive.has(p.pid)) ?? null
  if (f.command) {
    const parts = commandParts(f.command)
    const hit = procs.find(p => p.ppid === 1 && !p.stat.startsWith('Z') && (!f.startedAt || now - p.ageMs >= f.startedAt - START_SLACK_MS) && parts.some(k => { const n = normCmd(p.command); return n.startsWith(k) && (n.length === k.length || /\s/.test(n[k.length]!)) }))
    if (hit) return hit
  }
  return null
}

/** A process and every descendant of it, not zombies (the pids a shell file keeps, so an orphaned child still counts). */
export function treeOf(root: number, procs: readonly Proc[]): number[] {
  const out: number[] = []
  const add = (pid: number) => {
    if (out.includes(pid) || out.length >= 16) return
    out.push(pid)
    for (const k of procs) if (k.ppid === pid && !k.stat.startsWith('Z')) add(k.pid)
  }
  add(root)
  return out
}

/** Whether `key` appears in `n` ending at a word boundary (`sleep 62` is not in `sleep 621`). */
export function wordAt(n: string, key: string): boolean {
  for (let i = n.indexOf(key); i >= 0; i = n.indexOf(key, i + 1)) {
    const next = n[i + key.length]
    if (next === undefined || /[\s;&|)]/.test(next)) return true
  }
  return false
}

/** The part of a command matched against process lines: its first line, normalised, up to 120 characters. */
export const cmdKey = (cmd: string) => normCmd(cmd.split('\n')[0] ?? '').slice(0, 120)

export type ShellVerdict = 'live' | 'wait' | 'end' | 'archive' | 'owner'

/**
 * What to do with one shell file. `mine`: this copy runs it (it is in liveShells). `ownerKey`: the session key the file
 * names. `me`: this session's key. `openSessions`: keys of open sessions (fresh claims files), this one included.
 *   live    a process of it runs: keep it, it is a real job
 *   wait    no evidence yet (no ps, or launched within the grace): keep it
 *   end     this copy runs it and its process is gone: end the row
 *   archive no process and no live owner to end it (its session is gone, or it is this session's own leftover)
 *   owner   no process, but another open session owns it and still rewrites its file: that session ends it
 */
export function shellVerdict(f: ShellFile, ctx: { mine: boolean; ownerKey: string; me: string; openSessions: ReadonlySet<string>; procs: readonly Proc[] | null; writtenAt: number; now: number }): ShellVerdict {
  if (!ctx.procs) return 'wait'
  // A foreground command's row (no task id, no command kept): it ends with its tool call, which needs its session.
  // A command too short to match safely is treated the same way: never ended on a missing process.
  if (!f.command || cmdKey(f.command).length < 4) {
    if (ctx.mine) return 'wait'
    if (ctx.ownerKey && ctx.ownerKey !== ctx.me && ctx.openSessions.has(ctx.ownerKey) && ctx.now - ctx.writtenAt < OWNER_TOUCH_MS) return 'owner'
    return ctx.now - ctx.writtenAt > SHELL_GRACE_MS ? 'archive' : 'wait'
  }
  if (shellProc(f, ctx.procs, ctx.writtenAt, ctx.now)) return 'live'
  if (f.startedAt && ctx.now - f.startedAt < SHELL_GRACE_MS) return 'wait'
  if (ctx.mine) return 'end'
  // An open owner rewrites the files of the shells it runs every poll: one it left unwritten is a leftover it lost.
  if (ctx.ownerKey && ctx.ownerKey !== ctx.me && ctx.openSessions.has(ctx.ownerKey) && ctx.now - ctx.writtenAt < OWNER_TOUCH_MS) return 'owner'
  return 'archive'
}

/**
 * Whether a non-shell progress file has no live owner and can go to the archive: it names a session that is not open,
 * names no live pid, announces no quiet window still open, and neither it nor a heartbeat file it names was written
 * within STALE_FILE_MS. A file that names no session (a script's, a remote job's) is never archived here.
 */
export function staleProgress(o: { ownerKey: string; me: string; openSessions: ReadonlySet<string>; writtenAt: number; lifeAt: number; until: number; livePids: number; now: number }): boolean {
  if (!o.ownerKey || o.ownerKey === o.me || o.openSessions.has(o.ownerKey)) return false
  if (o.livePids > 0 || o.until > o.now) return false
  return o.now - Math.max(o.writtenAt, o.lifeAt) > STALE_FILE_MS
}

/** The archive path for a swept file: <dir>/.archive/<kind>/<name minus .json>-<stamp>.json. */
export const archivePath = (dir: string, kind: 'shells' | 'jobs', name: string, now: number) => `${dir}/${ARCHIVE_REL}/${kind}/${name.replace(/\.json$/, '')}-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`

/**
 * The session a background fork belongs to, as a session key, or ''. Claude Code runs a background job of a session as
 * its own session (`kind: "bg"` in <config>/sessions/<pid>.json), started with `--fork-session --resume <parent>.jsonl`.
 * Its agents and jobs are the parent's work, so its rows also show in the parent's view (the person looks there).
 */
export function forkParentOf(command: string, kind: string, key: (id: string) => string): string {
  if (kind !== 'bg' || !/(^|\s)--fork-session(\s|$)/.test(command)) return ''
  const m = /(?:^|\s)--resume[ =](?:\S*\/)?([0-9a-fA-F-]{36})(?:\.jsonl)?(?:\s|$)/.exec(command)
  return m ? key(m[1]!) : ''
}

/** The line file a background fork writes for its parent: statusline.sh shows every fresh `*-<parent key>.txt`. */
export const forkLinesRel = (me: string, parent: string) => `.lines/fork-${me}-${parent}.txt`
