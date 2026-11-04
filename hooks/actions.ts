// Action needed: high-priority steps only the person can run (a deploy swap, a login, a command the permission
// system blocks, deleting a repo). ~/.claude-progress/actions.json is a JSON list:
//   [{ "id": "...", "title": "...", "command": "...", "why": "...", "check": "...", "priority": "high",
//      "created": <epoch s>, "project": "<slug or to-do file>", "status": "open|done|skipped", "skipReason": "..." }]
// Claude adds one with the action_add tool or `/progress-bar action add`. Any script may write the file too.
// While one is open for this session's project (or has no project, so it is global):
//   - macOS shows a dialog when it is added and at most every 10 min after (Run or Copy command, I ran it, Later),
//   - a typed prompt is held with a message naming the action. "done" runs the check, "skip <reason>" skips it,
//     slash commands always pass,
//   - checks run every 30 s, so a command run in a terminal clears its action by itself.
// SAFETY: the plugin never runs an action's `command` on its own. Only the person does, by hand or with the Run
// button, which asks first in a dialog showing the full command and then opens a new visible terminal window that
// runs it. Claude has no tool for Run. The plugin runs `check` itself, which must be a read-only test that exits 0
// once the step is done. The dialog text goes to osascript as argv, never into the AppleScript source, a copied
// command goes to pbcopy on stdin, and a run command goes to a 0700 script file on stdin, whose path alone reaches
// AppleScript as argv. Actions hold commands, never secret values.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isDarwin } from './mac'
import { sessionProject } from './project'
import type { Action } from '../types'

export const ACTIONS_REL = '.claude-progress/actions.json'
export const POPUP_REL = '.claude-progress/.state/actions-popup.json'
export const EVENTS_FILE_REL = '.claude-progress/events.jsonl'
export const CHECK_EVERY = 30_000
export const POPUP_EVERY = 10 * 60_000
export const CHECK_TIMEOUT = 5000
const POPUP_WAIT_S = 120

export const actionsAtom = atom({ plugin: 'progress-bar', key: 'actions' } as const, [] as Action[])

const clean = (v: unknown, n: number) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n)
export const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t)

/** actions.json text -> the actions. Accepts a list or { "actions": [...] }. Bad rows are skipped. */
export function parseActions(text: string): Action[] {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return [] }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { actions?: unknown }).actions) ? (raw as { actions: unknown[] }).actions : []
  const seen = new Set<string>()
  return list.flatMap((x: unknown): Action[] => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    const id = clean(o.id, 80)
    const title = clean(o.title, 200)
    if (!id || !title || seen.has(id)) return []
    seen.add(id)
    const status = o.status === 'done' || o.status === 'skipped' ? o.status : 'open'
    const a: Action = { id, title, why: clean(o.why, 400), priority: 'high', created: typeof o.created === 'number' ? o.created : 0, status }
    const command = clean(o.command, 4000)
    const check = clean(o.check, 2000)
    const project = clean(o.project, 200)
    if (command) a.command = command
    if (check) a.check = check
    if (project) a.project = project
    if (typeof o.skipReason === 'string' && o.skipReason) a.skipReason = clean(o.skipReason, 300)
    if (typeof o.closed === 'number') a.closed = o.closed
    return [a]
  })
}

/** An action applies to a session when it has no project, or names the session's project slug or to-do file. */
export const appliesTo = (a: Action, proj: { slug: string; file: string }) =>
  !a.project || a.project === proj.slug || a.project === proj.file || `todos/${a.project}.txt` === proj.file

export const openFor = (list: Action[], proj: { slug: string; file: string }) => list.filter(a => a.status === 'open' && appliesTo(a, proj))

export type NewAction = { title: string; command?: string; why?: string; check?: string; project?: string }

/** Adds an action, or returns the open one with the same title and command. */
export function addAction(list: Action[], n: NewAction, nowS: number, id: string): { list: Action[]; action: Action; isNew: boolean } {
  const title = clean(n.title, 200)
  const command = clean(n.command, 4000)
  const same = list.find(a => a.status === 'open' && a.title === title && (a.command ?? '') === command)
  if (same) return { list, action: same, isNew: false }
  const a: Action = { id, title, why: clean(n.why, 400), priority: 'high', created: nowS, status: 'open' }
  if (command) a.command = command
  const check = clean(n.check, 2000)
  if (check) a.check = check
  const project = clean(n.project, 200)
  if (project) a.project = project
  return { list: [...list, a], action: a, isNew: true }
}

