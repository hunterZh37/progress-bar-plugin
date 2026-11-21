import { expect, test } from 'claude-code/testing'

import { PS_ARGVS, etimeMs, jobName, livePidsIn, normCmd, parseProcs, taskProc, START_SLACK_MS } from '../hooks/alive'
import { line } from '../hooks/render'
import type { Row } from '../hooks/render'
import { bgSegs, idleSegs, phaseOf, reportedBy, scanTranscript } from '../hooks/waiting'
import type { BgTask } from '../hooks/waiting'
import { noBarText, nowLine, runCard } from '../hooks/panel'

// Agent row states (0.35.3): pure helpers. The engine-level transitions are in session-owned.test.ts.

const NOW = 1_800_000_000_000
const REFRESH = `cd /Users/h/Desktop/data && (time psql -d appdb -X -q -v ON_ERROR_STOP=1 -f db/refresh.sql && time psql -d appdb -X -q -v ON_ERROR_STOP=1 -c "SET work_mem = '512MB'; SELECT refresh_research_layer();") > /private/tmp/claude/x/refresh.log 2>&1; echo exit $?`
// The real shape: ps prints the zsh wrapper with the command inside eval '...' (quotes escaped), and the child.
const PS = [
  `26063 26062 S    46:00 /bin/zsh -c source /Users/h/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true && eval '${REFRESH.replace(/'/g, `'"'"'`)}' < /dev/null && pwd -P >| /tmp/claude-eeb9-cwd`,
  '26064 26063 S    46:00 psql -d appdb -X -q -v ON_ERROR_STOP=1 -f db/refresh.sql',
  '  311     1 Ss   1-02:03:04 /usr/sbin/sshd',
  '  999     1 Z    00:10 (zsh)',
  'SELECT refresh_funder_prospects();") a continued line of a command with a newline',
].join('\n')
const task = (id: string, extra: Partial<BgTask> = {}): BgTask => ({ id, desc: `task ${id}`, kind: 'shell', at: NOW - 46 * 60_000, ...extra })

test('ps: one batched list (pid, parent, state, etime, command), etime in ms, broken lines skipped', () => {
  expect(PS_ARGVS[0]).toEqual(['ps', '-x', '-ww', '-o', 'pid=,ppid=,stat=,etime=,command='])
  expect(etimeMs('46:00')).toBe(46 * 60_000)
  expect(etimeMs('1-02:03:04')).toBe(((24 + 2) * 3600 + 3 * 60 + 4) * 1000)
  expect(etimeMs('00:10')).toBe(10_000)
  expect(etimeMs('junk')).toBe(-1)
  const procs = parseProcs(PS)
  expect(procs.map(p => p.pid)).toEqual([26063, 26064, 311, 999])
  expect(procs[3]!.stat).toBe('Z')
  expect(normCmd(`eval 'a '"'"'b'"'"''`)).toBe('eval a b')
})

test('a background shell is alive while its process runs: matched by command, never a zombie, never older than the launch', () => {
  const procs = parseProcs(PS)
  // The wrapper holds the command (quotes escaped); the outermost hit with no hit child is picked, its age kept.
  const p = taskProc(REFRESH, procs, NOW - 46 * 60_000, NOW)
  expect(p?.pid).toBe(26063)
  expect(p?.ageMs).toBe(46 * 60_000)
  // Gone: no process holds the command.
  expect(taskProc('until grep -qE "linked|failed" /tmp/sr/link.log; do sleep 5; done', procs, NOW - 3_600_000, NOW)).toBe(null)
  // A process older than the launch (minus 2 min of slack) is another run with the same command.
  expect(taskProc(REFRESH, procs, NOW - 10 * 60_000, NOW)).toBe(null)
  expect(taskProc(REFRESH, procs, NOW - 46 * 60_000 + START_SLACK_MS - 1000, NOW)?.pid).toBe(26063)
  // Clock skew: the launch stamped up to 2 min after ps's start still matches; an unknown launch skips the guard.
  expect(taskProc(REFRESH, procs, NOW - 45 * 60_000, NOW)?.pid).toBe(26063)
  expect(taskProc(REFRESH, procs, 0, NOW)?.pid).toBe(26063)
  // A process that only mentions the command (a grep, an editor, a prompt) is not running it.
  expect(taskProc(REFRESH, parseProcs(`  555  554 S    46:00 grep -rn ${REFRESH}`), 0, NOW)).toBe(null)
  expect(taskProc('python3 scripts/load.py', parseProcs('  556  1 S    05:00 python3 scripts/load.py --year 2025'), 0, NOW)?.pid).toBe(556)
  // A zombie never counts, and a too-short command never matches anything.
  expect(taskProc('zsh', procs, 0, NOW)).toBe(null)
  expect(taskProc('(zsh)', parseProcs('  999     1 Z    00:10 (zsh) x'), 0, NOW)).toBe(null)
})

