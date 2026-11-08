import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ChromeView } from '../types'

// Which Chrome browser Claude in Chrome drives, under which Google account, and whether it is on this Mac.
// Nothing is asked of Chrome: the plugin reads the results of the session's own mcp__claude-in-chrome__* calls.
//   list_connected_browsers: each browser's deviceId, name, osPlatform, isLocal, onThisComputer, inUse, connectedAt.
//   select_browser (input deviceId), switch_browser ('Connected to browser "X"'): the browser in use.
//   A page on accounts.google.com or myaccount.google.com, or a Gmail tab title ("Inbox - a@b.c - Gmail"): its email.
// Per session: ~/.claude-progress/.state/chrome-<session>.json. Shared by all sessions, so one sighting serves every
// session: ~/.claude-progress/.state/chrome-accounts.json, deviceId -> {email, seenAt, from}.
// The Google accounts signed in to Chrome on this Mac come from Chrome's "Local State" file (profile.info_cache),
// read only, and only the names and emails are kept. Missing on Linux: then no email check is made.
// A project can name the account it expects: "chromeAccount" in ~/.claude-progress/goals/<slug>.json. Off by default.

export const CHROME_PREFIX = 'mcp__claude-in-chrome__'
export const chromeStateRel = (key: string) => `.claude-progress/.state/chrome-${key}.json`
export const CHROME_ACCOUNTS_REL = '.claude-progress/.state/chrome-accounts.json'
export const CHROME_LOCAL_STATE_REL = 'Library/Application Support/Google/Chrome/Local State'
const LOCAL_EVERY = 5 * 60_000

export type ChromeBrowser = { deviceId: string; name: string; osPlatform?: string; isLocal?: boolean; onThisComputer?: boolean; inUse?: boolean; connectedAt?: number }
export type ChromeState = { browsers: ChromeBrowser[]; inUse: string; connected: boolean | null; lastUseAt: number; email?: string; tabs: Record<string, string> }
export type ChromeAccount = { email: string; seenAt: number; from: 'account' | 'gmail' }
export type ChromeAccounts = Record<string, ChromeAccount>

export const EMPTY_STATE: ChromeState = { browsers: [], inUse: '', connected: null, lastUseAt: 0, tabs: {} }
export const EMPTY_VIEW: ChromeView = { line: 'Chrome: not connected', tone: 'dim', warn: '', usedAt: 0, others: [] }

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
export function applyCall(prev: ChromeState, tool: string, input: Record<string, unknown>, text: string, now: number): { state: ChromeState; email: string; from: ChromeAccount['from'] | '' } {
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
    if (st.name === 'select_browser' && str(st.input.deviceId)) s.inUse = clean(str(st.input.deviceId))
  }
  if (name === 'list_connected_browsers') {
    const list = parseBrowsers(text)
    if (list) {
      s.browsers = list
      s.connected = list.length > 0
      const using = list.find(b => b.inUse)
      if (using) s.inUse = using.deviceId
      else if (!list.some(b => b.deviceId === s.inUse)) s.inUse = list.length === 1 ? list[0]!.deviceId : ''
    }
    return { state: s, email, from }
  }
  if (name === 'switch_browser' || name === 'select_browser') {
    const picked = /Connected to browser "([^"]+)"/.exec(text)?.[1]
    const b = picked ? s.browsers.find(x => x.name === picked) : undefined
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
  return { state: s, email, from }
}

/** Saves an email for a browser. A Gmail title never replaces an account page's email seen in the last day. */
export function mergeAccount(acc: ChromeAccounts, deviceId: string, email: string, from: ChromeAccount['from'], now: number): ChromeAccounts {
  if (!deviceId || !email) return acc
  const old = acc[deviceId]
  if (old && from === 'gmail' && old.from === 'account' && old.email !== email && now - old.seenAt < 86_400_000) return acc
  return { ...acc, [deviceId]: { email, seenAt: now, from } }
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
      if (EMAIL.test(str(o.email))) out[k] = { email: str(o.email), seenAt: Number(o.seenAt) || 0, from: o.from === 'gmail' ? 'gmail' : 'account' }
    }
    return out
  } catch { return {} }
}

