import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Listening, LocalView } from '../types'

// The project's localhost servers, always listed under the Status panel's job list.
// Every TCP port listening on this machine comes from lsof (pid, command, port), with each listener's working folder.
// The panel joins it with this session's background shells: a shell whose command names a port (--port 5173,
// PORT=3000, http.server 8000, localhost:8080) is listed with that port, up or down. A listener started from inside
// this project's folder is listed too, and so is any listener a Claude Code session of this project started: its
// environment carries CLAUDE_CODE_SESSION_ID, and this project's sessions are the transcripts in
// ~/.claude/projects/<folder>/ (a background server outlives its shell, and its progress file may keep no command).

export const LOCAL_EVERY = 10_000
export const EMPTY_LOCAL: LocalView = { listening: [], root: '', at: 0 }
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
    const sid = /(?:^|\s)CLAUDE_CODE_SESSION_ID=([\w-]+)/.exec(m[2])
    if (sid) started[pid] = sid[1]
    // the environment starts at the first NAME=value word after the command
    const words = m[2].split(' ')
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

/** Reads what listens on this machine into the atom, at most every LOCAL_EVERY ms. */
export async function readLocal($: EngineInterface, root: string, cwd = '', home = '') {
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
  const mine = new Set<string>()
  if (home && cwd) {
    try {
      for (const f of await $.fs.list(`${home}/.claude/projects/${projectDir(cwd)}`)) if (f.name.endsWith('.jsonl')) mine.add(f.name.slice(0, -6))
    } catch { /* no transcripts */ }
  }
  const view: LocalView = {
    listening: listen.map(l => ({ ...l, cwd: cwds[l.pid] ?? '', mine: !!started[l.pid] && mine.has(started[l.pid]), args: shortArgs(args[l.pid] ?? l.cmd) })),
    root,
    at: now,
  }
  if (JSON.stringify({ ...cur, at: 0 }) !== JSON.stringify({ ...view, at: 0 }) || now - cur.at >= LOCAL_EVERY) await update($, localAtom, () => view)
}

export type LocalRow = { port: number; url: string; title: string; up: boolean }

/**
 * The rows to list: this session's background shells that name a port (portsOf their command), then listeners this
 * process started or started inside the project folder (up when that port listens), then listeners
 * started inside the project folder that no shell named. Sorted by port.
 */
export function localRows(shells: { title: string; ports: number[] }[], view: LocalView): LocalRow[] {
  const up = new Set(view.listening.map(l => l.port))
  const rows: LocalRow[] = []
  for (const s of shells) {
    for (const port of s.ports) {
      if (!rows.some(r => r.port === port)) rows.push({ port, url: `http://localhost:${port}/`, title: s.title, up: up.has(port) })
    }
  }
  const inside = (cwd: string) => !!view.root && !!cwd && (cwd === view.root || cwd.startsWith(`${view.root}/`))
  for (const l of view.listening) {
    if ((l.mine || inside(l.cwd)) && !rows.some(r => r.port === l.port)) rows.push({ port: l.port, url: `http://localhost:${l.port}/`, title: l.args || l.cmd, up: true })
  }
  return rows.sort((a, b) => a.port - b.port)
}
