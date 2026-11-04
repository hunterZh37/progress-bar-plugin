import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONN_CACHE_REL, connName, connSummary, formatCache, parseAccounts, parseCache, parseLogin, parseMcpList } from '../hooks/connectors'
import { GROUP_PY } from '../hooks/group'
import { LSREGISTER, NOT_MAC, TOGGLE_APPLESCRIPT, parseMacClicks } from '../hooks/mac'
import { PANE, parseSections, runningRow, stripAnsi } from '../hooks/panel'
import { eta, expandHome, line, lines, parseProgress, parseWatch, prevOf, readLog, slug, statusScript, todoAdd, todoClear, todoDone, todoItems, todoList } from '../hooks/render'

const NOW = 1_800_000_000_000
const HOME = '/home/u'
const DIR = `${HOME}/.claude-progress`

test('slug follows the rule', async () => {
  expect(slug('Fix the Login bug!')).toBe('fix-the-login-bug')
  expect(slug('  Build docs (v2) ')).toBe('build-docs-v2')
})

test('a progress file renders as a bar', async () => {
  const p = parseProgress('{"done":2,"total":5,"step":"step"}')
  expect(p).toEqual({ done: 2, total: 5, step: 'step', startedAt: undefined })
  const row = { id: 'file:job', description: 'name', status: 'running', startedAt: NOW - 3 * 60_000, tools: 0, lastTool: '', done: p!.done, total: p!.total, step: p!.step }
  expect(line(row, NOW)).toBe('▶ name ████████░░░░░░░░░░░░ 40.0% · 2/5 · step · 3m')
})

test('a bad or partial file', async () => {
  expect(parseProgress('not json')).toBe(null)
  expect(parseProgress('{"step":"x"}')).toEqual({ done: null, total: null, step: 'x', startedAt: undefined })
})

test('an agent row without a file says working, with tools', async () => {
  const row = { id: 'a1', description: 'fix-login', status: 'running', startedAt: NOW - 65 * 60_000, tools: 4, lastTool: 'Edit', done: null, total: null, step: '' }
  expect(line(row, NOW)).toBe('▶ fix-login working · 1h05m · 4 tools · Edit')
})

test('lines are capped', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ id: `file:j${i}`, description: `j${i}`, status: 'running', startedAt: NOW, tools: 0, lastTool: '', done: null, total: null, step: '' }))
  const out = lines(rows, NOW)
  expect(out.length).toBe(6)
  expect(out[5]).toBe('… 4 more')
})

test('the script chains an earlier status line', async () => {
  const s = statusScript("jq -r '.model'")
  expect(s).toContain(`prev='jq -r '\\''.model'\\'''`)
  expect(s).toContain('"$HOME/.claude-progress/.lines"')
  expect(statusScript()).toContain("prev=''")
})

test('the script pipes through the grouper and falls back without python3', async () => {
  const s = statusScript()
  expect(s).toContain('group="$HOME/.claude/progress-bar/group.py"')
  expect(s).toContain('command -v python3')
  expect(s).toContain('| python3 "$group"')
  expect(s).toContain('else\n  lines\nfi')
})

const TODO = '# header\n[you]\nreview PR\nx old thing\n[mac]\nrun import | http://localhost:3000\n'

test('to-do items: numbered, done ones marked, links kept', async () => {
  const items = todoItems(TODO)
  expect(items.map(i => [i.index, i.heading, i.text, i.done])).toEqual([
    [1, 'you', 'review PR', false],
    [2, 'you', 'old thing', true],
    [3, 'mac', 'run import | http://localhost:3000', false],
  ])
  expect(todoList(TODO)).toBe('[you]\n  1. review PR\n  2. [x] old thing\n[mac]\n  3. run import | http://localhost:3000')
  expect(todoItems('loose\n')[0]!.heading).toBe('todo')
})

