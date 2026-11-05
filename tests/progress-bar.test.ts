import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONN_CACHE_REL, connUrl, connName, connSummary, formatCache, parseAccounts, parseCache, parseLogin, parseMcpList } from '../hooks/connectors'
import { CHECKPOINT_PY } from '../hooks/checkpoint'
import { clock } from '../hooks/done'
import { GROUP_PY } from '../hooks/group'
import { LSREGISTER, NOT_MAC, TOGGLE_APPLESCRIPT, parseMacClicks } from '../hooks/mac'
import { PANE, maxReading, noteShows, NOTE_MS, sameName, waitPhrase, waitReason, badge, evId, fitLabel, labelCol, machineTitle, machines, maxMeter, nestRows, runCount, shortTitle, parseSections, runCard, shortAge, timeTail, slide, stripAnsi } from '../hooks/panel'
import { EVENTS_PY, hhmm, insideDirs, parseEvents, parseLogDirs, unseenErrors } from '../hooks/events'
import { REPOS_REL, parseBranches, parseCommits, webUrl } from '../hooks/github'
import { blocker, clip, doneEvents, isRunningRow, jobMachine, keyWords, moveItem, nextPrompt, nextReady, parseCaps, parseItem, parseMode, rankTodos, ranked, rowName, shortJob, todoRows } from '../hooks/priority'
import { fileOf, parseProjects, projectSlug, resolveProject } from '../hooks/project'
import { aliveTasks, bgLaunch, jobText, oneLine, scanTranscript, snapOf, toolWhat, waitSegs, watchedJob } from '../hooks/waiting'
import { FEW_STEPS, RATE_MIN_MS, eta, expandHome, line, rateLeft, stepRate, trackJob, lines, parseProgress, parseTitles, pickMeta, parseWatch, prevOf, readLog, slug, statusScript, watchState, todoAdd, todoClear, todoDone, todoItems, todoList } from '../hooks/render'

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

test('a watched job: a fresh log is running, a stopped one whose log ends done is done', async () => {
  const p = { done: 3, total: 9, error: false }
  expect(watchState(p, false, 60_000, '  3/9 batches\n')).toBe('running')
  expect(watchState(p, false, 3 * 60_000, '  3/9 batches\n')).toBe('stopped')
  expect(watchState(p, false, 3 * 60_000, '  3/9 batches\ndone (cli): 45 orgs\n\n')).toBe('done')
  expect(watchState(p, false, 3 * 60_000, '  3/9 batches\n  9/9\n')).toBe('done')
  expect(watchState(p, true, 3 * 60_000, '  3/9 batches\n')).toBe('running')
  expect(watchState({ ...p, error: true }, false, 0, 'done\n')).toBe('error')
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
function world(on: On, opts: { statusLine?: { type: string; command: string }; scriptExists?: boolean; os?: string; gitDir?: string } = {}) {
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
    const text = files[e.path] ?? (e.path.endsWith('/todo.txt') || e.path.includes('/todos/') ? written[e.path] : undefined)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => { written[e.path] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: opts.gitDir ? e.path === opts.gitDir : !!opts.scriptExists }))
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

test('a progress file with no startedAt: elapsed from the file birth, time left from the rate, not the last write', async ($, on) => {
  const written: Record<string, string> = {}
  const BORN = NOW - (13 * 60 + 24) * 60_000
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] as never }))
  // Written a minute ago: the old build showed "1m" so far and a time left from that minute.
  on('fs.list', (_, e) => ({ value: e.path === DIR ? [{ name: 'label-top-ups.json', kind: 'file', size: 10, mtimeMs: NOW - 60_000, isLink: false }] : [] }))
  on('fs.read', (_, e) => {
    const files: Record<string, string> = { [`${DIR}/label-top-ups.json`]: '{"done":108108,"total":201041,"step":"youth: 4,199 of 14967 done, 7,196/h"}', ...written }
    if (files[e.path] === undefined) throw new Error('ENOENT')
    return { value: files[e.path]! }
  })
  on('fs.write', (_, e) => { written[e.path] = e.text; return { value: undefined } })
  on('fs.exists', () => ({ value: false }))
  on('settings.read', () => ({ value: {} as never }))
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: e.argv[0] === 'stat' ? `${BORN / 1000}\n` : e.argv[0] === 'uname' ? 'Darwin\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // 92,933 left at the step's 7,196/h is 12h55m (no rate base 5 min old yet).
  expect((await run($, '')).text.split('\n')[0]).toBe('▶ label-top-ups ███████████░░░░░░░░░ 53.8% · 108108/201041 · youth: 4,199 of 14967 done, 7,196/h · 13h24m · ETA 12h55m')
  expect(JSON.parse(written[`${DIR}/.state/job-track.json`]!)['label-top-ups']).toEqual({ start: BORN, at: NOW, done: 108108, seen: NOW })
})

test('finished agents never linger as waiting: a handback is remembered across reloads, a long silent wait is over', async ($, on) => {
  const written: Record<string, string> = {}
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [
    { id: 'done1', description: 'Rebuild finance trends', status: 'waiting' },
    { id: 'old0', description: 'Rebuild board links', status: 'waiting' },
    { id: 'live', description: 'Label top-ups watcher', status: 'waiting' },
  ] as never }))
  on('fs.list', () => ({ value: [] }))
  const seenFile = JSON.stringify({
    done1: { startedAt: NOW - 3_600_000, tools: 12, lastTool: 'SubagentHandback' },
    old0: { startedAt: NOW - 9 * 3_600_000, tools: 0, lastTool: '' },
    live: { startedAt: NOW - 9 * 3_600_000, tools: 9, lastTool: 'Bash' },
  })
  on('fs.read', (_, e) => {
    if (/\.state\/seen-[^/]*\.json$/.test(e.path)) return { value: seenFile }
    throw new Error('ENOENT')
  })
  on('fs.write', (_, e) => { written[e.path] = e.text; return { value: undefined } })
  on('fs.exists', () => ({ value: false }))
  on('settings.read', () => ({ value: {} as never }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await run($, '')
  // No task, job or step known, and no time saved by the old build: its last tool, and waiting since now.
  expect(text.split('\n')[0]).toBe('▶ Label top-ups watcher waiting · last action: Bash · waiting 0m · 9h00m · 9 tools · Bash')
  expect(text).not.toContain('Rebuild')
  // The saved list keeps the finished one, so the next reload still knows it handed back.
  const saved = Object.entries(written).find(([k]) => /\.state\/seen-[^/]*\.json$/.test(k))![1]
  expect(Object.keys(JSON.parse(saved)).sort()).toEqual(['done1', 'live', 'old0'])
})

test('job tracks: start, reset, and time left from the rate since first seen', () => {
  const t = trackJob(undefined, NOW, 100, NOW - 3_600_000)
  expect(t).toEqual({ start: NOW - 3_600_000, at: NOW, done: 100, seen: NOW })
  // Unknown birth: first seen. A count that went back is a new run.
  expect(trackJob(undefined, NOW, 5).start).toBe(NOW)
  expect(trackJob(t, NOW + 60_000, 50)).toEqual({ start: NOW + 60_000, at: NOW + 60_000, done: 50, seen: NOW + 60_000 })
  expect(trackJob(t, NOW + 60_000, 120)).toBe(t)
  // 100 done in the 10 min since first seen, 900 left: 1h30m.
  expect(rateLeft(t, NOW + 10 * 60_000, 200, 1100)).toBe('1h30m')
  // Under RATE_MIN_MS of history: the step's own rate, else the average since a known start, else nothing.
  expect(RATE_MIN_MS).toBe(5 * 60_000)
  expect(rateLeft(t, NOW + 60_000, 110, 1100, '60/min')).toBe('17m')
  expect(rateLeft(t, NOW + 60_000, 110, 1100, '', NOW - 110 * 60_000)).toBe('16h39m')
  expect(rateLeft(t, NOW + 60_000, 110, 1100)).toBe('')
  // Few steps take uneven time: none.
  expect(FEW_STEPS).toBe(20)
  expect(rateLeft(t, NOW + 10 * 60_000, 6, 8, '', NOW - 13 * 3_600_000)).toBe('')
  expect(stepRate('done, 7,196/h')).toBe(7196 / 3_600_000)
  expect(stepRate('31/min')).toBe(31 / 60_000)
  expect(stepRate('2021/22 grants')).toBe(0)
})

test('the id line drops a name the title already says, and the turn-on note clears after a few minutes', () => {
  expect(sameName('Hunty: similar orgs and NTEE suggestions', 'Hunty: Similar orgs and NTEE suggestions')).toBe(true)
  expect(sameName('Hunty: similar orgs and NTEE suggestions', 'Hunty similar orgs and NTEE suggestions')).toBe(true)
  expect(sameName('mac-label-top-ups-2021-23', 'Mac: Mac label top-ups 2021-23')).toBe(true)
  expect(sameName('box: train.py', 'Box: Train the model')).toBe(false)
  expect(noteShows({ note: 'Status line on', noteAt: NOW }, NOW + NOTE_MS - 1)).toBe(true)
  expect(noteShows({ note: 'Status line on', noteAt: NOW }, NOW + NOTE_MS)).toBe(false)
  expect(noteShows({ note: 'Status line on' }, NOW)).toBe(false)
})

test('/progress-bar with an unknown argument prints usage', async ($, on) => {
  world(on)
  const { text } = await run($, 'nope')
  expect(text.split('\n')[0]).toBe('Usage: /progress-bar [setup | demo | action | clear | todo | panel [on|off] | autonext [on|off|ask] | checkpoint [label] | inbox [setup] | channel | send <file> to <name> | say <name> <text> | fold <section> | unfold <section> | toggle <section>]')
})

