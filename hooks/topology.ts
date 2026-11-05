import type { EngineInterface } from 'claude-code'
import type { TopoConfig, TopoHealth, TopoMachine, TopoService } from '../types'

export type { TopoConfig, TopoHealth, TopoMachine, TopoService }

// The Topology tab: a live text diagram of the machines, what runs on each and what data moves between them.
// Machines, IPs and services come from ~/.claude-progress/topology.json (written once with the defaults below).
// Each running row is placed on a machine the same way the List tab labels it: a "<host>: " row prefix or a title
// that starts with a machine name or alias ("Hunty board lists", "Personal-mac tools setup"), else this machine.
// Flows: a progress file's optional `reads` and `writes` fields say what a job reads and writes. Without them a job on
// a helper machine reads from the data host's database and sends results back to it. Services (Jev API, Claude,
// GitHub) show while a running job matches their pattern.
// Health: this machine is online. A machine with a `status` file (a .lines/*.txt heartbeat such as linux.txt) is
// online while that file is fresh and says ✓, else offline. Others are unknown: the plugin runs no network checks.

export const TOPOLOGY_REL = '.claude-progress/topology.json'
const LINES_REL = '.claude-progress/.lines'
/** A heartbeat file older than this means the machine is offline. */
export const HEARTBEAT_MS = 2 * 60_000

/** A running or waiting row as the tab needs it. `pct` null draws no percent. */
export type TopoJob = { name: string; title: string; pct: number | null; mark: string; step: string; reads?: string; writes?: string; proc?: boolean }
export type TopoQueue = { count: number; top: string }
export type Flow = { from: string; to: string; label: string; jobs: string[]; service?: boolean }
export type Seg = { text: string; color?: 'green' | 'red' | 'cyan'; dim?: boolean; bold?: boolean }
export type TopoLine = Seg[]

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
 * What moves right now. A helper's job reads from the data host (its `reads`, else "reads (<dbRole>)") and sends
 * results back (its `writes`, else "results"). A data host job draws only what it declares, against Postgres.
 * A service shows for each running job its pattern matches (name, title, step, reads, writes).
 * Same from, to and label merge into one flow listing every job.
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
        add({ from: data, to: host, label: j.reads ? `reads ${j.reads}` : `reads (${c.dbRole ?? 'helper'})` }, t)
        add({ from: host, to: `${data} (DB write)`, label: j.writes ? `writes ${j.writes}` : 'results' }, t)
      } else {
        if (j.reads) add({ from: 'Postgres', to: host, label: `reads ${j.reads}` }, t)
        if (j.writes) add({ from: host, to: 'Postgres', label: `writes ${j.writes}` }, t)
      }
      const hay = [j.name, j.title, j.step, j.reads ?? '', j.writes ?? ''].join(' ')
      for (const s of c.services) {
        if (!new RegExp(s.match, 'i').test(hay)) continue
        add({ from: s.from ?? host, to: '', label: s.name, service: true }, t)
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
const COLOR: Record<State, Seg['color'] | undefined> = { busy: 'green', idle: undefined, offline: 'red', unknown: undefined }
const cut = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)
const pad = (s: string, n: number) => cut(s, n).padEnd(n)

/** A machine's state: offline (its heartbeat says so), busy (a job runs), idle (known online), else unknown. */
const active = (j: TopoJob) => j.mark !== '✔' && j.mark !== '⏸' && !j.proc
function stateOf(h: TopoHealth | undefined, jobs: TopoJob[]): State {
  if (h?.state === 'offline') return 'offline'
  if (jobs.some(j => j.mark !== '✔' && j.mark !== '⏸')) return 'busy'
  return h?.state === 'online' ? 'idle' : 'unknown'
}

const stateText = (s: State, h: TopoHealth | undefined, n: number, data: boolean) =>
  [`● ${s}${s === 'busy' && n ? ` · ${n} job${n === 1 ? '' : 's'}` : ''}`, h?.load, data ? 'data host' : ''].filter(Boolean).join(' · ')

const jobTail = (j: TopoJob) => (j.mark === '⏸' ? 'wait' : j.mark === '✔' ? 'done' : j.proc ? 'proc' : j.pct === null ? '…' : `${Math.round(j.pct)}%`)
const jobMark = (j: TopoJob) => (j.mark === '⏸' ? '⏸' : j.mark === '✔' ? '✔' : j.mark === '⚠' ? '⚠' : '▶')

