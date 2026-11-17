import type { EngineInterface } from 'claude-code'

// Transcripts grow to hundreds of MB (a long main session, a busy subagent). Reading their tail again each poll took
// over a second per 32 MB read and could hold the plugin long enough that the status script's 8 s limit ran out.
// So each transcript is read once from a window at its end, then only its new bytes, a bounded chunk per call, always
// cut at a line end. A reader that falls behind catches up a chunk per poll instead of reading everything at once.

/** How far back the first read of a transcript goes. */
export const TX_FIRST = 4 * 1024 * 1024
/** The most one read takes. More new bytes than this are read on the next calls. */
export const TX_CHUNK = 2 * 1024 * 1024

export type TxCursor = { offset: number; size: number }

/** Where the next read starts and how many bytes it takes, or null when nothing is new. A shrunk file starts over. */
export function nextRange(cur: TxCursor | undefined, size: number, first = TX_FIRST, chunk = TX_CHUNK): { from: number; take: number; fresh: boolean } | null {
  const fresh = !cur || size < cur.offset
  const from = fresh ? Math.max(0, size - first) : cur!.offset
  if (size <= from) return null
  return { from, take: Math.min(chunk, size - from), fresh }
}

/**
 * The complete lines in a chunk read from byte `from`: a first read that starts inside the file drops its cut first
 * line; the text after the last line end waits for the next read. `used` is the bytes the lines take, so the next
 * read starts right after them (a chunk with no line end at all is skipped whole: one line over the chunk size).
 */
export function completeLines(text: string, from: number, take: number, fresh: boolean, atEnd = false): { lines: string; used: number } {
  let start = 0
  if (fresh && from > 0) { const nl = text.indexOf('\n'); if (nl < 0) return { lines: '', used: take }; start = nl + 1 }
  let end = text.lastIndexOf('\n')
  // At the file's end, a last line with no line end is taken when it is whole JSON (a file written without a final
  // newline); one still being written fails to parse and waits.
  if (atEnd && end < text.length - 1) {
    const last = text.slice(Math.max(end + 1, start))
    if (last.startsWith('{')) { try { JSON.parse(last); end = text.length - 1 } catch { /* still being written */ } }
  }
  // No whole line: a full chunk is one line over the chunk size (skipped); a partial one at the end waits.
  if (end < start) return { lines: '', used: start ? new TextEncoder().encode(text.slice(0, start)).length : atEnd ? 0 : take }
  return { lines: text.slice(start, end + 1), used: new TextEncoder().encode(text.slice(0, end + 1)).length }
}

const cursors = new Map<string, TxCursor>()

/** Forgets a transcript's place, so its next read starts from its end window again. */
export const forgetTx = (path: string) => { cursors.delete(path) }

/**
 * The transcript's lines written since the last call for this path ('' when none, null when it cannot be read), and
 * whether this is a first read (the caller starts its scan over). At most TX_CHUNK bytes and one process per call.
 */
export async function readNewLines($: EngineInterface, path: string, opts: { first?: number; chunk?: number; timeoutMs?: number } = {}): Promise<{ text: string; fresh: boolean; behind: boolean } | null> {
  let size = 0
  try { const st = await $.fs.stat(path); size = st.size } catch { return null }
  const cur = cursors.get(path)
  const r = nextRange(cur, size, opts.first, opts.chunk)
  if (!r) { if (cur) cur.size = size; return { text: '', fresh: false, behind: false } }
  let out = ''
  try {
    const p = await $.process.run(['/bin/sh', '-c', 'tail -c +"$1" "$2" | head -c "$3"', 'sh', String(r.from + 1), path, String(r.take)], { timeoutMs: opts.timeoutMs ?? 3000 })
    out = String(p.stdout ?? '')
  } catch { return null }
  const { lines, used } = completeLines(out, r.from, r.take, r.fresh, r.from + r.take >= size)
  cursors.set(path, { offset: r.from + used, size })
  return { text: lines, fresh: r.fresh, behind: r.from + used < size }
}
