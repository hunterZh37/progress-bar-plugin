import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PANE, cells, fitLabel, rowCol } from '../hooks/panel'
import { DEFAULT_GOAL, GOAL_REL, OTHER, anchorSummary, areaOf, areaSummary, groupByArea, inferLens, lensSummary, lensTags, parseGoal, pickGains, plainTitle } from '../hooks/goal'
import { parseDone } from '../hooks/done'
import { reportBody } from '../hooks/report'
import { draw } from './render'
import { statusScript } from '../hooks/render'

const NOW = 1_800_000_000_000
const HOME = '/home/u'
const DIR = `${HOME}/.claude-progress`
const SCRIPT = `${HOME}/.claude/progress-bar/statusline.sh`
const FLAG = `${DIR}/.state/panel-on`
const props = (w: number) => ({ title: 'Status', isFocused: false, bodyColumns: w, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } as const)

function world(on: On, files: Record<string, string>, full: string) {
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] as never }))
  on('fs.list', (_, e) => ({ value: Object.keys(files).filter(f => f.startsWith(`${e.path}/`) && !f.slice(e.path.length + 1).includes('/')).map(f => ({ name: f.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }))
  on('fs.read', (_, e) => { const t = files[e.path]; if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('settings.read', () => ({ value: {} as never }))
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: e.argv[1]?.endsWith('statusline.sh') ? full : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] as never }))
}

const G = DEFAULT_GOAL
const area = (t: Parameters<typeof areaOf>[1]) => areaOf(G, t).name

test('goal.json: defaults for a missing or bad file, custom areas kept, lenses merged over the defaults', () => {
  expect(parseGoal('nope')).toBe(DEFAULT_GOAL)
  expect(parseGoal('[]')).toBe(DEFAULT_GOAL)
  expect(G.anchor).toBe('Making the generosity database better')
  expect(G.areas.map(a => a.name)).toEqual(['Organizations', 'Finances', 'Boards & people', 'Grants', 'Places', 'Causes', 'Answer quality', 'Tools'])
  expect(G.lenses.map(l => l.id)).toEqual(['cost', 'quality', 'speed'])
  const g = parseGoal(JSON.stringify({ anchor: 'Ship the app', areas: [{ name: 'Login', icon: '🔑', keywords: ['Auth'] }, { icon: 'x' }], lenses: [{ id: 'speed', icon: '⏩' }] }))
  expect(g.anchor).toBe('Ship the app')
  // An icon from an older file is read and ignored, the tag defaults to the name's first word.
  expect(g.areas).toEqual([{ id: 'login', name: 'Login', tag: 'Login', keywords: ['auth'] }])
  expect(g.lenses.find(l => l.id === 'speed')).toEqual(G.lenses[2])
  expect(G.areas.map(a => a.tag)).toEqual(['Orgs', 'Finances', 'Boards', 'Grants', 'Places', 'Causes', 'Answers', 'Tools'])
  // A default area written by 0.26 with icons and no tags gets its default tag.
  expect(parseGoal(JSON.stringify({ areas: [{ id: 'organizations', name: 'Organizations', icon: '🏢' }] })).areas[0]!.tag).toBe('Orgs')
  expect(g.lenses.find(l => l.id === 'cost')).toBe(G.lenses[0])
  // No areas: the default ones.
  expect(parseGoal('{"anchor":"A"}').areas).toBe(G.areas)
})

