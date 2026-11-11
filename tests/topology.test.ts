import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE } from '../hooks/panel'
import { DEFAULT_TOPOLOGY, HEARTBEAT_MS, defaultTopology, TOPOLOGY_REL, bareTitle, flowsOf, jobHost, jobKey, lineWidth, branchOf, parseHealth, parseTopology, placeJobs, plainLine, queuesOf, renderTopology } from '../hooks/topology'
import type { TopoInput, TopoJob } from '../hooks/topology'
import { statusScript } from '../hooks/render'

const NOW = 1_800_000_000_000
// A person's own topology.json: a data host, a Linux helper with a heartbeat file and a spare laptop.
const MINE = {
  dbRole: 'helper',
  machines: [
    { id: 'home-mac', ip: '10.0.0.2', role: 'data' as const, aliases: ['mac', 'local'], about: ['Postgres app ~2 GB'] },
    { id: 'linux', ip: '10.0.0.3', role: 'compute' as const, about: ['12 cores + GPU'], status: 'linux.txt' },
    { id: 'spare-laptop', ip: '10.0.0.4', role: 'compute' as const, aliases: ['spare'] },
  ],
  services: [
    { name: 'Map API', match: '\\bmap\\b|label', from: 'home-mac' },
    { name: 'Claude', match: '\\bclaude\\b' },
    { name: 'GitHub', match: 'github|git push|\\bpr\\b' },
  ],
}
const cfg = parseTopology(JSON.stringify(MINE))
const job = (name: string, title: string, pct: number | null, extra: Partial<TopoJob> = {}): TopoJob => ({ name, title, pct, mark: '▶', step: '', ...extra })

const JOBS: TopoJob[] = [
  job('Linux board lists past 25 seats', 'Linux board lists past 25 seats', 83.3, { reads: 'app.orders_history', writes: 'Postgres via home-mac' }),
  job('mac-label-top-ups-2021-23', 'Mac label top-ups 2021-23', 97, { step: 'Claude pass: workforce' }),
  job('Spare-laptop tools setup', 'Spare-laptop tools setup', 60),
]
const input = (over: Partial<TopoInput> = {}): TopoInput => ({
  cfg,
  self: 'home-mac',
  jobs: JOBS,
  health: { linux: { state: 'online', load: 'load 0.37/12' } },
  queues: queuesOf(cfg, [{ owner: 'home-mac', text: '1. Eval rerun (after Mac label top-ups)' }, { owner: 'home-mac', text: '2. Grade sample' }, { owner: 'linux', text: '1. Fix grants linked back' }], 'home-mac'),
  ...over,
})
const text = (w: number, over: Partial<TopoInput> = {}) => renderTopology(input(over), w).map(plainLine)

test('the default is this machine alone: its host name, no IPs, no services, no heartbeat', async () => {
  expect(defaultTopology('Box-1.local')).toEqual({ dbRole: 'helper', machines: [{ id: 'box-1.local', role: 'data', aliases: ['local'] }], services: [] })
  expect(defaultTopology('')).toEqual({ dbRole: 'helper', machines: [{ id: 'local', role: 'data' }], services: [] })
  expect(DEFAULT_TOPOLOGY.machines.length).toBe(1)
  expect(JSON.stringify(DEFAULT_TOPOLOGY)).not.toMatch(/\d+\.\d+\.\d+\.\d+|status/)
  // A bad file falls back to the base it is given (this machine).
  expect(parseTopology('nope', defaultTopology('box'))).toEqual(defaultTopology('box'))
})

test('topology.json: defaults for a bad file, ids and aliases lowercased, bad services dropped', async () => {
  expect(parseTopology('nope')).toBe(DEFAULT_TOPOLOGY)
  const c = parseTopology(JSON.stringify({ self: 'Box', machines: [{ id: 'Box', role: 'data', aliases: ['B'] }, { ip: 'x' }], services: [{ name: 'X', match: '(' }, { name: 'Y', match: 'y' }] }))
  expect(c.self).toBe('box')
  expect(c.machines).toEqual([{ id: 'box', ip: undefined, role: 'data', aliases: ['b'], about: undefined, status: undefined }])
  expect(c.services).toEqual([{ name: 'Y', match: 'y', from: undefined }])
  expect(parseTopology('{}').machines).toBe(DEFAULT_TOPOLOGY.machines)
})

