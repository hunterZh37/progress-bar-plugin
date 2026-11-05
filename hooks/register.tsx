import type { EngineInterface, Register } from 'claude-code'

import { ACTION_TOOL, CHECK_EVERY, actionCommand, addFromClaude, gatePrompt, isGated, tickActions } from './actions'
import { autonextCommand, ownJobs, tickAutonext } from './autonext'
import { backfillChat, sayCommand } from './chat'
import { CHANNEL_EVERY, SEND_TOOL, channelCommand, pollChannel, sendCommand, sendFile } from './channel'
import { inboxCommand } from './inbox'
import { chainable } from './chain'
import { SNIPPET, installedPrev, writeLib } from './setup'
import { resolveHome } from './home'
import { USAGE_CHECK, probeUsage } from './usage'
import { macClicks, parseMacClicks } from './mac'
import { checkpointCommand, noteStatusLine, panelCommand, registerPanel, startPanel } from './panel'
import { FRESH_MS, eta, pickMeta, expandHome, rateLeft, trackJob, lines, parseProgress, parseWatch, readLog, slug, statusScript, watchState, todoAdd, todoClear, todoDone, todoList as listOf } from './render'
import { PROJECTS_REL, gitRootOf, resolveProject, sessionProject } from './project'
import { LONG_BASH_MS, PROGRESS_TOOL, endBackground, endShell, mirrorTasks, startShell, taskCreated, taskList, taskUpdated, touchShells, writeReport } from './report'
import type { Task } from './report'
import { PROJECT_LINE, pickOwner, routeOf, sessionKeyOf as keyOf } from './route'
import type { Progress, Row, Track } from './render'
import { isDarwin } from './mac'
import { impactLines, parseDone, reportOf, saveDone, summarize, DONE_REL } from './done'
import { aliveTasks, bgLaunch, scanTranscript, snapOf, toolWhat, waitSegs } from './waiting'
import type { BgSnap, BgTask, Job, TxScan } from './waiting'

const WATCH = '.watch.json'
// Data files in ~/.claude-progress that are never jobs.
const DATA_FILES = new Set(['inbox', 'actions', 'max-usage', 'channels'])
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
  const state = watchState(p, alive, now - st.mtimeMs, text)
  const finished = state === 'done'
  // A running job shows while its process lives or its log keeps changing; an ended one for FRESH_MS after its last write.
  if (!(alive === true && !finished) && now - st.mtimeMs > FRESH_MS) return null
  // No startedAt: trackRows starts it when first seen, never at the log's last write.
  const startedAt = w.startedAt ?? 0
  const label = w.label ?? name.slice(0, -WATCH.length)
  return { id: `watch:${label}`, description: label, status: 'running', startedAt, tools: 0, lastTool: '', done: p.done, total: p.total, step: p.step, state, eta: w.startedAt ? eta(now - w.startedAt, p.done, p.total) : '' }
}

// Subagents and shell jobs write { "done": 3, "total": 8, "step": "..." } to ~/.claude-progress/<slug>.json.
// This module turns them, plus every running subagent, into lines at ~/.claude-progress/.lines/agents-<session>.txt and jobs.txt,
// which the status line script from `/progress-bar setup` prints.

const LIVE = new Set(['pending', 'running', 'waiting'])
const SCRIPT_REL = '.claude/progress-bar/statusline.sh'
const DEMO = 'progress-bar-demo'
const USAGE = [
  'Usage: /progress-bar [setup | demo | action | clear | todo | panel [on|off] | autonext [on|off|ask] | checkpoint [label] | inbox [setup] | channel | send <file> to <name> | say <name> <text> | fold <section> | unfold <section> | toggle <section>]',
  '  action: steps only you can run (list, add, done, skip <reason>, copy, check). While one is open your prompts are held',
  '  autonext: when a job finishes, start (on), suggest (ask, the default) or skip (off) the top ready to-do of its machine',
  '  (no argument): show the bars and open the Status panel\n  panel: open the Status panel. panel on: open it at every session start, with a one-line status line',
  '  checkpoint (or away): save the running jobs. The Status panel shows what happened since once you are back',
  '  inbox: emails that need you (~/.claude-progress/inbox.json). inbox setup: write the example Gmail checker',
  '  channel: an encrypted channel to a collaborator (invite, join, list, read, leave). send <file> to <name>: send them a file',
  '  say <name> <text>: send a short chat line on that channel (the Status panel\'s Chat tab shows the thread)',
  '  setup mac-clicks [off]: click a section header to fold it (macOS)',
  '  sections: todo, running, waiting, done, problems, all',
  '  todo: todo | todo add [name] <text> | todo done <n|text> | todo clear',
].join('\n')
const SECTIONS = ['todo', 'running', 'waiting', 'done', 'problems']

/**
 * What the plugin remembers per agent, saved so a reload keeps it: start, tool count and last tool, plus what its last
 * tool call was about and when it ended, when it began to wait, and the background tasks it started (waiting.ts).
 */
type Seen = { startedAt: number; tools: number; lastTool: string; lastWhat?: string; lastAt?: number; waitSince?: number; bg?: BgTask[] }

