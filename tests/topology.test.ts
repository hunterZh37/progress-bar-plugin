import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE } from '../hooks/panel'
import { DEFAULT_TOPOLOGY, HEARTBEAT_MS, TOPOLOGY_REL, bareTitle, flowsOf, jobHost, lineWidth, parseHealth, parseTopology, placeJobs, plainLine, queuesOf, renderTopology } from '../hooks/topology'
import type { TopoInput, TopoJob } from '../hooks/topology'
import { statusScript } from '../hooks/render'

const NOW = 1_800_000_000_000
const cfg = DEFAULT_TOPOLOGY
const job = (name: string, title: string, pct: number | null, extra: Partial<TopoJob> = {}): TopoJob => ({ name, title, pct, mark: '▶', step: '', ...extra })

const JOBS: TopoJob[] = [
  job('Hunty board lists past 25 seats', 'Hunty board lists past 25 seats', 83.3, { reads: 'nombot.board_members_history', writes: 'Postgres via work-mac' }),
  job('mac-label-top-ups-2021-23', 'Mac label top-ups 2021-23', 97, { step: 'Claude pass: workforce' }),
  job('Personal-mac tools setup', 'Personal-mac tools setup', 60),
]
const input = (over: Partial<TopoInput> = {}): TopoInput => ({
  cfg,
  self: 'work-mac',
  jobs: JOBS,
  health: { hunty: { state: 'online', load: 'load 0.37/12' } },
  queues: queuesOf(cfg, [{ owner: 'work-mac', text: '1. NomBot eval rerun (after Mac label top-ups)' }, { owner: 'work-mac', text: '2. Grade sample' }, { owner: 'hunty', text: '1. Fix grants linked back' }], 'work-mac'),
  ...over,
})
const text = (w: number, over: Partial<TopoInput> = {}) => renderTopology(input(over), w).map(plainLine)

test('topology.json: defaults for a bad file, ids and aliases lowercased, bad services dropped', async () => {
  expect(parseTopology('nope')).toBe(DEFAULT_TOPOLOGY)
  const c = parseTopology(JSON.stringify({ self: 'Box', machines: [{ id: 'Box', role: 'data', aliases: ['B'] }, { ip: 'x' }], services: [{ name: 'X', match: '(' }, { name: 'Y', match: 'y' }] }))
  expect(c.self).toBe('box')
  expect(c.machines).toEqual([{ id: 'box', ip: undefined, role: 'data', aliases: ['b'], about: undefined, status: undefined }])
  expect(c.services).toEqual([{ name: 'Y', match: 'y', from: undefined }])
  expect(parseTopology('{}').machines).toBe(DEFAULT_TOPOLOGY.machines)
})

test('jobs land on machines from the title lead, a host prefix, else this machine', async () => {
  expect(jobHost(cfg, 'Hunty board lists', 'Hunty board lists', 'work-mac')).toBe('hunty')
  expect(jobHost(cfg, 'hunty: interlocks_years.py', 'hunty: interlocks_years.py', 'work-mac')).toBe('hunty')
  expect(jobHost(cfg, 'Personal-mac tools setup', 'Personal-mac tools setup', 'work-mac')).toBe('personal-mac')
  expect(jobHost(cfg, 'mac-label-top-ups', 'Mac label top-ups', 'work-mac')).toBe('work-mac')
  expect(jobHost(cfg, 'box: x', 'x', 'work-mac')).toBe('box')
  expect(jobHost(cfg, 'nightly', 'Nightly import', 'work-mac')).toBe('work-mac')
  expect(bareTitle(cfg, 'Hunty board lists past 25 seats', 'hunty')).toBe('Board lists past 25 seats')
  expect(bareTitle(cfg, 'Mac label top-ups 2021-23 · all', 'work-mac')).toBe('Label top-ups 2021-23')
})

