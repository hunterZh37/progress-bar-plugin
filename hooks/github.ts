import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isDarwin } from './mac'
import type { Branch, Commit, Repo } from '../types'

// The GITHUB tab of the Status panel: branches and recent commits of the session's repo,
// plus any folders listed in ~/.claude-progress/repos.txt (optional, one path per line).
// Read with plain local git (no network, no token). A press opens the matching GitHub page,
// and only https://github.com/ URLs are ever opened. Credentials in an https remote are dropped.

export const REPOS_REL = '.claude-progress/repos.txt'
export const GH_EVERY = 30_000

export const ghAtom = atom({ plugin: 'progress-bar', key: 'gh' } as const, { repos: [], sel: 0, at: 0 })

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string> {
  try {
    const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 8000 })
    return r.exitCode === 0 ? r.stdout : ''
  } catch { return '' }
}

/** An origin remote as https://github.com/<owner>/<repo>, '' when it is not on GitHub. Never keeps credentials. */
export function webUrl(remote: string): string {
  const r = remote.trim().replace(/^(https?|ssh):\/\/[^@/]*@/, '$1://')
  const m = /^(?:https?:\/\/github\.com\/|ssh:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(r)
  return m ? `https://github.com/${m[1]}/${m[2]}` : ''
}

/** for-each-ref lines "HEAD\x1fname\x1ftrack" -> branches with ahead/behind. */
export function parseBranches(out: string): Branch[] {
  return out.split('\n').filter(l => l.includes('\x1f')).map(l => {
    const [h = '', name = '', track = ''] = l.split('\x1f')
    return { name, current: h === '*', ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0) }
  })
}

/** log lines "sha\x1fsubject\x1fwhen\x1fauthor" -> commits. */
export function parseCommits(out: string): Commit[] {
  return out.split('\n').filter(l => l.includes('\x1f')).map(l => {
    const [sha = '', subject = '', when = '', author = ''] = l.split('\x1f')
    return { sha, subject, when: when.replace(/ ago$/, ''), author }
  })
}

/** One repo read with local git, null when the folder is not in a repo. */
export async function readRepo($: EngineInterface, path: string): Promise<Repo | null> {
  const top = (await git($, path, ['rev-parse', '--show-toplevel'])).trim()
  if (!top) return null
  const url = webUrl(await git($, top, ['remote', 'get-url', 'origin']))
  const branch = (await git($, top, ['branch', '--show-current'])).trim() || '(detached)'
  const dirty = (await git($, top, ['status', '--porcelain'])).split('\n').filter(Boolean).length
  const branches = parseBranches(await git($, top, ['for-each-ref', '--sort=-committerdate', '--count=8', '--format=%(HEAD)%1f%(refname:short)%1f%(upstream:track,nobracket)', 'refs/heads']))
  const commits = parseCommits(await git($, top, ['log', '-8', '--format=%h%x1f%s%x1f%cr%x1f%an']))
  const cur = branches.find(b => b.current)
  return { name: top.split('/').pop() || top, path: top, url, branch, dirty, ahead: cur?.ahead ?? 0, behind: cur?.behind ?? 0, branches, commits }
}

/** Reads the session's repo first, then each folder in repos.txt, once each. */
export async function readGh($: EngineInterface, h: string) {
  let list: string[] = []
  try { list = String(await $.fs.read(`${h}/${REPOS_REL}`)).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')) } catch { list = [] }
  const cwd = await $.session.cwd().catch(() => '')
  const seen = new Set<string>()
  const repos: Repo[] = []
  for (const p of [cwd, ...list.map(l => l.replace(/^~(?=\/|$)/, h))]) {
    if (!p) continue
    const r = await readRepo($, p)
    if (r && !seen.has(r.path)) { seen.add(r.path); repos.push(r) }
  }
  const now = await $.clock.now()
  await update($, ghAtom, g => ({ repos, sel: Math.min(g.sel, Math.max(0, repos.length - 1)), at: now }))
}

/** Opens a GitHub page in the browser: `open` on macOS, `xdg-open` elsewhere. Anything else is ignored. */
export async function openUrl($: EngineInterface, url: string) {
  if (!/^https:\/\/github\.com\/[^\s@]+$/.test(url)) return
  try { await $.process.run([(await isDarwin($)) ? 'open' : 'xdg-open', url], { timeoutMs: 5000 }) } catch { /* nothing to open */ }
}
