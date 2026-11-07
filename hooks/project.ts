import type { EngineInterface } from 'claude-code'

// Per-project to-dos. A session's list is ~/.claude-progress/todos/<slug>.txt, where the slug comes from the
// session's git root (or its folder when it is not in a repo), relative to home: ~/Desktop/NomBot -> desktop-nombot.
// ~/.claude-progress/todos/projects.txt maps folders to a list first: "<path prefix><TAB><slug or file>", longest
// prefix wins. A value ending in .txt is a file under ~/.claude-progress, so "todo.txt" keeps the old single list.
// No folder at all (a script run without a session) also means todo.txt.
// group.py (hooks/group.ts) does the same in Python, from the cwd the status line gets on stdin.

export const TODOS_DIR_REL = '.claude-progress/todos'
export const PROJECTS_REL = `${TODOS_DIR_REL}/projects.txt`
export const LEGACY_TODO = 'todo.txt'

export type Project = { slug: string; file: string }

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

/** A session's list: the longest projects.txt prefix holding cwd, else the git root's slug. No cwd: the old todo.txt. */
export function resolveProject(cwd: string, gitRoot: string, projectsText: string, home: string): Project {
  if (!cwd) return { slug: LEGACY_TODO, file: LEGACY_TODO }
  const c = trim(cwd)
  const hit = parseProjects(projectsText, home).filter(([p]) => under(c, p)).sort((a, b) => b[0].length - a[0].length)[0]
  if (hit) {
    const file = fileOf(hit[1])
    return { slug: file === LEGACY_TODO ? projectSlug(hit[0], home) : file.replace(/^todos\//, '').replace(/\.txt$/, ''), file }
  }
  const slug = projectSlug(gitRoot || c, home)
  return { slug, file: `todos/${slug}.txt` }
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

let cache: { cwd: string; root: string } | null = null

/** This session's project and its absolute list file. `h` is the home folder. */
export async function sessionProject($: EngineInterface, h: string): Promise<Project & { path: string; cwd: string; root: string }> {
  let cwd = ''
  try { cwd = await $.session.cwd() } catch { cwd = '' }
  if (cwd && cache?.cwd !== cwd) cache = { cwd, root: await gitRootOf($, cwd) }
  let map = ''
  try { map = String(await $.fs.read(`${h}/${PROJECTS_REL}`)) } catch { map = '' }
  const p = resolveProject(cwd, cwd ? cache!.root : '', map, h)
  return { ...p, path: `${h}/.claude-progress/${p.file}`, cwd, root: cwd ? cache!.root || cwd : '' }
}
