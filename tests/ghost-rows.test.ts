import { expect, test } from 'claude-code/testing'
import type { Proc } from '../hooks/alive'
import { SHELL_GRACE_MS, STALE_FILE_MS, archivePath, commandParts, forkLinesRel, forkParentOf, parseShellFile, shellProc, shellVerdict, staleProgress, treeOf } from '../hooks/sweep'

// Ghost rows: a shell row shows as running only while a process of it runs, and a file whose session is gone is
// archived, never left running. A live process is never hidden, whoever started it.

const NOW = 1_800_000_000_000
const ME = 'aaaa1111-bbb'
const OTHER = 'cccc2222-ddd'
const START = NOW - 5 * 60_000
const wrapper = (pid: number, cmd: string, ageMs = 4 * 60_000, ppid = 500): Proc => ({ pid, ppid, stat: 'S', ageMs, command: `/bin/zsh -c source /u/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && eval '${cmd}' < /dev/null && pwd -P >| /tmp/claude-1-cwd` })
const file = (cmd: string, extra: Record<string, unknown> = {}) => parseShellFile({ title: 't', step: 'running in the background', session: `${ME}-x`, startedAt: START, command: cmd, taskId: 'b1', ...extra })
const ctx = (procs: Proc[] | null, o: Partial<{ mine: boolean; ownerKey: string; open: string[]; writtenAt: number }> = {}) => ({ mine: o.mine ?? false, ownerKey: o.ownerKey ?? ME, me: ME, openSessions: new Set(o.open ?? [ME]), procs, writtenAt: o.writtenAt ?? NOW - 1000, now: NOW })

test('a shell whose Bash tool process runs is live, wherever its session is', () => {
  const procs = [wrapper(900, 'sleep 600'), { pid: 901, ppid: 900, stat: 'S', ageMs: 4 * 60_000, command: 'sleep 600' }]
  expect(shellVerdict(file('sleep 600'), ctx(procs, { mine: true }))).toBe('live')
  expect(shellVerdict(file('sleep 600'), ctx(procs, { ownerKey: OTHER, open: [ME] }))).toBe('live')
  expect(treeOf(900, procs)).toEqual([900, 901])
})

test('its own shell whose process is gone ends; a gone session\'s shell is archived; another open session\'s is left to it', () => {
  expect(shellVerdict(file('sleep 600'), ctx([], { mine: true }))).toBe('end')
  expect(shellVerdict(file('sleep 600'), ctx([], { ownerKey: OTHER, open: [ME] }))).toBe('archive')
  expect(shellVerdict(file('sleep 600'), ctx([], { ownerKey: OTHER, open: [ME, OTHER] }))).toBe('owner')
  // An open session's leftover it no longer rewrites (lost before a restart or reload) is archived.
  expect(shellVerdict(file('sleep 600'), ctx([], { ownerKey: OTHER, open: [ME, OTHER], writtenAt: NOW - 10 * 60_000 }))).toBe('archive')
  // This session's own leftover from a copy before a reload.
  expect(shellVerdict(file('sleep 600'), ctx([], { mine: false }))).toBe('archive')
})

test('no evidence, no removal: a failed ps or a just-launched task waits', () => {
  expect(shellVerdict(file('sleep 600'), ctx(null, { mine: true }))).toBe('wait')
  expect(shellVerdict(file('sleep 600', { startedAt: NOW - SHELL_GRACE_MS + 5000 }), ctx([], { mine: true }))).toBe('wait')
  // A command too short to match safely is never ended on a missing process by its own session.
  expect(shellVerdict(file('top'), ctx([], { mine: true }))).toBe('wait')
})

test('an orphan child (parent pid 1) of a dead shell keeps the row live, by a pid it was seen with or by its command', () => {
  const orphan: Proc = { pid: 901, ppid: 1, stat: 'S', ageMs: 4 * 60_000, command: 'sleep 600' }
  expect(shellVerdict(file('sleep 600 && echo done', { pids: [900, 901] }), ctx([orphan], { ownerKey: OTHER }))).toBe('live')
  expect(shellVerdict(file('cd /tmp && sleep 600 && echo done'), ctx([orphan], { ownerKey: OTHER }))).toBe('live')
  // An older process with the same command is not this task's.
  const older: Proc = { ...orphan, ageMs: 60 * 60_000 }
  expect(shellVerdict(file('cd /tmp && sleep 600 && echo done'), ctx([older], { ownerKey: OTHER }))).toBe('archive')
  // A zombie is not alive.
  expect(shellVerdict(file('sleep 600', { pids: [901] }), ctx([{ ...orphan, stat: 'Z' }], { ownerKey: OTHER }))).toBe('archive')
})

test('a command a hook rewrote (rtk prefix) still matches its Bash tool shell', () => {
  const procs = [wrapper(900, 'rtk git log --oneline -200')]
  expect(shellProc(file('git log --oneline -200'), procs, NOW - 1000, NOW)?.pid).toBe(900)
})

