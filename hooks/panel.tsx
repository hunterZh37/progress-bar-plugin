import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { connSummary, readConns, refreshConns, resetConns } from './connectors'
import { resolveHome } from './home'
import { todoItems as parseTodo } from './render'
import type { Conn, Todo } from '../types'

// The Status panel: the grouped status line, drawn in a docked pane beside the chat.
// It runs the plugin's own status line script with PB_FULL=1 every second while the pane is open.
// Section headers are buttons that fold or open the section through ~/.claude-progress/.state/folded.txt.
// To-dos come straight from ~/.claude-progress/todo.txt: open ones under TO-DO, checked-off ones under DONE.
// Pressing one opens a menu: mark as done (or move back to to-do) or delete.
// Two tabs: List (the sections) and Connectors (see connectors.ts). Connector checks run only while the pane is open.

export const PANE = 'progress-bar-status'
const TITLE = 'Status'
const COLUMNS = 52
const SCRIPT_REL = '.claude/progress-bar/statusline.sh'
export const PANEL_FLAG_REL = '.claude-progress/.state/panel-on'
const FOLDED_REL = '.claude-progress/.state/folded.txt'
const TODO_REL = '.claude-progress/todo.txt'

export const SECTION_KEYS = ['todo', 'running', 'done', 'waiting', 'problems'] as const
type Key = (typeof SECTION_KEYS)[number]
const TITLES: Record<string, Key> = { 'TO-DO': 'todo', RUNNING: 'running', WAITING: 'waiting', DONE: 'done', PROBLEMS: 'problems' }
const HOTKEYS: Record<Key, string> = { todo: '1', running: '2', done: '3', waiting: '4', problems: '5' }
const ICON: Record<Key, string> = { todo: '☐', running: '▶', waiting: '⏸', done: '✔', problems: '✖' }

const foldedAtom = atom({ plugin: 'progress-bar', key: 'folded' } as const, [])
const linesAtom = atom({ plugin: 'progress-bar', key: 'lines' } as const, [])
const todosAtom = atom({ plugin: 'progress-bar', key: 'todos' } as const, [])
const menuAtom = atom({ plugin: 'progress-bar', key: 'menuFor' } as const, -1)
// The same state connectors.ts writes; the scan wants each atom declared in the file that reads it.
const connsAtom = atom({ plugin: 'progress-bar', key: 'conns' } as const, { at: 0, checking: false, login: '', list: [] })
const tabAtom = atom({ plugin: 'progress-bar', key: 'tab' } as const, 'list')

/** Removes terminal colors and OSC 8 links. */
export const stripAnsi = (s: string) =>
  s.replace(/\x1b\]8;;[^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '')

export type Section = { key: Key; title: string; folded: boolean; count: number; rows: string[] }

/** Splits the grouped output into sections (a header, then its indented rows) and the lines after them. */
export function parseSections(lines: string[]): { sections: Section[]; other: string[] } {
  const sections: Section[] = []
  const other: string[] = []
  for (const line of lines) {
    const head = /^([▾▸])\s+\S+\s+(TO-DO|RUNNING|WAITING|DONE|PROBLEMS)(?:\s+\((\d+)\))?\s*$/.exec(line)
    if (head) {
      sections.push({ key: TITLES[head[2]!]!, title: head[2]!, folded: head[1] === '▸', count: Number(head[3] ?? 0), rows: [] })
      continue
    }
    const last = sections[sections.length - 1]
    if (last && /^\s/.test(line)) last.rows.push(line.trim())
    else other.push(line.trim())
  }
  for (const s of sections) {
    if (s.folded) continue
    s.count = s.key === 'todo' ? s.rows.reduce((a, r) => a + todoItems(r).items.length, 0) : s.rows.length
  }
  return { sections, other }
}

/** "YOU: a · b" -> { who: 'You', items: ['a', 'b'] } */
export function todoItems(row: string): { who: string; items: string[] } {
  const m = /^([A-Z][A-Z0-9 _-]*):\s*(.*)$/.exec(row)
  const who = m ? m[1]!.charAt(0) + m[1]!.slice(1).toLowerCase() : ''
  return { who, items: (m ? m[2]! : row).split(' · ').map(s => s.trim()).filter(Boolean) }
}