/**
 * What the panel shows. `local` is null when Chrome's Local State could not be read (no Chrome profile list, so no
 * email check). `expected` is the project's chromeAccount, '' when none is set.
 */
export function chromeView(s: ChromeState, acc: ChromeAccounts, local: string[] | null, expected = '', here = 'this Mac'): ChromeView {
  if (!s.lastUseAt || s.connected === false || (s.connected === null && !s.inUse)) return { ...EMPTY_VIEW, usedAt: s.lastUseAt }
  const b = s.browsers.find(x => x.deviceId === s.inUse)
  const name = b?.name || (s.inUse ? 'Browser' : 'browser')
  const email = (s.inUse ? acc[s.inUse]?.email : '') || s.email || ''
  const lower = email.toLowerCase()
  const knownHere = !!email && !!local?.length && local.includes(lower)
  const away = b?.onThisComputer === false || (!!email && !!local?.length && !knownHere)
  const where = b?.onThisComputer === true || knownHere ? here : away ? 'other computer' : ''
  const line = ['Chrome: ' + name, email || 'account unknown', where].filter(Boolean).join(' · ')
  const exp = expected.trim().toLowerCase()
  const warn = b?.onThisComputer === false && !email
    ? `Chrome is controlling ${name}, which is on another computer. Run /chrome to switch.`
    : away
      ? `Chrome is controlling ${email}, which isn't signed in on ${here}. Run /chrome to switch.`
      : exp && email && lower !== exp
        ? `Chrome is using ${email}, not ${exp} for this project. Run /chrome to switch.`
        : ''
  const others = s.browsers.filter(x => x.deviceId !== s.inUse).map(x => [x.name, acc[x.deviceId]?.email || 'account unknown'].join(' · '))
  return { line, tone: warn ? 'warn' : 'ok', warn, usedAt: s.lastUseAt, others }
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
  const { state, email, from } = applyCall(prev, tool, input, resultText(result), now)
  await $.fs.write(file, JSON.stringify(state))
  const device = state.inUse || (state.browsers.length === 1 ? state.browsers[0]!.deviceId : '')
  if (email && from && device) {
    const af = `${h}/${CHROME_ACCOUNTS_REL}`
    const acc = parseAccountsFile(await readText($, af))
    const next = mergeAccount(acc, device, email, from, now)
    if (next !== acc) await $.fs.write(af, JSON.stringify(next))
  }
}

let localAt = 0
let localEmails: string[] | null = null

/** The panel's poll: the session's Chrome state into the atom. Chrome's Local State is read at most every 5 minutes. */
export async function readChrome($: EngineInterface, h: string, key: string, projectSlug = '') {
  if (!h || !key) return
  const now = await $.clock.now()
  if (now - localAt >= LOCAL_EVERY) {
    localAt = now
    const text = await readText($, `${h}/${CHROME_LOCAL_STATE_REL}`)
    localEmails = text ? parseLocalState(text).map(p => p.email) : null
  }
  const state = parseState(await readText($, `${h}/${chromeStateRel(key)}`))
  const acc = parseAccountsFile(await readText($, `${h}/${CHROME_ACCOUNTS_REL}`))
  let expected = ''
  if (projectSlug) {
    try { expected = str((JSON.parse(await readText($, `${h}/.claude-progress/goals/${projectSlug}.json`)) as { chromeAccount?: unknown })?.chromeAccount) } catch { expected = '' }
  }
  const view = chromeView(state, acc, localEmails, EMAIL.test(expected) ? expected : '', localEmails ? 'this Mac' : 'this computer')
  if (JSON.stringify(await read($, chromeAtom)) !== JSON.stringify(view)) await update($, chromeAtom, () => view)
}
