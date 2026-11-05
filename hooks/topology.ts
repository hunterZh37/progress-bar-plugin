import type { EngineInterface } from 'claude-code'
import type { TopoConfig, TopoHealth, TopoMachine, TopoService } from '../types'

export type { TopoConfig, TopoHealth, TopoMachine, TopoService }

// The Topology tab: the machines, what runs on each and what data moves between them, smallest first. Closed, each
// machine is one row with its link to the data host. A press opens it, a press on one of its jobs opens that job.
// Machines, IPs and services come from ~/.claude-progress/topology.json (written once with the defaults below).
// Each running row is placed on a machine the same way the List tab labels it: a "<host>: " row prefix or a title
// that starts with a machine name or alias ("Hunty board lists", "Personal-mac tools setup"), else this machine.
// Flows: a job on a helper machine reads from the data host, and writes back only when its progress file has `writes`.
// The link between the two says what moves. Services (Jev API, Claude, GitHub) show under the open machine that uses them
// while a running job matches their pattern.
// Health: this machine is online. A machine with a `status` file (a .lines/*.txt heartbeat such as linux.txt) is
// online while that file is fresh and says ✓, else offline. Others are unknown: the plugin runs no network checks.

export const TOPOLOGY_REL = '.claude-progress/topology.json'
const LINES_REL = '.claude-progress/.lines'
/** A heartbeat file older than this means the machine is offline. */
export const HEARTBEAT_MS = 2 * 60_000

/** A running or waiting row as the tab needs it. `pct` null draws no percent. */
export type TopoJob = { name: string; title: string; pct: number | null; mark: string; step: string; reads?: string; writes?: string; proc?: boolean; waitOn?: string; why?: string }
export type TopoQueue = { count: number; top: string }
export type Flow = { from: string; to: string; label: string; jobs: string[]; service?: boolean }
export type Seg = { text: string; color?: 'green' | 'red' | 'cyan'; dim?: boolean; bold?: boolean }
/** One row of the tab. `press`: the open-card key a press on it flips. */
export type TopoLine = { segs: Seg[]; press?: string }

export const DEFAULT_TOPOLOGY: TopoConfig = {
  dbRole: 'helper',
  machines: [
    { id: 'work-mac', ip: '100.78.76.82', role: 'data', aliases: ['mac', 'local'], about: ['Postgres nombot ~68 GB, repos, keys', 'NomBot live, label jobs, every DB write'] },
    { id: 'hunty', ip: '100.66.167.126', role: 'compute', aliases: ['linux'], about: ['12 cores + GPU, local model', 'DB read-only as helper'], status: 'linux.txt' },
    { id: 'personal-mac', ip: '100.119.223.11', role: 'compute', aliases: ['personal'], about: ['M2 Pro 32 GB, Claude on personal Max', 'DB read-only, no repo copy'] },
  ],
  services: [
    { name: 'Jev API', match: '\\bjev\\b|label', from: 'work-mac' },
    { name: 'Claude', match: '\\bclaude\\b' },
    { name: 'GitHub', match: 'github|git push|\\bpr\\b' },
  ],
}

const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined)
const strs = (x: unknown) => (Array.isArray(x) ? x.map(str).filter((s): s is string => !!s) : undefined)