test('area inference: a named area wins, else keywords (title counts double), else Other', () => {
  // Today's real jobs and to-dos.
  expect(area({ title: 'Hunty grants linked to own filer', why: '$6.3B of Schedule I grants point back at the funder' })).toBe('Grants')
  expect(area({ title: 'Mac label top-ups 2021-23', why: 'Cause labels for orgs added by the 2021-23 IRS load' })).toBe('Causes')
  expect(area({ title: 'Personal-mac LightGBM label classifier', why: 'Decide more labels without Claude where Jev is weak' })).toBe('Causes')
  expect(area({ title: 'Hunty board lists past 25 seats', why: 'Recover unpaid board members cut by the 25-person limit' })).toBe('Boards & people')
  expect(area({ title: 'Hunty person matcher fix' })).toBe('Boards & people')
  expect(area({ title: 'Personal-mac tools setup', why: 'Get personal-mac ready to run data jobs' })).toBe('Tools')
  expect(area({ title: 'Count each org once, merge orgs filed under two EINs' })).toBe('Organizations')
  expect(area({ title: 'One return per org and year, amended returns replace originals' })).toBe('Finances')
  expect(area({ title: "Know where more orgs serve, places beyond today's 77K" })).toBe('Places')
  expect(area({ title: 'Check NomBot answers stay right on the bigger database, eval rerun' })).toBe('Answer quality')
  // Keywords are whole words: "ein" is not found inside "being".
  expect(area({ title: 'being careful' })).toBe('Other')
  // Whole words or plurals only: "personal-mac" is not a person.
  expect(area({ title: 'Save a claude setup-token on personal-mac' })).toBe('Tools')
  expect(areaOf(G, { title: 'nothing to see' })).toBe(OTHER)
  // A named area beats the keywords: by name, id or a name's start, any case.
  expect(area({ area: 'Tools', title: 'Grants for boards' })).toBe('Tools')
  expect(area({ area: 'boards', title: 'x' })).toBe('Boards & people')
  expect(area({ area: 'answer quality', title: 'x' })).toBe('Answer quality')
  expect(area({ area: 'other', title: 'grants' })).toBe('Other')
  // A name that matches none is its own area.
  expect(areaOf(G, { area: 'Billing', title: 'grants' })).toEqual({ id: 'billing', name: 'Billing', tag: 'Billing', keywords: [] })
})

test('grouping by area: the goal\'s order, job-named areas next, Other last, empty areas left out', () => {
  const it = (a: ReturnType<typeof areaOf>, n: string) => ({ area: a, n })
  const [org, , boards, grants] = G.areas
  const billing = areaOf(G, { area: 'Billing' })
  const groups = groupByArea(G, [it(OTHER, 'o'), it(grants!, 'g1'), it(billing, 'b'), it(org!, 'x'), it(grants!, 'g2')])
  expect(groups.map(g => [g.area.name, g.items.map(i => i.n)])).toEqual([['Organizations', ['x']], ['Grants', ['g1', 'g2']], ['Billing', ['b']], ['Other', ['o']]])
  expect(groups.some(g => g.area === boards)).toBe(false)
  expect(areaSummary({ live: 1, done: 2, queued: 0 })).toBe('1 improving, 2 done today')
  expect(areaSummary({ live: 0, done: 0, queued: 3 })).toBe('3 queued')
  expect(anchorSummary(4, 3, 0)).toBe('4 improvements done today · 3 in progress')
  expect(anchorSummary(1, 0, 2)).toBe('1 improvement done today · 2 queued')
  expect(anchorSummary(0, 0, 0)).toBe('Nothing moving yet today')
  expect(plainTitle('Hunty grants linked to own filer · all', ['hunty'])).toBe('Grants linked to own filer')
  expect(plainTitle('hunty: embed.py', ['hunty'])).toBe('Embed.py')
  expect(plainTitle('Health care labels', ['hunty'])).toBe('Health care labels')
})

test('lenses: named gains in order, else one inferred from the impact, a count per lens for today', () => {
  expect(pickGains({ speed: ' labels in 7h instead of 12h ', quality: '', other: 'x' })).toEqual({ speed: 'labels in 7h instead of 12h' })
  expect(pickGains('quality')).toBe(undefined)
  const named = lensTags(G, { speed: 'labels in 7h instead of 12h', quality: '1.65M more board seats counted' })
  expect(named.map(t => [t.id, t.name, t.inferred])).toEqual([['quality', 'quality', false], ['speed', 'speed', false]])
  expect(inferLens(G, '$14 of Jev instead of 34h of Claude')).toBe('cost')
  expect(inferLens(G, 'Labels now finish 3 hours sooner')).toBe('speed')
  expect(inferLens(G, 'labels in 7h instead of 12h')).toBe('speed')
  expect(inferLens(G, '1.65M more board seats, so people search sees whole boards')).toBe('quality')
  expect(lensTags(G, undefined, 'cheaper runs').map(t => [t.id, t.inferred])).toEqual([['cost', true]])
  expect(lensTags(G, undefined, '')).toEqual([])
  expect(lensSummary(G, [named, lensTags(G, undefined, 'more seats'), lensTags(G, { cost: '$14' })])).toBe('today: 2 quality · 1 cost · 1 speed')
  expect(lensSummary(G, [[]])).toBe('')
})

