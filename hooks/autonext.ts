// Auto-next: when a running job finishes, start the top ready to-do of its machine.
//
// Trigger: a "<job> done" success event in ~/.claude-progress/events.jsonl. group.py logs one per finish, once
// (its done:<slug> key), so every setup that logs events drives this, the plugin's grouper or your own.
// Each open session checks every 5 s. One session acts on a finish: it claims it with an atomic mkdir under
// .state/autonext-claims/, so two sessions (or a reload) never act twice. The session whose own agent finished
// claims at once, others wait 20 s first, so the prompt lands in the session that ran the job when it can.
// It acts on the finished job's machine, plus any machine with an item that was waiting for that job.
// A machine at its cap (.state/caps, default mac=3, hunty=2) of running rows waits, and is tried again each check.
// Mode (.state/autonext, set by /progress-bar autonext): on submits the prompt with $.prompt.submit, ask shows a
// toast and puts the prompt in the prompt box as a suggestion (Tab takes it), off does nothing.

import type { EngineInterface } from 'claude-code'

import { resolveHome } from './home'
import { blocker, doneEvents, isRunningRow, jobMachine, nextPrompt, openItems, parseCaps, parseMode, ranked, rowName } from './priority'
import type { Mode } from './priority'
import { FRESH_MS, parseTitles, pickMeta, slug } from './render'

const DIR_REL = '.claude-progress'
const OWN_DELAY_S = 20
const PENDING_MAX_S = 6 * 3600
const ITEM_HOLD_MS = 6 * 3600_000
const LINES_FRESH_MS = 2 * 60_000

type Pending = { key: string; source: string; title: string; ts: number; machines: string[] }

let since = 0
const pending = new Map<string, Pending>()
/** Slugs of this session's own agents, so their finish lands here first. register.tsx fills it. */
export const ownJobs = new Set<string>()

export const MODE_REL = `${DIR_REL}/.state/autonext`

export async function readMode($: EngineInterface, h: string): Promise<Mode> {
  try { return parseMode(String(await $.fs.read(`${h}/${MODE_REL}`))) } catch { return 'ask' }
}

/** `/progress-bar autonext [on|off|ask]`. */
export async function autonextCommand($: EngineInterface, arg: string): Promise<string> {
  const h = await resolveHome($)
  if (!h) return 'Could not find your home folder ($HOME is unset).'
  const a = arg.trim().toLowerCase()
  const say = (m: Mode) => m === 'on'
    ? 'Auto-next is on. When a job finishes, the top ready to-do of its machine starts by itself.'
    : m === 'ask'
      ? 'Auto-next asks. When a job finishes, a toast names the next to-do and the prompt box suggests it (Tab to take).'
      : 'Auto-next is off.'
  if (!a) return `${say(await readMode($, h))}\nUsage: /progress-bar autonext on|off|ask`
  if (a !== 'on' && a !== 'off' && a !== 'ask') return 'Usage: /progress-bar autonext on|off|ask'
  await $.fs.write(`${h}/${MODE_REL}`, `${a}\n`)
  return say(a)
}

/** Running rows from every fresh .lines/*.txt and the grouper's state, with names and titles (progress file or titles.txt). */
async function runningRows($: EngineInterface, dir: string, now: number): Promise<{ name: string; title: string }[]> {
  const out: { name: string; title: string }[] = []
  let titles: Record<string, { title?: string }> = {}
  try { titles = parseTitles(String(await $.fs.read(`${dir}/titles.txt`))) } catch { titles = {} }
  let files: Awaited<ReturnType<typeof $.fs.list>> = []
  try { files = await $.fs.list(`${dir}/.lines`) } catch { files = [] }
  const seen = new Set<string>()
  for (const f of files) {
    if (f.kind !== 'file' || !f.name.endsWith('.txt') || now - f.mtimeMs > LINES_FRESH_MS) continue
    let text = ''
    try { text = String(await $.fs.read(`${dir}/.lines/${f.name}`)) } catch { continue }
    for (const l of text.split('\n')) {
      if (!isRunningRow(l.trim())) continue
      const name = rowName(l.trim())
      if (!name || seen.has(slug(name))) continue
      seen.add(slug(name))
      let title = titles[slug(name)]?.title ?? ''
      try {
        const st = await $.fs.stat(`${dir}/${slug(name)}.json`)
        if (now - st.mtimeMs < FRESH_MS) title = pickMeta(JSON.parse(String(await $.fs.read(`${dir}/${slug(name)}.json`)))).title ?? title
      } catch { /* no progress file */ }
      out.push({ name, title })
    }
  }
  // The grouper's own view (every source it groups, not just .lines): .state/group-seen.json, or seen.txt of an older group.py.
  for (const file of ['group-seen.json', 'seen.txt']) {
    let saved: Record<string, { name?: string; at?: number; kind?: string }> = {}
    try { saved = JSON.parse(String(await $.fs.read(`${dir}/.state/${file}`))) } catch { continue }
    for (const [k, v] of Object.entries(saved ?? {})) {
      if (!v || typeof v !== 'object' || v.kind !== 'running' || !v.at || now / 1000 - v.at > 120 || k.startsWith('.')) continue
      const name = typeof v.name === 'string' ? v.name : k
      if (seen.has(slug(name)) || /% CPU|helper healthy/.test(String((v as { last?: string }).last ?? ''))) continue
      seen.add(slug(name))
      out.push({ name, title: titles[slug(name)]?.title ?? '' })
    }
  }
  return out
}

