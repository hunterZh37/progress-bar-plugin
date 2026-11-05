import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE } from '../hooks/panel'
import { DEFAULT_TOPOLOGY, HEARTBEAT_MS, TOPOLOGY_REL, bareTitle, flowsOf, jobHost, jobKey, lineWidth, branchOf, parseHealth, parseTopology, placeJobs, plainLine, queuesOf, renderTopology } from '../hooks/topology'
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

test('flows: a helper job reads from the data host, writes back only when it declares writes, services by pattern', async () => {
  const flows = flowsOf(cfg, placeJobs(cfg, JOBS, 'work-mac'))
  const line = (f: { from: string; to: string; label: string; jobs: string[] }) => `${f.from} ${f.label} ${f.to}: ${f.jobs.join(', ')}`
  expect(flows.map(line)).toEqual([
    'work-mac Jev API Jev API: Label top-ups 2021-23',
    'work-mac Claude Claude: Label top-ups 2021-23',
    'work-mac reads hunty: Board lists past 25 seats',
    'hunty writes work-mac: Board lists past 25 seats',
    'work-mac reads personal-mac: Tools setup',
  ])
  // Waiting and process rows move nothing.
  const quiet = flowsOf(cfg, placeJobs(cfg, [job('hunty: x.py', 'hunty: x.py', null, { proc: true }), job('Hunty y', 'Hunty y', null, { mark: '⏸' })], 'work-mac'))
  expect(quiet).toEqual([])
  // Two jobs on one link: the link shows the count.
  const two = flowsOf(cfg, placeJobs(cfg, [job('Hunty a', 'Hunty a', 1), job('Hunty b', 'Hunty b', 2)], 'work-mac'))
  expect(branchOf(two, 'work-mac', 'hunty', false).text).toBe('▼ reads (2)')
  expect(branchOf(two, 'work-mac', 'personal-mac', false).text).toBe('┊')
})

test('the tree: work-mac on top, helpers spread below, what moves on each branch, names are buttons', async () => {
  const rows = renderTopology(input(), 80)
  expect(rows.map(plainLine)).toEqual([
    '                               → Jev API  → Claude',
    '                                   ● work-mac  data host · 1 job',
    '                                        │',
    '                    ┌───────────────────┴───────────────────┐',
    '                    │                                       │',
    '            ▲▼ reads + writes                            ▼ reads',
    '                    │                                       │',
    '                 ● hunty                             ● personal-mac',
    '          1 job · load 0.37/12                            1 job',
  ])
  const presses = rows.flatMap(r => r.segs.filter(s => s.press).map(s => `${s.text}=${s.press}`))
  expect(presses).toEqual(['work-mac=topo:work-mac', 'hunty=topo:hunty', 'personal-mac=topo:personal-mac'])
  // Branch colour is the helper's state: green while data moves.
  expect(rows[5]!.segs.find(s => s.text.includes('reads + writes'))?.color).toBe('green')
  for (const w of [60, 100, 120]) for (const r of renderTopology(input(), w)) expect(lineWidth(r)).toBeLessThanOrEqual(w)
})

test('more helpers: more leaves, the trunk meets the bar in the middle', async () => {
  const three = { ...cfg, machines: [...cfg.machines, { id: 'gpu-box', role: 'compute' as const }] }
  const t = renderTopology(input({ cfg: three, jobs: [JOBS[0]!] }), 100).map(plainLine)
  expect(t[2]).toBe('                ┌────────────────────────────────┼────────────────────────────────┐')
  expect(t[6]).toMatch(/^ +● hunty +● personal-mac +● gpu-box$/)
  expect(t[7]).toMatch(/^ +1 job · load 0\.37\/12 +unknown +unknown$/)
})