/** One machine as a box `w` wide: title with IP, state, about lines (dim), its jobs with percent. */
function box(m: TopoMachine | undefined, id: string, w: number, s: State, h: TopoHealth | undefined, jobs: TopoJob[], titleOf: (j: TopoJob) => string, data: boolean): TopoLine[] {
  const color = COLOR[s]
  const dim = s === 'idle' || s === 'unknown'
  const inner = w - 4
  const head = m?.ip && id.length + m.ip.length + 9 <= w ? `─ ${id} · ${m.ip} ` : `─ ${cut(id, w - 5)} `
  const row = (text: string, seg: Partial<Seg> = {}): TopoLine => [{ text: '│ ', color, dim }, { text: pad(text, inner), ...seg }, { text: ' │', color, dim }]
  const lines: TopoLine[] = [[{ text: `┌${head}${'─'.repeat(Math.max(0, w - 2 - head.length))}┐`, color, dim, bold: true }]]
  lines.push(row(stateText(s, h, jobs.filter(active).length, data), { color, dim }))
  for (const a of m?.about ?? []) lines.push(row(a, { dim: true }))
  for (const j of jobs) {
    const tail = jobTail(j)
    lines.push(row(`${jobMark(j)} ${pad(titleOf(j), inner - tail.length - 3)} ${tail}`, j.mark === '⏸' || j.mark === '✔' || j.proc ? { dim: true } : {}))
  }
  if (!jobs.length) lines.push(row(s === 'offline' ? 'unreachable' : 'no jobs', { dim: true }))
  lines.push([{ text: `└${'─'.repeat(w - 2)}┘`, color, dim }])
  return lines
}

const queueLine = (q: TopoQueue | undefined, w: number): TopoLine =>
  q ? [{ text: pad(`  ☐ ${q.count} queued · next: ${q.top}`, w), dim: true }] : [{ text: ' '.repeat(w) }]

/** Segments cut to `w` columns in all, the last one that fits ending in "…". */
export function cutLine(l: TopoLine, w: number): TopoLine {
  const out: TopoLine = []
  let left = w
  for (const s of l) {
    if (left <= 0) break
    out.push({ ...s, text: cut(s.text, left) })
    left -= Math.min(s.text.length, left)
  }
  return out
}

const flowLine = (f: Flow, w: number): TopoLine =>
  cutLine([{ text: f.from, bold: true }, { text: ` ──${f.label}──▶ `, color: f.service ? 'cyan' : 'green' }, { text: `${f.to ? `${f.to}: ` : ''}${f.jobs.join(', ')}` }], w)

/** The width a line takes. */
export const lineWidth = (l: TopoLine) => l.reduce((a, s) => a + s.text.length, 0)
/** A line as plain text (for tests and logs). */
export const plainLine = (l: TopoLine) => l.map(s => s.text).join('').replace(/\s+$/, '')

/**
 * The whole tab as lines. 60 columns and up: the data host's box on the left, helper boxes stacked on the right, a
 * link between each helper and the data host (◀───▶ both ways, ────▶ or ◀──── one way, ┄┄┄┄┄ nothing moving,
 * ──✕── offline), the queued to-dos under each box, then the flows, services and notes. Under 60: a stacked list.
 * Never wider than 120 columns.
 */
