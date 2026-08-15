# Performance & density spec

| Table / list | Virtualized? | Default page size | Max rows it must stay usable at | Skeleton rows shown while loading |
|---|---|---|---|---|
| Zone Records | Yes (windowed render) + server pagination | 50 | 5,000+ per zone | 10 |
| Zones list | Server pagination only (no local virtualization needed at this scale) | 50 | 2,000 zones | 8 |
| External Hosts | Server pagination | 50 | 5,000 | 8 |
| Deployment Roles matrix | Virtualized rows and columns (matrix can exceed viewport both axes) | 30 servers × 30 zones visible at once | 200 servers × 500 zones | 6×6 grid |
| Servers & Interfaces | Client-side render, grouped by lab (no pagination — labs are small in practice) | n/a | 200 servers | 4 cards |
| Config Review file tree | Virtualized | n/a | 2,000 files across all servers | 6 |
| Deployment History | Server pagination | 25 | unbounded | 8 |
| Snapshot list | Server pagination | 25 | unbounded | 8 |
| Command palette results | Client-side render of server-returned top-N | top 8 per category | n/a | 3 skeleton rows per category |

## Polling / streaming

- **Deploy job progress**: Server-Sent Events if the backend supports it; otherwise poll
  `GET /deploy-jobs/:id` every **1.5s** while `status IN (QUEUED, RUNNING)`. Stop polling on any
  terminal state (`SUCCEEDED`, `FAILED`, `CANCELLED`).
- **Server health** (reachability, sync state): poll every **30s** while the Servers screen or a
  Server Detail page is open; suspend polling when the tab is hidden (`document.hidden`).
- **rndc status** (Operations panel): on-demand only, never polled automatically — it's a manual
  operational action.

## General limits

- No client-side sort/filter over an unbounded collection — always delegate to the server query once
  a list can exceed ~500 rows (Records, External Hosts, History, Snapshots).
- Diff rendering (Review & Deploy, Config Review live-vs-expected) is not virtualized — change sets
  are bounded by what a human is meant to review in one sitting; if a diff exceeds ~500 lines, show a
  "showing first 500 lines — export the full diff" affordance rather than virtualizing.
