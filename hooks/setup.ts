import type { EngineInterface } from 'claude-code'

import { SCRIPT_REL, chainable } from './chain'
import { CHECKPOINT_PY } from './checkpoint'
import { EVENTS_PY } from './events'
import { GROUP_PY } from './group'
import { prevOf, statusScript } from './render'

// Writing the status line script and its helpers, shared by register.tsx (setup, first run) and panel.tsx
// (the "Turn on status line" button).

const GROUP_REL = '.claude/progress-bar/group.py'
const EVENTS_PY_REL = '.claude/progress-bar/events.py'
const CHECKPOINT_PY_REL = '.claude/progress-bar/checkpoint.py'
export const SNIPPET = `"statusLine": { "type": "command", "command": "~/${SCRIPT_REL}", "refreshInterval": 1 }`

/** Writes group.py, events.py (the Log tab's events log) and checkpoint.py (the overnight recap) beside the status line script. */
export async function writeLib($: EngineInterface, h: string) {
  await $.fs.write(`${h}/${GROUP_REL}`, GROUP_PY)
  await $.fs.write(`${h}/${EVENTS_PY_REL}`, EVENTS_PY)
  await $.fs.write(`${h}/${CHECKPOINT_PY_REL}`, CHECKPOINT_PY)
}

/** The command an installed script chains, so running setup again keeps it. A progress status line chained by an
 * older version (0.22.0 chained them) is dropped here, so the update fixes the doubled rows by itself. */
export async function installedPrev($: EngineInterface, h: string, path: string): Promise<string | undefined> {
  let prev: string | undefined
  try { prev = prevOf(String(await $.fs.read(path))) } catch { return undefined }
  return chainable($, h, prev)
}

const STATUS_LINE = { type: 'command', command: `~/${SCRIPT_REL}`, refreshInterval: 1 }

/**
 * "Turn on status line" in the Status panel, for when the settings.read hook did not take effect (another plugin's
 * hook answered first). Installs the script, then points the settings file that holds the winning status line at it
 * (local, then project, else ~/.claude/settings.json). The old command stays chained unless it is a progress status line.
 */
export async function turnOnStatusLine($: EngineInterface, h: string): Promise<string> {
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  let cwd = ''
  try { cwd = await $.session.cwd() } catch { cwd = '' }
  const files = { local: `${cwd}/.claude/settings.local.json`, project: `${cwd}/.claude/settings.json`, user: `${h}/.claude/settings.json` }
  let target: string = files.user
  let current: string | undefined
  for (const source of ['local', 'project', 'user'] as const) {
    if (source !== 'user' && !cwd) continue
    try {
      const v = (await $.settings.read({ source })).statusLine as { type?: string; command?: string } | undefined
      if (v && typeof v.command === 'string') { target = files[source]; current = v.command; break }
    } catch { /* next source */ }
  }
  const path = `${h}/${SCRIPT_REL}`
  const prev = await chainable($, h, current) ?? await installedPrev($, h, path)
  await $.fs.write(path, statusScript(prev))
  await writeLib($, h)
  await $.process.run(['chmod', '+x', path]).catch(() => undefined)
  let obj: Record<string, unknown> = {}
  try {
    const text = String(await $.fs.read(target))
    if (text.trim()) obj = JSON.parse(text) as Record<string, unknown>
  } catch (err) {
    if (await $.fs.exists(target).catch(() => false)) return `Could not read ${target} as JSON, so it was left alone. Add this to it:\n  ${SNIPPET}`
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return `${target} is not a settings object. Add this to it:\n  ${SNIPPET}`
  await $.fs.write(target, `${JSON.stringify({ ...obj, statusLine: STATUS_LINE }, null, 2)}\n`)
  return `Status line on: ${target} now runs ~/${SCRIPT_REL}.${prev ? ` It still runs ${prev} after the bars.` : ''}`
}
