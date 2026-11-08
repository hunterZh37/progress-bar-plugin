import { expect, test } from 'claude-code/testing'

import { EMPTY_STATE, accountPageEmail, applyCall, chromeView, gmailTitleEmail, mergeAccount, parseAccountsFile, parseBrowsers, parseLocalState, parseState, parseTabs, resultText } from '../hooks/chrome'

const NOW = 1_800_000_000_000
const B1 = '9038508d-6835-4fe2-a0d2-abf34f5d61b1'
const B2 = '951dff16-ed25-45bc-87af-8710e52e685f'
const LIST = `[{"deviceId":"${B1}","name":"Browser 1","osPlatform":"macOS","connectedAt":1791912630160,"isLocal":true},{"deviceId":"${B2}","name":"Browser 2","osPlatform":"macOS","connectedAt":1791908074862,"isLocal":true,"inUse":true}]`
const P = 'mcp__claude-in-chrome__'

test('resultText: strings, MCP content blocks and {content}', () => {
  expect(resultText('a')).toBe('a')
  expect(resultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  expect(resultText({ content: [{ type: 'text', text: 'x' }] })).toBe('x')
  expect(resultText(undefined)).toBe('')
})

test('parseBrowsers: each browser from list_connected_browsers, a trailing note ignored', () => {
  const list = parseBrowsers(`${LIST}\n2 browsers are connected; "Browser 2" (deviceId ${B2}) is the one in use.`)!
  expect(list.length).toBe(2)
  expect(list[1]).toEqual({ deviceId: B2, name: 'Browser 2', osPlatform: 'macOS', isLocal: true, inUse: true, connectedAt: 1791908074862 })
  expect(list[0]!.inUse).toBeUndefined()
  expect(parseBrowsers(`[{"deviceId":"d","name":"Mac","onThisComputer":false}]`)![0]!.onThisComputer).toBe(false)
  expect(parseBrowsers('[]')).toEqual([])
  expect(parseBrowsers('Connected to browser "Browser 1".')).toBeNull()
})

test('accountPageEmail: the signed-in email on an account page, not Google addresses', () => {
  expect(accountPageEmail('Google Account\nHunter Zhang\nhunter@protocolvr.com\nHome')).toBe('hunter@protocolvr.com')
  expect(accountPageEmail('Contact privacy@google.com\nHunter Zhang\nHunter@IoG.org')).toBe('hunter@iog.org')
  expect(accountPageEmail('no email here')).toBe('')
})

test('gmailTitleEmail and parseTabs: the email from a Gmail tab title, /u/0 first', () => {
  expect(gmailTitleEmail('Inbox (3) - hunter@protocolvr.com - Gmail')).toBe('hunter@protocolvr.com')
  expect(gmailTitleEmail('Inbox - hunter@instituteongenerosity.org - Institute on Generosity Mail')).toBe('hunter@instituteongenerosity.org')
  expect(gmailTitleEmail('My Drive - Google Drive')).toBe('')
  const t = parseTabs(JSON.stringify({ availableTabs: [
    { tabId: 1, title: 'Inbox - b@x.org - Gmail', url: 'https://mail.google.com/mail/u/1/#inbox' },
    { tabId: 2, title: 'Inbox - a@x.org - Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' },
    { tabId: 3, title: 'New Tab', url: 'chrome://newtab/' },
  ] }))
  expect(t.gmail).toBe('a@x.org')
  expect(t.tabs).toEqual({ 1: 'https://mail.google.com/mail/u/1/#inbox', 2: 'https://mail.google.com/mail/u/0/#inbox' })
})

test('applyCall: the browser in use from a list, select_browser and switch_browser', () => {
  let s = applyCall(EMPTY_STATE, `${P}list_connected_browsers`, {}, LIST, NOW).state
  expect(s.inUse).toBe(B2)
  expect(s.connected).toBe(true)
  expect(s.lastUseAt).toBe(NOW)
  s = applyCall(s, `${P}select_browser`, { deviceId: B1 }, 'Connected to browser "Browser 1".', NOW).state
  expect(s.inUse).toBe(B1)
  s = applyCall(s, `${P}switch_browser`, {}, 'Connected to browser "Browser 2".', NOW).state
  expect(s.inUse).toBe(B2)
  expect(applyCall(s, `${P}tabs_context_mcp`, {}, 'Browser extension is not connected. Please ensure...', NOW).state.connected).toBe(false)
  expect(applyCall(s, `${P}list_connected_browsers`, {}, '[]', NOW).state.connected).toBe(false)
})

test('applyCall: an email only from an account page or a Gmail title', () => {
  const base = applyCall(EMPTY_STATE, `${P}list_connected_browsers`, {}, LIST, NOW).state
  // navigate to the account page, then read it by tab id
  const nav = applyCall(base, `${P}navigate`, { tabId: 7, url: 'https://myaccount.google.com/' }, 'Navigated.', NOW)
  expect(nav.state.tabs['7']).toBe('https://myaccount.google.com/')
  const read = applyCall(nav.state, `${P}get_page_text`, { tabId: 7 }, 'Hunter Zhang\nhunter@protocolvr.com', NOW)
  expect(read.email).toBe('hunter@protocolvr.com')
  expect(read.from).toBe('account')
  // an email on any other page is not the account
  const other = applyCall(base, `${P}get_page_text`, { tabId: 8 }, 'Contact bob@acme.com', NOW)
  expect(other.email).toBe('')
  // a batch that navigates to accounts.google.com and reads it
  const batch = applyCall(base, `${P}browser_batch`, { actions: [{ name: 'navigate', input: { tabId: 9, url: 'https://accounts.google.com/SignOutOptions' } }, { name: 'get_page_text', input: { tabId: 9 } }] }, 'Hunter Zhang\nhunter@iog.org', NOW)
  expect(batch.email).toBe('hunter@iog.org')
  const tabs = applyCall(base, `${P}tabs_context_mcp`, {}, JSON.stringify({ availableTabs: [{ tabId: 1, title: 'Inbox - a@x.org - Gmail', url: 'https://mail.google.com/mail/u/0/' }] }), NOW)
  expect(tabs.email).toBe('a@x.org')
  expect(tabs.from).toBe('gmail')
})

test('mergeAccount: an account page beats a Gmail title for a day', () => {
  const a = mergeAccount({}, B2, 'a@x.org', 'account', NOW)
  expect(mergeAccount(a, B2, 'b@x.org', 'gmail', NOW + 1000)).toBe(a)
  expect(mergeAccount(a, B2, 'b@x.org', 'gmail', NOW + 2 * 86_400_000)[B2]!.email).toBe('b@x.org')
  expect(mergeAccount(a, B2, 'c@x.org', 'account', NOW + 1000)[B2]!.email).toBe('c@x.org')
  expect(parseAccountsFile(JSON.stringify(a))).toEqual(a)
  expect(parseAccountsFile('garbage')).toEqual({})
  expect(parseState('garbage')).toEqual(EMPTY_STATE)
})

test('parseLocalState: the emails of Chrome profiles, nothing else', () => {
  const ls = JSON.stringify({ os_crypt: { encrypted_key: 'SECRET' }, profile: { info_cache: {
    Default: { name: 'Person 1', user_name: 'Hunter@IoG.org', gaia_name: 'Hunter Zhang' },
    'Profile 2': { name: 'Work', user_name: '' },
  } } })
  expect(parseLocalState(ls)).toEqual([{ name: 'Hunter Zhang', email: 'hunter@iog.org' }])
  expect(JSON.stringify(parseLocalState(ls))).not.toContain('SECRET')
  expect(parseLocalState('')).toEqual([])
})

test('chromeView: the line, and a warning when the browser is not on this Mac or the account is not expected', () => {
  const s = applyCall(EMPTY_STATE, `${P}list_connected_browsers`, {}, LIST, NOW).state
  const acc = { [B2]: { email: 'hunter@protocolvr.com', seenAt: NOW, from: 'account' as const } }
  expect(chromeView(EMPTY_STATE, {}, null).line).toBe('Chrome: not connected')
  expect(chromeView(EMPTY_STATE, {}, null).tone).toBe('dim')
  const away = chromeView(s, acc, ['hunter@iog.org'])
  expect(away.line).toBe('Chrome: Browser 2 · hunter@protocolvr.com · other computer')
  expect(away.warn).toBe("Chrome is controlling hunter@protocolvr.com, which isn't signed in on this Mac. Run /chrome to switch.")
  expect(away.others).toEqual(['Browser 1 · account unknown'])
  const here = chromeView(s, acc, ['hunter@protocolvr.com'])
  expect(here.line).toBe('Chrome: Browser 2 · hunter@protocolvr.com · this Mac')
  expect(here.warn).toBe('')
  expect(chromeView(s, {}, ['hunter@iog.org']).line).toBe('Chrome: Browser 2 · account unknown')
  expect(chromeView(s, {}, ['hunter@iog.org']).warn).toBe('')
  // no Local State (Linux): no email check
  expect(chromeView(s, acc, null).warn).toBe('')
  // the browser says it is elsewhere
  const off = { ...s, browsers: s.browsers.map(b => ({ ...b, onThisComputer: false })) }
  expect(chromeView(off, {}, null).warn).toBe('Chrome is controlling Browser 2, which is on another computer. Run /chrome to switch.')
  // the project expects another account
  expect(chromeView(s, acc, ['hunter@protocolvr.com'], 'hunter@instituteongenerosity.org').warn).toBe('Chrome is using hunter@protocolvr.com, not hunter@instituteongenerosity.org for this project. Run /chrome to switch.')
  expect(chromeView(s, acc, ['hunter@protocolvr.com'], 'Hunter@ProtocolVR.com').warn).toBe('')
  // UI copy rules: no semicolons or em dashes
  for (const v of [away, here]) expect(`${v.line}${v.warn}`.match(/[;—]/)).toBeNull()
})
