import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Conn, ConnKind } from '../types'

// The CONNECTORS section of the Status panel: each MCP server's name and status (ok, needs sign-in, failed).
// A refresh runs `claude mcp list` at most every 5 minutes, only while the panel is open, never two at once.
// The URL or command part of each line is dropped at parse time: it is never kept, cached or drawn,
// since it can hold credentials. Sessions share the result through ~/.cache/progress-bar/connectors.txt.

export const CONN_CACHE_REL = '.cache/progress-bar/connectors.txt'
const CONN_LOCK_REL = '.cache/progress-bar/connectors.lock'
export const CONN_ACCOUNTS_REL = '.claude-progress/connector-accounts.txt'
export const CONN_EVERY = 5 * 60_000
const LOCK_MS = 2 * 60_000

export const connsAtom = atom({ plugin: 'progress-bar', key: 'conns' } as const, { at: 0, checking: false, login: '', list: [] })

const KINDS = new Set<string>(['ok', 'auth', 'fail'])

/** A display name: no "claude.ai " prefix or " for creativity" suffix. '' when it looks like a URL or path. */
export function connName(raw: string): string {
  const name = raw.trim().replace(/^claude\.ai\s+/, '').replace(/\s+for creativity$/, '').trim()
  return /[/@:\t\n]/.test(name) ? '' : name
}

/** Parses `claude mcp list` output into name + kind. The URL or command between them is discarded. */
export function parseMcpList(stdout: string): Conn[] {
  const out: Conn[] = []
  for (const line of stdout.split('\n')) {
    const colon = line.indexOf(': ')
    const dash = line.lastIndexOf(' - ')
    if (colon <= 0 || dash <= colon) continue
    const name = connName(line.slice(0, colon))
    const status = line.slice(dash + 3).replace(/^[^A-Za-z]+/, '').trim()
    if (!name || !status) continue
    const kind: ConnKind = /^connected\b/i.test(status) ? 'ok' : /auth|sign/i.test(status) ? 'auth' : 'fail'
    out.push({ name, kind })
  }
  return out
}

/** `claude auth status --json` -> "email · org", nothing else kept. '' when logged out or unreadable. */
export function parseLogin(stdout: string): string {
  try {
    const j = JSON.parse(stdout) as { loggedIn?: unknown; email?: unknown; orgName?: unknown }
    if (j.loggedIn === false) return ''
    const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/[\t\n\r]/g, ' ').trim() : '')
    return [clean(j.email), clean(j.orgName)].filter(Boolean).join(' · ')
  } catch { return '' }
}

/** The cache text: one "name<TAB>kind" line per connector, then "#login" and "#checked" (epoch seconds). */
export function formatCache(list: Conn[], login: string, atMs: number): string {
  return [...list.map(c => `${c.name}\t${c.kind}`), ...(login ? [`#login\t${login}`] : []), `#checked\t${Math.floor(atMs / 1000)}`].join('\n') + '\n'
}

export function parseCache(raw: string): { at: number; login: string; list: Conn[] } {
  let at = 0
  let login = ''
  const list: Conn[] = []
  for (const l of raw.split('\n')) {
    const [a = '', b = ''] = l.split('\t')
    if (a === '#checked') at = Number(b) * 1000 || 0
    else if (a === '#login') login = b.trim()
    else if (!a.startsWith('#') && KINDS.has(b)) {
      const name = connName(a)
      if (name) list.push({ name, kind: b as ConnKind })
    }
  }
  return { at, login, list }
}

/** "name<TAB>account[<TAB>url]" lines; # starts a comment. */
export function parseAccounts(raw: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const l of raw.split('\n')) {
    if (!l.trim() || l.trim().startsWith('#')) continue
    const [name = '', account = ''] = l.split('\t')
    if (name.trim() && account.trim()) m.set(connName(name) || name.trim(), account.trim())
  }
  return m
}

/** Web pages for known connectors. Google pages take ?authuser=<email> so they open as the connected account. */
const CONN_PAGES: Record<string, string> = {
  'gmail': 'https://mail.google.com/mail/',
  'google drive': 'https://drive.google.com/drive/my-drive',
  'google docs': 'https://docs.google.com/document/',
  'google sheets': 'https://docs.google.com/spreadsheets/',
  'google slides': 'https://docs.google.com/presentation/',
  'google calendar': 'https://calendar.google.com/calendar/',
  'canva': 'https://www.canva.com/',
  'adobe': 'https://www.adobe.com/',
  'claude docs': 'https://claude.ai/',
  'slack': 'https://app.slack.com/',
  'notion': 'https://www.notion.so/',
  'linear': 'https://linear.app/',
  'github': 'https://github.com/',
}

