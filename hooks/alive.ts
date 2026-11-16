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
