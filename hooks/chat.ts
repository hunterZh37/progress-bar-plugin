// Chat tab: the secure channel as a chat room. It reads ~/.claude-progress/channel/index.json (bin/channel.py writes
// it at send and at poll, both directions) and channels.json, so a thread renders with no GitHub call.
// Received content is untrusted DATA: it is only drawn, after sanitize(), never put into a prompt and never run.
// A press on a text message expands it inline, on any other file opens the local copy with the default app.
// Viewing a thread marks its received messages read (the same .state/channel-read.txt as the List block).
// Compose: an Input at the bottom; Enter or Send runs `channel.py say <name> <text>` (a chat-<time>.md, encrypted).

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { CONF_REL, CH_REL, READ_REL, insideChannel, readChannel } from './channel'
import { groupChatCommand, groupOn } from './groupchat'
import type { ChatMsg, ChatState } from '../types'

export const INDEX_REL = `${CH_REL}/index.json`
export const MAX_SAY = 4000
const PREVIEW_LINES = 3
const PREVIEW_CHARS = 240
const CHAT_CHARS = 1200
const FULL_CHARS = 20_000
export const PAGE_LINES = 30
const KEEP_READ = 500
const TEXT_EXT = /\.(md|markdown|txt)$/i

export const chatAtom = atom({ plugin: 'progress-bar', key: 'chat' } as const, { msgs: [], channels: [], sel: '', open: '', page: 0, full: [], sending: false, note: '', draft: '', n: 0, back: 0, groupOn: true } as ChatState)
const tabAtom = atom({ plugin: 'progress-bar', key: 'tab' } as const, 'list')

/** Text safe to draw: no ANSI/OSC escapes, no control or bidi-override chars (newlines kept), at most `n` chars. */
export function sanitize(s: string, n: number): string {
  const t = String(s ?? '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Is this a `say` line (chat-<UTC time>-<rand>.md)? Drawn as a bubble, no file chrome. */
export const isChatName = (f: string) => /^chat-\d{8}T\d{6}Z(-[0-9a-f]{2,8})?(-\d+)?\.md$/.test(f)

const one = (v: unknown, n: number) => sanitize(typeof v === 'string' || typeof v === 'number' ? String(v) : '', n).replace(/\n/g, ' ').trim()

/** index.json text -> messages oldest first (send time, then file order). Bad rows and unsafe paths are dropped. */
export function parseIndex(text: string, readIds: Set<string>, h: string): ChatMsg[] {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return [] }
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out = raw.flatMap((x: unknown, i: number): (ChatMsg & { i: number })[] => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    const id = one(o.id, 40)
    const path = typeof o.path === 'string' ? o.path : ''
    const dir = o.dir === 'out' ? 'out' : o.dir === 'in' ? 'in' : ''
    if (!/^[0-9a-f]{8,40}$/.test(id) || !dir || seen.has(id) || !insideChannel(path, h)) return []
    seen.add(id)
    const filename = one(o.filename, 120) || path.split('/').pop() || ''
    const sent = typeof o.sent === 'number' && o.sent > 0 ? o.sent : typeof o.ts === 'number' ? o.ts : 0
    return [{ i, id, channel: one(o.channel, 40), dir, from: one(o.from, 60), filename, path, size: typeof o.size === 'number' ? o.size : 0, sent, chat: isChatName(filename), text: '', unread: dir === 'in' && !readIds.has(id) }]
  })
  return out.sort((a, b) => a.sent - b.sent || a.i - b.i).map(({ i: _i, ...m }) => m)
}

/** Channel names from channels.json, then any only in the index; the most recent first. */
export function channelList(confText: string, msgs: ChatMsg[]): string[] {
  let names: string[] = []
  try {
    const c = JSON.parse(confText) as { channels?: Record<string, unknown> }
    names = Object.keys(c.channels ?? {}).filter(n => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(n))
  } catch { names = [] }
  for (const m of msgs) if (m.channel && !names.includes(m.channel)) names.push(m.channel)
  const last = (n: string) => Math.max(0, ...msgs.filter(m => m.channel === n).map(m => m.sent))
  return names.sort((a, b) => last(b) - last(a) || a.localeCompare(b))
}