test('jobs land on machines from the title lead, a host prefix, else this machine', async () => {
  expect(jobHost(cfg, 'Linux board lists', 'Linux board lists', 'home-mac')).toBe('linux')
  expect(jobHost(cfg, 'linux: interlocks_years.py', 'linux: interlocks_years.py', 'home-mac')).toBe('linux')
  expect(jobHost(cfg, 'Spare-laptop tools setup', 'Spare-laptop tools setup', 'home-mac')).toBe('spare-laptop')
  expect(jobHost(cfg, 'mac-label-top-ups', 'Mac label top-ups', 'home-mac')).toBe('home-mac')
  expect(jobHost(cfg, 'box: x', 'x', 'home-mac')).toBe('box')
  expect(jobHost(cfg, 'nightly', 'Nightly import', 'home-mac')).toBe('home-mac')
  expect(bareTitle(cfg, 'Linux board lists past 25 seats', 'linux')).toBe('Board lists past 25 seats')
  expect(bareTitle(cfg, 'Mac label top-ups 2021-23 · all', 'home-mac')).toBe('Label top-ups 2021-23')
})

test('flows: a helper job reads from the data host, writes back only when it declares writes, services by pattern', async () => {
  const flows = flowsOf(cfg, placeJobs(cfg, JOBS, 'home-mac'))
  const line = (f: { from: string; to: string; label: string; jobs: string[] }) => `${f.from} ${f.label} ${f.to}: ${f.jobs.join(', ')}`
  expect(flows.map(line)).toEqual([
    'home-mac Map API Map API: Label top-ups 2021-23',
    'home-mac Claude Claude: Label top-ups 2021-23',
    'home-mac reads linux: Board lists past 25 seats',
    'linux writes home-mac: Board lists past 25 seats',
    'home-mac reads spare-laptop: Tools setup',
  ])
  // Waiting and process rows move nothing.
  const quiet = flowsOf(cfg, placeJobs(cfg, [job('linux: x.py', 'linux: x.py', null, { proc: true }), job('Linux y', 'Linux y', null, { mark: '⏸' })], 'home-mac'))
  expect(quiet).toEqual([])
  // Two jobs on one link: the link shows the count.
  const two = flowsOf(cfg, placeJobs(cfg, [job('Linux a', 'Linux a', 1), job('Linux b', 'Linux b', 2)], 'home-mac'))
  expect(branchOf(two, 'home-mac', 'linux', false).text).toBe('▼ reads (2)')
  expect(branchOf(two, 'home-mac', 'spare-laptop', false).text).toBe('┊')
})

test('the tree: home-mac on top, helpers spread below, what moves on each branch, names are buttons', async () => {
  const rows = renderTopology(input(), 80)
  expect(rows.map(plainLine)).toEqual([
    '                               → Map API  → Claude',
    '                                   ● home-mac  data host · 1 job',
    '                                        │',
    '                    ┌───────────────────┴───────────────────┐',
    '                    │                                       │',
    '            ▲▼ reads + writes                            ▼ reads',
    '                    │                                       │',
    '                 ● linux                             ● spare-laptop',
    '          1 job · load 0.37/12                            1 job',
  ])
  const presses = rows.flatMap(r => r.segs.filter(s => s.press).map(s => `${s.text}=${s.press}`))
  expect(presses).toEqual(['home-mac=topo:home-mac', 'linux=topo:linux', 'spare-laptop=topo:spare-laptop'])
  // Branch colour is the helper's state: green while data moves.
  expect(rows[5]!.segs.find(s => s.text.includes('reads + writes'))?.color).toBe('green')
  for (const w of [60, 100, 120]) for (const r of renderTopology(input(), w)) expect(lineWidth(r)).toBeLessThanOrEqual(w)
})