/** What a typed prompt means to the gate: done, skip with a reason, skip without one, or nothing. */
export type GateWord = { kind: 'done' } | { kind: 'skip'; reason: string } | { kind: 'skip-empty' } | null
export function parseGate(text: string): GateWord {
  const t = text.trim()
  if (/^(done|i ran it|ran it)[.!]*$/i.test(t)) return { kind: 'done' }
  const m = /^skip\b[\s:,-]*([\s\S]*)$/i.exec(t)
  if (!m) return null
  const reason = clean(m[1], 300)
  return reason ? { kind: 'skip', reason } : { kind: 'skip-empty' }
}

/** Only the person's own prompts are held. Slash commands, hidden prompts, task notifications and peers pass. */
export function isGated(e: { text: string; command?: unknown; isMeta?: unknown; origin?: { kind?: string } }): boolean {
  if (e.command || e.isMeta) return false
  if (e.text.trimStart().startsWith('/')) return false
  const k = e.origin?.kind
  return k === 'composer' || k === 'bridge'
}

/** The message a held prompt shows. */
export function blockText(open: Action[], width = 100): string {
  const a = open[0]!
  const out = [`⛔ Action needed: ${a.title}`]
  if (a.why) out.push(`Why: ${a.why}`)
  if (a.command) out.push(`Run: ${cut(a.command, Math.max(40, width * 3))}`)
  out.push(a.check
    ? 'Then type done (the check must pass), or skip <reason>, or /progress-bar action list.'
    : 'Then type done, or skip <reason>, or /progress-bar action list.')
  if (open.length > 1) out.push(`${open.length - 1} more open after this one.`)
  out.push('Your message was held. It comes back in the prompt box once the actions are done.')
  return out.join('\n')
}

// The dialog's AppleScript is fixed text. The body and the button set reach it only as argv, so nothing in an
// action's title, why or command is ever parsed as AppleScript.
// A dialog holds at most 3 buttons, so a runnable action shows Run, I ran it, Later (Copy stays in the panel and
// in /progress-bar action copy). A slash command can only be typed in Claude Code, so it keeps Copy command.
export const POPUP_SCRIPT = [
  'on run argv',
  '  set body to item 1 of argv',
  '  if (item 2 of argv) is "2" then',
  '    set bs to {"Run", "I ran it", "Later"}',
  '  else if (item 2 of argv) is "1" then',
  '    set bs to {"Copy command", "I ran it", "Later"}',
  '  else',
  '    set bs to {"I ran it", "Later"}',
  '  end if',
  '  activate',
  `  set r to display dialog body with title "Action needed" buttons bs default button "Later" giving up after ${POPUP_WAIT_S} with icon caution`,
  '  if gave up of r then return "Later"',
  '  return button returned of r',
  'end run',
]
export const FAIL_SCRIPT = [
  'on run argv',
  '  activate',
  '  display dialog (item 1 of argv) with title "Check still fails" buttons {"OK"} default button "OK" giving up after 60 with icon stop',
  'end run',
]

/** osascript's argv for the action dialog: each script line as -e, then the body and whether a command exists. */
export function popupArgv(a: Action): string[] {
  const body = [a.title, a.why ? `\nWhy: ${cut(a.why, 300)}` : '', a.command ? `\nRun: ${cut(a.command, 400)}` : '', a.check ? '\n\n"I ran it" runs the check first.' : ''].join('')
  return ['osascript', ...POPUP_SCRIPT.flatMap(l => ['-e', l]), body, canRun(a) ? '2' : a.command ? '1' : '0']
}
export function failArgv(a: Action): string[] {
  return ['osascript', ...FAIL_SCRIPT.flatMap(l => ['-e', l]), `${a.title}\n\nThe check still fails:\n${cut(a.check ?? '', 400)}\n\nRun the command, then try again.`]
}

