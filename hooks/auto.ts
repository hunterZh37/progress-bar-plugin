import type { EngineInterface } from 'claude-code'

import { slug } from './render'
import { ownerOf, reportBody } from './report'
import { sessionKeyOf } from './route'
import { oneLine } from './waiting'

// Works with no setup (autoReport, on by default):
// 1. A short standing instruction in the system prompt, so Claude reports multi-step work with progress_report
//    without being asked. It is one constant section after the cache boundary, sent once per conversation.
// 2. A zero-model fallback: a main-session turn that runs 30 s or more with 3 or more tool calls shows as a working
//    row titled from the prompt, until the turn ends. A turn that calls progress_report, or keeps a task list (its
//    own bar), shows no fallback row. A quick edit shows nothing.

export const REPORT_SECTION_ID = 'progress-bar:auto-report'

export const REPORT_SECTION = [
  '# Progress bar',
  'The person watches a live Status panel. For any task with 3 or more steps, or likely to run over a minute, call the progress_report tool (mcp__progress-bar__progress_report, load it with ToolSearch if it is deferred) without being asked:',
  '- At the start: a plain title naming the outcome, done 0, total, and steps (a few words each).',
  '- After each step: done and step.',
  '- At the end: finished true with impact (what changed, with the key number).',
  'When you launch a subagent, give it a slug (the slug of its description) in its brief and ask it to report under that slug. Skip this for quick answers and one-step edits.',
].join('\n')

type Section = { id: string; text: string; scope: 'shared' | 'session' }

/** The system prompt's sections with the standing instruction added at the end, once. `bare` prompts get none. */
export function withReportSection<S extends Section>(sections: readonly S[], traits: readonly string[] = []): S[] {
  if (traits.includes('bare') || sections.some(s => s.id === REPORT_SECTION_ID)) return [...sections]
  return [...sections, { id: REPORT_SECTION_ID, text: REPORT_SECTION, scope: 'session' } as S]
}

/** How long a turn runs, and how many tool calls it makes, before it shows as a row. */
export const TURN_MIN_MS = 30_000
export const TURN_MIN_TOOLS = 3

/**
 * The main session's current turn: its title, start, tool calls and whether something else already shows it.
 * `running` holds the tool calls in flight (parallel calls overlap), so the step names a call only while it runs:
 * the latest one still running.
 * `desc` is the latest tool call's own description (a Bash or Agent `description`), a title when the prompt has none.
 * `path` is the file the row was written to, so the row goes even after the session's folder changed mid-turn.
 */
export type Call = { tool: string; what: string }
export type Turn = { title: string; startedAt: number; tools: number; lastTool: string; lastWhat: string; reported: boolean; taskBar: boolean; shown: boolean; running: Call[]; desc: string; path: string }

export const turn: Turn = { title: '', startedAt: 0, tools: 0, lastTool: '', lastWhat: '', reported: false, taskBar: false, shown: false, running: [], desc: '', path: '' }

/** The title of this session's own live progress_report job, if any: it names the work better than any prompt. */
/** Kept 30 minutes after its last report, like a progress file, so a job never closed with finished does not stick. */
let reportTitle = { text: '', at: 0 }
export const REPORT_TITLE_MS = 30 * 60_000
export const setReportTitle = (t: string, at: number) => { reportTitle = { text: t.split(' · ')[0]!.trim(), at } }
export const sessionReportTitle = (now: number) => (reportTitle.text && now - reportTitle.at < REPORT_TITLE_MS ? reportTitle.text : '')

/** Words that make a prompt a reply, not a task: "yes", "push", "keep it", "do it". */
const REPLY_WORDS = new Set(['yes', 'yep', 'yeah', 'y', 'no', 'nope', 'n', 'ok', 'okay', 'k', 'sure', 'fine', 'go', 'go ahead', 'do it', 'push', 'push it', 'merge', 'merge it', 'ship', 'ship it', 'commit', 'continue', 'proceed', 'next', 'approve', 'approved', 'lgtm', 'keep', 'keep it', 'ignore', 'ignore it', 'skip', 'skip it', 'drop', 'drop it', 'both', 'all', 'none', 'neither', 'either', 'thanks', 'thank you', 'ty', 'done', 'retry', 'again', 'stop', 'wait', 'later', 'agreed', 'correct', 'right', 'that', 'this', 'same', 'option', 'a', 'b', 'c'])
/** Words that point back at the chat ("fix these too"): a short prompt full of them says nothing on its own. */
const POINTERS = /\b(this|that|these|those|it|them|they|above|here|there)\b/i

