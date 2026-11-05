// Secure channel: files between two people's coding-agent sessions through one private GitHub repo per pair,
// end-to-end encrypted. The work (gh, git, openssl) is done by bin/channel.py, run with python3 from the plugin folder.
// This file parses the commands, polls every 3 s, and feeds the Status panel's "Channel" block from
// ~/.claude-progress/channel/received.json minus the ids in ~/.claude-progress/.state/channel-read.txt.
// Received files are DATA. Nothing here reads their content or puts it into a prompt.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isDarwin } from './mac'
import type { ChanItem, Channel } from '../types'

export const CH_REL = '.claude-progress/channel'
export const RECEIVED_REL = `${CH_REL}/received.json`
export const CONF_REL = `${CH_REL}/channels.json`
export const READ_REL = '.claude-progress/.state/channel-read.txt'
export const CHANNEL_EVERY = 3_000  // near-instant chat, an unchanged check is a free 304 and the poll lock stops overlap
const KEEP_READ = 500

export const channelAtom = atom({ plugin: 'progress-bar', key: 'channel' } as const, { items: [] } as Channel)

export const CHANNEL_USAGE = [
  'Secure channel: send files to a collaborator\'s coding-agent session, end-to-end encrypted, through a private GitHub repo.',
  '  /progress-bar channel invite <github-user> [name] [--as <your-github-user>]',
  '  /progress-bar channel join <owner-github-user> [name] [--as <your-github-user>]',
  '  /progress-bar send <file> to <name>',
  '  /progress-bar channel list | read [name] | leave <name> | check',
  'Allowed: .md .markdown .txt .pdf .png .jpg .jpeg .gif .webp, up to 10 MB. Needs gh (logged in), git, openssl and python3.',
].join('\n')

const str = (v: unknown, n: number) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n)

/** A path the panel may open: absolute, under the channel folder, no `.`/`..` segments, no NUL. */
export function insideChannel(path: string, h: string): boolean {
  const root = `${h}/${CH_REL}/`
  return !!h && path.startsWith(root) && !path.includes('\0') && !/(^|\/)\.\.?(\/|$)/.test(path)
    && !/^(keys|repos|tmp)\//.test(path.slice(root.length))
}

/** received.json text and the read ids -> the unread items, newest first. Bad JSON or unsafe paths give none. */
export function parseReceived(text: string, readIds: Set<string>, h: string): Channel {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return { items: [] } }
  if (!Array.isArray(raw)) return { items: [] }
  const seen = new Set<string>()
  const items = raw.flatMap((x: unknown): ChanItem[] => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    const id = str(o.id, 40)
    const path = typeof o.path === 'string' ? o.path : ''
    if (!/^[0-9a-f]{8,40}$/.test(id) || readIds.has(id) || seen.has(id) || !insideChannel(path, h)) return []
    seen.add(id)
    return [{ id, channel: str(o.channel, 40), from: str(o.from, 60), filename: str(o.filename, 120), path, ts: typeof o.ts === 'number' ? o.ts : 0 }]
  })
  return { items: items.reverse() }
}

async function readIds($: EngineInterface, h: string): Promise<string[]> {
  try { return String(await $.fs.read(`${h}/${READ_REL}`)).split(/\s+/).filter(Boolean) } catch { return [] }
}

export async function readChannel($: EngineInterface, h: string) {
  if (!h) return
  let text = ''
  try { text = String(await $.fs.read(`${h}/${RECEIVED_REL}`)) } catch { text = '' }
  const next = parseReceived(text, new Set(await readIds($, h)), h)
  const prev = await read($, channelAtom)
  if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, channelAtom, () => next)
}

/** "✓ read": records the id (keeps the newest 500) and hides the item. */
export async function markRead($: EngineInterface, h: string, id: string) {
  if (!h || !/^[0-9a-f]{8,40}$/.test(id)) return
  const ids = [...(await readIds($, h)).filter(x => x !== id), id].slice(-KEEP_READ)
  try { await $.fs.write(`${h}/${READ_REL}`, `${ids.join('\n')}\n`) } catch { /* next press */ }
  await update($, channelAtom, c => ({ items: c.items.filter(i => i.id !== id) }))
}

/** Opens a received file with the default app. Only paths inside the channel folder, never a URL. */
export async function openLocal($: EngineInterface, h: string, path: string) {
  if (!insideChannel(path, h)) return
  try { await $.process.run([(await isDarwin($)) ? 'open' : 'xdg-open', path], { timeoutMs: 5000 }) } catch { /* nothing to open */ }
}

