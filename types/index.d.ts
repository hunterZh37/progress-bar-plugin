/** Status panel: section keys folded in ~/.claude-progress/.state/folded.txt. */
export type Folded = string[]
/** Status panel: the full status line output, colors and links removed. */
export type Lines = string[]
/** Status panel: one todo.txt item; `line` is its 0-based line in the file. */
export type Todo = { owner: string; text: string; done: boolean; line: number }
/** Status panel: the todo.txt line whose menu is open, -1 for none. */
export type MenuFor = number

/** Status panel: a connector's status. ok = connected, auth = needs sign-in, fail = anything else. */
export type ConnKind = 'ok' | 'auth' | 'fail'
/** Status panel: one connector, name and status only (never its URL or command), plus an account from connector-accounts.txt. */
export type Conn = { name: string; kind: ConnKind; account?: string }
/** Status panel: the last connector check (epoch ms, 0 for none), whether one runs now, the Claude login (email · org) and the list. */
export type Conns = { at: number; checking: boolean; login: string; list: Conn[] }
/** Status panel: the tab shown. */
export type Tab = 'list' | 'connectors' | 'github'

/** GitHub tab: one local branch, ahead/behind its upstream. */
export type Branch = { name: string; current: boolean; ahead: number; behind: number }
/** GitHub tab: one commit; `when` is git's relative date without " ago". */
export type Commit = { sha: string; subject: string; when: string; author: string }
/** GitHub tab: one repo read with local git; `url` is https://github.com/<owner>/<repo> or '' when origin is not on GitHub. */
export type Repo = { name: string; path: string; url: string; branch: string; dirty: number; ahead: number; behind: number; branches: Branch[]; commits: Commit[] }
/** GitHub tab: the repos found, the one shown and when they were read (epoch ms). */
export type Gh = { repos: Repo[]; sel: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    'progress-bar': { folded: Folded; lines: Lines; todos: Todo[]; menuFor: MenuFor; conns: Conns; tab: Tab; gh: Gh }
  }
}
