// Pure helpers: no `$`, so tests import them directly.

export type Progress = { done: number | null; total: number | null; step: string; startedAt?: number }

export type Row = {
  id: string
  description: string
  status: string
  startedAt: number
  tools: number
  lastTool: string
  done: number | null
  total: number | null
  step: string
  /** Watched jobs only: drawn as ✔ done, ■ stopped (process gone early) or ✖ error (error pattern seen). */
  state?: 'running' | 'done' | 'stopped' | 'error'
  /** Watched jobs only: time left at the rate so far, e.g. `4m`. */
  eta?: string
}

/**
 * A watch file, `~/.claude-progress/<slug>.watch.json`: a bar read from a job's own log, for jobs that can't write
 * progress files (a psql script, a vendor tool, a remote job whose log is synced here). Two ways to count:
 * - `match`: a regex with two groups, done and total; the last match in the log wins (`(\d+)/(\d+) batches`).
 * - `count` + `total`: done is the number of lines matching `count` (one per finished step).
 * Optional: `step` (regex; group 1 or the whole last match is the step text), `error` (regex; a match marks the job
 * failed), `process` (a `pgrep -f` pattern; the job counts as stopped once nothing matches before it is done),
 * `label` (the name shown; the slug otherwise), `startedAt` (ms; for elapsed time and ETA).
 */
export type Watch = {
  log: string
  label?: string
  match?: string
  count?: string
  total?: number
  step?: string
  error?: string
  process?: string
  startedAt?: number
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/** Parses a watch file's text; null when it is not usable (no log, no way to count, or a bad regex). */
export function parseWatch(text: string): Watch | null {
  try {
    const w = JSON.parse(text) as Record<string, unknown>
    if (!w || typeof w !== 'object' || !str(w.log)) return null
    const total = typeof w.total === 'number' && w.total > 0 ? w.total : undefined
    if (!str(w.match) && !(str(w.count) && total)) return null
    for (const k of ['match', 'count', 'step', 'error'] as const) if (str(w[k])) new RegExp(w[k] as string)
    return {
      log: w.log as string, label: str(w.label), match: str(w.match), count: str(w.count), total,
      step: str(w.step), error: str(w.error), process: str(w.process),
      startedAt: typeof w.startedAt === 'number' ? w.startedAt : undefined,
    }
  } catch {
    return null
  }
}

const lastMatch = (re: string, text: string) => {
  let last: RegExpExecArray | null = null
  for (const m of text.matchAll(new RegExp(re, 'gm'))) last = m
  return last
}

/** Reads progress out of a log's text by the watch's patterns. */
export function readLog(w: Watch, text: string): { done: number | null; total: number | null; step: string; error: boolean } {
  let done: number | null = null
  let total: number | null = null
  if (w.match) {
    const m = lastMatch(w.match, text)
    if (m && m[1] !== undefined && m[2] !== undefined) {
      const d = Number(m[1]), t = Number(m[2])
      if (Number.isFinite(d) && Number.isFinite(t) && t > 0) { done = d; total = t }
    }
  } else if (w.count && w.total) {
    done = Math.min([...text.matchAll(new RegExp(w.count, 'gm'))].length, w.total)
    total = w.total
  }
  const s = w.step ? lastMatch(w.step, text) : null
  const step = s ? (s[1] ?? s[0]).trim().slice(0, 60) : ''
  const error = !!w.error && new RegExp(w.error, 'm').test(text)
  return { done, total, step, error }
}

/** Time left at the rate so far, or '' when it can't be told yet. */
export function eta(elapsedMs: number, done: number | null, total: number | null): string {
  if (done === null || total === null || done <= 0 || done >= total || elapsedMs <= 0) return ''
  return ago((elapsedMs / done) * (total - done))
}

/** Expands a leading `~/` to the home folder. */
export const expandHome = (p: string, home: string) => (p === '~' ? home : p.startsWith('~/') ? home + p.slice(1) : p)

export const MAX_LINES = 6
export const FRESH_MS = 10 * 60_000

/** "Fix the Login bug!" -> "fix-the-login-bug" */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export const bar = (frac: number, w = 20) => {
  const f = Math.round(Math.max(0, Math.min(1, frac)) * w)
  return '█'.repeat(f) + '░'.repeat(w - f)
}

/** Parses a progress file's text; null when it is not usable JSON. */
export function parseProgress(text: string): Progress | null {
  try {
    const p = JSON.parse(text) as { done?: unknown; total?: unknown; step?: unknown; startedAt?: unknown }
    if (!p || typeof p !== 'object') return null
    const ok = typeof p.done === 'number' && typeof p.total === 'number' && p.total > 0
    return {
      done: ok ? (p.done as number) : null,
      total: ok ? (p.total as number) : null,
      step: typeof p.step === 'string' ? p.step : '',
      startedAt: typeof p.startedAt === 'number' ? p.startedAt : undefined,
    }
  } catch {
    return null
  }
}

/** One status-line row: `▶ name ████████░░░░░░░░░░░░ 40.0% · 2/5 · step · 3m`. */
export function line(r: Row, now: number): string {
  const tools = r.id.startsWith('file:') || r.id.startsWith('watch:') ? '' : ` · ${r.tools} tools`
  const meta = ` · ${ago(now - r.startedAt)}${tools}`
  const step = r.step ? ` · ${r.step}` : ''
  const mark = r.state === 'done' ? '✔' : r.state === 'stopped' ? '■ stopped' : r.state === 'error' ? '✖ error' : '▶'
  const left = r.eta && r.state !== 'done' ? ` · ETA ${r.eta}` : ''
  if (r.done !== null && r.total !== null) {
    const frac = r.done / r.total
    return `${mark} ${r.description} ${bar(frac)} ${(frac * 100).toFixed(1)}% · ${r.done}/${r.total}${step}${meta}${left}`
  }
  if (r.state && r.state !== 'running') return `${mark} ${r.description}${step}${meta}`
  const state = r.status === 'running' ? 'working' : r.status
  return `▶ ${r.description} ${state}${step}${meta}${r.lastTool ? ` · ${r.lastTool}` : ''}`
}

/** Rendered lines, capped; the overflow is summed up on the last line. */
export function lines(rows: Row[], now: number, max = MAX_LINES): string[] {
  const out = rows.slice(0, max).map(r => line(r, now))
  if (rows.length > max) out[max - 1] = `… ${rows.length - max + 1} more`
  return out
}

/** Quotes a string for POSIX sh inside single quotes. */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** The status line script `/progress-bar setup` writes. `prev` is a command to chain after the bars. */
export function statusScript(prev?: string): string {
  return [
    '#!/bin/sh',
    '# progress-bar status line. Written by `/progress-bar setup`. Safe to edit or delete.',
    '# Prints each fresh (<2 min) ~/.claude-progress/.lines/*.txt, then the previous status line if any.',
    'input=$(cat)',
    'dir="$HOME/.claude-progress/.lines"',
    'for f in "$dir"/*.txt; do',
    '  [ -s "$f" ] || continue',
    '  [ -n "$(find "$f" -mmin -2 2>/dev/null)" ] || continue',
    '  cat "$f"; echo',
    'done',
    `prev=${shQuote(prev ?? '')}`,
    'if [ -n "$prev" ]; then printf \'%s\' "$input" | sh -c "$prev"; fi',
    '',
  ].join('\n')
}
