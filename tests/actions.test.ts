import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

declare const setTimeout: (fn: (...a: unknown[]) => void, ms: number) => unknown

import { ACTION_PANE, ACTION_TOOL, GHOSTTY_SCRIPT, NOTIFY_SCRIPT, NOTIFY_TEXT, TERMINAL_SCRIPT, addAction, canRun, isSlashCommand, isTerminalFront, notifyArgv, runScriptPath, runScriptText, appliesTo, blockText, isGated, parseActions, parseAdd, parseGate } from '../hooks/actions'
import * as actionsMod from '../hooks/actions'
import { PANE } from '../hooks/panel'
import { statusScript } from '../hooks/render'
import type { Action } from '../types'

const HOME = '/home/u'
const P = `${HOME}/.claude-progress`
const AF = `${P}/actions.json`
const SCRIPT = `${HOME}/.claude/progress-bar/statusline.sh`
const PANE_PROPS = { title: 'Status', isFocused: false, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

const A = (o: Partial<Action> & { id: string; title: string }): Action => ({ why: '', priority: 'high', created: 1, status: 'open', ...o })

/** A fake machine. `passing` holds the check commands that exit 0. Every argv the plugin runs is kept. */
const fills: string[] = []
const toasts: string[] = []
const opened: string[] = []
function world(on: On, files: Record<string, string>, passing: Set<string>, darwin = true, front = 'Safari') {
  const ran: { argv: string[]; stdin?: string }[] = []
  opened.length = 0
  mock.env(on, { HOME, TERM_PROGRAM: 'ghostty' })
  on('fs.read', (_, e) => { const t = files[String(e.path)]; if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.write', (_, e) => { files[String(e.path)] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: String(e.path) in files }))
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1800000000000 }))
  on('clock.every', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('clock.after', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('session.cwd', () => ({ value: `${HOME}/Desktop/NomBot` }))
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    const stdin = e.init?.stdin
    ran.push({ argv, stdin })
    let exitCode = 0, stdout = ''
    if (argv[0] === 'uname') stdout = darwin ? 'Darwin' : 'Linux'
    if (argv[0] === '/bin/sh' && argv[2]?.includes('eval')) exitCode = passing.has(argv[4]!) ? 0 : 1
    if (argv[0] === '/bin/sh' && argv[2] === 'cat >> "$1"') files[argv[4]!] = (files[argv[4]!] ?? '') + (stdin ?? '')
    if (argv[0] === 'lsappinfo') stdout = argv[1] === 'front' ? 'ASN:0x0-0x1:\n' : `"${front}" ASN:0x0-0x1: (in front)\n    bundleID=[ NULL ]\n`
    if (argv[0] === '/bin/sh' && argv[2]?.includes('chmod 700')) files[argv[4]!] = stdin ?? ''
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.list', () => ({ value: [] as never }))
  on('settings.read', () => ({ value: {} as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__progress-bar__${e.name}` } }))
  on('ui.open', (_, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] as never }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.fill', (_, e) => { fills.push(e.text); return { isFilled: true } as never })
  on('ui.toast', (_, e) => { toasts.push(String((e as { text?: unknown }).text ?? '')); return { value: undefined } as never })
  return ran
}
const submit = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as never) as Promise<{ text?: string; drop?: string }>
const start = ($: Engine) => $.session.start({ cwd: `${HOME}/Desktop/NomBot`, surface: 'terminal', isInteractive: true })

test('parseActions: list or {actions}, bad rows skipped, control characters cleaned', () => {
  const t = JSON.stringify([{ id: 'a', title: 'T\nx', command: 'ls\u0007', status: 'weird' }, { id: 'a', title: 'dup' }, { title: 'no id' }, 7, { id: 'b', title: 'B', status: 'done', check: 'true', project: 'p' }])
  const l = parseActions(t)
  expect(l.map(a => [a.id, a.title, a.status])).toEqual([['a', 'T x', 'open'], ['b', 'B', 'done']])
  expect(l[0]!.command).toBe('ls')
  expect(parseActions(JSON.stringify({ actions: [{ id: 'z', title: 'Z' }] })).map(a => a.id)).toEqual(['z'])
  expect(parseActions('nope')).toEqual([])
})

test('addAction dedupes open ones, appliesTo matches slug, file or global', () => {
  const r = addAction([], { title: 'Deploy', command: 'make swap', why: 'ship', check: 'test -e x', project: 'desktop-nombot' }, 5, 'id1')
  expect(r.isNew).toBe(true)
  expect(r.action).toEqual({ id: 'id1', title: 'Deploy', why: 'ship', priority: 'high', created: 5, status: 'open', command: 'make swap', check: 'test -e x', project: 'desktop-nombot' })
  expect(addAction(r.list, { title: 'Deploy', command: 'make swap' }, 6, 'id2').isNew).toBe(false)
  const proj = { slug: 'desktop-nombot', file: 'todo.txt' }
  expect(appliesTo(A({ id: 'g', title: 'g' }), proj)).toBe(true)
  expect(appliesTo(A({ id: 'p', title: 'p', project: 'desktop-nombot' }), proj)).toBe(true)
  expect(appliesTo(A({ id: 'f', title: 'f', project: 'todo.txt' }), proj)).toBe(true)
  expect(appliesTo(A({ id: 'o', title: 'o', project: 'code-cyber' }), proj)).toBe(false)
  expect(appliesTo(A({ id: 'o', title: 'o', project: 'code-cyber' }), { slug: 'x', file: 'todos/code-cyber.txt' })).toBe(true)
})

test('gate words: done, skip <reason>, skip alone, anything else', () => {
  expect(parseGate('done')).toEqual({ kind: 'done' })
  expect(parseGate('  Done. ')).toEqual({ kind: 'done' })
  expect(parseGate('I ran it')).toEqual({ kind: 'done' })
  expect(parseGate('skip not needed today')).toEqual({ kind: 'skip', reason: 'not needed today' })
  expect(parseGate('Skip: later')).toEqual({ kind: 'skip', reason: 'later' })
  expect(parseGate('skip')).toEqual({ kind: 'skip-empty' })
  expect(parseGate('done with the review, now fix the bug')).toBeNull()
  expect(parseGate('skipper')).toBeNull()
  expect(parseGate('fix the tests')).toBeNull()
})

test('isGated: only the person\'s own prompts, never slash commands, notifications or peers', () => {
  expect(isGated({ text: 'hi', origin: { kind: 'composer' } })).toBe(true)
  expect(isGated({ text: 'hi', origin: { kind: 'bridge' } })).toBe(true)
  expect(isGated({ text: '/progress-bar action list', origin: { kind: 'composer' } })).toBe(false)
  expect(isGated({ text: '  /plugin update progress-bar', origin: { kind: 'composer' } })).toBe(false)
  expect(isGated({ text: 'x', command: { name: 'plugin', args: '' }, origin: { kind: 'composer' } })).toBe(false)
  expect(isGated({ text: 'x', isMeta: true, origin: { kind: 'composer' } })).toBe(false)
  expect(isGated({ text: 'x', origin: { kind: 'task-notification' } })).toBe(false)
  expect(isGated({ text: 'x', origin: { kind: 'peer' } })).toBe(false)
})

test('no system dialog anywhere, the notification text reaches osascript only as argv', () => {
  const evil = 'x" & (do shell script "rm -rf ~") & "\\ \n end run'
  const a = A({ id: 'e', title: evil, why: evil, command: `echo "${evil}"`, check: evil })
  const n = notifyArgv(a)
  expect(n.slice(0, 1 + NOTIFY_SCRIPT.length * 2)).toEqual(['osascript', ...NOTIFY_SCRIPT.flatMap(l => ['-e', l])])
  expect(n.slice(1 + NOTIFY_SCRIPT.length * 2)).toEqual([NOTIFY_TEXT, evil])
  expect(NOTIFY_SCRIPT.join('\n')).toContain('display notification (item 1 of argv) with title "Claude Code" subtitle (item 2 of argv)')
  expect(NOTIFY_SCRIPT.join('\n')).not.toContain('rm -rf')
  for (const v of Object.values(actionsMod)) {
    const t = Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v : typeof v === 'function' ? String(v) : ''
    expect(t).not.toContain('display dialog')
  }
  expect(isTerminalFront('Ghostty', 'ghostty')).toBe(true)
  expect(isTerminalFront('Safari', 'ghostty')).toBe(false)
  expect(isTerminalFront('iTerm2', '')).toBe(true)
  expect(isTerminalFront('', 'ghostty')).toBe(false)
})

test('parseAdd: title and flags, values run to the next flag, pipes kept', () => {
  expect(parseAdd('"Delete repo" --command gh repo delete x --yes --why cleanup --check gh repo view x | grep -q nope --global')).toEqual({
    title: 'Delete repo', command: 'gh repo delete x --yes', why: 'cleanup', check: 'gh repo view x | grep -q nope', global: true,
  })
  expect(parseAdd('Log in to Vercel')).toEqual({ title: 'Log in to Vercel', global: false })
  expect(parseAdd('  ')).toBeNull()
})

test('blockText names the action, the command and how to go on, no semicolons or em dashes', () => {
  const t = blockText([A({ id: 'a', title: 'Swap the build', why: 'users see the fix', command: 'make swap', check: 'test -e x' }), A({ id: 'b', title: 'b' })])
  expect(t).toContain('⛔ Action needed: Swap the build')
  expect(t).toContain('Run: make swap')
  expect(t).toContain('type done')
  expect(t).toContain('skip <reason>')
  expect(t).toContain('/progress-bar action list')
  expect(t).toContain('1 more open')
  expect(/[;—]/.test(t)).toBe(false)
})

test('gate: a prompt is held, slash commands pass, done clears an action with no check and the held text comes back', async ($, on) => {
  const files: Record<string, string> = { [AF]: JSON.stringify([A({ id: 'a1', title: 'Log in to Vercel', command: 'vercel login', why: 'deploys need it' })]) }
  fills.length = 0
  const ran = world(on, files, new Set())
  await start($)
  const r1 = await submit($, 'fix the header')
  expect(r1.drop).toContain('⛔ Action needed: Log in to Vercel')
  expect(r1.drop).toContain('Run: vercel login')
  const slash = await $.prompt.submit({ text: '/progress-bar action list', origin: { kind: 'composer' }, wait: false, command: { name: 'progress-bar', args: 'action list' } } as never) as { drop?: string }
  expect(slash.drop).toBeUndefined()
  const r2 = await submit($, 'done')
  expect(r2.drop).toContain('✓ Action done: Log in to Vercel')
  expect(r2.drop).toContain('No actions left')
  expect(parseActions(files[AF]!)[0]!.status).toBe('done')
  expect(fills).toEqual(['fix the header'])
  expect(files[`${P}/events.jsonl`]).toContain('"level":"success"')
  const r3 = await submit($, 'fix the header')
  expect(r3.drop).toBeUndefined()
  // The action's command itself was never run.
  expect(ran.some(r => r.argv.join(' ').includes('vercel login') && r.argv[0] !== 'osascript')).toBe(false)
})

test('gate: done with a failing check keeps it, skip <reason> clears it and logs a warning', async ($, on) => {
  const files: Record<string, string> = { [AF]: JSON.stringify([A({ id: 'a1', title: 'Delete the repo', command: 'gh repo delete x --yes', check: 'test ! -e /x' })]) }
  const ran = world(on, files, new Set())
  await start($)
  const r1 = await submit($, 'done')
  expect(r1.drop).toContain('Check still fails for: Delete the repo')
  expect(parseActions(files[AF]!)[0]!.status).toBe('open')
  expect((await submit($, 'skip')).drop).toContain('Say why')
  const r2 = await submit($, 'skip the repo is needed for a demo')
  expect(r2.drop).toContain('Skipped: Delete the repo')
  const a = parseActions(files[AF]!)[0]!
  expect([a.status, a.skipReason]).toEqual(['skipped', 'the repo is needed for a demo'])
  expect(files[`${P}/events.jsonl`]).toContain('"level":"warning"')
  expect(files[`${P}/events.jsonl`]).toContain('Reason: the repo is needed for a demo')
  expect(ran.some(r => r.argv[0] !== 'osascript' && r.argv.join(' ').includes('gh repo delete'))).toBe(false)
})

test('gate: a check that passes clears the action before blocking, so the prompt goes through', async ($, on) => {
  const files: Record<string, string> = { [AF]: JSON.stringify([A({ id: 'a1', title: 'Swap build', command: 'mv a b', check: 'grep -qx B id' }), A({ id: 'a2', title: 'Other project', project: 'code-cyber' })]) }
  const passing = new Set(['grep -qx B id'])
  const ran = world(on, files, passing)
  await start($)
  const r = await submit($, 'next task please')
  expect(r.drop).toBeUndefined()
  expect(parseActions(files[AF]!).map(a => a.status)).toEqual(['done', 'open'])
  const checks = ran.filter(x => x.argv[0] === '/bin/sh' && x.argv[2]?.includes('eval'))
  expect(checks.length).toBeGreaterThan(0)
  expect(checks.every(x => x.argv[4] === 'grep -qx B id')).toBe(true)
})

test('action_add tool: writes the action, opens the Action needed pane, notifies only when away, copies via stdin', async ($, on) => {
  const files: Record<string, string> = {}
  const ran = world(on, files, new Set())
  await start($)
  expect(ACTION_TOOL.name).toBe('action_add')
  const r = await $.tool.call({ tool: 'mcp__progress-bar__action_add', title: 'Deploy', command: 'echo "a\'b" && make swap', why: 'ship it', check: 'test -e /x' } as never) as unknown as { result?: string }
  expect(String(r.result ?? JSON.stringify(r))).toContain('Action added: Deploy')
  const l = parseActions(files[AF]!)
  expect(l.map(a => [a.title, a.project, a.status])).toEqual([['Deploy', 'desktop-nombot', 'open']])
  await new Promise(res => setTimeout(res, 50))
  expect(opened).toContain(ACTION_PANE)
  const osa = ran.filter(x => x.argv[0] === 'osascript')
  expect(osa.length).toBe(1)
  expect(osa[0]!.argv).toEqual(notifyArgv(l[0]!))
  expect(toasts.some(t => t.includes('Action needed: Deploy'))).toBe(true)
  const { text } = await $.command.run({ command: 'progress-bar', args: 'action copy', ...CMD })
  expect(text).toContain('Copied')
  const pb = ran.find(x => x.argv[0] === 'pbcopy')!
  expect(pb.argv).toEqual(['pbcopy'])
  expect(pb.stdin).toBe('echo "a\'b" && make swap')
  const list = (await $.command.run({ command: 'progress-bar', args: 'action list', ...CMD })).text
  expect(list).toContain('⛔ 1 action needed')
  expect(list).toContain('Run: echo')
})

test('no notification while the terminal is in front, or off macOS, the pane and the gate still work', async ($, on) => {
  const files: Record<string, string> = {}
  const ran = world(on, files, new Set(), true, 'Ghostty')
  await start($)
  await $.command.run({ command: 'progress-bar', args: 'action add Front --command ls --why x', ...CMD })
  await new Promise(res => setTimeout(res, 50))
  expect(opened).toContain(ACTION_PANE)
  expect(ran.some(x => x.argv[0] === 'osascript')).toBe(false)
})

test('no popup off macOS, the gate still holds', async ($, on) => {
  const files: Record<string, string> = {}
  const ran = world(on, files, new Set(), false)
  await start($)
  await $.command.run({ command: 'progress-bar', args: 'action add Sign in to gh --command gh auth login --why push needs it --global', ...CMD })
  await new Promise(res => setTimeout(res, 50))
  expect(ran.some(x => x.argv[0] === 'osascript')).toBe(false)
  expect(parseActions(files[AF]!)[0]!.project).toBeUndefined()
  expect((await submit($, 'hello')).drop).toContain('Sign in to gh')
})

test('panel: red banner first on the List tab with Copy, I ran it and Skip', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [`${P}/.state/panel-on`]: 'on\n', [AF]: JSON.stringify([A({ id: 'a1', title: 'Swap in the NomBot build', command: 'cd ~/x && mv .next-build .next && launchctl kickstart -k gui/501/org.iog.nombot', check: 'grep -qx B id' })]) }
  const ran = world(on, files, new Set())
  await start($)
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  const t = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(t).toContain('⛔ Action needed')
  expect(t).toContain('Swap in the NomBot build')
  expect(t.some(x => x.startsWith('$ cd ~/x'))).toBe(true)
  await ui.press({ key: 'act-ran-a1' })
  expect(parseActions(files[AF]!)[0]!.status).toBe('open')
  await ui.press({ key: 'act-copy-a1' })
  expect(ran.find(x => x.argv[0] === 'pbcopy')?.stdin).toContain('launchctl kickstart')
  await ui.press({ key: 'act-skip-a1' })
  expect(parseActions(files[AF]!)[0]!.status).toBe('skipped')
  const t2 = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(t2).not.toContain('⛔ Action needed')
})

test('Run: slash commands and command-less actions have no Run, shell commands do', () => {
  expect(isSlashCommand('/plugin update progress-bar')).toBe(true)
  expect(isSlashCommand('  /reload-plugins')).toBe(true)
  expect(isSlashCommand('/usr/bin/true')).toBe(false)
  expect(isSlashCommand('gh auth refresh -s delete_repo')).toBe(false)
  expect(canRun(A({ id: 'a', title: 't', command: '/plugin update progress-bar' }))).toBe(false)
  expect(canRun(A({ id: 'a', title: 't' }))).toBe(false)
  expect(canRun(A({ id: 'a', title: 't', command: 'echo hello' }))).toBe(true)
  expect(runScriptPath('/h', '../../x y')).toBe('/h/.claude-progress/.state/run/______x_y.sh')
  const t = runScriptText('echo "a\'b" && ls')
  expect(t.split('\n')).toContain('echo "a\'b" && ls')
  expect(t).toContain('echo "Done. You can close this window."')
  expect(t.trimEnd().endsWith('exec "${SHELL:-/bin/zsh}" -l')).toBe(true)
  for (const sc of [GHOSTTY_SCRIPT, TERMINAL_SCRIPT]) expect(sc.join('\n')).toContain('quoted form of p')
})

test('panel: slash command action shows Copy but no Run', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [`${P}/.state/panel-on`]: 'on\n', [AF]: JSON.stringify([A({ id: 's1', title: 'Update the plugin', command: '/plugin update progress-bar' })]) }
  world(on, files, new Set())
  await start($)
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  const keys = (await ui.findAll({ type: 'Button' })).map(b => String((b as { key?: unknown }).key ?? ''))
  expect(keys).toContain('act-copy-s1')
  expect(keys).not.toContain('act-run-s1')
})

test('the Action needed pane: title, why, command and Run, Copy, I ran it, Later, Skip, a failing check in red', async ($, on) => {
  const files: Record<string, string> = { [AF]: JSON.stringify([A({ id: 'p1', title: 'Swap the build', why: 'ships the fix', command: 'make swap', check: 'test -e /done' })]) }
  world(on, files, new Set())
  await start($)
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: ACTION_PANE, props: { ...PANE_PROPS, title: 'Action needed' } })
  const t = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(t).toContain('⛔ Action needed')
  expect(t).toContain('Swap the build')
  expect(t).toContain('Why: ships the fix')
  expect(t).toContain('$ make swap')
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => b.text ?? '')
  expect(buttons).toEqual(['▶ Run', 'Copy', '✓ I ran it', 'Later', 'Skip'])
  await ui.press({ key: 'act-ran-p1' })
  const t2 = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(t2.some(x => x.startsWith('Check still fails: test -e /done'))).toBe(true)
  expect(parseActions(files[AF]!)[0]!.status).toBe('open')
  await ui.unmount()
})

test('panel Run: Cancel on the confirm line runs nothing', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [`${P}/.state/panel-on`]: 'on\n', [AF]: JSON.stringify([A({ id: 'r1', title: 'Say hello', command: 'echo hello' })]) }
  const ran = world(on, files, new Set())
  await start($)
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  const before = ran.length
  await ui.press({ key: 'act-run-r1' })
  const t = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(t).toContain('Run this in Terminal?')
  expect(t.filter(x => x === '$ echo hello').length).toBe(1)
  expect(await ui.find({ key: 'act-copy-r1' })).toBe(undefined)
  await ui.press({ key: 'act-no-r1' })
  expect((await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')).not.toContain('Run this in Terminal?')
  const after = ran.slice(before)
  expect(after.some(x => x.argv[0] === 'osascript' || x.argv[0] === 'open')).toBe(false)
  expect(Object.keys(files).some(k => k.includes('/.state/run/'))).toBe(false)
  expect(ran.some(x => x.argv[0] === '/bin/sh' && x.argv[2]?.includes('chmod 700'))).toBe(false)
  expect(parseActions(files[AF]!)[0]!.status).toBe('open')
})

test('panel Run: confirm writes a 0700 script with the exact command, AppleScript gets only its path', async ($, on) => {
  const cmd = 'echo "it\'s" && gh auth status; echo $HOME'
  const files: Record<string, string> = { '/Applications/Ghostty.app': '', [SCRIPT]: statusScript(), [`${P}/.state/panel-on`]: 'on\n', [AF]: JSON.stringify([A({ id: 'r1', title: 'Say hello', command: cmd, check: 'test -e /done' })]) }
  const ran = world(on, files, new Set())
  await start($)
  const ui = await $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  await ui.press({ key: 'act-run-r1' })
  expect(ran.some(x => x.argv[0] === '/bin/sh' && x.argv[2]?.includes('chmod 700'))).toBe(false)
  expect((await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')).toContain('Run this in Ghostty?')
  await ui.press({ key: 'act-yes-r1' })
  const path = `${P}/.state/run/r1.sh`
  const w = ran.find(x => x.argv[0] === '/bin/sh' && x.argv[2]?.includes('chmod 700'))!
  expect(w.argv.slice(2)).toEqual(['umask 077; mkdir -p "$(dirname "$1")" && cat > "$1" && chmod 700 "$1"', 'sh', path])
  expect(w.stdin).toBe(runScriptText(cmd))
  expect(files[path]!.split('\n')).toContain(cmd)
  const term = ran.filter(x => x.argv[0] === 'osascript' && x.argv.some(y => y.includes('tell application "Ghostty"')))
  expect(term.length).toBe(1)
  expect(term[0]!.argv).toEqual(['osascript', ...GHOSTTY_SCRIPT.flatMap(l => ['-e', l]), path])
  expect(term[0]!.argv.some(y => y.includes('gh auth status'))).toBe(false)
  expect(ran.some(x => x.argv.some(y => y.includes('tell application "Terminal"')))).toBe(false)
  const ev = files[`${P}/events.jsonl`] ?? ''
  expect(ev).toContain('Action run in Terminal: Say hello')
  expect(parseActions(files[AF]!)[0]!.status).toBe('open')
})