test('area and gains travel from progress_report to the done record', () => {
  const body = reportBody({ title: 'T', step: 's', area: ' Grants ', gains: { quality: 'more grants linked', cost: '' } }, { session: '', cwd: '' }, 5)
  expect(body.area).toBe('Grants')
  expect(body.gains).toEqual({ quality: 'more grants linked' })
  const rec = parseDone(JSON.stringify({ slug: 't', title: 'T', impact: ['x'], finished: 1, machine: 'Mac', kind: 'job', area: 'Grants', gains: { speed: '2x faster', junk: 1 } }))
  expect([rec?.area, rec?.gains]).toEqual(['Grants', { speed: '2x faster' }])
})

const FULL = [
  '▾ ▶ RUNNING',
  '  ◐ hunty-board-seats ██░░ 50.0% · 1/2 · 10m left',
  '  ◐ tidy-up ██░░ 50.0% · 1/2',
  '▾ ✔ DONE',
  '  grants-rematch · finished 10:12',
].join('\n')

test('the List tab: the anchor and area chips, then the sections with area words, plain rows, impact under done rows, lens words; no emoji; goal.json written once', async ($, on) => {
  const files: Record<string, string> = {
    [SCRIPT]: statusScript(), [FLAG]: 'on\n',
    [`${DIR}/todo.txt`]: '[hunty]\n1. Know where more orgs serve (after hunty-board-seats)\n',
    [`${DIR}/hunty-board-seats.json`]: JSON.stringify({ done: 1, total: 2, title: 'Hunty board lists past 25 seats', why: 'Whole boards, not just 25', gains: { quality: '1.65M more board seats counted' } }),
    [`${DIR}/tidy-up.json`]: JSON.stringify({ done: 1, total: 2, title: 'Tidy up', area: 'Tools' }),
    [`${DIR}/.state/done/grants-rematch.json`]: JSON.stringify({ slug: 'grants-rematch', title: 'Hunty grant rematch', impact: ['42K more grants linked to the orgs that got them'], finished: NOW - 60_000, machine: 'hunty', kind: 'job' }),
  }
  world(on, files, FULL)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: props(60) })
  // The defaults are written once.
  expect(JSON.parse(files[`${HOME}/${GOAL_REL}`]!)).toEqual(DEFAULT_GOAL)
  const lines = draw((await ui.find({ type: 'Box' })) as never)
  const at = (re: RegExp) => lines.findIndex(l => re.test(l))
  const anchorAt = at(/generosity database/)
  expect(lines[anchorAt]).toBe('Making the generosity database better')
  expect(lines[anchorAt + 1]).toBe('   1 improvement done today · 2 in progress · 1 queued')
  expect(lines[anchorAt + 2]).toBe('   today: 1 quality')
  // One line of area chips in the goal's order, as words: in progress ◒, done ✓, only queued ○.
  expect(lines[anchorAt + 3]).toBe('   Boards 1 ◒  Grants 1 ✓  Places 1 ○  Tools 1 ◒')
  // No emoji anywhere: nothing from U+1F000 up, and none of the old badge glyphs.
  expect(lines.join('\n')).not.toMatch(/[\u{1F000}-\u{1FFFF}⛔⚙⏱⚡☀✉]/u)
  // Then the familiar sections, in order.
  expect(lines.filter(l => /^▾ /.test(l))).toEqual(['▾ ☐ TO-DO  1', '▾ ▶ RUNNING  2', '▾ ✔ DONE  1'])
  // A plain row: the improvement without its machine, a thin bar, then the area, lenses, time left and the why under it.
  const col = rowCol(60)
  expect(lines[at(/Board lists/)]).toBe(`  ◐ ▸ ${fitLabel('Board lists past 25 seats', col)}  ━━━━━─────  50%`)
  expect(lines[at(/Board lists/) + 1]).toBe('      Boards · quality · 10m left · Whole boards, not just 25')
  // Done reads like a changelog: the impact under the title, its inferred lens dim.
  expect(lines[at(/Grant rematch/)]).toBe('  ✓ ▸ Grant rematch  10:12')
  expect(lines[at(/Grant rematch/) + 1]).toBe('      Grants · quality · 42K more grants linked to the orgs that got them')
  const tag = (await ui.findAll({ type: 'Text' })).filter(t => t.text === 'quality · ').map(t => !!(t as unknown as { props?: { dimColor?: boolean } }).props?.dimColor)
  expect(tag).toEqual([false, true])
  // To-dos keep machines, priority and blockers, with the area word.
  expect(lines[at(/Know where/)]).toBe('    ⏸  1.  Places   Know where more orgs serve')
  // A chip filters every section to its area.
  await ui.press({ key: 'chip-grants' })
  const only = draw((await ui.find({ type: 'Box' })) as never)
  expect(only.filter(l => /^▾ /.test(l))).toEqual(['▾ ☐ TO-DO  0', '▾ ▶ RUNNING  0', '▾ ✔ DONE  1'])
  expect(only.some(l => /Board lists/.test(l))).toBe(false)
  await ui.press({ key: 'chip-grants' })
  // Opened, the card shows the machine, the named gains and the area.
  await ui.press({ key: 'open-hunty-board-seats' })
  const open = draw((await ui.find({ type: 'Box' })) as never)
  expect(open).toContain('    hunty-board-seats   job')
  expect(open).toContain('    quality: 1.65M more board seats counted')
  expect(open).toContain('    area: Boards & people')
  await ui.unmount()
})

