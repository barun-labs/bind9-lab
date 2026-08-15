# Component API reference

PascalCase names, one file per component under the stated path. Props use TypeScript-style types.
"Variants" and "States" are prop-driven, not separate components, unless noted.

| Component | Path | Props | Variants | States | Notes |
|---|---|---|---|---|---|
| Button | src/components/Button/Button.tsx | `variant: 'primary'\|'secondary'\|'ghost'\|'destructive'`, `size: 'sm'\|'md'`, `iconOnly?: boolean`, `icon?: IconName`, `disabled?: boolean`, `loading?: boolean`, `onClick`, `children` | 4 variants × iconOnly | default/hover/active/focus-visible/disabled/loading | `loading` shows a spinner in place of the icon slot |
| Input | src/components/Input/Input.tsx | `value`, `onChange`, `mono?: boolean`, `error?: string`, `placeholder`, `type` | text/mono | default/hover/focus/error/disabled | `mono` swaps `--font-body` for `--font-mono` — used for every FQDN/IP/TTL field |
| Textarea | src/components/Textarea/Textarea.tsx | same as Input + `rows` | mono | same | used for TXT record values, snapshot descriptions |
| Select | src/components/Select/Select.tsx | `value`, `onChange`, `options: {label,value}[]`, `disabled?` | — | default/hover/focus/disabled | native `<select>` wrapped in `.input` styling |
| Combobox | src/components/Combobox/Combobox.tsx | `value`, `onChange`, `onSearch: (q)=>Promise<Option[]>`, `loading?`, `placeholder` | async search | default/loading/empty/error | used for target/FQDN pickers with server-side search |
| Toggle | src/components/Toggle/Toggle.tsx | `checked`, `onChange`, `label`, `disabled?` | — | on/off/disabled/focus-visible | e.g. query-logging master toggle |
| Checkbox | src/components/Checkbox/Checkbox.tsx | `checked`, `onChange`, `indeterminate?`, `label?`, `disabled?` | — | checked/unchecked/indeterminate/disabled/focus-visible | row selection, bulk ops |
| RadioGroup | src/components/RadioGroup/RadioGroup.tsx | `value`, `onChange`, `options`, `name` | — | default/disabled/focus-visible | `.radio` + `.dot` |
| SegmentedControl | src/components/SegmentedControl/SegmentedControl.tsx | `value`, `onChange`, `options: {label,value,icon?}[]` | 2–4 options | default/selected/disabled | diff Unified/Split, filter chips |
| StatusPill | src/components/StatusPill/StatusPill.tsx | `state: 'synced'\|'pending'\|'deploying'\|'drift'\|'error'\|'disabled'`, `label` | 6 states | — | dot + label, colorblind-safe by construction |
| RecordTypeChip | src/components/RecordTypeChip/RecordTypeChip.tsx | `type: RecordType` | 10 record types | — | `.tag-neutral` + `--font-mono`, always monochrome |
| DataTable | src/components/DataTable/DataTable.tsx | `columns`, `rows`, `sortBy?`, `onSort?`, `selectable?`, `selectedIds?`, `onSelectionChange?`, `stickyHeader?`, `virtualized?`, `pagination: {page,size,total,onPageChange}` | virtualized/paginated | loading (skeleton)/empty/error/populated | server-paginated by default; `virtualized` for local render of a large page |
| TreeView | src/components/TreeView/TreeView.tsx | `nodes`, `expandedIds`, `onToggle`, `onSelect`, `renderNode?` | — | loading/empty/populated | Network Blocks hierarchy |
| SidePanel | src/components/SidePanel/SidePanel.tsx | `open`, `onClose`, `title`, `width='440px'`, `children` | — | entering/open/exiting | focus-trapped, Esc closes |
| Modal | src/components/Modal/Modal.tsx | `open`, `onClose`, `title`, `children`, `actions` | confirmation/picker | entering/open/exiting | focus-trapped, Esc closes unless `preventClose` (typed-confirm deletes) |
| Toast | src/components/Toast/ToastProvider.tsx | `push({message, tone, action?, duration?})` | info/success/warning/error | entering/visible/exiting | used for undo-delete, not for deploy results |
| InlineAlert | src/components/InlineAlert/InlineAlert.tsx | `tone: 'info'\|'warn'\|'error'`, `children`, `icon?` | 3 tones | — | dangling-target warning, RRL warning, syslog test result |
| EmptyState | src/components/EmptyState/EmptyState.tsx | `icon`, `title`, `description`, `action?` | — | — | honest copy, no illustration |
| Skeleton | src/components/Skeleton/Skeleton.tsx | `rows?: number`, `variant: 'table'\|'card'\|'line'` | 3 variants | — | see performance-spec.md for row counts |
| Tabs | src/components/Tabs/Tabs.tsx | `tabs: {label,value}[]`, `value`, `onChange` | — | default/selected/focus-visible | Server Detail tabs |
| Breadcrumb | src/components/Breadcrumb/Breadcrumb.tsx | `items: {label,href?}[]` | — | — | last item never a link |
| CodeBlock | src/components/CodeBlock/CodeBlock.tsx | `code`, `language`, `lineNumbers?`, `copyable?` | with/without gutter | — | Config Review, zone-file preview |
| DiffViewer | src/components/DiffViewer/DiffViewer.tsx | `lines: {type:'add'\|'remove'\|'context',text}[]`, `mode: 'unified'\|'split'` | unified/split | — | `--diff-*` tokens only |
| CommandPalette | src/components/CommandPalette/CommandPalette.tsx | `open`, `onClose`, `onSearch`, `onSelect` | — | empty/loading/results | ⌘K/Ctrl-K, jump to zone/record/server/IP |
| Tooltip | src/components/Tooltip/Tooltip.tsx | `content`, `children`, `placement?` | — | — | issue explanations (dangling target) |
| StepIndicator | src/components/StepIndicator/StepIndicator.tsx | `steps: string[]`, `activeIndex` | — | — | Review & Deploy, Adopt/Import flow |
| CopyButton | src/components/CopyButton/CopyButton.tsx | `value: string` | — | default/copied | every FQDN/IP/serial |
| ConfigurationSwitcher | src/components/ConfigurationSwitcher/ConfigurationSwitcher.tsx | `configs`, `activeId`, `onSelect`, `onManage` | — | closed/open | the 30px strip |
| ViewSwitcher | src/components/ViewSwitcher/ViewSwitcher.tsx | `views`, `activeId`, `onSelect` | — | closed/open | topbar pill |
| PendingChangesPill | src/components/PendingChangesPill/PendingChangesPill.tsx | `count`, `href` | 0 / >0 | — | ghost at 0, filled `--state-pending` at >0 |