test('todo add: [name], an existing heading word, or the last heading', async () => {
  expect(todoAdd(TODO, '[you] call Sam').text).toBe('# header\n[you]\nreview PR\nx old thing\ncall Sam\n[mac]\nrun import | http://localhost:3000\n')
  expect(todoAdd(TODO, 'you call Sam').heading).toBe('you')
  expect(todoAdd(TODO, 'buy milk').text.endsWith('[mac]\nrun import | http://localhost:3000\nbuy milk\n')).toBe(true)
  expect(todoAdd(TODO, '[New Box] set up').text.endsWith('[New Box]\nset up\n')).toBe(true)
  const fresh = todoAdd('', 'first')
  expect(fresh.heading).toBe('todo')
  expect(fresh.text.endsWith('[todo]\nfirst\n')).toBe(true)
})

test('todo done by number or text, and clear', async () => {
  expect(todoDone(TODO, '3')!.text).toContain('\nx run import | http://localhost:3000\n')
  expect(todoDone(TODO, 'REVIEW')!.text).toContain('\nx review PR\n')
  expect(todoDone(TODO, 'nothing like it')).toBe(null)
  const cleared = todoClear('[a]\nx gone\n[b]\nkeep\nx gone too\n')
  expect(cleared).toEqual({ text: '[b]\nkeep\n', removed: 2 })
})

test('the grouper source is stdlib python and safe to embed', async () => {
  expect(GROUP_PY.startsWith('#!/usr/bin/env python3')).toBe(true)
  expect(GROUP_PY).toContain('links.txt')
  expect(GROUP_PY).toContain('folded.txt')
  expect(GROUP_PY).toContain('todo.txt')
  expect(GROUP_PY).not.toContain('hunty')
})

test('a watch file counts done/total from the last match, with an ETA', async () => {
  const w = parseWatch('{"log":"~/l.log","match":"(\\\\d+)/(\\\\d+) batches","startedAt":1}')!
  expect(w.log).toBe('~/l.log')
  const p = readLog(w, '  10/40 batches, 1 min\n  20/40 batches, 2 min\n')
  expect(p).toEqual({ done: 20, total: 40, step: '', error: false })
  expect(eta(20 * 60_000, p.done, p.total)).toBe('20m')
  expect(expandHome('~/l.log', HOME)).toBe(`${HOME}/l.log`)
})

test('a watch file counts finished steps, a step and an error', async () => {
  const w = parseWatch('{"log":"/x","count":"^(REFRESH MATERIALIZED VIEW|\\\\(1 row\\\\))$","total":5,"step":"^(REFRESH[A-Z ]+)$","error":"ERROR"}')!
  const log = 'SET\n(1 row)\nREFRESH MATERIALIZED VIEW\nREFRESH MATERIALIZED VIEW\n'
  expect(readLog(w, log)).toEqual({ done: 3, total: 5, step: 'REFRESH MATERIALIZED VIEW', error: false })
  expect(readLog(w, log + 'ERROR:  out of memory\n').error).toBe(true)
})

test('unusable watch files are null', async () => {
  expect(parseWatch('{"match":"(\\\\d+)/(\\\\d+)"}')).toBe(null)
  expect(parseWatch('{"log":"/x"}')).toBe(null)
  expect(parseWatch('{"log":"/x","count":"x"}')).toBe(null)
  expect(parseWatch('{"log":"/x","match":"(unclosed"}')).toBe(null)
})

test('watched rows: done, stopped and error marks', async () => {
  const base = { id: 'watch:j', description: 'j', status: 'running', startedAt: NOW - 9 * 60_000, tools: 0, lastTool: '', step: '' }
  expect(line({ ...base, done: 5, total: 5, state: 'done', eta: '' }, NOW)).toBe('✔ j ████████████████████ 100.0% · 5/5 · 9m')
  expect(line({ ...base, done: 2, total: 5, state: 'stopped', eta: '13m' }, NOW)).toBe('■ stopped j ████████░░░░░░░░░░░░ 40.0% · 2/5 · 9m · ETA 13m')
  expect(line({ ...base, done: null, total: null, state: 'error' }, NOW)).toBe('✖ error j · 9m')
})

