import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { GROUP_PY } from '../hooks/group'
import { eta, expandHome, line, lines, parseProgress, parseWatch, readLog, slug, statusScript, todoAdd, todoClear, todoDone, todoItems, todoList } from '../hooks/render'

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
function world(on: On, opts: { statusLine?: { type: string; command: string }; scriptExists?: boolean } = {}) {
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
  on('process.run', (_, e) => { ran.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
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
  expect(text.split('\n')[0]).toBe('Usage: /progress-bar [setup | demo | clear | todo | fold <section> | unfold <section> | toggle <section>]')
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