test('more helpers: more leaves, the trunk meets the bar in the middle', async () => {
  const three = { ...cfg, machines: [...cfg.machines, { id: 'gpu-box', role: 'compute' as const }] }
  const t = renderTopology(input({ cfg: three, jobs: [JOBS[0]!] }), 100).map(plainLine)
  expect(t[2]).toBe('                ┌────────────────────────────────┼────────────────────────────────┐')
  expect(t[6]).toMatch(/^ +● linux +● spare-laptop +● gpu-box$/)
  expect(t[7]).toMatch(/^ +1 job · load 0\.37\/12 +unknown +unknown$/)
})

test('open: details below the tree, so the tree stays whole, an open job shows reads, writes, step and why', async () => {
  const jobs = [JOBS[0]!, { ...JOBS[1]!, why: 'labels for 2021-23' }, JOBS[2]!, job('Mac map pass', 'Mac Map first pass', null, { mark: '⏸', waitOn: 'top-ups' }), job('Mac idle wait', 'Mac idle wait', null, { mark: '⏸' })]
  const open = new Set(['topo:home-mac', 'topo:linux', jobKey('home-mac', 'mac-label-top-ups-2021-23'), jobKey('linux', 'Linux board lists past 25 seats')])
  const rows = renderTopology(input({ jobs }), 80, open)
  const t = rows.map(plainLine)
  // The tree stays whole: the same 9 rows, an open name marked ▾.
  const squash = (l: string) => l.trim().replace(/\s+/g, ' ')
  expect(t.slice(0, 9).map(squash)).toEqual(renderTopology(input({ jobs }), 80).map(plainLine).map(l => squash(l).replace(/● (home-mac|linux)\b/, '● $1 ▾')))
  expect(t.slice(9)).toEqual([
    '',
    '▾ ● home-mac  data host · 1 job',
    '    ▾ Label top-ups 2021-23             97%',
    '        step: Claude pass: workforce',
    '        why: labels for 2021-23',
    '    ▸ Map first pass                    waits',
    '    → Map API · Claude',
    '    2 queued',
    '',
    '▾ ● linux  1 job · load 0.37/12',
    '    ▾ Board lists past 25 seats         83%  reads + writes',
    '        reads: app.orders_history',
    '        writes: Postgres via home-mac',
    '    1 queued',
  ])
  expect(rows[18]!.press).toBe('topo:linux')
  // A helper job without reads says where it reads from, and it is not drawn writing.
  const p = renderTopology(input(), 80, new Set(['topo:spare-laptop', jobKey('spare-laptop', 'Spare-laptop tools setup')])).map(plainLine)
  expect(p.slice(-2)).toEqual(['    ▾ Tools setup                       60%  reads', '        reads: home-mac database as helper'])
})

test('under 60 columns: a tree down the left', async () => {
  expect(text(50)).toEqual([
    '● home-mac  data host · 1 job  → Map API  → Claude',
    '├─ ▲▼ reads + writes ── ● linux  1 job · load 0.3…',
    '└─ ▼ reads ── ● spare-laptop  1 job',
  ])
})

test('offline: a stale or failing heartbeat draws the helper and its branch red', async () => {
  expect(parseHealth('▶ linux ✓ helper healthy · load 0.22 on 12 cores · idle\n▶ linux: job 10.0%', NOW, NOW)).toEqual({ state: 'online', load: 'load 0.22/12' })
  expect(parseHealth('▶ linux ✓ ok', NOW - HEARTBEAT_MS - 60_000, NOW)).toEqual({ state: 'offline', note: 'heartbeat 3m old' })
  expect(parseHealth('▶ linux ✗ helper down', NOW, NOW).state).toBe('offline')
  expect(parseHealth(null, 0, NOW)).toEqual({ state: 'offline', note: 'no heartbeat file' })
  const rows = renderTopology(input({ jobs: [JOBS[1]!], health: { linux: { state: 'offline' } } }), 80, new Set(['topo:linux']))
  const t = rows.map(plainLine)
  expect(t[5]).toBe('                ✕ offline                                   ┊')
  expect(rows[5]!.segs.find(s => s.text === '✕ offline')?.color).toBe('red')
  expect(rows[4]!.segs.filter(s => s.text === '│').map(s => s.color ?? (s.dim ? 'dim' : ''))).toEqual(['red', 'dim'])
  expect(rows[7]!.segs.find(s => s.text === '● ')?.color).toBe('red')
  expect(t.slice(-3)).toEqual(['▾ ● linux  offline', '    unreachable', '    1 queued'])
})

