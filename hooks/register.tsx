import type { EngineInterface, Register } from 'claude-code'

import { FRESH_MS, eta, expandHome, lines, parseProgress, parseWatch, readLog, slug, statusScript } from './render'
import type { Progress, Row } from './render'

const WATCH = '.watch.json'
const MAX_LOG = 4 * 1024 * 1024 // bigger logs are read from their last 4 MB

/** A row for one watch file, or null when its log is missing or the job is long over. */
async function watchRow($: EngineInterface, h: string, dir: string, name: string, now: number): Promise<Row | null> {
  let w
  try { w = parseWatch(String(await $.fs.read(`${dir}/${name}`))) } catch { return null }
  if (!w) return null
  const log = expandHome(w.log, h)
  let st
  try { st = await $.fs.stat(log) } catch { return null }
  let text = ''
  try {
    text = st.size > MAX_LOG
      ? (await $.process.run(['tail', '-c', String(MAX_LOG), log])).stdout
      : String(await $.fs.read(log))
  } catch { return null }
  const p = readLog(w, text)
  const alive = w.process ? (await $.process.run(['pgrep', '-f', w.process]).catch(() => ({ exitCode: 1 }))).exitCode === 0 : null
  const finished = p.done !== null && p.total !== null && p.done >= p.total
  const state = p.error ? 'error' : finished ? 'done' : alive === false ? 'stopped' : 'running'
  // A running job shows while its process lives or its log keeps changing; an ended one for FRESH_MS after its last write.
  if (!(alive === true && !finished) && now - st.mtimeMs > FRESH_MS) return null
  const startedAt = w.startedAt ?? st.mtimeMs
  const label = w.label ?? name.slice(0, -WATCH.length)
  return { id: `watch:${label}`, description: label, status: 'running', startedAt, tools: 0, lastTool: '', done: p.done, total: p.total, step: p.step, state, eta: w.startedAt ? eta(now - w.startedAt, p.done, p.total) : '' }
}

// Subagents and shell jobs write { "done": 3, "total": 8, "step": "..." } to ~/.claude-progress/<slug>.json.
// This module turns them, plus every running subagent, into lines at ~/.claude-progress/.lines/agents-<session>.txt and jobs.txt,
// which the status line script from `/progress-bar setup` prints.

const LIVE = new Set(['pending', 'running', 'waiting'])
const SCRIPT_REL = '.claude/progress-bar/statusline.sh'
const DEMO = 'progress-bar-demo'
const USAGE = 'Usage: /progress-bar [setup | demo | clear | fold <section> | unfold <section>]  (sections: todo, running, waiting, done, problems, all)'
const SECTIONS = ['todo', 'running', 'waiting', 'done', 'problems']

type Seen = { startedAt: number; tools: number; lastTool: string }

const seen = new Map<string, Seen>()
let home = ''

async function resolveHome($: EngineInterface) {
  if (home) return home
  home = ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').replace(/[\\/]+$/, '')
  return home
}
const dirOf = (h: string) => `${h}/.claude-progress`

async function readP($: EngineInterface, path: string): Promise<Progress | null> {
  try { return parseProgress(String(await $.fs.read(path))) } catch { return null }
}