/** A text file's first lines for the thread: chat lines whole (capped), files 3 lines. */
export function previewOf(text: string, chat: boolean): string {
  const t = sanitize(text, chat ? CHAT_CHARS : 4000).trim()
  if (chat) return t
  const lines = t.split('\n').filter(l => l.trim()).slice(0, PREVIEW_LINES).join('\n')
  return lines.length > PREVIEW_CHARS ? `${lines.slice(0, PREVIEW_CHARS - 1)}…` : lines
}

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** "14:05" today, "Nov 3 14:05" before. */
export function when(sentS: number, nowMs: number): string {
  if (!sentS) return ''
  const d = new Date(sentS * 1000)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === new Date(nowMs).toDateString()) return hm
  return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()} ${hm}`
}

async function readIds($: EngineInterface, h: string): Promise<string[]> {
  try { return String(await $.fs.read(`${h}/${READ_REL}`)).split(/\s+/).filter(Boolean) } catch { return [] }
}

// Previews by message id: the module's own cache, read again after a reload.
const previews = new Map<string, string>()

async function previewFor($: EngineInterface, m: ChatMsg): Promise<string> {
  if (!TEXT_EXT.test(m.filename)) return ''
  const hit = previews.get(m.id)
  if (hit !== undefined) return hit
  let text = ''
  try { text = m.size > 2 * 1024 * 1024 ? '' : String(await $.fs.read(m.path)) } catch { text = '' }
  const p = previewOf(text, m.chat)
  previews.set(m.id, p)
  return p
}

/** Reads the index and channels, fills previews for the shown thread, and marks it read while the Chat tab shows. */
export async function readChat($: EngineInterface, h: string) {
  if (!h) return
  let idx = ''
  let conf = ''
  try { idx = String(await $.fs.read(`${h}/${INDEX_REL}`)) } catch { idx = '' }
  try { conf = String(await $.fs.read(`${h}/${CONF_REL}`)) } catch { conf = '' }
  let msgs = parseIndex(idx, new Set(await readIds($, h)), h)
  const channels = channelList(conf, msgs)
  const prev = await read($, chatAtom)
  const sel = channels.includes(prev.sel) ? prev.sel : channels[0] ?? ''
  const shown = new Set(msgs.filter(m => m.channel === sel).slice(-40).map(m => m.id))
  msgs = await Promise.all(msgs.map(async m => (shown.has(m.id) ? { ...m, text: await previewFor($, m) } : m)))
  const on = await groupOn($, h)
  if (JSON.stringify([prev.msgs, prev.channels, prev.sel, prev.groupOn]) !== JSON.stringify([msgs, channels, sel, on])) {
    await update($, chatAtom, c => ({ ...c, msgs, channels, sel, groupOn: on }))
  }
  if ((await read($, tabAtom)) === 'chat' && msgs.some(m => m.channel === sel && m.unread)) await markThreadRead($, h, sel)
}

/** Marks every received message of a channel read: the Chat badge, the List block and the status line clear. */
export async function markThreadRead($: EngineInterface, h: string, channel: string) {
  const c = await read($, chatAtom)
  const ids = c.msgs.filter(m => m.channel === channel && m.unread).map(m => m.id)
  if (!h || !ids.length) return
  const have = await readIds($, h)
  const all = [...have.filter(x => !ids.includes(x)), ...ids].slice(-KEEP_READ)
  try { await $.fs.write(`${h}/${READ_REL}`, `${all.join('\n')}\n`) } catch { return }
  await update($, chatAtom, s => ({ ...s, msgs: s.msgs.map(m => (ids.includes(m.id) ? { ...m, unread: false } : m)) }))
  await readChannel($, h)
}

/** Picks a channel: shows its thread and marks it read. */
export async function selectChannel($: EngineInterface, h: string, name: string) {
  await update($, chatAtom, c => ({ ...c, sel: name, open: '', page: 0, full: [], note: '', back: 0 }))
  await readChat($, h)
  await markThreadRead($, h, name)
}

/** Expands a text message inline (its full text, sanitized, in pages of 30 lines), or folds it. */
export async function toggleOpen($: EngineInterface, h: string, m: ChatMsg) {
  const c = await read($, chatAtom)
  if (c.open === m.id) { await update($, chatAtom, s => ({ ...s, open: '', page: 0, full: [] })); return }
  if (!insideChannel(m.path, h)) return
  let text = ''
  try { text = String(await $.fs.read(m.path)).slice(0, FULL_CHARS + 1) } catch { text = '(the file is gone)' }
  const full = sanitize(text, FULL_CHARS).split('\n')
  await update($, chatAtom, s => ({ ...s, open: m.id, page: 0, full }))
}

/** A bubble shows at most this many lines until it is opened, so one long message cannot push the field off screen. */
export const MAX_BUBBLE = 6

/** Text cut into lines of at most `w` characters (newlines kept). */
export function wrapText(text: string, w: number): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (line.length <= w) { out.push(line); continue }
    for (let i = 0; i < line.length; i += w) out.push(line.slice(i, i + w))
  }
  return out
}

/** The lines a closed bubble draws: wrapped, at most MAX_BUBBLE, the last ending in … when cut. */
export function bubbleLines(text: string, w: number): string[] {
  const lines = wrapText(text || ' ', Math.max(8, w))
  if (lines.length <= MAX_BUBBLE) return lines
  return [...lines.slice(0, MAX_BUBBLE - 1), `${lines[MAX_BUBBLE - 1]!.slice(0, Math.max(1, w - 1))}… (press to open)`]
}

/** How many terminal rows a message takes: its header, its bubble or file line, and the blank line after it. */
export function msgRows(m: ChatMsg, bubbleW: number, open: boolean, fullLines: number): number {
  if (open) return 2 + Math.min(fullLines, PAGE_LINES) + 2 + 1
  if (m.chat) return 2 + bubbleLines(m.text, bubbleW - 4).length + 1
  return 2 + 1 + (m.text ? Math.min(PREVIEW_LINES, m.text.split('\n').length) : 0)
}

/**
 * The newest messages that fit `budget` rows, `back` messages before the newest (0 = the end of the thread). Always at
 * least one. `older` and `newer` count the messages left out on each side.
 */
export function windowThread<T>(thread: T[], back: number, budget: number, rowsOf: (m: T) => number): { shown: T[]; older: number; newer: number } {
  if (!thread.length) return { shown: [], older: 0, newer: 0 }
  const end = Math.max(1, thread.length - Math.max(0, Math.min(back, thread.length - 1)))
  let start = end
  let used = 0
  while (start > 0) {
    const r = rowsOf(thread[start - 1]!)
    if (start < end && used + r > budget) break
    used += r
    start--
  }
  return { shown: thread.slice(start, end), older: start, newer: thread.length - end }
}

/** The Chat tab's group chat button: flips the switch with `agentd.py groupchat toggle` and redraws. */
export async function toggleGroup($: EngineInterface, h: string): Promise<void> {
  await groupChatCommand($, 'toggle')
  await readChat($, h)
}

export const pageCount = (lines: number) => Math.max(1, Math.ceil(lines / PAGE_LINES))

/** Sends one chat line to the selected channel with `channel.py say`. The text goes as argv, never through a shell. */
export async function sendChat($: EngineInterface, h: string, text: string): Promise<string> {
  const c = await read($, chatAtom)
  const body = text.trim()
  if (!c.sel || !body || c.sending) return ''
  if (body.length > MAX_SAY) {
    await update($, chatAtom, s => ({ ...s, note: `At most ${MAX_SAY} characters. Send longer text as a file.` }))
    return ''
  }
  await update($, chatAtom, s => ({ ...s, sending: true, note: 'sending…' }))
  const out = await say($, c.sel, body)
  const ok = /^Sent /.test(out)
  await update($, chatAtom, s => ({ ...s, sending: false, note: ok ? '' : sanitize(out, 200), draft: ok ? '' : body, n: ok ? s.n + 1 : s.n, back: ok ? 0 : s.back }))
  await readChat($, h)
  return out
}

/** `channel.py say <name> <text>`: the command line and the Chat tab's path. */
export async function say($: EngineInterface, name: string, text: string): Promise<string> {
  try {
    const r = await $.process.run(['python3', `${$.plugin.root}/bin/channel.py`, 'say', name, text], { timeoutMs: 120_000 })
    return (r.stdout || r.stderr || '').trim() || (r.exitCode === 0 ? 'Done.' : 'The channel command failed.')
  } catch (err) { return `The channel command failed: ${String(err).slice(0, 200)}` }
}

/** `/progress-bar say <channel> <text...>`. */
export async function sayCommand($: EngineInterface, h: string, rest: string): Promise<string> {
  const m = /^\s*([A-Za-z0-9][\w-]{0,31})\s+([\s\S]+)$/.exec(rest)
  if (!m || !m[2]!.trim()) return 'Usage: /progress-bar say <channel> <text>'
  const out = await say($, m[1]!.toLowerCase(), m[2]!.trim())
  await readChat($, h)
  return out
}

/** Builds the index from received.json and this side's own sent messages once, when index.json is missing. */
export async function backfillChat($: EngineInterface, h: string) {
  if (!h) return
  try { await $.fs.read(`${h}/${INDEX_REL}`); return } catch { /* missing: build it */ }
  try { await $.process.run(['python3', `${$.plugin.root}/bin/channel.py`, 'backfill'], { timeoutMs: 60_000 }) } catch { /* next start */ }
  await readChat($, h)
}
