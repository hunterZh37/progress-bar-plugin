import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ATTACH_COMMAND, NOT_MAC_PICKER, PICKER_TIMEOUT_MS, PICKER_TIMEOUT_S, PICK_SCRIPT, insertText, isCancel, mentionOf, parsePicked, pickArgv } from '../hooks/attach'

// 0.29.0: /attach (or a chord bound to command:attach) opens the macOS file picker and puts each chosen file in the
// prompt at the cursor as an @ mention. 0.29.1: the frontmost app shows the picker, so it opens in about 0.1 s, not 2 s.

const HOME = '/home/u'
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

type Pick = { exitCode: number; stdout?: string; stderr?: string }

/** A fake machine: `pick` is what osascript answers, `box` the draft and cursor. Every argv, fill and toast is kept. */
function world(on: On, o: { pick: Pick; darwin?: boolean; box?: { text: string; cursor: number }; filled?: boolean }) {
  const ran: { argv: string[]; timeoutMs?: number }[] = []
  const fills: { text: string; mode?: string }[] = []
  const toasts: string[] = []
  mock.env(on, { HOME })
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1800000000000 }))
  on('clock.every', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('clock.after', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('clock.sleep', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('session.cwd', () => ({ value: `${HOME}/code` }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] as never }))
  on('settings.read', () => ({ value: {} as never }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__progress-bar__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] as never }))
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    ran.push({ argv, timeoutMs: e.init?.timeoutMs })
    const r = argv[0] === 'uname' ? { exitCode: 0, stdout: o.darwin === false ? 'Linux\n' : 'Darwin\n' }
      : argv[0] === 'osascript' ? o.pick
      : { exitCode: 0 }
    return { value: { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: (r as Pick).stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.read', () => ({ value: o.box ?? { text: '', cursor: 0 } }) as never)
  on('prompt.fill', (_, e) => { fills.push({ text: e.text, mode: e.mode }); return { isFilled: o.filled !== false } as never })
  on('ui.toast', (_, e) => { toasts.push(String((e as { text?: unknown }).text ?? '')); return { value: undefined } as never })
  return { ran, fills, toasts }
}

const start = ($: Engine) => $.session.start({ cwd: `${HOME}/code`, surface: 'terminal', isInteractive: true })
declare const setTimeout: (fn: (...a: unknown[]) => void, ms: number) => unknown
/** The command answers at once and the picker runs behind it: give that run time to settle. */
async function runAttach($: Engine) {
  const r = await $.command.run({ command: ATTACH_COMMAND, args: '', ...CMD })
  await new Promise(res => setTimeout(res, 150))
  return r
}

test('mentionOf: plain paths bare, paths with spaces quoted the way Claude Code reads @"..."', () => {
  expect(mentionOf('/Users/a/notes.md')).toBe('@/Users/a/notes.md')
  expect(mentionOf('/Users/a/My Files/shot 1.png')).toBe('@"/Users/a/My Files/shot 1.png"')
})

test('insertText: joined by spaces, a space before when the cursor follows a word, one after', () => {
  expect(insertText(['/a/x.png', '/b c/y.pdf'])).toBe('@/a/x.png @"/b c/y.pdf" ')
  expect(insertText(['/a/x'], 'look at')).toBe(' @/a/x ')
  expect(insertText(['/a/x'], 'look at ')).toBe('@/a/x ')
  expect(insertText([], 'hi')).toBe('')
})

test('parsePicked and isCancel', () => {
  expect(parsePicked('/a/x.png\n/b c/y.pdf\n\n')).toEqual(['/a/x.png', '/b c/y.pdf'])
  expect(parsePicked('\n')).toEqual([])
  expect(isCancel(1, '0:85: execution error: User canceled. (-128)')).toBe(true)
  expect(isCancel(1, 'syntax error')).toBe(false)
  expect(isCancel(0, '')).toBe(false)
})

test('pickArgv: the frontmost app shows the picker (no slow bare activate first), multiple selections, POSIX paths', () => {
  const a = pickArgv()
  expect(a[0]).toBe('osascript')
  expect(a.length).toBe(1 + PICK_SCRIPT.length * 2)
  expect(a.filter((_, i) => i % 2 === 1).every(x => x === '-e')).toBe(true)
  const lines = a.filter((_, i) => i > 0 && a[i - 1] === '-e')
  expect(lines).toEqual(PICK_SCRIPT)
  const script = lines.join('\n')
  // The first line is no longer a bare `activate`: that one costs about 2 s before the picker shows.
  expect(lines[0]).not.toBe('activate')
  expect(script).toContain('set frontApp to id of application (path to frontmost application as text)')
  const tellAt = lines.indexOf('tell application id frontApp')
  expect(tellAt).toBeGreaterThan(0)
  expect(lines[tellAt + 1]).toBe('activate')
  expect(lines[tellAt + 2]).toBe('set picked to choose file with prompt "Attach to Claude" with multiple selections allowed')
  expect(lines[tellAt + 3]).toBe('end tell')
  expect(script).toContain(`with timeout of ${PICKER_TIMEOUT_S} seconds`)
  expect(PICKER_TIMEOUT_S * 1000).toBeLessThan(PICKER_TIMEOUT_MS)
  expect(script).toContain('POSIX path of f')
  expect(lines.at(-1)).toBe('return out')
})

test('pickArgv: Cancel still exits -128, and focus goes back to the terminal on pick, cancel and error', () => {
  const lines = PICK_SCRIPT
  const restore = 'if frontApp is not "" then tell application id frontApp to activate'
  // three restores: cancel or timeout rethrow, the fallback's error, and after a pick
  expect(lines.filter(l => l === restore).length).toBe(3)
  lines.forEach((l, i) => { if (l === restore) { expect(lines[i - 1]).toBe('try'); expect(lines[i + 1]).toBe('end try') } })
  const cancelAt = lines.indexOf('if errNum is -128 or errNum is -1712 then')
  expect(cancelAt).toBeGreaterThan(0)
  expect(lines.slice(cancelAt, cancelAt + 6)).toContain(restore)
  expect(lines.slice(cancelAt, cancelAt + 6)).toContain('error errMsg number errNum')
  // after the pick: restore comes before the output is built
  expect(lines.lastIndexOf(restore)).toBeLessThan(lines.indexOf('set out to ""'))
  // the fallback is the old path: a bare activate, then the same picker
  const fb = lines.lastIndexOf('activate')
  expect(fb).toBeGreaterThan(cancelAt)
  expect(lines[fb + 1]).toContain('choose file with prompt "Attach to Claude"')
})

test('/attach inserts the picked files at the cursor, quietly', async ($, on) => {
  const w = world(on, { pick: { exitCode: 0, stdout: '/Users/a/report.pdf\n/Users/a/My Shots/screen 1.png\n' }, box: { text: 'compare  please', cursor: 8 } })
  await start($)
  const r = await runAttach($)
  expect(r.text ?? '').toBe('')
  const osa = w.ran.find(x => x.argv[0] === 'osascript')!
  expect(osa.argv).toEqual(pickArgv())
  expect(osa.timeoutMs).toBe(PICKER_TIMEOUT_MS)
  expect(w.fills).toEqual([{ text: '@/Users/a/report.pdf @"/Users/a/My Shots/screen 1.png" ', mode: 'insert' }])
  expect(w.toasts).toEqual([])
})

test('/attach: a space goes before the mention when the cursor follows a word', async ($, on) => {
  const w = world(on, { pick: { exitCode: 0, stdout: '/a/x.png\n' }, box: { text: 'see', cursor: 3 } })
  await start($)
  await runAttach($)
  expect(w.fills.map(f => f.text)).toEqual([' @/a/x.png '])
})

test('/attach: Cancel changes nothing and shows no toast', async ($, on) => {
  const w = world(on, { pick: { exitCode: 1, stderr: '0:85: execution error: User canceled. (-128)\n' } })
  await start($)
  await runAttach($)
  expect(w.fills).toEqual([])
  expect(w.toasts).toEqual([])
})

test('/attach off macOS: a toast, no picker', async ($, on) => {
  const w = world(on, { pick: { exitCode: 0, stdout: '/a/x\n' }, darwin: false })
  await start($)
  await runAttach($)
  expect(w.ran.some(x => x.argv[0] === 'osascript')).toBe(false)
  expect(w.fills).toEqual([])
  expect(w.toasts).toEqual([NOT_MAC_PICKER])
})

test('/attach: a picker error is a toast', async ($, on) => {
  const w = world(on, { pick: { exitCode: 1, stderr: 'boom' } })
  await start($)
  await runAttach($)
  expect(w.fills).toEqual([])
  expect(w.toasts[0]).toContain('File picker failed (exit 1). boom')
})

test('/attach: when the prompt box refuses the text, the toast holds it', async ($, on) => {
  const w = world(on, { pick: { exitCode: 0, stdout: '/a/x.png\n' }, filled: false })
  await start($)
  await runAttach($)
  expect(w.toasts).toEqual(['Could not add to the prompt. Paste this: @/a/x.png'])
})