/** Builds the rows: live subagents first, then every other fresh progress file. */
async function collect($: EngineInterface): Promise<{ rows: Row[]; now: number }> {
  const h = await resolveHome($)
  const dir = dirOf(h)
  const now = await $.clock.now()
  const key = await sessionKeyOf($)
  if (h && !seenLoaded) {
    seenLoaded = true
    try {
      const saved = JSON.parse(String(await $.fs.read(`${dir}/.state/seen-${key}.json`))) as Record<string, { startedAt: number; tools: number; lastTool: string }>
      for (const [id, v] of Object.entries(saved)) if (!seen.has(id)) seen.set(id, v)
    } catch { /* first run */ }
  }
  let agents: Awaited<ReturnType<typeof $.agent.list>> = []
  try { agents = await $.agent.list() } catch { agents = [] }
  const rows: Row[] = []
  for (const a of agents) {
    if (!LIVE.has(a.status)) continue
    const s = seen.get(a.id) ?? { startedAt: now, tools: 0, lastTool: '' }
    seen.set(a.id, s)
    const p = h ? await readP($, `${dir}/${slug(a.description)}.json`) : null
    rows.push({ id: a.id, description: a.description, status: a.status, startedAt: s.startedAt, tools: s.tools, lastTool: s.lastTool, done: p?.done ?? null, total: p?.total ?? null, step: p?.step ?? '' })
  }
  if (!h) return { rows, now }
  const used = new Set(rows.map(r => slug(r.description)))
  // Remember this session's agents (start time, tools) so a plugin reload keeps them, and claim their progress files.
  try {
    const live = Object.fromEntries(rows.map(r => [r.id, seen.get(r.id)!]))
    await $.fs.write(`${dir}/.state/seen-${key}.json`, JSON.stringify(live))
    await $.fs.write(`${dir}/.state/claims-${key}.txt`, [...used].join('\n'))
  } catch { /* next poll */ }
  // Progress files another open session's agent already shows are skipped here, so no bar appears twice.
  let stateFiles: Awaited<ReturnType<typeof $.fs.list>> = []
  try { stateFiles = await $.fs.list(`${dir}/.state`) } catch { stateFiles = [] }
  for (const f of stateFiles) {
    if (!f.name.startsWith('claims-') || f.name === `claims-${key}.txt` || now - f.mtimeMs > 30_000) continue
    try { for (const n of String(await $.fs.read(`${dir}/.state/${f.name}`)).split('\n')) if (n) used.add(n) } catch { /* gone */ }
  }
  let files: Awaited<ReturnType<typeof $.fs.list>> = []
  try { files = await $.fs.list(dir) } catch { files = [] }
  for (const f of files) {
    if (f.kind === 'file' && f.name.endsWith(WATCH)) {
      const r = await watchRow($, h, dir, f.name, now)
      if (r) rows.push(r)
      continue
    }
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    const name = f.name.slice(0, -5)
    if (used.has(name) || now - f.mtimeMs > FRESH_MS) continue
    const p = await readP($, `${dir}/${f.name}`)
    if (!p) continue
    rows.push({ id: `file:${name}`, description: name, status: 'running', startedAt: p.startedAt ?? f.mtimeMs, tools: 0, lastTool: '', done: p.done, total: p.total, step: p.step })
  }
  return { rows, now }
}

/** Folds or unfolds status line sections; the grouped status line shows a folded one as "▸ NAME (count)". */
async function fold($: EngineInterface, arg: string): Promise<string> {
  const [verb, what = ''] = arg.split(/\s+/)
  const h = await resolveHome($)
  if (!h) return 'No home folder found.'
  const file = `${dirOf(h)}/.state/folded.txt`
  let cur = new Set<string>()
  try { cur = new Set(String(await $.fs.read(file)).split(/\s+/).filter(Boolean)) } catch { /* none folded */ }
  const targets = what === 'all' ? SECTIONS : SECTIONS.filter(x => x === what || (what === 'to-do' && x === 'todo'))
  if (!targets.length) return USAGE
  for (const t of targets) {
    if (verb === 'fold' || (verb === 'toggle' && !cur.has(t))) cur.add(t)
    else cur.delete(t)
  }
  await $.fs.write(file, [...cur].join('\n'))
  return cur.size ? `Folded: ${[...cur].join(', ')}.` : 'All sections open.'
}

let sessionKey = ''
let seenLoaded = false
async function sessionKeyOf($: EngineInterface): Promise<string> {
  if (!sessionKey) { try { sessionKey = (await $.session.id()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) } catch { sessionKey = 'main' } }
  return sessionKey
}

// Each session writes its own subagents to agents-<session>.txt, so two open sessions never overwrite each other.
// Job files (~/.claude-progress/*.json) are the same for every session, so they go to one shared jobs.txt.
async function poll($: EngineInterface) {
  const { rows, now } = await collect($)
  if (!home) return
  await sessionKeyOf($)
  const agents = rows.filter(r => !r.id.startsWith('file:'))
  const jobs = rows.filter(r => r.id.startsWith('file:'))
  const base = `${dirOf(home)}/.lines`
  try { await $.fs.write(`${base}/agents-${sessionKey}.txt`, lines(agents, now).join('\n')) } catch { /* next poll */ }
  try { await $.fs.write(`${base}/jobs.txt`, lines(jobs, now).join('\n')) } catch { /* next poll */ }
}

