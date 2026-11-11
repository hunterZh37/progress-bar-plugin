import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Listening, LocalLabel, LocalView } from '../types'
import { isClaude as isClaudeCmd, norm, parsePs, psList } from './control'
import type { Proc } from './control'

// The project's localhost servers, always listed under the Status panel's job list.
// Every TCP port listening on this machine comes from lsof (pid, command, port), with each listener's working folder.
// The panel joins it with this session's background shells: a shell whose command names a port (--port 5173,
// PORT=3000, http.server 8000, localhost:8080) is listed with that port, up or down. A listener started from inside
// this project's folder is listed too, and so is any listener a Claude Code session of this project started: its
// environment carries CLAUDE_CODE_SESSION_ID, and this project's sessions are the transcripts in
// ~/.claude/projects/<folder>/ (a background server outlives its shell, and its progress file may keep no command).
// A shell whose command names no port (npm run dev) gets its port from the process tree: each listener's parents are
// walked up to the shell Claude started, and that shell's command is matched to the background shell's (shellPorts).

// Names are the person's: ~/.claude-progress/localhost/<project>.txt, one "<port>[/path]<TAB><name>" line per page,
// so one server can list two pages (5381/__stage/ and 5381/__stage/one.html). Edited from the panel or by hand.

export const LOCAL_EVERY = 10_000
export const EMPTY_LOCAL: LocalView = { listening: [], root: '', at: 0, labels: [], labelsPath: '' }
export const labelsRel = (project: string) => `.claude-progress/localhost/${project || 'default'}.txt`

/** "<port>[/path]<TAB or spaces><name>" lines; # starts a comment. A bad line is skipped. */
export function parseLabels(text: string): LocalLabel[] {
  const out: LocalLabel[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^:?(\d{2,5})(\/\S*)?\s+(.+)$/.exec(line)
    if (!m) continue
    const port = Number(m[1])
    const path = m[2] ?? '/'
    if (port < 1 || port > 65535 || out.some(l => l.port === port && l.path === path)) continue
    out.push({ port, path, label: (m[3] ?? '').trim().slice(0, 80) })
  }
  return out
}

/** The labels file with one page's name set (an empty name removes the page). */
export function setLabel(labels: LocalLabel[], port: number, path: string, label: string): string {
  const rest = labels.filter(l => !(l.port === port && l.path === path))
  const next = label.trim() ? [...rest, { port, path, label: label.trim().slice(0, 80) }] : rest
  next.sort((a, b) => a.port - b.port || a.path.localeCompare(b.path))
  return `# localhost pages for this project: <port>[/path]<TAB><name>. Shown in the Status panel's LOCALHOST list.\n${next.map(l => `${l.port}${l.path === '/' ? '' : l.path}\t${l.label}`).join('\n')}\n`
}

/** "5381/__stage/one.html One phone" typed in the panel: a page and its name, or null. */
export function parseEntry(text: string): LocalLabel | null {
  return parseLabels(text.replace(/^\s*(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)?:?/i, ''))[0] ?? null
}

/** Writes one page's name to the labels file and shows it at once. */
export async function saveLabel($: EngineInterface, home: string, port: number, path: string, label: string) {
  const cur = await read($, localAtom)
  if (!home || !cur.labelsPath) return
  const text = setLabel(cur.labels ?? [], port, path, label)
  try {
    await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', `${home}/${cur.labelsPath}`], { stdin: text, timeoutMs: 5000 })
  } catch { return }
  await update($, localAtom, v => ({ ...v, labels: parseLabels(text) }))
}

