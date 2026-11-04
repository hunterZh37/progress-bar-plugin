import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { channelList, isChatName, parseIndex, previewOf, sanitize } from '../hooks/chat'
import { PANE } from '../hooks/panel'
import { statusScript } from '../hooks/render'

const HOME = '/home/u'
const P = `${HOME}/.claude-progress`
const CH = `${P}/channel`
const SCRIPT = `${HOME}/.claude/progress-bar/statusline.sh`
const PANE_PROPS = { title: 'Status', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} }
const NOW = 1800000000
const LONG = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n')
const INDEX = JSON.stringify([
  // Out of order on purpose: the thread sorts by send time.
  { id: 'bbbb2222bbbb2222', channel: 'sam', dir: 'out', from: 'me-gh', filename: 'chat-20270115T080100Z-ab12.md', path: `${CH}/sam/sent/chat-20270115T080100Z-ab12.md`, size: 10, sent: NOW - 50 },
  { id: 'aaaa1111aaaa1111', channel: 'sam', dir: 'in', from: 'sam-gh', filename: 'chat-20270115T080000Z-cd34.md', path: `${CH}/sam/chat-20270115T080000Z-cd34.md`, size: 30, sent: NOW - 100 },
  { id: 'cccc3333cccc3333', channel: 'sam', dir: 'in', from: 'sam-gh', filename: 'plan.md', path: `${CH}/sam/plan.md`, size: 400, sent: NOW - 10 },
  { id: 'dddd4444dddd4444', channel: 'sam', dir: 'in', from: 'sam-gh', filename: 'pic.png', path: `${CH}/sam/pic.png`, size: 123_000, sent: NOW - 5 },
  { id: 'eeee5555eeee5555', channel: 'sam', dir: 'in', from: 'sam-gh', filename: 'evil.md', path: `${CH}/keys/enc.pem`, size: 1, sent: NOW - 1 },
])

