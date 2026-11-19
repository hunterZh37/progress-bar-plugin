import { expect, test } from 'claude-code/testing'

import { cells, meterLabel, meterOnTabRow, meterText, tabLabel, tabsWidth } from '../hooks/panel'
import { PROBE_SCRIPT, USAGE_EVERY, loginChanged, loginRecord, parsePlan, parseProbe, parseSaved, probeDue, probeWith, usageFileRel } from '../hooks/usage'
import type { ProbeIo } from '../hooks/usage'

const HOME = '/home/u'
const FILE = `${HOME}/.claude-progress/.state/max-usage.json`
const LOCK = `${HOME}/.claude-progress/.state/max-usage.probe`
const NOW = 1800000000000

const INIT = (src: string) => JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: src, model: 'claude-haiku' })
const RATE = (seven: number, five: number) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: five }, seven_day: { utilization: seven } } } })
const STREAM = [INIT('none'), JSON.stringify({ type: 'assistant' }), RATE(0.37, 0.314), JSON.stringify({ type: 'result' })].join('\n')

test('parseProbe: whole percents from the rate_limit_event, null without the login or the window', () => {
  expect(parseProbe(STREAM)).toEqual({ seven: 37, five: 31 })
  expect(parseProbe(`${INIT('ANTHROPIC_API_KEY')}\n${RATE(0.5, 0.5)}`)).toBeNull()
  expect(parseProbe(INIT('none'))).toBeNull()
  expect(parseProbe('')).toBeNull()
  expect(parseProbe(`not json\n${INIT('none')}\n${RATE(1.4, Number.NaN)}`)).toEqual({ seven: 100, five: null })
})

test('parsePlan: the plan name only, logged out is seen', () => {
  expect(parsePlan(JSON.stringify({ loggedIn: true, subscriptionType: 'team', email: 'a@b.c' }))).toEqual({ loggedIn: true, plan: 'Team', email: 'a@b.c' })
  expect(parsePlan(JSON.stringify({ loggedIn: true, subscriptionType: 'max' })).plan).toBe('Max')
  expect(parsePlan(JSON.stringify({ loggedIn: false })).loggedIn).toBe(false)
  expect(parsePlan(JSON.stringify({ loggedIn: true, subscriptionType: '<script>' })).plan).toBe('')
  expect(parsePlan('garbage')).toEqual({ loggedIn: true, plan: '', email: '' })
  expect(parsePlan(JSON.stringify({ email: 'not an email' })).email).toBe('')
})

test('probeDue: only a reading over 30 min old, and not while another session probed in that time', () => {
  expect(probeDue(null, null, NOW)).toBe(true)
  expect(probeDue({ pct: 5, at: NOW - 60_000 }, null, NOW)).toBe(false)
  expect(probeDue({ pct: 5, at: NOW - USAGE_EVERY }, null, NOW)).toBe(true)
  expect(probeDue({ pct: 5, at: NOW - 2 * USAGE_EVERY }, NOW - 60_000, NOW)).toBe(false)
  expect(probeDue({ pct: 5, at: NOW - 2 * USAGE_EVERY }, NOW - USAGE_EVERY, NOW)).toBe(true)
  expect(parseSaved('{"pct":3}')).toBeNull()
})

test('meterLabel and meterText: named by the plan, Max when unknown, compact, the time only when old', () => {
  expect(meterLabel('Team')).toBe('Team')
  expect(meterLabel()).toBe('Max')
  expect(meterLabel('x;y')).toBe('Max')
  expect(meterText('Team', 48, '')).toBe('Team 48% ━━─── 7d')
  expect(meterText(undefined, 85, 'as of 07:38')).toBe('Max 85% ━━━━─ 7d · as of 07:38')
  expect(meterText('Team', 48, 'as of 07:38').match(/[;—]/)).toBeNull()
  // On the tab row only when it fits with two spaces to spare.
  // Tabs are words, short ones in a narrow pane, two spaces between tabs.
  expect(tabLabel('list', true)).toBe('List')
  expect(tabLabel('connectors', false, '!2')).toBe('Connectors !2')
  expect(tabLabel('connectors', false, '!2', true)).toBe('Conn !2')
  expect(tabsWidth(['List', 'Conn !2', 'Git', 'Log', 'Chat', 'Topo'])).toBe(35)
  expect(cells('🔌')).toBe(2)
  expect(meterOnTabRow(28, 18, 48)).toBe(true)
  expect(meterOnTabRow(28, 18, 47)).toBe(false)
})

test('PROBE_SCRIPT: no API key, default login, empty folder, cheapest call, never nests', () => {
  expect(PROBE_SCRIPT).toContain('unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CONFIG_DIR')
  expect(PROBE_SCRIPT).toContain('mktemp -d')
  for (const f of ['--model haiku', '--tools ""', '--strict-mcp-config', '--setting-sources ""', '--no-session-persistence', '--output-format stream-json']) expect(PROBE_SCRIPT).toContain(f)
  expect(PROBE_SCRIPT.indexOf('PB_USAGE_PROBE" ] && exit 0')).toBeLessThan(PROBE_SCRIPT.indexOf('claude '))
})