/** Opens a local page in the browser: only http://localhost:<port>/<path>. */
export async function openLocalPage($: EngineInterface, url: string, darwin: boolean) {
  if (!/^http:\/\/localhost:\d{2,5}(\/[^\s"'`]*)?$/.test(url)) return
  try { await $.process.run([darwin ? 'open' : 'xdg-open', url], { timeoutMs: 5000 }) } catch { /* nothing to open */ }
}
export const localAtom = atom({ plugin: 'progress-bar', key: 'local' } as const, EMPTY_LOCAL)

/** The ports a shell command names, in order, without repeats. */
export function portsOf(command: string): number[] {
  const c = command.replace(/\s+/g, ' ')
  const out: number[] = []
  const add = (s: string | undefined) => {
    const n = Number(s)
    if (Number.isInteger(n) && n >= 80 && n <= 65535 && !out.includes(n)) out.push(n)
  }
  for (const re of [
    /(?:^|\s)(?:-p|--port|--listen)[ =](\d{2,5})\b/g,
    /\bPORT=(\d{2,5})\b/g,
    /\bhttp\.server(?:\s+-{1,2}\S+(?:\s+(?!\d)\S+)?)*\s+(\d{2,5})\b/g,
    /(?:localhost|0\.0\.0\.0|127\.0\.0\.1|\[::1\]):(\d{2,5})\b/g,
  ]) for (const m of c.matchAll(re)) add(m[1])
  return out
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` output: one entry per pid and port (IPv4 and IPv6 of one port count once). */
export function parseListen(text: string): Omit<Listening, 'cwd'>[] {
  const out: Omit<Listening, 'cwd'>[] = []
  let pid = 0
  let cmd = ''
  for (const line of text.split('\n')) {
    const k = line[0]
    const v = line.slice(1)
    if (k === 'p') pid = Number(v) || 0
    else if (k === 'c') cmd = v
    else if (k === 'n' && pid) {
      const m = /:(\d+)$/.exec(v)
      const port = m ? Number(m[1]) : 0
      if (port && !out.some(x => x.pid === pid && x.port === port)) out.push({ pid, cmd, port })
    }
  }
  return out
}

/** `lsof -a -d cwd -p <pids> -Fn` output: each pid's working folder. */
export function parseCwds(text: string): Record<number, string> {
  const out: Record<number, string> = {}
  let pid = 0
  for (const line of text.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1)) || 0
    else if (line[0] === 'n' && pid && !(pid in out)) out[pid] = line.slice(1)
  }
  return out
}

/** Claude Code keeps a project's transcripts in ~/.claude/projects/<the folder, every other character a dash>/. */
export const projectDir = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-')

/**
 * `ps eww -o pid=,command=` output (the command line followed by the environment): each pid's Claude Code session
 * (CLAUDE_CODE_SESSION_ID) and its command line without the environment.
 */
export function parsePsEnv(text: string): { started: Record<number, string>; args: Record<number, string> } {
  const started: Record<number, string> = {}
  const args: Record<number, string> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const pid = Number(m[1])
    const rest = m[2] ?? ''
    const sid = /(?:^|\s)CLAUDE_CODE_SESSION_ID=([\w-]+)/.exec(rest)
    if (sid?.[1]) started[pid] = sid[1]
    // the environment starts at the first NAME=value word after the command
    const words = rest.split(' ')
    const envAt = words.findIndex((w, i) => i > 0 && /^[A-Z_][A-Z0-9_]*=/.test(w))
    args[pid] = (envAt > 0 ? words.slice(0, envAt) : words).join(' ')
  }
  return { started, args }
}

/** A short label for a server's command line: the program and its port flag, without folders. */
export function shortArgs(args: string): string {
  const words = args.split(/\s+/).filter(Boolean).map(w => (w.startsWith('/') ? w.split('/').pop() ?? w : w))
  return words.slice(0, 6).join(' ').slice(0, 60)
}

/** The shell Claude started that a process runs under (its parents walked up to the one whose parent is Claude): that shell's command, normalized, or ''. */
export function shellOf(pid: number, procs: Pick<Proc, 'pid' | 'ppid' | 'command'>[]): string {
  const by = new Map(procs.map(p => [p.pid, p]))
  let p = by.get(pid)
  for (let i = 0; p && i < 40; i++) {
    const parent = by.get(p.ppid)
    if (!parent) return ''
    if (isClaudeCmd(parent.command)) return isClaudeCmd(p.command) ? '' : norm(p.command)
    p = parent
  }
  return ''
}

/** The ports a background shell listens on through its own processes: listeners whose Claude-started shell holds its command. */
export function shellPorts(command: string, listening: Listening[]): number[] {
  const c = norm(command)
  if (!c) return []
  return [...new Set(listening.filter(l => l.shell && l.shell.includes(c)).map(l => l.port))]
}

/** Reads what listens on this machine into the atom, at most every LOCAL_EVERY ms. */
export async function readLocal($: EngineInterface, root: string, cwd = '', home = '', project = '') {
  const now = await $.clock.now()
  const cur = await read($, localAtom)
  if (now - cur.at < LOCAL_EVERY && cur.root === root) return
  let listen: Omit<Listening, 'cwd'>[] = []
  try {
    listen = parseListen((await $.process.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], { timeoutMs: 5000 })).stdout)
  } catch { listen = [] }
  let cwds: Record<number, string> = {}
  const pids = [...new Set(listen.map(l => l.pid))]
  if (pids.length) {
    try { cwds = parseCwds((await $.process.run(['lsof', '-a', '-d', 'cwd', '-p', pids.join(','), '-Fn'], { timeoutMs: 5000 })).stdout) } catch { cwds = {} }
  }
  // which Claude Code session started each listener (from its environment), and this project's sessions
  let started: Record<number, string> = {}
  let args: Record<number, string> = {}
  if (pids.length) {
    try {
      const out = (await $.process.run(['ps', 'eww', '-o', 'pid=,command=', '-p', pids.join(',')], { timeoutMs: 5000 })).stdout
      ;({ started, args } = parsePsEnv(out))
    } catch { started = {} }
  }
  // each listener's Claude-started shell, so a shell that names no port (npm run dev) still finds its port
  let shells: Record<number, string> = {}
  if (pids.length) {
    try {
      const procs = parsePs((await psList($)).stdout)
      for (const pid of pids) { const sh = shellOf(pid, procs); if (sh) shells[pid] = sh }
    } catch { shells = {} }
  }
  const mine = new Set<string>()
  if (home && cwd) {
    try {
      for (const f of await $.fs.list(`${home}/.claude/projects/${projectDir(cwd)}`)) if (f.name.endsWith('.jsonl')) mine.add(f.name.slice(0, -6))
    } catch { /* no transcripts */ }
  }
  const labelsPath = labelsRel(project)
  let labels: LocalLabel[] = []
  try { labels = home ? parseLabels(String(await $.fs.read(`${home}/${labelsPath}`))) : [] } catch { labels = [] }
  let ignore: string[] = []
  try { ignore = home ? parseIgnore(String(await $.fs.read(`${home}/.claude-progress/localhost-ignore.txt`))) : [] } catch { ignore = [] }
  const view: LocalView = {
    labels,
    ignore,
    labelsPath,
    listening: await probeAll($, listen.map(l => ({ ...l, cwd: cwds[l.pid] ?? '', mine: mine.has(started[l.pid] ?? ''), args: shortArgs(args[l.pid] ?? l.cmd), ...(shells[l.pid] ? { shell: shells[l.pid] } : {}) })), root, ignore),
    root,
    at: now,
  }
  if (JSON.stringify({ ...cur, at: 0 }) !== JSON.stringify({ ...view, at: 0 }) || now - cur.at >= LOCAL_EVERY) await update($, localAtom, () => view)
}

/** A project listener that may be listed gets an HTTP probe (curl, 1s): `http: false` when it does not answer HTTP. */
async function probeAll($: EngineInterface, ls: Listening[], root: string, ignore: string[]): Promise<Listening[]> {
  const inside = (cwd: string) => !!root && !!cwd && (cwd === root || cwd.startsWith(`${root}/`))
  const ports = [...new Set(ls.filter(l => (l.mine || inside(l.cwd)) && !isInfra(l, ignore)).map(l => l.port))].slice(0, 12)
  const http: Record<number, boolean> = {}
  await Promise.all(ports.map(async port => {
    try {
      const out = (await $.process.run(['curl', '-s', '-o', '/dev/null', '-m', '1', '-w', '%{http_code}', `http://127.0.0.1:${port}/`], { timeoutMs: 3000 })).stdout.trim()
      http[port] = /^[1-5]\d\d$/.test(out)
    } catch { http[port] = false }
  }))
  return ls.map(l => (l.port in http ? { ...l, http: http[l.port] } : l))
}