/** The button osascript printed. */
export function parseButton(stdout: string): 'run' | 'copy' | 'ran' | 'later' {
  const t = stdout.trim()
  return t === 'Run' ? 'run' : t === 'Copy command' ? 'copy' : t === 'I ran it' ? 'ran' : 'later'
}

// ---- Run: the person's click, a confirm dialog, then a new visible terminal window ----

export const RUN_DIR_REL = '.claude-progress/.state/run'
export const RUN_RECHECK = 10_000
const CONFIRM_WAIT_S = 120

/** A Claude Code slash command (`/plugin update x`), typed in Claude Code, so it cannot run in a terminal. */
export const isSlashCommand = (cmd: string) => /^\/[A-Za-z][\w:.-]*(\s|$)/.test(cmd.trim())
/** Run shows only for an action with a shell command. */
export const canRun = (a: Action) => !!a.command && !isSlashCommand(a.command)

/** The script file's path for an action. The id is cut to safe characters so it never leaves the run folder. */
export const runScriptPath = (h: string, id: string) => `${h}/${RUN_DIR_REL}/${id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'action'}.sh`

/** The script a terminal window runs: the exact command, then a note, then a login shell so the window stays open. */
export function runScriptText(command: string): string {
  return [
    '#!/bin/zsh',
    'cd "$HOME" || exit 1',
    'export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"',
    command,
    '',
    'echo',
    'echo "Done. You can close this window."',
    'exec "${SHELL:-/bin/zsh}" -l',
    '',
  ].join('\n')
}

// The confirm dialog shows the full command. Cancel is the default, and a dialog left alone gives up as Cancel.
export const CONFIRM_SCRIPT = [
  'on run argv',
  '  activate',
  `  set r to display dialog (item 1 of argv) with title "Run this command?" buttons {"Cancel", "Run in Terminal"} default button "Cancel" giving up after ${CONFIRM_WAIT_S} with icon caution`,
  '  if gave up of r then return "Cancel"',
  '  return button returned of r',
  'end run',
]
export function confirmArgv(a: Action): string[] {
  const body = `${a.title}\n\nThis runs in a new terminal window:\n\n${a.command ?? ''}`
  return ['osascript', ...CONFIRM_SCRIPT.flatMap(l => ['-e', l]), body]
}

// The terminal scripts are fixed text. They get only the script file's path, as argv.
export const GHOSTTY_SCRIPT = [
  'on run argv',
  '  set p to item 1 of argv',
  '  tell application "Ghostty"',
  '    activate',
  '    new window with configuration {command:"/bin/zsh " & quoted form of p}',
  '  end tell',
  'end run',
]
export const TERMINAL_SCRIPT = [
  'on run argv',
  '  set p to item 1 of argv',
  '  tell application "Terminal"',
  '    activate',
  '    do script "/bin/zsh " & quoted form of p',
  '  end tell',
  'end run',
]
export const terminalArgv = (script: string[], path: string) => ['osascript', ...script.flatMap(l => ['-e', l]), path]

/** Ghostty when it is installed (1.3+ takes AppleScript), else Terminal.app. */
async function ghosttyInstalled($: EngineInterface, h: string): Promise<boolean> {
  for (const p of ['/Applications/Ghostty.app', `${h}/Applications/Ghostty.app`]) {
    try { if (await $.fs.exists(p)) return true } catch { /* not there */ }
  }
  return false
}

/**
 * The Run button: asks first with the full command, then writes it to a 0700 script and opens a new terminal window
 * that runs it. Returns what happened. Only a person's click calls this. Claude has no tool or command for it.
 */
