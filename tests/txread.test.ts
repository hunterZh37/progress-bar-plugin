import { expect, test } from 'claude-code/testing'

import { TX_CHUNK, TX_FIRST, completeLines, forgetTx, nextRange, readNewLines } from '../hooks/txread'
import { newScan, scanMore, scanResult, scanTranscript } from '../hooks/waiting'
import { endedTaskIds } from '../hooks/report'
import { scriptFailNote } from '../hooks/panel'

// 0.35.4: transcripts of hundreds of MB are read once from an end window, then only their new lines, a bounded chunk
// per call, so no poll holds the plugin long enough for the status script's 8 s limit to run out.

const enc = new TextEncoder()
const iso = (ms: number) => new Date(ms).toISOString()
const use = (id: string, input: Record<string, unknown>, at: number) => JSON.stringify({ timestamp: iso(at), message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input }] } })
const bg = (id: string, task: string, at: number) => JSON.stringify({ timestamp: iso(at), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: ${task}. Output is being written to: /tmp/t/${task}.output.` }] } })
const end = (task: string, at: number) => JSON.stringify({ timestamp: iso(at), message: { role: 'user', content: `<task-notification>\n<task-id>${task}</task-id>\n<status>completed</status>\n</task-notification>` } })
/** Filler like a long agent's tool output: about 20 KB a line. */
const filler = (i: number) => JSON.stringify({ timestamp: iso(1_800_000_000_000 + i), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `f${i}`, content: 'x'.repeat(20_000) }] } })

/** A fake engine over one growing file: counts reads and the bytes each asks for. */
function fake(file: { text: string; bytes?: Uint8Array }) {
  const reads: { from: number; take: number }[] = []
  const bytes = () => (file.bytes ??= enc.encode(file.text))
  const $ = {
    fs: { stat: async () => ({ size: bytes().length }) },
    process: {
      run: async (argv: string[]) => {
        const from = Number(argv[4]), take = Number(argv[6])
        reads.push({ from, take })
        return { exitCode: 0, stdout: new TextDecoder().decode(bytes().subarray(from - 1, from - 1 + take)) }
      },
    },
  }
  return { $: $ as never, reads, grow: (more: string) => { file.text += more; file.bytes = undefined } }
}

test('ranges: a first read takes the end window, then only new bytes, a chunk at a time; a shrunk file starts over', () => {
  expect(nextRange(undefined, 100)).toEqual({ from: 0, take: 100, fresh: true })
  expect(nextRange(undefined, 50_000_000)).toEqual({ from: 50_000_000 - TX_FIRST, take: TX_CHUNK, fresh: true })
  expect(nextRange({ offset: 100, size: 100 }, 100)).toBe(null)
  expect(nextRange({ offset: 100, size: 100 }, 150)).toEqual({ from: 100, take: 50, fresh: false })
  expect(nextRange({ offset: 100, size: 100 }, 100 + 3 * TX_CHUNK)).toEqual({ from: 100, take: TX_CHUNK, fresh: false })
  expect(nextRange({ offset: 900, size: 900 }, 10)).toEqual({ from: 0, take: 10, fresh: true })
})

test('lines: a cut first line is dropped, a partial last line waits, multibyte text counts in bytes', () => {
  expect(completeLines('t":1}\n{"a":2}\n{"b"', 10, 18, true)).toEqual({ lines: '{"a":2}\n', used: enc.encode('t":1}\n{"a":2}\n').length })
  expect(completeLines('{"a":"é"}\n{"b"', 0, 20, true)).toEqual({ lines: '{"a":"é"}\n', used: enc.encode('{"a":"é"}\n').length })
  // At the file's end a whole JSON last line is taken; one still being written waits.
  expect(completeLines('{"a":1}\n{"b":2}', 0, 15, true, true).lines).toBe('{"a":1}\n{"b":2}')
  expect(completeLines('{"a":1}\n{"b":', 0, 13, true, true).lines).toBe('{"a":1}\n')
  // One line longer than a chunk: skipped whole, never re-read forever.
  expect(completeLines('xxxxxxxx', 0, 8, false)).toEqual({ lines: '', used: 8 })
})

test('a 60 MB transcript: no read over the chunk size, a quiet poll reads nothing, new lines read once', async () => {
  // About 60 MB of tool output, then the background launches that matter, near the end.
  const parts: string[] = []
  for (let i = 0; i < 3000; i++) parts.push(filler(i))
  const T = 1_800_100_000_000
  parts.push(use('u1', { command: 'ssm-run.sh backfill.sh', description: 'Backfill the archive' }, T), bg('u1', 'bAAA', T), use('u2', { command: 'sleep 1', description: 'Short wait' }, T), bg('u2', 'bBBB', T), end('bBBB', T))
  const file = { text: `${parts.join('\n')}\n` }
  const f = fake(file)
  const path = '/tx/agent-big.jsonl'
  forgetTx(path)
  expect(enc.encode(file.text).length).toBeGreaterThan(55_000_000)
  const acc = newScan()
  const t0 = performance.now()
  let behind = true
  for (let i = 0; i < 5 && behind; i++) {
    const r = (await readNewLines(f.$, path))!
    if (r.fresh) Object.assign(acc, newScan())
    scanMore(acc, r.text)
    behind = r.behind
  }
  const ms = performance.now() - t0
  expect(f.reads.every(r => r.take <= TX_CHUNK)).toBe(true)
  // The 4 MB window in 2 MB chunks (a cut line's few bytes may take one more read).
  expect(f.reads.length).toBeLessThanOrEqual(3)
  expect(scanResult(acc).running.map(x => x.id)).toEqual(['bAAA'])
  expect(scanResult(acc).running[0]!.desc).toBe('Backfill the archive')
  // Well under a second for the whole catch-up (4 MB), where 0.35.3 read 32 MB each time the file changed.
  expect(ms).toBeLessThan(1000)
  // Nothing new: no process at all.
  const n = f.reads.length
  expect(await readNewLines(f.$, path)).toEqual({ text: '', fresh: false, behind: false })
  expect(f.reads.length).toBe(n)
  // The job ends: only the new line is read, and the scan agrees with a full scan of the end window.
  f.grow(`${end('bAAA', T + 1)}\n`)
  const r = (await readNewLines(f.$, path))!
  expect(r.fresh).toBe(false)
  expect(f.reads.at(-1)!.take).toBe(enc.encode(`${end('bAAA', T + 1)}\n`).length)
  scanMore(acc, r.text)
  expect(scanResult(acc).running).toEqual([])
  expect(scanTranscript(file.text.slice(-TX_FIRST)).running).toEqual([])
})

test('many big transcripts at once: each poll stays bounded', async () => {
  const T = 1_800_100_000_000
  const big = { text: `${Array.from({ length: 800 }, (_, i) => filler(i)).join('\n')}\n${use('u1', { command: 'x', description: 'Load' }, T)}\n${bg('u1', 'bCCC', T)}\n` }
  const f = fake(big)
  const t0 = performance.now()
  for (let a = 0; a < 6; a++) {
    forgetTx(`/tx/agent-${a}.jsonl`)
    const acc = newScan()
    const r = (await readNewLines(f.$, `/tx/agent-${a}.jsonl`))!
    scanMore(acc, r.text)
  }
  // Six agents' first reads: 6 chunks of at most 2 MB, not six 32 MB tails.
  expect(f.reads.length).toBe(6)
  expect(f.reads.reduce((n, r) => n + r.take, 0)).toBeLessThanOrEqual(6 * TX_CHUNK)
  expect(performance.now() - t0).toBeLessThan(2000)
})

test('finished notices in the main transcript, and the status script note only after repeated failures', () => {
  expect(endedTaskIds('<task-id>b0000task</task-id>\\n<tool-use-id>t</tool-use-id>\\n<status>completed</status> <task-id>b2</task-id><status>failed</status> <task-id>b3</task-id><status>running</status>')).toEqual(['b0000task', 'b2'])
  const err = new Error('progress-bar: $.process.run(/bin/sh) aborted: still running after 8000ms')
  expect(scriptFailNote(1, err)).toBe('')
  expect(scriptFailNote(2, err)).toBe('')
  expect(scriptFailNote(3, err)).toBe('Status script could not run: Error: progress-bar: $.process.run(/bin/sh) aborted: still running after 8000ms')
})
