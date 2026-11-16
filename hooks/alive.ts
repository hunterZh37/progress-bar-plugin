// Signs of life beyond a row's numbers. Pure helpers: no `$`, so tests import them directly.
//
// group.py marks a running row stuck when its numbers and step have not moved for the stuck threshold (10 min by
// default). A healthy job can stay quiet longer than that: a remote job that takes 90 minutes, a step that waits on a
// rate-limited API, a background shell. Each poll the plugin writes what else it knows to
// ~/.claude-progress/.state/alive-<session>.json, one entry per row keyed by the slug of its name:
//   at:    the last sign of life (the progress file or its heartbeat file written, the agent's transcript written,
//          a background task of the agent still running, a background shell the transcript has not ended, a watch log)
//   until: a quiet window the job announced (`quietUntil` in its progress file, from progress_report expect_minutes)
// group.py counts a row stuck only when the newest of its last change, `at` and `until` is older than the threshold.
// A row with no sign of life at all still warns.
//
// A progress file can name more signs (all optional, all cheap: a stat or one ps call):
//   agent:          the subagent that writes it (progress_report fills it in). Its transcript written counts, and its
//                   background shells still running.
//   output_file / transcript / heartbeat: files the job keeps writing. Each write counts.
//   pid / pids:     processes doing the work. One that exists (not a zombie) counts as alive this poll, idle or not.
//   steps[].expect_minutes on the active step: no stuck mark until N minutes after the file's last write.

export const ALIVE_PREFIX = 'alive-'
export const aliveRel = (key: string) => `.state/${ALIVE_PREFIX}${key}.json`

/** A row's signs of life, ms. */
export type Life = { at?: number; until?: number }

/** Epoch ms from a number that may be seconds (anything below year 2001 in ms is taken as seconds). */
export const toMs = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? (v < 1e12 ? v * 1000 : v) : undefined

/** The quiet window a progress file announces: `quietUntil` (epoch ms or s), or undefined. */
export function quietUntilOf(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  return toMs((raw as Record<string, unknown>).quietUntil)
}

/** The heartbeat path a progress file names (a log whose changes count as life), or ''. */
export function heartbeatOf(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const h = (raw as Record<string, unknown>).heartbeat
  return typeof h === 'string' ? h.trim() : ''
}

/** Files a progress file names whose writes count as life: `heartbeat`, `output_file`, `transcript` (`~/` allowed). */
export function lifeFilesOf(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  const out: string[] = []
  for (const k of ['heartbeat', 'output_file', 'outputFile', 'transcript']) {
    const v = r[k]
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim())
  }
  return out
}

/** The subagent id a progress file names (`agent`, else `agent_id`), or ''. Only id characters, so it is safe in a path. */
export function agentOf(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const r = raw as Record<string, unknown>
  const v = typeof r.agent === 'string' ? r.agent : typeof r.agent_id === 'string' ? r.agent_id : ''
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : ''
}

/** At most this many pids per progress file are checked. */
export const MAX_PIDS = 16

/** The pids a progress file names (`pid` and `pids`), positive whole numbers above 1, at most MAX_PIDS. */
export function pidsOf(raw: unknown): number[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  const all = [r.pid, ...(Array.isArray(r.pids) ? r.pids : [])]
  const out: number[] = []
  for (const v of all) {
    const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v
    if (typeof n === 'number' && Number.isInteger(n) && n > 1 && n < 2 ** 31 && !out.includes(n)) out.push(n)
  }
  return out.slice(0, MAX_PIDS)
}

/**
 * The pids alive in `ps -o pid=,stat= -p <pids>` output: listed (ps prints only processes that exist) and not a zombie
 * (stat Z). A process that exists counts even when idle: a client such as psql sleeps while its server does the work,
 * so CPU time is no test of life.
 */
export function livePids(text: string): Set<number> {
  const out = new Set<number>()
  for (const l of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(l)
    if (m && !m[2]!.startsWith('Z')) out.add(Number(m[1]))
  }
  return out
}

/** Life from a file's pids: `at: now` while any of them is alive, none when all are gone. */
export function pidLife(pids: readonly number[], live: Set<number>, now: number): Life {
  return pids.some(p => live.has(p)) ? { at: now } : {}
}

/**
 * The quiet window the file's active step declares: `expect_minutes` on an active step of `steps`, counted from the
 * step's `since` (epoch ms or s) when given, else from the file's last write `mtime`. Capped at a day. undefined when none.
 */