async function statusLineCommand($: EngineInterface): Promise<string | undefined> {
  try {
    const v = (await $.settings.read({ key: 'statusLine' })) as { type?: string; command?: string } | undefined
    return v && v.type === 'command' && typeof v.command === 'string' ? v.command : undefined
  } catch { return undefined }
}

const snippet = `"statusLine": { "type": "command", "command": "~/${SCRIPT_REL}" }`

async function show($: EngineInterface) {
  const { rows, now } = await collect($)
  const h = home
  const current = await statusLineCommand($)
  const installed = h ? await $.fs.exists(`${h}/${SCRIPT_REL}`).catch(() => false) : false
  const wired = !!current && current.includes(SCRIPT_REL)
  const bars = rows.length ? lines(rows, now).join('\n') : 'No running jobs. Try `/progress-bar demo`.'
  const setup = wired
    ? 'Status line: on.'
    : installed
      ? `Status line: script installed, not in settings yet. Add to ~/.claude/settings.json:\n  ${snippet}`
      : 'Status line: off. Run `/progress-bar setup`.'
  return `${bars}\n\n${setup}`
}

async function setup($: EngineInterface) {
  const h = await resolveHome($)
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  const current = await statusLineCommand($)
  const prev = current && !current.includes(SCRIPT_REL) ? current : undefined
  const path = `${h}/${SCRIPT_REL}`
  await $.fs.write(path, statusScript(prev))
  await $.process.run(['chmod', '+x', path]).catch(() => undefined)
  const chain = prev ? `\nIt runs your current status line after the bars: ${prev}` : ''
  const done = current?.includes(SCRIPT_REL)
    ? 'Your settings already point at it.'
    : `Add this to ~/.claude/settings.json (replacing any "statusLine" there):\n  ${snippet}`
  return `Wrote ${path}.${chain}\n${done}`
}

async function demo($: EngineInterface) {
  const h = await resolveHome($)
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  const path = `${dirOf(h)}/${DEMO}.json`
  const startedAt = await $.clock.now()
  const total = 20
  let done = 0
  const write = () => $.fs.write(path, JSON.stringify({ done, total, step: `demo step ${done}`, startedAt }))
  await write()
  const tick = $.clock.every(1000, async () => {
    done += 1
    if (done > total) {
      tick.cancel()
      await $.process.run(['rm', '-f', path]).catch(() => undefined)
      return
    }
    await write()
    await poll($)
  })
  await poll($)
  return `Demo job started: ${path} counts to ${total} over 20 s, then deletes itself.`
}

async function clear($: EngineInterface) {
  const h = await resolveHome($)
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  const now = await $.clock.now()
  const dir = dirOf(h)
  const stale: string[] = []
  for (const [sub, maxAge] of [['', FRESH_MS], ['/.lines', 2 * 60_000]] as const) {
    let files: Awaited<ReturnType<typeof $.fs.list>> = []
    try { files = await $.fs.list(dir + sub) } catch { files = [] }
    for (const f of files) {
      if (f.kind !== 'file' || !/\.(json|txt)$/.test(f.name) || now - f.mtimeMs <= maxAge) continue
      // A watch file is written once; it is stale only when its job no longer shows.
      if (sub === '' && f.name.endsWith(WATCH) && (await watchRow($, h, dir, f.name, now))) continue
      stale.push(`${dir}${sub}/${f.name}`)
    }
  }
  if (stale.length) await $.process.run(['rm', '-f', ...stale]).catch(() => undefined)
  return stale.length ? `Removed ${stale.length} stale file${stale.length === 1 ? '' : 's'}.` : 'Nothing stale.'
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const s = seen.get(e.agentId) ?? { startedAt: await $.clock.now(), tools: 0, lastTool: '' }
      s.tools += 1
      s.lastTool = String(e.tool)
      seen.set(e.agentId, s)
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress-bar', description: 'Show live progress bars, or set up the status line', argumentHint: '[setup | demo | clear]' })
    void poll($)
    $.clock.every(5000, () => { void poll($) })
    return next(e)
  })

  on('command.run', { command: 'progress-bar' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    const text =
      arg === '' ? await show($)
      : arg === 'setup' ? await setup($)
      : arg === 'demo' ? await demo($)
      : arg === 'clear' ? await clear($)
      : /^(fold|unfold|toggle)\b/.test(arg) ? await fold($, arg)
      : USAGE
    return { text }
  })
}