/** A running row: its mark, name, percent and the remaining details. */
export function runningRow(row: string): { mark: string; stuck: boolean; name: string; pct: number | null; details: string } {
  const stuck = /^⚠ stuck (\S+)\s*/.exec(row)
  const spin = /^([◐◓◑◒])\s*/.exec(row)
  const clean = row.slice((stuck ?? spin)?.[0].length ?? 0)
  const name = clean.split(/\s+[█░]|\s+·\s+/)[0]!.trim()
  const pctM = /(\d+(?:\.\d+)?)%/.exec(clean)
  const details = clean.slice(name.length).replace(/^[\s█░]+/, '').split(' · ').map(p => p.trim()).filter(p => p && !/^\d+(\.\d+)?%$/.test(p)).join(' · ')
  return { mark: stuck ? `⚠ ${stuck[1]}` : spin ? spin[1]! : '•', stuck: !!stuck, name, pct: pctM ? Number(pctM[1]) : null, details }
}

async function readFolded($: EngineInterface, h: string): Promise<string[]> {
  let keys: string[] = []
  try { keys = String(await $.fs.read(`${h}/${FOLDED_REL}`)).split(/\s+/).filter(Boolean) } catch { keys = [] }
  const prev = await read($, foldedAtom)
  if (prev.join() !== keys.join()) await update($, foldedAtom, () => keys)
  return keys
}

/** Reads todo.txt into the to-dos atom, done ones included. */
async function readTodos($: EngineInterface, h: string) {
  let raw = ''
  try { raw = String(await $.fs.read(`${h}/${TODO_REL}`)) } catch { raw = '' }
  const out: Todo[] = parseTodo(raw).map(t => ({ owner: t.heading, text: t.text.split(' | ')[0]!.trim(), done: t.done, line: t.line }))
  const prev = await read($, todosAtom)
  if (JSON.stringify(prev) !== JSON.stringify(out)) await update($, todosAtom, () => out)
}

/** One menu action on a todo.txt line: mark done, mark to-do (reopen) or delete. */
export async function todoAction($: EngineInterface, h: string, line: number, action: 'done' | 'todo' | 'delete') {
  const file = `${h}/${TODO_REL}`
  try {
    const lines = String(await $.fs.read(file)).split('\n')
    if (line < lines.length) {
      const body = lines[line]!.trim().replace(/^x\s+/i, '')
      if (action === 'delete') lines.splice(line, 1)
      else lines[line] = action === 'done' ? `x ${body}` : body
      await $.fs.write(file, lines.join('\n'))
    }
  } catch { /* next press */ }
  await update($, menuAtom, () => -1)
  await pollPanel($, h)
}

/** Runs the status line script in full and keeps its lines. */
export async function pollPanel($: EngineInterface, h: string) {
  if (!h) return
  try {
    const { stdout } = await $.process.run(['/bin/sh', `${h}/${SCRIPT_REL}`], { stdin: '{}', env: { PB_FULL: '1' }, timeoutMs: 8000 })
    const lines = stripAnsi(stdout).split('\n').filter(l => l.trim())
    const prev = await read($, linesAtom)
    if (prev.join('\n') !== lines.join('\n')) await update($, linesAtom, () => lines)
  } catch { /* next tick */ }
  await readFolded($, h)
  await readTodos($, h)
  await readConns($, h)
  void refreshConns($, h)
}

async function flip($: EngineInterface, h: string, key: Key) {
  const cur = new Set(await readFolded($, h))
  if (cur.has(key)) cur.delete(key)
  else cur.add(key)
  try { await $.fs.write(`${h}/${FOLDED_REL}`, [...cur].join('\n')) } catch { /* next press */ }
  await update($, foldedAtom, () => [...cur])
  await pollPanel($, h)
}