export async function runAction($: EngineInterface, h: string, a: Action): Promise<'ran' | 'cancelled' | 'unavailable' | 'failed'> {
  if (!a.command) return 'unavailable'
  if (isSlashCommand(a.command)) { $.ui.toast('That is a Claude Code command. Copy it and type it in Claude Code.'); return 'unavailable' }
  if (darwin === null) darwin = await isDarwin($)
  if (!darwin) { $.ui.toast('Run needs macOS. Copy the command instead.'); return 'unavailable' }
  let out = ''
  try { out = (await $.process.run(confirmArgv(a), { timeoutMs: (CONFIRM_WAIT_S + 15) * 1000 })).stdout } catch { out = '' }
  if (out.trim() !== 'Run in Terminal') return 'cancelled'
  const path = runScriptPath(h, a.id)
  try {
    const w = await $.process.run(['/bin/sh', '-c', 'umask 077; mkdir -p "$(dirname "$1")" && cat > "$1" && chmod 700 "$1"', 'sh', path], { stdin: runScriptText(a.command), timeoutMs: 5000 })
    if (w.exitCode !== 0) throw new Error(w.stderr)
  } catch { $.ui.toast('Could not write the run script.'); return 'failed' }
  const tries: [string, string[]][] = []
  if (await ghosttyInstalled($, h)) tries.push(['Ghostty', terminalArgv(GHOSTTY_SCRIPT, path)])
  tries.push(['Terminal', terminalArgv(TERMINAL_SCRIPT, path)], ['Terminal', ['open', '-a', 'Terminal', path]])
  let opened = ''
  for (const [name, argv] of tries) {
    try { if ((await $.process.run(argv, { timeoutMs: 20_000 })).exitCode === 0) { opened = name; break } } catch { /* next one */ }
  }
  if (!opened) { $.ui.toast('Could not open a terminal. Copy the command instead.'); return 'failed' }
  await logEvent($, h, 'info', `Action run in Terminal: ${a.title}`, `Opened in ${opened}.\nRun: ${a.command}`)
  $.ui.toast(a.check ? `Running in ${opened}. It clears once its check passes.` : `Running in ${opened}. Press I ran it when it is done.`)
  try { $.clock.after(RUN_RECHECK, async () => { await autoClear($, h); await readActions($, h) }) } catch { /* the 30 s check still runs */ }
  return 'ran'
}

// ---- engine side ----

