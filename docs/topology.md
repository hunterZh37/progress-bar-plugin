# Topology tab

Optional. Draw your machines and what data moves between them.

The **Topology** tab of the Status panel draws your machines as a tree: the data host on top, each helper below it, and what data moves on each branch. With no `~/.claude-progress/topology.json` it shows this machine alone, named by its host name. The plugin never writes that file. Create it when you run jobs on more than one machine.

```
                               → Orders API  → Claude
                                   ● mac-mini  data host · 1 job
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
            ▲▼ reads + writes                            ▼ reads
                    │                                       │
                 ● server-1                             ● laptop
          1 job · load 0.37/12                            1 job
```

Press a machine's name to open it below the tree. Press a job there to see what it moves:

```
▾ ● server-1  1 job · load 0.37/12
    ▾ Orders backfill 2024              83%  reads + writes
        reads: orders table
        writes: Postgres on mac-mini
    1 queued
```

## topology.json

```json
{
  "dbRole": "helper",
  "machines": [
    {"id": "mac-mini", "ip": "10.0.0.2", "role": "data", "aliases": ["mac", "local"], "about": ["Postgres, repos"]},
    {"id": "server-1", "ip": "10.0.0.3", "role": "compute", "aliases": ["linux"], "about": ["12 cores + GPU"], "status": "server-1.txt"},
    {"id": "laptop", "role": "compute"}
  ],
  "services": [
    {"name": "Orders API", "match": "\\borders api\\b", "from": "mac-mini"},
    {"name": "Claude", "match": "\\bclaude\\b"},
    {"name": "GitHub", "match": "github|git push|\\bpr\\b"}
  ]
}
```

- **machines:** each has an `id`, an optional `ip`, a `role` (`data` for the one that holds the database, else `compute`), `aliases` (other names in titles and to-do headings), `about` lines and an optional `status` heartbeat file.
- **services:** a `name`, a `match` regex and an optional `from` machine.
- **self:** add `"self": "<id>"` when this machine's to-do headings do not say which one it is.
- **Bad or missing parts** fall back to this machine alone.

## How it reads

- **Tree:** the data host is the root, helpers are leaves spread evenly across the width. More helpers add more leaves.
- **Branches:** `▼ reads` the helper reads from the data host, `▲ writes` it writes back, `▲▼ reads + writes` both, `(N)` when several jobs share it, `┊` nothing moving, `✕ offline`. A branch is green while data moves, dim when idle, red when offline.
- **Dots:** green busy, dim idle or unknown, red offline. Under each leaf: its job count and load.
- **Services:** `→ Orders API`, `→ Claude` or `→ GitHub` show dim above the root while a running job's name, title, step, reads or writes match their pattern.
- **Open machine:** below the tree, so the tree never breaks. Its running jobs, one row each with percent and what each moves, the services it calls and how many to-dos are queued for it. Waiting jobs show only when they say what they wait on.
- **Open job:** its reads, writes, what it waits on, its step, why and area tag (`area: Search`, see the goal view in [status-panel.md](status-panel.md)).
- **Jobs:** the same rows as the List tab, plus a DONE row that still has a bar. A job's machine is its `<host>: ` row prefix, the machine word its title starts with (`Server-1 orders backfill`), or the first word of its slug (`server-1-backfill`), else this machine.
- **Flows:** a job on a helper reads from the data host (its `reads` names what, else the data host's database as the read-only `dbRole`). It writes back only when its progress file has `writes`.
- **Health:** this machine is online. A machine with a `status` file (`.lines/server-1.txt`) is online while that file is under 2 minutes old and says `✓`, else offline. A machine without one is `unknown`. The plugin runs no network checks of its own.
- **Width:** under 60 columns the tree runs down the left:

```
● mac-mini  data host · 1 job  → Orders API
├─ ▲▼ reads + writes ── ● server-1  1 job
└─ ▼ reads ── ● laptop  1 job
```
