import { expect, test } from 'claude-code/testing'

import { isReplyPrompt, orphanTurnRows, rowTitle, turnStep, turnTitle, type Turn } from '../hooks/auto'
import { backgroundNote, liveShells } from '../hooks/report'
import { remoteServerWork, serverOf } from '../hooks/render'
import { prettyName } from '../hooks/done'
import { psTime, runCard, serverNote, timeTail } from '../hooks/panel'
import { DEFAULT_GOAL, lensTags } from '../hooks/goal'

// 0.35.4: rows are titled by the work, a step shows only while it runs, background shells show, remote process rows read well.

const base: Turn = { title: '', startedAt: 1, tools: 25, lastTool: 'Bash', lastWhat: 'Commit the merge', reported: false, taskBar: false, shown: true, running: [], desc: '', path: '' }

test('prompt-shaped titles: numbered replies, yes, push and pointers name no work', () => {
  for (const p of [
    '1. keep it 2. push 3. merge 4. ignore 5. spread them out',
    '1) yes\n2) no\n3) later',
    'a. push b. skip',
    'yes', 'Yes!', 'push', 'ok', 'keep it and merge', 'yes, push', 'do it', '2', '', '   ', '[Image #588]',
  ]) expect([p, isReplyPrompt(p)]).toEqual([p, true])
  for (const p of ['Fix the checkout total', '1. Rebuild the search index for every org page with the new embeddings model']) expect([p, isReplyPrompt(p)]).toEqual([p, false])
  for (const p of ['1. keep it 2. push 3. merge 4. ignore 5. spread them out', 'yes', 'push', '', 'fix these too, also explain to me why they happen please', 'do that', '/review 12', 'end yesterday', '[Image #588] what is this?'])
    expect([p, turnTitle(p)]).toEqual([p, ''])
})

test('prompt titles: the first meaningful clause, politeness out, long ones cut at a word', () => {
  expect(turnTitle('\n  Fix the   checkout total\nmore text')).toBe('Fix the checkout total')
  expect(turnTitle('Please fix the checkout rounding bug; then add a test')).toBe('Fix the checkout rounding bug')
  expect(turnTitle('can you rebuild the similar orgs lists? they look stale')).toBe('Rebuild the similar orgs lists')
  expect(turnTitle('Deploy the new build to AWS - and check the health page')).toBe('Deploy the new build to AWS')
  const long = turnTitle('Rebuild the organization similarity lists for every one of the five hundred thousand org pages using the new model')
  expect(long.length).toBeLessThanOrEqual(60)
  expect(long.endsWith('…')).toBe(true)
  expect(long).not.toMatch(/\s…$/)
  expect(turnTitle('```\npasted code\n```')).toBe('')
})

test('row title order: the session report title, then the prompt, then the latest described call, else Working', () => {
  expect(rowTitle({ title: 'Fix the cart', desc: 'Run tests' }, 'Orders table migrated')).toBe('Orders table migrated')
  expect(rowTitle({ title: 'Fix the cart', desc: 'Run tests' })).toBe('Fix the cart')
  expect(rowTitle({ title: '', desc: 'Commit the news-import merge and mark decision 12' })).toBe('Commit the news-import merge and mark decision 12')
  expect(rowTitle({ title: '', desc: '' })).toBe('Working')
})

test('step: a finished call is never shown; a running one is, the latest of several; else background, else idle', () => {
  expect(turnStep(base)).toBe('idle, 25 tool calls')
  expect(turnStep({ ...base, tools: 1 })).toBe('idle, 1 tool call')
  const a = { tool: 'Bash', what: 'Run the tests' }, b = { tool: 'Read', what: 'cart.ts' }
  expect(turnStep({ ...base, running: [a] })).toBe('Bash Run the tests, 25 tool calls')
  expect(turnStep({ ...base, running: [a, b] })).toBe('Read cart.ts, 25 tool calls')
  // The call's description is the row's title: the step names the tool only.
  expect(turnStep({ ...base, running: [a] }, '', 'Run the tests')).toBe('Bash running, 25 tool calls')
  // No call running: a live background shell, else idle. A running call wins over the background.
  expect(turnStep(base, 'background: Backfill the archive · 8m')).toBe('working · background: Backfill the archive · 8m')
  expect(turnStep({ ...base, running: [a] }, 'background: Backfill the archive · 8m')).toBe('Bash Run the tests, 25 tool calls')
  // The step never reads as a stale call, and the grouper's card parses the background part.
  const c = runCard('◐ working-shop-1111 working · working · background: Backfill the archive · 8m · 9m')
  expect(c.bg).toBe('Backfill the archive · 8m')
})

test('background note: none, one, several at once, oldest first, long names cut; ends drop them', () => {
  liveShells.clear()
  expect(backgroundNote(0)).toBe('')
  const now = 10_000_000
  liveShells.set('/p/shell-a.json', { body: '{}', taskId: 'a', title: 'Run the news import backfill on the AWS server', startedAt: now - 65 * 60_000 })
  // a foreground shell over a minute (no task id) is not a background job
  liveShells.set('/p/shell-f.json', { body: '{}', title: 'Run the test suite', startedAt: now - 2 * 60_000 })
  expect(backgroundNote(now)).toBe('background: Run the news import backfill on the AWS server · 1h05m')
  liveShells.set('/p/shell-b.json', { body: '{}', taskId: 'b', title: 'x'.repeat(90), startedAt: now - 60_000 })
  liveShells.set('/p/shell-c.json', { body: '{}', taskId: 'c', title: 'Watch the deploy', startedAt: now - 30_000 })
  expect(backgroundNote(now)).toBe('background: Run the news import backfill on the AWS server, +2 more · 1h05m')
  liveShells.delete('/p/shell-a.json')
  expect(backgroundNote(now)).toBe(`background: ${'x'.repeat(59)}…, +1 more · 1m`)
  liveShells.clear()
  expect(backgroundNote(now)).toBe('')
})