const seen = new Map<string, Seen>()
const dirOf = (h: string) => `${h}/.claude-progress`
// A background agent that sits waiting with no tool call seen for this long is over: its report went back before a
// plugin reload, so the reload never saw its SubagentHandback.
const STALE_WAIT_MS = 30 * 60_000
const TRACK_REL = '.state/job-track.json'
const TRACK_KEEP_MS = 2 * 86_400_000

// The session's in-flight background tasks from the last Stop or SubagentStop, saved beside seen-<session>.json.
let snap: BgSnap | null = null
// Where this session's transcripts are (the main one's path without .jsonl), and each agent's own, from SubagentStop.
let txBase = ''
const txOf = new Map<string, string>()
// Each waiting agent's transcript scan, kept while the transcript does not change.
const scans = new Map<string, { mtime: number; scan: TxScan }>()
const TX_TAIL = 4 * 1024 * 1024

/** Removes a stopped task from every agent. */
function dropTask(id: string) {
  for (const s of seen.values()) if (s.bg?.some(t => t.id === id)) s.bg = s.bg.filter(t => t.id !== id)
}

/** An agent's transcript path, or '' when no Stop or SubagentStop has named one yet. */
const txPath = (id: string) => txOf.get(id) ?? (txBase ? `${txBase}/subagents/agent-${id}.jsonl` : '')

/** Why each waiting or pending agent waits (waiting.ts waitSegs). */
async function explainWaits($: EngineInterface, agents: Awaited<ReturnType<EngineInterface['agent']['list']>>, rows: Row[], jobs: Job[], now: number) {
  for (const r of rows) {
    const a = agents.find(x => x.id === r.id)
    const s = seen.get(r.id)
    if (!a || !s) continue
    // Tasks past a Monitor's deadline, or missing from a newer snapshot, are over.
    let alive = aliveTasks(s.bg ?? [], snap, now)
    if (s.bg) s.bg = alive
    if (a.status !== 'waiting') { s.waitSince = undefined; if (a.status !== 'pending') continue }
    const path = txPath(a.id)
    // Its transcript, read again only when it changed: background tasks still running (a reload forgets the ones
    // seen at tool calls), its last call when not seen since a reload, and the progress files it names.
    let scan: TxScan | null = null
    if (a.status === 'waiting' && path) {
      try {
        const m = (await $.fs.stat(path)).mtimeMs
        const c = scans.get(a.id)
        if (c && c.mtime === m) scan = c.scan
        else {
          scan = scanTranscript((await $.process.run(['tail', '-c', String(TX_TAIL), path], { timeoutMs: 5000 })).stdout)
          scans.set(a.id, { mtime: m, scan })
        }
      } catch { scan = null }
    }
    if (scan) {
      alive = [...alive, ...scan.running.filter(x => !alive.some(y => y.id === x.id)).map(x => ({ ...x, kind: x.kind === 'monitor' ? 'monitor' as const : 'shell' as const, at: 0 }))]
      if (!s.lastWhat && scan.lastWhat && scan.lastTool === s.lastTool) { s.lastWhat = scan.lastWhat; if (scan.lastAt) s.lastAt = scan.lastAt }
    }
    if (a.status === 'waiting' && !s.waitSince) {
      // Unknown after a reload: the agent's transcript was last written when its turn ended.
      let at = s.lastAt ?? 0
      if (!at && path) { try { at = (await $.fs.stat(path)).mtimeMs } catch { at = 0 } }
      if (at && !s.lastAt) s.lastAt = at
      s.waitSince = at || now
    }
    const kids = agents.filter(k => k.parentId === a.id && LIVE.has(k.status) && seen.get(k.id)?.lastTool !== 'SubagentHandback').map(k => k.description)
    r.wait = waitSegs({ desc: a.description, status: a.status, tasks: alive, kids, jobs, step: r.step, lastTool: s.lastTool, lastWhat: s.lastWhat ?? '', lastAt: s.lastAt ?? 0, waitSince: s.waitSince ?? 0, files: scan?.files }, now)
  }
}

/** job-track.json: each job's real start and rate base (render.ts Track). Shared by every session on this machine. */
async function readTracks($: EngineInterface, dir: string): Promise<Record<string, Track>> {
  try {
    const t = JSON.parse(String(await $.fs.read(`${dir}/${TRACK_REL}`))) as Record<string, Track>
    return t && typeof t === 'object' ? t : {}
  } catch { return {} }
}

/** A file's birth time in ms (stat %B on macOS, %W on Linux), or 0 when the system does not keep one. */
async function bornOf($: EngineInterface, path: string): Promise<number> {
  try {
    const r = await $.process.run((await isDarwin($)) ? ['stat', '-f', '%B', path] : ['stat', '-c', '%W', path], { timeoutMs: 3000 })
    const s = Number(r.stdout.trim())
    return r.exitCode === 0 && s > 0 ? s * 1000 : 0
  } catch { return 0 }
}

const gitRoots = new Map<string, string>()

/** The project slug of a folder, as the per-project to-dos name it. */
async function projectOfCwd($: EngineInterface, h: string, cwd: string, projectsText: string): Promise<string> {
  if (!gitRoots.has(cwd)) gitRoots.set(cwd, await gitRootOf($, cwd))
  return resolveProject(cwd, gitRoots.get(cwd)!, projectsText, h).slug
}

/**
 * Builds the rows: live subagents first, then every other fresh progress file. `shared` holds the ids of the rows
 * that go to the shared jobs.txt; the other file rows belong to this session (see route.ts).
 */
