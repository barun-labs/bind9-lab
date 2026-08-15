# Accessibility annotations

Baseline: WCAG 2.1 AA. Every interactive element has a visible `:focus-visible` ring
(`2px solid var(--color-accent)`, 2px offset) — never `outline: none` without a replacement.

| Component | Semantic element | ARIA | Focus order | Focus trap | Live region |
|---|---|---|---|---|---|
| Sidebar nav | `<nav>` with `<a>` items | `aria-current="page"` on the active item | Before topbar (logical DOM order: sidebar → topbar → content) | n/a | n/a |
| ConfigurationSwitcher | `<button>` + `role="menu"` popover | `aria-haspopup="menu"`, `aria-expanded` | Trigger, then each `role="menuitem"` | Yes, while open | n/a |
| ViewSwitcher | Same pattern as ConfigurationSwitcher | Same | Same | Yes, while open | n/a |
| PendingChangesPill | `<a>` (navigates to Review & Deploy) | `aria-label="{n} pending changes, review and deploy"` | Normal tab order | n/a | n/a |
| DataTable | `<table>` with `<th scope="col">` | Sort buttons: `aria-sort` on the active `<th>` | Header → quick-add row → data rows → pagination | n/a | Row-count changes announced via a visually-hidden `aria-live="polite"` region ("{n} records shown") |
| Row checkbox | `<input type="checkbox">` | `aria-label="Select {recordName}"` | Inline in row tab order | n/a | n/a |
| StatusPill | `<span>` | `role="img"` with `aria-label` equal to the visible label (dot is decorative, `aria-hidden`) | n/a | n/a | n/a |
| SidePanel | `<div role="dialog" aria-modal="true" aria-labelledby>` | labelledby → panel title | Close button → first field → … → Save; Esc returns focus to the trigger | Yes | n/a |
| Modal | Same as SidePanel | Same | Same | Yes | n/a |
| DiffViewer | `<div role="group" aria-label="Diff for {objectName}">` | added/removed lines get `aria-label` prefixes ("Added: …" / "Removed: …") since color can't carry the meaning for a screen reader either | n/a | n/a | n/a |
| Toast | `<div role="status">` (info/success) or `role="alert"` (error) | n/a | Not part of tab order; action button is | n/a | Announced on mount |
| InlineAlert | `<div role="alert">` (error/warn) or `role="status">` (info) | n/a | n/a | n/a | Announced on mount |
| CommandPalette | `<div role="dialog" aria-modal="true">` + `<input role="combobox" aria-expanded aria-controls>` + `<ul role="listbox">` | Results are `role="option"` | Input → results (arrow keys) → close | Yes | Result count announced |
| Deploy progress panel | `<div aria-live="polite">` wrapping the per-server rows | Each row's status change is announced ("bind-pri-01: deployed", "bind-sec-01: unreachable") | n/a | n/a | Yes — this is the one place progress *must* be announced, per the brief's "recover without a terminal" criterion |
| Tabs (Server Detail) | `<div role="tablist">` / `role="tab"` / `role="tabpanel"` | `aria-selected`, `aria-controls` | Tab list (arrow keys) → panel content | n/a | n/a |
| Tooltip | `aria-describedby` on the trigger pointing to the tooltip's id | n/a | Not separately focusable; appears on hover/focus of trigger | n/a | n/a |
| Breadcrumb | `<nav aria-label="Breadcrumb">` with `<ol>` | Current page: `aria-current="page"` | n/a | n/a | n/a |

General rules: every icon-only button has an `aria-label`; every form field's `<label>` uses `htmlFor`
matching the input's `id` (mockups in this handoff sometimes omit this for speed — the implementation
must not); destructive typed-confirmation inputs get `aria-describedby` pointing at the dependent-count
text.
