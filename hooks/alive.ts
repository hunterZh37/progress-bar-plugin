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