test('a slug name that starts with a machine word runs on that machine', async () => {
  expect(jobHost(cfg, 'mac-label-top-ups-2021-23', 'mac-label-top-ups-2021-23', 'linux')).toBe('home-mac')
  expect(jobHost(cfg, 'linux-interlocks', 'linux-interlocks', 'home-mac')).toBe('linux')
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

test('the Topology tab: no topology.json shows this machine alone and writes nothing', async ($, on) => {
  const D = '/home/u/.claude-progress'
  const files: Record<string, string> = {
    '/home/u/.claude/progress-bar/statusline.sh': statusScript(),
    [`${D}/.state/panel-on`]: 'on\n',
    [`${D}/.lines/linux.txt`]: '▶ linux ✓ helper healthy\n',
  }
  world(on, files, '▾ ▶ RUNNING')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Status', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  await ui.press({ key: 'tab-topology' })
  expect(files[`${D}/topology.json`]).toBe(undefined)
  expect((await ui.find({ type: 'Button', key: 'tpn-topo:local' }))?.text).toBe('local')
  expect(await ui.find({ type: 'Button', key: 'tpn-topo:linux' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /offline/ })).toBe(undefined)
  await ui.unmount()
})

test('the Topology tab: reads the person own topology.json, never rewrites it, draws jobs with their reads', async ($, on) => {
  const D = '/home/u/.claude-progress'
  const mine = `${JSON.stringify(MINE, null, 1)}\n`
  const files: Record<string, string> = {
    '/home/u/.claude/progress-bar/statusline.sh': statusScript(),
    [`${D}/topology.json`]: mine,
    [`${D}/.state/panel-on`]: 'on\n',
    [`${D}/todo.txt`]: '[home-mac]\n1. Eval rerun\n[linux]\n1. Fix grants\n',
    [`${D}/linux-board-lists.json`]: JSON.stringify({ done: 5, total: 6, title: 'Linux board lists', reads: 'app.orders_history' }),
    [`${D}/.lines/linux.txt`]: '▶ linux ✓ helper healthy · load 0.37 on 12 cores\n',
  }
  world(on, files, ['▾ ▶ RUNNING', '  ◑ Linux board lists █████████████████░░░ 83.3% · 5/6 · rebuilding'].join('\n'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Status', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  expect((await ui.find({ type: 'Button', key: 'tab-topology' }))?.text).toBe('Topology')
  await ui.press({ key: 'tab-topology' })
  expect(files[`${D}/${TOPOLOGY_REL.split('/').pop()}`]).toBe(mine)
  // Closed: one row per machine. Opening linux shows its job, opening the job shows what it reads.
  expect((await ui.find({ type: 'Button', key: 'tpn-topo:linux' }))?.text).toBe('linux')
  expect((await ui.find({ type: 'Text', text: /reads/ }))?.text).toBe('▼ reads')
  expect(await ui.find({ type: 'Text', text: /Board lists/ })).toBe(undefined)
  await ui.press({ key: 'tpn-topo:linux' })
  expect((await ui.find({ type: 'Button', key: 'tpn-topo:linux' }))?.text).toBe('linux ▾')
  expect((await ui.find({ type: 'Button', key: 'tpb-topo:linux:linux-board-lists' }))?.text).toMatch(/^ +▸ Board lists +83% +reads$/)
  await ui.press({ key: 'tpb-topo:linux:linux-board-lists' })
  expect((await ui.find({ type: 'Text', text: 'app.orders_history' }))?.text).toBe('app.orders_history')
  await ui.press({ key: 'tpb-topo:linux' })
  expect(await ui.find({ type: 'Text', text: /Board lists/ })).toBe(undefined)
  await ui.unmount()
})