/** topology.json as a config. Missing or bad parts fall back to the defaults. */
export function parseTopology(text: string): TopoConfig {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(text) as Record<string, unknown> } catch { return DEFAULT_TOPOLOGY }
  if (!raw || typeof raw !== 'object') return DEFAULT_TOPOLOGY
  const machines = (Array.isArray(raw.machines) ? raw.machines : []).flatMap((m): TopoMachine[] => {
    const r = (m ?? {}) as Record<string, unknown>
    const id = str(r.id)
    if (!id) return []
    return [{ id: id.toLowerCase(), ip: str(r.ip), role: r.role === 'data' ? 'data' : 'compute', aliases: strs(r.aliases)?.map(a => a.toLowerCase()), about: strs(r.about), status: str(r.status) }]
  })
  const services = (Array.isArray(raw.services) ? raw.services : []).flatMap((s): TopoService[] => {
    const r = (s ?? {}) as Record<string, unknown>
    const name = str(r.name)
    const match = str(r.match)
    if (!name || !match) return []
    try { new RegExp(match, 'i') } catch { return [] }
    return [{ name, match, from: str(r.from)?.toLowerCase() }]
  })
  return {
    self: str(raw.self)?.toLowerCase(),
    dbRole: str(raw.dbRole) ?? DEFAULT_TOPOLOGY.dbRole,
    machines: machines.length ? machines : DEFAULT_TOPOLOGY.machines,
    services: Array.isArray(raw.services) ? services : DEFAULT_TOPOLOGY.services,
  }
}

/** The data host: the machine with role data, else the first. */
export const dataHost = (c: TopoConfig) => (c.machines.find(m => m.role === 'data') ?? c.machines[0])?.id ?? 'local'

/** The machine id a name means (its id or an alias, any case), or '' for none. */
export function resolveMachine(c: TopoConfig, name: string): string {
  const n = name.trim().toLowerCase()
  if (!n) return ''
  return c.machines.find(m => m.id === n || (m.aliases ?? []).includes(n))?.id ?? ''
}

const LEAD = /^([A-Za-z0-9_.-]+)(?::|\s|$)/
const PREFIX = /^([A-Za-z0-9_.-]+):\s/

/**
 * The machine a job runs on: a title that starts with a known machine ("Hunty board lists"), a "<host>: " row prefix
 * (a configured machine, else the host itself), else `self`.
 */
export function jobHost(c: TopoConfig, name: string, title: string, self: string, extra: string[] = []): string {
  const lead = LEAD.exec(title.split(' · ')[0]!)?.[1] ?? ''
  const byLead = resolveMachine(c, lead) || (extra.includes(lead.toLowerCase()) ? lead.toLowerCase() : '')
  if (byLead) return byLead
  const pre = PREFIX.exec(name)?.[1]
  if (pre) return resolveMachine(c, pre) || pre.toLowerCase()
  const nameLead = LEAD.exec(name)?.[1] ?? ''
  return resolveMachine(c, nameLead) || self
}

/** A job's title without its machine word: "Hunty board lists past 25 seats" on hunty is "Board lists past 25 seats". */
export function bareTitle(c: TopoConfig, title: string, host: string): string {
  const t = title.split(' · ')[0]!.trim()
  const lead = LEAD.exec(t)?.[1] ?? ''
  const hit = resolveMachine(c, lead) === host || lead.toLowerCase() === host
  if (!hit) return t
  const rest = t.slice(lead.length).replace(/^[\s:]+/, '')
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : t
}

/** A heartbeat file ("▶ hunty ✓ helper healthy · load 0.37 on 12 cores") as health. Stale or missing is offline. */
export function parseHealth(text: string | null, mtimeMs: number, now: number): TopoHealth {
  if (text === null) return { state: 'offline', note: 'no heartbeat file' }
  if (now - mtimeMs > HEARTBEAT_MS) return { state: 'offline', note: `heartbeat ${Math.round((now - mtimeMs) / 60_000)}m old` }
  const line = text.split('\n').find(l => /[✓✗✖]/.test(l) && !/\d%/.test(l)) ?? ''
  const load = /load ([\d.]+)(?: on (\d+) cores)?/.exec(line)
  const loadText = load ? `load ${load[1]}${load[2] ? `/${load[2]}` : ''}` : undefined
  if (!line) return { state: 'online', load: loadText }
  if (/[✗✖]|\b(down|unreachable|offline|unhealthy)\b/i.test(line)) return { state: 'offline', note: line.replace(/^\W+/, '').trim(), load: loadText }
  return { state: 'online', load: loadText }
}

