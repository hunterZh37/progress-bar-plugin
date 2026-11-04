import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONN_CACHE_REL } from '../hooks/connectors'
import { isProgressLine, scriptPaths } from '../hooks/chain'
import { PANE, STATUS_OFF_REL, scriptNote, statusOffAction, statusOffReason } from '../hooks/panel'
import { withStatusLine } from '../hooks/register'
import { prevOf, statusScript } from '../hooks/render'
import { reportBody, shellSlug, taskProgress, taskSlug } from '../hooks/report'
import { pickOwner, routeOf, sessionKeyOf } from '../hooks/route'

// Progress files carry their owner (session id, folder), the plugin sets itself up on first run, and the main
// session's own task list and long shell commands show with no skill.

const NOW = 1_800_000_000_000
const HOME = '/home/u'
const P = `${HOME}/.claude-progress`
const L = `${P}/.lines`
const SID = '11112222-3333-4444-5555-666677778888'
const KEY = sessionKeyOf(SID)
const OTHER = '99990000-aaaa-bbbb-cccc-ddddeeeeffff'
const CWD = '/home/u/code/shop'
const SCRIPT = `${HOME}/.claude/progress-bar/statusline.sh`

/** A world with files in memory, a fixed session id and folder, and timers that never fire. */
function world(on: On, files: Record<string, string>, opts: { userStatusLine?: string; projectStatusLine?: string; isPlaced?: boolean; script?: { exitCode: number; stdout: string; stderr: string } } = {}) {
  const opened: string[] = []
  const runs: string[][] = []
  const toasts: string[] = []
  // A fresh connectors check, so an open panel starts no background check that outlives the test.
  files[`${HOME}/${CONN_CACHE_REL}`] ??= `#checked\t${Math.floor(NOW / 1000)}\n`
  mock.env(on, { HOME })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('clock.sleep', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] as never }))
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__progress-bar__${e.name}` } }))
  on('fs.list', (_, e) => ({ value: Object.keys(files).filter(f => f.startsWith(`${e.path}/`) && !f.slice(e.path.length + 1).includes('/')).map(f => ({ name: f.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }))
  on('fs.read', (_, e) => { const t = files[String(e.path)]; if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.write', (_, e) => { files[String(e.path)] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: String(e.path) in files || Object.keys(files).some(f => f.startsWith(`${e.path}/`)) }))
  on('fs.stat', (_, e) => { if (!(String(e.path) in files)) throw new Error('ENOENT'); return { value: { size: 1, mtimeMs: NOW } as never } })
  on('settings.read', (_, e) => {
    const cmd = e.source === 'user' ? opts.userStatusLine : e.source === 'project' ? opts.projectStatusLine : undefined
    return { value: (cmd ? { statusLine: { type: 'command', command: cmd } } : {}) as never }
  })
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    if (e.argv[0] === 'rm') for (const f of e.argv.slice(2)) delete files[f]
    if (opts.script && e.argv[0] === '/bin/sh' && e.argv[1] === SCRIPT) return { value: { ...opts.script, isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', (_, e) => { opened.push(e.id); return { value: opts.isPlaced === false ? { isPlaced: false, reason: 'narrow' } as never : { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  on('ui.panes', () => ({ value: [] as never }))
  on('ui.toast', (_, e) => { toasts.push(String((e as { text?: unknown }).text ?? e)); return { value: undefined } })
  return { opened, toasts, runs }
}

const job = (extra: Record<string, unknown> = {}) => JSON.stringify({ done: 1, total: 4, step: 'add account', ...extra })
/** Lets the work session.start leaves running settle before the test ends. */
const settle = async ($: { tool: { call: (i: never) => Promise<unknown> } }) => { await $.tool.call(report({ title: 'kick', finished: true })) }
const report = (args: Record<string, unknown>) => ({ tool: 'mcp__progress-bar__progress_report', ...args }) as never

test('owners: session wins while it is open, then cwd, then shared', () => {
  const me = { key: KEY, project: 'code-shop' }
  const live = new Map([[sessionKeyOf(OTHER), 'nombot']])
  const proj = (c: string) => (c.startsWith('/home/u/code/shop') ? 'code-shop' : c.includes('NomBot') ? 'nombot' : 'other')
  expect(routeOf({ session: SID }, me, live, proj)).toBe('mine')
  expect(routeOf({ session: OTHER, cwd: CWD }, me, live, proj)).toBe('skip')
  // A closed session falls back to its folder.
  expect(routeOf({ session: 'closed-session-id', cwd: CWD }, me, live, proj)).toBe('mine')
  expect(routeOf({ cwd: '/home/u/Desktop/NomBot' }, me, live, proj)).toBe('skip')
  // A project with no open session: shared, so the job still shows somewhere.
  expect(routeOf({ cwd: '/tmp/x' }, me, live, proj)).toBe('shared')
  expect(routeOf({}, me, live, proj)).toBe('shared')
  expect(pickOwner({ session: SID, cwd: 'relative' })).toEqual({ session: SID })
  expect(pickOwner(null)).toEqual({})
})

test('task list: done of total, the in-progress item as title, none when all done', () => {
  expect(taskProgress([])).toBe(null)
  expect(taskProgress([{ content: 'a', status: 'completed' }])).toBe(null)
  expect(taskProgress([{ content: 'Write tests', status: 'completed' }, { content: 'Ship', status: 'in_progress', activeForm: 'Shipping' }, { content: 'Tell Hunter', status: 'pending' }]))
    .toEqual({ done: 1, total: 3, title: 'Ship', step: 'Shipping' })
  expect(taskSlug(CWD, SID)).toBe(`shop-tasks-${KEY.slice(0, 4)}`)
  expect(shellSlug('Load the 2026 batch', 'python load.py')).toBe('shell-load-the-2026-batch')
  expect(reportBody({ title: 'T', done: 9, total: 4 }, { session: SID, cwd: CWD }, 5)).toEqual({ done: 4, total: 4, step: '', startedAt: 5, title: 'T', session: SID, cwd: CWD })
})

test('the status line script shows the shared jobs.txt everywhere when todos/lines.txt is missing', () => {
  expect(statusScript()).toContain('[ -f "$todos/lines.txt" ] || shared="$shared jobs.txt"')
})

test('fresh machine: a main-session job with no owner goes to the shared jobs.txt', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = { [`${P}/alex-add-account.json`]: job({ title: 'Add account' }) }
  world(on, files)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.tool.call(report({ title: 'Other job', done: 0, total: 2 }))
  expect(files[`${L}/jobs.txt`]).toContain('alex-add-account')
  expect(files[`${L}/jobs-${KEY}.txt`]).toContain('other-job')
  expect(files[`${L}/jobs-${KEY}.txt`]).not.toContain('alex-add-account')
})

test('a file with this session shows only here, another open session keeps its own, cwd routes by project', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {
    [`${P}/mine.json`]: job({ session: SID }),
    [`${P}/theirs.json`]: job({ session: OTHER, cwd: CWD }),
    [`${P}/shop-job.json`]: job({ cwd: `${CWD}/web` }),
    [`${P}/nombot-job.json`]: job({ cwd: '/home/u/Desktop/NomBot' }),
    [`${P}/.state/claims-${sessionKeyOf(OTHER)}.txt`]: '#project desktop-nombot\n',
    [`${CWD}/.git/HEAD`]: 'ref',
    '/home/u/Desktop/NomBot/.git/HEAD': 'ref',
  }
  world(on, files)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.tool.call(report({ title: 'kick', finished: true }))
  const mine = files[`${L}/jobs-${KEY}.txt`] ?? ''
  expect(mine).toContain('mine')
  expect(mine).toContain('shop-job')
  expect(mine).not.toContain('theirs')
  expect(mine).not.toContain('nombot-job')
  expect(files[`${L}/jobs.txt`] ?? '').toBe('')
  expect(files[`${P}/.state/claims-${KEY}.txt`]).toContain('#project code-shop')
})

test('with todos/lines.txt the legacy jobs.txt routing is unchanged', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = { [`${P}/linux-import.json`]: job(), [`${P}/todos/lines.txt`]: 'jobs.txt\ttodo.txt\n' }
  world(on, files)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.tool.call(report({ title: 'kick', finished: true }))
  expect(files[`${L}/jobs.txt`]).toContain('linux-import')
  expect(files[`${L}/jobs-${KEY}.txt`] ?? '').toBe('')
})

test('progress_report writes session, cwd and startedAt, keeps startedAt, and finished removes the file', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const r = await $.tool.call(report({ title: 'Add account', why: 'Alex books meetings', done: 1, total: 4, step: 'OAuth' }))
  expect(String((r as { result?: unknown }).result)).toContain('Bar add-account 1/4')
  expect(JSON.parse(files[`${P}/add-account.json`]!)).toEqual({ done: 1, total: 4, step: 'OAuth', startedAt: NOW, title: 'Add account', why: 'Alex books meetings', session: SID, cwd: CWD })
  files[`${P}/add-account.json`] = JSON.stringify({ ...JSON.parse(files[`${P}/add-account.json`]!), startedAt: 42 })
  await $.tool.call(report({ title: 'Add account', done: 2, total: 4 }))
  expect(JSON.parse(files[`${P}/add-account.json`]!).startedAt).toBe(42)
  await $.tool.call(report({ title: 'Add account', finished: true }))
  expect(files[`${P}/add-account.json`]).toBe(undefined)
  expect(String(((await $.tool.call(report({ title: 'x', slug: 'inbox' }))) as { result?: unknown }).result)).toContain('data file')
})

test('TodoWrite in the main session mirrors the task list as one bar; a subagent\'s is left alone', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files)
  on('tool.call', () => ({ result: { oldTodos: [], newTodos: [] } as never }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const bar = `${P}/${taskSlug(CWD, SID)}.json`
  const todos = [{ content: 'Read code', status: 'completed', activeForm: 'Reading code' }, { content: 'Fix routing', status: 'in_progress', activeForm: 'Fixing routing' }, { content: 'Ship', status: 'pending', activeForm: 'Shipping' }]
  await $.tool.call({ tool: 'TodoWrite', todos } as never)
  expect(JSON.parse(files[bar]!)).toEqual({ done: 1, total: 3, step: 'Fixing routing', startedAt: NOW, title: 'Fix routing', session: SID, cwd: CWD })
  expect(files[`${L}/jobs-${KEY}.txt`]).toContain(taskSlug(CWD, SID))
  await $.tool.call({ tool: 'TodoWrite', agentId: 'a1', todos: [{ content: 'sub', status: 'in_progress', activeForm: 'sub' }] } as never)
  expect(JSON.parse(files[bar]!).title).toBe('Fix routing')
  await $.tool.call({ tool: 'TodoWrite', todos: todos.map(t => ({ ...t, status: 'completed' })) } as never)
  expect(files[bar]).toBe(undefined)
})

test('TaskCreate and TaskUpdate keep the same bar', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files)
  let n = 0
  on('tool.call', (_, e) => ({ result: (e.tool === 'TaskCreate' ? { task: { id: String(++n), subject: 'x' } } : { success: true, taskId: '1', updatedFields: [] }) as never }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const bar = `${P}/${taskSlug(CWD, SID)}.json`
  await $.tool.call({ tool: 'TaskCreate', subject: 'Plan', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Build', description: 'd', activeForm: 'Building' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as never)
  expect(JSON.parse(files[bar]!)).toMatchObject({ done: 1, total: 2, title: 'Build', step: 'Building', session: SID })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' } as never)
  expect(files[bar]).toBe(undefined)
})

test('a background Bash command shows as a working row until a stop no longer lists it', { options: { openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } as never }))
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'python load.py', description: 'Load the 2026 batch', run_in_background: true } as never)
  const row = `${P}/shell-load-the-2026-batch.json`
  expect(JSON.parse(files[row]!)).toMatchObject({ step: 'running in the background', title: 'Load the 2026 batch', session: SID, cwd: CWD })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'bg1', type: 'shell', status: 'running', description: 'x' }] } as never)
  expect(files[row]).toBeDefined()
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  expect(files[row]).toBe(undefined)
})

test('first run on a fresh HOME: installs the script, points the status line at it, opens the panel', async ($, on) => {
  const files: Record<string, string> = {}
  const { opened } = world(on, files)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect(files[SCRIPT]).toBe(statusScript())
  expect(files[`${HOME}/.claude/progress-bar/group.py`]).toBeDefined()
  expect(withStatusLine({} as Record<string, unknown>).statusLine).toEqual({ type: 'command', command: '~/.claude/progress-bar/statusline.sh', refreshInterval: 1 })
  expect(files[`${P}/.state/panel-on`]).toBe('on\n')
  expect(opened).toEqual([PANE])
})

test('an existing status line is chained, never replaced', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files, { userStatusLine: "jq -r '.model'" })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect(prevOf(files[SCRIPT]!)).toBe("jq -r '.model'")
  // The merged settings point at the script, and a settings file that already does is left as it is.
  expect((withStatusLine({ statusLine: { type: 'command', command: "jq -r '.model'" } }).statusLine as { command: string }).command).toBe('~/.claude/progress-bar/statusline.sh')
  const own = { statusLine: { type: 'command', command: '~/.claude/progress-bar/statusline.sh', padding: 2 } }
  expect(withStatusLine(own)).toBe(own)
})

test('panel off stays off; a pane that cannot open shows a one-time hint', async ($, on) => {
  const files: Record<string, string> = { [`${P}/.state/panel-off`]: 'off\n' }
  const { opened } = world(on, files)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect(opened).toEqual([])
  expect(files[`${P}/.state/panel-on`]).toBe(undefined)
})

test('a narrow terminal: the pane waits and a toast says how to open it, once', async ($, on) => {
  const files: Record<string, string> = {}
  const { toasts } = world(on, files, { isPlaced: false })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.tool.call(report({ title: 'kick', finished: true }))
  expect(toasts.join('\n')).toContain('Progress panel: /progress-bar')
  expect(files[`${P}/.state/panel-hint-shown`]).toBe('shown\n')
})

test('opting out in /config: no status line and no panel', { options: { statusLine: false, openPanel: false } }, async ($, on) => {
  const files: Record<string, string> = {}
  const { opened } = world(on, files)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect(files[SCRIPT]).toBe(undefined)
  expect(opened).toEqual([])
})

// 0.22.1: never chain a status line that is itself a progress status line (doubled rows, poisoned group-seen files).
const OLD_LOCAL = `${HOME}/label-logs/statusline.sh`
const OLD_LOCAL_TEXT = '#!/bin/zsh\nfor x in ~/.claude-progress/.lines/*.txt(N); do awk 1 "$x"; done | python3 ~/.claude-progress/group.py\n'

test('chain: a command or the script it names that prints progress lines is a progress status line', async () => {
  expect(scriptPaths(`bash "~/a b/s.sh" $HOME/x.sh \${HOME}/y.sh jq`, HOME)).toEqual([`${HOME}/a b/s.sh`, `${HOME}/x.sh`, `${HOME}/y.sh`])
  const files: Record<string, string> = { [OLD_LOCAL]: OLD_LOCAL_TEXT, [`${HOME}/plain.sh`]: 'echo hi\n' }
  const readHead = async (p: string) => files[p]
  expect(await isProgressLine('~/label-logs/statusline.sh', HOME, readHead)).toBe(true)
  expect(await isProgressLine('python3 ~/bin/group.py', HOME, readHead)).toBe(true)
  expect(await isProgressLine('$HOME/.claude/progress-bar/statusline.sh', HOME, readHead)).toBe(true)
  expect(await isProgressLine('~/plain.sh', HOME, readHead)).toBe(false)
  expect(await isProgressLine("jq -r '.model'", HOME, readHead)).toBe(false)
})

test('an old local progress status line in settings is never chained', async ($, on) => {
  const files: Record<string, string> = { [OLD_LOCAL]: OLD_LOCAL_TEXT }
  world(on, files, { userStatusLine: '~/label-logs/statusline.sh' })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect(prevOf(files[SCRIPT]!)).toBe(undefined)
})

test('an install that chained a progress status line (0.22.0) drops it on the next start', async ($, on) => {
  const files: Record<string, string> = { [OLD_LOCAL]: OLD_LOCAL_TEXT, [SCRIPT]: statusScript('~/label-logs/statusline.sh') }
  world(on, files)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  expect(prevOf(files[SCRIPT]!)).toBe(undefined)
})

test('status script notes: nothing to say when it printed or was quiet, the reason when it failed', () => {
  expect(scriptNote({ exitCode: 0, stdout: '▾ ▶ RUNNING\n', stderr: '' })).toBe('')
  expect(scriptNote({ exitCode: 0, stdout: '', stderr: '' })).toBe('')
  expect(scriptNote({ exitCode: 0, stdout: '\n', stderr: 'python3: bad\nmore' })).toBe('Status script returned nothing: python3: bad')
  expect(scriptNote({ exitCode: 2, stdout: '', stderr: 'sh: syntax error\n' })).toBe('Status script failed (exit 2): sh: syntax error')
})

test('the panel never draws blank: a failing status script shows why', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files, { script: { exitCode: 1, stdout: '', stderr: 'group.py: boom\n' } })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Status', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  expect((await ui.find({ type: 'Text', text: /Status script failed/ }))?.text).toBe('Status script failed (exit 1): group.py: boom')
  await ui.unmount()
})

test('settings.read hook skipped: the reason, logged once, cleared once the script runs', () => {
  const off = statusOffReason(false, '~/label-logs/statusline.sh')
  expect(off).toBe("The status line was not switched over (it still runs ~/label-logs/statusline.sh). Another plugin's settings.read hook may run first.")
  expect(statusOffReason(false, undefined)).toContain('not switched over.')
  expect(statusOffReason(false, '~/.claude/progress-bar/statusline.sh')).toBe('')
  expect(statusOffReason(true, '~/label-logs/statusline.sh')).toBe('')
  expect(statusOffAction(off, false)).toBe('log')
  expect(statusOffAction(off, true)).toBe('none')
  expect(statusOffAction('', true)).toBe('clear')
  expect(statusOffAction('', false)).toBe('none')
})

test('the panel offers Turn on status line, which writes the settings file holding the winning status line', async ($, on) => {
  const off = statusOffReason(false, '~/label-logs/statusline.sh')
  const files: Record<string, string> = { [OLD_LOCAL]: OLD_LOCAL_TEXT, [`${CWD}/.claude/settings.json`]: '{ "model": "opus" }', [`${HOME}/${STATUS_OFF_REL}`]: `${off}\n` }
  world(on, files, { projectStatusLine: '~/label-logs/statusline.sh' })
  // The pane reads the marker noteStatusLine leaves when the settings.read hook was skipped.
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await settle($ as never)
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Status', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  expect((await ui.find({ type: 'Text', text: /not switched over/ }))?.text).toBe(off)
  await ui.press({ key: 'h-turn-on' })
  expect(JSON.parse(files[`${CWD}/.claude/settings.json`]!)).toEqual({ model: 'opus', statusLine: { type: 'command', command: '~/.claude/progress-bar/statusline.sh', refreshInterval: 1 } })
  expect(prevOf(files[SCRIPT]!)).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /^Status line on/ }))?.text).toBe(`Status line on: ${CWD}/.claude/settings.json now runs ~/.claude/progress-bar/statusline.sh.`)
  expect(await ui.find({ type: 'Text', text: /not switched over/ })).toBe(undefined)
  expect(files[`${HOME}/${STATUS_OFF_REL}`]).toBe(undefined)
  await ui.unmount()
})