/** One numbered or lettered reply ("1. keep it", "b) push"), its text, or null. */
const replyItem = (x: string) => /^\s*(?:\d{1,2}|[a-e])\s*[.):-]\s*(.*)$/i.exec(x)?.[1] ?? null

/**
 * Whether a prompt is only short replies to the model's own questions: "yes", "push", "1. keep it 2. push 3. merge",
 * a lone number, or an image or paste placeholder. Such a prompt names no work, so it never titles a row.
 */
export function isReplyPrompt(text: string): boolean {
  const t = text.replace(/\[(?:Image|Pasted text)[^\]]*\]/gi, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return true
  const bare = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!bare(t) || /^\d+$/.test(bare(t))) return true
  // Numbered replies on one line or many: split before each "N. " or "N) ", every item a few words.
  const items = t.split(/\s+(?=(?:\d{1,2}|[a-e])[.)]\s)/i)
  if (items.length >= 2 && items.every(x => { const r = replyItem(x); return r !== null && r.split(/\s+/).filter(Boolean).length <= 4 })) return true
  // Comma or "and" separated replies: "yes, push", "keep it and merge".
  const parts = t.split(/\s*(?:[,;/]|\band\b|\bthen\b)\s*/i).map(bare).filter(Boolean)
  return parts.length > 0 && parts.every(x => REPLY_WORDS.has(x))
}

