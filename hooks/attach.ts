import type { EngineInterface } from 'claude-code'

import { isDarwin } from './mac'

// `/attach` and its shortcut: the macOS file picker opens, and each chosen file lands in the prompt as an @ mention
// at the cursor. Claude Code reads an @ path as a file to attach, an image as an image.

export const ATTACH_COMMAND = 'attach'
export const ATTACH_DESCRIPTION = 'Pick files in the macOS file picker and add them to the prompt as @ mentions'
/** The chord README suggests binding to `command:attach` in ~/.claude/keybindings.json (free in the default set). */
export const ATTACH_CHORD = 'ctrl+x ctrl+f'
/** The person may browse for a while: the picker gets the longest run $.process.run allows. */
export const PICKER_TIMEOUT_MS = 10 * 60_000
export const NOT_MAC_PICKER = 'File picker needs macOS'

/** `activate` brings osascript's own dialog to the front. One POSIX path per line; Cancel exits with -128. */
export const PICK_SCRIPT = [
  'activate',
  'set picked to choose file with prompt "Attach to Claude" with multiple selections allowed',
  'set out to ""',
  'repeat with f in picked',
  'set out to out & POSIX path of f & linefeed',
  'end repeat',
  'return out',
]

export const pickArgv = (): string[] => ['osascript', ...PICK_SCRIPT.flatMap(l => ['-e', l])]

/** The picker's stdout as absolute paths, blank lines dropped. */
export function parsePicked(stdout: string): string[] {
  return stdout.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '' && l.startsWith('/'))
}

/** Claude Code reads `@"path with spaces"` whole; a plain path needs no quotes. */
export function mentionOf(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

/** The text to insert at the cursor: mentions joined by spaces, a space before when the cursor follows a word, one after. */
export function insertText(paths: readonly string[], before = ''): string {
  if (!paths.length) return ''
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : ''
  return `${lead}${paths.map(mentionOf).join(' ')} `
}

/** Exit -128 (or its message) is the person pressing Cancel. */
export const isCancel = (exitCode: number | null, stderr: string): boolean =>
  exitCode !== 0 && (/-128\b/.test(stderr) || /User cancel+ed/i.test(stderr))

let picking: Promise<string> | undefined

/**
 * Opens the picker and inserts the chosen files. Resolves what happened, in a few words: `cancelled`, `inserted N`,
 * or an error shown as a toast. A second press while the picker is open does nothing.
 */
export function attachFiles($: EngineInterface): Promise<string> {
  if (picking) return picking
  picking = pick($).finally(() => { picking = undefined })
  return picking
}

async function pick($: EngineInterface): Promise<string> {
  if (!(await isDarwin($))) { $.ui.toast(NOT_MAC_PICKER); return NOT_MAC_PICKER }
  let r: { exitCode: number | null; stdout: string; stderr: string }
  try { r = await $.process.run(pickArgv(), { timeoutMs: PICKER_TIMEOUT_MS }) } catch (err) {
    const msg = `File picker failed: ${String((err as Error)?.message ?? err)}`
    $.ui.toast(msg)
    return msg
  }
  if (isCancel(r.exitCode, r.stderr)) return 'cancelled'
  if (r.exitCode !== 0) {
    const msg = `File picker failed (exit ${r.exitCode}). ${r.stderr.trim()}`.trim()
    $.ui.toast(msg)
    return msg
  }
  const paths = parsePicked(r.stdout)
  if (!paths.length) return 'cancelled'
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const text = insertText(paths, box.text.slice(0, box.cursor))
  const filled = await $.prompt.fill({ text, mode: 'insert' }).catch(() => ({ isFilled: false }))
  if (!filled.isFilled) {
    const msg = `Could not add to the prompt. Paste this: ${text.trim()}`
    $.ui.toast(msg)
    return msg
  }
  return `inserted ${paths.length}`
}