export function stepQuietUntil(raw: unknown, mtime: number): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const steps = (raw as Record<string, unknown>).steps
  if (!Array.isArray(steps)) return undefined
  let out: number | undefined
  for (const x of steps) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (o.state !== 'active') continue
    const n = typeof o.expect_minutes === 'number' ? o.expect_minutes : o.expectMinutes
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    const from = toMs(o.since) ?? mtime
    if (!from) continue
    const u = from + Math.min(n, 24 * 60) * 60_000
    if (out === undefined || u > out) out = u
  }
  return out
}

/** Two lives in one: the newer `at`, the later `until`. */
export function mergeLife(a: Life | undefined, b: Life | undefined): Life {
  const at = Math.max(a?.at ?? 0, b?.at ?? 0)
  const until = Math.max(a?.until ?? 0, b?.until ?? 0)
  const out: Life = {}
  if (at > 0) out.at = at
  if (until > 0) out.until = until
  return out
}

/** Adds `life` to the map entry for `key`, dropping empty ones. */
export function addLife(map: Map<string, Life>, key: string, life: Life) {
  const m = mergeLife(map.get(key), life)
  if (m.at || m.until) map.set(key, m)
}

/**
 * Where this session's transcripts are, from candidate bases (a transcript path without `.jsonl`) and the mtime of
 * each one's `.jsonl` (0 when missing). A base counts only when its file name is this session's id and its transcript
 * exists. The newest transcript wins: a session resumed under another config folder or project folder has an old
 * copy at its former path, and that copy never sees the session's new events. '' when none counts.
 */
export function pickTxBase(cands: readonly { base: string; mtime: number }[], sessionId: string): string {
  let best = ''
  let top = 0
  for (const c of cands) {
    if (!c.base || c.mtime <= 0) continue
    if (sessionId && c.base.split('/').pop() !== sessionId) continue
    if (c.mtime > top) { best = c.base; top = c.mtime }
  }
  return best
}

// ---- Background tasks: alive or over (0.35.3) ----
//
// The engine's own word wins: a task-notification in the agent's transcript (`<status>completed|failed|killed`), a
// Monitor that expired, a TaskStop, or a newer Stop/SubagentStop `background_tasks` list that leaves it out. When the
// engine still counts a shell task as in flight (no notice), one batched `ps` per poll says whether its shell is
// still there: a process whose command line holds the task's command, not a zombie, and started no earlier than the
// task (a process older than the launch is another one, whatever its command). A task whose shell is gone without a
// notice is over too.

/** One process as PS_COLS lists it: its age comes from etime, so a wrong or changed wall clock does not move it. */
export type Proc = { pid: number; ppid: number; stat: string; ageMs: number; command: string }

/** Columns for the one batched ps call: pid, parent, state (Z = zombie), elapsed time, full command. */
export const PS_COLS = 'pid=,ppid=,stat=,etime=,command='
/** The ps argument lists to try in order: macOS takes -x (this user's processes, with or without a terminal), procps -e. */
export const PS_ARGVS = [['ps', '-x', '-ww', '-o', PS_COLS], ['ps', '-e', '-ww', '-o', PS_COLS]]

/** ps etime `[[dd-]hh:]mm:ss` in ms, or -1 when it does not parse. */
export function etimeMs(t: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(t.trim())
  if (!m) return -1
  return (((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000
}

/** `ps -o pid=,ppid=,stat=,etime=,command=` lines. A line that does not parse (a command's own newline) is skipped. */
export function parseProcs(text: string): Proc[] {
  const out: Proc[] = []
  for (const l of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(l)
    if (!m) continue
    const age = etimeMs(m[4]!)
    if (age < 0) continue
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), stat: m[3]!, ageMs: age, command: m[5]! })
  }
  return out
}

/** A command line for matching: no quotes or backslashes (a shell wrapper's `eval '...'` escapes them), one space. */
export const normCmd = (s: string) => s.replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim()

/** How much of a task's command must appear in a process's command line. */
const CMD_KEY = 120
/** Slack for the start-time guard: a process may be listed a little before the plugin stamped the launch. */
export const START_SLACK_MS = 120_000