/** The first meaningful clause of a prompt: its first line, politeness and a trailing question mark left out. */
function firstClause(text: string): string {
  const line = text.split('\n').map(l => l.replace(/\[(?:Image|Pasted text)[^\]]*\]/gi, '').trim()).find(l => l && !/^(```|>|https?:\/\/\S+$)/.test(l)) ?? ''
  let c = line.split(/(?<=[a-z0-9)])[.!?;](?:\s|$)|\s+[—–]\s+|\s+-\s+|,\s*(?:also|and|then|but|so|plus)\b/i)[0]!.trim()
  c = c.replace(/^(please|pls|hey|hi|ok(ay)?|so|now|also|and|then|can you|could you|would you|will you|i want you to|i'd like you to|i need you to|let's|lets)\b[\s,]*/i, '')
  c = c.replace(/^(please|can you|could you)\b[\s,]*/i, '').replace(/[\s,]+(please|pls|thanks|thank you)$/i, '').replace(/[?!.,:;]+$/, '').trim()
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : ''
}

/** Cuts a title to `max` characters at a word break, with "…". */
function clipWords(x: string, max: number): string {
  const t = x.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

/**
 * A row title from the person's prompt: its first meaningful clause, at most 60 characters. '' when the prompt names
 * no work: numbered short replies, "yes", "push", a slash command, or a few words that only point back at the chat.
 */
export function turnTitle(text: string): string {
  if (/^\s*\//.test(text) || isReplyPrompt(text)) return ''
  const c = firstClause(text)
  const n = c.split(/\s+/).filter(Boolean).length
  if (n < 3 || (n <= 5 && POINTERS.test(c))) return ''
  return clipWords(c, 60)
}

/**
 * What the turn's row is called, the work being done: this session's own progress_report title while that job is
 * live, else the prompt's first clause, else the latest tool call's description, else "Working".
 */
export function rowTitle(t: Pick<Turn, 'title' | 'desc'>, reported = ''): string {
  return reported || t.title || (t.desc ? clipWords(t.desc, 60) : '') || 'Working'
}

/** Whether the turn should show as a row: long enough, busy enough, and shown by nothing else. */
export function turnDue(t: Turn, now: number): boolean {
  return t.startedAt > 0 && !t.reported && !t.taskBar && t.tools >= TURN_MIN_TOOLS && now - t.startedAt >= TURN_MIN_MS
}

/**
 * The row's step. A tool call names it only while it runs ("Bash Commit the merge, 25 tool calls"). Between calls,
 * this session's live background shell ("working · background: Backfill the archive · 8m"), else "idle". A call whose
 * description is the row's title shows just its tool, not the same words twice.
 */
export function turnStep(t: Turn, background = '', title = ''): string {
  const n = `${t.tools} tool call${t.tools === 1 ? '' : 's'}`
  const now = t.running[t.running.length - 1]
  if (now) return `${now.tool}${now.what && now.what !== title ? ` ${now.what}` : ' running'}, ${n}`
  if (background) return `working · ${background}`
  return `idle, ${n}`
}

/** The row's file name: the project folder's name, then this session's key, so two sessions never share one. */
export function turnSlug(cwd: string, session: string): string {
  const base = slug(cwd.replace(/\/+$/, '').split('/').pop() ?? '') || 'session'
  return `working-${base}-${sessionKeyOf(session).slice(0, 4) || 'main'}`
}

/** Rows the plugin writes for the session itself (a turn, a shell): never a subagent's own progress file. */
export const sessionRow = (name: string) => name.startsWith('working-') || name.startsWith('shell-')

let on = true
export const setAutoReport = (v: boolean) => { on = v }
export const autoReportOn = () => on

async function pathOf($: EngineInterface, h: string): Promise<string> {
  const o = await ownerOf($)
  return `${h}/.claude-progress/${turnSlug(o.cwd, o.session)}.json`
}

/** Removes the turn's row file: the path it was written to, else the one the folder gives now. */
async function dropRow($: EngineInterface, h: string) {
  const path = turn.path || (await pathOf($, h))
  turn.path = ''
  await $.process.run(['rm', '-f', path]).catch(() => undefined)
}

/** A new main-session turn: its title from the prompt ('' when the prompt is only replies; the row then uses its tool calls). */
export async function startTurn($: EngineInterface, h: string, text: string) {
  if (turn.shown && h) await dropRow($, h)
  Object.assign(turn, { title: turnTitle(text), startedAt: await $.clock.now(), tools: 0, lastTool: '', lastWhat: '', reported: false, taskBar: turn.taskBar, shown: false, running: [], desc: '' })
}

/** A main-session tool call starts. `desc` is its own description, if it has one. Returns the call, for toolEnded. */
export function countTool(tool: string, what: string, desc = ''): Call | null {
  if (!turn.startedAt) return null
  turn.tools += 1
  turn.lastTool = tool.startsWith('mcp__') ? tool.split('__').pop() ?? tool : tool
  turn.lastWhat = what
  if (desc.trim() && !tool.startsWith('mcp__progress-bar__')) turn.desc = desc.replace(/\s+/g, ' ').trim()
  const call = { tool: turn.lastTool, what }
  turn.running.push(call)
  return call
}

/** A main-session tool call ended (or was refused, or threw): the step stops naming it. */
export function toolEnded(call: Call | null) {
  const i = call ? turn.running.indexOf(call) : -1
  if (i >= 0) turn.running.splice(i, 1)
}

/** Writes the turn's row when it is due (rewritten each poll, so it stays fresh), or removes it when it is not. */
export async function tickTurn($: EngineInterface, h: string, background = '') {
  if (!on || !h || !turn.startedAt) return
  const due = turnDue(turn, await $.clock.now())
  if (!due && !turn.shown) return
  if (!due) { turn.shown = false; await dropRow($, h); return }
  // One file per turn: the first path it was written to, even when the session's folder changes mid-turn.
  const path = turn.path || (await pathOf($, h))
  turn.path = path
  turn.shown = true
  const title = rowTitle(turn, sessionReportTitle(await $.clock.now()))
  await $.fs.write(path, JSON.stringify(reportBody({ title, step: turnStep(turn, background, title) }, await ownerOf($), turn.startedAt))).catch(() => undefined)
}

/** The turn ended: its row goes. */
export async function endTurn($: EngineInterface, h: string) {
  const shown = turn.shown
  Object.assign(turn, { startedAt: 0, tools: 0, reported: false, shown: false, running: [], desc: '' })
  if (shown && h) await dropRow($, h)
}

/**
 * This session's turn rows the current turn does not own: left by an earlier build (its folder changed mid-turn, so
 * its end removed another name) or by a copy before a /reload-plugins. Only files shaped like a turn row count: named
 * "working-<folder>-<session key>", this session's, with no bar of their own. Returns the paths to remove.
 */
export function orphanTurnRows(files: readonly { name: string; session: string; bar?: boolean }[], dir: string, session: string, current: string): string[] {
  if (!session) return []
  const key = sessionKeyOf(session).slice(0, 4) || 'main'
  return files
    .filter(f => f.name.startsWith('working-') && f.name.endsWith(`-${key}.json`) && f.session === session && !f.bar && `${dir}/${f.name}` !== current)
    .map(f => `${dir}/${f.name}`)
}