test('/progress-bar todo add, list, done and clear write todo.txt', async ($, on) => {
  const { written } = world(on)
  const file = `${DIR}/todo.txt`
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await run($, 'todo')).text).toBe('No to-dos for todo.txt. Add one with /progress-bar todo add [name] <text>')
  expect((await run($, 'todo add [Mac] Run Import')).text).toContain('Added to [Mac].')
  await run($, 'todo add Call Sam')
  expect(written[file]).toContain('[Mac]\nRun Import\nCall Sam\n')
  expect((await run($, 'todo')).text).toBe('[Mac]\n  1. Run Import\n  2. Call Sam')
  expect((await run($, 'todo done 1')).text).toBe('Done: Run Import')
  expect((await run($, 'todo done sam')).text).toBe('Done: Call Sam')
  expect((await run($, 'todo clear')).text).toBe('Removed 2 done items.')
  expect(written[file]).not.toContain('Run Import')
})

test('per-project to-dos: map by longest prefix, else the git root under home, no folder is todo.txt', async () => {
  const map = '# prefix<TAB>project\n~/Desktop/NomBot\ttodo.txt\n~/.claude-progress\ttodo.txt\n~/Desktop/NomBot/web  Web App\n'
  expect(parseProjects(map, HOME)).toEqual([[`${HOME}/Desktop/NomBot`, 'todo.txt'], [`${HOME}/.claude-progress`, 'todo.txt'], [`${HOME}/Desktop/NomBot/web`, 'Web App']])
  expect(projectSlug(`${HOME}/Desktop/NomBot`, HOME)).toBe('desktop-nombot')
  expect(projectSlug(HOME, HOME)).toBe('home')
  expect(projectSlug('/srv/Cyber Portal/', HOME)).toBe('srv-cyber-portal')
  expect(fileOf('Web App')).toBe('todos/web-app.txt')
  expect(resolveProject(`${HOME}/Desktop/NomBot/api`, `${HOME}/Desktop/NomBot`, map, HOME)).toEqual({ slug: 'desktop-nombot', file: 'todo.txt' })
  expect(resolveProject(`${HOME}/.claude-progress`, '', map, HOME).file).toBe('todo.txt')
  expect(resolveProject(`${HOME}/Desktop/NomBot/web/src`, `${HOME}/Desktop/NomBot`, map, HOME)).toEqual({ slug: 'web-app', file: 'todos/web-app.txt' })
  expect(resolveProject(`${HOME}/Desktop/NomBotX`, `${HOME}/Desktop/NomBotX`, map, HOME).file).toBe('todos/desktop-nombotx.txt')
  expect(resolveProject(`${HOME}/code/cyber/app`, `${HOME}/code/cyber`, '', HOME)).toEqual({ slug: 'code-cyber', file: 'todos/code-cyber.txt' })
  expect(resolveProject(`${HOME}/scratch`, '', '', HOME).file).toBe('todos/scratch.txt')
  expect(resolveProject('', '', map, HOME)).toEqual({ slug: 'todo.txt', file: 'todo.txt' })
})

test('/progress-bar todo in another project uses its own list, and an unknown one starts empty', async ($, on) => {
  const { written } = world(on, { gitDir: `${HOME}/code/cyber/.git` })
  on('session.cwd', () => ({ value: `${HOME}/code/cyber/app` }))
  written[`${DIR}/todo.txt`] = '[mac]\nnombot thing\n'
  await $.session.start({ cwd: `${HOME}/code/cyber/app`, surface: 'terminal', isInteractive: true })
  expect((await run($, 'todo')).text).toBe('No to-dos for code-cyber. Add one with /progress-bar todo add [name] <text>')
  await run($, 'todo add [you] patch the portal')
  expect(written[`${DIR}/todos/code-cyber.txt`]).toContain('[you]\npatch the portal\n')
  expect(written[`${DIR}/todo.txt`]).toBe('[mac]\nnombot thing\n')
  expect((await run($, 'todo')).text).toBe('[you]\n  1. patch the portal')
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
  expect(runCard(sections[1]!.rows[0]!)).toEqual({
    mark: '⚠', stuck: '12m', name: 'nightly-import', pct: 80, count: '4 of 5 steps', kind: { icon: '⚙', text: 'job' },
    step: 'batch 4', facts: '⏱ 12m so far', maxUsed: null, waitOn: '', watchedBy: '', waited: '', note: '', left: '', ran: '', elapsed: '12m',
  })
  expect(runCard(sections[1]!.rows[1]!).mark).toBe('◐')
})

test('running cards: a kind badge per kind', async () => {
  expect(runCard('◐ healthcare-classify ██░░ 40.0% · 2/5 batches').kind).toEqual({ icon: '🏷', text: 'labeling' })
  expect(runCard('◐ orgs-verify ██░░ 40.0%').kind.icon).toBe('🏷')
  expect(runCard('◐ hunty:embed ██░░ 40.0% · 2/5').kind).toEqual({ icon: '🖥', text: 'on hunty' })
  expect(runCard('◐ gpu-box:train ██░░ 10.0%').kind).toEqual({ icon: '🖥', text: 'on gpu-box' })
  expect(runCard('◐ Build docs working · 3m · 12 tools · Edit').kind).toEqual({ icon: '🤖', text: 'Claude agent' })
  expect(runCard('◐ nightly-import ██░░ 40.0% · 2/5').kind).toEqual({ icon: '⚙', text: 'job' })
})

test('running cards: facts, step, count and the status word left out of the name', async () => {
  const a = runCard('◐ healthcare-classify running ████░░ 64.0% · 1234/2000 batches · 1h19m left · 42m · 31/min · scoring')
  expect(a.name).toBe('healthcare-classify')
  expect(a.count).toBe('1,234 of 2,000 batches')
  expect(a.step).toBe('scoring')
  // Time left shows on the job's line, never again in the facts.
  expect(a.facts).toBe('⏱ 42m so far   ⚡ 31/min')
  expect(a.left).toBe('1h19m')
  expect(runCard('◐ import ██░░ 40.0% · 2/5 · done in 1h').left).toBe('1h')
  expect(runCard('◐ import ██░░ 40.0% · 2/5 · done in 1h').facts).toBe('')
  expect(runCard('◐ import ██░░ 40.0% · ETA 5m').left).toBe('5m')
  const b = runCard('◐ Build docs working · 3m · 12 tools · Edit')
  expect(b.name).toBe('Build docs')
  expect(b.pct).toBe(null)
  expect(b.facts).toBe('⏱ 3m so far   🔧 12 actions · last: Edit')
})

test('one-line card time: a real time left, else an estimate from an item count, else time so far', async () => {
  // Labeling rows keep their reported time left.
  expect(timeTail(runCard('◐ healthcare-classify ████░░ 64.0% · 1234/2000 batches · 1h19m left · 42m · 31/min'))).toBe('1h19m left')
  // An item count with no rate: (12m / 30 done) x 50 left = ~20m.
  expect(timeTail(runCard('◐ Build docs working ██░░ 37.5% · 30/80 · 12m · 9 tools'))).toBe('~20m left')
  // Few steps take uneven time: no estimate (6 of 8 steps after 13h52m once said ~4h37m while the last step was nearly done).
  expect(timeTail(runCard('◐ Build docs working ██░░ 37.5% · 3/8 · 12m · 9 tools'))).toBe('12m so far')
  expect(timeTail(runCard('◐ Hunty: similar orgs ███░ 75.0% · 6/8 · codes: 15163 of 15,180 · 13h52m · 77 tools'))).toBe('13h52m so far')
  // No steps done yet, all done, or no counts: time so far, never a bare "12m".
  expect(timeTail(runCard('◐ Build docs working · 0/8 · 12m · 9 tools'))).toBe('12m so far')
  expect(timeTail(runCard('◐ Build docs working ████ 100.0% · 8/8 · 12m · 9 tools'))).toBe('12m so far')
  expect(timeTail(runCard('◐ Build docs working · 3m · 12 tools · Edit'))).toBe('3m so far')
  expect(timeTail(runCard('◐ box: train.py · 540% CPU · 12:50'))).toBe('12:50 running')
})

test('running cards: Claude Max weekly use is pulled out, not the bar %', async () => {
  const c = runCard('◐ orgs-judge ██░░ 30.0% · 3/10 · 7d 42%')
  expect(c.pct).toBe(30)
  expect(c.maxUsed).toBe(42)
  expect(c.step).toBe('')
  expect(runCard('◐ x-verify · Max 7-day used 81%').pct).toBe(null)
  expect(runCard('◐ x-verify · Max 7-day used 81%').maxUsed).toBe(81)
  expect(maxMeter(42)).toEqual({ filled: 4, color: 'green' })
  expect(maxMeter(65)).toEqual({ filled: 7, color: 'yellow' })
  expect(maxMeter(80)).toEqual({ filled: 8, color: 'red' })
  expect(maxMeter(48, 5)).toEqual({ filled: 2, color: 'green' })
})

test('the sliding piece moves one cell a second and wraps', async () => {
  expect(slide(0, 10)).toEqual([0, 7])
  expect(slide(3000, 10)).toEqual([3, 4])
  expect(slide(7000, 10)).toEqual([0, 7])
})