/** Running jobs placed on machines, in config order, then any other host the rows name. */
export function placeJobs(c: TopoConfig, jobs: TopoJob[], self: string, extra: string[] = []): Map<string, TopoJob[]> {
  const out = new Map<string, TopoJob[]>(c.machines.map(m => [m.id, []]))
  for (const j of jobs) {
    const h = jobHost(c, j.name, j.title, self, extra)
    if (!out.has(h)) out.set(h, [])
    out.get(h)!.push(j)
  }
  return out
}

/**
 * What moves right now. A helper's job reads from the data host (its `reads` names what, else the data host's
 * database). It writes back only when it declares `writes`. A service shows for each running job its pattern matches
 * (name, title, step, reads, writes). Same from, to and label merge into one flow listing every job.
 */
export function flowsOf(c: TopoConfig, placed: Map<string, TopoJob[]>): Flow[] {
  const data = dataHost(c)
  const out: Flow[] = []
  const add = (f: Omit<Flow, 'jobs'>, job: string) => {
    const hit = out.find(x => x.from === f.from && x.to === f.to && x.label === f.label)
    if (hit) { if (!hit.jobs.includes(job)) hit.jobs.push(job) } else out.push({ ...f, jobs: [job] })
  }
  for (const [host, jobs] of placed) {
    for (const j of jobs) {
      if (j.mark === '✔' || j.mark === '⏸' || j.proc) continue
      const t = bareTitle(c, j.title, host)
      if (host !== data) {
        add({ from: data, to: host, label: 'reads' }, t)
        if (j.writes) add({ from: host, to: data, label: 'writes' }, t)
      }
      const hay = [j.name, j.title, j.step, j.reads ?? '', j.writes ?? ''].join(' ')
      for (const s of c.services) {
        if (new RegExp(s.match, 'i').test(hay)) add({ from: s.from ?? host, to: s.name, label: s.name, service: true }, t)
      }
    }
  }
  return out
}

/** Open to-dos per machine: how many and the top one (by priority, its "(after X)" left out). */
export function queuesOf(c: TopoConfig, todos: { owner: string; text: string }[], self: string): Map<string, TopoQueue> {
  const out = new Map<string, TopoQueue>()
  for (const t of todos) {
    const o = t.owner.toLowerCase()
    if (o === 'you') continue
    const id = resolveMachine(c, o) || (o === 'todo' ? self : o)
    const top = t.text.replace(/^\d+\.\s+/, '').replace(/\s*\(after\s+[^)]+\)\s*$/i, '').split(' | ')[0]!.trim()
    const q = out.get(id)
    if (q) q.count++
    else out.set(id, { count: 1, top })
  }
  return out
}

export type TopoInput = {
  cfg: TopoConfig
  self: string
  jobs: TopoJob[]
  health: Record<string, TopoHealth>
  queues: Map<string, TopoQueue>
  extra?: string[]
}

type State = 'busy' | 'idle' | 'offline' | 'unknown'
const cut = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)
const pad = (s: string, n: number) => cut(s, n).padEnd(n)

/** A machine's state: offline (its heartbeat says so), busy (a job runs), idle (known online), else unknown. */
function stateOf(h: TopoHealth | undefined, jobs: TopoJob[]): State {
  if (h?.state === 'offline') return 'offline'
  if (jobs.some(active)) return 'busy'
  return h?.state === 'online' ? 'idle' : 'unknown'
}

const active = (j: TopoJob) => j.mark !== '✔' && j.mark !== '⏸' && !j.proc
/** Rows a machine lists: running jobs, and waiting ones only when they say what they wait on. */
const shown = (jobs: TopoJob[]) => jobs.filter(j => j.mark !== '⏸' || !!j.waitOn)
const jobTail = (j: TopoJob) => (j.mark === '⏸' ? 'waits' : j.mark === '✔' ? 'done' : j.proc ? '' : j.pct === null ? '…' : `${Math.round(j.pct)}%`)