export async function openPanel($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

export async function isPanelOn($: EngineInterface, h: string): Promise<boolean> {
  return h ? $.fs.exists(`${h}/${PANEL_FLAG_REL}`).catch(() => false) : false
}

/** `/progress-bar panel [on|off]`. */
export async function panelCommand($: EngineInterface, h: string, arg: string): Promise<string> {
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  if (arg === 'on') {
    await $.fs.write(`${h}/${PANEL_FLAG_REL}`, 'on\n')
    await pollPanel($, h)
    await openPanel($)
    return 'Status panel on: it opens at session start, and the status line shows one summary line.'
  }
  if (arg === 'off') {
    await $.process.run(['rm', '-f', `${h}/${PANEL_FLAG_REL}`]).catch(() => undefined)
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return 'Status panel off: the status line shows the full groups again.'
  }
  if (arg) return 'Usage: /progress-bar panel [on | off]'
  await pollPanel($, h)
  await openPanel($)
  return (await isPanelOn($, h))
    ? 'Status panel opened.'
    : 'Status panel opened. `/progress-bar panel on` opens it at every session start.'
}

/** At session start: poll every second while the pane is open, and open it when the panel is on. */
export async function startPanel($: EngineInterface, h: string) {
  await resetConns($)
  $.clock.every(1000, async () => {
    const open = await $.ui.panes().then(ps => ps.some(p => p.id === PANE)).catch(() => false)
    if (open) await pollPanel($, h)
  })
  if (await isPanelOn($, h)) {
    await pollPanel($, h)
    void openPanel($)
  }
}

/** Draws the pane. */
export function registerPanel(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const homeDir = await resolveHome($)
    const lines = await read($, linesAtom)
    const folded = new Set(await read($, foldedAtom))
    const todos = await read($, todosAtom)
    const menuFor = await read($, menuAtom)
    const conns = await read($, connsAtom)
    const tab = await read($, tabAtom)
    const openTodos = todos.filter(t => !t.done).length
    const width = Math.max(30, e.props.bodyColumns ?? 60)
    const barW = Math.min(20, Math.max(10, width - 30))
    const { sections: parsed, other } = parseSections(lines)
    // TO-DO shows only while something is open. Checked-off to-dos go under DONE, so DONE shows if they exist.
    const doneTodos = todos.filter(t => t.done)
    const sections = parsed.filter(s => s.key !== 'todo' || openTodos > 0)
    if (openTodos > 0 && !sections.some(s => s.key === 'todo')) sections.unshift({ key: 'todo', title: 'TO-DO', folded: false, count: 0, rows: [] })
    if (doneTodos.length && !sections.some(s => s.key === 'done')) sections.push({ key: 'done', title: 'DONE', folded: false, count: 0, rows: [] })

    // One to-do as a button. Pressing it opens its menu below it.
    const todoItem = (t: Todo) => [
      <Button key={`t-${t.line}`} plain onPress={() => update($, menuAtom, v => (v === t.line ? -1 : t.line))}>
        {`    ${t.done ? '✓' : '○'} ${t.text}`}
      </Button>,
      menuFor === t.line
        ? <Box key={`m-${t.line}`}>
            <Text dimColor>{'      '}</Text>
            {t.done
              ? <Button key={`a-todo-${t.line}`} plain onPress={() => todoAction($, homeDir, t.line, 'todo')}>{'○ Move back to to-do  '}</Button>
              : <Button key={`a-done-${t.line}`} plain onPress={() => todoAction($, homeDir, t.line, 'done')}>{'✓ Mark as done  '}</Button>}
            <Button key={`a-del-${t.line}`} plain onPress={() => todoAction($, homeDir, t.line, 'delete')}>{'✕ Delete  '}</Button>
            <Button key={`a-x-${t.line}`} plain onPress={() => update($, menuAtom, () => -1)}>{'Cancel'}</Button>
          </Box>
        : null,
    ].filter(Boolean)

    // Each owner with open items, then those items.
    const todoRows = () => [...new Set(todos.map(t => t.owner))].flatMap(owner => {
      const items = todos.filter(t => t.owner === owner && !t.done)
      if (!items.length) return []
      return [
        <Text key={`w-${owner}`} bold color="magenta">{`  ${owner.charAt(0).toUpperCase()}${owner.slice(1).toLowerCase()}`}</Text>,
        ...items.flatMap(todoItem),
      ]
    })

    // Finished jobs, then the checked-off to-dos.
    const doneRows = (rows: string[]) => [
      ...plainRows(rows, 'done'),
      ...(doneTodos.length ? [<Text key="w-checked" bold color="magenta">{'  Checked-off to-dos'}</Text>, ...doneTodos.flatMap(todoItem)] : []),
    ]

    const runRows = (rows: string[]) => rows.flatMap((row, i) => {
      const r = runningRow(row)
      const frac = r.pct === null ? null : Math.min(1, r.pct / 100)
      const filled = frac === null ? 0 : Math.round(frac * barW)
      return [
        <Box key={`r${i}`}>
          <Text color={r.stuck ? 'yellow' : 'cyan'}>{`  ${r.mark} `}</Text>
          <Text bold color={r.stuck ? 'yellow' : undefined}>{r.name}</Text>
        </Box>,
        frac !== null
          ? <Box key={`b${i}`}>
              <Text color="green">{`    ${'█'.repeat(filled)}`}</Text>
              <Text dimColor>{'░'.repeat(barW - filled)}</Text>
              <Text bold>{` ${r.pct}%`}</Text>
            </Box>
          : null,
        r.details ? <Text key={`d${i}`} dimColor>{`    ${r.details}`}</Text> : null,
      ].filter(Boolean)
    })

    const plainRows = (rows: string[], key: Key) => rows.map((row, i) => {
      const fin = /^(.*?) · finished (\d\d:\d\d)$/.exec(row)
      if (fin) return <Text key={`p${i}`} dimColor>{`  ✓ ${fin[1]}  ${fin[2]}`}</Text>
      return <Text key={`p${i}`} color={key === 'problems' ? 'red' : undefined} dimColor={key === 'done'}>{`  ${row}`}</Text>
    })

    // The tab bar: List and Connectors, the latter with "!N" when N connectors need sign-in or failed.
    const badN = conns.list.filter(c => c.kind !== 'ok').length
    const connLabel = `Connectors${badN ? ` !${badN}` : ''}`
    const tabBar = (
      <Box key="tabs" marginBottom={1}>
        <Button key="tab-list" hotkey="l" plain onPress={() => update($, tabAtom, () => 'list')}>
          {tab === 'list' ? '[ List ]' : '  List  '}
        </Button>
        <Text>{' '}</Text>
        <Button key="tab-connectors" hotkey="c" plain onPress={() => update($, tabAtom, () => 'connectors')}>
          {tab === 'connectors' ? `[ ${connLabel} ]` : `  ${connLabel}  `}
        </Button>
      </Box>
    )

    if (tab === 'connectors') {
      const hhmm = (ms: number) => { const t = new Date(ms); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` }
      const ordered = [...conns.list.filter(c => c.kind === 'ok'), ...conns.list.filter(c => c.kind !== 'ok')]
      const COLOR = { ok: 'green', auth: 'yellow', fail: 'red' } as const
      const MARK = { ok: '✔', auth: '!', fail: '✖' } as const
      const connRow = (c: Conn) => [
        <Box key={`c-${c.name}`}>
          <Text color={COLOR[c.kind]}>{`  ${MARK[c.kind]} `}</Text>
          <Text bold>{c.name}</Text>
          {c.kind !== 'ok' ? <Text color={COLOR[c.kind]}>{c.kind === 'auth' ? '  needs sign-in' : '  failed'}</Text> : null}
        </Box>,
        c.account ? <Text key={`c-a-${c.name}`} dimColor>{`    ${c.account}`}</Text> : null,
      ].filter(Boolean)
      return (
        <Box flexDirection="column">
          {tabBar}
          <Text bold color="cyan">{`⚡ CONNECTORS  ${connSummary(conns.list)}`}</Text>
          {conns.login ? <Text dimColor>{`  Claude: ${conns.login}`}</Text> : null}
          {conns.list.length === 0 && <Text dimColor>{conns.checking ? '  checking…' : '  No check yet.'}</Text>}
          {ordered.flatMap(connRow)}
          <Box key="c-foot">
            <Text dimColor>{`  ${conns.checking ? 'checking…' : conns.at ? `checked ${hhmm(conns.at)}` : 'not checked'}  `}</Text>
            <Button key="c-refresh" plain onPress={() => refreshConns($, homeDir, true)}>{'↻ refresh'}</Button>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {tabBar}
        {sections.length === 0 && <Text dimColor>Nothing running.</Text>}
        {sections.map((sec, n) => {
          const isFolded = folded.has(sec.key) || sec.folded
          return (
            <Box key={`s-${sec.key}`} flexDirection="column" marginBottom={n < sections.length - 1 || other.length ? 1 : 0}>
              <Button key={`h-${sec.key}`} hotkey={HOTKEYS[sec.key]} plain onPress={() => flip($, homeDir, sec.key)}>
                {`${isFolded ? '▸' : '▾'} ${ICON[sec.key]} ${sec.title}  ${sec.key === 'todo' ? openTodos : sec.key === 'done' ? sec.count + doneTodos.length : sec.count}`}
              </Button>
              {!isFolded && (sec.key === 'todo' ? todoRows() : sec.key === 'running' ? runRows(sec.rows) : sec.key === 'done' ? doneRows(sec.rows) : plainRows(sec.rows, sec.key))}
            </Box>
          )
        })}
        {other.map((l, i) => <Text key={`o${i}`} dimColor>{l}</Text>)}
      </Box>
    )
  })
}