/** A world for the panel: the status script answers `full`, files live in `files`. */
function panelWorld(on: On, files: Record<string, string>, full = FULL, answer: (argv: string[]) => string | undefined = () => undefined) {
  const ran: { argv: string[]; env?: Record<string, string>; stdin?: string }[] = []
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] as never }))
  // The files directly in a folder, all changed just now.
  on('fs.list', (_, e) => ({ value: Object.keys(files).filter(f => f.startsWith(`${e.path}/`) && !f.slice(e.path.length + 1).includes('/')).map(f => ({ name: f.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }))
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
  expect(ran).toContainEqual({ argv: ['/bin/sh', SCRIPT], env: { PB_FULL: '1' }, stdin: '{"session_id":"","cwd":"","workspace":{"current_dir":""}}' })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { title: 'Status', isFocused: false, bodyColumns: 52, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } })
  expect((await ui.find({ type: 'Text', text: /^  You$/ }))?.text).toBe('  You')
  expect((await ui.find({ type: 'Button', text: /call Sam/ }))?.text).toBe(' 2.  📦 call Sam')
  expect((await ui.find({ type: 'Button', text: /TO-DO/ }))?.text).toBe('▾ ☐ TO-DO  3')
  // One line per job by default: the plain title button, the bar and %, then a yellow no-progress note under it. No details yet.
  expect((await ui.find({ type: 'Button', key: 'open-nightly-import' }))?.text).toBe(`▸ ${'Nightly import'.padEnd(26)}`)
  expect((await ui.find({ type: 'Text', text: /⚠ stuck/ }))?.text).toBe('⚠ stuck 12m')
  expect(await ui.find({ type: 'Text', text: /4 of 5 steps/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /🤖/ })).toBe(undefined)
  await ui.press({ key: 'open-nightly-import' })
  expect((await ui.find({ type: 'Button', key: 'open-nightly-import' }))?.text).toMatch(/^▾ Nightly import/)
  // Details sit in a box indented 4, so long text wraps under its indent, not back to column 0.
  expect((await ui.find({ type: 'Text', text: /4 of 5 steps/ }))?.text).toBe('4 of 5 steps')
  expect((await ui.find({ type: 'Text', text: /^batch 4$/ }))?.text).toBe('batch 4')
  expect((await ui.find({ type: 'Text', text: /so far/ }))?.text).toBe('⏱ 12m so far')
  // The id says nothing the title already says: the badge alone.
  expect((await ui.find({ type: 'Text', text: /⚙  job/ }))?.text).toBe('nightly-import   ⚙  job')
  expect(await ui.find({ type: 'Text', text: /🤖/ })).toBe(undefined)
  await ui.press({ key: 'open-nightly-import' })
  expect(await ui.find({ type: 'Text', text: /4 of 5 steps/ })).toBe(undefined)
  await ui.press({ key: 'h-running' })
  expect(files[FOLDED]).toBe('running')
  await ui.press({ key: 'h-running' })
  expect(files[FOLDED]).toBe('')
  await ui.unmount()
})

test('the panel draws an indeterminate bar without a %, and one compact usage meter at the top right', async ($, on) => {
  const full = ['▾ ▶ RUNNING', '  ◐ Build docs working · 3m · 12 tools · Edit', '  ◓ orgs-judge ███░░░░░░░ 30.0% · 3/10 · 7d 62%', '  ◑ orgs-verify ██░░ 20.0% · Max 7-day used 55%'].join('\n')
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n' }
  panelWorld(on, files, full)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 40 } })
  expect((await ui.find({ type: 'Text', text: /^  ┄+$/ }))?.text).toMatch(/^  ┄{10}$/)
  expect(await ui.find({ type: 'Text', text: /steps not reported/ })).toBe(undefined)
  await ui.press({ key: 'open-build-docs' })
  expect((await ui.find({ type: 'Text', text: /steps not reported/ }))?.text).toBe('steps not reported')
  // At 40 columns the meter ("Max 62% ━━━── 7d", 16) does not fit after the icon tabs (25 cells): its own line, right-aligned.
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  const at = texts.indexOf('Max ')
  expect(texts.slice(at - 1, at + 4)).toEqual([' '.repeat(40 - 16), 'Max ', '62% ', '━━━', '── 7d'])
  // Above the tabs, not after them.
  expect(at).toBeLessThan(texts.indexOf('☰ List'))
  await ui.press({ key: 'open-orgs-judge' })
  expect((await ui.find({ type: 'Text', text: /3 of 10 steps/ }))?.text).toBe('3 of 10 steps')
  await ui.unmount()
  // The usual 52 columns: the meter sits on the tab row's right end.
  const wide = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  const wt = (await wide.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(wt.indexOf('Max ')).toBeGreaterThan(wt.indexOf('🌐'))
  expect(wt[wt.indexOf('Max ') - 1]).toBe(' '.repeat(52 - 25 - 16))
  await wide.unmount()
})

test('/progress-bar panel on and off: the flag file, and setup first', { options: { openPanel: false, statusLine: false } }, async ($, on) => {
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
  expect((await ui.find({ type: 'Button', text: /review PR/ }))?.text).toBe(' 1.  📦 review PR')
  expect(await ui.find({ type: 'Text', text: /^  Mac$/ })).toBe(undefined)
  expect((await ui.find({ type: 'Button', text: /DONE/ }))?.text).toBe('▾ ✔ DONE  3')
  expect((await ui.find({ type: 'Button', key: 'dno-nightly' }))?.text).toBe('▸ Nightly')
  expect((await ui.find({ type: 'Text', text: /Checked-off to-dos/ }))?.text).toBe('  Checked-off to-dos')
  expect((await ui.find({ type: 'Button', text: /old thing/ }))?.text).toBe('    ✓ 📦 old thing')
  expect(await ui.find({ type: 'Button', text: /✓ Done/ })).toBe(undefined)

  await ui.press({ key: 't-2' })
  expect((await ui.find({ type: 'Button', text: /✓ Done/ }))?.text).toBe('✓ Done  ')
  expect(await ui.find({ type: 'Button', text: /Move back/ })).toBe(undefined)
  await ui.press({ key: 'a-done-2' })
  expect(files[TODO_FILE]).toBe('# note\n[you]\nx review PR | https://x.test/1\nx old thing\ncall Sam\n[mac]\nx all done here\n')
  expect((await ui.find({ type: 'Button', text: /TO-DO/ }))?.text).toBe('▾ ☐ TO-DO  1')
  expect((await ui.find({ type: 'Button', text: /review PR/ }))?.text).toBe('    ✓ 📦 review PR')

  await ui.press({ key: 't-3' })
  expect((await ui.find({ type: 'Button', text: /Move back/ }))?.text).toBe('○ Move back to to-do  ')
  await ui.press({ key: 'a-todo-3' })
  expect(files[TODO_FILE]).toBe('# note\n[you]\nx review PR | https://x.test/1\nold thing\ncall Sam\n[mac]\nx all done here\n')
  expect((await ui.find({ type: 'Button', text: /old thing/ }))?.text).toBe(' 1.  📦 old thing')

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

  expect((await ui.find({ type: 'Button', key: 'tab-list' }))?.text).toBe('☰ List')
  // Icons only, with the badge. The shown tab adds its name.
  expect((await ui.find({ type: 'Button', key: 'tab-connectors' }))?.text).toBe('🔌 !3')
  expect((await ui.find({ type: 'Text', text: /🎯/ }))?.text).toBe('🎯 Making the generosity database better')
  expect((await ui.find({ type: 'Button', text: /RUNNING/ }))?.text).toBe('▾ ▶ RUNNING  1')
  expect(await ui.find({ type: 'Text', text: /CONNECTORS/ })).toBe(undefined)

  await ui.press({ key: 'tab-connectors' })
  expect((await ui.find({ type: 'Button', key: 'tab-connectors' }))?.text).toBe('🔌 Connectors !3')
  expect(await ui.find({ type: 'Text', text: /🎯/ })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /CONNECTORS/ }))?.text).toBe('⚡ CONNECTORS  2 ok · 2 need sign-in · 1 failed')
  expect((await ui.find({ type: 'Text', text: /Claude:/ }))?.text).toBe('  Claude: me@x.test · Acme')
  // Since 0.13.3 a connector with a known web page is a button that opens it as the connected account;
  // one with no page (db, broken) stays plain text.
  expect((await ui.find({ type: 'Button', text: /^Gmail/ }))?.text).toBe('Gmail  ↗')
  expect((await ui.find({ type: 'Text', text: /^db$/ }))?.text).toBe('db')
  expect(await ui.find({ type: 'Button', text: /^db/ })).toBe(undefined)
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
  await ui.press({ key: 'c-open-Gmail' })
  expect(ran.some(r => /open$/.test(r.argv[0]!) && r.argv[1] === 'https://mail.google.com/mail/?authuser=me%40gmail.test')).toBe(true)

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
  expect((await ui.find({ type: 'Button', key: 'tab-connectors' }))?.text).toBe('🔌 !1')
  await ui.press({ key: 'tab-connectors' })
  expect((await ui.find({ type: 'Text', text: /CONNECTORS/ }))?.text).toBe('⚡ CONNECTORS  1 ok · 1 need sign-in')
  await ui.unmount()
})

test('a to-do action finds its item again when a line was added before the press', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [TODO_FILE]: '[you]\nreview PR\ncall Sam\n' }
  panelWorld(on, files, DONE_FULL)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  await ui.press({ key: 't-2' })
  // Another session adds a line above before the press: line 2 now holds "review PR".
  files[TODO_FILE] = '[you]\nnew thing\nreview PR\ncall Sam\n'
  await ui.press({ key: 'a-done-2' })
  expect(files[TODO_FILE]).toBe('[you]\nnew thing\nreview PR\nx call Sam\n')
  await ui.unmount()
})

