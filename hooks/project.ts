import type { EngineInterface } from 'claude-code'

// Per-project to-dos. A session's list is ~/.claude-progress/todos/<slug>.txt, where the slug comes from the
// session's git root (or its folder when it is not in a repo), relative to home: ~/Desktop/MyApp -> desktop-myapp.
// ~/.claude-progress/todos/projects.txt maps folders to a list first: "<path prefix><TAB><slug or file>", longest
// prefix wins. A value ending in .txt is a file under ~/.claude-progress, so "todo.txt" keeps the old single list.
// No folder at all (a script run without a session) also means todo.txt.
// group.py (hooks/group.ts) does the same in Python, from the cwd the status line gets on stdin.

export const TODOS_DIR_REL = '.claude-progress/todos'
export const PROJECTS_REL = `${TODOS_DIR_REL}/projects.txt`
export const LEGACY_TODO = 'todo.txt'

/**
 * `slug` names the folder (goals, localhost names, Chrome account). `key` names the list: two folders that share a list
 * in projects.txt (both mapped to todo.txt) share a key, so routing and actions treat them as one project. It is the
 * list file for a projects.txt value ending .txt, else the slug. `aliases` are every name the list goes by (its key,
 * file and the slug of each prefix mapped to it), so an action an older build tagged with a folder's slug still shows.
 */
export type Project = { slug: string; file: string; key: string; aliases: string[] }

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const under = (p: string, prefix: string) => p === prefix || p.startsWith(prefix === '/' ? '/' : `${prefix}/`)

/** A folder's slug: its path under home, lowercased, runs of other characters as "-". Home itself is "home", / is "root". */
export function projectSlug(root: string, home: string): string {
  const r = trim(root)
  const rel = home && under(r, trim(home)) ? r.slice(trim(home).length) : r
  return rel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || (r === trim(home) ? 'home' : 'root')
}

/** projects.txt rows, "~" expanded. Blank lines and "#" comments skipped. Tabs, or 2+ spaces, split the columns. */
export function parseProjects(text: string, home: string): [string, string][] {
  const out: [string, string][] = []
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    if (!l || l.startsWith('#')) continue
    const m = /^(.+?)(?:\t+|\s{2,})(\S.*)$/.exec(l)
    if (!m) continue
    const prefix = trim(m[1]!.trim().replace(/^~(?=\/|$)/, home))
    out.push([prefix, m[2]!.trim()])
  }
  return out
}

/** The list file (relative to ~/.claude-progress) for a value from projects.txt or a slug. */
export const fileOf = (v: string) => (v.endsWith('.txt') ? v.replace(/^\/+/, '') : `todos/${v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.txt`)

/**
 * A session's list: the longest projects.txt prefix holding cwd, else the git root's slug. No cwd: the old todo.txt.
 * `mainCwd` is cwd moved into the main checkout when cwd is in a git worktree (worktreeCwd): a prefix holding cwd itself
 * wins, then one holding mainCwd, so a worktree shares its repo's list wherever it sits.
 */
export function resolveProject(cwd: string, gitRoot: string, projectsText: string, home: string, mainCwd = ''): Project {
  if (!cwd) return { slug: LEGACY_TODO, file: LEGACY_TODO, key: LEGACY_TODO, aliases: [LEGACY_TODO] }
  const c = trim(cwd)
  const rows = parseProjects(projectsText, home)
  const best = (x: string) => rows.filter(([p]) => under(x, p)).sort((a, b) => b[0].length - a[0].length)[0]
  const hit = best(c) ?? (mainCwd ? best(trim(mainCwd)) : undefined)
  if (hit) {
    const file = fileOf(hit[1])
    const named = file.replace(/^todos\//, '').replace(/\.txt$/, '')
    const slug = file === LEGACY_TODO ? projectSlug(hit[0], home) : named
    const key = hit[1].endsWith('.txt') ? file : named
    const aliases = new Set([key, file, slug, named])
    for (const [p, v] of rows) if (fileOf(v) === file) aliases.add(projectSlug(p, home))
    return { slug, file, key, aliases: [...aliases] }
  }
  const slug = projectSlug(gitRoot || c, home)
  const file = `todos/${slug}.txt`
  return { slug, file, key: slug, aliases: [slug, file] }
}

/** The nearest folder at or above `dir` that holds .git, or '' when there is none. */
export async function gitRootOf($: EngineInterface, dir: string): Promise<string> {
  let d = trim(dir)
  for (let i = 0; i < 64 && d; i++) {
    if (await $.fs.exists(`${d}/.git`).catch(() => false)) return d
    const up = d.replace(/\/[^/]*$/, '') || '/'
    if (up === d) break
    d = up
  }
  return ''
}

/**
 * The main checkout a git worktree belongs to: a worktree's .git is a file, "gitdir: <main>/.git/worktrees/<name>".
 * A main checkout (or anything else) is itself. So a worktree, wherever it sits, has its repo's project.
 */
export async function mainRootOf($: EngineInterface, root: string): Promise<string> {
  if (!root) return ''
  let text = ''
  try { text = String(await $.fs.read(`${root}/.git`)) } catch { return root }
  return mainOfGitFile(text, root) || root
}

/** cwd moved from a worktree into its main checkout (same path below the root), so projects.txt prefixes still apply. */
export function worktreeCwd(cwd: string, root: string, main: string): string {
  if (!root || !main || root === main) return cwd
  const c = trim(cwd)
  return under(c, root) ? `${main}${c.slice(root.length)}` : cwd
}

/** The main checkout named by a worktree's .git file text, '' when it names none (not a worktree). */
export function mainOfGitFile(text: string, root: string): string {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text)
  if (!m) return ''
  let g = m[1]!
  if (!g.startsWith('/')) {
    const parts = `${root}/${g}`.split('/')
    const out: string[] = []
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p) }
    g = `/${out.join('/')}`
  }
  const w = /^(.*)\/\.git\/worktrees\/[^/]+\/?$/.exec(g)
  return w ? w[1] || '/' : ''
}

let cache: { cwd: string; root: string; main: string } | null = null

/** This session's project and its absolute list file. `h` is the home folder. */
export async function sessionProject($: EngineInterface, h: string): Promise<Project & { path: string; cwd: string; root: string }> {
  let cwd = ''
  try { cwd = await $.session.cwd() } catch { cwd = '' }
  if (cwd && cache?.cwd !== cwd) { const root = await gitRootOf($, cwd); cache = { cwd, root, main: await mainRootOf($, root) } }
  let map = ''
  try { map = String(await $.fs.read(`${h}/${PROJECTS_REL}`)) } catch { map = '' }
  // A worktree's list is its main checkout's, unless a projects.txt prefix holds the worktree itself.
  const p = resolveProject(cwd, cwd ? cache!.main : '', map, h, cwd ? worktreeCwd(cwd, cache!.root, cache!.main) : '')
  return { ...p, path: `${h}/.claude-progress/${p.file}`, cwd, root: cwd ? cache!.root || cwd : '' }
}