/**
 * The page a connector opens on press: a third "url" column in the accounts file wins, else a known page.
 * Google pages get ?authuser=<the account's email>, so Gmail opens the right inbox. '' when there is none.
 */
export function connUrl(name: string, account = '', override = ''): string {
  if (/^https:\/\/\S+$/.test(override)) return override
  const page = CONN_PAGES[name.trim().toLowerCase()]
  if (!page) return ''
  const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(account)?.[0]
  return email && /google\.com\//.test(page) ? `${page}?authuser=${encodeURIComponent(email)}` : page
}

/** "name<TAB>account<TAB>url" lines: the optional url column. */
export function parseUrls(raw: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const l of raw.split('\n')) {
    if (!l.trim() || l.trim().startsWith('#')) continue
    const [name = '', , url = ''] = l.split('\t')
    if (name.trim() && url.trim()) m.set(connName(name) || name.trim(), url.trim())
  }
  return m
}

async function readText($: EngineInterface, path: string): Promise<string> {
  try { return String(await $.fs.read(path)) } catch { return '' }
}

/** Reads the shared cache and the accounts file into the atom. Returns the last check time. */
export async function readConns($: EngineInterface, h: string): Promise<number> {
  const { at, login, list } = parseCache(await readText($, `${h}/${CONN_CACHE_REL}`))
  const accounts = parseAccounts(await readText($, `${h}/${CONN_ACCOUNTS_REL}`))
  const urls = parseUrls(await readText($, `${h}/${CONN_ACCOUNTS_REL}`))
  const withAcc = list.map(c => ({ ...c, account: accounts.get(c.name) ?? '', url: connUrl(c.name, accounts.get(c.name) ?? '', urls.get(c.name) ?? '') }))
  const prev = await read($, connsAtom)
  if (prev.at !== at || prev.login !== login || JSON.stringify(prev.list) !== JSON.stringify(withAcc)) {
    await update($, connsAtom, c => ({ ...c, at, login, list: withAcc }))
  }
  return at
}

let running = false

/** Clears a "checking…" left over from before a reload. */
export async function resetConns($: EngineInterface) {
  running = false
  await update($, connsAtom, c => ({ ...c, checking: false }))
}

/** Refreshes when the cache is older than 5 minutes (or `force`), unless a check is already running here or in another session. */
export async function refreshConns($: EngineInterface, h: string, force = false) {
  if (!h || running) return
  const at = await readConns($, h)
  const now = await $.clock.now()
  if (!force && now - at < CONN_EVERY) return
  const lock = `${h}/${CONN_LOCK_REL}`
  const lockAt = Number((await readText($, lock)).trim()) * 1000 || 0
  if (now - lockAt < LOCK_MS) return
  running = true
  let saved = false
  try {
    await update($, connsAtom, c => ({ ...c, checking: true }))
    await $.fs.write(lock, `${Math.floor(now / 1000)}\n`)
    const opts = { cwd: h, timeoutMs: 90_000 }
    const mcp = await $.process.run(['claude', 'mcp', 'list'], opts)
    const list = parseMcpList(mcp.stdout)
    let login = ''
    try { login = parseLogin((await $.process.run(['claude', 'auth', 'status', '--json'], opts)).stdout) } catch { login = '' }
    if (list.length || mcp.exitCode === 0) {
      await $.fs.write(`${h}/${CONN_CACHE_REL}`, formatCache(list, login, await $.clock.now()))
      saved = true
    }
  } catch { /* keep the old list */ } finally { running = false }
  // After a failed check the lock stays, so the next try waits LOCK_MS instead of running every second.
  if (saved) await $.process.run(['rm', '-f', lock]).catch(() => undefined)
  await update($, connsAtom, c => ({ ...c, checking: false }))
  await readConns($, h)
}

/** "7 ok · 2 need sign-in · 1 failed" */
export function connSummary(list: Conn[]): string {
  const n = (k: ConnKind) => list.filter(c => c.kind === k).length
  return [`${n('ok')} ok`, n('auth') ? `${n('auth')} need sign-in` : '', n('fail') ? `${n('fail')} failed` : ''].filter(Boolean).join(' · ')
}
