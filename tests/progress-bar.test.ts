import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { line, lines, parseProgress, slug, statusScript } from '../hooks/render'

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

/** Runs `/progress-bar <args>` as the person would type it. */
const run = ($: Engine, args: string) =>
  $.command.run({ command: 'progress-bar', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

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
    const text = files[e.path]
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
  expect(written[`${DIR}/.lines/agents.txt`]).toContain('▶ nightly-import')
})

test('/progress-bar setup writes the script and chains the old status line', async ($, on) => {
  const { written, ran } = world(on, { statusLine: { type: 'command', command: '~/bin/mine.sh' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await run($, 'setup')
  const path = `${HOME}/.claude/progress-bar/statusline.sh`
  expect(written[path]).toContain("prev='~/bin/mine.sh'")
  expect(ran).toContainEqual(['chmod', '+x', path])
  expect(text).toContain('~/bin/mine.sh')
  expect(text).toContain('"statusLine": { "type": "command", "command": "~/.claude/progress-bar/statusline.sh" }')
})

test('/progress-bar when the status line is wired', async ($, on) => {
  world(on, { statusLine: { type: 'command', command: '~/.claude/progress-bar/statusline.sh' }, scriptExists: true })
  const { text } = await run($, '')
  expect(text).toContain('Status line: on.')
})

test('/progress-bar with an unknown argument prints usage', async ($, on) => {
  world(on)
  const { text } = await run($, 'nope')
  expect(text).toBe('Usage: /progress-bar [setup | demo | clear]')
})