async function collect($: EngineInterface): Promise<{ rows: Row[]; now: number; shared: Set<string> }> {
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
    try {
      const b = JSON.parse(String(await $.fs.read(`${dir}/.state/bg-${key}.json`))) as { snap?: BgSnap; txBase?: string }
      if (!snap && b.snap && Array.isArray(b.snap.tasks)) snap = b.snap
      if (!txBase && typeof b.txBase === 'string') txBase = b.txBase
    } catch { /* none yet */ }
    // Before any Stop names it: the session's transcript folder, ~/.claude/projects/<folder with - for each symbol>/<session id>.
    if (!txBase) {
      try {
        const base = `${h}/.claude/projects/${(await $.session.cwd()).replace(/[^A-Za-z0-9]/g, '-')}/${await $.session.id()}`
        if (await $.fs.exists(`${base}/subagents`)) txBase = base
      } catch { /* a Stop names it later */ }
    }
  }
  let agents: Awaited<ReturnType<typeof $.agent.list>> = []
  try { agents = await $.agent.list() } catch { agents = [] }
  const rows: Row[] = []
  const liveIds: string[] = []
  for (const a of agents) {
    if (!LIVE.has(a.status)) continue
    const s = seen.get(a.id) ?? { startedAt: now, tools: 0, lastTool: '' }
    seen.set(a.id, s)
    liveIds.push(a.id)
    // An agent that handed its report back is finished, even while the harness still lists it as waiting.
    ownJobs.add(slug(a.description))
    if (s.lastTool === 'SubagentHandback') continue
    if (a.status === 'waiting' && s.tools === 0 && now - s.startedAt > STALE_WAIT_MS) continue
    let p: Progress | null = null
    if (h) {
      try {
        const text = String(await $.fs.read(`${dir}/${slug(a.description)}.json`))
        p = parseProgress(text)
        const raw = JSON.parse(text) as Record<string, unknown>
        if (raw && typeof raw === 'object') agentFiles.set(a.id, raw)
      } catch { p = null }
    }
    rows.push({ id: a.id, description: a.description, status: a.status, startedAt: s.startedAt, tools: s.tools, lastTool: s.lastTool, done: p?.done ?? null, total: p?.total ?? null, step: p?.step ?? '' })
  }
  const shared = new Set<string>()
  if (!h) { await explainWaits($, agents, rows, [], now); return { rows, now, shared } }
  const used = new Set(rows.map(r => slug(r.description)))
  let projectsText = ''
  try { projectsText = String(await $.fs.read(`${h}/${PROJECTS_REL}`)) } catch { projectsText = '' }
  let project = ''
  try { const sp = await sessionProject($, h); project = sp.cwd ? sp.slug : '' } catch { project = '' }
  // Remember this session's agents (start time, tools) so a plugin reload keeps them, and claim their progress files.
  // The claims file's first line names this session's project, so other sessions know where a cwd-owned job shows.
  try {
    // Every live agent, the finished ones too, so a reload still knows which ones handed their report back.
    const live = Object.fromEntries(liveIds.map(id => [id, seen.get(id)!]))
    await $.fs.write(`${dir}/.state/seen-${key}.json`, JSON.stringify(live))
    await $.fs.write(`${dir}/.state/claims-${key}.txt`, [`${PROJECT_LINE}${project}`, ...used].join('\n'))
    if (snap || txBase) await $.fs.write(`${dir}/.state/bg-${key}.json`, JSON.stringify({ snap, txBase }))
  } catch { /* next poll */ }
  // Progress files another open session's agent already shows are skipped here, so no bar appears twice.
  const live = new Map<string, string>()
  let stateFiles: Awaited<ReturnType<typeof $.fs.list>> = []
  try { stateFiles = await $.fs.list(`${dir}/.state`) } catch { stateFiles = [] }
  for (const f of stateFiles) {
    if (!f.name.startsWith('claims-') || f.name === `claims-${key}.txt` || now - f.mtimeMs > 30_000) continue
    const other = f.name.slice(7, -4)
    live.set(other, '')
    try {
      for (const n of String(await $.fs.read(`${dir}/.state/${f.name}`)).split('\n')) {
        if (n.startsWith(PROJECT_LINE)) live.set(other, n.slice(PROJECT_LINE.length).trim())
        else if (n) used.add(n)
      }
    } catch { /* gone */ }
  }
  const projects = new Map<string, string>()
  const jobs: Job[] = []
  const fileNow = new Map<string, FileJob>()
  let files: Awaited<ReturnType<typeof $.fs.list>> = []
  try { files = await $.fs.list(dir) } catch { files = [] }
  for (const f of files) {
    if (f.kind === 'file' && f.name.endsWith(WATCH)) {
      const r = await watchRow($, h, dir, f.name, now)
      if (r) rows.push(r)
      if (r?.state === 'running') jobs.push({ name: r.description, title: '', pct: r.done !== null && r.total ? (100 * r.done) / r.total : null, parent: '' })
      continue
    }
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    const name = f.name.slice(0, -5)
    if (used.has(name) || now - f.mtimeMs > FRESH_MS) continue
    let text = ''
    try { text = String(await $.fs.read(`${dir}/${f.name}`)) } catch { continue }
    const p = parseProgress(text)
    // Only progress files count: inbox.json and other data files have no done/total or step.
    if (!p || DATA_FILES.has(name) || (p.done === null && !p.step)) continue
    let raw: unknown = null
    try { raw = JSON.parse(text) } catch { raw = null }
    const owner = pickOwner(raw)
    if (owner.cwd && !projects.has(owner.cwd)) projects.set(owner.cwd, await projectOfCwd($, h, owner.cwd, projectsText))
    const route = routeOf(owner, { key, project }, live, c => projects.get(c) ?? '')
    if (route === 'skip') continue
    const id = `file:${name}`
    if (route === 'shared') shared.add(id)
    const row: Row = { id, description: name, status: 'running', startedAt: p.startedAt ?? 0, tools: 0, lastTool: '', done: p.done, total: p.total, step: p.step }
    rows.push(row)
    if (raw && typeof raw === 'object') fileNow.set(name, { row, raw: raw as Record<string, unknown> })
    const m = pickMeta(raw)
    const pct = p.done !== null && p.total ? (100 * p.done) / p.total : null
    if (pct === null || pct < 100) jobs.push({ name, title: m.title ?? '', pct, parent: m.parent ? slug(m.parent) : '' })
  }
  await explainWaits($, agents, rows, jobs, now)
  await trackRows($, dir, rows, now)
  await recordFinished($, h, dir, fileNow, now)
  return { rows, now, shared }
}