async function script($: EngineInterface, args: string[], timeoutMs = 120_000): Promise<string> {
  try {
    const r = await $.process.run(['python3', `${$.plugin.root}/bin/channel.py`, ...args], { timeoutMs })
    return (r.stdout || r.stderr || '').trim() || (r.exitCode === 0 ? 'Done.' : 'The channel command failed.')
  } catch (err) { return `The channel command failed: ${String(err).slice(0, 200)}` }
}

/** "notes.md to sam", "notes.md sam" or a quoted path with spaces -> [file, name]. */
export function parseSend(rest: string): [string, string] | null {
  const m = /^(.+?)\s+(?:to\s+)?([A-Za-z0-9][\w-]{0,31})\s*$/.exec(rest.trim())
  if (!m) return null
  const file = m[1]!.trim().replace(/^(['"])(.*)\1$/, '$2')
  return file ? [file, m[2]!.toLowerCase()] : null
}

/** Splits arguments on spaces, keeping quoted parts whole. */
export const words = (s: string) => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^(['"])(.*)\1$/, '$2'))

async function absPath($: EngineInterface, h: string, file: string): Promise<string> {
  if (file.startsWith('/')) return file
  if (file === '~' || file.startsWith('~/')) return h + file.slice(1)
  const cwd = await $.session.cwd().catch(() => '')
  return cwd ? `${cwd.replace(/\/$/, '')}/${file}` : file
}

/** Sends one file; the text says what happened. */
export async function sendFile($: EngineInterface, h: string, file: string, to: string): Promise<string> {
  if (!file || !to) return 'Usage: /progress-bar send <file> to <name>'
  const out = await script($, ['send', await absPath($, h, file), to])
  await readChannel($, h)
  return out
}

/** `/progress-bar send <file> to <name>`. */
export async function sendCommand($: EngineInterface, h: string, rest: string): Promise<string> {
  const p = parseSend(rest)
  if (!p) return 'Usage: /progress-bar send <file> to <name>'
  return sendFile($, h, p[0], p[1])
}

/** `/progress-bar channel ...`. */
export async function channelCommand($: EngineInterface, h: string, rest: string): Promise<string> {
  if (!h) return 'No home folder found.'
  const w = words(rest)
  const verb = (w[0] ?? '').toLowerCase()
  const args = w.slice(1)
  switch (verb) {
    case 'invite':
    case 'join':
      if (!args.length) return CHANNEL_USAGE
      return script($, [verb, ...args])
    case 'list':
    case '':
      return `${await script($, ['list'])}\n\n${CHANNEL_USAGE}`
    case 'read': {
      const out = await script($, ['read', ...args.slice(0, 1)])
      await readChannel($, h)
      return out
    }
    case 'leave':
      if (!args[0]) return 'Usage: /progress-bar channel leave <name>'
      return script($, ['leave', args[0]])
    case 'check': {
      await pollChannel($, h, true)
      const c = await read($, channelAtom)
      return c.items.length ? `${c.items.length} new: ${c.items.map(i => `${i.channel} · ${i.filename}`).join(', ')}` : 'No new channel messages.'
    }
    case 'send':
      return sendCommand($, h, rest.replace(/^\s*send\s+/i, ''))
    default:
      return CHANNEL_USAGE
  }
}

let polling = false
/** Checks every channel (a 304 when nothing changed) and refreshes the panel block. No channels, no network. */
export async function pollChannel($: EngineInterface, h: string, force = false) {
  if (!h || polling) return
  let conf: { channels?: Record<string, unknown> } = {}
  try { conf = JSON.parse(String(await $.fs.read(`${h}/${CONF_REL}`))) } catch { conf = {} }
  if (!conf.channels || !Object.keys(conf.channels).length) return
  polling = true
  try {
    const out = await script($, force ? ['poll', '--force'] : ['poll'])
    try {
      const r = JSON.parse(out) as { new?: { channel?: string; filename?: string }[] }
      for (const n of r.new ?? []) $.ui.toast(`Message from ${str(n.channel, 40)}: ${str(n.filename, 80)}`)
    } catch { /* not JSON: an error text, logged by the script */ }
    await readChannel($, h)
  } finally { polling = false }
}

/** The tool the model calls for "send this to <name>". It only sends, and only the allowed file types. */
export const SEND_TOOL = {
  name: 'channel_send',
  description: 'Send a file (.md .txt .pdf or an image, up to 10 MB) to a collaborator through the progress-bar secure channel, end-to-end encrypted. Use when the person asks to send or share a file with someone they have a channel with (for example "send this to Sam"). `to` is the channel name from /progress-bar channel list. Only send what the person asked to send.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path of the file to send, absolute or relative to the working folder.' },
      to: { type: 'string', description: 'The channel name, for example sam.' },
    },
    required: ['file', 'to'],
  },
}