function world(on: On, files: Record<string, string>) {
  const ran: string[][] = []
  mock.env(on, { HOME })
  on('fs.read', (_, e) => { const t = files[String(e.path)]; if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.write', (_, e) => { files[String(e.path)] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: String(e.path) in files }))
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: NOW * 1000 }))
  on('clock.every', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[0] === 'uname' ? 'Darwin' : e.argv.includes('say') ? `Sent chat-x.md to ${e.argv[e.argv.indexOf('say') + 1]} (sam-gh), end-to-end encrypted.` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.list', () => ({ value: [] as never }))
  on('settings.read', () => ({ value: {} as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__progress-bar__channel_send' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] as never }))
  return ran
}
function seed(): Record<string, string> {
  return {
    [SCRIPT]: statusScript(),
    [`${P}/.state/panel-on`]: 'on\n',
    [`${CH}/index.json`]: INDEX,
    [`${CH}/channels.json`]: JSON.stringify({ channels: { sam: {}, kim: {} } }),
    [`${CH}/received.json`]: '[]',
    [`${CH}/sam/chat-20270115T080000Z-cd34.md`]: 'hey \x1b[31mred\x1b[0m\x07 there\u202e\n',
    [`${CH}/sam/sent/chat-20270115T080100Z-ab12.md`]: 'hi sam\n',
    [`${CH}/sam/plan.md`]: LONG,
  }
}
async function mount($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
}
const texts = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')

test('sanitize strips ANSI, OSC links, control and bidi chars, keeps newlines, caps length', () => {
  expect(sanitize('a\x1b[31mb\x1b[0mc\x07d\u202ee\n f', 100)).toBe('abcde\n f')
  expect(sanitize('\x1b]8;;https://x.y\x07link\x1b]8;;\x07', 100)).toBe('link')
  expect(sanitize('abcdef', 4)).toBe('abc…')
  expect(previewOf('1\n2\n3\n4\n5', false)).toBe('1\n2\n3')
  expect(isChatName('chat-20270115T080000Z-cd34.md')).toBe(true)
  expect(isChatName('plan.md')).toBe(false)
})

test('parseIndex: oldest first, both directions, unsafe paths dropped, unread only for received', () => {
  const m = parseIndex(INDEX, new Set(['cccc3333cccc3333']), HOME)
  expect(m.map(x => x.id)).toEqual(['aaaa1111aaaa1111', 'bbbb2222bbbb2222', 'cccc3333cccc3333', 'dddd4444dddd4444'])
  expect(m.map(x => x.dir)).toEqual(['in', 'out', 'in', 'in'])
  expect(m.map(x => x.unread)).toEqual([true, false, false, true])
  expect(m[0]!.chat && m[1]!.chat && !m[2]!.chat).toBe(true)
  expect(parseIndex('nope', new Set(), HOME)).toEqual([])
  expect(channelList(JSON.stringify({ channels: { kim: {}, sam: {} } }), m)).toEqual(['sam', 'kim'])
})

test('Chat tab: badge, thread in order, received left with the name, sent as You, sanitized, viewing clears unread', async ($, on) => {
  const files = seed()
  world(on, files)
  const ui = await mount($)
  expect((await ui.find({ type: 'Button', key: 'tab-chat' }))?.text).toBe(' Chat 3')
  await ui.press({ key: 'tab-chat' })
  const t = await texts(ui)
  const heads = t.filter(x => / · (\w+ \d+ )?\d\d:\d\d/.test(x))
  expect(heads.map(x => x.split(' · ')[0])).toEqual(['sam-gh', 'You', 'sam-gh', 'sam-gh'])
  const bubble = (await ui.find({ type: 'Button', key: 'chm-aaaa1111aaaa1111' }))?.text ?? ''
  expect(bubble).toBe('hey red there')
  expect((await ui.find({ type: 'Button', key: 'chm-bbbb2222bbbb2222' }))?.text).toBe('hi sam')
  expect((await ui.find({ type: 'Button', key: 'chm-dddd4444dddd4444' }))?.text).toBe('📎 pic.png (120 KB)')
  expect(await ui.find({ type: 'Button', key: 'chm-eeee5555eeee5555' }).catch(() => undefined)).toBeUndefined()
  expect(t.some(x => x.includes('line 1\nline 2\nline 3'))).toBe(true)
  // Viewing the thread marked both received unread messages read.
  expect(files[`${P}/.state/channel-read.txt`]!.split('\n').filter(Boolean).sort()).toEqual(['aaaa1111aaaa1111', 'cccc3333cccc3333', 'dddd4444dddd4444'])
  expect((await ui.find({ type: 'Button', key: 'tab-chat' }))?.text).toBe('▌Chat')
  await ui.unmount()
})

test('Chat tab: a long text message expands inline in pages, an image opens with the default app', async ($, on) => {
  const files = seed()
  const ran = world(on, files)
  const ui = await mount($)
  await ui.press({ key: 'tab-chat' })
  await ui.press({ key: 'chm-cccc3333cccc3333' })
  let t = await texts(ui)
  expect(t.some(x => x.startsWith('line 1\n') && x.endsWith('line 30'))).toBe(true)
  expect(t).toContain('page 1 of 2  ')
  await ui.press({ key: 'chnx-cccc3333cccc3333' })
  t = await texts(ui)
  expect(t.some(x => x.startsWith('line 31\n') && x.endsWith('line 50'))).toBe(true)
  await ui.press({ key: 'chc-cccc3333cccc3333' })
  t = await texts(ui)
  expect(t).not.toContain('page 2 of 2  ')
  await ui.press({ key: 'chm-dddd4444dddd4444' })
  expect(ran.some(a => a[0] === 'open' && a[1] === `${CH}/sam/pic.png`)).toBe(true)
  // Received files are never run or piped anywhere: only `open <path>`.
  expect(ran.filter(a => a.some(x => x.includes('/sam/'))).every(a => a[0] === 'open' && a.length === 2)).toBe(true)
  await ui.unmount()
})

test('Chat tab: Enter in the field sends a say line to the selected channel, argv only', async ($, on) => {
  const files = seed()
  const ran = world(on, files)
  const ui = await mount($)
  await ui.press({ key: 'tab-chat' })
  await ui.input({ key: 'chat-in-sam-0', text: 'chat tab test; $(rm -rf ~)' })
  const say = ran.find(a => a.includes('say'))!
  expect(say[0]).toBe('python3')
  expect(say.slice(2)).toEqual(['say', 'sam', 'chat tab test; $(rm -rf ~)'])
  // The field renews (new key) after a send.
  expect(await ui.find({ key: 'chat-in-sam-1' })).toBeDefined()
  await ui.press({ key: 'chs-kim' })
  expect((await texts(ui))).toContain('  No messages yet. Say hi below.')
  await ui.unmount()
})

test('/progress-bar say <channel> <text> runs channel.py say', { options: { openPanel: false, statusLine: false } }, async ($, on) => {
  const files = seed()
  delete files[`${P}/.state/panel-on`]
  const ran = world(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'progress-bar', args: 'say Sam hello there', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(text).toContain('Sent')
  expect(ran.find(a => a.includes('say'))!.slice(2)).toEqual(['say', 'sam', 'hello there'])
  const u = await $.command.run({ command: 'progress-bar', args: 'say sam', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(u.text).toContain('Usage: /progress-bar say')
})