/**
 * Real elapsed time and time left for every row with a count: a progress file without its own startedAt starts at
 * the file's birth (else when first seen), never at its last write. Time left comes from the rate (rateLeft).
 */
async function trackRows($: EngineInterface, dir: string, rows: Row[], now: number) {
  const counted = rows.filter(r => r.done !== null || !r.startedAt)
  if (!counted.length) return
  const tracks = await readTracks($, dir)
  let changed = false
  for (const r of counted) {
    const k = slug(r.description)
    const prev = tracks[k]
    const born = !prev && r.id.startsWith('file:') && !r.startedAt ? await bornOf($, `${dir}/${k}.json`) : 0
    const t = trackJob(prev, now, r.done, born)
    if (t !== prev) { tracks[k] = t; changed = true }
    // A start the job reported, or its file's birth, can average a rate. First seen cannot (it was already part done),
    // and an agent's start is the agent's, not its count's.
    const base = r.startedAt || (t.start < t.at ? t.start : 0)
    if (!r.startedAt) r.startedAt = t.start
    const left = rateLeft(t, now, r.done, r.total, r.step, /^(file|watch):/.test(r.id) && base ? base : undefined)
    if (left) r.eta = left
  }
  for (const [k, t] of Object.entries(tracks)) if (now - t.seen > TRACK_KEEP_MS) { delete tracks[k]; changed = true }
  if (changed) await $.fs.write(`${dir}/${TRACK_REL}`, JSON.stringify(tracks)).catch(() => undefined)
}

// ---- Done records (done.ts): a job's or agent's impact, kept after its progress file is gone ----

type FileJob = { row: Row; raw: Record<string, unknown> }
// Progress-file jobs this session showed last poll, and the ones already recorded at 100% (by slug and start).
let filesBefore = new Map<string, FileJob>()
const recordedAt = new Set<string>()
// Each live agent's progress file as last read, for its title, why and impact once it is done.
const agentFiles = new Map<string, Record<string, unknown>>()
// Agents whose SubagentHandback was recorded: a later SubagentStop keeps that report.
const handedBack = new Set<string>()

const strOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** A done record for a progress-file job. */
async function recordJob($: EngineInterface, h: string, name: string, j: FileJob, now: number) {
  let session = strOf(j.raw.session)
  if (!session) { try { session = await $.session.id() } catch { session = undefined } }
  await saveDone($, h, {
    slug: name, title: strOf(j.raw.title) ?? '', why: strOf(j.raw.why), impact: impactLines(j.raw.impact), step: j.row.step || undefined,
    started: j.row.startedAt || undefined, finished: now, session, kind: 'job',
  }).catch(() => undefined)
}

/**
 * A job counts as finished when its file is gone since the last poll, or when it first reports done == total.
 * A file that is still there but no longer shown (stale, or another session's now) is not a finish.
 * Shell command rows (shell-*) are not tasks and keep no record.
 */
async function recordFinished($: EngineInterface, h: string, dir: string, now: Map<string, FileJob>, at: number) {
  for (const [name, j] of now) {
    const r = j.row
    const k = `${name}@${r.startedAt}`
    if (r.done !== null && r.total !== null && r.done >= r.total && !recordedAt.has(k) && !name.startsWith('shell-')) {
      recordedAt.add(k)
      await recordJob($, h, name, j, at)
    }
  }
  for (const [name, j] of filesBefore) {
    if (now.has(name) || name.startsWith('shell-')) continue
    if (await $.fs.exists(`${dir}/${name}.json`).catch(() => true)) continue
    const k = `${name}@${j.row.startedAt}`
    // Already recorded at 100%: record again only to pick up an impact written since.
    if (recordedAt.has(k) && !impactLines(j.raw.impact).length) continue
    recordedAt.add(k)
    await recordJob($, h, name, j, at)
  }
  filesBefore = now
  if (recordedAt.size > 500) recordedAt.clear()
}