test('the panel lists to-dos by priority with next and waits for, and Move up renumbers', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [TODO_FILE]: '[mac]\nloose\n2. second\n1. first (after nothing runs)\n' }
  panelWorld(on, files, DONE_FULL)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  await ui.press({ key: 't-1' })
  await ui.press({ key: 'a-up-1' })
  expect(files[TODO_FILE]).toBe('[mac]\n1. first (after nothing runs)\n2. loose\n3. second\n')
  await ui.unmount()
})

const SEP = '\x1f'
test('GitHub parsing: web URLs without credentials, branches and commits', async () => {
  expect(webUrl('git@github.com:acme/app.git\n')).toBe('https://github.com/acme/app')
  expect(webUrl(`https://user:${SECRET}@github.com/acme/app.git`)).toBe('https://github.com/acme/app')
  expect(webUrl('ssh://git@github.com/acme/app')).toBe('https://github.com/acme/app')
  expect(webUrl('https://gitlab.com/acme/app.git')).toBe('')
  expect(webUrl('https://github.com.evil.test/acme/app')).toBe('')
  expect(parseBranches(`*${SEP}main${SEP}ahead 2, behind 1\n ${SEP}dev${SEP}\n`)).toEqual([
    { name: 'main', current: true, ahead: 2, behind: 1 },
    { name: 'dev', current: false, ahead: 0, behind: 0 },
  ])
  expect(parseCommits(`abc1234${SEP}Fix it${SEP}3 weeks ago${SEP}Ann\n`)).toEqual([{ sha: 'abc1234', subject: 'Fix it', when: '3 weeks', author: 'Ann' }])
  expect([shortAge('3 weeks'), shortAge('2 hours'), shortAge('4 months'), shortAge('5 minutes')]).toEqual(['3w', '2h', '4mo', '5m'])
})

/** Stubbed git: `repos` maps a folder to its toplevel, origin, branches and log output. */
function gitAnswer(repos: Record<string, { origin: string; dirty?: string }>) {
  return (argv: string[]) => {
    if (argv[0] === 'uname') return 'Darwin\n'
    if (argv[0] !== 'git') return undefined
    const r = repos[argv[2]!]
    if (!r) return undefined
    const cmd = argv.slice(3).join(' ')
    if (cmd === 'rev-parse --show-toplevel') return `${argv[2]}\n`
    if (cmd === 'remote get-url origin') return `${r.origin}\n`
    if (cmd === 'branch --show-current') return 'main\n'
    if (cmd === 'status --porcelain') return r.dirty ?? ''
    if (cmd.startsWith('for-each-ref')) return `*${SEP}main${SEP}ahead 1\n ${SEP}feature/x${SEP}behind 2\n`
    if (cmd.startsWith('log')) return `abc1234${SEP}Add the GitHub tab${SEP}2 hours ago${SEP}Ann\ndef5678${SEP}First commit${SEP}3 weeks ago${SEP}Bo\n`
    return ''
  }
}

test('the GitHub tab draws the repo, other branches and commits, and a press opens the commit page', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [`${HOME}/${REPOS_REL}`]: '# extra repos\n/w/two\n' }
  const { ran } = panelWorld(on, files, DONE_FULL, gitAnswer({
    '/w/app': { origin: `https://bot:${SECRET}@github.com/acme/app.git`, dirty: ' M a.ts\n' },
    '/w/two': { origin: 'https://gitlab.com/acme/two.git' },
  }))
  on('session.cwd', () => ({ value: '/w/app' }))
  await $.session.start({ cwd: '/w/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  expect(ran.some(r => r.argv[0] === 'git')).toBe(false)
  await ui.press({ key: 'tab-github' })
  expect((await ui.find({ type: 'Button', text: /GitHub/ }))?.text).toBe('⎇ GitHub')
  expect((await ui.find({ type: 'Text', text: /repo \d of/ }))?.text).toBe('repo 1 of 2')
  expect((await ui.find({ type: 'Button', text: /↗/ }))?.text).toBe('app  ↗')
  expect((await ui.find({ type: 'Text', text: /^acme$/ }))?.text).toBe('acme')
  expect((await ui.find({ type: 'Text', text: /^● / }))?.text).toBe('● main')
  expect((await ui.find({ type: 'Text', text: /changed/ }))?.text).toBe('   ✎ 1 changed')
  expect((await ui.find({ type: 'Text', text: /OTHER BRANCHES/ }))?.text).toBe('\nOTHER BRANCHES  1')
  expect((await ui.find({ type: 'Button', text: /feature/ }))?.text).toBe('  ○ feature/x  ↓2')
  expect((await ui.find({ type: 'Button', text: /Add the GitHub tab/ }))?.text).toBe('  Add the GitHub tab')
  expect((await ui.find({ type: 'Text', text: /^  2h$/ }))?.text).toBe('  2h')
  expect((await ui.find({ type: 'Text', text: /click to open/ }))?.text).toBe('\n  click to open on GitHub · latest by Ann')
  expect(await allText(ui)).not.toContain(SECRET)

  await ui.press({ key: 'cb-abc1234' })
  expect(ran).toContainEqual({ argv: ['open', 'https://github.com/acme/app/commit/abc1234'], env: undefined, stdin: undefined })
  await ui.press({ key: 'br-feature/x' })
  expect(ran).toContainEqual({ argv: ['open', 'https://github.com/acme/app/tree/feature%2Fx'], env: undefined, stdin: undefined })
  expect(ran.some(r => r.argv.join(' ').includes(SECRET) && r.argv[0] === 'open')).toBe(false)

  // The second repo is on GitLab: it draws, but nothing opens.
  await ui.press({ key: 'repo-next' })
  expect((await ui.find({ type: 'Text', text: /repo \d of/ }))?.text).toBe('repo 2 of 2')
  expect((await ui.find({ type: 'Button', text: /↗/ }))?.text).toBe('two  ↗')
  const opens = ran.filter(r => r.argv[0] === 'open').length
  await ui.press({ key: 'gh-repo' })
  await ui.press({ key: 'cb-abc1234' })
  expect(ran.filter(r => r.argv[0] === 'open' || r.argv[0] === 'xdg-open').length).toBe(opens)
  await ui.unmount()
})

test('titles: progress-file fields and titles.txt columns', async () => {
  expect(pickMeta({ done: 1, title: ' Nightly import ', why: '', parent: 'big-batch', x: 2 })).toEqual({ title: 'Nightly import', parent: 'big-batch' })
  expect(pickMeta('nope')).toEqual({})
  expect(parseTitles('# id\ttitle\twhy\tparent\nbox: Rebuild\tRebuild lists\tsearch pages\tbig-batch\nnightly-import\tNightly import\n\nlonely\n')).toEqual({
    'box-rebuild': { title: 'Rebuild lists', why: 'search pages', parent: 'big-batch' },
    'nightly-import': { title: 'Nightly import' },
  })
})

test('running cards: N% CPU is a busy process, not progress; waiting on; spaced badges', async () => {
  const c = runCard('◐ box: train.py · 540% CPU · 12:50')
  expect(c.pct).toBe(null)
  expect(c.kind).toEqual({ icon: '🖥', text: 'on box' })
  expect(c.facts).toBe('⚙ 5.4 cores busy   ⏱ 12:50 running')
  expect(c.step).toBe('')
  expect(runCard('◐ big ██░░ 50.0% · 1/2 · a step · waiting on: Child job').waitOn).toBe('Child job')
  expect(badge({ icon: '🏷', text: 'labeling' })).toBe('🏷  labeling')
})

test('nesting: one level under a running parent, loops keep their own cards', async () => {
  const meta = { kid: { parent: 'big' }, grandkid: { parent: 'kid' }, a: { parent: 'b' }, b: { parent: 'a' }, orphan: { parent: 'gone' } }
  expect(nestRows(['big', 'kid', 'grandkid', 'orphan'], meta)).toEqual([{ i: 0, kids: [1] }, { i: 2, kids: [] }, { i: 3, kids: [] }])
  expect(nestRows(['a', 'b'], meta)).toEqual([{ i: 0, kids: [] }, { i: 1, kids: [] }])
})

test('events: parsing, unseen errors, log folders and the open-log check', async () => {
  const raw = [
    JSON.stringify({ ts: 100, level: 'error', source: 'x', title: 'X crashed', detail: 'boom', path: '/logs/x.log' }),
    'not json',
    JSON.stringify({ ts: 300, level: 'weird', source: 'y', title: 'Y note' }),
    JSON.stringify({ ts: 200, level: 'error', title: 'Z crashed' }),
  ].join('\n')
  const evs = parseEvents(raw)
  expect(evs.map(e => [e.ts, e.level, e.title])).toEqual([[300, 'info', 'Y note'], [200, 'error', 'Z crashed'], [100, 'error', 'X crashed']])
  expect(evs[2]).toEqual({ ts: 100, level: 'error', source: 'x', title: 'X crashed', detail: 'boom', path: '/logs/x.log' })
  expect(unseenErrors(evs, 150, 1000)).toBe(1)
  expect(unseenErrors(evs, 0, 100 + 86_400 + 1)).toBe(1)
  expect(parseLogDirs('# c\n~/logs/\nrelative\n/srv/jobs\n/\n', HOME)).toEqual([`${HOME}/logs`, '/srv/jobs'])
  expect(insideDirs(`${HOME}/logs/a.log`, [`${HOME}/logs`])).toBe(true)
  expect(insideDirs(`${HOME}/logs/../.ssh/id`, [`${HOME}/logs`])).toBe(false)
  expect(insideDirs(`${HOME}/logsx/a.log`, [`${HOME}/logs`])).toBe(false)
  expect(insideDirs('/etc/passwd', [`${HOME}/logs`])).toBe(false)
  expect(insideDirs(`${HOME}/logs/a.log`, [])).toBe(false)
  expect(evId(evs[0]!)).toMatch(/^300-y-y-note-[0-9a-z]+$/)
  expect(evId({ ...evs[0]!, title: 'x'.repeat(200) + 'a' })).not.toBe(evId({ ...evs[0]!, title: 'x'.repeat(200) + 'b' }))
  expect(hhmm(0).length).toBe(5)
})