test('pid reuse: a pid named in a progress file counts only if its process started before the file was written', () => {
  const procs = parseProcs(['4242 1 S+ 01:00:00 psql -f cand17.sql', '5151 1 S 00:05 /usr/bin/other', '6161 1 Z 01:00:00 (psql)'].join('\n'))
  const written = NOW - 20 * 60_000
  expect([...livePidsIn([4242, 5151, 6161, 7777], procs, written, NOW)]).toEqual([4242])
  // No write time known: no guard.
  expect([...livePidsIn([4242, 5151], procs, 0, NOW)].sort()).toEqual([4242, 5151])
  // Clock skew within the slack still counts.
  expect([...livePidsIn([5151], procs, NOW - 60_000, NOW)]).toEqual([5151])
})

test('a background job is named by the script it runs, else its description', () => {
  expect(jobName('Refresh derived views after linking', REFRESH)).toBe('db/refresh.sql')
  expect(jobName('Load filings', 'python3 -u /home/u/code/scripts/load_filings.py --year 2025 > load.log 2>&1')).toBe('scripts/load_filings.py')
  expect(jobName('Deploy', './deploy.sh prod')).toBe('./deploy.sh')
  expect(jobName('Wait for the top-up run', 'while pgrep -f after_load.sh; do sleep 600; done')).toBe('Wait for the top-up run')
  expect(jobName('Tail it', 'tail -f x.log > out.py')).toBe('Tail it')
  expect(jobName('', 'sleep 600 && echo done and then some more words here')).toBe('sleep 600 && echo done and then some mo…')
  expect(jobName('Build', 'cd web && FOO=1 time node scripts/build.mjs')).toBe('scripts/build.mjs')
})