/** Runs `/progress-bar <args>` as the person would type it. */
const run = async ($: Engine, args: string) => {
  const r = await $.command.run({ command: 'progress-bar', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  return { ...r, text: r.text ?? '' }
}

/** The world beneath the plugin: a home folder with one subagent and one job file. */
function world(on: On, opts: { statusLine?: { type: string; command: string }; scriptExists?: boolean; os?: string } = {}) {
  const written: Record<string, string> = {}
  const ran: string[][] = []
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Build docs', status: 'running' }] as never }))
  on('fs.list', (_, e) => ({
    value: e.path === DIR
      ? [
          { name: 'build-docs.json', kind: 'file', size: 10, mtimeMs: NOW - 1000, isLink: false },
          { name: 'nightly-import.json', kind: 'file', size: 10, mtimeMs: NOW - 1000, isLink: false },
          { name: 'old.json', kind: 'file', size: 10, mtimeMs: NOW - 60 * 60_000, isLink: false },
        ]
      : [],
  }))
  on('fs.read', (_, e) => {
    const files: Record<string, string> = {
      [`${DIR}/build-docs.json`]: '{"done":1,"total":4,"step":"render"}',
      [`${DIR}/nightly-import.json`]: `{"done":4,"total":5,"step":"batch 4","startedAt":${NOW - 12 * 60_000}}`,
    }
    const text = files[e.path] ?? (e.path.endsWith('/todo.txt') ? written[e.path] : undefined)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => { written[e.path] = e.text; return { value: undefined } })
  on('fs.exists', () => ({ value: !!opts.scriptExists }))
  on('settings.read', () => ({ value: (opts.statusLine ? { statusLine: opts.statusLine } : {}) as never }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? `${opts.os ?? 'Darwin'}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { written, ran }
}

test('/progress-bar shows the bars and the setup state', async ($, on) => {
  const { written } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await run($, '')
  expect(text).toBe([
    '▶ Build docs █████░░░░░░░░░░░░░░░ 25.0% · 1/4 · render · 0m · 0 tools',
    '▶ nightly-import ████████████████░░░░ 80.0% · 4/5 · batch 4 · 12m',
    '',
    'Status line: off. Run `/progress-bar setup`.',
  ].join('\n'))
  expect(written[`${DIR}/.lines/jobs.txt`]).toContain("▶ nightly-import")
})

test('/progress-bar setup writes the script and chains the old status line', async ($, on) => {
  const { written, ran } = world(on, { statusLine: { type: 'command', command: '~/bin/mine.sh' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await run($, 'setup')
  const path = `${HOME}/.claude/progress-bar/statusline.sh`
  expect(written[path]).toContain("prev='~/bin/mine.sh'")
  expect(written[`${HOME}/.claude/progress-bar/group.py`]).toBe(GROUP_PY)
  expect(ran).toContainEqual(['chmod', '+x', path])
  expect(text).toContain('~/bin/mine.sh')
  expect(text).toContain('"statusLine": { "type": "command", "command": "~/.claude/progress-bar/statusline.sh", "refreshInterval": 1 }')
})

test('/progress-bar when the status line is wired', async ($, on) => {
  world(on, { statusLine: { type: 'command', command: '~/.claude/progress-bar/statusline.sh' }, scriptExists: true })
  const { text } = await run($, '')
  expect(text).toContain('Status line: on.')
})

test('/progress-bar shows a watched log, and stopped when its process is gone', async ($, on) => {
  const LOG = `${HOME}/logs/import.log`
  let alive = true
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] as never }))
  on('fs.list', (_, e) => ({
    value: e.path === DIR ? [{ name: 'import.watch.json', kind: 'file', size: 10, mtimeMs: NOW - 3 * 60 * 60_000, isLink: false }] : [],
  }))
  on('fs.read', (_, e) => {
    const files: Record<string, string> = {
      [`${DIR}/import.watch.json`]: `{"log":"~/logs/import.log","match":"(\\\\d+)/(\\\\d+) batches","process":"^python .*import","startedAt":${NOW - 60 * 60_000}}`,
      [LOG]: '  10/40 batches\n  20/40 batches\n',
    }
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.stat', (_, e) => {
    if (e.path !== LOG) throw new Error('ENOENT')
    return { value: { name: 'import.log', kind: 'file', size: 30, mtimeMs: NOW - 30 * 60_000, isLink: false } as never }
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('settings.read', () => ({ value: {} as never }))
  on('process.run', (_, e) => ({ value: { exitCode: e.argv[0] === 'pgrep' && !alive ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Log quiet for 30 min but the process lives: still shown, with an ETA from the hour so far.
  expect((await run($, '')).text.split('\n')[0]).toBe('▶ import ██████████░░░░░░░░░░ 50.0% · 20/40 · 1h00m · ETA 1h00m')
  // Process gone and log quiet past 10 min: hidden.
  alive = false
  expect((await run($, '')).text.split('\n')[0]).toBe('No running jobs. Try `/progress-bar demo`.')
})

test('/progress-bar with an unknown argument prints usage', async ($, on) => {
  world(on)
  const { text } = await run($, 'nope')
  expect(text.split('\n')[0]).toBe('Usage: /progress-bar [setup | demo | clear | todo | panel [on|off] | fold <section> | unfold <section> | toggle <section>]')
})

test('/progress-bar todo add, list, done and clear write todo.txt', async ($, on) => {
  const { written } = world(on)
  const file = `${DIR}/todo.txt`
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await run($, 'todo')).text).toContain('No to-dos.')
  expect((await run($, 'todo add [Mac] Run Import')).text).toContain('Added to [Mac].')
  await run($, 'todo add Call Sam')
  expect(written[file]).toContain('[Mac]\nRun Import\nCall Sam\n')
  expect((await run($, 'todo')).text).toBe('[Mac]\n  1. Run Import\n  2. Call Sam')
  expect((await run($, 'todo done 1')).text).toBe('Done: Run Import')
  expect((await run($, 'todo done sam')).text).toBe('Done: Call Sam')
  expect((await run($, 'todo clear')).text).toBe('Removed 2 done items.')
  expect(written[file]).not.toContain('Run Import')
})

test('mac-clicks parsing', async () => {
  expect(parseMacClicks('mac-clicks')).toBe('on')
  expect(parseMacClicks('--mac-clicks')).toBe('on')
  expect(parseMacClicks('mac-clicks off')).toBe('off')
  expect(parseMacClicks('--mac-clicks OFF')).toBe('off')
  expect(parseMacClicks('mac-clicks maybe')).toBe(null)
  expect(parseMacClicks('clicks')).toBe(null)
})

test('the toggle AppleScript only writes known section keys', async () => {
  expect(TOGGLE_APPLESCRIPT).toContain('if sec is in {"todo", "running", "waiting", "done", "problems"} then')
  expect(TOGGLE_APPLESCRIPT).toContain('.claude-progress/.state/folded.txt')
})

/** A world for setup mac-clicks: uname answers `os`, every other command succeeds. */
const macWorld = (on: On, os: string) => world(on, { os })

test('/progress-bar setup mac-clicks on Linux says it needs macOS and runs nothing else', async ($, on) => {
  const { written, ran } = macWorld(on, 'Linux')
  const { text } = await run($, 'setup mac-clicks')
  expect(text).toBe(NOT_MAC)
  expect(ran).toEqual([['uname']])
  expect(written[`${HOME}/.claude-progress/.state/clicks-on`]).toBe(undefined)
})

test('/progress-bar setup --mac-clicks on macOS builds, signs and registers the app, then turns links on', async ($, on) => {
  const { written, ran } = macWorld(on, 'Darwin')
  const { text } = await run($, 'setup --mac-clicks')
  const app = `${HOME}/Applications/ProgressBarToggle.app`
  const script = `${HOME}/.claude/progress-bar/ProgressBarToggle.applescript`
  expect(text).toContain('Click to fold is on.')
  expect(written[script]).toBe(TOGGLE_APPLESCRIPT)
  expect(ran).toContainEqual(['osacompile', '-o', app, script])
  expect(ran).toContainEqual(['/usr/libexec/PlistBuddy', '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string progressbar', `${app}/Contents/Info.plist`])
  expect(ran).toContainEqual(['/usr/libexec/PlistBuddy', '-c', 'Set :CFBundleIdentifier com.hunterzh37.progressbar-toggle', `${app}/Contents/Info.plist`])
  expect(ran).toContainEqual(['codesign', '--force', '--deep', '-s', '-', app])
  expect(ran).toContainEqual([LSREGISTER, '-f', app])
  expect(written[`${HOME}/.claude-progress/.state/clicks-on`]).toBe('')
  expect(written[`${HOME}/.claude/progress-bar/group.py`]).toBe(GROUP_PY)
})

test('/progress-bar setup mac-clicks off unregisters and removes the app and flag', async ($, on) => {
  const { ran } = macWorld(on, 'Darwin')
  const { text } = await run($, 'setup mac-clicks off')
  const app = `${HOME}/Applications/ProgressBarToggle.app`
  expect(text).toContain('Click to fold is off.')
  expect(ran).toContainEqual([LSREGISTER, '-u', app])
  expect(ran).toContainEqual(['rm', '-rf', app, `${HOME}/.claude/progress-bar/ProgressBarToggle.applescript`, `${HOME}/.claude-progress/.state/clicks-on`])
})

test('the script prints one summary line while the panel is on, unless PB_FULL=1', async () => {
  const s = statusScript()
  expect(s).toContain('if [ -f "$HOME/.claude-progress/.state/panel-on" ] && [ "$PB_FULL" != 1 ]; then mode=--summary; fi')
  expect(s).toContain('| python3 "$group" $mode')
  expect(GROUP_PY).toContain("'--summary' in sys.argv[1:]")
  expect(GROUP_PY).toContain("full view in the Status panel")
})

test('prevOf reads the chained command back out of an installed script', async () => {
  expect(prevOf(statusScript("jq -r '.model'"))).toBe("jq -r '.model'")
  expect(prevOf(statusScript())).toBe(undefined)
})

const FULL = [
  '\x1b]8;;progressbar://toggle/todo\x07▾ ☐ TO-DO\x1b]8;;\x07',
  '  YOU: review PR · call Sam',
  '  MAC: run import',
  '▾ ▶ RUNNING',
  '  \x1b[33m⚠ stuck 12m\x1b[0m nightly-import ████████████████░░░░ 80.0% · 4/5 · batch 4 · 12m',
  '  ◐ Build docs █████░░░░░░░░░░░░░░░ 25.0% · 1/4 · render · 0m · 0 tools',
  '▸ ✔ DONE (2)',
  'opus 4 · main',
].join('\n')

test('the panel parser: sections, counts, folded headers and trailing lines', async () => {
  const { sections, other } = parseSections(stripAnsi(FULL).split('\n'))
  expect(sections.map(s => [s.key, s.folded, s.count, s.rows.length])).toEqual([['todo', false, 3, 2], ['running', false, 2, 2], ['done', true, 2, 0]])
  expect(other).toEqual(['opus 4 · main'])
  expect(runningRow(sections[1]!.rows[0]!)).toEqual({ mark: '⚠ 12m', stuck: true, name: 'nightly-import', pct: 80, details: '4/5 · batch 4 · 12m' })
  expect(runningRow(sections[1]!.rows[1]!).mark).toBe('◐')
})

/** A world for the panel: the status script answers `full`, files live in `files`. */
function panelWorld(on: On, files: Record<string, string>, full = FULL, answer: (argv: string[]) => string | undefined = () => undefined) {
  const ran: { argv: string[]; env?: Record<string, string>; stdin?: string }[] = []
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] as never }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('settings.read', () => ({ value: {} as never }))
  on('process.run', (_, e) => {
    ran.push({ argv: [...e.argv], env: e.init?.env, stdin: e.init?.stdin })
    if (e.argv[0] === 'rm') for (const f of e.argv.slice(2)) delete files[f]
    const stdout = e.argv[1]?.endsWith('statusline.sh') ? full : (answer([...e.argv]) ?? '')
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const opened: string[] = []
  on('ui.open', (_, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] as never }))
  return { ran, opened }
}

const SCRIPT = `${HOME}/.claude/progress-bar/statusline.sh`
const FLAG = `${DIR}/.state/panel-on`
const FOLDED = `${DIR}/.state/folded.txt`
const TODO_FILE = `${DIR}/todo.txt`
const PANE_PROPS = { title: 'Status', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

test('the panel draws sections and rows, and a header press writes folded.txt', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [TODO_FILE]: '[you]\nreview PR\ncall Sam\n[mac]\nrun import\n' }
  const { ran, opened } = panelWorld(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened).toEqual([PANE])
  expect(ran).toContainEqual({ argv: ['/bin/sh', SCRIPT], env: { PB_FULL: '1' }, stdin: '{}' })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Status', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  expect((await ui.find({ type: 'Text', text: /^  You$/ }))?.text).toBe('  You')
  expect((await ui.find({ type: 'Button', text: /call Sam/ }))?.text).toBe('    ○ call Sam')
  expect((await ui.find({ type: 'Button', text: /TO-DO/ }))?.text).toBe('▾ ☐ TO-DO  3')
  expect((await ui.find({ type: 'Text', text: /^nightly-import$/ }))?.text).toBe('nightly-import')
  expect((await ui.find({ type: 'Text', text: /4\/5 · batch 4/ }))?.text).toBe('    4/5 · batch 4 · 12m')
  await ui.press({ key: 'h-running' })
  expect(files[FOLDED]).toBe('running')
  await ui.press({ key: 'h-running' })
  expect(files[FOLDED]).toBe('')
  await ui.unmount()
})

test('/progress-bar panel on and off: the flag file, and setup first', async ($, on) => {
  const files: Record<string, string> = {}
  const { opened } = panelWorld(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened).toEqual([])
  expect((await run($, 'panel')).text).toContain('Run `/progress-bar setup` first.')
  files[SCRIPT] = statusScript("jq -r '.model'")
  expect((await run($, 'panel on')).text).toContain('Status panel on')
  expect(files[FLAG]).toBe('on\n')
  expect(prevOf(files[SCRIPT]!)).toBe("jq -r '.model'")
  expect(files[`${HOME}/.claude/progress-bar/group.py`]).toBe(GROUP_PY)
  expect(opened).toEqual([PANE])
  expect((await run($, 'panel off')).text).toContain('Status panel off')
  expect(files[FLAG]).toBe(undefined)
  expect((await run($, 'panel')).text).toContain('`/progress-bar panel on` opens it at every session start.')
})

const DONE_FULL = '▾ ▶ RUNNING\n  ◐ job ██░░ 50.0% · 1/2\n▾ ✔ DONE\n  nightly · finished 10:12\n'

test('open to-dos under TO-DO, checked-off ones under DONE; the menu marks done, moves back and deletes', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [TODO_FILE]: '# note\n[you]\nreview PR | https://x.test/1\nx old thing\ncall Sam\n[mac]\nx all done here\n' }
  panelWorld(on, files, DONE_FULL)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  expect((await ui.find({ type: 'Button', text: /TO-DO/ }))?.text).toBe('▾ ☐ TO-DO  2')
  expect((await ui.find({ type: 'Button', text: /review PR/ }))?.text).toBe('    ○ review PR')
  expect(await ui.find({ type: 'Text', text: /^  Mac$/ })).toBe(undefined)
  expect((await ui.find({ type: 'Button', text: /DONE/ }))?.text).toBe('▾ ✔ DONE  3')
  expect((await ui.find({ type: 'Text', text: /Checked-off to-dos/ }))?.text).toBe('  Checked-off to-dos')
  expect((await ui.find({ type: 'Button', text: /old thing/ }))?.text).toBe('    ✓ old thing')
  expect(await ui.find({ type: 'Button', text: /Mark as done/ })).toBe(undefined)

  await ui.press({ key: 't-2' })
  expect((await ui.find({ type: 'Button', text: /Mark as done/ }))?.text).toBe('✓ Mark as done  ')
  expect(await ui.find({ type: 'Button', text: /Move back/ })).toBe(undefined)
  await ui.press({ key: 'a-done-2' })
  expect(files[TODO_FILE]).toBe('# note\n[you]\nx review PR | https://x.test/1\nx old thing\ncall Sam\n[mac]\nx all done here\n')
  expect((await ui.find({ type: 'Button', text: /TO-DO/ }))?.text).toBe('▾ ☐ TO-DO  1')
  expect((await ui.find({ type: 'Button', text: /review PR/ }))?.text).toBe('    ✓ review PR')

  await ui.press({ key: 't-3' })
  expect((await ui.find({ type: 'Button', text: /Move back/ }))?.text).toBe('○ Move back to to-do  ')
  await ui.press({ key: 'a-todo-3' })
  expect(files[TODO_FILE]).toBe('# note\n[you]\nx review PR | https://x.test/1\nold thing\ncall Sam\n[mac]\nx all done here\n')
  expect((await ui.find({ type: 'Button', text: /old thing/ }))?.text).toBe('    ○ old thing')

  await ui.press({ key: 't-4' })
  await ui.press({ key: 'a-del-4' })
  expect(files[TODO_FILE]).toBe('# note\n[you]\nx review PR | https://x.test/1\nold thing\n[mac]\nx all done here\n')

  await ui.press({ key: 't-3' })
  await ui.press({ key: 'a-x-3' })
  expect(await ui.find({ type: 'Button', text: /Delete/ })).toBe(undefined)
  await ui.unmount()
})

test('with every to-do done, TO-DO hides and DONE shows them, so one can be moved back', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [TODO_FILE]: '[mac]\nx run import\n' }
  panelWorld(on, files, '▾ ▶ RUNNING\n  ◐ job ██░░ 50.0% · 1/2\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  expect(await ui.find({ type: 'Button', text: /TO-DO/ })).toBe(undefined)
  expect((await ui.find({ type: 'Button', text: /DONE/ }))?.text).toBe('▾ ✔ DONE  1')
  await ui.press({ key: 't-1' })
  await ui.press({ key: 'a-todo-1' })
  expect(files[TODO_FILE]).toBe('[mac]\nrun import\n')
  expect((await ui.find({ type: 'Button', text: /TO-DO/ }))?.text).toBe('▾ ☐ TO-DO  1')
  expect(await ui.find({ type: 'Button', text: /DONE/ })).toBe(undefined)
  await ui.unmount()
})

const SECRET = 'hunter2-s3cret'
const MCP_LIST = [
  'Checking MCP server health…',
  '',
  'claude.ai Gmail: https://gmail.mcp.claude.com/mcp - ✔ Connected',
  'claude.ai Canva: https://mcp.canva.com/mcp - ! Needs authentication',
  'claude.ai Adobe for creativity: https://adobe.example/mcp - ! Needs authentication',
  `db: npx -y @modelcontextprotocol/server-postgres postgres://admin:${SECRET}@db.example.com:5432/prod - ✔ Connected`,
  `broken: node /x/server.js --token ${SECRET} - ✗ Failed to connect`,
].join('\n')
const AUTH = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@x.test', orgName: 'Acme', orgId: 'org-1', accessToken: SECRET })

test('connector parsing keeps name and status only', async () => {
  expect(parseMcpList(MCP_LIST)).toEqual([
    { name: 'Gmail', kind: 'ok' },
    { name: 'Canva', kind: 'auth' },
    { name: 'Adobe', kind: 'auth' },
    { name: 'db', kind: 'ok' },
    { name: 'broken', kind: 'fail' },
  ])
  expect(JSON.stringify(parseMcpList(MCP_LIST))).not.toContain(SECRET)
  expect(connName('https://x.test/a')).toBe('')
  expect(parseLogin(AUTH)).toBe('me@x.test · Acme')
  expect(parseLogin('{"loggedIn":false,"email":"a@b"}')).toBe('')
  expect(parseLogin('not json')).toBe('')
  const cache = formatCache(parseMcpList(MCP_LIST), 'me@x.test · Acme', 1_800_000_000_000)
  expect(cache).toBe('Gmail\tok\nCanva\tauth\nAdobe\tauth\ndb\tok\nbroken\tfail\n#login\tme@x.test · Acme\n#checked\t1800000000\n')
  expect(parseCache(cache)).toEqual({ at: 1_800_000_000_000, login: 'me@x.test · Acme', list: parseMcpList(MCP_LIST) })
  expect(parseAccounts('# comment\nGmail\tme@gmail.test\nbad line\n')).toEqual(new Map([['Gmail', 'me@gmail.test']]))
  expect(connSummary(parseMcpList(MCP_LIST))).toBe('2 ok · 2 need sign-in · 1 failed')
})

/** Every text the drawing holds, joined. */
async function allText(ui: { findAll: (q: { type: 'Text' | 'Button' }) => Promise<{ text?: string }[]> }): Promise<string> {
  const out: string[] = []
  for (const type of ['Text', 'Button'] as const) for (const el of await ui.findAll({ type })) out.push(el.text ?? '')
  return out.join('\n')
}

test('the Connectors tab: checks claude mcp list, caches name and status only, never a URL or secret', async ($, on) => {
  const CACHE = `${HOME}/${CONN_CACHE_REL}`
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [`${DIR}/connector-accounts.txt`]: '# accounts\nGmail\tme@gmail.test\n' }
  const { ran } = panelWorld(on, files, DONE_FULL, argv =>
    argv[0] === 'claude' && argv[1] === 'mcp' ? MCP_LIST : argv[0] === 'claude' && argv[1] === 'auth' ? AUTH : undefined)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  expect(ran).toContainEqual({ argv: ['claude', 'mcp', 'list'], env: undefined, stdin: undefined })
  expect(ran.filter(r => r.argv[0] === 'claude' && r.argv[1] === 'mcp').length).toBe(1)
  expect(files[CACHE]).toContain('db\tok\n')
  expect(files[CACHE]).not.toContain(SECRET)
  expect(files[CACHE]).not.toContain('postgres')
  expect(files[CACHE]).not.toContain('https')

  expect((await ui.find({ type: 'Button', text: /List/ }))?.text).toBe('[ List ]')
  expect((await ui.find({ type: 'Button', text: /Connectors/ }))?.text).toBe('  Connectors !3  ')
  expect((await ui.find({ type: 'Button', text: /RUNNING/ }))?.text).toBe('▾ ▶ RUNNING  1')
  expect(await ui.find({ type: 'Text', text: /CONNECTORS/ })).toBe(undefined)

  await ui.press({ key: 'tab-connectors' })
  expect((await ui.find({ type: 'Button', text: /Connectors/ }))?.text).toBe('[ Connectors !3 ]')
  expect(await ui.find({ type: 'Button', text: /RUNNING/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /CONNECTORS/ }))?.text).toBe('⚡ CONNECTORS  2 ok · 2 need sign-in · 1 failed')
  expect((await ui.find({ type: 'Text', text: /Claude:/ }))?.text).toBe('  Claude: me@x.test · Acme')
  expect((await ui.find({ type: 'Text', text: /^Gmail$/ }))?.text).toBe('Gmail')
  expect((await ui.find({ type: 'Text', text: /me@gmail/ }))?.text).toBe('    me@gmail.test')
  expect((await ui.find({ type: 'Text', text: /needs sign-in/ }))?.text).toBe('  needs sign-in')
  expect((await ui.find({ type: 'Text', text: /^  failed$/ }))?.text).toBe('  failed')
  expect((await ui.find({ type: 'Text', text: /checked \d\d:\d\d/ }))?.text).toMatch(/^  checked \d\d:\d\d  $/)
  const text = await allText(ui)
  expect(text).toContain('Gmail')
  expect(text).toContain('broken')
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain('postgres')
  expect(text).not.toContain('accessToken')

  // Within 5 minutes nothing runs again; the refresh button forces a check.
  await ui.press({ key: 'tab-list' })
  await ui.press({ key: 'tab-connectors' })
  expect(ran.filter(r => r.argv[0] === 'claude' && r.argv[1] === 'mcp').length).toBe(1)
  await ui.press({ key: 'c-refresh' })
  expect(ran.filter(r => r.argv[0] === 'claude' && r.argv[1] === 'mcp').length).toBe(2)
  await ui.unmount()
})

test('a fresh shared cache is read, not refreshed', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [`${HOME}/${CONN_CACHE_REL}`]: `Gmail\tok\nCanva\tauth\n#checked\t${Math.floor((NOW - 60_000) / 1000)}\n` }
  const { ran } = panelWorld(on, files, DONE_FULL)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  expect(ran.some(r => r.argv[0] === 'claude')).toBe(false)
  expect((await ui.find({ type: 'Button', text: /Connectors/ }))?.text).toBe('  Connectors !1  ')
  await ui.press({ key: 'tab-connectors' })
  expect((await ui.find({ type: 'Text', text: /CONNECTORS/ }))?.text).toBe('⚡ CONNECTORS  1 ok · 1 need sign-in')
  await ui.unmount()
})
