# Keyboard shortcut map

| Key | Action | Scope | Active while panel/modal open? |
|---|---|---|---|
| `⌘K` / `Ctrl+K` | Open command palette | Global | Yes (replaces focus) |
| `/` | Focus the topbar search | Global, not while a text field is focused | No |
| `Esc` | Close the open panel, modal, or command palette (topmost first) | Global | Yes — closes the topmost only |
| `⌘Enter` / `Ctrl+Enter` | Submit the focused form (side panel Save, modal confirm) | Panel/modal | Yes |
| `j` / `k` | Move selection down / up one row | Any DataTable, when a row or the table has focus | No — tables aren't rendered under a modal |
| `x` | Toggle selection on the focused row | DataTable | No |
| `e` | Open edit panel for the focused row | DataTable | No |
| `⌘Z` / `Ctrl+Z` | Undo the last staged local edit (e.g. a quick delete) while its undo toast is visible | Global, toast-scoped | Yes |
| `g` then `v` / `z` / `s` | Go to Views / Zones / Servers (sequence, like Linear/Gmail) | Global | No |
| `?` | Open the shortcut cheat-sheet | Global | No |
| `Tab` / `Shift+Tab` | Move focus forward / backward through the full tab order | Global | Yes — trapped inside the open panel/modal |
| `↑` / `↓` | Move through command-palette or combobox results | Palette/combobox | Yes |

The cheat-sheet triggered by `?` is itself a modal (`Modal` with a static table) and follows the same
Esc/focus-trap rules as any other modal.