/** Segments cut to `w` columns in all, the last one that fits ending in "…". */
export function cutLine(l: Seg[], w: number): Seg[] {
  const out: Seg[] = []
  let left = w
  for (const s of l) {
    if (left <= 0) break
    out.push({ ...s, text: cut(s.text, left) })
    left -= Math.min(s.text.length, left)
  }
  return out
}

/** The width a row takes. */
export const lineWidth = (l: TopoLine) => l.segs.reduce((a, s) => a + s.text.length, 0)
/** A row as plain text (for tests and logs). */
export const plainLine = (l: TopoLine) => l.segs.map(s => s.text).join('').replace(/\s+$/, '')

/**
 * A helper's link to the data host, read from the helper's side: "◀─ reads ── work-mac" (it reads from there),
 * "◀─ reads + writes ─▶ work-mac" both ways, "── writes ─▶ work-mac" back only, "(N)" when several jobs share it,
 * "┄┄ work-mac" for nothing moving and "─ ✕ ─ work-mac" when the helper is offline. Narrow panes drop the dashes.
 */
export function linkOf(flows: Flow[], data: string, helper: string, offline: boolean, narrow = false): Seg {
  if (offline) return { text: narrow ? '✕' : `─ ✕ ─ ${data}`, color: 'red' }
  const r = flows.find(f => f.from === data && f.to === helper && !f.service)
  const w = flows.find(f => f.from === helper && f.to === data && !f.service)
  const n = Math.max(r?.jobs.length ?? 0, w?.jobs.length ?? 0)
  const count = n > 1 ? ` (${n})` : ''
  if (r && w) return { text: narrow ? `◀ reads + writes${count} ▶` : `◀─ reads + writes${count} ─▶ ${data}`, color: 'green' }
  if (r) return { text: narrow ? `◀ reads${count}` : `◀─ reads${count} ── ${data}`, color: 'green' }
  if (w) return { text: narrow ? `writes${count} ▶` : `── writes${count} ─▶ ${data}`, color: 'green' }
  return { text: narrow ? '┄' : `┄┄ ${data}`, dim: true }
}

/** The key that opens a machine, or one of its jobs, in the panel's open cards. */
export const machineKey = (id: string) => `topo:${id}`
export const jobKey = (id: string, name: string) => `topo:${id}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`

/**
 * The whole tab as rows, smallest first. Closed, each machine is one row: "▸ ● hunty  1 job · load 0.93/12" and its
 * link to the data host. A row with `press` is a button that opens or closes that key. An open machine lists its jobs
 * (percent and what each moves), the services it calls and its queued count. An open job shows its reads, writes,
 * step, why and what it waits on.
 */
