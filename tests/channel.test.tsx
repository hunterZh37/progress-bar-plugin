import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CHANNEL_USAGE, SEND_TOOL, insideChannel, parseReceived, parseSend, words } from '../hooks/channel'
import { PANE } from '../hooks/panel'
import { statusScript } from '../hooks/render'

const HOME = '/home/u'
const P = `${HOME}/.claude-progress`
const CH = `${P}/channel`
const SCRIPT = `${HOME}/.claude/progress-bar/statusline.sh`
const PANE_PROPS = { title: 'Status', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} }
const RECEIVED = JSON.stringify([
  { id: 'aaaa1111aaaa1111', channel: 'sam', from: 'sam-gh', filename: 'plan.md', path: `${CH}/sam/plan.md`, ts: 1800000000 },
  { id: 'bbbb2222bbbb2222', channel: 'sam', from: 'sam-gh', filename: 'evil.md', path: `${CH}/../../.ssh/id_rsa`, ts: 1800000001 },
  { id: 'cccc3333cccc3333', channel: 'sam', from: 'sam-gh', filename: 'old.md', path: `${CH}/sam/old.md`, ts: 1800000002 },
  { id: 'dddd4444dddd4444', channel: 'kim', from: 'kim-gh', filename: 'notes.txt', path: `${CH}/kim/notes.txt`, ts: 1800000003 },
  { id: 'eeee5555eeee5555', channel: 'kim', from: 'kim-gh', filename: 'k.md', path: `${CH}/keys/enc.pem`, ts: 1800000004 },
])

function world(on: On, files: Record<string, string>) {
  const ran: string[][] = []
  mock.env(on, { HOME })
  on('fs.read', (_, e) => { const t = files[String(e.path)]; if (t === undefined) throw new Error('ENOENT'); return { value: t } })
  on('fs.write', (_, e) => { files[String(e.path)] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: String(e.path) in files }))
  on('fs.list', () => ({ value: [] }))
  on('clock.now', () => ({ value: 1800000000000 }))
  on('clock.every', async () => { await new Promise<void>(() => {}); return { value: undefined } })
  on('process.run', (_, e) => { ran.push([...e.argv]); return { value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Darwin' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('agent.list', () => ({ value: [] as never }))
  on('settings.read', () => ({ value: {} as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'progress-bar' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__progress-bar__channel_send' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] as never }))
  return ran
}
async function mount($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return $.ui.mount({ plugin: 'progress-bar', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
}

test('parseReceived: drops read ids and any path outside the channel folder or inside keys/repos', () => {
  const c = parseReceived(RECEIVED, new Set(['cccc3333cccc3333']), HOME)
  expect(c.items.map(i => i.id)).toEqual(['dddd4444dddd4444', 'aaaa1111aaaa1111'])
  expect(parseReceived('nope', new Set(), HOME).items).toEqual([])
  expect(parseReceived(JSON.stringify([{ id: 'zz', path: `${CH}/a.md` }]), new Set(), HOME).items).toEqual([])
  expect(insideChannel(`${CH}/sam/a.md`, HOME)).toBe(true)
  expect(insideChannel(`${CH}/sam/../../x`, HOME)).toBe(false)
  expect(insideChannel(`${CH}/repos/sam/msgs/x.enc`, HOME)).toBe(false)
  expect(insideChannel('/etc/passwd', HOME)).toBe(false)
})

test('parseSend and words: "<file> to <name>", quoted paths with spaces', () => {
  expect(parseSend('notes.md to sam')).toEqual(['notes.md', 'sam'])
  expect(parseSend('"my notes.md" to Sam')).toEqual(['my notes.md', 'sam'])
  expect(parseSend('docs/a b.md sam')).toEqual(['docs/a b.md', 'sam'])
  expect(parseSend('notes.md')).toBeNull()
  expect(words('invite sam-gh sam --as me')).toEqual(['invite', 'sam-gh', 'sam', '--as', 'me'])
})

test('Channel block: unread files, a press opens the local copy, ✓ read hides it and records the id', async ($, on) => {
  const files: Record<string, string> = { [SCRIPT]: statusScript(), [`${P}/.state/panel-on`]: 'on\n', [`${CH}/received.json`]: RECEIVED, [`${P}/.state/channel-read.txt`]: 'cccc3333cccc3333\n' }
  const ran = world(on, files)
  const ui = await mount($)
  const t = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(t).toContain('Channel  2 new')
  expect(await ui.find({ type: 'Button', key: 'ch-o-bbbb2222bbbb2222' }).catch(() => undefined)).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'ch-o-eeee5555eeee5555' }).catch(() => undefined)).toBeUndefined()
  await ui.press({ key: 'ch-o-aaaa1111aaaa1111' })
  expect(ran.some(a => a[0] === 'open' && a[1] === `${CH}/sam/plan.md`)).toBe(true)
  await ui.press({ key: 'ch-x-aaaa1111aaaa1111' })
  expect(files[`${P}/.state/channel-read.txt`]).toBe('cccc3333cccc3333\naaaa1111aaaa1111\n')
  const t2 = (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '')
  expect(t2).toContain('Channel  1 new')
  expect(t2.filter(x => /Channel|new/.test(x)).some(x => /[;—]/.test(x))).toBe(false)
  // Nothing in the panel ever ran the received file through a shell or a prompt: only open with its path.
  expect(ran.filter(a => a.some(x => x.includes('plan.md'))).every(a => a[0] === 'open' && a.length === 2)).toBe(true)
  await ui.unmount()
})

test('/progress-bar send runs channel.py send with an absolute path, channel with no channels makes no network call', { options: { openPanel: false, statusLine: false } }, async ($, on) => {
  const files: Record<string, string> = {}
  const ran = world(on, files)
  on('session.cwd', () => ({ value: '/work' }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'progress-bar', args: 'send notes.md to Sam', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const send = ran.find(a => a.includes('send'))!
  expect(send[0]).toBe('python3')
  expect(send[1]!.endsWith('/bin/channel.py')).toBe(true)
  expect(send.slice(2)).toEqual(['send', '/work/notes.md', 'sam'])
  expect(ran.some(a => a.includes('poll'))).toBe(false)
  const { text } = await $.command.run({ command: 'progress-bar', args: 'channel', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(text).toContain('/progress-bar channel invite <github-user>')
})

test('copy: no semicolons or em dashes, the tool only sends', () => {
  expect(/[;—]/.test(CHANNEL_USAGE)).toBe(false)
  expect(/[;—]/.test(SEND_TOOL.description)).toBe(false)
  expect(SEND_TOOL.name).toBe('channel_send')
})

test('the model cannot read the channel private keys', { options: { openPanel: false, statusLine: false } }, async ($, on) => {
  world(on, {})
  on('tool.call', () => ({ result: 'ran' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r1 = await $.tool.call({ tool: 'Read', file_path: `${CH}/keys/enc.pem` } as never)
  expect((r1 as { deny?: string; isError?: boolean; text?: string }).deny ?? (r1 as { text?: string }).text).toContain('keys stay private')
  const r2 = await $.tool.call({ tool: 'Bash', command: 'cat ~/.claude-progress/channel/keys/sign.pem' } as never)
  expect(JSON.stringify(r2)).toContain('keys stay private')
  const r3 = await $.tool.call({ tool: 'Read', file_path: `${CH}/sam/plan.md` } as never)
  expect(JSON.stringify(r3)).not.toContain('keys stay private')
})
