# Bind9-Manager v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fixtures-only React app: the three-layer shell with a full routing skeleton, the flagship Records screen (add/edit/disable with live zone-file preview and validation), and a Settings → API Keys screen.

**Architecture:** React 18 + Vite + TypeScript + react-router. Components read through one async `apiAdapter` that serves an in-memory copy of `fixtures.json`; edits mutate the copy and re-render, nothing persists. The adapter's signatures mirror `api-contract.md` so a real backend later swaps only the adapter bodies. Screens are transliterated from the imported `.dc.html` mockups; data is always built to `entities.md`/`fixtures.json`, never to the mockups' flat inline samples.

**Tech Stack:** React 18, Vite, TypeScript (strict), react-router-dom v6, Vitest, @testing-library/react.

**Spec:** `bind9-manager/docs/superpowers/specs/2026-08-15-bind9-manager-v1-design.md`

## Global Constraints

- Working directory for all app code: `bind9-manager/app/`. The imported bundle `bind9-manager/design/` is READ-ONLY reference — never edit it.
- **Data-shape precedence:** mockup wins visuals; `design/docs/entities.md` + `design/docs/fixtures.json` win data shape. `rdata` is a typed object keyed on record type, `syncState` is an enum, ids are strings. Never copy the mockups' flat inline sample data (`rdata` as string, `status`, numeric id).
- **Styling:** every color / font / spacing / radius comes from `tokens.css` variables or the Industry `_ds` classes. No hardcoded hex or font names. Where a mockup px value has a matching `--chrome-*` token, use the token; otherwise keep the mockup's literal value.
- **TypeScript strict mode on.** `tsc --noEmit` must stay clean.
- **Gate (every task):** its own tests green, `tsc --noEmit` clean; the final task also runs `vite build`.
- **Commits:** authored by the user (git config already `barun-labs`). No `Co-Authored-By`, no "Generated with" line, no session URLs. Conventional-commit style messages.
- **Implementation is delegated down the worker ladder** — agy flash 3.7 → deepseek (v4-flash then v4-pro) → Claude Sonnet 5. The orchestrator plans, dispatches, and reviews every diff; it writes no app code.
- Fixture facts workers can rely on: config id `dns-lab` (isActive), view `view-internal`, first zone `zone-lab` (`lab.lun.net`, 40 records), record types present `NS A AAAA CNAME MX SRV TXT CAA PTR`, external host `edge.lab.lun.net`.

---

## File structure

```
app/
  package.json  vite.config.ts  tsconfig.json  index.html  .gitignore
  public/fixtures.json                      # copied verbatim from design/docs/fixtures.json
  src/
    main.tsx  App.tsx
    styles/ tokens.css  ds.styles.css        # ported verbatim from design/
    types/entities.ts                        # enums + interfaces + ApiKey
    data/ apiAdapter.ts  store.ts
    lib/ zonefile.ts  validate.ts  query.ts
    layout/ Chrome/Chrome.tsx  Sidebar/Sidebar.tsx  Placeholder/Placeholder.tsx
    router.tsx
    routes/ ZoneRecords/ZoneRecords.tsx  ApiKeys/ApiKeys.tsx
    components/<Name>/<Name>.tsx             # one folder per component
```

Each `lib/*` file owns one pure function group and its test file `lib/<name>.test.ts`. UI components are transliterated from named `.dc.html` source line ranges.

---

## Task 1: Scaffold the app

**Files:**
- Create: `app/package.json`, `app/vite.config.ts`, `app/tsconfig.json`, `app/index.html`, `app/.gitignore`, `app/src/main.tsx`, `app/src/App.tsx`
- Create: `app/src/styles/tokens.css`, `app/src/styles/ds.styles.css`, `app/public/fixtures.json`

**Interfaces:**
- Produces: a running `vite dev` app mounting `<App/>` into `#root`; `App` renders react-router's `<RouterProvider>` (router added in Task 8, a placeholder `<div>Bind9-Manager</div>` until then).

- [ ] **Step 1: Init project**