test('events.py is stdlib python, safe to embed, and setup installs it beside group.py', async () => {
  expect(EVENTS_PY.startsWith('#!/usr/bin/env python3')).toBe(true)
  expect(EVENTS_PY).toContain('log-dirs.txt')
  expect(EVENTS_PY).not.toContain('${')
  expect(EVENTS_PY).not.toContain('hunty')
  expect(EVENTS_PY).not.toContain('label-logs')
  expect(GROUP_PY).toContain("'events.py'")
})

test('/progress-bar setup writes events.py beside group.py', async ($, on) => {
  const { written } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await run($, 'setup')
  expect(written[`${HOME}/.claude/progress-bar/events.py`]).toBe(EVENTS_PY)
  expect(written[`${HOME}/.claude/progress-bar/checkpoint.py`]).toBe(CHECKPOINT_PY)
  expect(text).toContain('group.py, events.py and checkpoint.py')
})

const TITLED_FULL = [
  '▾ ▶ RUNNING',
  '  ⚠ stuck 12m big-batch ███░ 75.0% · 6/8 · rebuild · 22m · 52 tools',
  '  ◐ child-step ██░░ 50.0% · 1/2 · y',
  '  ◐ box: train.py · 540% CPU · 12:50',
  '  ◐ other ██░░ 50.0% · 1/2 · a step · waiting on: Child job',
  '🖥 hunty ✓ helper healthy · load 1.96 on 12 cores · busy: 1 job running',
  '▾ ✔ DONE',
  '  finisher ████████████████████ 100.0% · 7/7 · tests pass · 6m · 38 tools',
  '  nightly · finished 10:12',
].join('\n')

test('the panel: titles, ids with badges, unlocks, a nested child, waiting on and one-line DONE rows', async ($, on) => {
  const files: Record<string, string> = {
    [SCRIPT]: statusScript(), [FLAG]: 'on\n',
    [`${DIR}/titles.txt`]: '# id\ttitle\twhy\tparent\nnightly\tNightly import · all files\nbox: train.py\tTrain the model\tbetter search\n',
    [`${DIR}/big-batch.json`]: '{"done":6,"total":8,"title":"Big batch · six parts","why":"unlocks: the weekly report"}',
    [`${DIR}/child-step.json`]: '{"done":1,"total":2,"parent":"big-batch","title":"Child step"}',
    [`${DIR}/finisher.json`]: '{"done":7,"total":7,"title":"Finisher · last part"}',
    // A done record with an impact for the grouper's finished row, and one older record only the records know.
    [`${DIR}/.state/done/nightly.json`]: JSON.stringify({ slug: 'nightly', title: 'Nightly import · all files', why: 'the morning dashboard', impact: ['Board links rebuilt: 1.29M pairs', '109K split people merged'], started: NOW - 80 * 60_000, finished: NOW - 60_000, machine: 'Mac', kind: 'job' }),
    [`${DIR}/.state/done/hunty-person-matcher-fix.json`]: JSON.stringify({ slug: 'hunty-person-matcher-fix', title: 'Hunty person matcher fix', impact: [], started: NOW - 3 * 3_600_000, finished: NOW - 2 * 3_600_000, machine: 'Mac', kind: 'agent' }),
    [`${DIR}/.state/done/last-week.json`]: JSON.stringify({ slug: 'last-week', title: 'Old job', impact: ['x'], finished: NOW - 2 * 86_400_000, machine: 'Mac', kind: 'job' }),
  }
  panelWorld(on, files, TITLED_FULL)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 60 } })
  const buttons = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^open-/.test(b.key ?? '')).map(b => b.text ?? '')
  // Closed: one line per top job with the short title, the child hidden until its parent opens.
  // At 60 columns the label column is 22 (labelCol leaves 13 columns for the note); a child's 4-space indent takes 4.
  expect(labelCol(60)).toBe(22)
  expect(labelCol(60, 4)).toBe(18)
  // Rows cluster by area inside RUNNING (Answer quality for "better search", else Other), each with its area icon. The
  // title gets the room left after the bar (rowCol: 34 at 60 columns), and the note and why go on a dim line under it.
  expect(await buttons()).toEqual([`▸ ${'Train the model'.padEnd(34)}`, `▸ ${'Big batch'.padEnd(34)}`, `▸ ${'Other'.padEnd(34)}`])
  let texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts.some(t => /⚠ stuck/.test(t))).toBe(false)
  expect(texts).toContain('waiting on Child step')
  expect(texts).toContain('waiting on Child job')
  expect(texts).toContain('12:50 running')
  expect(texts).toContain(' · better search')
  expect(texts).toContain(' · the weekly report')
  expect(texts.some(t => /540/.test(t))).toBe(false)
  expect(texts.some(t => /unlocks/.test(t))).toBe(false)
  for (const k of ['open-big-batch', 'open-box-train-py', 'open-other']) await ui.press({ key: k })
  texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('🤖  Claude agent')
  expect(texts).toContain('6 of 8 steps')
  expect(texts).toContain('waiting on: Child step')
  // The child shows under its open parent, marked ↳, with its own one line.
  expect(await buttons()).toContain(`▾ ${'Big batch'.padEnd(34)}`)
  expect(await buttons()).toContain(`▸ ${'Child step'.padEnd(30)}`)
  expect(texts).toContain('      ↳ ')
  // A busy process: no bar at 540%, cores and run time instead.
  expect(texts).toContain('box: train.py   🖥  on box')
  expect(texts.some(t => /540/.test(t))).toBe(false)
  expect(texts).toContain('⚙ 5.4 cores busy   ⏱ 12:50 running')
  // The grouper already said what it waits on.
  expect(texts).toContain('waiting on: Child job')
  // The open details never repeat the % or the time left.
  expect(texts.filter(t => /%/.test(t)).every(t => /^\s*\d+%$/.test(t))).toBe(true)
  // DONE: one dim line for a row at 100%, titles for finished jobs.
  expect(texts).toContain('  ✓ 📦 Finisher  finishing · 7/7')
  expect(texts.some(t => /█/.test(t) && /finish/.test(t))).toBe(false)
  // The machine status line is one short button at the end, its load only once opened, never a DONE row.
  expect(texts).toContain('▸ 🖥 hunty ✓')
  expect(texts.some(t => /load 1.96/.test(t))).toBe(false)
  await ui.press({ key: 'machines' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')).toContain('  🖥 hunty ✓ helper healthy · load 1.96 on 12 cores · busy: 1 job running')
  // Finished jobs are buttons with their titles: the grouper's row, then a record from the last 12 h. Older ones stay out.
  const done = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^dno-/.test(b.key ?? '')).map(b => b.text ?? '')
  expect(await done()).toEqual(['▸ Nightly import', '▸ Person matcher fix'])
  expect(texts).toContain('  10:12')
  expect(texts).toContain(`  ${clock(NOW - 2 * 3_600_000)}`)
  expect(texts).toContain('   3 improvements done today · 3 in progress')
  expect((await ui.find({ type: 'Button', key: 'h-done' }))?.text).toBe('▾ ✔ DONE  3')
  // The impact reads under the title before it is opened.
  expect(texts).toContain('Board links rebuilt: 1.29M pairs')
  // Opened: the impact lines, finish and run time with the machine badge, what it unlocks.
  await ui.press({ key: 'dno-nightly' })
  texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(await done()).toContain('▾ Nightly import')
  expect(texts.filter(t => t === 'Board links rebuilt: 1.29M pairs').length).toBe(1)
  expect(texts).toContain('Board links rebuilt: 1.29M pairs')
  expect(texts).toContain('109K split people merged')
  expect(texts).toContain(`finished ${clock(NOW - 60_000)} · ran 1h19m   🖥  Mac`)
  expect(texts).toContain('unlocks: the morning dashboard')
  // No impact: it says so.
  await ui.press({ key: 'dno-hunty-person-matcher-fix' })
  texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('no impact reported')
  expect(texts).toContain(`finished ${clock(NOW - 2 * 3_600_000)} · ran 1h00m   🖥  Mac`)
  await ui.unmount()
})