/** A fake machine: `probe` is what the claude call prints, `auth` what claude auth status prints. */
function world(files: Record<string, string>, o: { probe: string; auth: string; lockAt?: number; lock?: string; recAt?: Record<string, number> }) {
  const ran: string[][] = []
  const dirs = new Map<string, number>(Object.entries(o.recAt ?? {}))
  const LK = o.lock ?? LOCK
  if (o.lockAt !== undefined) dirs.set(LK, o.lockAt)
  const io: ProbeIo = {
    now: async () => NOW,
    read: async p => { const t = files[p]; if (t === undefined) throw new Error('ENOENT'); return t },
    write: async (p, t) => { files[p] = t },
    mtime: async p => { const m = dirs.get(p); if (m === undefined) throw new Error('ENOENT'); return m },
    run: async argv => {
      ran.push(argv)
      let exitCode = 0, stdout = ''
      if (argv[0] === 'mkdir' && argv[1] === LK) { if (dirs.has(LK)) exitCode = 1; else dirs.set(LK, NOW) }
      if (argv[0] === 'rmdir') dirs.delete(argv[1]!)
      if (argv[0] === 'rm') for (const f of argv.slice(2)) delete files[f]
      if (argv[0] === '/bin/sh') stdout = argv[4] === 'auth' ? o.auth : o.probe
      return { exitCode, stdout }
    },
  }
  return { io, ran }
}
const AUTH = JSON.stringify({ loggedIn: true, subscriptionType: 'team' })

test('probeWith: a stale reading is replaced with a fresh one and the plan', async () => {
  const files: Record<string, string> = { [FILE]: JSON.stringify({ pct: 10, at: NOW - 3 * 3_600_000 }) }
  const { io, ran } = world(files, { probe: STREAM, auth: AUTH })
  expect(await probeWith(io, HOME)).toBe(true)
  expect(JSON.parse(files[FILE]!)).toEqual({ pct: 37, at: NOW, five: 31, plan: 'Team', email: '' })
  expect(ran.filter(a => a[0] === '/bin/sh').map(a => a[4])).toEqual(['auth', 'probe'])
  // Right after, the reading is fresh: nothing runs.
  ran.length = 0
  expect(await probeWith(io, HOME)).toBe(false)
  expect(ran.length).toBe(0)
})

test('probeWith: another session probing in the last 30 min runs nothing, an older lock is taken over', async () => {
  const files: Record<string, string> = { [FILE]: JSON.stringify({ pct: 10, at: NOW - 3 * 3_600_000 }) }
  const a = world(files, { probe: STREAM, auth: AUTH, lockAt: NOW - 5 * 60_000 })
  expect(await probeWith(a.io, HOME)).toBe(false)
  expect(a.ran.length).toBe(0)
  expect(JSON.parse(files[FILE]!).pct).toBe(10)
  const b = world(files, { probe: STREAM, auth: AUTH, lockAt: NOW - USAGE_EVERY - 1 })
  expect(await probeWith(b.io, HOME)).toBe(true)
  expect(JSON.parse(files[FILE]!).pct).toBe(37)
})

test('probeWith: offline or logged out keeps the old reading', async () => {
  const old = JSON.stringify({ pct: 10, at: NOW - 3 * 3_600_000, plan: 'Max' })
  const files: Record<string, string> = { [FILE]: old }
  expect(await probeWith(world(files, { probe: '', auth: AUTH }).io, HOME)).toBe(false)
  expect(files[FILE]).toBe(old)
  const w = world(files, { probe: STREAM, auth: JSON.stringify({ loggedIn: false }) })
  expect(await probeWith(w.io, HOME)).toBe(false)
  expect(files[FILE]).toBe(old)
  expect(w.ran.filter(a => a[0] === '/bin/sh').map(a => a[4])).toEqual(['auth'])
  // An API key run never counts.
  expect(await probeWith(world(files, { probe: `${INIT('apiKeyHelper')}\n${RATE(0.9, 0.9)}`, auth: AUTH }).io, HOME)).toBe(false)
  expect(files[FILE]).toBe(old)
})

// Per login (0.35.8): a reading keeps the email it was taken under, and a /login to another account re-probes.
const WORK = JSON.stringify({ loggedIn: true, subscriptionType: 'team', email: 'me@work.test' })
const MAX = JSON.stringify({ loggedIn: true, subscriptionType: 'max', email: 'me@home.test' })
const REC = `${HOME}/.claude.json`
const shells = (ran: string[][]) => ran.filter(a => a[0] === '/bin/sh').map(a => a[4])