const rid = () => `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export async function loadActions($: EngineInterface, h: string): Promise<Action[]> {
  try { return parseActions(String(await $.fs.read(`${h}/${ACTIONS_REL}`))) } catch { return [] }
}
async function saveActions($: EngineInterface, h: string, list: Action[]) {
  // Keep every open action and the newest 50 closed ones.
  const closed = list.filter(a => a.status !== 'open').slice(-50)
  const keep = list.filter(a => a.status === 'open' || closed.includes(a))
  await $.fs.write(`${h}/${ACTIONS_REL}`, `${JSON.stringify(keep, null, 1)}\n`)
}

/** Appends one event to the Log tab's events.jsonl (an append, so group.py's lines are never lost). */
export async function logEvent($: EngineInterface, h: string, level: 'success' | 'warning' | 'info', title: string, detail = '') {
  const ev: Record<string, unknown> = { ts: Math.floor((await $.clock.now()) / 1000), level, source: 'action', title }
  if (detail) ev.detail = detail.slice(0, 2000)
  try { await $.process.run(['/bin/sh', '-c', 'cat >> "$1"', 'sh', `${h}/${EVENTS_FILE_REL}`], { stdin: `${JSON.stringify(ev)}\n`, timeoutMs: 5000 }) } catch { /* the log is a nicety */ }
}

async function projectOf($: EngineInterface, h: string) {
  const p = await sessionProject($, h)
  return { slug: p.slug, file: p.file }
}

/** Open actions for this session, and the panel's copy of them. */
export async function readActions($: EngineInterface, h: string): Promise<Action[]> {
  if (!h) return []
  const open = openFor(await loadActions($, h), await projectOf($, h))
  const prev = await read($, actionsAtom)
  if (JSON.stringify(prev) !== JSON.stringify(open)) await update($, actionsAtom, () => open)
  return open
}

/** Runs one check, read-only by contract, in the home folder. True when it exits 0 within 5 s. */
export async function runCheck($: EngineInterface, h: string, check: string): Promise<boolean> {
  try {
    const r = await $.process.run(['/bin/sh', '-c', 'PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"; export PATH; eval "$1"', 'sh', check], { cwd: h, timeoutMs: CHECK_TIMEOUT })
    return r.exitCode === 0
  } catch { return false }
}

/** Closes an action (re-read first, so two sessions never log it twice). Returns it, or null when it was not open. */
export async function closeAction($: EngineInterface, h: string, id: string, status: 'done' | 'skipped', reason = '', how = ''): Promise<Action | null> {
  const list = await loadActions($, h)
  const a = list.find(x => x.id === id)
  if (!a || a.status !== 'open') return null
  a.status = status
  a.closed = Math.floor((await $.clock.now()) / 1000)
  if (status === 'skipped') a.skipReason = clean(reason, 300) || 'no reason given'
  await saveActions($, h, list)
  if (status === 'done') {
    await logEvent($, h, 'success', `Action done: ${a.title}`, how)
    $.ui.toast(`Action done: ${a.title}`)
  } else {
    await logEvent($, h, 'warning', `Action skipped: ${a.title}`, `Reason: ${a.skipReason}`)
  }
  await readActions($, h)
  await restoreHeld($, h)
  return a
}

/** Runs the check of every open action of this session that has one, and closes those that pass. */
export async function autoClear($: EngineInterface, h: string): Promise<Action[]> {
  const cleared: Action[] = []
  for (const a of openFor(await loadActions($, h), await projectOf($, h))) {
    if (a.check && (await runCheck($, h, a.check))) {
      const c = await closeAction($, h, a.id, 'done', '', 'Its check passed.')
      if (c) cleared.push(c)
    }
  }
  return cleared
}

/** Adds an action from the tool or the command, defaulting to this session's project, and pops it up. */
export async function addFromClaude($: EngineInterface, h: string, n: NewAction & { global?: boolean }): Promise<string> {
  if (!h) return 'No home folder found.'
  if (!clean(n.title, 200)) return 'An action needs a title.'
  const proj = await projectOf($, h)
  const project = n.global ? '' : (n.project || proj.slug)
  const r = addAction(await loadActions($, h), { ...n, project }, Math.floor((await $.clock.now()) / 1000), rid())
  if (r.isNew) {
    await saveActions($, h, r.list)
    await logEvent($, h, 'info', `Action needed: ${r.action.title}`, [r.action.why, r.action.command ? `Run: ${r.action.command}` : ''].filter(Boolean).join('\n'))
  }
  await readActions($, h)
  void popup($, h, r.action, true)
  return r.isNew
    ? `Action added: ${r.action.title}${project ? ` (project ${project})` : ' (global)'}. The person gets a popup on macOS and their next prompt is held until it is done or skipped.${r.action.check ? ' It clears by itself once its check passes.' : ' It has no check, so the person types done.'}`
    : `That action is already open: ${r.action.title}`
}

let popping = false
let darwin: boolean | null = null

/** The macOS dialog for one action. Shown at most every 10 min per action across sessions. */
export async function popup($: EngineInterface, h: string, a: Action, force = false) {
  if (popping) return
  if (darwin === null) darwin = await isDarwin($)
  if (!darwin) return
  const now = await $.clock.now()
  let shown: Record<string, number> = {}
  try { shown = JSON.parse(String(await $.fs.read(`${h}/${POPUP_REL}`))) as Record<string, number> } catch { shown = {} }
  if (!force && now - (shown[a.id] ?? 0) < POPUP_EVERY) return
  shown[a.id] = now
  try { await $.fs.write(`${h}/${POPUP_REL}`, JSON.stringify(shown)) } catch { /* shown anyway */ }
  popping = true
  try {
    let out = ''
    try { out = (await $.process.run(popupArgv(a), { timeoutMs: (POPUP_WAIT_S + 15) * 1000 })).stdout } catch { out = '' }
    const b = parseButton(out)
    if (b === 'run') await runAction($, h, a)
    else if (b === 'copy') await copyCommand($, a)
    else if (b === 'ran') await ranIt($, h, a, true)
  } finally { popping = false }
}

/** Copies the command with pbcopy, the text on stdin. */
export async function copyCommand($: EngineInterface, a: Action) {
  if (!a.command) return
  if (darwin === null) darwin = await isDarwin($)
  if (!darwin) { $.ui.toast('Copy needs macOS. The command is in /progress-bar action list.'); return }
  try {
    await $.process.run(['pbcopy'], { stdin: a.command, timeoutMs: 5000 })
    $.ui.toast('Command copied. Paste it in a terminal.')
  } catch { $.ui.toast('Could not copy the command.') }
}

/** "I ran it": runs the check (if any) and closes the action only when it passes. */
export async function ranIt($: EngineInterface, h: string, a: Action, dialog = false): Promise<boolean> {
  if (a.check && !(await runCheck($, h, a.check))) {
    if (dialog && darwin) { try { await $.process.run(failArgv(a), { timeoutMs: 75_000 }) } catch { /* closed */ } }
    else $.ui.toast(`Check still fails: ${cut(a.title, 60)}`)
    return false
  }
  await closeAction($, h, a.id, 'done', '', a.check ? 'Its check passed after "I ran it".' : 'Marked done by the person.')
  return true
}

let ticking = false
/** Every 30 s: run checks, then pop up the first open action not shown in the last 10 min. */
export async function tickActions($: EngineInterface, h: string) {
  if (!h || ticking) return
  ticking = true
  try {
    const open = await readActions($, h)
    if (!open.length) return
    await autoClear($, h)
    const left = await readActions($, h)
    if (left[0]) void popup($, h, left[0])
  } finally { ticking = false }
}

// ---- the prompt gate ----

let held = ''
async function restoreHeld($: EngineInterface, h: string) {
  if (!held) return
  if ((await readActions($, h)).length) return
  const text = held
  held = ''
  try { await $.prompt.fill({ text, mode: 'replace' }) } catch { /* the person retypes it */ }
}

/** The gate: null lets the prompt through, a string holds it and is shown to the person. */
export async function gatePrompt($: EngineInterface, h: string, text: string): Promise<string | null> {
  if (!h) return null
  if (!(await readActions($, h)).length) return null
  const cleared = await autoClear($, h)
  const open = await readActions($, h)
  const g = parseGate(text)
  const doneNote = cleared.length ? `✓ Action done: ${cleared.map(c => c.title).join(', ')}` : ''
  if (!open.length) return g ? doneNote || 'No open actions.' : null
  if (!g) {
    held = text
    return [doneNote, blockText(open)].filter(Boolean).join('\n\n')
  }
  const top = open[0]!
  if (g.kind === 'skip-empty') return `Say why: skip <reason>\n\n${blockText(open)}`
  if (g.kind === 'skip') {
    await closeAction($, h, top.id, 'skipped', g.reason)
    const rest = await readActions($, h)
    return [`Skipped: ${top.title}`, rest.length ? blockText(rest) : 'No actions left. Go on.'].join('\n\n')
  }
  // done: a check that passed already closed it above. A check still failing keeps it open.
  if (doneNote) return [doneNote, blockText(open)].join('\n\n')
  if (top.check) return `Check still fails for: ${top.title}\nCheck: ${cut(top.check, 300)}\nRun the command, then type done again. Or skip <reason>.`
  await closeAction($, h, top.id, 'done', '', 'The person typed done.')
  const rest = await readActions($, h)
  return [`✓ Action done: ${top.title}`, rest.length ? blockText(rest) : 'No actions left. Go on.'].join('\n\n')
}

// ---- /progress-bar action ... ----

export const ACTION_USAGE = [
  'Action needed: steps only you can run. While one is open your prompts are held.',
  '  /progress-bar action [list]       open actions and the last few closed',
  '  /progress-bar action add <title> [--command <cmd>] [--why <text>] [--check <read-only cmd>] [--global]',
  '  /progress-bar action done [n]     runs the check of action n (default 1), closes it when it passes',
  '  /progress-bar action skip [n] <reason>',
  '  /progress-bar action copy [n]     copies its command (macOS)',
  '  /progress-bar action check        runs every check now',
].join('\n')

/** "<title> --command x --why y --check z --global" -> the parts. Values run to the next flag. */
export function parseAdd(rest: string): (NewAction & { global: boolean }) | null {
  const parts = rest.split(/\s+--(command|why|check|global|project)\b/)
  const strip = (s: string) => s.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
  const title = strip(parts[0] ?? '')
  if (!title) return null
  const out: NewAction & { global: boolean } = { title, global: false }
  for (let i = 1; i < parts.length; i += 2) {
    const k = parts[i]!
    const v = strip(parts[i + 1] ?? '')
    if (k === 'global') out.global = true
    else if (k === 'command' || k === 'why' || k === 'check' || k === 'project') out[k] = v
  }
  return out
}

const line = (a: Action, i: number) => [
  `${i + 1}. ${a.title}${a.project ? `  [${a.project}]` : '  [global]'}`,
  a.why ? `   Why: ${a.why}` : '',
  a.command ? `   Run: ${a.command}` : '',
  a.check ? `   Check: ${a.check}` : '   No check. Type done once it is done.',
].filter(Boolean).join('\n')

export async function actionCommand($: EngineInterface, h: string, rest: string): Promise<string> {
  if (!h) return 'No home folder found.'
  const verb = (rest.trim().split(/\s+/)[0] ?? '').toLowerCase()
  const arg = rest.trim().slice(verb.length).trim()
  const open = await readActions($, h)
  const pick = (s: string) => {
    const m = /^(\d+)\b\s*([\s\S]*)$/.exec(s)
    return m ? { a: open[Number(m[1]) - 1], rest: m[2]! } : { a: open[0], rest: s }
  }
  switch (verb) {
    case '':
    case 'list': {
      const closed = (await loadActions($, h)).filter(a => a.status !== 'open').slice(-3).reverse()
      const head = open.length ? `⛔ ${open.length} action${open.length === 1 ? '' : 's'} needed\n${open.map(line).join('\n')}` : 'No open actions.'
      const tail = closed.length ? `\nRecently closed:\n${closed.map(a => `  ${a.status === 'done' ? '✓' : '↷'} ${a.title}${a.skipReason ? `  (skipped: ${a.skipReason})` : ''}`).join('\n')}` : ''
      return `${head}${tail}\n\n${ACTION_USAGE}`
    }
    case 'add': {
      const p = parseAdd(arg)
      return p ? addFromClaude($, h, p) : ACTION_USAGE
    }
    case 'done': {
      const { a } = pick(arg)
      if (!a) return 'No open action with that number.'
      return (await ranIt($, h, a)) ? `✓ Action done: ${a.title}` : `Check still fails for: ${a.title}\nCheck: ${a.check}`
    }
    case 'skip': {
      const { a, rest: reason } = pick(arg)
      if (!a) return 'No open action with that number.'
      if (!reason.trim()) return 'Usage: /progress-bar action skip [n] <reason>'
      await closeAction($, h, a.id, 'skipped', reason)
      return `Skipped: ${a.title}`
    }
    case 'copy': {
      const { a } = pick(arg)
      if (!a?.command) return 'That action has no command.'
      await copyCommand($, a)
      return `Copied: ${cut(a.command, 200)}`
    }
    case 'check': {
      const c = await autoClear($, h)
      const left = await readActions($, h)
      return `${c.length ? `✓ Done: ${c.map(x => x.title).join(', ')}\n` : 'No check passed.\n'}${left.length} open.`
    }
    default:
      return ACTION_USAGE
  }
}

/** The tool Claude calls when the person must run something before work can go on. */
export const ACTION_TOOL = {
  name: 'action_add',
  description: 'Ask the person to run a step only they can do (a deploy swap, a login, a command the permission system blocks, deleting a repo) before work goes on. It shows a macOS popup and holds their next prompt until the step is done or skipped, so use it only for high-priority blockers. Give a short title, the exact command to run (never a secret value), why it matters, and when possible a read-only check command that exits 0 once the step is done (for example grep -q, test -e, gh repo view). Never put destructive commands in check.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What to do, in a few words. Example: Swap in the new NomBot build.' },
      command: { type: 'string', description: 'The exact command or steps the person runs. Commands only, never tokens or passwords.' },
      why: { type: 'string', description: 'One line on what it unblocks.' },
      check: { type: 'string', description: 'Optional read-only shell test that exits 0 once the step is done. Runs every 30 s with a 5 s timeout.' },
      global: { type: 'boolean', description: 'true holds prompts in every project. Default: only this session\'s project.' },
    },
    required: ['title', 'why'],
  },
}