test('the Log tab: !N unseen errors, counts, filters, detail, open log only inside log folders', async ($, on) => {
  const S = NOW / 1000
  const ev = (ts: number, level: string, title: string, extra = {}) => JSON.stringify({ ts, level, source: 'nightly', title, ...extra })
  const files: Record<string, string> = {
    [SCRIPT]: statusScript(), [FLAG]: 'on\n',
    [`${DIR}/log-dirs.txt`]: '~/logs\n',
    [`${DIR}/events.jsonl`]: [
      ev(S - 600, 'success', 'Arts done'),
      ev(S - 300, 'warning', 'Nightly stuck', { detail: 'no progress for 12m' }),
      ev(S - 60, 'error', 'Nightly crashed', { detail: 'Traceback\nValueError: bad', path: `${HOME}/logs/nightly.log` }),
      ev(S - 30, 'error', 'Outside path', { path: '/etc/passwd' }),
      'not json',
    ].join('\n'),
    [`${DIR}/.state/log-seen.txt`]: String(S - 100),
  }
  const { ran } = panelWorld(on, files, '▾ ▶ RUNNING\n  ◐ job ██░░ 50.0% · 1/2\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  expect((await ui.find({ type: 'Button', key: 'tab-log' }))?.text).toBe('📜 !2')
  await ui.press({ key: 'tab-log' })
  expect(files[`${DIR}/.state/log-seen.txt`]).toBe(String(S))
  expect((await ui.find({ type: 'Button', key: 'tab-log' }))?.text).toBe('📜 Log')
  expect((await ui.find({ type: 'Text', text: /✖ 2 errors/ }))?.text).toBe('✖ 2 errors  ')
  expect((await ui.find({ type: 'Text', text: /⚠ 1 warning / }))?.text).toBe('⚠ 1 warning  ')
  expect((await ui.find({ type: 'Text', text: /✓ 1 done/ }))?.text).toBe('✓ 1 done')
  const rows = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^ev-/.test(b.key ?? ''))
  expect((await rows()).map(b => b.text ?? '')[0]).toContain('Outside path')
  const crashed = (await rows()).find(b => /Nightly crashed/.test(b.text ?? ''))!
  await ui.press({ key: crashed.key! })
  expect(await ui.find({ type: 'Text', text: /ValueError: bad/ })).toBeDefined()
  await ui.press({ key: (await ui.find({ type: 'Button', text: /open log/ }))!.key! })
  expect(ran.some(r => /open$/.test(r.argv[0]!) && r.argv[1] === `${HOME}/logs/nightly.log`)).toBe(true)
  const outside = (await rows()).find(b => /Outside path/.test(b.text ?? ''))!
  await ui.press({ key: outside.key! })
  expect(await ui.find({ type: 'Button', text: /open log/ })).toBe(undefined)
  expect(ran.some(r => r.argv[1] === '/etc/passwd')).toBe(false)
  await ui.press({ key: 'lf-warning' })
  const shown = await rows()
  expect(shown.length).toBe(1)
  expect(shown[0]!.text).toContain('Nightly stuck')
  await ui.unmount()
})

test('short titles and the label column', async () => {
  expect(shortTitle('Big batch · six parts')).toBe('Big batch')
  expect(shortTitle('Health care: classify orgs')).toBe('Health care')
  expect(shortTitle('hunty: embed · 148K orgs')).toBe('hunty: embed')
  expect(shortTitle('gpu-box: train: epoch 3')).toBe('gpu-box: train')
  expect(labelCol(52)).toBe(14)
  expect(labelCol(80)).toBe(34)
  expect(labelCol(52, 4)).toBe(10)
  // A running row (mark 4, "▸ " 2, label, bar 12, " 50%" 5) plus a 13-column note ("  3:10 running") fits the pane at every width from 50,
  // so the row never overflows and squeezes the bar onto two lines.
  for (let w = 52; w <= 120; w++) expect(4 + 2 + labelCol(w) + 12 + 5 + '  3:10 running'.length).toBeLessThanOrEqual(w)
  // Down to the narrowest pane (30), the fixed part (mark, label, bar, %) of a top row and a child row still fits.
  for (let w = 30; w <= 120; w++) for (const ind of [0, 4]) expect(ind + 4 + 2 + labelCol(w, ind) + 12 + 5).toBeLessThanOrEqual(w)
  expect(labelCol(30)).toBe(7)
  expect(labelCol(30, 4)).toBe(3)
  expect(fitLabel('abc', 5)).toBe('abc  ')
  expect(fitLabel('abcdefgh', 5)).toBe('abcd…')
})

test('remote nesting: a "<host>: name" job goes under the one running "<host>-" job', async () => {
  expect(nestRows(['hunty-rebuild', 'hunty: embed.py', 'other'], {})).toEqual([{ i: 0, kids: [1] }, { i: 2, kids: [] }])
  expect(nestRows(['gpu-box-train', 'gpu-box: train.py'], {})).toEqual([{ i: 0, kids: [1] }])
  // Two owners: ambiguous, so it keeps its own card. Its own parent wins over the host rule.
  expect(nestRows(['box-a', 'box-b', 'box: x'], {})).toEqual([{ i: 0, kids: [] }, { i: 1, kids: [] }, { i: 2, kids: [] }])
  expect(nestRows(['box-a', 'other', 'box: x'], { 'box-x': { parent: 'other' } })).toEqual([{ i: 0, kids: [] }, { i: 1, kids: [2] }])
  // Another remote job never owns one.
  expect(nestRows(['box: a', 'box: b'], {})).toEqual([{ i: 0, kids: [] }, { i: 1, kids: [] }])
})

test('running jobs: one aligned line each, a press opens the details', async ($, on) => {
  const full = ['▾ ▶ RUNNING', '  ◐ hunty-rebuild ██░░ 40.0% · 2/5 · 1h left', '  ◐ hunty: embed.py · 540% CPU · 3:10', '  ◓ a-much-longer-job-name-than-fits ███░ 75.0% · 3/4 · 5m left'].join('\n')
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n' }
  panelWorld(on, files, full)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  const lines = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^open-/.test(b.key ?? '')).map(b => b.text ?? '')
  // The remote job nests under hunty-rebuild, hidden while it is closed. Labels share one width, so bars line up.
  // Plain titles leave the machine out ("hunty-rebuild" reads "Rebuild"). The nested one is a sub-job.
  expect((await ui.find({ type: 'Text', text: /in progress/ }))?.text).toBe('   2 in progress')
  expect((await ui.find({ type: 'Button', key: 'h-running' }))?.text).toBe('▾ ▶ RUNNING  2 (+1 sub-job)')
  expect(await lines()).toEqual([`▸ ${'Rebuild'.padEnd(26)}`, `▸ ${fitLabel('A much longer job name than fits', 26)}`])
  expect(new Set((await lines()).map(l => l.length)).size).toBe(1)
  let texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('  40%')
  expect(texts).toContain('1h left')
  expect(texts.some(t => /2 of 5/.test(t))).toBe(false)
  await ui.press({ key: 'open-hunty-rebuild' })
  expect(await lines()).toEqual([`▾ ${'Rebuild'.padEnd(26)}`, `▸ ${'Embed.py'.padEnd(22)}`, `▸ ${fitLabel('A much longer job name than fits', 26)}`])
  texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('2 of 5 steps')
  expect(texts).toContain('hunty-rebuild   ⚙  job')
  expect(texts.filter(t => /1h left/.test(t))).toEqual(['1h left'])
  expect(texts.filter(t => /40%/.test(t))).toEqual(['  40%'])
  expect(texts).toContain('3:10 running')
  await ui.unmount()
})

test('waiting rows: no bar, one line "⏸ <title> · waiting on <what>", a press opens the details', async ($, on) => {
  const row = 'Hunty Schedule O places grant rematch ████████░░ 75.0% · 6/8 · graded 50/50 x4, waiting on 2021-22 grant adds before load · 1h08m · 88 tools'
  expect(waitReason(runCard(row), row)).toBe('2021-22 grant adds before load')
  expect(waitReason(runCard('deploy waits for build · 1m'))).toBe('build')
  expect(waitReason(runCard('arts-verify · waiting on: Arts labels'))).toBe('Arts labels')
  expect(waitReason(runCard('import pending'))).toBe('')
  const full = ['▾ ⏸ WAITING', `  ${row}`, '  Mac: rebuild trends waiting · 3h · 4 tools'].join('\n')
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [TODO_FILE]: '[mac]\nx a\n[hunty]\nx b\n' }
  panelWorld(on, files, full)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 60 } })
  const key = 'open-hunty-schedule-o-places-grant-rematch'
  expect((await ui.find({ type: 'Button', key }))?.text).toBe('▸ Schedule O places grant rematch')
  let texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts.filter(t => t === '  ⏸ ').length).toBe(2)
  expect(texts).toContain('waiting on 2021-22 grant adds before load')
  expect(texts).toContain('waiting')
  // No bar, no % on a waiting row.
  expect(texts.some(t => /[█░]/.test(t) || /^\s*\d+%$/.test(t))).toBe(false)
  await ui.press({ key })
  texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('6 of 8 steps')
  // The machine shows only in the open card.
  expect(texts).toContain('Hunty: Schedule O places grant rematch   🤖  Claude agent')
  expect(texts).toContain('graded 50/50 x4, waiting on 2021-22 grant adds before load')
  await ui.unmount()
})

test('section hotkeys follow the display order, and a watcher shows on the job it watches', async ($, on) => {
  const full = ['▾ ▶ RUNNING', '  ◐ label-top-ups ██░░ 40.0% · 2/5 · watched by: Label top-ups watcher', '▾ ⏸ WAITING', '  deploy waits for build · 1m', '▾ ✔ DONE', '  old · finished 10:12'].join('\n')
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [TODO_FILE]: '[mac]\nrun import\n' }
  panelWorld(on, files, full)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  const heads = (await ui.findAll({ type: 'Button' })).filter(b => /^h-/.test(b.key ?? ''))
  expect(heads.map(b => [b.key, (b as unknown as { props?: { hotkey?: string } }).props?.hotkey ?? (b as unknown as { hotkey?: string }).hotkey])).toEqual([['h-todo', '1'], ['h-running', '2'], ['h-waiting', '3'], ['h-done', '4']])
  // An area chip filters every section to its area (label work is Causes), a second press shows all again.
  expect((await ui.find({ type: 'Button', key: 'chip-causes' }))?.text).toBe('💚 1 ◒')
  await ui.press({ key: 'chip-causes' })
  expect(await ui.find({ type: 'Button', key: 'open-label-top-ups' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'open-deploy-waits-for-build' })).toBe(undefined)
  expect((await ui.find({ type: 'Button', key: 'h-waiting' }))?.text).toBe('▾ ⏸ WAITING  0')
  expect((await ui.find({ type: 'Text', text: /showing/ }))?.text).toBe('   showing 💚 Causes only, press it again for all')
  await ui.press({ key: 'chip-causes' })
  expect(await ui.find({ type: 'Button', key: 'open-deploy-waits-for-build' })).toBeDefined()
  await ui.press({ key: 'open-label-top-ups' })
  expect((await ui.find({ type: 'Text', text: /watched by/ }))?.text).toBe('watched by Label top-ups watcher')
  // The step stays clean: the watcher is not part of it.
  expect(await ui.find({ type: 'Text', text: /^watched by: / })).toBe(undefined)
  await ui.unmount()
})