test('loginChanged: another email, or a reading from before emails were kept', () => {
  expect(loginChanged({ pct: 1, at: NOW, email: 'a@x.test' }, 'b@x.test')).toBe(true)
  expect(loginChanged({ pct: 1, at: NOW }, 'b@x.test')).toBe(true)
  expect(loginChanged({ pct: 1, at: NOW, email: 'a@x.test' }, 'a@x.test')).toBe(false)
  expect(loginChanged({ pct: 1, at: NOW, email: 'a@x.test' }, '')).toBe(false)
  expect(loginChanged(null, 'a@x.test')).toBe(false)
  expect(loginRecord(HOME, '')).toBe(`${HOME}/.claude.json`)
  expect(loginRecord(HOME, `${HOME}/.claude-personal/`)).toBe(`${HOME}/.claude-personal/.claude.json`)
})

test('probeWith: a /login to another account re-probes a fresh reading, with that login\'s plan and email', async () => {
  const files: Record<string, string> = { [FILE]: JSON.stringify({ pct: 52, at: NOW - 60_000, plan: 'Team', email: 'me@work.test' }) }
  // The login record is older than the reading: nothing runs at all.
  let w = world(files, { probe: STREAM, auth: MAX, recAt: { [REC]: NOW - 120_000 } })
  expect(await probeWith(w.io, HOME)).toBe(false)
  expect(w.ran.length).toBe(0)
  // The record changed after the reading and claude auth status shows another email: a new reading at once.
  w = world(files, { probe: STREAM, auth: MAX, recAt: { [REC]: NOW - 10_000 } })
  expect(await probeWith(w.io, HOME)).toBe(true)
  expect(shells(w.ran)).toEqual(['auth', 'probe'])
  expect(JSON.parse(files[FILE]!)).toEqual({ pct: 37, at: NOW, five: 31, plan: 'Max', email: 'me@home.test' })
})

test('probeWith: the same account after a record change only checks; a probe still running is waited for', async () => {
  const same = JSON.stringify({ pct: 52, at: NOW - 60_000, plan: 'Team', email: 'me@work.test' })
  const files: Record<string, string> = { [FILE]: same }
  let w = world(files, { probe: STREAM, auth: WORK, recAt: { [REC]: NOW - 10_000 } })
  expect(await probeWith(w.io, HOME)).toBe(false)
  expect(shells(w.ran)).toEqual(['auth'])
  expect(files[FILE]).toBe(same)
  // Another account, but a probe started a minute ago: no second probe, and the reading waits for it.
  w = world(files, { probe: STREAM, auth: MAX, recAt: { [REC]: NOW - 10_000 }, lockAt: NOW - 60_000 })
  expect(await probeWith(w.io, HOME)).toBe(false)
  expect(shells(w.ran)).toEqual(['auth'])
})

test('probeWith: a reading with no email (taken before 0.35.8) is checked once; the other account\'s reading goes if the probe fails', async () => {
  // Same account: the email is added, no probe.
  const files: Record<string, string> = { [FILE]: JSON.stringify({ pct: 52, at: NOW - 60_000, plan: 'Team' }) }
  let w = world(files, { probe: STREAM, auth: JSON.stringify({ loggedIn: true, subscriptionType: 'team', email: '' }) })
  expect(await probeWith(w.io, HOME)).toBe(false)
  expect(JSON.parse(files[FILE]!).email).toBe('')
  // The Team reading under a Max login (the 15:28 personal reading): the probe fails, so the wrong reading is removed.
  files[FILE] = JSON.stringify({ pct: 52, at: NOW - 60_000, plan: 'Team' })
  w = world(files, { probe: '', auth: MAX })
  expect(await probeWith(w.io, HOME)).toBe(false)
  expect(shells(w.ran)).toEqual(['auth', 'probe'])
  expect(files[FILE]).toBeUndefined()
})

test('probeWith: another login reads and writes only its own reading, under its own config dir', async () => {
  const dir = `${HOME}/.claude-personal`
  const OWN = `${HOME}/${usageFileRel('claude-personal')}`
  const work = JSON.stringify({ pct: 52, at: NOW - 60_000, plan: 'Team', email: 'me@work.test' })
  const files: Record<string, string> = { [FILE]: work }
  const w = world(files, { probe: STREAM, auth: MAX, lock: `${HOME}/.claude-progress/.state/max-usage-claude-personal.probe` })
  expect(await probeWith(w.io, HOME, { key: 'claude-personal', dir })).toBe(true)
  expect(JSON.parse(files[OWN]!)).toEqual({ pct: 37, at: NOW, five: 31, plan: 'Max', email: 'me@home.test' })
  expect(files[FILE]).toBe(work)
  expect(w.ran.filter(a => a[0] === '/bin/sh').every(a => a[5] === dir)).toBe(true)
  expect(w.ran.some(a => a.includes(FILE) || a.includes(LOCK))).toBe(false)
})