/**
 * A done record for an agent: its final report as a short impact (done.ts summarize), unless its progress file named
 * an impact, or a progress_report with impact recorded it in the last 30 minutes.
 */
async function recordAgent($: EngineInterface, agentId: string, report: string, txPathOf = '') {
  const h = await resolveHome($)
  if (!h) return
  let desc = ''
  try { desc = (await $.agent.list()).find(a => a.id === agentId)?.description ?? '' } catch { desc = '' }
  if (!desc && txPathOf) {
    try { desc = String((JSON.parse(String(await $.fs.read(txPathOf.replace(/\.jsonl$/, '.meta.json')))) as { description?: unknown }).description ?? '') } catch { desc = '' }
  }
  if (!desc) return
  const key = slug(desc)
  const raw = agentFiles.get(agentId) ?? {}
  const now = await $.clock.now()
  let impact = impactLines(raw.impact)
  if (!impact.length) {
    try {
      const prev = parseDone(String(await $.fs.read(`${h}/${DONE_REL}/${key}.json`)))
      if (prev && prev.impact.length && prev.kind === 'job' && now - prev.finished < 30 * 60_000) impact = prev.impact
    } catch { /* none */ }
  }
  if (!impact.length) impact = summarize(report)
  let session = ''
  try { session = await $.session.id() } catch { session = '' }
  await saveDone($, h, {
    slug: key, title: strOf(raw.title) ?? desc, why: strOf(raw.why), impact, step: strOf(raw.step),
    started: seen.get(agentId)?.startedAt, finished: now, session: session || undefined, kind: 'agent',
  }).catch(() => undefined)
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
  if (!sessionKey) { try { sessionKey = keyOf(await $.session.id()) } catch { sessionKey = 'main' } }
  return sessionKey
}

// Each session writes its own subagents to agents-<session>.txt, so two open sessions never overwrite each other.
// Job files that name this session (or its project) go to jobs-<session>.txt. Job files that name no owner are the
// same for every session, so they go to one shared jobs.txt.
async function poll($: EngineInterface) {
  await touchShells($)
  const { rows, now, shared } = await collect($)
  const home = await resolveHome($)
  if (!home) return
  await sessionKeyOf($)
  const agents = rows.filter(r => !r.id.startsWith('file:'))
  const mine = rows.filter(r => r.id.startsWith('file:') && !shared.has(r.id))
  const jobs = rows.filter(r => shared.has(r.id))
  const base = `${dirOf(home)}/.lines`
  try { await $.fs.write(`${base}/agents-${sessionKey}.txt`, lines(agents, now).join('\n')) } catch { /* next poll */ }
  try { await $.fs.write(`${base}/jobs-${sessionKey}.txt`, lines(mine, now).join('\n')) } catch { /* next poll */ }
  try { await $.fs.write(`${base}/jobs.txt`, lines(jobs, now).join('\n')) } catch { /* next poll */ }
}

async function statusLineCommand($: EngineInterface): Promise<string | undefined> {
  try {
    const v = (await $.settings.read({ key: 'statusLine' })) as { type?: string; command?: string } | undefined
    return v && v.type === 'command' && typeof v.command === 'string' ? v.command : undefined
  } catch { return undefined }
}

const snippet = SNIPPET

/** Plain `/progress-bar`: the bars as text, and the Status panel opens beside the chat once the script is installed. */
async function showAndOpen($: EngineInterface): Promise<string> {
  const text = await show($)
  const h = await resolveHome($)
  if (h && (await $.fs.exists(`${h}/${SCRIPT_REL}`).catch(() => false))) {
    let note = 'Status panel opened.'
    try { note = await panelCommand($, h, '') } catch { /* the text still shows */ }
    return `${text}\n${note}`
  }
  return text
}