test('the RUNNING count: top-level lines, nested ones noted', async () => {
  expect(runCount(['a', 'b'], {})).toBe('2')
  expect(runCount(['big', 'kid', 'box-x', 'box: y'], { kid: { parent: 'big' } })).toBe('2 (+2 sub-jobs)')
  expect(runCount(['big', 'kid'], { kid: { parent: 'big' } })).toBe('1 (+1 sub-job)')
})

test('running rows name their machine', () => {
  const m = machines(['hunty: embed', 'big-batch'], ['you', 'mac', 'hunty'])
  expect(m).toEqual({ local: 'Mac', remote: ['hunty'] })
  expect(machineTitle('hunty: embed', 'Similar orgs · 148K', m)).toBe('Hunty: Similar orgs')
  expect(machineTitle('hunty: embed', 'hunty: embed', m)).toBe('Hunty: Embed')
  expect(machineTitle('big-batch', 'Hunty CPU batch: checks', m)).toBe('Hunty: CPU batch')
  expect(machineTitle('hc', 'Health care: classify', m)).toBe('Mac: Health care')
  expect(machineTitle('x', 'Big batch', machines([], []))).toBe('Big batch')
})

test('connectors open their web page as the connected account', () => {
  expect(connUrl('Gmail', 'me@example.org')).toBe('https://mail.google.com/mail/?authuser=me%40example.org')
  expect(connUrl('Google Drive', 'me@example.org (unverified)')).toBe('https://drive.google.com/drive/my-drive?authuser=me%40example.org')
  expect(connUrl('Canva', 'not signed in')).toBe('https://www.canva.com/')
  expect(connUrl('my-db', '')).toBe('')
  expect(connUrl('my-db', '', 'https://example.org/admin')).toBe('https://example.org/admin')
})

// Priority to-dos and auto-next (hooks/priority.ts).
const PTODO = '[you]\nreply Sam\n[mac]\nloose one\n2. dependabot | https://gh.io/x\n1. Arts: verify (after classify)\nx 3. shipped\n[hunty]\n1. trends (after 2019-20 load)\n2. board links (after 2019-20 load)\n'

test('priority: an item splits into number, body, after and link', async () => {
  expect(parseItem('2. Grant links (after 2019-20 load) | https://x.org')).toEqual({ num: 2, body: 'Grant links (after 2019-20 load)', after: '2019-20 load', url: 'https://x.org' })
  expect(parseItem('plain')).toEqual({ num: null, body: 'plain', after: '', url: '' })
  expect(keyWords('the 2019-20 load')).toEqual(['2019', '20', 'load'])
})

test('priority: blocked while a running name or title holds every key word', async () => {
  expect(blocker('classify', ['arts_culture-classify'])).toBe('arts_culture-classify')
  expect(blocker('2019-20 load', ['Load 2019-20 filings'])).toBe('Load 2019-20 filings')
  expect(blocker('2019-20 load', ['Load 2018 filings'])).toBe('')
  const r = ranked(PTODO, ['Arts classify'])
  expect(r.filter(i => i.heading === 'mac').map(i => [i.num, i.body, i.blockedBy, i.next])).toEqual([
    [1, 'Arts: verify (after classify)', 'Arts classify', false],
    [2, 'dependabot', '', true],
    [null, 'loose one', '', false],
  ])
  expect(r.find(i => i.heading === 'you')!.next).toBe(false)
  expect(nextReady(PTODO, 'mac', [])!.body).toBe('Arts: verify (after classify)')
  expect(nextReady(PTODO, 'hunty', ['Load 2019-20 filings'])).toBe(null)
  expect(nextReady(PTODO, 'you', [])).toBe(null)
})

test('priority: panel to-dos rank the same way', async () => {
  const todos = [
    { owner: 'mac', text: 'b', done: false, line: 1 },
    { owner: 'mac', text: '1. a (after load)', done: false, line: 2 },
    { owner: 'mac', text: '2. c', done: false, line: 3 },
  ]
  expect(rankTodos(todos, ['big load']).map(t => [t.body, !!t.blockedBy, t.next])).toEqual([['a (after load)', true, false], ['c', false, true], ['b', false, false]])
})

test('priority: move up and down renumber the heading, matched by text', async () => {
  const up = moveItem(PTODO, 'loose one', 'up')!
  expect(up.split('\n').slice(3, 6)).toEqual(['1. Arts: verify (after classify)', '2. loose one', '3. dependabot | https://gh.io/x'])
  expect(up).toContain('x 3. shipped')
  expect(up).toContain('[you]\nreply Sam\n')
  const down = moveItem(PTODO, '1. trends (after 2019-20 load)', 'down')!
  expect(down.endsWith('[hunty]\n1. board links (after 2019-20 load)\n2. trends (after 2019-20 load)\n')).toBe(true)
  expect(moveItem(PTODO, '1. Arts: verify (after classify)', 'up')).toBe(null)
  expect(moveItem(PTODO, 'nothing like it', 'up')).toBe(null)
})

test('auto-next: machine, mode, caps, prompt and done events', async () => {
  const heads = ['you', 'mac', 'hunty']
  expect(jobMachine('hunty: embed', '', heads)).toBe('hunty')
  expect(jobMachine('cpu-batch', 'Hunty CPU batch', heads)).toBe('hunty')
  expect(jobMachine('Load 2019-20 filings', '', heads)).toBe('mac')
  expect(parseMode('on\n')).toBe('on')
  expect(parseMode('weird')).toBe('ask')
  expect(parseCaps('mac=4\nbox: 1\n')).toEqual({ mac: 4, hunty: 2, box: 1 })
  expect(nextPrompt('dependabot', 'https://gh.io/x')).toBe('Next up from the to-do list: dependabot (https://gh.io/x). Start it with a progress bar, and mark it done on the to-do list (/progress-bar todo done) once it runs.')
  const ev = ['{"ts": 100, "level": "success", "source": "a", "title": "A job done"}', '{"ts": 300, "level": "success", "source": "b", "title": "B done"}', '{"ts": 300, "level": "warning", "source": "c", "title": "C done"}', 'bad'].join('\n')
  expect(doneEvents(ev, 200)).toEqual([{ ts: 300, source: 'b', title: 'B' }])
  expect(rowName('⚠ stuck 16m Load 2019-20 filings █████░ 66.7% · 6/9')).toBe('Load 2019-20 filings')
  expect(isRunningRow('▶ build ████░░░░ 40.0% · 2/5')).toBe(true)
  expect(isRunningRow('▶ hunty ✓ helper healthy · load 0.98')).toBe(false)
  expect(isRunningRow('✔ docs ████████ 100.0% · 5/5')).toBe(false)
})

test('a just-finished job reads as a check with "just finished", not a job named "✔ …"', () => {
  const r = runCard('✔ import ██████████ 100.0% · just finished')
  expect(r.mark).toBe('✔')
  expect(r.name).toBe('import')
  expect(r.pct).toBe(100)
})

test('to-do rows: one line each, ▶ next, ⏸ blocked, one waits for line per run, no (after X) shown', async () => {
  const todos = [
    { owner: 'hunty', text: '1. trends per org (after 2019-20 load)', done: false, line: 1 },
    { owner: 'hunty', text: '2. grant links (after 2019-20 load)', done: false, line: 2 },
    { owner: 'hunty', text: '3. a very long title that will not fit in the pane at all', done: false, line: 3 },
  ]
  const rows = todoRows(rankTodos(todos, ['load-2019-20']), 40, b => (b === 'load-2019-20' ? 'Load 2019-20 filings · board history' : b))
  expect(rows.map(r => (r.kind === 'item' ? `${r.marker} ${r.num}  ${r.title}` : r.kind === 'waits' ? `~ ${r.text}` : r.kind))).toEqual([
    'head',
    '⏸  1.  trends per org',
    '⏸  2.  grant links',
    '~ waits for Load 2019-20 filin…',
    '▶  3.  a very long title that will …',
  ])
  // Items the file does not number are numbered by their place, so every row starts with "1.", "2.", ...
  const plain = [
    { owner: 'you', text: 'Add the Azure redirect', done: false, line: 1 },
    { owner: 'you', text: 'Verify the Google app', done: false, line: 2 },
  ]
  expect(todoRows(rankTodos(plain, []), 60).flatMap(r => (r.kind === 'item' ? [`${r.num} ${r.title}`] : []))).toEqual([
    ' 1. Add the Azure redirect',
    ' 2. Verify the Google app',
  ])
  expect(shortJob('Hunty: Similar orgs · step')).toBe('Hunty: Similar orgs')
  expect(shortJob('Arts classify: batch 3')).toBe('Arts classify')
  expect(clip('abcdef', 4)).toBe('abc…')
})