## Addendum 2 additions

| Component | Path | Props | Variants | States | Notes |
|---|---|---|---|---|---|
| ObjectHeader | src/components/ObjectHeader/ObjectHeader.tsx | `name`, `nameFont:'mono'\|'body'`, `typeBadge?`, `statusBadges?: StatusPillProps[]`, `pendingCount?`, `actions?: ReactNode` | per object type via slotted actions | — | same shape on every container-object detail page, per DESIGN.md §6 |
| DetailTabs | src/components/DetailTabs/DetailTabs.tsx | `tabs: {id,label}[]`, `activeId`, `onChange` | wraps Tabs with the app's fixed tab sets | default/selected | thin wrapper so all six object types stay in sync if the tab list changes |
| DeploymentRolesEditor | src/components/DeploymentRolesEditor/DeploymentRolesEditor.tsx | `scope: {type,id}\|null` (null = global rollup), `rows`, `onAssign`, `onRemove`, `readOnly?` | scoped / global-rollup | loading/empty/populated | THE SAME component mounts in a zone tab, a server tab, and the global `/roles` rollup — never forked |
| DeploymentOptionsEditor | src/components/DeploymentOptionsEditor/DeploymentOptionsEditor.tsx | `scope: {type,id}\|null`, `rows: OptionRow[]`, `onOverride`, `onRevert`, `readOnly?` | scoped / global-rollup | loading/empty/populated | renders the two-axis row from DESIGN.md §7; expand state is per-row local state |
| ScopeFilterChip | src/components/ScopeFilterChip/ScopeFilterChip.tsx | `scope: {type,label}`, `onClear` | — | locked/clearable | sits above DeploymentRolesEditor/DeploymentOptionsEditor when scoped |
| AclPicker | src/components/AclPicker/AclPicker.tsx | `value: aclId\|null`, `onChange`, `onCreateNew`, `evaluateHref` | — | default/loading/empty | replaces every free-text ACL field app-wide |
| AclEditor | src/components/AclEditor/AclEditor.tsx | `acl`, `onChange` | — | default/dragging | ordered, drag-reorderable entry list + plain-language sentence + live `acl{}` preview |
| AclEntryRow | src/components/AclEntryRow/AclEntryRow.tsx | `entry`, `order`, `onChange`, `onRemove` | 6 entry types | default/negated | negation is a filled "NOT" tag, never a subtle icon |
| AclEvaluator | src/components/AclEvaluator/AclEvaluator.tsx | `mode:'simple'\|'chain'`, inputs vary by mode | simple (IP × one ACL) / chain (IP × server × view) | idle/evaluating/result | full screen per DESIGN.md §8; chain mode names the first blocking rule |
| DependencyPanel | src/components/DependencyPanel/DependencyPanel.tsx | `objectType`, `objectId`, `dependents: {type,count,href}[]` | — | loading/empty/populated | reusable "blast radius" panel — delete confirms, ACL edits, deploy review all mount this |
| TsigKeyPicker | src/components/TsigKeyPicker/TsigKeyPicker.tsx | `value`, `onChange`, `onGenerate` | — | default/generating | "Generate" pre-selects `HMAC_SHA256`, no manual field |
| HealthBadge | src/components/HealthBadge/HealthBadge.tsx | `findings: HealthFinding[]` | severity-driven | 0 findings (hidden) / info / warning / critical | shown on zone rows and the zone ObjectHeader |
| SavedFilterChip | src/components/SavedFilterChip/SavedFilterChip.tsx | `filter`, `active`, `onApply`, `onDelete` | — | default/active | row of chips above any filterable table |
| ObjectTreeNav | src/components/ObjectTreeNav/ObjectTreeNav.tsx | `nodes`, `expandedIds`, `activeId`, `onNavigate`, `collapsed`, `onToggleCollapse` | Configuration→View→Zone tree / Block tree | loading/empty/populated | secondary nav pane beside the section sidebar, syncs with Breadcrumb |
| DensityToggle | src/components/DensityToggle/DensityToggle.tsx | `value:'comfortable'\|'compact'`, `onChange` | 2 values | — | persisted per user in `localStorage` |
| QueryPanel | src/components/QueryPanel/QueryPanel.tsx | `defaultServerId?`, `defaultName?`, `compareMode?`, `serverIds\|groupId` | single / compare | idle/querying/result/error | overlay, reachable from palette/zone/server/post-deploy |
| ServerGroupCard | src/components/ServerGroupCard/ServerGroupCard.tsx | `group`, `rollup` | — | in-sync/disagreement/empty | disagreement state is a distinct, visible treatment — never averaged away |
| LabModeStrip | src/components/LabModeStrip/LabModeStrip.tsx | `labs: {name,nodesUp,nodesTotal,lastDeployedAt}[]` | — | up/partial/down | read-only containerlab topology status strip |
| ExplainAffordance | src/components/ExplainAffordance/ExplainAffordance.tsx | `summary`, `derivation: ReactNode` | — | collapsed/expanded | the one "why" pattern, reused by options rows, ACL verdicts, health findings, sync-state badges |
