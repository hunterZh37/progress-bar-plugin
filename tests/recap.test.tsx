import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

declare const setTimeout: (fn: () => void, ms: number) => unknown

import { CHECKPOINT_PY, dayOf, snapOf } from '../hooks/checkpoint'
import { PANE, recapDue, toCheckpoint } from '../hooks/panel'
import { statusScript } from '../hooks/render'

const HOME = '/home/u'
const P = `${HOME}/.claude-progress`
const OV = `${P}/.state/overnight.json`
const SCRIPT = `${HOME}/.claude/progress-bar/statusline.sh`
const SINCE = 1800000000
const H = 3600
const PANE_PROPS = { title: 'Status', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }

type Ran = { argv: string[]; env?: Record<string, string> }
type Clock = { ms: number; tick?: () => void }

// A fake home with a fake clock: clock.now reads `clock.ms`, and the 2 s recap tick waits for `clock.tick()`,
// so a test can jump the clock between two ticks the way a sleeping computer does.
function world(on: On, files: Record<string, string>, status: string, clock: Clock) {
  const ran: Ran[] = []
  let release: (() => void) | null = null
  clock.tick = () => { const r = release; release = null; r?.() }
  mock.env(on, { HOME })
  on('fs.read', (_, e) => { const t = files[String(e.path)]; if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.write', (_, e) => { files[String(e.path)] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: String(e.path) in files }))
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: clock.ms }))
  on('clock.every', async (_, e) => { if (e.ms === 2000) await new Promise<void>(r => { release = r }); else await new Promise<void>(() => {}); return { value: undefined } })
  on('process.run', (_, e) => {
    ran.push({ argv: [...e.argv], env: e.init?.env })
    if (e.argv[0] === 'mv') { files[e.argv[3]!] = files[e.argv[2]!] ?? ''; delete files[e.argv[2]!] }
    return { value: { exitCode: 0, stdout: e.argv[1] === SCRIPT ? status : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.list', () => ({ value: [] as never }))
  on('settings.read', () => ({ value: {} as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] as never }))
  return ran
}

const ev = (ts: number, level: string, source: string, title: string, detail = '') => JSON.stringify({ ts, level, source, title, ...(detail ? { detail } : {}) })
const FILES = (): Record<string, string> => ({
  [SCRIPT]: statusScript(),
  [`${P}/.state/panel-on`]: 'on\n',
  [`${P}/titles.txt`]: 'arts_culture-classify\tArts & culture labels · sorts orgs\tthe arts filter\nhealthcare-verify\tHealth care labels: double-check\taccuracy\n',
  [OV]: JSON.stringify({ since: SINCE, label: 'end of day', running: [
    { name: 'arts_culture-classify', pct: 15.7, done: 1420, total: 9034 },
    { name: 'healthcare-verify', pct: 80.9 },
    { name: 'ntee-claude-check', pct: 67.7 },
  ] }),
  [`${P}/events.jsonl`]: [
    ev(SINCE - 60, 'success', 'old-job', 'Old job done'),
    ev(SINCE + 600, 'success', 'healthcare-verify', 'healthcare-verify done'),
    ev(SINCE + 900, 'warning', 'arts_culture-classify', 'Arts labels hit the usage limit', 'resumed in 2h10m'),
    ev(SINCE + 1200, 'error', 'service-areas', 'Service areas pilot crashed', 'Traceback\nValueError: bad'),
    ev(SINCE + 1500, 'warning', 'train', 'Train batch stuck', 'no progress for 12m'),
  ].join('\n'),
})
const STATUS = '▾ ▶ RUNNING\n  ◐ arts_culture-classify ████░░ 62.0% · 5600/9034 batches · 140 orgs/min · 6h05m left\n  ◐ new-job ██░░ 10.0% · 1/10\n'
  + '▾ ⏸ WAITING\n  arts-verify · waiting on: Arts labels\n'
  + '▾ ✔ DONE\n  ntee-claude-check · finished 21:10\n'

async function mount($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
}
const flush = () => new Promise<void>(r => setTimeout(r, 20))
const texts = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const hasBanner = async (ui: Awaited<ReturnType<typeof mount>>) => (await texts(ui)).some(t => /While you were away/.test(t))

test('checkpoint parsing: rows, old raw rows, due after 4 h or a wake', async () => {
  expect(snapOf('⚠ stuck 12m arts-classify ███░ 15.7% · 1420/9034 batches · 13h35m left')).toEqual({ name: 'arts-classify', pct: 15.7, done: 1420, total: 9034 })
  expect(snapOf('◐ box: train.py · 540% CPU · 12:50')).toEqual({ name: 'box: train.py' })
  expect(toCheckpoint({ since: SINCE, running: ['◐ a ██ 50.0% · 1/2', { name: 'b', pct: 3 }] })).toEqual({ since: SINCE, label: 'checkpoint', running: [{ name: 'a', pct: 50, done: 1, total: 2 }, { name: 'b', pct: 3 }] })
  expect(toCheckpoint({ label: 'x' })).toBe(null)
  const cp = toCheckpoint({ since: SINCE, running: [] })
  expect(recapDue(cp, SINCE + 4 * H - 1)).toBe(false)
  expect(recapDue(cp, SINCE + 4 * H)).toBe(true)
  expect(recapDue({ ...cp!, woke: SINCE + 60 }, SINCE + 60)).toBe(true)
  expect(dayOf(SINCE)).toMatch(/^\d{4}-\d\d-\d\d$/)
  expect(CHECKPOINT_PY).not.toContain('`')
  expect(CHECKPOINT_PY).not.toContain('${')
})

test('no recap before 4 h without a sleep gap', async ($, on) => {
  const clock: Clock = { ms: (SINCE + 3 * H) * 1000 }
  world(on, FILES(), STATUS, clock)
  const ui = await mount($)
  expect(await hasBanner(ui)).toBe(false)
  clock.ms += 2000; clock.tick!(); await flush()
  expect(await hasBanner(ui)).toBe(false)
  await ui.unmount()
})

test('recap after 4 h: header, counts, errors first, progress moved, expand', async ($, on) => {
  const clock: Clock = { ms: (SINCE + 11 * H) * 1000 }
  world(on, FILES(), STATUS, clock)
  const ui = await mount($)
  const t = await texts(ui)
  expect(t.some(x => /^☀ While you were away · since \d+:\d\d [AP]M \(11h\)$/.test(x))).toBe(true)
  // 1 done event since the checkpoint, plus ntee-claude-check now in DONE. The event before `since` is left out.
  expect(t).toContain('✓ 2 done  ')
  expect(t).toContain('✖ 1 error  ')
  expect(t).toContain('⚠ 2 warnings  ')
  expect(t).toContain('▶ 2 still running')
  expect(t).toContain('  ⏸ 1 waiting')
  // Compact: top 3 lines, errors first, then warnings newest first.
  const items = t.filter(x => /^(Service|Arts|Train|Health|ntee|new-job)/.test(x))
  expect(items).toEqual(['Service areas pilot crashed', 'Train batch stuck', 'Arts labels hit the usage limit'])
  expect(t).toContain('  Traceback')
  expect(t).toContain('  resumed in 2h10m')
  expect(t.some(x => /Old job/.test(x))).toBe(false)
  await ui.press({ key: 'recap-more' })
  const all = await texts(ui)
  const i = all.indexOf('Arts & culture labels')
  expect(i).toBeGreaterThan(-1)
  expect(all[i + 1]).toBe('  16% → 62%  · 6h left')
  expect(all).toContain('  new · 10%')
  expect(all).toContain('Health care labels: double-check')
  expect(all).toContain('ntee-claude-check')
  expect(all).toContain('  21:10')
  expect(all).toContain('arts-verify')
  expect(await ui.find({ type: 'Button', text: /Show less/ })).toBeDefined()
  // No semicolons or em dashes in the copy.
  expect(all.filter(x => /While|Show|Dismiss|still running|done/.test(x)).some(x => /[;—]/.test(x))).toBe(false)
  await ui.unmount()
})

test('a tick gap over 30 min after the checkpoint shows the recap before 4 h and marks the file woke', async ($, on) => {
  const clock: Clock = { ms: (SINCE + 1 * H) * 1000 }
  const files = FILES()
  world(on, files, STATUS, clock)
  const ui = await mount($)
  expect(await hasBanner(ui)).toBe(false)
  clock.ms += 45 * 60_000 // the computer slept 45 min
  clock.tick!(); await flush()
  expect((await texts(ui)).some(t => /While you were away · since .* \(1h\)/.test(t))).toBe(true)
  expect(JSON.parse(files[OV]!).woke).toBe(Math.floor(clock.ms / 1000))
  await ui.unmount()
})

test('Dismiss archives overnight.json by day and hides the recap', async ($, on) => {
  const clock: Clock = { ms: (SINCE + 5 * H) * 1000 }
  const files = FILES()
  const ran = world(on, files, STATUS, clock)
  const ui = await mount($)
  expect(await hasBanner(ui)).toBe(true)
  await ui.press({ key: 'recap-dismiss' })
  const mv = ran.find(r => r.argv[0] === 'mv')!
  expect(mv.argv.slice(1)).toEqual(['-f', OV, `${P}/.state/overnight-${dayOf(SINCE)}.json`])
  expect(OV in files).toBe(false)
  expect(await hasBanner(ui)).toBe(false)
  clock.ms += 2000; clock.tick!(); await flush()
  expect(await hasBanner(ui)).toBe(false)
  await ui.unmount()
})

test('/progress-bar checkpoint writes overnight.json from the RUNNING rows, folded or not', async ($, on) => {
  const clock: Clock = { ms: SINCE * 1000 }
  const files = FILES()
  delete files[OV]
  files[`${P}/.state/folded.txt`] = 'running'
  const ran = world(on, files, STATUS, clock)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'progress-bar', args: 'checkpoint end of day', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(text).toContain('Checkpoint saved: 2 running')
  expect(ran.some(r => r.argv[1] === SCRIPT && r.env?.PB_UNFOLD === '1' && r.env?.PB_FULL === '1')).toBe(true)
  expect(JSON.parse(files[OV]!)).toEqual({ since: SINCE, label: 'end of day', running: [
    { name: 'arts_culture-classify', pct: 62, done: 5600, total: 9034 },
    { name: 'new-job', pct: 10, done: 1, total: 10 },
  ] })
  expect((await $.command.run({ command: 'progress-bar', args: 'away', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text).toContain('Checkpoint saved')
  expect(JSON.parse(files[OV]!).label).toBe('checkpoint')
  await flush()
})
