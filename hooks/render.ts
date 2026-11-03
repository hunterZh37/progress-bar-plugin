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
}

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
  const tools = r.id.startsWith('file:') ? '' : ` · ${r.tools} tools`
  const meta = ` · ${ago(now - r.startedAt)}${tools}`
  const step = r.step ? ` · ${r.step}` : ''
  if (r.done !== null && r.total !== null) {
    const frac = r.done / r.total
    return `▶ ${r.description} ${bar(frac)} ${(frac * 100).toFixed(1)}% · ${r.done}/${r.total}${step}${meta}`
  }
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