test('flows: declared reads and writes, else inferred for a helper job, services by pattern', async () => {
  const flows = flowsOf(cfg, placeJobs(cfg, JOBS, 'work-mac'))
  const line = (f: { from: string; to: string; label: string; jobs: string[] }) => `${f.from} ──${f.label}──▶ ${f.to ? `${f.to}: ` : ''}${f.jobs.join(', ')}`
  expect(flows.map(line)).toEqual([
    'work-mac ──Jev API──▶ Label top-ups 2021-23',
    'work-mac ──Claude──▶ Label top-ups 2021-23',
    'work-mac ──reads nombot.board_members_history──▶ hunty: Board lists past 25 seats',
    'hunty ──writes Postgres via work-mac──▶ work-mac (DB write): Board lists past 25 seats',
    'work-mac ──reads (helper)──▶ personal-mac: Tools setup',
    'personal-mac ──results──▶ work-mac (DB write): Tools setup',
  ])
  // A data host job draws what it declares, against Postgres. Waiting and process rows move nothing.
  const local = flowsOf(cfg, placeJobs(cfg, [job('rebuild', 'Rebuild links', 10, { writes: 'nombot.links' }), job('hunty: x.py', 'hunty: x.py', null, { proc: true }), job('Hunty y', 'Hunty y', null, { mark: '⏸' })], 'work-mac'))
  expect(local.map(line)).toEqual(['work-mac ──writes nombot.links──▶ Postgres: Rebuild links'])
})

test('render at 100 columns: data host left, helpers right, links, queued to-dos, flows and services', async () => {
  const out = renderTopology(input(), 100)
  for (const l of out) expect(lineWidth(l)).toBeLessThanOrEqual(100)
  const t = out.map(plainLine)
  expect(t[0]).toMatch(/^┌─ work-mac · 100\.78\.76\.82 ─+┐ {5}┌─ hunty · 100\.66\.167\.126 ─+┐$/)
  expect(t[1]).toMatch(/^│ ● busy · 1 job · data host +├◀───▶┤ ● busy · 1 job · load 0\.37\/12 +│$/)
  expect(t.some(l => /▶ Label top-ups 2021-23 +97% │/.test(l))).toBe(true)
  expect(t.some(l => /▶ Board lists past 25 seats +83% │$/.test(l))).toBe(true)
  expect(t.some(l => /├◀───▶┤ ● busy · 1 job +│$/.test(l))).toBe(true)
  expect(t.some(l => /☐ 2 queued · next: NomBot eval rerun/.test(l))).toBe(true)
  expect(t.some(l => /☐ 1 queued · next: Fix grants linked back/.test(l))).toBe(true)
  expect(t).toContain('FLOWS NOW')
  expect(t).toContain('  hunty ──writes Postgres via work-mac──▶ work-mac (DB write): Board lists past 25 seats')
  expect(t).toContain('SERVICES   ● Jev API  ● Claude  ○ GitHub')
  expect(t).toContain('  personal-mac: reachability unknown, no heartbeat configured')
})

test('render at 60 columns: every line fits, boxes still side by side', async () => {
  const out = renderTopology(input(), 60)
  for (const l of out) expect(lineWidth(l)).toBeLessThanOrEqual(60)
  const t = out.map(plainLine)
  expect(t[0]).toBe('┌─ work-mac ──────────────┐     ┌─ hunty · 100.66.167.126 ─┐')
  expect(t.some(l => l.includes('├◀───▶┤'))).toBe(true)
  expect(t).toContain('  work-mac ──reads nombot.board_members_history──▶ hunty: B…')
})

test('under 60 columns: a stacked list', async () => {
  const t = text(40)
  expect(t.slice(0, 4)).toEqual(['● work-mac  busy · 1 job · data host', '  100.78.76.82', '  ▶ Label top-ups 2021-23           97%', '  ☐ 2 queued · next: NomBot eval rerun'])
  expect(t).toContain('● hunty  busy · 1 job · load 0.37/12')
})

