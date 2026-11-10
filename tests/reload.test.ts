import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

import { CONN_CACHE_REL } from '../hooks/connectors'
import { claim, every, newOwner, ownerRel, owns } from '../hooks/owner'
import { agentsRel } from '../hooks/register'
import { sessionKeyOf } from '../hooks/route'

// After /reload-plugins the copy it replaced could keep its timers: two copies wrote the same line files and a
// running agent's row came and went. One copy owns the session, and the running agents survive a reload.

const NOW = 1_800_000_000_000
const HOME = '/home/u'
const P = `${HOME}/.claude-progress`
const L = `${P}/.lines`
const SID = '72877508-177c-4da3-b953-73c7819590f2'
const KEY = sessionKeyOf(SID)
const CWD = '/home/u/code/shop'

function world(on: On, files: Record<string, string>, agents: unknown[] = []) {
  files[`${HOME}/${CONN_CACHE_REL}`] ??= `#checked\t${Math.floor(NOW / 1000)}\n`
  mock.env(on, { HOME })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('clock.sleep', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: agents as never }))
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__progress-bar__${e.name}` } }))
  on('fs.list', (_, e) => ({ value: Object.keys(files).filter(f => f.startsWith(`${e.path}/`) && !f.slice(e.path.length + 1).includes('/')).map(f => ({ name: f.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }))
  on('fs.read', (_, e) => { const t = files[String(e.path)]; if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.write', (_, e) => { files[String(e.path)] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: String(e.path) in files }))
  on('fs.stat', (_, e) => { if (!(String(e.path) in files)) throw new Error('ENOENT'); return { value: { size: 1, mtimeMs: NOW } as never } })
  on('settings.read', () => ({ value: {} as never }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] as never }))
  on('ui.toast', () => ({ value: undefined }))
}

const settle = ($: { tool: { call: (i: never) => Promise<unknown> } }) => $.tool.call({ tool: 'mcp__progress-bar__progress_report', title: 'kick', finished: true } as never)
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

test('two copies on one session: once the second starts only it writes, and the line file holds across polls', async () => {
  const files: Record<string, string> = {}
  const ticks: (() => void)[] = []
  let cancelled = 0
  const $ = {
    clock: { every: (_: number, fn: () => void) => { ticks.push(fn); return { cancel: () => { cancelled += 1; ticks.splice(ticks.indexOf(fn), 1) } } } },
    fs: {
      read: async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p] },
      write: async (p: string, t: string) => { files[p] = t },
    },
  } as unknown as EngineInterface
  const out = `${L}/agents-${KEY}.txt`
  const start = async (at: number, row: string) => {
    const o = newOwner(at)
    await claim($, o, HOME, KEY, at)
    every($, o, 5000, () => { files[out] = row }, () => owns($, o, HOME, KEY))
    return o
  }
  // The old copy knew the agent; the new one does not and would write an empty file.
  const a = await start(NOW, '▶ NomBot org locations near me')
  for (const t of [...ticks]) t()
  await flush()
  expect(files[out]).toBe('▶ NomBot org locations near me')
  const b = await start(NOW + 1, '')
  expect(JSON.parse(files[`${HOME}/${ownerRel(KEY)}`]!).id).toBe(b.id)
  const seenOut: string[] = []
  for (let i = 0; i < 6; i++) {
    for (const t of [...ticks]) t()
    await flush()
    seenOut.push(files[out]!)
  }
  // The old copy stopped at its first tick after the claim: its timer is cancelled and it never writes again.
  expect(new Set(seenOut).size).toBe(1)
  expect(seenOut[0]).toBe('')
  expect(a.stopped).toBe(true)
  expect(cancelled).toBe(1)
  expect(ticks.length).toBe(1)
  expect(await owns($, b, HOME, KEY)).toBe(true)
})

test('a copy whose session another copy claimed writes no line files', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files, [{ id: 'ag1', description: 'Crawl sites', status: 'running' }])
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect(files[`${L}/agents-${KEY}.txt`]).toMatch(/Crawl sites/)
  // A newer copy claims the session and writes its own lines.
  files[`${HOME}/${ownerRel(KEY)}`] = JSON.stringify({ id: 'newer', at: NOW + 1 })
  files[`${L}/agents-${KEY}.txt`] = 'newer copy'
  await settle($ as never)
  await settle($ as never)
  expect(files[`${L}/agents-${KEY}.txt`]).toBe('newer copy')
})

test('reload with a running agent: the new copy shows it from saved state, paired with its slug-named file', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {
    // No session, no startedAt: named exactly the slug of the agent's description.
    [`${P}/nombot-org-locations-near-me.json`]: JSON.stringify({ done: 2, total: 4, step: 'probing orgs', title: 'NomBot org locations near me', cwd: '/elsewhere' }),
    [`${P}/${agentsRel(KEY)}`]: JSON.stringify({ agents: { ag9: { description: 'NomBot org locations near me', startedAt: NOW - 3_600_000, status: 'running', lastAt: NOW - 60_000 } } }),
  }
  // The engine's list in the new copy does not name the agent started before it loaded.
  world(on, files, [])
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 3; i++) {
    await settle($ as never)
    const rows = (files[`${L}/agents-${KEY}.txt`] ?? '').split('\n').filter(Boolean)
    expect(rows).toEqual([expect.stringMatching(/^▶ NomBot org locations near me .*50\.0% · 2\/4 · probing orgs/)])
    expect(files[`${L}/jobs-${KEY}.txt`] ?? '').not.toMatch(/nombot/)
  }
  const saved = JSON.parse(files[`${P}/${agentsRel(KEY)}`]!)
  expect(saved.agents.ag9).toMatchObject({ description: 'NomBot org locations near me', startedAt: NOW - 3_600_000, file: 'nombot-org-locations-near-me' })
  expect(saved.files['nombot-org-locations-near-me']).toBe(NOW)
})

test('reload: a saved pairing with a differently named file holds, and that file routes to this session without `session`', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {
    [`${P}/waytomatter-hold-hope.json`]: JSON.stringify({ done: 1, total: 4, step: 'reading', title: 'Hope waits for the list' }),
    [`${P}/${agentsRel(KEY)}`]: JSON.stringify({ agents: { ag5: { description: 'Hold Hope until org list plays', startedAt: NOW - 600_000, status: 'running', lastAt: NOW, file: 'waytomatter-hold-hope' } }, files: { 'waytomatter-hold-hope': NOW } }),
  }
  world(on, files, [{ id: 'ag5', description: 'Hold Hope until org list plays', status: 'running' }])
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect((files[`${L}/agents-${KEY}.txt`] ?? '').split('\n').filter(Boolean)).toEqual([expect.stringMatching(/^▶ Hold Hope until org list plays .*25\.0% · 1\/4 · reading/)])
  expect(JSON.parse(files[`${P}/.state/pairs-${KEY}.json`]!)).toEqual({ 'hold-hope-until-org-list-plays': 'waytomatter-hold-hope' })
})

test('saved agents leave once finished, or silent past the abandoned window', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {
    [`${P}/${agentsRel(KEY)}`]: JSON.stringify({ agents: {
      old: { description: 'Long gone job', startedAt: NOW - 9 * 3_600_000, status: 'running', lastAt: NOW - 7 * 3_600_000 },
      fin: { description: 'Finished one', startedAt: NOW - 600_000, status: 'running', lastAt: NOW },
    } }),
  }
  world(on, files, [{ id: 'fin', description: 'Finished one', status: 'completed' }])
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect(files[`${L}/agents-${KEY}.txt`] ?? '').toBe('')
  expect(JSON.parse(files[`${P}/${agentsRel(KEY)}`]!).agents).toEqual({})
})