/**
 * The live process running a background shell task, or null: the Bash tool's shell for it (`eval '<command>'`) or a
 * process that is the command itself, matched on the command's first line (up to 120 characters), not a zombie, and that started no earlier than the task's
 * launch less START_SLACK_MS (an older process with the same command is not this task's; a reused pid starts later
 * than whatever it replaced, so it is never mistaken for an earlier launch). `launchedAt` 0 skips the time guard.
 * The innermost match wins (the real command under its shell wrapper), for its name and start.
 */
export function taskProc(cmd: string, procs: readonly Proc[], launchedAt: number, now: number): Proc | null {
  const key = normCmd(cmd.split('\n')[0] ?? '').slice(0, CMD_KEY)
  if (key.length < 4) return null
  // Only the shell Claude's Bash tool starts (`... && eval '<command>'`) or a process that is the command itself: a
  // process whose arguments merely mention the command (an editor, a grep, another Claude's prompt) is not the task.
  const runs = (c: string) => { const n = normCmd(c); return n.startsWith(key) || n.includes(`eval ${key}`) }
  const hits = procs.filter(p => !p.stat.startsWith('Z') && runs(p.command) && (!launchedAt || now - p.ageMs >= launchedAt - START_SLACK_MS))
  if (!hits.length) return null
  return hits.find(p => !hits.some(q => q.ppid === p.pid)) ?? hits[0]!
}

/**
 * The pids still alive from a batched process list: listed, not a zombie, and started no later than `writtenAt` (the
 * progress file's last write) plus START_SLACK_MS. A pid named in a file must exist when the file is written, so a
 * process that started after that is a reused pid, not the job's. `writtenAt` 0 skips the guard.
 */
export function livePidsIn(pids: readonly number[], procs: readonly Proc[], writtenAt: number, now: number): Set<number> {
  const out = new Set<number>()
  for (const pid of pids) {
    const p = procs.find(x => x.pid === pid)
    if (!p || p.stat.startsWith('Z')) continue
    if (writtenAt && now - p.ageMs > writtenAt + START_SLACK_MS) continue
    out.add(pid)
  }
  return out
}

const SCRIPT = /^(\/?(?:[\w.~@+-]+\/)*[\w.@+-]+\.(?:sql|py|sh|bash|zsh|ts|tsx|js|mjs|cjs|rb|pl|R|ipynb|go|rs))$/
/** Commands that run the script they are given: its file is the job's name. */
const RUNS = new Set(['python', 'python3', 'bash', 'sh', 'zsh', 'node', 'bun', 'deno', 'ruby', 'perl', 'Rscript', 'tsx', 'ts-node', 'psql', 'uv', 'poetry', 'npx', 'source', '.'])
/** Words before the command itself: a timer, a wrapper, a loop's keyword. */
const LEAD = new Set(['time', 'nohup', 'exec', 'caffeinate', 'sudo', 'env', 'command', 'do', 'then', 'else', '!', '{'])

/**
 * A background job's short name: the script it runs (`db/refresh.sql`, last two path parts), else the call's
 * description, else the command's start. A script counts only as the command itself (`./load.sh`) or given to a
 * command that runs scripts (`psql -f x.sql`, `python3 x.py`), never a redirect target or a pattern (`pgrep -f x.sh`).
 */
export function jobName(desc: string, cmd = ''): string {
  const c = (cmd.split('\n')[0] ?? '').replace(/\d*>>?\s*&?\s*\S+/g, ' ').replace(/(&&|\|\||[;|()])/g, ' $1 ')
  let first = '', runs = false
  for (const raw of c.split(/\s+/)) {
    if (!raw) continue
    if (/^(&&|\|\||[;|()])$/.test(raw)) { first = ''; runs = false; continue }
    const t = raw.replace(/^['"]+|['"]+$/g, '')
    if (!first) {
      if (LEAD.has(t) || /^[A-Za-z_]\w*=/.test(t) || /^(while|until|if|for)$/.test(t)) {
        if (/^(while|until|if)$/.test(t)) { first = t; runs = false }
        continue
      }
      first = t
      runs = RUNS.has(t.split('/').pop() ?? '')
      if (SCRIPT.test(t)) return t.split('/').slice(-2).join('/')
      continue
    }
    if (runs && SCRIPT.test(t)) return t.split('/').slice(-2).join('/')
  }
  const d = desc.replace(/\s+/g, ' ').trim()
  if (d) return d.length > 60 ? `${d.slice(0, 59)}…` : d
  const t = cmd.replace(/\s+/g, ' ').trim()
  return t.length > 40 ? `${t.slice(0, 39)}…` : t
}
