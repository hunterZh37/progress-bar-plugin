import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ChromeCheck, ChromeView } from '../types'
import { isDarwin } from './mac'

// Which Chrome browser Claude in Chrome drives, under which Google account, and whether it is on this Mac.
// Nothing is asked of Chrome: the plugin reads the results of the session's own mcp__claude-in-chrome__* calls.
//   list_connected_browsers: each browser's deviceId, name, osPlatform, isLocal, onThisComputer, inUse, connectedAt.
//   select_browser (input deviceId), switch_browser ('Connected to browser "X"'): the browser in use.
//   A page on accounts.google.com or myaccount.google.com, or a Gmail tab title ("Inbox - a@b.c - Gmail"): its email.
// Per session: ~/.claude-progress/.state/chrome-<session>.json. Shared by all sessions, so one sighting serves every
// session: ~/.claude-progress/.state/chrome-accounts.json, deviceId -> {email, seenAt, from}.
// The Google accounts signed in to Chrome on this Mac come from Chrome's "Local State" file (profile.info_cache),
// read only, and only the names and emails are kept. Missing on Linux: then no email check is made.
// Chrome's Local State is unreadable on most Macs (privacy protection), so the person can list this Mac's accounts:
// ~/.claude-progress/chrome-local-accounts.txt, one email per line, # comments. Both lists are merged.
// The built-in /chrome command switches browsers without a tool call. Its output row ("Now using browser "X" for
// Chrome actions.") is seen two ways: the session.append hook as it is stored, and the session transcript's new bytes
// on each poll (after a reload). The name maps to a deviceId through the last browser list.
// A project can name the account it expects: "chromeAccount" in ~/.claude-progress/goals/<slug>.json. Off by default.

export const CHROME_PREFIX = 'mcp__claude-in-chrome__'
export const chromeStateRel = (key: string) => `.claude-progress/.state/chrome-${key}.json`
export const CHROME_ACCOUNTS_REL = '.claude-progress/.state/chrome-accounts.json'
export const CHROME_LOCAL_STATE_REL = 'Library/Application Support/Google/Chrome/Local State'
export const CHROME_LOCAL_ACCOUNTS_REL = '.claude-progress/chrome-local-accounts.txt'
export const LOCAL_ACCOUNTS_HINT = "Add this Mac's Google accounts to ~/.claude-progress/chrome-local-accounts.txt to get wrong-browser warnings."
const TX_TAIL = 4 * 1024 * 1024
const LOCAL_EVERY = 5 * 60_000

export type ChromeBrowser = { deviceId: string; name: string; osPlatform?: string; isLocal?: boolean; onThisComputer?: boolean; inUse?: boolean; connectedAt?: number }
// inUseName: a browser /chrome picked that is not in the last list. switchAt: the last /chrome switch applied.
export type ChromeState = { browsers: ChromeBrowser[]; inUse: string; connected: boolean | null; lastUseAt: number; email?: string; tabs: Record<string, string>; inUseName?: string; switchAt?: number }
export type ChromeAccount = { email: string; seenAt: number; from: 'account' | 'gmail'; name?: string }
export type ChromeAccounts = Record<string, ChromeAccount>

export const EMPTY_STATE: ChromeState = { browsers: [], inUse: '', connected: null, lastUseAt: 0, tabs: {} }
export const EMPTY_VIEW: ChromeView = { line: 'Chrome: not connected', tone: 'dim', warn: '', usedAt: 0, others: [] }
// The Check account button: a pressed check hides its button this long (shared by all sessions).
export const CHROME_CHECKS_REL = '.claude-progress/.state/chrome-checks.json'
export const CHECK_PENDING_MS = 2 * 60_000
export const ACCOUNT_URL = 'https://myaccount.google.com/'

