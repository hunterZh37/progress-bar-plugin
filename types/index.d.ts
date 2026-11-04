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
export type Conn = { name: string; kind: ConnKind; account?: string; url?: string }
/** Status panel: the last connector check (epoch ms, 0 for none), whether one runs now, the Claude login (email · org) and the list. */
export type Conns = { at: number; checking: boolean; login: string; list: Conn[] }
/** Status panel: the tab shown. */
export type Tab = 'list' | 'connectors' | 'github' | 'log'

/** Status panel: a job's plain-language title, what it unlocks and its parent job's slug, from its progress file or titles.txt. */
export type Meta = { title?: string; why?: string; parent?: string }
/** Status panel: slugs of the running jobs whose line is open to show its details. */
export type OpenCards = string[]
/** Log tab: an event's level. */
export type Level = 'error' | 'warning' | 'success' | 'info'
/** Log tab: one line of ~/.claude-progress/events.jsonl. `ts` is epoch seconds. */
export type Ev = { ts: number; level: Level; source: string; title: string; detail?: string; path?: string }
/** Log tab: the filter shown. */
export type LogFilter = 'all' | 'error' | 'warning' | 'success'
/** Log tab: events newest first, the filter, the id of the row showing its detail, when the tab was last opened (epoch s) and the log folders from log-dirs.txt. */
export type Log = { events: Ev[]; filter: LogFilter; open: string; seenAt: number; dirs: string[] }

/** GitHub tab: one local branch, ahead/behind its upstream. */
export type Branch = { name: string; current: boolean; ahead: number; behind: number }
/** GitHub tab: one commit; `when` is git's relative date without " ago". */
export type Commit = { sha: string; subject: string; when: string; author: string }
/** GitHub tab: one repo read with local git; `url` is https://github.com/<owner>/<repo> or '' when origin is not on GitHub. */
export type Repo = { name: string; path: string; url: string; branch: string; dirty: number; ahead: number; behind: number; branches: Branch[]; commits: Commit[] }
/** GitHub tab: the repos found, the one shown and when they were read (epoch ms). */
export type Gh = { repos: Repo[]; sel: number; at: number }

/** Inbox: one item of ~/.claude-progress/inbox.json. url: https only, '' otherwise. */
export type InboxItem = { id: string; from: string; subject: string; why: string; due?: string; url: string }
/** Inbox: when it was last checked (epoch s) and the items not marked handled. */
export type Inbox = { checked: number; items: InboxItem[] }

/** Overnight recap: one running job at checkpoint time (`/progress-bar checkpoint` or checkpoint.py). */
export type Snap = { name: string; pct?: number; done?: number; total?: number }
/** Overnight recap: ~/.claude-progress/.state/overnight.json. `since` and `woke` are epoch s; woke is when the panel saw a clock gap over 30 min (the computer slept). */
export type Checkpoint = { since: number; label: string; running: Snap[]; woke?: number }
/** Overnight recap: the checkpoint, the panel's last tick (epoch ms) and whether the full list is open. */
export type Recap = { cp: Checkpoint | null; lastTick: number; open: boolean }

declare module 'claude-code' {
  interface PluginState {
    'progress-bar': { folded: Folded; lines: Lines; todos: Todo[]; menuFor: MenuFor; conns: Conns; tab: Tab; gh: Gh; meta: Record<string, Meta>; log: Log; openCards: OpenCards; recap: Recap; inbox: Inbox }
  }
}