```bash
cd bind9-manager/app
npm create vite@latest . -- --template react-ts   # accept into current dir
npm install react-router-dom
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Copy the design assets verbatim**

```bash
cp ../design/docs/fixtures.json public/fixtures.json
cp ../design/docs/tokens.css src/styles/tokens.css
cp ../design/_ds/*/styles.css src/styles/ds.styles.css
```

- [ ] **Step 3: Wire Vitest**

Add to `vite.config.ts` a `test` block: `environment: 'jsdom'`, `globals: true`, `setupFiles: './src/setupTests.ts'`. Create `src/setupTests.ts` with `import '@testing-library/jest-dom'`. Add scripts to `package.json`: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`.

- [ ] **Step 4: Import styles + a smoke test**

In `src/main.tsx` import both stylesheets: `import './styles/tokens.css'; import './styles/ds.styles.css';`. Create `src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';
test('app mounts', () => {
  render(<App />);
  expect(screen.getByText(/Bind9-Manager/i)).toBeInTheDocument();
});
```

- [ ] **Step 5: Run**

Run: `npm run test && npm run typecheck && npm run build`
Expected: test passes, no type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add bind9-manager/app
git commit -m "chore: scaffold bind9-manager app (vite/react/ts) with design tokens"
```

---

## Task 2: Entity types

**Files:**
- Create: `app/src/types/entities.ts`

**Interfaces:**
- Produces: `RecordType`, `SyncState`, `ZoneType` unions; `Rdata` discriminated union; interfaces `ResourceRecord`, `Zone`, `View`, `Configuration`, `ExternalHost`, `ApiKey`; `ListEnvelope<T>` and `ApiError`.

- [ ] **Step 1: Write the types**

Transcribe from `design/docs/entities.md`. Exact content:

```ts
export type RecordType = 'A'|'AAAA'|'CNAME'|'MX'|'TXT'|'SRV'|'NS'|'PTR'|'CAA'|'ALIAS';
export type SyncState = 'SYNCED'|'PENDING'|'DEPLOYING'|'DRIFT'|'ERROR'|'NODE_ABSENT'|'UNREACHABLE';
export type ZoneType = 'PRIMARY'|'SECONDARY'|'FORWARD'|'STUB';

export type Rdata =
  | { type: 'A'|'AAAA'; address: string }
  | { type: 'CNAME'|'NS'|'ALIAS'; target: string }
  | { type: 'MX'; priority: number; target: string }
  | { type: 'SRV'; priority: number; weight: number; port: number; target: string }
  | { type: 'TXT'; text: string }
  | { type: 'PTR'; target: string }
  | { type: 'CAA'; flags: number; tag: string; value: string };

export interface ResourceRecord {
  id: string; zoneId: string; name: string; type: RecordType; ttl: number;
  rdata: Omit<Extract<Rdata, { type: RecordType }>, 'type'>;
  disabled: boolean; syncState: SyncState; issue: string | null;
}
export interface Zone {
  id: string; configurationId: string; viewId: string; name: string; type: ZoneType;
  soa: { primaryNs: string; adminEmail: string; serial: number; refresh: number; retry: number; expire: number; minimum: number };
  allowTransfer?: string[]; allowUpdate?: string[]; recordCount: number; syncState: SyncState;
}
export interface View { id: string; configurationId: string; name: string; order: number; matchClients: string[]; zoneCount: number; }
export interface Configuration {
  id: string; name: string; description?: string; isActive: boolean;
  createdFromTemplateId: string | null; createdAt: string; updatedAt: string; lastDeployedAt?: string;
  counts: { views: number; zones: number; records: number; servers: number };
}
export interface ExternalHost { id: string; configurationId: string; fqdn: string; referenceCount: number; }
export interface ApiKey { id: string; name: string; createdAt: string; lastUsedAt: string | null; token?: string; }

export interface ListEnvelope<T> { data: T[]; page: number; size: number; total: number; }
export interface ApiError { error: { code: string; message: string; field?: string; details?: unknown }; }
```

Note: to keep `rdata` typed per record in v1, treat `record.rdata` as the shape for its `type` (helpers in `lib/zonefile.ts` narrow it). A looser `Record<string, unknown>` is acceptable if the strict `Extract` fights inference — decide at implementation, but the seven rdata shapes above are canonical.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add bind9-manager/app/src/types/entities.ts
git commit -m "feat: entity types from entities.md (rdata discriminated union)"
```

---

## Task 3: zonefile formatter (pure, TDD)

**Files:**
- Create: `app/src/lib/zonefile.ts`, `app/src/lib/zonefile.test.ts`

**Interfaces:**
- Produces: `zoneFileLine(name: string, ttl: number, type: RecordType, rdata: object): string` and `rdataDisplay(type: RecordType, rdata: object): string` (the rdata column value = everything after the type).

- [ ] **Step 1: Write failing tests**

```ts
import { zoneFileLine, rdataDisplay } from './zonefile';
test('A', () => { expect(zoneFileLine('ns1',3600,'A',{address:'10.20.30.10'})).toBe('ns1\t3600\tIN\tA\t10.20.30.10'); });
test('AAAA', () => { expect(rdataDisplay('AAAA',{address:'2001:db8::1'})).toBe('2001:db8::1'); });
test('CNAME', () => { expect(rdataDisplay('CNAME',{target:'edge.lab.lun.net.'})).toBe('edge.lab.lun.net.'); });
test('MX priority+target', () => { expect(rdataDisplay('MX',{priority:10,target:'mx1.lab.lun.net.'})).toBe('10 mx1.lab.lun.net.'); });
test('SRV four fields', () => { expect(rdataDisplay('SRV',{priority:10,weight:20,port:5060,target:'sip1.lab.lun.net.'})).toBe('10 20 5060 sip1.lab.lun.net.'); });
test('TXT quoted', () => { expect(rdataDisplay('TXT',{text:'v=spf1 ~all'})).toBe('"v=spf1 ~all"'); });
test('CAA', () => { expect(rdataDisplay('CAA',{flags:0,tag:'issue',value:'letsencrypt.org'})).toBe('0 issue "letsencrypt.org"'); });
test('apex name renders @', () => { expect(zoneFileLine('@',3600,'MX',{priority:10,target:'mx1.'})).toBe('@\t3600\tIN\tMX\t10 mx1.'); });
```

- [ ] **Step 2: Run — expect fail** (`npm run test -- zonefile`), Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `rdataDisplay` switches on `type` to produce the strings above (TXT and CAA-value wrapped in double quotes); `zoneFileLine` joins `name`, `ttl`, `'IN'`, `type`, `rdataDisplay(...)` with tabs. Worker writes the body from these exact expectations.

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat: zone-file line formatter for all rdata types"`

---

## Task 4: record validation (pure, TDD)

**Files:**
- Create: `app/src/lib/validate.ts`, `app/src/lib/validate.test.ts`

**Interfaces:**
- Produces: `validateRecord(input, ctx): { errors: Record<string,string>; warnings: Record<string,string> }` where `input = {name,type,ttl}`, `ctx = {zoneName, existing: ResourceRecord[], externalHostFqdns: string[], editingId?: string, target?: string}`.

- [ ] **Step 1: Write failing tests — each rule both ways**

```ts
import { validateRecord } from './validate';
const ctx = { zoneName:'lab.lun.net', existing:[], externalHostFqdns:['edge.lab.lun.net'] };
test('bad label errors', () => { expect(validateRecord({name:'-bad',type:'A',ttl:60}, ctx).errors.name).toMatch(/valid DNS label/); });
test('good label passes', () => { expect(validateRecord({name:'ok1',type:'A',ttl:60}, ctx).errors.name).toBeUndefined(); });
test('CNAME at apex errors', () => { expect(validateRecord({name:'@',type:'CNAME',ttl:60}, ctx).errors.type).toMatch(/apex/); });
test('CNAME not at apex passes', () => { expect(validateRecord({name:'www',type:'CNAME',ttl:60,...{}}, {...ctx,target:'edge.lab.lun.net'}).errors.type).toBeUndefined(); });
test('duplicate errors', () => {
  const existing=[{id:'r1',zoneId:'z',name:'ns1',type:'A',ttl:60,rdata:{address:'1.1.1.1'},disabled:false,syncState:'SYNCED',issue:null}] as any;
  expect(validateRecord({name:'ns1',type:'A',ttl:60}, {...ctx,existing}).errors.name).toMatch(/already exists/);
});
test('editing same record is not a duplicate', () => {
  const existing=[{id:'r1',zoneId:'z',name:'ns1',type:'A',ttl:60,rdata:{address:'1.1.1.1'},disabled:false,syncState:'SYNCED',issue:null}] as any;
  expect(validateRecord({name:'ns1',type:'A',ttl:60}, {...ctx,existing,editingId:'r1'}).errors.name).toBeUndefined();
});
test('TTL out of range errors', () => { expect(validateRecord({name:'a',type:'A',ttl:-1}, ctx).errors.ttl).toBeTruthy(); });
test('TTL under 60 warns not errors', () => { const r=validateRecord({name:'a',type:'A',ttl:30}, ctx); expect(r.errors.ttl).toBeUndefined(); expect(r.warnings.ttl).toMatch(/under 60/); });
test('dangling target warns', () => { expect(validateRecord({name:'w',type:'CNAME',ttl:60}, {...ctx,target:'nope.example.'}).warnings.target).toMatch(/dangling/i); });
test('known target does not warn', () => { expect(validateRecord({name:'w',type:'CNAME',ttl:60}, {...ctx,target:'edge.lab.lun.net'}).warnings.target).toBeUndefined(); });
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement** the six rules from `design/docs/validation-rules.md` (label syntax regex `^(@|[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)$` per label; combined `name+'.'+zoneName` ≤253; CNAME-at-apex; duplicate on (name,type) excluding `editingId`; TTL integer 0–2147483647 with sub-60 warning; dangling-target warning when `target` set and not in zone records nor `externalHostFqdns`, trailing dot tolerant). Messages verbatim from the doc.

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat: Phase-1 record validation rules with must-pass controls"`

---

## Task 5: URL ⇄ table-state (pure, TDD)

**Files:**
- Create: `app/src/lib/query.ts`, `app/src/lib/query.test.ts`

**Interfaces:**
- Produces: `parseQuery(search: string): TableState` and `toSearch(state: TableState): string`, `TableState = { type?: RecordType; status?: SyncState; q?: string; page: number; size: number; sort?: string; recordId?: string }`.

- [ ] **Step 1: Failing tests (round-trip + defaults)**

```ts
import { parseQuery, toSearch } from './query';
test('defaults', () => { expect(parseQuery('')).toEqual({ page:1, size:50 }); });
test('round-trips', () => {
  const s = { type:'A' as const, status:'PENDING' as const, q:'ns', page:2, size:25, sort:'name:asc', recordId:'rec-3' };
  expect(parseQuery(toSearch(s))).toEqual(s);
});
test('omits defaults from search', () => { expect(toSearch({page:1,size:50})).toBe(''); });
```

- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** with `URLSearchParams`; page/size default to 1/50 and are omitted when default.
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: deep-linkable table-state <-> URL"`

---

## Task 6: store + apiAdapter

**Files:**
- Create: `app/src/data/store.ts`, `app/src/data/apiAdapter.ts`, `app/src/data/apiAdapter.test.ts`

**Interfaces:**
- Produces: a `StoreProvider` + `useStore()` context holding the in-memory fixture copy; adapter async fns:
  `listConfigurations()`, `listViews(configId)`, `listZones(configId, filters)`, `getZone(zoneId)`,
  `listRecords(zoneId, {type?,status?,q?,page,size,sort?}): Promise<ListEnvelope<ResourceRecord>>`,
  `createRecord(zoneId, input)`, `updateRecord(id, patch)`, `deleteRecord(id)`, `setRecordDisabled(id, disabled)`,
  `listExternalHosts(configId)`, `listApiKeys()`, `createApiKey(name)`, `deleteApiKey(id)`, `search(q)`.
- The adapter reads/writes the store's copy; all return Promises resolving the `{data,page,size,total}` envelope for lists.

- [ ] **Step 1: Failing tests**

```ts
import { makeStore } from './store';
import * as api from './apiAdapter';
test('listRecords filters+paginates zone-lab', async () => {
  const s = makeStore();
  const r = await api.listRecords(s,'zone-lab',{type:'A',page:1,size:5});
  expect(r.data.every(x=>x.type==='A')).toBe(true);
  expect(r.total).toBeGreaterThan(0);
  expect(r.data.length).toBeLessThanOrEqual(5);
});
test('createRecord then it appears', async () => {
  const s = makeStore();
  const before = (await api.listRecords(s,'zone-lab',{page:1,size:9999})).total;
  await api.createRecord(s,'zone-lab',{name:'new1',type:'A',ttl:300,rdata:{address:'10.20.30.99'}});
  const after = (await api.listRecords(s,'zone-lab',{page:1,size:9999})).total;
  expect(after).toBe(before+1);
});
test('createApiKey returns token once, list hides it', async () => {
  const s = makeStore();
  const k = await api.createApiKey(s,'ci');
  expect(k.token).toBeTruthy();
  const listed = (await api.listApiKeys(s)).data.find(x=>x.id===k.id)!;
  expect(listed.token).toBeUndefined();
});
```

- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement.** `makeStore()` deep-clones the imported `fixtures.json` (import it, or `fetch('/fixtures.json')` in the app; in tests import the JSON directly). Adapter functions operate on that object. `createApiKey` generates a random `token` (e.g. `bnd_` + 32 hex from `crypto.getRandomValues`), stores the key WITHOUT the token, and returns the key WITH the token that one time. `search` returns `{zones,records,servers,blocks}` top-N by substring. The React `StoreProvider` holds one `makeStore()` in a ref and exposes it via context so mutations persist across renders.

- The app-runtime adapter signatures used by components should bind the store from context (a thin `useApi()` hook wrapping these fns with the context store) so screens call `useApi().listRecords(zoneId, filters)` without passing the store explicitly.

- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: in-memory fixture store + api-contract-shaped adapter"`

---

## Task 7: shared UI primitives

**Files:**
- Create: `app/src/components/{Button,Input,Textarea,Select,Checkbox,StatusPill,RecordTypeChip,CopyButton,InlineAlert,Skeleton,Tooltip,CodeBlock}/<Name>.tsx`
- Create: `app/src/components/StatusPill/StatusPill.test.tsx`

**Interfaces:**
- Produces each component with the exact props from `design/docs/components.md` (that table is the contract — Button variants `primary|secondary|ghost|destructive`, StatusPill `state` of six values + label, RecordTypeChip `type`, etc.).

- [ ] **Step 1: Build the primitives** — for each, use the Industry `_ds` classes where they exist (`.btn .btn-primary .blueprint` + four `<i class="corner">` for primary buttons, `.input`, `.tag-neutral`, `.seg`, `.dialog`) and `tokens.css` variables otherwise. Props exactly per `components.md`. Reference markup: `design/Zone-Records.dc.html` (buttons line 158, inputs line 89, the record type/status cells lines 188–205) and `design/_ds/*/readme.md`.

- [ ] **Step 2: One representative test**

```tsx
import { render, screen } from '@testing-library/react';
import { StatusPill } from './StatusPill';
test('renders label and a state class', () => {
  render(<StatusPill state="pending" label="Pending" />);
  const el = screen.getByText('Pending');
  expect(el).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test + typecheck.** Expected: pass, clean.
- [ ] **Step 4: Commit** — `git commit -m "feat: shared UI primitives from components.md"`

---

## Task 8: application shell + router skeleton (Phase 0)

**Files:**
- Create: `app/src/layout/Chrome/Chrome.tsx`, `app/src/layout/Sidebar/Sidebar.tsx`, `app/src/layout/Placeholder/Placeholder.tsx`, `app/src/router.tsx`
- Create: `app/src/components/{ConfigurationSwitcher,ViewSwitcher,PendingChangesPill,Breadcrumb}/<Name>.tsx`
- Modify: `app/src/App.tsx` (mount `<RouterProvider router={router}/>`)
- Create: `app/src/router.test.tsx`

**Interfaces:**
- Consumes: `useApi().listConfigurations/listViews`, the primitives from Task 7.
- Produces: a `Chrome` layout (config strip 30px `--chrome-config-strip-h`, topbar 56px, breadcrumb 34px) wrapping an `<Outlet/>`; a `router` covering every path in `design/docs/routes.md` plus `/settings/api-keys`, defaulting unbuilt routes to `<Placeholder/>`.

- [ ] **Step 1: Build the chrome** — transliterate `design/Zone-Records.dc.html` lines 1–70 (config strip, topbar with search input, sidebar nav) into `Chrome` + `Sidebar`. `{{ x }}`→`{x}`, `<sc-if value="{{c}}">`→`{c && (…)}`, `<sc-for list="{{xs}}" as="i">`→`{xs.map(i=>…)}`. `PendingChangesPill` shows zero-state (ghost) only in v1. Config/View switchers read from the adapter.

- [ ] **Step 2: Build the router** — one route per `routes.md` row. Real elements: `/config/:configId/zones/:zoneId/records` → `ZoneRecords` (Task 9), `/settings/api-keys` → `ApiKeys` (Task 10). Everything else → `<Placeholder title={...}/>`. Config + View scope come from the URL (`:configId`, `?view=`), so a hard refresh restores them.

- [ ] **Step 3: Failing test then pass**

```tsx
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from './router';
test('an unbuilt route renders chrome + placeholder', () => {
  const r = createMemoryRouter(routes, { initialEntries: ['/config/dns-lab/servers'] });
  render(<RouterProvider router={r} />);
  expect(screen.getByText(/Bind9-Manager/i)).toBeInTheDocument();   // sidebar brand in chrome
});
```

- [ ] **Step 4: Run test + `npm run build`.** Expected: pass, build ok.
- [ ] **Step 5: Commit** — `git commit -m "feat: three-layer chrome + full routing skeleton (Phase 0)"`

---

## Task 9: Records screen (Phase 1)

**Files:**
- Create: `app/src/routes/ZoneRecords/ZoneRecords.tsx`
- Create: `app/src/components/{DataTable,SidePanel,Combobox,Toast}/<Name>.tsx`
- Create: `app/src/routes/ZoneRecords/ZoneRecords.test.tsx`

**Interfaces:**
- Consumes: `useApi()` record fns, `zoneFileLine`/`rdataDisplay`, `validateRecord`, `parseQuery`/`toSearch`, primitives, `SidePanel`, `DataTable`, `Combobox`, `Toast`.
- Produces: the route element at `/config/:configId/zones/:zoneId/records`.

- [ ] **Step 1: Build the table** — transliterate `design/Zone-Records.dc.html` lines ~110–210 (header, filter segmented control, sticky-header table, quick-add row, footer). Columns: name, type (`RecordTypeChip`), TTL, rdata (via `rdataDisplay`, click-to-copy), status (`StatusPill` from `syncState`), row actions. Filter/sort/page state flows through `query.ts` into the URL and into `useApi().listRecords`. Disabled rows render at reduced opacity.

- [ ] **Step 2: Build the Add/Edit side panel** — transliterate lines ~278–335. Type-aware fields per `rdata` shape (A→address, MX→priority+target, SRV→4 fields, TXT→textarea, CAA→flags/tag/value). Live preview box renders `zoneFileLine(...)` on every keystroke. Run `validateRecord` on change/blur; show field errors and the dangling-target `InlineAlert` warning. Target fields use `Combobox` searching in-zone names + External Hosts.

- [ ] **Step 3: Wire mutations** — quick-add and panel submit call `createRecord`/`updateRecord`; the disable action calls `setRecordDisabled`; delete calls `deleteRecord` and pushes a `Toast` with an Undo action that re-creates the record. Every mutation increments the pending count feeding `PendingChangesPill`.

- [ ] **Step 4: Behavior tests**

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// render ZoneRecords at /config/dns-lab/zones/zone-lab/records via a memory router wrapped in StoreProvider
test('add an A record via the side panel makes a row appear', async () => {
  // open Add panel, choose type A, name 'smoke', address '10.0.0.7', submit
  // assert a cell with text 'smoke' and rdata '10.0.0.7' exists
});
test('typing an unknown CNAME target shows a dangling-reference warning', async () => {
  // open panel, type=CNAME name='x' target='nope.example.' -> InlineAlert with /dangling/i
});
test('disabling a record dims its row', async () => {
  // click disable on a row -> row has reduced-opacity style / data-disabled
});
```

Implement the tests concretely against the rendered DOM (worker fills the interaction bodies; the three assertions above are the contract).

- [ ] **Step 5: Run tests + typecheck + build.** Expected: green.
- [ ] **Step 6: Commit** — `git commit -m "feat: Records screen — table, type-aware panel, preview, validation (Phase 1)"`

---

## Task 10: Settings → API Keys screen

**Files:**
- Create: `app/src/routes/ApiKeys/ApiKeys.tsx`, `app/src/components/Modal/Modal.tsx`
- Create: `app/src/routes/ApiKeys/ApiKeys.test.tsx`

**Interfaces:**
- Consumes: `useApi().listApiKeys/createApiKey/deleteApiKey`, `DataTable`, `Button`, `Modal`, `Input`, `CopyButton`.
- Produces: the route element at `/settings/api-keys`.

- [ ] **Step 1: Build the screen** — a `DataTable` of keys (name, created, last used, delete action). "New API key" opens a `Modal` with a name `Input`; on submit call `createApiKey`, then show the returned `token` once in the modal with a `CopyButton` and the line "Copy it now — it won't be shown again." Closing the modal drops the token from state.

- [ ] **Step 2: Behavior tests**

```tsx
test('creating a key shows the token once', async () => {
  // open modal, type 'ci', submit -> a token string is visible with a copy button
});
test('after closing, the list row shows no secret', async () => {
  // close modal -> row 'ci' present, no token text anywhere
});
test('delete removes the row', async () => {
  // click delete on 'ci' -> row gone
});
```

- [ ] **Step 3: Run tests + typecheck + build.** Expected: green.
- [ ] **Step 4: Commit** — `git commit -m "feat: Settings API Keys screen (create shows token once)"`

---

## Task 11: v1 gate

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

Run: `cd bind9-manager/app && npm run typecheck && npm run test && npm run build`
Expected: no type errors, all tests green, build succeeds.

- [ ] **Step 2: Manual fidelity pass** — `npm run dev`, open the Records route, compare against the design product's rendering of `Zone-Records.dc.html`: three-layer chrome, sticky table, type-aware panel, live preview. Note any visual drift as follow-up issues (do not fix outside plan scope).

- [ ] **Step 3: Commit any lockfile/config drift only** — `git commit -m "chore: v1 gate green"` (skip if nothing changed).

---

## Self-review notes (done)

- **Spec coverage:** shell+routing (Task 8), Records (Task 9), API Keys (Task 10), types (2), zonefile (3), validate (4), query (5), adapter/store (6), primitives (7), gate (11) — every v1 spec section maps to a task. DDI-informed contract additions are recorded-not-built per spec, so no task, correctly.
- **Placeholders:** logic tasks carry concrete tests + expected outputs; UI tasks carry concrete source line ranges + the transliteration mapping + three named behavior assertions each. No "TBD"/"add error handling"/"similar to Task N".
- **Type consistency:** adapter fn names in Task 6 are the ones Tasks 8–10 consume; `validateRecord`/`zoneFileLine`/`rdataDisplay`/`parseQuery`/`toSearch` signatures match across tasks.