test('goal.json: a custom file is read and never overwritten', async ($, on) => {
  const mine = JSON.stringify({ anchor: 'Ship the app', areas: [{ id: 'login', name: 'Login', tag: 'Login', keywords: ['tidy'] }] })
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [`${HOME}/${GOAL_REL}`]: mine, [`${DIR}/tidy-up.json`]: JSON.stringify({ done: 1, total: 2, title: 'Tidy up' }) }
  world(on, files, FULL)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: props(60) })
  const lines = draw((await ui.find({ type: 'Box' })) as never)
  expect(lines).toContain('Ship the app')
  expect(lines).toContain('   Login 1 ◒  Other 1 ◒ 1 ✓')
  expect(lines[lines.findIndex(l => /^  ◐ ▸ Tidy up/.test(l)) + 1]).toMatch(/^      Login( · |$)/)
  expect(files[`${HOME}/${GOAL_REL}`]).toBe(mine)
  await ui.unmount()
})

test('narrow pane: every plain row still fits at 30 columns', async ($, on) => {
  const files: Record<string, string> = {
    [SCRIPT]: statusScript(), [FLAG]: 'on\n',
    [`${DIR}/hunty-board-seats.json`]: JSON.stringify({ done: 1, total: 2, title: 'Hunty board lists past 25 seats and a very long title', why: 'Whole boards' }),
  }
  world(on, files, FULL)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: props(30) })
  const lines = draw((await ui.find({ type: 'Box' })) as never)
  const rows = lines.filter(l => /[━─]{3}/.test(l) && /%$/.test(l))
  expect(rows.length).toBe(2)
  for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(30)
  // Every top row and child row (4 deeper) fits from 30 columns.
  for (let w = 30; w <= 120; w++) for (const ind of [0, 4]) expect(ind + 4 + 2 + rowCol(w, ind) + 12 + 5).toBeLessThanOrEqual(w)
  expect(rowCol(30)).toBe(7)
  // Short tab names in a narrow pane.
  expect(lines[0]).toBe('List  Conn  Git  Log  Chat  Topo')
  expect(rowCol(200)).toBe(40)
  await ui.unmount()
})
