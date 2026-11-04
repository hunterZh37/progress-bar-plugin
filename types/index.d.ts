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
export type Tab = 'list' | 'connectors'

declare module 'claude-code' {
  interface PluginState {
    'progress-bar': { folded: Folded; lines: Lines; todos: Todo[]; menuFor: MenuFor; conns: Conns; tab: Tab }
  }
}