test('open: details below the tree, so the tree stays whole, an open job shows reads, writes, step and why', async () => {
  const jobs = [JOBS[0]!, { ...JOBS[1]!, why: 'labels for 2021-23' }, JOBS[2]!, job('Mac jev pass', 'Mac Jev first pass', null, { mark: '⏸', waitOn: 'top-ups' }), job('Mac idle wait', 'Mac idle wait', null, { mark: '⏸' })]
  const open = new Set(['topo:work-mac', 'topo:hunty', jobKey('work-mac', 'mac-label-top-ups-2021-23'), jobKey('hunty', 'Hunty board lists past 25 seats')])
  const rows = renderTopology(input({ jobs }), 80, open)
  const t = rows.map(plainLine)
  // The tree stays whole: the same 9 rows, an open name marked ▾.
  const squash = (l: string) => l.trim().replace(/\s+/g, ' ')
  expect(t.slice(0, 9).map(squash)).toEqual(renderTopology(input({ jobs }), 80).map(plainLine).map(l => squash(l).replace(/● (work-mac|hunty)\b/, '● $1 ▾')))
  expect(t.slice(9)).toEqual([
    '',
    '▾ ● work-mac  data host · 1 job',
    '    ▾ Label top-ups 2021-23             97%',
    '        step: Claude pass: workforce',
    '        why: labels for 2021-23',
    '    ▸ Jev first pass                    waits',
    '    → Jev API · Claude',
    '    2 queued',
    '',
    '▾ ● hunty  1 job · load 0.37/12',
    '    ▾ Board lists past 25 seats         83%  reads + writes',
    '        reads: nombot.board_members_history',
    '        writes: Postgres via work-mac',
    '    1 queued',
  ])
  expect(rows[18]!.press).toBe('topo:hunty')
  // A helper job without reads says where it reads from, and it is not drawn writing.
  const p = renderTopology(input(), 80, new Set(['topo:personal-mac', jobKey('personal-mac', 'Personal-mac tools setup')])).map(plainLine)
  expect(p.slice(-2)).toEqual(['    ▾ Tools setup                       60%  reads', '        reads: work-mac database as helper'])
})

test('under 60 columns: a tree down the left', async () => {
  expect(text(50)).toEqual([
    '● work-mac  data host · 1 job  → Jev API  → Claude',
    '├─ ▲▼ reads + writes ── ● hunty  1 job · load 0.3…',
    '└─ ▼ reads ── ● personal-mac  1 job',
  ])
})

test('offline: a stale or failing heartbeat draws the helper and its branch red', async () => {
  expect(parseHealth('▶ hunty ✓ helper healthy · load 0.22 on 12 cores · idle\n▶ hunty: job 10.0%', NOW, NOW)).toEqual({ state: 'online', load: 'load 0.22/12' })
  expect(parseHealth('▶ hunty ✓ ok', NOW - HEARTBEAT_MS - 60_000, NOW)).toEqual({ state: 'offline', note: 'heartbeat 3m old' })
  expect(parseHealth('▶ hunty ✗ helper down', NOW, NOW).state).toBe('offline')
  expect(parseHealth(null, 0, NOW)).toEqual({ state: 'offline', note: 'no heartbeat file' })
  const rows = renderTopology(input({ jobs: [JOBS[1]!], health: { hunty: { state: 'offline' } } }), 80, new Set(['topo:hunty']))
  const t = rows.map(plainLine)
  expect(t[5]).toBe('                ✕ offline                                   ┊')
  expect(rows[5]!.segs.find(s => s.text === '✕ offline')?.color).toBe('red')
  expect(rows[4]!.segs.filter(s => s.text === '│').map(s => s.color ?? (s.dim ? 'dim' : ''))).toEqual(['red', 'dim'])
  expect(rows[7]!.segs.find(s => s.text === '● ')?.color).toBe('red')
  expect(t.slice(-3)).toEqual(['▾ ● hunty  offline', '    unreachable', '    1 queued'])
})

test('a slug name that starts with a machine word runs on that machine', async () => {
  expect(jobHost(cfg, 'mac-label-top-ups-2021-23', 'mac-label-top-ups-2021-23', 'hunty')).toBe('work-mac')
  expect(jobHost(cfg, 'hunty-interlocks', 'hunty-interlocks', 'work-mac')).toBe('hunty')
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
  expect((await ui.find({ type: 'Button', key: 'tab-topology' }))?.text).toBe('🌐')
  await ui.press({ key: 'tab-topology' })
  expect(JSON.parse(files[`${D}/${TOPOLOGY_REL.split('/').pop()}`]!).machines[1].ip).toBe('100.66.167.126')
  // Closed: one row per machine. Opening hunty shows its job, opening the job shows what it reads.
  expect((await ui.find({ type: 'Button', key: 'tpn-topo:hunty' }))?.text).toBe('hunty')
  expect((await ui.find({ type: 'Text', text: /reads/ }))?.text).toBe('▼ reads')
  expect(await ui.find({ type: 'Text', text: /Board lists/ })).toBe(undefined)
  await ui.press({ key: 'tpn-topo:hunty' })
  expect((await ui.find({ type: 'Button', key: 'tpn-topo:hunty' }))?.text).toBe('hunty ▾')
  expect((await ui.find({ type: 'Button', key: 'tpb-topo:hunty:hunty-board-lists' }))?.text).toMatch(/^ +▸ Board lists +83% +reads$/)
  await ui.press({ key: 'tpb-topo:hunty:hunty-board-lists' })
  expect((await ui.find({ type: 'Text', text: 'nombot.board_members_history' }))?.text).toBe('nombot.board_members_history')
  await ui.press({ key: 'tpb-topo:hunty' })
  expect(await ui.find({ type: 'Text', text: /Board lists/ })).toBe(undefined)
  await ui.unmount()
})
