import { expect, test } from 'claude-code/testing'

import { DONE_KEEP, IMPACT_MAX, doneDetails, impactLines, plainMd, prettyName, pruneList, ranFor, reportOf, sentences, summarize } from '../hooks/done'
import { DONE_MAX, doneItems, doneTitle } from '../hooks/panel'

// Done records (hooks/done.ts): what a finished task changed, shown when its DONE row is opened.

const NOW = 1_800_000_000_000

test('impactLines: a string split on newlines or a list, at most three trimmed lines', () => {
  expect(impactLines('a\n\n b \nc\nd')).toEqual(['a', 'b', 'c'])
  expect(impactLines(['x', 3, ' y '])).toEqual(['x', 'y'])
  expect(impactLines(undefined)).toEqual([])
  expect(impactLines('z'.repeat(500))[0]!.length).toBe(200)
})

test('summarize: the first bold sentence, else the first prose lines, plain and capped', () => {
  expect(summarize('## Done\n\n**Board links rebuilt: 1.29M pairs, 109K split people merged.** More here.')).toEqual(['Board links rebuilt: 1.29M pairs, 109K split people merged.'])
  // Short bold bits and labels are not sentences.
  expect(summarize('Fixed the matcher. Commit **12f5c8d** is on `main`.\n\n**What changed:**\n- **Loaders now re-apply merges:** ok')).toEqual(['Fixed the matcher.', 'Commit 12f5c8d is on main.', 'Loaders now re-apply merges: ok'])
  expect(summarize('```\ncode\n```\nOne [link](http://x) line.')).toEqual(['One link line.'])
  const long = summarize(`${'word '.repeat(100)}.`)
  expect(long.join('').length).toBeLessThanOrEqual(IMPACT_MAX)
  expect(long[0]!.endsWith('…')).toBe(true)
  expect(plainMd('- **a** `b` __c__')).toBe('a b c')
})

test('sentences: version numbers, paths and lower case after a dot never split', () => {
  // Before 0.28.15 this gave "12) in ~/Desktop/progress-bar-plugin." and lost the start.
  expect(summarize('Shipped 0.28.12 (commit cdf6f54) in ~/Desktop/progress-bar-plugin. Each server is now one row.')).toEqual(['Shipped 0.28.12 (commit cdf6f54) in ~/Desktop/progress-bar-plugin.', 'Each server is now one row.'])
  expect(sentences('0.28.13 is out: every dim line starts with ⎿ . It is pushed.')).toEqual(['0.28.13 is out: every dim line starts with ⎿ .', 'It is pushed.'])
  expect(sentences('Read e.g. the file. Done!')).toEqual(['Read e.g. the file.', 'Done!'])
})

test('reportOf: the SubagentHandback message wins over the last text, with first and last times', () => {
  const t = (at: number, content: unknown) => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { role: 'assistant', content } })
  const tx = [
    t(NOW - 600_000, [{ type: 'text', text: 'starting' }]),
    t(NOW - 60_000, [{ type: 'tool_use', name: 'SubagentHandback', input: { message: 'The report.' } }]),
    t(NOW, [{ type: 'text', text: 'I stopped my loops.' }]),
  ].join('\n')
  expect(reportOf(tx)).toEqual({ text: 'The report.', first: NOW - 600_000, last: NOW })
  expect(reportOf(tx.split('\n').filter(l => !/Handback/.test(l)).join('\n')).text).toBe('I stopped my loops.')
})

test('prettyName, ranFor and pruneList', () => {
  expect(prettyName('linux: linux-board-cap-extract')).toBe('Linux: Board cap extract')
  expect(prettyName('mac-label-top-ups')).toBe('Mac label top ups')
  expect(prettyName('Linux person matcher fix')).toBe('Linux person matcher fix')
  expect([ranFor(0), ranFor(45_000), ranFor(12 * 60_000), ranFor(80 * 60_000)]).toEqual(['', '45s', '12m', '1h20m'])
  const recs = Array.from({ length: DONE_KEEP + 2 }, (_, i) => ({ name: `j${i}`, finished: NOW - i * 60_000 }))
  expect(pruneList(recs, NOW)).toEqual([`j${DONE_KEEP}`, `j${DONE_KEEP + 1}`])
  expect(pruneList([{ name: 'old', finished: NOW - 8 * 86_400_000 }, { name: 'new', finished: NOW }], NOW)).toEqual(['old'])
})

test('doneDetails: impact or "no impact reported", finish and run time with the machine, then why', () => {
  expect(doneDetails({ impact: ['a', 'b'], started: NOW - 80 * 60_000, finished: NOW, why: 'unlocks: x' }, '', 'Mac').slice(2)).toEqual([expect.stringMatching(/^finished \d\d:\d\d · ran 1h20m · machine: Mac$/), 'unlocks: x'])
  expect(doneDetails(undefined, '11:50', 'Linux')).toEqual(['no impact reported', 'finished 11:50 · machine: Linux'])
})

test('doneItems: the grouper rows, then recent records not shown or running, newest first; titles', () => {
  const recs = {
    a: { slug: 'a', title: 'A job', impact: [], finished: NOW - 3_600_000, machine: 'Mac', kind: 'job' as const },
    b: { slug: 'b', title: 'B job', impact: [], finished: NOW - 60_000, machine: 'Mac', kind: 'job' as const },
    live: { slug: 'live', title: 'Live', impact: [], finished: NOW - 60_000, machine: 'Mac', kind: 'job' as const },
    old: { slug: 'old', title: 'Old', impact: [], finished: NOW - 13 * 3_600_000, machine: 'Mac', kind: 'job' as const },
    'linux-linux-board-cap-extract': { slug: 'linux-linux-board-cap-extract', title: '', impact: [], finished: NOW - 60_000, machine: 'Linux', kind: 'job' as const },
  }
  const items = doneItems(['a · finished 11:27', 'linux: linux-board-cap-extract · finished 11:50', 'x ████ 100.0% · 7/7'], recs, new Set(['live']), NOW)
  expect(items.map(i => i.key)).toEqual(['a', 'linux-linux-board-cap-extract', 'x', 'b'])
  expect(items[2]!.finishing).toBe('finishing · 7/7')
  expect(doneTitle('linux: linux-board-cap-extract', recs['linux-linux-board-cap-extract'])).toBe('Linux: Board cap extract')
  expect(doneTitle('a', recs.a, 'meta')).toBe('A job')
  expect(DONE_MAX).toBe(20)
})
