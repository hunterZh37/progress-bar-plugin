import type { EngineInterface } from 'claude-code'

// One writer per session. A /reload-plugins builds a new copy of this module, and a copy it replaced can keep its
// $.clock.every timers running: both copies then wrote .lines/agents-<session>.txt every 5 s, one knowing the
// session's agents and one not, so a row came and went. Each copy claims the session at session.start in
// .state/owner-<session>.json; a timer tick or poll of a copy that no longer owns it stops all its timers.

export const ownerRel = (key: string) => `.claude-progress/.state/owner-${key}.json`

type Timer = { cancel: () => void }

export type Owner = {
  readonly id: string
  /** Set once another copy claimed the session: this copy writes nothing more. */
  stopped: boolean
  timers: Timer[]
}

export function newOwner(at: number): Owner {
  return { id: `${at}-${Math.random().toString(36).slice(2, 10)}`, stopped: false, timers: [] }
}

/** Claims the session for this copy: the newest copy started wins. */
export async function claim($: EngineInterface, o: Owner, h: string, key: string, at: number) {
  if (!h) return
  await $.fs.write(`${h}/${ownerRel(key)}`, JSON.stringify({ id: o.id, at })).catch(() => undefined)
}

/** Stops every timer this copy started. */
export function stop(o: Owner) {
  o.stopped = true
  for (const t of o.timers.splice(0)) { try { t.cancel() } catch { /* gone */ } }
}

/**
 * Whether this copy still owns the session. No owner file (an older build, or no session.start yet): it does.
 * Another copy's id: it stops its timers and answers false from then on.
 */
export async function owns($: EngineInterface, o: Owner, h: string, key: string): Promise<boolean> {
  if (o.stopped) return false
  if (!h) return true
  let id = ''
  try { id = String((JSON.parse(String(await $.fs.read(`${h}/${ownerRel(key)}`))) as { id?: unknown }).id ?? '') } catch { return true }
  if (!id || id === o.id) return true
  stop(o)
  return false
}

/** `$.clock.every` whose ticks run only while this copy owns the session; kept so stop() can cancel it. */
export function every($: EngineInterface, o: Owner, ms: number, fn: () => unknown, ownsNow: () => Promise<boolean>): Timer {
  const t = $.clock.every(ms, () => { void ownsNow().then(ok => (ok ? fn() : undefined)).catch(() => undefined) }) as unknown as Timer
  if (t && typeof t.cancel === 'function') o.timers.push(t)
  return t
}
