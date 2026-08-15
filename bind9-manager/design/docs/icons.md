# Icon inventory

Library: **Lucide** (https://lucide.dev), stroke-width 1.5 everywhere, per the Industry design
system. Do not hand-draw SVGs — import by name from `lucide-react` (or the equivalent for the chosen
framework). Names below are exact Lucide icon names.

| Context | Icon name |
|---|---|
| Configuration strip mark | `layers` |
| Views nav / switcher | `layers` |
| Zones nav | `globe` |
| External Hosts nav | `external-link` |
| Network Blocks nav | `git-branch` |
| Deployment Roles nav | `shield` |
| Deployment Options nav | `sliders-horizontal` |
| Servers & Interfaces nav | `server` |
| Config Review nav | `file-code` |
| Backups nav | `history` |
| Sidebar collapse toggle | `panel-left` |
| Search / command palette trigger | `search` |
| Breadcrumb separator | `chevron-right` |
| Dropdown / expand affordance | `chevron-down` |
| Collapsed group | `chevron-right` (rotated 90° when expanded, or swap for `chevron-down`) |
| Back link | `arrow-left` |
| Add record / add anything | `plus` |
| Close panel/modal | `x` |
| Edit row | `pencil` |
| Delete row / destructive action | `trash-2` |
| Copy-to-clipboard | `copy` |
| Copy confirmed (2s) | `check` |
| Refresh SOA serial | `rotate-cw` |
| Rollback | `rotate-ccw` |
| Synced state | `check` |
| Pending state | `circle` (filled dot, 6px, not the outline icon) |
| Deploying state | `loader-2` (spin animation) |
| Drift / warning state | `alert-triangle` |
| Error / failed state | `x-circle` |
| Disabled state | `slash` |
| Compare configurations | `git-compare` |
| Clone configuration | `copy` |
| Duotone image wrapper (if any marketing imagery is added later) | n/a — this app uses no photography |

Do not introduce a second icon set. If a needed concept has no clean Lucide match, prefer a short
text label over approximating it with an unrelated icon.
