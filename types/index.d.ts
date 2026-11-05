/** Status panel: section keys folded in ~/.claude-progress/.state/folded.txt. */
export type Folded = string[]
/** Status panel: the full status line output, colors and links removed. */
export type Lines = string[]
/**
 * Why the panel or status line may show nothing: the status script's error, and the status line left off. `note` is
 * the answer to "Turn on status line", shown until `noteAt` (epoch ms) is NOTE_MS old.
 */
export type Health = { script: string; statusOff: string; note: string; noteAt?: number }
/** Status panel: one todo.txt item; `line` is its 0-based line in the file. */
export type Todo = { owner: string; text: string; done: boolean; line: number }
/** Status panel: this session's project, the name of its to-do list (hooks/project.ts). */
export type Project = string
/** Status panel: the todo.txt line whose menu is open, -1 for none. */
export type MenuFor = number

/** Status panel: a connector's status. ok = connected, auth = needs sign-in, fail = anything else. */
export type ConnKind = 'ok' | 'auth' | 'fail'
/** Status panel: one connector, name and status only (never its URL or command), plus an account from connector-accounts.txt. */
export type Conn = { name: string; kind: ConnKind; account?: string; url?: string }
/** Status panel: the last connector check (epoch ms, 0 for none), whether one runs now, the Claude login (email · org) and the list. */
export type Conns = { at: number; checking: boolean; login: string; list: Conn[] }
/** Status panel: the tab shown. */
export type Tab = 'list' | 'connectors' | 'github' | 'log' | 'chat' | 'topology'

/** Status panel: a job's plain-language title, what it unlocks and its parent job's slug, from its progress file or titles.txt. */
/** `reads` and `writes`: what the job reads and writes, for the Topology tab's flows. */
export type Meta = { title?: string; why?: string; parent?: string; reads?: string; writes?: string; area?: string; impact?: string; gains?: Gains }
/** What a job made better, by lens: lower cost, better quality, faster speed. Each a short plain line, a number when possible. */
export type Gains = { cost?: string; quality?: string; speed?: string }
/** ~/.claude-progress/goal.json: the anchor goal, the areas of it a job can improve and the lenses of "better". */
/** `tag`: the short word shown on rows and chips. `icon` is read from old files but no longer shown. */
export type GoalArea = { id: string; name: string; tag: string; icon?: string; keywords: string[] }
export type GoalLens = { id: 'cost' | 'quality' | 'speed'; name: string; icon?: string; keywords: string[] }
export type Goal = { anchor: string; areas: GoalArea[]; lenses: GoalLens[] }
/**
 * Status panel: a finished job's or agent's record, ~/.claude-progress/.state/done/<slug>.json (hooks/done.ts).
 * `impact` is one to three short lines on what it changed. `started` and `finished` are epoch ms.
 */
export type DoneRec = { slug: string; title: string; why?: string; impact: string[]; area?: string; gains?: Gains; step?: string; started?: number; finished: number; machine: string; session?: string; kind: 'job' | 'agent' }
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

/** Secure channel: one received file not marked read. `path` is inside ~/.claude-progress/channel; `ts` is epoch s. */
export type ChanItem = { id: string; channel: string; from: string; filename: string; path: string; ts: number }
/** Secure channel: the unread received files, newest first. */
export type Channel = { items: ChanItem[] }
/** Chat tab: one message of ~/.claude-progress/channel/index.json, either direction. `sent` is epoch s, `text` the sanitized preview (a chat line whole), `chat` a say line drawn as a bubble. */
export type ChatMsg = { id: string; channel: string; dir: 'in' | 'out'; from: string; filename: string; path: string; size: number; sent: number; chat: boolean; text: string; unread: boolean }
/** Chat tab: messages oldest first, channel names, the one shown, the expanded message, its page and full lines, the compose state (`n` renews the field after a send). */
export type ChatState = { msgs: ChatMsg[]; channels: string[]; sel: string; open: string; page: number; full: string[]; sending: boolean; note: string; draft: string; n: number }

/** Action needed: one row of ~/.claude-progress/actions.json. `created` and `closed` are epoch s. `check` is a read-only test, never the command. */
export type Action = { id: string; title: string; command?: string; why: string; check?: string; priority: 'high'; created: number; project?: string; status: 'open' | 'done' | 'skipped'; skipReason?: string; closed?: number }

/** Action needed: the in-app popup's state. `confirm` is the id waiting on "Run this in <term>?", `term` the terminal it names, `failId` and `fail` the action whose check still fails and what to show. */
export type ActionUi = { confirm: string; term: string; failId: string; fail: string }

/** Topology tab: one machine of topology.json. `status`: its heartbeat file in ~/.claude-progress/.lines (hooks/topology.ts). */
export type TopoMachine = { id: string; ip?: string; role?: 'data' | 'compute'; aliases?: string[]; about?: string[]; status?: string }
/** Topology tab: an outside service, shown while a running job matches `match` (a regex, any case). `from`: the machine that calls it. */
export type TopoService = { name: string; match: string; from?: string }
/** Topology tab: ~/.claude-progress/topology.json. `self`: this machine's id when the to-do headings do not say it. */
export type TopoConfig = { self?: string; dbRole?: string; machines: TopoMachine[]; services: TopoService[] }
export type TopoHealth = { state: 'online' | 'offline' | 'unknown'; load?: string; note?: string }
export type Topo = { cfg: TopoConfig; health: Record<string, TopoHealth> }

declare module 'claude-code' {
  interface PluginState {
    'progress-bar': { folded: Folded; lines: Lines; todos: Todo[]; project: Project; menuFor: MenuFor; conns: Conns; tab: Tab; gh: Gh; meta: Record<string, Meta>; log: Log; openCards: OpenCards; recap: Recap; inbox: Inbox; channel: Channel; chat: ChatState; actions: Action[]; actionUi: ActionUi; health: Health; done: Record<string, DoneRec>; topo: Topo; goal: Goal }
  }
}