test('the Max meter keeps the last reading when no job reports one', () => {
  const at = new Date(2026, 10, 4, 12, 39).getTime()
  expect(maxReading(30, null, at)).toEqual({ used: 30, asOf: '', save: true })
  // A fresh reading (under 35 min) shows no time, an older one says when it was read.
  expect(maxReading(null, { pct: 22, at }, at + 60_000)).toEqual({ used: 22, asOf: '', save: false })
  expect(maxReading(null, { pct: 22, at }, at + 34 * 60_000).asOf).toBe('')
  expect(maxReading(null, { pct: 22, at }, at + 36 * 60_000)).toEqual({ used: 22, asOf: 'as of 12:39', save: false })
  expect(maxReading(null, { pct: 22, at }, at + 8 * 86_400_000).used).toBe(null)
  expect(maxReading(null, null, at).used).toBe(null)
})

test('why an agent waits: its tasks, a job it watches, its step, then its last action', () => {
  const sh = bgLaunch('Bash', { command: 'sleep 9', description: 'Wait for the top-up run to finish', run_in_background: true }, { backgroundTaskId: 'b1' }, NOW)!
  expect(sh).toEqual({ id: 'b1', desc: 'Wait for the top-up run to finish', kind: 'shell', at: NOW })
  const mon = bgLaunch('Monitor', { description: 'deploy goes green', timeout_ms: 300_000, command: 'until x; do sleep 5; done' }, { taskId: 'm1', timeoutMs: 300_000 }, NOW)!
  expect(mon).toEqual({ id: 'm1', desc: 'deploy goes green', kind: 'monitor', at: NOW, until: NOW + 300_000 })
  expect(bgLaunch('Monitor', { description: 'd', timeout_ms: 0 }, { taskId: 'm2', timeoutMs: 0, persistent: true }, NOW)!.until).toBe(undefined)
  expect(bgLaunch('Bash', { command: 'ls' }, { stdout: '' }, NOW)).toBe(null)
  // Alive: before a Monitor's deadline, and listed by any snapshot taken after it began.
  const snap = snapOf([{ id: 'b1', type: 'shell', status: 'running', description: 'x' }, { id: 'zz', status: 'completed' }], NOW + 1)!
  expect(snap.tasks.map(t => t.id)).toEqual(['b1'])
  expect(aliveTasks([sh, mon], snap, NOW + 1).map(t => t.id)).toEqual(['b1'])
  expect(aliveTasks([sh, mon], null, NOW + 400_000).map(t => t.id)).toEqual(['b1'])
  expect(snapOf(undefined, NOW)).toBe(null)
  const jobs = [{ name: 'mac-label-top-ups-2021-23', title: 'Mac label top-ups 2021-23', pct: 99.6, parent: '' }, { name: 'arts-verify', title: '', pct: null, parent: 'release-prep' }]
  expect(watchedJob('Mac label top-ups watcher', jobs)?.name).toBe('mac-label-top-ups-2021-23')
  expect(watchedJob('Mac Jev first pass for labels', jobs)).toBe(null)
  expect(jobText(jobs[0]!)).toBe('Mac label top-ups 2021-23 (99%)')
  const base = { desc: 'Release prep', status: 'waiting', tasks: [], kids: [], jobs, step: '', lastTool: 'Bash', lastWhat: 'check log', lastAt: NOW - 4 * 60_000, waitSince: NOW - 12 * 60_000 }
  expect(waitSegs({ ...base, tasks: [sh, mon], kids: ['Grade the sample'] }, NOW)).toEqual(['waiting on: Wait for the top-up run to finish (Mac label top-ups 2021-23 99%), monitor: deploy goes green (arts-verify), agent: Grade the sample', 'waiting 12m'])
  // A job whose parent is this agent.
  expect(waitSegs(base, NOW)).toEqual(['waiting on: arts-verify', 'waiting 12m'])
  expect(waitSegs({ ...base, desc: 'Label top-ups watcher' }, NOW)[0]).toBe('waiting on: Mac label top-ups 2021-23 (99%)')
  // Its own step says it, so nothing is added but the time.
  expect(waitSegs({ ...base, desc: 'Other', step: 'waiting for review' }, NOW)).toEqual(['waiting 12m'])
  expect(waitSegs({ ...base, desc: 'Other' }, NOW)).toEqual(['last action 4m ago: Bash, check log', 'waiting 12m'])
  expect(waitSegs({ ...base, desc: 'Other', lastTool: '', waitSince: 0 }, NOW)).toEqual([])
  expect(waitSegs({ ...base, status: 'pending' }, NOW)).toEqual(['not started yet'])
  expect(waitSegs({ ...base, status: 'running' }, NOW)).toEqual([])
  expect(toolWhat({ file_path: '/a/b/log.txt' })).toBe('log.txt')
  expect(toolWhat({ command: 'tail -5 x.log\nmore' })).toBe('tail -5 x.log')
  expect(oneLine('a · b\nc')).toBe('a, b c')
})

test('a waiting row says why with how long, and the open row says it in full', async ($, on) => {
  const jev = 'Mac Jev first pass for labels waiting · last action 4m ago: Bash, check log · waiting 12m · 59m · 54 tools · Bash'
  const c = runCard(jev)
  expect([c.name, c.note, c.waited, c.step, c.elapsed]).toEqual(['Mac Jev first pass for labels', 'last action 4m ago: Bash, check log', '12m', '', '59m'])
  expect(waitPhrase(c, jev)).toBe('last action 4m ago: Bash, check log')
  expect(waitPhrase(runCard('Mac Jev waiting · waiting on: Wait for the run · waiting 3m · 9m · 4 tools'))).toBe('waiting on Wait for the run')
  expect(waitPhrase(runCard('scraper waiting · rate limited, resumes 14:05 · 3m'))).toBe('paused by a rate limit: rate limited, resumes 14:05')
  expect(waitPhrase(runCard('import pending · batch 3'))).toBe('last step: batch 3')
  expect(waitPhrase(runCard('helper waiting · not started yet · 0m · 0 tools'))).toBe('not started yet')
  expect(waitPhrase(runCard('import pending'))).toBe('')
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [FLAG]: 'on\n', [TODO_FILE]: '[mac]\nx a\n' }
  panelWorld(on, files, ['▾ ⏸ WAITING', `  ${jev}`].join('\n'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 60 } })
  let texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('12m · last action 4m ago: Bash, check log')
  await ui.press({ key: 'open-mac-jev-first-pass-for-labels' })
  texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContain('last action 4m ago: Bash, check log · for 12m')
  await ui.unmount()
})

/** Transcript lines shaped like the real ones: a call, its result, and a task notice. */
const txUse = (id: string, name: string, input: Record<string, unknown>, ts: string) => JSON.stringify({ timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const txRes = (id: string, text: string) => JSON.stringify({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } })
const txNote = (task: string, status: string) => JSON.stringify({ message: { role: 'user', content: `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>x</tool-use-id>\n<status>${status}</status>\n<summary>Background command done</summary>\n</task-notification>` } })

test('a transcript tells a waiting agent: background tasks still running, its last call, the progress files it names', () => {
  const text = [
    'cut first line',
    txUse('t1', 'Bash', { command: 'cat > ~/.claude-progress/mac-label-top-ups-2021-23.json', description: 'Write the job bar' }, '2026-11-05T18:50:00.000Z'),
    txRes('t1', 'ok'),
    txUse('t2', 'Bash', { command: 'sleep 600', description: 'One long wait: run end or error/limit, checks every 10 min', run_in_background: true }, '2026-11-05T18:59:15.845Z'),
    txRes('t2', 'Command running in background with ID: bqz17syay. Output is being written to: /tmp/x'),
    txNote('bqz17syay', 'completed'),
    txUse('t3', 'Monitor', { description: 'deploy goes green', timeout_ms: 1000 }, '2026-11-05T19:00:00.000Z'),
    txRes('t3', 'Monitor started (task b64ssxvum, expires in 30m unless the source ends first)'),
    JSON.stringify({ message: { role: 'user', content: '<task-notification>\n<task-id>b64ssxvum</task-id>\n<event>[Monitor expired after 30m with no events delivered.]</event>\n</task-notification>' } }),
    txUse('t4', 'Bash', { command: 'while pgrep x; do sleep 600; done', description: 'One long wait with tighter error pattern, 10 min checks', run_in_background: true }, '2026-11-05T19:09:25.100Z'),
    txRes('t4', 'Command running in background with ID: b9g4q9ufq. Output is being written to: /tmp/y'),
  ].join('\n')
  const sc = scanTranscript(text)
  expect(sc.running).toEqual([{ id: 'b9g4q9ufq', desc: 'One long wait with tighter error pattern, 10 min checks', kind: 'shell' }])
  expect([sc.lastTool, sc.lastWhat, sc.lastAt]).toEqual(['Bash', 'One long wait with tighter error pattern, 10 min checks', Date.parse('2026-11-05T19:09:25.100Z')])
  expect(sc.files).toEqual(['mac-label-top-ups-2021-23'])
  // The real case: the agent's name shares no key words with the job, but its transcript writes the job's file.
  const jobs = [{ name: 'mac-label-top-ups-2021-23', title: 'Mac label top-ups 2021-23', pct: 90.2, parent: '' }]
  const w = { desc: 'Mac Jev first pass for labels', status: 'waiting', tasks: [], kids: [], jobs, step: '', lastTool: 'Bash', lastWhat: '', lastAt: 0, waitSince: NOW - 25 * 60_000, files: sc.files }
  expect(waitSegs(w, NOW)).toEqual(['waiting on: Mac label top-ups 2021-23 (90%)', 'waiting 25m'])
  expect(waitSegs({ ...w, tasks: sc.running.map(x => ({ ...x, kind: 'shell' as const, at: 0 })) }, NOW)[0]).toBe('waiting on: One long wait with tighter error pattern, 10 min checks (Mac label top-ups 2021-23 90%)')
})