export const chromeAtom = atom({ plugin: 'progress-bar', key: 'chrome' } as const, EMPTY_VIEW)

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
const EMAILS = new RegExp(EMAIL.source, 'g')
const ACCOUNT_HOST = /^https?:\/\/(?:accounts|myaccount)\.google\.com(?:[/?#]|$)/i
// Addresses on Google's own pages that are never the signed-in account.
const NOT_ACCOUNT = /@(?:google\.com|gstatic\.com|googleusercontent\.com|example\.com)$|^(?:no-?reply|support|privacy)@/i

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const clean = (s: string) => s.replace(/[\t\n\r]/g, ' ').trim().slice(0, 80)

/** A tool result as plain text: a string, MCP content blocks ([{type:'text', text}]), or {content: [...]}. */
export function resultText(r: unknown): string {
  if (typeof r === 'string') return r
  if (Array.isArray(r)) return r.map(resultText).filter(Boolean).join('\n')
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
    if ('content' in o) return resultText(o.content)
    if ('result' in o) return resultText(o.result)
  }
  return ''
}

/** Every JSON array or object that starts a line or the text, parsed. */
function jsonParts(text: string): unknown[] {
  const out: unknown[] = []
  for (const part of text.split(/\n(?=\s*[[{])/)) {
    const t = part.trim()
    if (!/^[[{]/.test(t)) continue
    try { out.push(JSON.parse(t)) } catch {
      const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'))
      try { if (end > 0) out.push(JSON.parse(t.slice(0, end + 1))) } catch { /* not JSON */ }
    }
  }
  return out
}

/** list_connected_browsers: the browsers, null when the text holds no list. [] means none are connected. */
export function parseBrowsers(text: string): ChromeBrowser[] | null {
  for (const j of jsonParts(text)) {
    const arr = Array.isArray(j) ? j : Array.isArray((j as { browsers?: unknown })?.browsers) ? (j as { browsers: unknown[] }).browsers : null
    if (!arr) continue
    const list = arr.flatMap((x): ChromeBrowser[] => {
      const b = (x ?? {}) as Record<string, unknown>
      const deviceId = clean(str(b.deviceId))
      if (!deviceId) return []
      const out: ChromeBrowser = { deviceId, name: clean(str(b.name)) || 'Browser' }
      if (str(b.osPlatform)) out.osPlatform = clean(str(b.osPlatform))
      if (typeof b.isLocal === 'boolean') out.isLocal = b.isLocal
      if (typeof b.onThisComputer === 'boolean') out.onThisComputer = b.onThisComputer
      if (b.inUse === true) out.inUse = true
      if (typeof b.connectedAt === 'number' && Number.isFinite(b.connectedAt)) out.connectedAt = b.connectedAt
      return [out]
    })
    if (list.length || arr.length === 0) return list
  }
  return null
}

/** The signed-in email on a Google account page's text ("Hunter Zhang\nhunter@protocolvr.com"). '' when none. */
export function accountPageEmail(text: string): string {
  for (const m of text.matchAll(EMAILS)) if (!NOT_ACCOUNT.test(m[0])) return m[0].toLowerCase()
  return ''
}

const NAME_LINE = /^[\p{L}][\p{L}\p{M}' .-]{0,58}[\p{L}.]$/u
const NOT_NAME = /^(?:google(?: account)?|home|account|personal info|welcome|hi|sign in|signed in|manage your google account)$/i

/** The account's name on a Google account page: the line just above the email ("Hunter Zhang\nhunter@x.org"). */
export function accountPageName(text: string, email: string): string {
  if (!email) return ''
  const lines = text.split('\n').map(l => l.trim())
  const i = lines.findIndex(l => l.toLowerCase().includes(email.toLowerCase()))
  if (i <= 0) return ''
  let j = i - 1
  while (j >= 0 && !lines[j]) j--
  const n = j >= 0 ? lines[j]!.replace(/^Welcome,\s*/i, '') : ''
  return NAME_LINE.test(n) && !NOT_NAME.test(n) && !EMAIL.test(n) ? n.slice(0, 60) : ''
}

/** A Gmail tab title's email: "Inbox (3) - a@b.c - Gmail", "Inbox - a@b.c - Protocol VR Mail". */
export function gmailTitleEmail(title: string): string {
  const m = new RegExp(`(${EMAIL.source}) - [^"\\n]*?\\b(?:Gmail|Mail)\\b`).exec(title)
  return m ? m[1]!.toLowerCase() : ''
}

/** Tabs from a tabs_context result: tabId -> url, and the Gmail email from tab titles (an inbox at /u/0 first). */
export function parseTabs(text: string): { tabs: Record<string, string>; gmail: string } {
  const tabs: Record<string, string> = {}
  const mails: { email: string; first: boolean }[] = []
  for (const j of jsonParts(text)) {
    const list = (j as { availableTabs?: unknown })?.availableTabs
    if (!Array.isArray(list)) continue
    for (const t of list) {
      const o = (t ?? {}) as Record<string, unknown>
      const id = typeof o.tabId === 'number' || typeof o.tabId === 'string' ? String(o.tabId) : ''
      const url = str(o.url)
      if (id && /^https?:\/\//.test(url)) tabs[id] = url.slice(0, 300)
      const email = /mail\.google\.com/.test(url) || !url ? gmailTitleEmail(str(o.title)) : ''
      if (email) mails.push({ email, first: !/\/mail\/u\/[1-9]/.test(url) })
    }
  }
  const gmail = (mails.find(m => m.first) ?? mails[0])?.email ?? gmailTitleEmail(text)
  return { tabs, gmail }
}

/** One call's effect on the session's state, and an email seen for the browser in use. */
export function applyCall(prev: ChromeState, tool: string, input: Record<string, unknown>, text: string, now: number): { state: ChromeState; email: string; from: ChromeAccount['from'] | ''; name?: string } {
  const s: ChromeState = { ...prev, browsers: [...prev.browsers], tabs: { ...prev.tabs }, lastUseAt: now }
  const name = tool.startsWith(CHROME_PREFIX) ? tool.slice(CHROME_PREFIX.length) : tool
  let email = ''
  let from: ChromeAccount['from'] | '' = ''
  if (/Browser extension is not connected|No browsers? (?:are )?connected/i.test(text)) { s.connected = false; return { state: s, email, from } }
  // A batch: each action's input, then the whole result text.
  const steps = name === 'browser_batch' && Array.isArray(input.actions)
    ? (input.actions as unknown[]).map(a => ({ name: str((a as { name?: unknown })?.name), input: ((a as { input?: unknown })?.input ?? {}) as Record<string, unknown> }))
    : [{ name, input }]
  let onAccountPage = false
  for (const st of steps) {
    const url = str(st.input.url)
    const tabId = st.input.tabId !== undefined ? String(st.input.tabId) : ''
    if (st.name === 'navigate' && url) {
      if (tabId) s.tabs[tabId] = url.slice(0, 300)
      if (ACCOUNT_HOST.test(url)) onAccountPage = true
    }
    if (['get_page_text', 'read_page', 'find'].includes(st.name) && tabId && ACCOUNT_HOST.test(s.tabs[tabId] ?? '')) onAccountPage = true
    if (st.name === 'select_browser' && str(st.input.deviceId)) {
      const id = clean(str(st.input.deviceId))
      if (id !== s.inUse) delete s.email
      s.inUse = id
    }
  }
  if (name === 'list_connected_browsers') {
    const list = parseBrowsers(text)
    if (list) {
      s.browsers = list
      s.connected = list.length > 0
      const using = list.find(b => b.inUse)
      if (using) s.inUse = using.deviceId
      else if (!list.some(b => b.deviceId === s.inUse)) s.inUse = list.length === 1 ? list[0]!.deviceId : ''
      if (s.inUse) delete s.inUseName
    }
    return { state: s, email, from }
  }
  if (name === 'switch_browser' || name === 'select_browser') {
    const picked = /Connected to browser "([^"]+)"/.exec(text)?.[1]
    const b = picked ? s.browsers.find(x => x.name === picked) : undefined
    if (b && b.deviceId !== s.inUse) delete s.email
    if (b) s.inUse = b.deviceId
    s.browsers = s.browsers.map(x => ({ ...x, inUse: x.deviceId === s.inUse || undefined }))
  }
  s.connected = true
  // The page itself says where it is: its URL near the top of a navigate or page-text result.
  if (ACCOUNT_HOST.test((/https?:\/\/\S+/.exec(text.slice(0, 400))?.[0] ?? ''))) onAccountPage = true
  const { tabs, gmail } = parseTabs(text)
  Object.assign(s.tabs, tabs)
  const ids = Object.keys(s.tabs)
  if (ids.length > 50) for (const k of ids.slice(0, ids.length - 50)) delete s.tabs[k]
  const acct = onAccountPage ? accountPageEmail(text) : ''
  if (acct) { email = acct; from = 'account' } else if (gmail) { email = gmail; from = 'gmail' }
  if (email) s.email = email
  if (s.inUse) delete s.inUseName
  const who = acct ? accountPageName(text, acct) : ''
  return who ? { state: s, email, from, name: who } : { state: s, email, from }
}

export type ChromeCommand = { name: string } | { connected: false }

const CMD_OUT = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/
const CMD_SWITCHED = /^Now using browser "(.+)" for Chrome actions\.$/
const CMD_OFF = /^(?:Couldn't list connected browsers|No browsers are connected|Chrome can't be reached)|extension (?:is )?not (?:detected|connected|installed)/i

/** /chrome's output: the browser picked, or not connected. null for any other text. Tags are required unless `bare`. */
export function parseChromeCommand(text: string, bare = false): ChromeCommand | null {
  const t = text.trim()
  const inner = CMD_OUT.exec(t)?.[1]?.trim() ?? (bare ? t : '')
  if (!inner) return null
  const name = CMD_SWITCHED.exec(inner)?.[1]
  if (name) return { name: clean(name) }
  return CMD_OFF.test(inner) ? { connected: false } : null
}

/** The newest /chrome output row in transcript lines (JSONL): only a user row whose whole content is the output. */
export function lastChromeCommand(jsonl: string): (ChromeCommand & { at: number }) | null {
  const lines = jsonl.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!
    if (!l.includes('local-command-stdout>') || !l.includes('rowser')) continue
    try {
      const j = JSON.parse(l) as { type?: unknown; message?: { content?: unknown }; timestamp?: unknown }
      if (j.type !== 'user' || typeof j.message?.content !== 'string') continue
      const cmd = parseChromeCommand(j.message.content)
      const at = Date.parse(str(j.timestamp))
      if (cmd && Number.isFinite(at)) return { ...cmd, at }
    } catch { /* a cut line */ }
  }
  return null
}

/** A /chrome switch: the named browser from the last list, else that name with no deviceId and no account. */
export function applySwitch(prev: ChromeState, cmd: ChromeCommand, at: number): ChromeState {
  const s: ChromeState = { ...prev, browsers: [...prev.browsers], tabs: { ...prev.tabs }, lastUseAt: Math.max(prev.lastUseAt, at), switchAt: at }
  if (!('name' in cmd)) { s.connected = false; return s }
  const b = s.browsers.find(x => x.name === cmd.name)
  if (b?.deviceId !== prev.inUse) delete s.email
  s.inUse = b?.deviceId ?? ''
  if (b) delete s.inUseName
  else s.inUseName = cmd.name
  s.connected = true
  s.browsers = s.browsers.map(x => ({ ...x, inUse: x.deviceId === s.inUse || undefined }))
  return s
}

/** chrome-local-accounts.txt: one email per line, # comments, lowercased. */
export function parseLocalAccounts(text: string): string[] {
  const out: string[] = []
  for (const l of text.split('\n')) {
    const e = l.replace(/#.*/, '').trim().toLowerCase()
    if (e && new RegExp(`^${EMAIL.source}$`).test(e) && !out.includes(e)) out.push(e)
  }
  return out
}

/** This machine's accounts: Local State's and the file's, merged. null when neither is there. */
export function mergeLocal(localState: string[] | null, file: string[] | null): string[] | null {
  if (!localState && !file) return null
  return [...new Set([...(localState ?? []), ...(file ?? [])])]
}

/** Saves an email for a browser. A Gmail title never replaces an account page's email seen in the last day. */
export function mergeAccount(acc: ChromeAccounts, deviceId: string, email: string, from: ChromeAccount['from'], now: number, name = ''): ChromeAccounts {
  if (!deviceId || !email) return acc
  const old = acc[deviceId]
  if (old && from === 'gmail' && old.from === 'account' && old.email !== email && now - old.seenAt < 86_400_000) return acc
  // The name stays while the email is the same (a Gmail title has none).
  const keep = name || (old?.email === email ? old.name : '')
  return { ...acc, [deviceId]: keep ? { email, seenAt: now, from, name: keep } : { email, seenAt: now, from } }
}

/** "Hunter Zhang (hunter@x.org)" when the name is known, else the email. '' when neither. */
export function accountLabel(a: ChromeAccount | undefined, email = ''): string {
  const e = a?.email || email
  if (!e) return ''
  return a?.name && a.email === e ? `${a.name} (${e})` : e
}

/** The prompt the Check account button submits. `back` is the deviceId to return to when checking another browser. */
export function checkPrompt(name: string, deviceId: string, back?: string): string {
  const who = `Chrome browser "${name}"${deviceId ? ` (${deviceId})` : ''}`
  if (back === undefined) return `Check which Google account ${who} is signed in to: open ${ACCOUNT_URL} in a new tab with Claude in Chrome, read the email and name, then close the tab.`
  return `Check which Google account ${who} is signed in to: select_browser to deviceId ${deviceId}, open ${ACCOUNT_URL} in a new tab with Claude in Chrome, read the email and name, close the tab, then select_browser back to ${back ? `deviceId ${back}` : 'the browser that was in use'}.`
}

/** chrome-checks.json: check key -> pressedAt. Only checks pressed in the last CHECK_PENDING_MS are kept. */
export function parseChecks(text: string, now: number): Record<string, number> {
  try {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries((JSON.parse(text) ?? {}) as Record<string, unknown>)) if (typeof v === 'number' && now - v < CHECK_PENDING_MS && v <= now + 60_000) out[k] = v
    return out
  } catch { return {} }
}

/** Chrome's Local State: the Google accounts signed in to Chrome profiles on this machine. Nothing else is kept. */
export function parseLocalState(text: string): { name: string; email: string }[] {
  try {
    const cache = (JSON.parse(text) as { profile?: { info_cache?: Record<string, Record<string, unknown>> } })?.profile?.info_cache ?? {}
    return Object.values(cache).flatMap(p => {
      const email = str(p?.user_name).trim().toLowerCase()
      return EMAIL.test(email) ? [{ name: clean(str(p?.gaia_name) || str(p?.name)), email }] : []
    })
  } catch { return [] }
}

export function parseState(text: string): ChromeState {
  try {
    const j = JSON.parse(text) as Partial<ChromeState>
    return { ...EMPTY_STATE, ...j, browsers: Array.isArray(j.browsers) ? j.browsers : [], tabs: j.tabs && typeof j.tabs === 'object' ? j.tabs : {} }
  } catch { return { ...EMPTY_STATE } }
}

export function parseAccountsFile(text: string): ChromeAccounts {
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const out: ChromeAccounts = {}
    for (const [k, v] of Object.entries(j ?? {})) {
      const o = (v ?? {}) as Record<string, unknown>
      if (!EMAIL.test(str(o.email))) continue
      out[k] = { email: str(o.email), seenAt: Number(o.seenAt) || 0, from: o.from === 'gmail' ? 'gmail' : 'account' }
      if (str(o.name)) out[k]!.name = clean(str(o.name)).slice(0, 60)
    }
    return out
  } catch { return {} }
}

/**
 * What the panel shows. `local` is null when Chrome's Local State could not be read (no Chrome profile list, so no
 * email check). `expected` is the project's chromeAccount, '' when none is set.
 */
export function chromeView(s: ChromeState, acc: ChromeAccounts, local: string[] | null, expected = '', here = 'this Mac', pending: Record<string, number> = {}): ChromeView {
  if (!s.lastUseAt || s.connected === false || (s.connected === null && !s.inUse)) return { ...EMPTY_VIEW, usedAt: s.lastUseAt }
  const b = s.browsers.find(x => x.deviceId === s.inUse)
  const name = b?.name || s.inUseName || (s.inUse ? 'Browser' : 'browser')
  const email = (s.inUse ? acc[s.inUse]?.email : '') || s.email || ''
  const lower = email.toLowerCase()
  const knownHere = !!email && !!local?.length && local.includes(lower)
  const away = b?.onThisComputer === false || (!!email && !!local?.length && !knownHere)
  const where = b?.onThisComputer === true || knownHere ? here : away ? 'other computer' : ''
  const line = ['Chrome: ' + name, accountLabel(s.inUse ? acc[s.inUse] : undefined, email) || 'account unknown', where].filter(Boolean).join(' · ')
  const exp = expected.trim().toLowerCase()
  const warn = b?.onThisComputer === false && !email
    ? `Chrome is controlling ${name}, which is on another computer. Run /chrome to switch.`
    : away
      ? `Chrome is controlling ${email}, which isn't signed in on ${here}. Run /chrome to switch.`
      : exp && email && lower !== exp
        ? `Chrome is using ${email}, not ${exp} for this project. Run /chrome to switch.`
        : ''
  const rest = s.browsers.filter(x => x.deviceId !== s.inUse)
  const others = rest.map(x => [x.name, accountLabel(acc[x.deviceId]) || 'account unknown'].join(' · '))
  // Check account buttons: for the browser in use and each other browser with no account, unless pressed lately.
  const key = s.inUse || 'in-use'
  const check = !email && !pending[key] ? { key, prompt: checkPrompt(name, s.inUse) } : null
  const otherChecks = rest.map(x => (acc[x.deviceId]?.email || pending[x.deviceId] ? null : { key: x.deviceId, prompt: checkPrompt(x.name, x.deviceId, s.inUse) }))
  return { line, tone: warn ? 'warn' : 'ok', warn, usedAt: s.lastUseAt, others, check, otherChecks }
}

async function readText($: EngineInterface, path: string): Promise<string> {
  try { return String(await $.fs.read(path)) } catch { return '' }
}

/** After a Chrome tool call: the session's state and the shared accounts file, each read and merged before writing. */
export async function recordChromeCall($: EngineInterface, h: string, key: string, tool: string, input: Record<string, unknown>, result: unknown) {
  if (!h || !key) return
  const now = await $.clock.now()
  const file = `${h}/${chromeStateRel(key)}`
  const prev = parseState(await readText($, file))
  const { state, email, from, name } = applyCall(prev, tool, input, resultText(result), now)
  await $.fs.write(file, JSON.stringify(state))
  const device = state.inUse || (state.browsers.length === 1 ? state.browsers[0]!.deviceId : '')
  if (email && from && device) {
    const af = `${h}/${CHROME_ACCOUNTS_REL}`
    const acc = parseAccountsFile(await readText($, af))
    const next = mergeAccount(acc, device, email, from, now, name)
    if (next !== acc) await $.fs.write(af, JSON.stringify(next))
  }
}

/** A /chrome output row seen as it is stored (session.append): applied to the session's state now. */
export async function recordChromeCommand($: EngineInterface, h: string, key: string, cmd: ChromeCommand) {
  if (!h || !key) return
  const file = `${h}/${chromeStateRel(key)}`
  await $.fs.write(file, JSON.stringify(applySwitch(parseState(await readText($, file)), cmd, await $.clock.now())))
}

// How far each transcript was read: only its new bytes are read again, and nothing when its size is the same.
const txRead = new Map<string, number>()

/** The transcript's new lines: the newest /chrome switch, when it is newer than the session's last Chrome action. */
async function switchFromTranscript($: EngineInterface, h: string, key: string, tx: string) {
  let size = 0
  try { const st = await $.fs.stat(tx); if (st.kind !== 'file') return; size = st.size } catch { return }
  const seen = txRead.get(tx) ?? 0
  if (size === seen) return
  const from = Math.max(seen < size ? seen : 0, size - TX_TAIL)
  let text = ''
  try { text = String((await $.process.run(['tail', '-c', `+${from + 1}`, tx], { timeoutMs: 5000 })).stdout ?? '') } catch { return }
  const end = text.lastIndexOf('\n')
  if (end < 0) return
  txRead.set(tx, from + new TextEncoder().encode(text.slice(0, end + 1)).length)
  const cmd = lastChromeCommand(text.slice(0, end))
  if (!cmd) return
  const file = `${h}/${chromeStateRel(key)}`
  const state = parseState(await readText($, file))
  if (cmd.at <= (state.switchAt ?? 0) || cmd.at < state.lastUseAt) return
  await $.fs.write(file, JSON.stringify(applySwitch(state, cmd, cmd.at)))
}

let localAt = 0
let localEmails: string[] | null = null
let onMac = false
/** Tests: read Local State again on the next poll. */
export function forgetLocalState() { localAt = 0; localEmails = null; onMac = false; txRead.clear() }

/**
 * The panel's poll: the session's Chrome state into the atom. Chrome's Local State is read at most every 5 minutes,
 * chrome-local-accounts.txt every poll. `tx` is the session transcript, read for /chrome switches.
 */
export async function readChrome($: EngineInterface, h: string, key: string, projectSlug = '', tx = '') {
  if (!h || !key) return
  const now = await $.clock.now()
  if (now - localAt >= LOCAL_EVERY) {
    localAt = now
    const text = await readText($, `${h}/${CHROME_LOCAL_STATE_REL}`)
    localEmails = text ? parseLocalState(text).map(p => p.email) : null
    onMac = !!localEmails || await isDarwin($)
  }
  if (tx) await switchFromTranscript($, h, key, tx).catch(() => undefined)
  let file: string[] | null = null
  try { file = parseLocalAccounts(String(await $.fs.read(`${h}/${CHROME_LOCAL_ACCOUNTS_REL}`))) } catch { file = null }
  const local = mergeLocal(localEmails, file)
  const state = parseState(await readText($, `${h}/${chromeStateRel(key)}`))
  const acc = parseAccountsFile(await readText($, `${h}/${CHROME_ACCOUNTS_REL}`))
  let expected = ''
  if (projectSlug) {
    try { expected = str((JSON.parse(await readText($, `${h}/.claude-progress/goals/${projectSlug}.json`)) as { chromeAccount?: unknown })?.chromeAccount) } catch { expected = '' }
  }
  const checks = parseChecks(await readText($, `${h}/${CHROME_CHECKS_REL}`), now)
  const view: ChromeView = { ...chromeView(state, acc, local, EMAIL.test(expected) ? expected : '', onMac ? 'this Mac' : 'this computer', checks), hint: local ? '' : LOCAL_ACCOUNTS_HINT }
  if (JSON.stringify(await read($, chromeAtom)) !== JSON.stringify(view)) await update($, chromeAtom, () => view)
}

/**
 * The Check account button: marks the check pending (its button hides for CHECK_PENDING_MS), hides it in the panel
 * now, then submits the prompt to this session, as autonext does. Claude reads the account page with Claude in Chrome
 * and the tool.call hook records the email and name.
 */
export async function startAccountCheck($: EngineInterface, h: string, check: ChromeCheck) {
  if (!h || !check.prompt) return
  const now = await $.clock.now()
  const file = `${h}/${CHROME_CHECKS_REL}`
  const checks = { ...parseChecks(await readText($, file), now), [check.key]: now }
  await $.fs.write(file, JSON.stringify(checks))
  await update($, chromeAtom, v => ({ ...v, check: v.check?.key === check.key ? null : v.check, otherChecks: (v.otherChecks ?? []).map(c => (c?.key === check.key ? null : c)) }))
  void $.prompt.submit({ text: check.prompt })
}