async function show($: EngineInterface) {
  const { rows, now } = await collect($)
  const h = await resolveHome($)
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

/** The merged settings with the status line pointing at the plugin's script, unless a settings file already does. */
export function withStatusLine<S extends Record<string, unknown>>(s: S): S {
  const cur = s.statusLine as { command?: unknown } | undefined
  if (cur && typeof cur.command === 'string' && cur.command.includes(SCRIPT_REL)) return s
  return { ...s, statusLine: { type: 'command', command: `~/${SCRIPT_REL}`, refreshInterval: 1 } }
}

/** The status line command the settings files hold (highest precedence first), before this plugin adds its own. */
async function ownStatusLine($: EngineInterface): Promise<string | undefined> {
  for (const source of ['policy', 'flag', 'local', 'project', 'user'] as const) {
    try {
      const v = (await $.settings.read({ source })).statusLine as { type?: string; command?: string } | undefined
      if (v && v.type === 'command' && typeof v.command === 'string') return v.command
    } catch { /* next source */ }
  }
  return undefined
}

/**
 * First run and every session start: writes the status line script, group.py and the rest, chaining a status line
 * the person already had (as setup does). The settings.read hook then points the status line at it, so nothing
 * needs setting up by hand.
 */
async function ensureInstalled($: EngineInterface) {
  const h = await resolveHome($)
  if (!h) return
  const path = `${h}/${SCRIPT_REL}`
  const current = await ownStatusLine($)
  const prev = await chainable($, h, current) ?? await installedPrev($, h, path)
  const script = statusScript(prev)
  let old = ''
  try { old = String(await $.fs.read(path)) } catch { old = '' }
  if (old !== script) {
    await $.fs.write(path, script)
    await $.process.run(['chmod', '+x', path]).catch(() => undefined)
  }
  await writeLib($, h)
}

async function setup($: EngineInterface) {
  const h = await resolveHome($)
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  const current = await ownStatusLine($) ?? await statusLineCommand($)
  const path = `${h}/${SCRIPT_REL}`
  const prev = await chainable($, h, current) ?? await installedPrev($, h, path)
  await $.fs.write(path, statusScript(prev))
  await writeLib($, h)
  await $.process.run(['chmod', '+x', path]).catch(() => undefined)
  const chain = prev ? `\nIt runs your current status line after the bars: ${prev}` : ''
  const done = current?.includes(SCRIPT_REL)
    ? 'Your settings already point at it.'
    : `Add this to ~/.claude/settings.json (replacing any "statusLine" there):\n  ${snippet}`
  return `Wrote ${path}, with group.py, events.py and checkpoint.py beside it.${chain}\n${done}\n"refreshInterval": 1 redraws the status line every second.`
}




/** Rewrites an installed script and group.py with this version's, keeping the chained command. No-op when not installed. */
async function refreshInstalled($: EngineInterface) {
  const h = await resolveHome($)
  const path = `${h}/${SCRIPT_REL}`
  if (!h || !(await $.fs.exists(path).catch(() => false))) return
  await $.fs.write(path, statusScript(await installedPrev($, h, path)))
  await writeLib($, h)
}

/** `/progress-bar panel [on|off]`: the panel runs the installed script, so it needs setup first. */
async function panel($: EngineInterface, arg: string): Promise<string> {
  const h = await resolveHome($)
  if (h && arg !== 'off' && !(await $.fs.exists(`${h}/${SCRIPT_REL}`).catch(() => false))) return 'The Status panel draws the status line script. Run `/progress-bar setup` first.'
  if (arg === 'on') await refreshInstalled($)
  return panelCommand($, h, arg)
}

/** `/progress-bar setup mac-clicks [off]`: also refreshes group.py, which draws the header links. */
async function setupMacClicks($: EngineInterface, mode: 'on' | 'off') {
  const h = await resolveHome($)
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  const text = await macClicks($, h, mode)
  if (mode === 'on' && text.startsWith('Click to fold is on')) await writeLib($, h)
  return text
}

/** `/progress-bar todo ...`: list, add, done, clear in this session's project list (project.ts). */
async function todo($: EngineInterface, rest: string): Promise<string> {
  const h = await resolveHome($)
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  const proj = await sessionProject($, h)
  const file = proj.path
  let text = ''
  try { text = String(await $.fs.read(file)) } catch { /* none yet */ }
  const todoList = (t: string) => {
    const l = listOf(t)
    return l.startsWith('No to-dos.') ? `No to-dos for ${proj.slug}. Add one with /progress-bar todo add [name] <text>` : l
  }
  const [verb = '', ...more] = rest.split(/\s+/)
  const arg = rest.slice(verb.length).trim()
  switch (verb.toLowerCase()) {
    case '':
    case 'list':
      return todoList(text)
    case 'add': {
      if (!arg || /^\[[^\]]+\]$/.test(arg)) return 'Usage: /progress-bar todo add [name] <text>'
      const r = todoAdd(text, arg)
      await $.fs.write(file, r.text)
      return `Added to [${r.heading}].\n${todoList(r.text)}`
    }
    case 'done': {
      if (!more.length) return 'Usage: /progress-bar todo done <n|text>'
      const r = todoDone(text, arg)
      if (!r) return `No open to-do matches "${arg}".\n${todoList(text)}`
      await $.fs.write(file, r.text)
      return `Done: ${r.item.text}`
    }
    case 'clear': {
      const r = todoClear(text)
      if (r.removed) await $.fs.write(file, r.text)
      return r.removed ? `Removed ${r.removed} done item${r.removed === 1 ? '' : 's'}.` : 'Nothing done to clear.'
    }
    default:
      return USAGE
  }
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

// Set when the settings.read hook runs on a merged read. Another plugin's hook that answers first skips it.
let hookApplied = false
const HOOK_CHECK_MS = 15_000

export const register: Register = (on, options) => {
  registerPanel(on)
  // Zero setup: on by default, off from /config (progress-bar.statusLine, progress-bar.openPanel).
  const autoStatusLine = options?.statusLine !== false
  const autoPanel = options?.openPanel !== false

  // The status line points at the plugin's script, unless a settings file already does. A status line the person
  // had is chained inside the script (its prev= line), so it still prints below the bars.
  if (autoStatusLine) {
    on('settings.read', async ($, e, next) => {
      const s = await next(e)
      if (!e.source) hookApplied = true
      return e.source ? s : withStatusLine(s)
    })
  }

  // progress_report: a bar with this session's id and folder filled in.
  on('tool.call', { tool: 'mcp__progress-bar__progress_report' }, async ($, e) => {
    const i = e as unknown as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const text = await writeReport($, await resolveHome($), { title: str(i.title) ?? '', done: num(i.done), total: num(i.total), step: str(i.step), why: str(i.why), parent: str(i.parent), slug: str(i.slug), impact: str(i.impact), finished: i.finished === true })
    await poll($).catch(() => undefined)
    return { result: text }
  })

  // The main session's own task list shows as one bar, with no skill needed. Subagents already have their lines.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && !('deny' in r && r.deny)) {
      const todos = (e as unknown as { todos?: Task[] }).todos
      if (Array.isArray(todos)) { await mirrorTasks($, await resolveHome($), todos).catch(() => undefined); await poll($).catch(() => undefined) }
    }
    return r
  })
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && !('deny' in r && r.deny) && !r.isError) {
      taskCreated(e as unknown as { subject?: unknown; activeForm?: unknown }, r.result)
      await mirrorTasks($, await resolveHome($), taskList()).catch(() => undefined)
      await poll($).catch(() => undefined)
    }
    return r
  })
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && !('deny' in r && r.deny) && !r.isError) {
      taskUpdated(e as unknown as { taskId?: unknown; status?: unknown; subject?: unknown; activeForm?: unknown })
      await mirrorTasks($, await resolveHome($), taskList()).catch(() => undefined)
      await poll($).catch(() => undefined)
    }
    return r
  })

  // A main-session Bash command running over a minute, or in the background, shows as a working row.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const h = await resolveHome($)
    if (!h) return next(e)
    const b = e as unknown as { command?: unknown; description?: unknown; run_in_background?: unknown }
    const description = typeof b.description === 'string' ? b.description : ''
    const command = typeof b.command === 'string' ? b.command : ''
    let over = false
    let path = ''
    void $.clock.sleep(LONG_BASH_MS).then(async () => { if (!over) { path = await startShell($, h, description, command); void poll($).catch(() => undefined) } }).catch(() => undefined)
    let r
    try { r = await next(e) } finally { over = true }
    if (path) await endShell($, path)
    const taskId = !('deny' in r && r.deny) ? (r.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId : undefined
    if (typeof taskId === 'string' && taskId) { await startShell($, h, description, command, taskId); void poll($).catch(() => undefined) }
    return r
  })

  // At each stop, background shells the session no longer lists as running are over.
  on('classic.Stop', async ($, e, next) => {
    const i = e as unknown as { background_tasks?: { id: string; status?: string }[]; transcript_path?: unknown }
    const running = i.background_tasks
    if (Array.isArray(running)) await endBackground($, running).catch(() => undefined)
    if (typeof i.transcript_path === 'string' && i.transcript_path.endsWith('.jsonl')) txBase = i.transcript_path.slice(0, -6)
    snap = snapOf(running, await $.clock.now()) ?? snap
    return next(e)
  })

  // A subagent's turn ended: the session's in-flight tasks then, and where its transcript is.
  on('classic.SubagentStop', async ($, e, next) => {
    const i = e as unknown as { agent_id?: unknown; agent_transcript_path?: unknown; background_tasks?: unknown }
    if (typeof i.agent_id === 'string' && typeof i.agent_transcript_path === 'string' && i.agent_transcript_path) txOf.set(i.agent_id, i.agent_transcript_path)
    snap = snapOf(i.background_tasks, await $.clock.now()) ?? snap
    // Its turn ended: record its final report as its impact, unless its SubagentHandback was recorded already.
    const id = typeof i.agent_id === 'string' ? i.agent_id : ''
    const tx = typeof i.agent_transcript_path === 'string' ? i.agent_transcript_path : ''
    if (id && tx && !handedBack.has(id)) {
      try {
        const rep = reportOf((await $.process.run(['tail', '-c', String(TX_TAIL), tx], { timeoutMs: 5000 })).stdout)
        if (rep.text) await recordAgent($, id, rep.text, tx)
      } catch { /* no transcript */ }
    }
    return next(e)
  })

  // The channel's private keys never reach the model: a Read, Grep or Bash call naming that folder is refused.
  on('tool.call', async ($, e, next) => {
    const i = e as unknown as { file_path?: unknown; path?: unknown; command?: unknown }
    const text = [i.file_path, i.path, i.command].filter(x => typeof x === 'string').join(' ')
    if (/(^|[\s/"'])\.claude-progress\/channel\/keys(\/|\b)|channel\/keys\/(enc|sign)\.pem/.test(text)) return { deny: 'progress-bar: the secure channel private keys stay private. Nothing may read them.' }
    const input = e as unknown as Record<string, unknown>
    const stopped = e.tool === 'TaskStop' ? String(input.task_id ?? input.shell_id ?? '') : ''
    if (!e.agentId) {
      const r = await next(e)
      if (stopped && !('deny' in r && r.deny)) dropTask(stopped)
      return r
    }
    const s = seen.get(e.agentId) ?? { startedAt: await $.clock.now(), tools: 0, lastTool: '' }
    s.tools += 1
    s.lastTool = String(e.tool)
    s.lastWhat = toolWhat(input)
    seen.set(e.agentId, s)
    const r = await next(e)
    // When its last call ended, and a background task it started (a background Bash, a Monitor).
    s.lastAt = await $.clock.now()
    if (!('deny' in r && r.deny)) {
      const t = bgLaunch(String(e.tool), input, r.result, s.lastAt)
      if (t) s.bg = [...(s.bg ?? []).filter(x => x.id !== t.id), t]
      if (stopped) dropTask(stopped)
      // The agent's final report: what it changed, kept in its done record.
      if (e.tool === 'SubagentHandback' && typeof input.message === 'string' && input.message.trim()) {
        handedBack.add(e.agentId)
        await recordAgent($, e.agentId, input.message).catch(() => undefined)
      }
    }
    return r
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress-bar', description: 'Show live progress bars, or set up the status line', argumentHint: '[setup [mac-clicks [off]] | demo | action [list|add|done|skip <reason>] | clear | todo | panel [on|off] | autonext [on|off|ask] | checkpoint [label] | inbox [setup] | channel | send <file> to <name> | say <name> <text> | fold <section>]' })
    await $.tool.register(SEND_TOOL).catch(() => undefined)
    await $.tool.register(ACTION_TOOL).catch(() => undefined)
    await $.tool.register(PROGRESS_TOOL).catch(() => undefined)
    // The status line script and group.py are written on the first run and follow the plugin version after that.
    // With the status line turned off in /config, only a script that is already installed is refreshed.
    await (autoStatusLine ? ensureInstalled($) : refreshInstalled($)).catch(() => undefined)
    // The settings.read hook can be skipped by another plugin's hook that answers first: then the panel offers
    // "Turn on status line" and the Log tab says why, once. The engine's merge runs around load, so check a bit later.
    if (autoStatusLine) {
      void $.clock.sleep(HOOK_CHECK_MS)
        .then(async () => noteStatusLine($, await resolveHome($), hookApplied, await ownStatusLine($)))
        .catch(() => undefined)
    }
    void poll($).catch(() => undefined)
    $.clock.every(5000, () => { void poll($).catch(() => undefined); void tickAutonext($).catch(() => undefined) })
    await startPanel($, await resolveHome($), autoPanel)
    const home = await resolveHome($)
    void backfillChat($, home).then(() => pollChannel($, home)).catch(() => undefined)
    $.clock.every(CHANNEL_EVERY, () => pollChannel($, home))
    // Action needed: checks every 30 s, and the in-app pane for actions not shown in the last 10 min.
    void tickActions($, home).catch(() => undefined)
    $.clock.every(CHECK_EVERY, () => tickActions($, home))
    // Usage meter: a fresh reading when the saved one is over 30 min old, one session per machine.
    void probeUsage($, home).catch(() => undefined)
    $.clock.every(USAGE_CHECK, () => probeUsage($, home))
    return next(e)
  })

  // Action needed: the model asks the person to run a step only they can do.
  on('tool.call', { tool: 'mcp__progress-bar__action_add' }, async ($, e) => {
    const i = e as unknown as { title?: unknown; command?: unknown; why?: unknown; check?: unknown; global?: unknown }
    const s = (v: unknown) => (typeof v === 'string' ? v : '')
    return { result: await addFromClaude($, await resolveHome($), { title: s(i.title), command: s(i.command), why: s(i.why), check: s(i.check), global: i.global === true }) }
  })

  // The gate: while an action is open, the person's prompts are held (slash commands always pass).
  on('prompt.submit', async ($, e, next) => {
    if (!isGated(e)) return next(e)
    const drop = await gatePrompt($, await resolveHome($), e.text)
    return drop === null ? next(e) : { drop }
  })

  // "send this to <name>": the model calls channel_send. The engine's permission prompt asks the person first.
  on('tool.call', { tool: 'mcp__progress-bar__channel_send' }, async ($, e) => {
    const input = e as unknown as { file?: unknown; to?: unknown }
    const text = await sendFile($, await resolveHome($), String(input.file ?? ''), String(input.to ?? '').toLowerCase())
    return { result: text }
  })

  on('command.run', { command: 'progress-bar' }, async ($, e) => {
    const raw = (e.args ?? '').trim()
    const arg = raw.toLowerCase()
    const text =
      arg === '' ? await showAndOpen($)
      : arg === 'setup' ? await setup($)
      : arg.startsWith('setup ') && parseMacClicks(arg.slice(6)) ? await setupMacClicks($, parseMacClicks(arg.slice(6))!)
      : arg === 'demo' ? await demo($)
      : arg === 'clear' ? await clear($)
      : /^panel\b/.test(arg) ? await panel($, arg.slice(5).trim())
      : /^actions?\b/.test(arg) ? await actionCommand($, await resolveHome($), raw.replace(/^\S+\s*/, ''))
      : /^autonext\b/.test(arg) ? await autonextCommand($, arg.slice(8))
      : /^todo\b/.test(arg) ? await todo($, raw.slice(4).trim())
      : /^(checkpoint|away)\b/.test(arg) ? await checkpointCommand($, await resolveHome($), raw.replace(/^\S+\s*/, ''))
      : /^inbox\b/.test(arg) ? await inboxCommand($, await resolveHome($), arg.slice(5))
      : /^channel\b/.test(arg) ? await channelCommand($, await resolveHome($), raw.slice(7))
      : /^send\b/.test(arg) ? await sendCommand($, await resolveHome($), raw.slice(4))
      : /^say\b/.test(arg) ? await sayCommand($, await resolveHome($), raw.slice(3))
      : /^(fold|unfold|toggle)\b/.test(arg) ? await fold($, arg)
      : USAGE
    return { text }
  })
}