export function renderTopology(inp: TopoInput, width: number): TopoLine[] {
  const W = Math.min(120, Math.max(20, width))
  const { cfg } = inp
  const data = dataHost(cfg)
  const placed = placeJobs(cfg, inp.jobs, inp.self, inp.extra)
  const flows = flowsOf(cfg, placed)
  const ids = [...placed.keys()]
  const states = new Map(ids.map(id => [id, stateOf(id === inp.self ? { ...inp.health[id], state: 'online' as const } : inp.health[id], placed.get(id)!)]))
  const healthOf = (id: string) => (id === inp.self ? { ...inp.health[id], state: 'online' as const } : inp.health[id])
  const mOf = (id: string) => cfg.machines.find(m => m.id === id)
  const titleOf = (id: string) => (j: TopoJob) => bareTitle(cfg, j.title, id)
  const out: TopoLine[] = []

  if (W < 60) {
    for (const id of ids) {
      const s = states.get(id)!
      const h = healthOf(id)
      const jobs = placed.get(id)!
      out.push([{ text: `● ${id}`, color: COLOR[s], dim: s === 'idle' || s === 'unknown', bold: true }, { text: cut(`  ${stateText(s, h, jobs.filter(active).length, id === data).slice(2)}`, W - id.length - 2), color: COLOR[s], dim: s !== 'busy' && s !== 'offline' }])
      if (mOf(id)?.ip) out.push([{ text: `  ${mOf(id)!.ip}`, dim: true }])
      for (const j of jobs) {
        const tail = jobTail(j)
        out.push([{ text: `  ${jobMark(j)} ${pad(titleOf(id)(j), W - tail.length - 6)} ${tail}`, dim: j.mark === '⏸' || j.mark === '✔' || j.proc }])
      }
      const q = inp.queues.get(id)
      if (q) out.push([{ text: cut(`  ☐ ${q.count} queued · next: ${q.top}`, W), dim: true }])
    }
  } else {
    const G = 5
    const L = Math.floor((W - G) / 2)
    const R = W - G - L
    const helpers = ids.filter(id => id !== data)
    const right: TopoLine[] = []
    const links: { row: number; text: string; color?: Seg['color']; dim?: boolean }[] = []
    helpers.forEach((id, i) => {
      if (i) right.push([{ text: ' '.repeat(R) }])
      const s = states.get(id)!
      const outF = flows.some(f => f.from === data && f.to === id)
      const inF = flows.some(f => f.from === id && f.to.startsWith(data))
      links.push({
        row: right.length + 1,
        text: s === 'offline' ? '──✕──' : outF && inF ? '◀───▶' : outF ? '────▶' : inF ? '◀────' : '┄┄┄┄┄',
        color: s === 'offline' ? 'red' : outF || inF ? 'green' : undefined,
        dim: !outF && !inF && s !== 'offline',
      })
      right.push(...box(mOf(id), id, R, s, healthOf(id), placed.get(id)!, titleOf(id), false))
      right.push(queueLine(inp.queues.get(id), R))
    })
    const ds = states.get(data) ?? 'unknown'
    const left = box(mOf(data), data, L, ds, healthOf(data), placed.get(data) ?? [], titleOf(data), true)
    // Stretch the data host's box down to the last helper's link, so every link meets it.
    const reach = Math.max(0, ...links.map(l => l.row + 2))
    const bottom = left.pop()!
    const dimL = ds === 'idle' || ds === 'unknown'
    while (left.length + 1 < reach) left.push([{ text: '│', color: COLOR[ds], dim: dimL }, { text: ' '.repeat(L - 2) }, { text: '│', color: COLOR[ds], dim: dimL }])
    left.push(bottom, queueLine(inp.queues.get(data), L))
    const rows = Math.max(left.length, right.length)
    for (let r = 0; r < rows; r++) {
      const l = left[r] ?? [{ text: ' '.repeat(L) }]
      const rr = right[r] ?? [{ text: ' '.repeat(R) }]
      const link = links.find(x => x.row === r)
      if (!link) { out.push([...l, { text: ' '.repeat(G) }, ...rr]); continue }
      // The link joins the two borders: ├ on the data host's side, ┤ on the helper's.
      const join = (line: TopoLine, end: boolean, ch: string): TopoLine => {
        const segs = line.map(s => ({ ...s }))
        const s = end ? segs[segs.length - 1]! : segs[0]!
        s.text = end ? `${s.text.slice(0, -1)}${ch}` : `${ch}${s.text.slice(1)}`
        return segs
      }
      const lj = /[│]$/.test(l[l.length - 1]!.text) ? join(l, true, '├') : l
      const rj = /^[│]/.test(rr[0]!.text) ? join(rr, false, '┤') : rr
      out.push([...lj, { text: link.text, color: link.color, dim: link.dim }, ...rj])
    }
  }

  while (out.length && !plainLine(out[out.length - 1]!)) out.pop()
  out.push([{ text: '' }])
  out.push([{ text: 'FLOWS NOW', bold: true, color: 'cyan' }])
  const moving = flows.filter(f => !f.service)
  if (!moving.length) out.push([{ text: '  No data moving between machines.', dim: true }])
  for (const f of moving) out.push([{ text: '  ' }, ...flowLine(f, W - 2)])
  const svc = flows.filter(f => f.service)
  for (const f of svc) out.push([{ text: '  ' }, ...flowLine(f, W - 2)])
  const used = new Set(svc.map(f => f.label))
  if (cfg.services.length) {
    out.push([{ text: '' }])
    out.push([{ text: 'SERVICES ', bold: true, color: 'cyan' }, ...cfg.services.flatMap(s => [
      { text: '  ' },
      used.has(s.name) ? { text: `● ${s.name}`, color: 'green' as const } : { text: `○ ${s.name}`, dim: true },
    ])])
  }
  const notes = ids.filter(id => id !== inp.self && !inp.health[id] && mOf(id))
    .map(id => `${id}: reachability unknown, no heartbeat configured`)
  for (const id of ids) {
    const n = inp.health[id]?.note
    if (states.get(id) === 'offline' && n) notes.push(`${id}: offline, ${n}`)
  }
  if (notes.length) out.push([{ text: '' }], ...notes.map(n => [{ text: cut(`  ${n}`, W), dim: true }]))
  out.push([{ text: cut('  Machines and IPs: ~/.claude-progress/topology.json', W), dim: true }])
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