/**
 * One LOCALHOST row. `port` 0: a server shell whose port is not known yet (shown as localhost:?). `shell`: the RUNNING
 * row name of the background server shell behind it, for its uptime and [x].
 */
export type LocalRow = { key: string; port: number; path: string; url: string; title: string; named: boolean; up: boolean; shell?: string }

const VERB = String.raw`(?:build|rebuild|start|restart|run|launch|serve|boot|spin up|bring up|swap|deploy|redeploy|health-check|check|open)`
const LEAD = new RegExp(String.raw`^\s*${VERB}(?:\s*(?:,\s*and|,|and)\s*${VERB})*\s+(?:(?:the|a|an)\s+)?`, 'i')

/** What a server is for, from its shell's description: the leading verbs dropped ("Start the WayToMatter dev server" is "WayToMatter dev server"). */
export function purposeOf(title: string): string {
  const t = title.replace(LEAD, '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title
}

/** Claude Code's own helper processes listen too: never a project server. */
const isClaude = (l: Listening) => /^claude\b/.test(l.args ?? '') || l.cmd === 'claude'

/**
 * System and infrastructure listeners, never a project page unless the person named the page: Docker Desktop and its
 * VMs (com.docker.backend, vpnkit, docker-proxy, OrbStack, colima, limactl), macOS (ControlCenter/AirPlay on 5000
 * and 7000, rapportd), desktop apps (Spotify, Dropbox, Code Helper) and databases (postgres, redis, mysqld).
 */
export const DENY = /^(com\.docker|docker|vpnkit|Docker|OrbStack|orbstack|colima|limactl|ControlCe|ControlCenter|AirPlay|rapportd|Spotify|Dropbox|Code\b|Code Helper|postgres|redis|mysqld|mongod|sharingd|identitys|launchd)/i

/** ~/.claude-progress/localhost-ignore.txt: one process name (prefix, any case) or port per line; # comments. */
export function parseIgnore(text: string): string[] {
  return text.split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean)
}