export function renderTopology(inp: TopoInput, width: number, open: ReadonlySet<string> = new Set()): TopoLine[] {
  const W = Math.min(120, Math.max(20, width))
  const narrow = W < 60
  const { cfg } = inp
  const data = dataHost(cfg)
  const placed = placeJobs(cfg, inp.jobs, inp.self, inp.extra)
  const flows = flowsOf(cfg, placed)
  const ids = [...placed.keys()]
  const healthOf = (id: string): TopoHealth | undefined => (id === inp.self ? { ...inp.health[id], state: 'online' } : inp.health[id])
  const states = new Map(ids.map(id => [id, stateOf(healthOf(id), placed.get(id)!)]))
  const idW = Math.max(...ids.map(id => id.length))
  const infos = new Map(ids.map(id => {
    const s = states.get(id)!
    const n = placed.get(id)!.filter(active).length
    return [id, [id === data ? 'data host' : '', s === 'busy' ? `${n} job${n === 1 ? '' : 's'}` : s, narrow ? '' : healthOf(id)?.load ?? ''].filter(Boolean).join(' · ')]
  }))
  const infoW = narrow ? 0 : Math.max(...[...infos.values()].map(x => x.length))
  const out: TopoLine[] = []
  const row = (segs: Seg[], press?: string): TopoLine => ({ segs: cutLine(segs.filter(x => x.text), W), ...(press ? { press } : {}) })

  for (const id of ids) {
    const s = states.get(id)!
    const isOpen = open.has(machineKey(id))
    const info = infos.get(id)!
    out.push(row([
      { text: `${isOpen ? '▾' : '▸'} ` },
      { text: '● ', color: s === 'busy' ? 'green' : s === 'offline' ? 'red' : undefined, dim: s === 'idle' || s === 'unknown' },
      { text: narrow ? id : id.padEnd(idW), bold: true },
      { text: `  ${narrow ? info : info.padEnd(infoW)}`, color: s === 'offline' ? 'red' : undefined, dim: s !== 'offline' },
      ...(id === data ? [] : [{ text: '  ' }, linkOf(flows, data, id, s === 'offline', narrow)]),
    ], machineKey(id)))
    if (!isOpen) continue
    const jobs = shown(placed.get(id)!)
    if (!jobs.length) out.push(row([{ text: `    ${s === 'offline' ? 'unreachable' : 'no jobs'}`, dim: true }]))
    for (const j of jobs) {
      const k = jobKey(id, j.name)
      const jOpen = open.has(k)
      const tail = jobTail(j)
      const moves = id === data ? [j.reads ? 'reads' : '', j.writes ? 'writes' : ''].filter(Boolean).join(' + ') : active(j) ? (j.writes ? 'reads + writes' : 'reads') : ''
      const room = Math.min(32, W - 6 - (tail ? tail.length + 2 : 0) - (moves && !narrow ? moves.length + 2 : 0))
      const dim = !active(j)
      out.push(row([
        { text: `    ${jOpen ? '▾' : '▸'} `, dim: true },
        { text: pad(bareTitle(cfg, j.title, id), Math.max(4, room)), dim },
        { text: tail ? `  ${tail}` : '', dim },
        { text: moves && !narrow ? `  ${moves}` : '', dim: true },
      ], k))
      if (!jOpen) continue
      const reads = j.reads ?? (id !== data && active(j) ? `${data} database as ${cfg.dbRole ?? 'helper'}` : '')
      for (const [label, v] of [['reads', reads], ['writes', j.writes ?? ''], ['waits on', j.mark === '⏸' ? j.waitOn ?? '' : ''], ['step', j.step], ['why', j.why ?? '']] as const) {
        if (v) out.push(row([{ text: `        ${label}: `, dim: true }, { text: v }]))
      }
    }
    const svc = flows.filter(f => f.service && f.from === id).map(f => f.to)
    if (svc.length) out.push(row([{ text: '    → ', color: 'cyan' }, { text: svc.join(' · '), color: 'cyan' }]))
    const q = inp.queues.get(id)
    if (q) out.push(row([{ text: `    ${q.count} queued`, dim: true }]))
  }
  return out
}

/** Reads topology.json (writing the defaults once when it is missing) and each machine's heartbeat file. */
export async function readTopology($: EngineInterface, h: string): Promise<{ cfg: TopoConfig; health: Record<string, TopoHealth> }> {
  const file = `${h}/${TOPOLOGY_REL}`
  let cfg = DEFAULT_TOPOLOGY
  try { cfg = parseTopology(String(await $.fs.read(file))) } catch {
    try { await $.fs.write(file, `${JSON.stringify(DEFAULT_TOPOLOGY, null, 2)}\n`) } catch { /* read-only home: defaults still draw */ }
  }
  const health: Record<string, TopoHealth> = {}
  const watched = cfg.machines.filter(m => m.status)
  if (watched.length) {
    let list: { name: string; mtimeMs: number }[] = []
    try { list = await $.fs.list(`${h}/${LINES_REL}`) } catch { list = [] }
    const now = await $.clock.now()
    for (const m of watched) {
      const f = list.find(x => x.name === m.status)
      let text: string | null = null
      if (f) { try { text = String(await $.fs.read(`${h}/${LINES_REL}/${f.name}`)) } catch { text = null } }
      health[m.id] = parseHealth(text, f?.mtimeMs ?? 0, now)
    }
  }
  return { cfg, health }
}