test('offline: a stale or failing heartbeat draws the helper red with ──✕── and says why', async () => {
  expect(parseHealth('▶ hunty ✓ helper healthy · load 0.22 on 12 cores · idle\n▶ hunty: job 10.0%', NOW, NOW)).toEqual({ state: 'online', load: 'load 0.22/12' })
  expect(parseHealth('▶ hunty ✓ ok', NOW - HEARTBEAT_MS - 60_000, NOW)).toEqual({ state: 'offline', note: 'heartbeat 3m old' })
  expect(parseHealth('▶ hunty ✗ helper down', NOW, NOW).state).toBe('offline')
  expect(parseHealth(null, 0, NOW)).toEqual({ state: 'offline', note: 'no heartbeat file' })
  const out = renderTopology(input({ jobs: [JOBS[1]!], health: { hunty: { state: 'offline', note: 'heartbeat 3m old' } } }), 100)
  const t = out.map(plainLine)
  expect(t[1]).toMatch(/├──✕──┤ ● offline +│$/)
  expect(out[1]!.find(s => s.text === '──✕──')?.color).toBe('red')
  expect(out[0]!.find(s => s.text.startsWith('┌─ hunty'))?.color).toBe('red')
  expect(t.some(l => /│ unreachable +│$/.test(l))).toBe(true)
  expect(t).toContain('  hunty: offline, heartbeat 3m old')
  // Personal-mac: no jobs, no heartbeat: unknown and dim, its link dotted.
  expect(t.some(l => /├┄┄┄┄┄┤ ● unknown +│$/.test(l))).toBe(true)
  // Busy draws green.
  expect(out[0]!.find(s => s.text.startsWith('┌─ work-mac'))?.color).toBe('green')
})

/** A world for the panel with the status script answering `full`. */
function world(on: On, files: Record<string, string>, full: string) {
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/u' })
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] as never }))
  on('fs.list', (_, e) => ({ value: Object.keys(files).filter(f => f.startsWith(`${e.path}/`) && !f.slice(e.path.length + 1).includes('/')).map(f => ({ name: f.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }))
  on('fs.read', (_, e) => {
    const t = files[e.path]
    if (t === undefined) throw new Error('ENOENT')
    return { value: t }
  })
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('settings.read', () => ({ value: {} as never }))
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: e.argv[1]?.endsWith('statusline.sh') ? full : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] as never }))
}

test('the Topology tab: writes topology.json once, draws jobs from progress files with their reads', async ($, on) => {
  const D = '/home/u/.claude-progress'
  const files: Record<string, string> = {
    '/home/u/.claude/progress-bar/statusline.sh': statusScript(),
    [`${D}/.state/panel-on`]: 'on\n',
    [`${D}/todo.txt`]: '[work-mac]\n1. Eval rerun\n[hunty]\n1. Fix grants\n',
    [`${D}/hunty-board-lists.json`]: JSON.stringify({ done: 5, total: 6, title: 'Hunty board lists', reads: 'nombot.board_members_history' }),
    [`${D}/.lines/linux.txt`]: '▶ hunty ✓ helper healthy · load 0.37 on 12 cores\n',
  }
  world(on, files, ['▾ ▶ RUNNING', '  ◑ Hunty board lists █████████████████░░░ 83.3% · 5/6 · rebuilding'].join('\n'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Status', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  expect((await ui.find({ type: 'Button', key: 'tab-topology' }))?.text).toBe(' Topology')
  await ui.press({ key: 'tab-topology' })
  expect(JSON.parse(files[`${D}/${TOPOLOGY_REL.split('/').pop()}`]!).machines[1].ip).toBe('100.66.167.126')
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts.some(t => /▶ Board lists +83%$/.test(t))).toBe(true)
  expect(texts).toContain(' ──reads nombot.board_members_history──▶ ')
  expect(texts.some(t => /load 0\.37\/12/.test(t))).toBe(true)
  await ui.unmount()
})
