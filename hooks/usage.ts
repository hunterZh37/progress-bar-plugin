// The usage meter's own reading. Every 30 minutes one session on the machine asks Claude for the login's 7-day and
// 5-hour use: a tiny Haiku call whose stream carries a rate_limit_event, run on the default login with no API key, no
// tools, no MCP, no settings and no saved session. The result goes to .state/max-usage.json, the file the panel reads.
// Any failure (offline, not logged in, an API key in use) keeps the old reading and says nothing.
import type { EngineInterface } from 'claude-code'

export const USAGE_EVERY = 30 * 60_000 // a reading older than this is refreshed
export const USAGE_CHECK = 5 * 60_000 // how often a session looks at the reading's age
export const USAGE_FILE_REL = '.claude-progress/.state/max-usage.json'
export const USAGE_LOCK_REL = '.claude-progress/.state/max-usage.probe'

export type UsageReading = { pct: number; at: number; five?: number; plan?: string }

// One shell: a fresh empty folder, the default login (no CLAUDE_CONFIG_DIR, no API key), and a guard so a probe never
// starts another probe. "auth" prints the plan (claude auth status has no secrets), "probe" prints the stream.
export const PROBE_SCRIPT = [
  '[ -n "$PB_USAGE_PROBE" ] && exit 0',
  'PB_USAGE_PROBE=1; export PB_USAGE_PROBE',
  'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CONFIG_DIR',
  'PATH="$PATH:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"; export PATH',
  'd=$(mktemp -d) || exit 1',
  'cd "$d" || exit 1',
  'if [ "$1" = auth ]; then claude auth status --json </dev/null 2>/dev/null',
  'else claude -p --model haiku --output-format stream-json --verbose --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence "Reply with: ok" </dev/null 2>/dev/null',
  'fi',
  'c=$?; cd /; rmdir "$d" 2>/dev/null; exit $c',
].join('\n')

/** 7-day and 5-hour use in whole percent from a stream-json run, or null when the run was not on the login. */
export function parseProbe(stdout: string): { seven: number; five: number | null } | null {
  let source: unknown = undefined
  let win: { seven_day?: { utilization?: unknown }; five_hour?: { utilization?: unknown } } | undefined
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let ev: { type?: unknown; subtype?: unknown; apiKeySource?: unknown; rate_limit_info?: { unifiedWindows?: typeof win } }
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type === 'system' && ev.subtype === 'init') source = ev.apiKeySource
    else if (ev.type === 'rate_limit_event' && ev.rate_limit_info?.unifiedWindows) win = ev.rate_limit_info.unifiedWindows
  }
  // Only a subscription login has these windows. An API key never counts.
  if (source !== 'none' || !win) return null
  const pct = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(Math.min(1, v) * 100) : null)
  const seven = pct(win.seven_day?.utilization)
  return seven === null ? null : { seven, five: pct(win.five_hour?.utilization) }
}

/** "Team", "Max", "Pro", "Enterprise" from claude auth status --json, else ''. */
export function parsePlan(stdout: string): { loggedIn: boolean; plan: string } {
  try {
    const j = JSON.parse(stdout) as { loggedIn?: unknown; subscriptionType?: unknown }
    const t = typeof j.subscriptionType === 'string' ? j.subscriptionType.trim().toLowerCase() : ''
    const plan = /^[a-z][a-z0-9_ -]{0,19}$/.test(t) ? t.split(/[_ -]+/).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') : ''
    return { loggedIn: j.loggedIn !== false, plan }
  } catch { return { loggedIn: true, plan: '' } }
}

/** The saved reading, or null. */
export function parseSaved(text: string): UsageReading | null {
  try {
    const j = JSON.parse(text) as UsageReading
    return typeof j.pct === 'number' && typeof j.at === 'number' ? j : null
  } catch { return null }
}

/** True when the reading is missing or older than 30 minutes and no other session has started a probe in that time. */
export function probeDue(saved: UsageReading | null, lockAt: number | null, now: number): boolean {
  if (saved && now - saved.at < USAGE_EVERY) return false
  return lockAt === null || now - lockAt >= USAGE_EVERY
}

/** What a probe needs from the machine, so tests can stand in for it. */
export type ProbeIo = {
  now: () => Promise<number>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  mtime: (path: string) => Promise<number>
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string }>
}

export function engineIo($: EngineInterface): ProbeIo {
  return {
    now: () => $.clock.now(),
    read: async p => String(await $.fs.read(p)),
    write: async (p, t) => { await $.fs.write(p, t) },
    mtime: async p => (await $.fs.stat(p)).mtimeMs,
    run: async (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
  }
}

let probing = false

/** Takes a fresh reading when it is due. One session machine-wide: the lock folder's time is the last start. */
export async function probeUsage($: EngineInterface, h: string): Promise<boolean> {
  return probeWith(engineIo($), h)
}

export async function probeWith(io: ProbeIo, h: string): Promise<boolean> {
  if (!h || probing) return false
  probing = true
  try {
    const t = await io.now()
    const file = `${h}/${USAGE_FILE_REL}`
    const lock = `${h}/${USAGE_LOCK_REL}`
    let saved: UsageReading | null = null
    try { saved = parseSaved(await io.read(file)) } catch { saved = null }
    let lockAt: number | null = null
    try { lockAt = await io.mtime(lock) } catch { lockAt = null }
    if (!probeDue(saved, lockAt, t)) return false
    // mkdir is the claim: a stale lock is removed and claimed again, and only one session wins the mkdir.
    if (lockAt !== null) await io.run(['rmdir', lock], 5000).catch(() => undefined)
    await io.run(['mkdir', '-p', `${h}/.claude-progress/.state`], 5000).catch(() => undefined)
    const claim = await io.run(['mkdir', lock], 5000).catch(() => ({ exitCode: 1 }))
    if (claim.exitCode !== 0) return false
    const run = (what: string) => io.run(['/bin/sh', '-c', PROBE_SCRIPT, 'sh', what], 90_000).catch(() => ({ stdout: '' }))
    const auth = parsePlan((await run('auth')).stdout)
    if (!auth.loggedIn) return false
    const r = parseProbe((await run('probe')).stdout)
    if (!r) return false
    const plan = auth.plan || saved?.plan
    const next: UsageReading = { pct: r.seven, at: await io.now(), ...(r.five !== null ? { five: r.five } : {}), ...(plan ? { plan } : {}) }
    await io.write(file, JSON.stringify(next))
    return true
  } catch { return false } finally { probing = false }
}
