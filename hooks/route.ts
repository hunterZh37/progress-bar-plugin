// Which session shows a progress file. A file can name its owner:
//   "session": the Claude Code session id ($CLAUDE_CODE_SESSION_ID), shown only in that session,
//   "cwd": the folder the job runs for, shown in every session of that folder's project.
// A file with neither is shared: it goes to .lines/jobs.txt, which todos/lines.txt routes, or every session shows
// when there is no lines.txt (a fresh machine).

export type Owner = { session?: string; cwd?: string }

/** The short session key the line files use: letters, digits, _ and -, at most 12. */
export const sessionKeyOf = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)

/** The `session` and `cwd` strings of a parsed progress file, the ones present and not empty. */
export function pickOwner(p: unknown): Owner {
  const o: Owner = {}
  if (!p || typeof p !== 'object') return o
  const r = p as Record<string, unknown>
  if (typeof r.session === 'string' && sessionKeyOf(r.session)) o.session = r.session.trim()
  if (typeof r.cwd === 'string' && r.cwd.trim().startsWith('/')) o.cwd = r.cwd.trim()
  return o
}

/**
 * Where this session puts a progress file's row: `mine` (this session's own line file), `skip` (another open
 * session shows it) or `shared` (jobs.txt).
 * `live` maps every other open session's key to its project. A file whose session is not open (a closed session,
 * a child process) falls back to its cwd, and a cwd whose project has no open session falls back to shared.
 */
export function routeOf(o: Owner, me: { key: string; project: string }, live: ReadonlyMap<string, string>, projectOf: (cwd: string) => string): 'mine' | 'skip' | 'shared' {
  if (o.session) {
    const k = sessionKeyOf(o.session)
    if (k === me.key) return 'mine'
    if (live.has(k)) return 'skip'
  }
  if (o.cwd) {
    const p = projectOf(o.cwd)
    if (me.project && p === me.project) return 'mine'
    if ([...live.values()].includes(p)) return 'skip'
  }
  return 'shared'
}

/** The first line of a claims file names its session's project. */
export const PROJECT_LINE = '#project '
