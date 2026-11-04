import type { EngineInterface } from 'claude-code'

// Which status line the plugin's script may chain (its prev= line). A status line that is itself a progress status
// line (an older local copy that prints ~/.claude-progress/.lines or runs a group.py, or this plugin's own script)
// is never chained: it prints every row a second time and feeds grouped lines back into group.py.

export const SCRIPT_REL = '.claude/progress-bar/statusline.sh'
/** What a progress status line script says. */
export const PROGRESS_MARK = /\.claude-progress\/\.lines|group\.py/
/** Read at most this much of a chained script. */
export const READ_CAP = 64 * 1024
/** A bigger file is not a status line script. */
const SIZE_CAP = 1024 * 1024

/** The paths a command names: each word with a slash, quotes dropped, "~" and $HOME expanded. */
export function scriptPaths(cmd: string, home: string): string[] {
  const words = cmd.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  const out: string[] = []
  for (const w of words) {
    const p = w.replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, home).replace(/^\$\{?HOME\}?(?=\/|$)/, home)
    if (p.includes('/') && !out.includes(p)) out.push(p)
  }
  return out
}

/** True when the command, or a script it names (as `readHead` reads it), is a progress status line. */
export async function isProgressLine(cmd: string, home: string, readHead: (path: string) => Promise<string | undefined>): Promise<boolean> {
  if (cmd.includes(SCRIPT_REL) || PROGRESS_MARK.test(cmd)) return true
  for (const p of scriptPaths(cmd, home)) {
    const text = await readHead(p)
    if (text && PROGRESS_MARK.test(text.slice(0, READ_CAP))) return true
  }
  return false
}

/** The first READ_CAP characters of a file, or undefined when it is missing or too big. */
async function readHead($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    const st = await $.fs.stat(path)
    if (st.size > SIZE_CAP) return undefined
    return String(await $.fs.read(path)).slice(0, READ_CAP)
  } catch { return undefined }
}

/** The command, if the plugin's script may chain it: never one that is itself a progress status line. */
export async function chainable($: EngineInterface, home: string, cmd: string | undefined): Promise<string | undefined> {
  if (!cmd || !cmd.trim()) return undefined
  return (await isProgressLine(cmd, home, p => readHead($, p))) ? undefined : cmd
}