/** A listener that is never listed on its own: system/infra by DENY, or by the person's ignore list. */
export function isInfra(l: Pick<Listening, 'cmd' | 'port'> & { args?: string }, ignore: string[] = []): boolean {
  const names = [l.cmd, (l.args ?? '').split(/\s+/)[0] ?? ''].filter(Boolean)
  if (names.some(n => DENY.test(n))) return true
  return ignore.some(x => (/^\d+$/.test(x) ? Number(x) === l.port : names.some(n => n.toLowerCase().startsWith(x.toLowerCase()))))
}

/**
 * The rows to list: the named pages first (up when their port listens), then this session's background shells that
 * name a port (portsOf their command, or shellPorts from the process tree), then listeners a session of this project
 * started or started inside the project folder. A port with a named page is not listed again unnamed. A server shell
 * (`server`) joins the row of its port, so it shows once with its uptime and [x]; one with no known port is its own
 * localhost:? row. A shell's row is titled by what it is for (purposeOf). Sorted by port, then path, unknown ports last.
 */
export function localRows(shells: { title: string; ports: number[]; name?: string; server?: boolean }[], view: LocalView): LocalRow[] {
  const up = new Set(view.listening.map(l => l.port))
  const rows: LocalRow[] = []
  const has = (port: number) => rows.some(r => r.port === port)
  const row = (port: number, path: string, title: string, named: boolean, isUp: boolean, shell?: string): LocalRow =>
    ({ key: `${port}${path}`, port, path, url: `http://localhost:${port}${path}`, title, named, up: isUp, ...(shell ? { shell } : {}) })
  for (const l of view.labels ?? []) rows.push(row(l.port, l.path, l.label, true, up.has(l.port)))
  const ignore = view.ignore ?? []
  const ignoredPort = (port: number) => ignore.includes(String(port)) || view.listening.some(l => l.port === port && isInfra(l, ignore))
  for (const s of shells) {
    const shell = s.server && s.name ? s.name : undefined
    const ports = s.ports.filter(p => !ignoredPort(p))
    for (const port of ports) {
      if (!has(port)) rows.push(row(port, '/', purposeOf(s.title), false, up.has(port), shell))
      else if (shell) for (const r of rows) if (r.port === port && !r.shell) r.shell = shell
    }
    if (shell && !s.ports.length) rows.push({ key: `?-${shell}`, port: 0, path: '/', url: '', title: purposeOf(s.title), named: false, up: true, shell })
  }
  const inside = (cwd: string) => !!view.root && !!cwd && (cwd === view.root || cwd.startsWith(`${view.root}/`))
  for (const l of view.listening) {
    if ((l.mine || inside(l.cwd)) && !isClaude(l) && !isInfra(l, ignore) && l.http !== false && !has(l.port)) rows.push(row(l.port, '/', l.args || l.cmd, false, true))
  }
  return rows.sort((a, b) => (a.port || 1e6) - (b.port || 1e6) || a.path.localeCompare(b.path) || a.key.localeCompare(b.key))
}