test('servers: "Run X on the AWS server" and remote runners are jobs; real dev servers stay servers', () => {
  expect(serverOf('cd ~/infra && build/ssm-run.sh /tmp/x.sh 10800 2>&1 | tail -25', 'Run the news import migration and backfill on the AWS server')).toBe(null)
  expect(serverOf('ssh box ./deploy.sh', 'Run the deploy on the prod server')).toBe(null)
  expect(serverOf('./x.sh', 'Run the load test against the staging server')).toBe(null)
  expect(serverOf('ssh box "systemctl restart api"', 'Start the API server')).toBe(null)
  expect(serverOf('./go.sh', 'Start ShopWebsite dev server')).toBe('')
  expect(serverOf('./go.sh', 'Run the API server')).toBe('')
  expect(serverOf('npm run dev -- -p 3000', 'Run the backfill on the AWS server')).toBe(':3000')
  expect(remoteServerWork('Deploy to the prod server')).toBe(true)
  expect(remoteServerWork('Start the dev server')).toBe(false)
  // A row an older build wrote as "serving" for remote work reads as a job again.
  const legacy = runCard('◐ shell-run-the-news-import-migration-and-backfill working · serving · 8m')
  expect(serverNote(legacy, 'Run the news import migration and backfill on the AWS server')).toBe(null)
  expect(serverNote(runCard('◐ shell-start-the-preview working · serving :3001 · 8m'), 'Start the preview on port 3001')).toBe('serving :3001 · up 8m')
  expect(serverNote(runCard('◐ shell-start-shop-dev-server working · serving · 8m'), 'Start Shop dev server')).toBe('serving · up 8m')
})

test('remote process rows: ps run times read as durations, a unit names the job, script names read as words', () => {
  for (const [x, want] of [['00:45', '45s'], ['06:05', '6m'], ['59:59', '59m'], ['1:02:03', '1h02m'], ['12:00:00', '12h00m'], ['2-03:04:05', '2d3h'], ['nope', 'nope']] as const)
    expect([x, psTime(x)]).toEqual([x, want])
  const c = runCard('◐ box: org_similar.py · 273% CPU · 06:05 · unit: Weekly similar organizations')
  expect(c.ran).toBe('6m')
  expect(c.unit).toBe('Weekly similar organizations')
  expect(c.step).toBe('')
  expect(c.facts).toBe('2.7 cores busy · 6m running')
  expect(timeTail(c)).toBe('6m running')
  expect(runCard('◐ box: train.py · 540% CPU · 1-02:03:04').ran).toBe('1d2h')
  expect(runCard('◐ box: train.py · 540% CPU · 12:50').unit).toBe(undefined)
  expect(prettyName('box: org_similar.py')).toBe('Box: Org similar')
  expect(prettyName('box: train.sh')).toBe('Box: Train')
  expect(prettyName('nightly-import')).toBe('Nightly import')
  expect(prettyName('box: Rebuild lists.py')).toBe('Box: Rebuild lists.py')
})

test('"likely improves": only from real words on live rows; named gains always; done rows keep the default', () => {
  const g = DEFAULT_GOAL
  // A live row's guess needs a cost, speed or quality word: no default "quality".
  expect(lensTags(g, undefined, '1. keep it 2. push 3. merge', false)).toEqual([])
  expect(lensTags(g, undefined, 'Org similar', false)).toEqual([])
  expect(lensTags(g, undefined, 'Make the import faster', false)).toEqual([{ id: 'speed', name: 'speed', text: '', inferred: true }])
  expect(lensTags(g, undefined, 'Cut the GPU cost', false)).toEqual([{ id: 'cost', name: 'cost', text: '', inferred: true }])
  const q = { ...g, lenses: g.lenses.map(l => (l.id === 'quality' ? { ...l, keywords: ['accuracy'] } : l)) }
  expect(lensTags(q, undefined, 'Better match accuracy', false)).toEqual([{ id: 'quality', name: 'quality', text: '', inferred: true }])
  expect(lensTags(g, { quality: '12K more orders matched' }, 'x', false)).toEqual([{ id: 'quality', name: 'quality', text: '12K more orders matched', inferred: false }])
  // A finished job's impact keeps its lens, quality by default (unchanged).
  expect(lensTags(g, undefined, '1.65M more board seats')).toEqual([{ id: 'quality', name: 'quality', text: '', inferred: true }])
})

test('orphan turn rows: only this session\'s turn-shaped rows, never the live one, a bar or another session\'s', () => {
  const sid = '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d'
  const files = [
    { name: 'working-web-0a1b.json', session: sid },
    { name: 'working-shop-0a1b.json', session: sid },
    { name: 'working-web-9999.json', session: 'other' },
    { name: 'working-hours-report-0a1b.json', session: sid, bar: true },
    { name: 'shell-x.json', session: sid },
  ]
  expect(orphanTurnRows(files, '/h/.claude-progress', sid, '/h/.claude-progress/working-shop-0a1b.json')).toEqual(['/h/.claude-progress/working-web-0a1b.json'])
  expect(orphanTurnRows(files, '/d', sid, '')).toEqual(['/d/working-web-0a1b.json', '/d/working-shop-0a1b.json'])
  expect(orphanTurnRows(files, '/d', '', '')).toEqual([])
})