/** mkdir as a lock: true when this call made the folder. */
async function claim($: EngineInterface, path: string): Promise<boolean> {
  const r = await $.process.run(['mkdir', path], { timeoutMs: 5000 }).catch(() => ({ exitCode: 1 }))
  return r.exitCode === 0
}

/** Holds an item for 6 h once started, so two finishes never start the same to-do. True when this call holds it. */
async function holdItem($: EngineInterface, claims: string, body: string, now: number): Promise<boolean> {
  const p = `${claims}/item-${slug(body).slice(0, 80)}`
  if (await claim($, p)) return true
  try {
    if (now - (await $.fs.stat(p)).mtimeMs > ITEM_HOLD_MS) {
      await $.process.run(['rmdir', p], { timeoutMs: 5000 })
      return claim($, p)
    }
  } catch { /* gone */ }
  return false
}

/** One check: new finishes join the queue, then each queued finish starts what it can. */
export async function tickAutonext($: EngineInterface) {
  const h = await resolveHome($)
  if (!h) return
  const dir = `${h}/${DIR_REL}`
  const nowMs = await $.clock.now()
  const now = nowMs / 1000
  if (!since) { since = now - 60; return } // the first check only sets the start: older finishes are not this session's to act on
  const mode = await readMode($, h)
  if (mode === 'off') { pending.clear(); return }
  let todo = ''
  try { todo = String(await $.fs.read(`${dir}/todo.txt`)) } catch { return }
  const heads = [...new Set(openItems(todo).map(i => i.heading))]
  if (!heads.some(x => x.toLowerCase() !== 'you')) return

  let raw = ''
  try { raw = String(await $.fs.read(`${dir}/events.jsonl`)) } catch { raw = '' }
  for (const ev of doneEvents(raw, since)) {
    const key = `${slug(ev.source)}-${Math.floor(ev.ts)}`
    if (pending.has(key)) continue
    // Its machine, plus any machine with an item waiting for it.
    const mine = jobMachine(ev.source, ev.title, heads)
    const freed = openItems(todo).filter(i => i.after && i.heading.toLowerCase() !== 'you' && blocker(i.after, [ev.source, ev.title].filter(Boolean))).map(i => i.heading)
    pending.set(key, { key, source: ev.source, title: ev.title, ts: ev.ts, machines: [...new Set([mine, ...freed].filter(Boolean))] })
  }
  if (!pending.size) return

  const claims = `${dir}/.state/autonext-claims`
  await $.process.run(['mkdir', '-p', claims], { timeoutMs: 5000 }).catch(() => undefined)
  let capsText = ''
  try { capsText = String(await $.fs.read(`${dir}/.state/caps`)) } catch { /* defaults */ }
  const caps = parseCaps(capsText)
  const rows = await runningRows($, dir, nowMs)
  const running = rows.flatMap(r => [r.name, r.title].filter(Boolean))
  const busy = (m: string) => rows.filter(r => jobMachine(r.name, r.title, heads).toLowerCase() === m.toLowerCase()).length

  for (const p of [...pending.values()]) {
    if (now - p.ts > PENDING_MAX_S) { pending.delete(p.key); continue }
    if (!ownJobs.has(slug(p.source)) && now - p.ts < OWN_DELAY_S) continue
    const left: string[] = []
    for (const m of p.machines) {
      const cap = caps[m.toLowerCase()]
      if (cap !== undefined && busy(m) >= cap) { left.push(m); continue }
      const ready = ranked(todo, running).filter(i => i.heading.toLowerCase() === m.toLowerCase() && !i.blockedBy)
      if (!ready.length) continue
      // One session acts per finish and machine; one start per item (the top one another finish took is skipped).
      if (!(await claim($, `${claims}/${p.key}-${slug(m)}`))) continue
      let item = null
      for (const r of ready) if (await holdItem($, claims, r.body, nowMs)) { item = r; break }
      if (!item) continue
      const text = nextPrompt(item.body, item.url)
      if (mode === 'on') {
        $.ui.toast(`${p.title} done. Starting next for ${m}: ${item.body}`, { timeoutMs: 8000 })
        void $.prompt.submit({ text })
      } else {
        $.ui.toast(`${p.title} done. Next for ${m}: ${item.body}. Press Tab to start it.`, { timeoutMs: 15000 })
        void $.prompt.suggest({ text }).catch(() => undefined)
      }
    }
    if (left.length) pending.set(p.key, { ...p, machines: left })
    else pending.delete(p.key)
  }
}