test('a transcript: three finished tasks and one live: only the live one runs; a Monitor event never borrows a status', () => {
  const use = (id: string, cmd: string, desc: string, ts: string) => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: cmd, description: desc, run_in_background: true } }] } })
  const res = (id: string, task: string) => JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: ${task}. Output is being written to: /tmp/t/${task}.output` }] } })
  const note = (task: string, body: string) => JSON.stringify({ message: { content: `<task-notification>\\n<task-id>${task}</task-id>\\n${body}\\n</task-notification>` } })
  const text = [
    use('u1', 'python3 a.py', 'A', '2026-11-16T10:00:00Z'), res('u1', 'ba'), note('ba', '<tool-use-id>u1</tool-use-id>\\n<status>completed</status>'),
    use('u2', 'python3 b.py', 'B', '2026-11-16T10:10:00Z'), res('u2', 'bb'), note('bb', '<status>failed</status>'),
    use('u3', 'python3 c.py', 'C', '2026-11-16T10:20:00Z'), res('u3', 'bc'),
    // A Monitor event for another task right before c's kill notice: the kill is c's, not the monitor's.
    note('bm', '<summary>Monitor event: "log"</summary>'), note('bc', '<status>killed</status>'),
    use('u4', REFRESH, 'Refresh derived views after linking', '2026-11-16T21:03:42Z'), res('u4', 'b3ru338y4'),
  ].join('\n')
  const sc = scanTranscript(text)
  expect(sc.running.map(r => r.id)).toEqual(['b3ru338y4'])
  expect(sc.running[0]).toMatchObject({ desc: 'Refresh derived views after linking', kind: 'shell', at: Date.parse('2026-11-16T21:03:42Z') })
  expect(sc.ended.sort()).toEqual(['ba', 'bb', 'bc'])
  // An id whose call fell out of the parsed tail is still found, and still found over (its notice anywhere).
  const big = `${res('old', 'bold')}\n${'x'.repeat(5 * 1024 * 1024)}\n${note('bold', '<status>completed</status>')}\n${text}`
  expect(scanTranscript(big).running.map(r => r.id)).toEqual(['b3ru338y4'])
  // A TaskStop ends a task.
  const stop = `${text}\n${JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'u9', name: 'TaskStop', input: { task_id: 'b3ru338y4' } }] } })}`
  expect(scanTranscript(stop).running).toEqual([])
})

test('phases: running, background, blocked, done, idle', () => {
  const live = [task('b1')]
  const base = { status: 'waiting', live: [] as BgTask[], kids: [] as string[], watching: false, reported: false, lastTool: 'Bash' }
  expect(phaseOf({ ...base, status: 'running', live })).toBe('running')
  expect(phaseOf({ ...base, live })).toBe('background')
  // Its own live job wins over a report or a child: it is still working.
  expect(phaseOf({ ...base, live, reported: true, kids: ['k'] })).toBe('background')
  expect(phaseOf({ ...base, reported: true })).toBe('done')
  expect(phaseOf({ ...base, reported: true, watching: true })).toBe('done')
  expect(phaseOf({ ...base, kids: ['Grade the sample'] })).toBe('blocked')
  expect(phaseOf({ ...base, watching: true })).toBe('blocked')
  expect(phaseOf({ ...base, lastTool: 'ExitPlanMode' })).toBe('blocked')
  expect(phaseOf({ ...base, status: 'pending' })).toBe('blocked')
  expect(phaseOf(base)).toBe('idle')
  expect(reportedBy('SendMessage', 0, 0)).toBe(true)
  expect(reportedBy('SubagentHandback', 0, 0)).toBe(true)
  expect(reportedBy('Bash', NOW, NOW - 30_000)).toBe(true)
  expect(reportedBy('Bash', NOW, NOW - 3_600_000)).toBe(false)
  expect(reportedBy('Bash', NOW, 0)).toBe(false)
})

test('background segments: only the live job, the oldest when several, its time apart from its name', () => {
  const name = (t: BgTask) => jobName(t.desc, t.cmd)
  expect(bgSegs([task('b3', { cmd: REFRESH })], NOW, name)).toEqual(['background: db/refresh.sql', '46m'])
  expect(bgSegs([task('n', { at: NOW - 60_000, desc: 'Newer' }), task('o', { at: NOW - 2 * 3_600_000, desc: 'Older' })], NOW, name)).toEqual(['background: Older +1 more', '2h00m'])
  expect(bgSegs([task('m', { kind: 'monitor', desc: 'deploy goes green', at: 0 })], NOW, name)).toEqual(['background: monitor: deploy goes green'])
  // A launch stamped in the future (clock skew) shows no time rather than a negative one.
  expect(bgSegs([task('f', { at: NOW + 60_000 })], NOW, name)).toEqual(['background: task f'])
  expect(bgSegs([], NOW, name)).toEqual([])
  expect(bgSegs([task('w', { desc: 'Wait until matcher reports linked counts', at: NOW - 2 * 3_600_000 })], NOW, name, true)).toEqual(['background: Wait until matcher reports linked counts (left running after its report)', '2h00m'])
  expect(idleSegs('Bash', 'check log')).toEqual(['idle: no live background job', 'last action: Bash, check log'])
})

test('rows: a background or idle agent says working, only a blocked one says waiting; the panel reads the job and its time', () => {
  const row = (extra: Partial<Row>): Row => ({ id: 'a1', description: 'Data gap fixes', status: 'waiting', startedAt: NOW - 29 * 3_600_000, tools: 637, lastTool: 'Bash', done: null, total: null, step: '', ...extra })
  const bg = line(row({ phase: 'background', wait: ['background: db/refresh.sql', '46m'] }), NOW)
  expect(bg).toBe('▶ Data gap fixes working · background: db/refresh.sql · 46m · 29h00m · 637 tools · Bash')
  expect(bg).not.toContain('waiting')
  expect(line(row({ phase: 'idle', wait: idleSegs('Bash', '') }), NOW)).toBe('▶ Data gap fixes working · idle: no live background job · last action: Bash · 29h00m · 637 tools · Bash')
  expect(line(row({ phase: 'blocked', wait: ['waiting on: agent: Grade it', 'waiting 3m'] }), NOW)).toBe('▶ Data gap fixes waiting · waiting on: agent: Grade it · waiting 3m · 29h00m · 637 tools · Bash')
  // A row with a progress bar keeps the job after its step.
  expect(line(row({ phase: 'background', wait: ['background: db/refresh.sql', '46m'], done: 5, total: 12, step: 'Apply locally' }), NOW))
    .toBe('▶ Data gap fixes ████████░░░░░░░░░░░░ 41.7% · 5/12 · Apply locally · background: db/refresh.sql · 46m · 29h00m · 637 tools')
  const c = runCard('◐ Data gap fixes working · background: db/refresh.sql · 46m · 29h00m · 637 tools · Bash')
  expect([c.name, c.bg, c.elapsed, c.step]).toEqual(['Data gap fixes', 'db/refresh.sql · 46m', '29h00m', ''])
  expect(nowLine(c)).toBe('background: db/refresh.sql · 46m')
  const i = runCard('◐ Data gap fixes working · idle: no live background job · last action: Bash · 29h00m · 637 tools · Bash')
  // No % known: the time and tools sit on line one in the bar's place, so line two leaves the time out.
  expect(nowLine(i)).toBe('idle: no live background job · last action: Bash')
  expect(noBarText(i)).toBe('running · 29h00m · 637 tools · last: Bash')
})