test('a process that merely mentions the command (an editor, a grep) is not the task', () => {
  const grep: Proc = { pid: 77, ppid: 500, stat: 'S', ageMs: 60_000, command: 'grep -r sleep 600 .' }
  expect(shellVerdict(file('sleep 600'), ctx([grep], { mine: true }))).toBe('end')
})

test('foreground rows (no command kept) close with their session', () => {
  const fg = parseShellFile({ title: 'Build', step: 'running', session: `${OTHER}-x`, startedAt: START })
  expect(shellVerdict(fg, ctx([], { ownerKey: OTHER, open: [ME], writtenAt: NOW - 60_000 }))).toBe('archive')
  // Written just now (its session may be starting up): not yet.
  expect(shellVerdict(fg, ctx([], { ownerKey: OTHER, open: [ME] }))).toBe('wait')
  expect(shellVerdict(fg, ctx([], { ownerKey: OTHER, open: [ME, OTHER] }))).toBe('owner')
  expect(shellVerdict(fg, ctx([], { mine: true }))).toBe('wait')
})

test('commandParts splits on shell separators and drops short and keyword parts', () => {
  expect(commandParts("for i in 1 2; do ssh host 'x'; done && sleep 600")).toEqual(['for i in 1 2', 'ssh host x', 'sleep 600'])
})

test('staleProgress: only a file naming a gone session, with no life for an hour, is archived', () => {
  const base = { ownerKey: OTHER, me: ME, openSessions: new Set([ME]), writtenAt: NOW - STALE_FILE_MS - 1000, lifeAt: 0, until: 0, livePids: 0, now: NOW }
  expect(staleProgress(base)).toBe(true)
  expect(staleProgress({ ...base, ownerKey: '' })).toBe(false)
  expect(staleProgress({ ...base, openSessions: new Set([ME, OTHER]) })).toBe(false)
  expect(staleProgress({ ...base, livePids: 1 })).toBe(false)
  expect(staleProgress({ ...base, until: NOW + 60_000 })).toBe(false)
  expect(staleProgress({ ...base, lifeAt: NOW - 60_000 })).toBe(false)
  expect(staleProgress({ ...base, writtenAt: NOW - 10 * 60_000 })).toBe(false)
})

test('archivePath keeps the name and stamps the time', () => {
  expect(archivePath('/h/.claude-progress', 'shells', 'shell-x.json', NOW)).toMatch(/^\/h\/\.claude-progress\/\.archive\/shells\/shell-x-2027-.*\.json$/)
})

// Nov 20: a live agent ("Build gift in context", 4/7) was missing from the person's Status panel. It ran in a background
// fork of that session (kind "bg", `--fork-session --resume <parent>.jsonl`), so its rows went only to the fork's own
// line files. The fork now also writes them to a file the parent's view shows.
const KEY = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)
const FORK_CMD = '/u/.local/share/claude/versions/2.1.329 --session-id b6ca5fbb-00cb-4172-b7e9-73a38401af5e --fork-session --resume /u/.claude/projects/-u-NomBot/72877508-177c-4da3-b953-73c7819590f2.jsonl --model claude-opus-5-5 --permission-mode auto --name Understand this project (5)'

test('a background fork shows its rows in the session it was forked from', () => {
  expect(forkParentOf(FORK_CMD, 'bg', KEY)).toBe('72877508-177')
  expect(forkLinesRel('b6ca5fbb-00c', '72877508-177')).toBe('.lines/fork-b6ca5fbb-00c-72877508-177.txt')
  // The status script shows any fresh *-<session key>.txt, so the parent's view picks the file up.
  expect(/-72877508-177$/.test(forkLinesRel('b6ca5fbb-00c', '72877508-177').replace(/\.txt$/, ''))).toBe(true)
  // Only background forks: an interactive fork or a plain resume keeps its rows to itself.
  expect(forkParentOf(FORK_CMD, 'interactive', KEY)).toBe('')
  expect(forkParentOf('claude --resume 72877508-177c-4da3-b953-73c7819590f2', 'bg', KEY)).toBe('')
  expect(forkParentOf('claude --fork-session --resume 72877508-177c-4da3-b953-73c7819590f2', 'bg', KEY)).toBe('72877508-177')
})

test('a live agent\'s progress file is never archived while its session is open, however quiet', () => {
  const live = { ownerKey: 'b6ca5fbb-00c', me: ME, openSessions: new Set([ME, 'b6ca5fbb-00c']), writtenAt: NOW - 5 * STALE_FILE_MS, lifeAt: 0, until: 0, livePids: 0, now: NOW }
  expect(staleProgress(live)).toBe(false)
})

test('a command is matched to a word boundary: `sleep 62` is not an older `sleep 621` still running', () => {
  const procs: Proc[] = [{ pid: 5, ppid: 1, stat: 'S', ageMs: 60_000, command: 'sleep 621' }, wrapper(6, 'sleep 621', 60_000)]
  expect(shellVerdict(file('sleep 62', { startedAt: NOW - 120_000 }), ctx(procs, { mine: true }))).toBe('end')
  expect(shellProc(file('sleep 621', { startedAt: NOW - 120_000 }), procs, NOW - 1000, NOW)?.pid).toBe(5)
})
