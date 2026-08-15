# Bind9-Manager v1.1 — auth + RBAC (mock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a mock auth layer to the v1 app — login page, a per-Configuration RBAC model, role-gated screens, account-owned API keys, and an admin Users screen — all against fixtures, enforcing nothing real (backend does that later).

**Architecture:** An `AuthProvider` holds a mock `currentUser` (persisted to `localStorage`); `useAuth().can(permission, configId)` is the single gate every protected control calls. A seeded `users` array lives in the store (the imported `fixtures.json` has none and stays untouched). Screens read `can()` to decide what renders. Nothing is enforced server-side — `// mock:` markers flag where real checks will go.

**Tech Stack:** same as v1 — React 18, Vite, TypeScript (strict), react-router-dom v6, Vitest, @testing-library/react.

**Spec:** `bind9-manager/docs/superpowers/specs/2026-08-15-bind9-manager-v1-design.md` (§ "v1.1 — auth + RBAC").

## Global Constraints

- All app code under `bind9-manager/app/`. `bind9-manager/design/` is READ-ONLY — never edit it, including `fixtures.json` (add the `users` seed in `src/data/`, not the fixture file).
- Roles: `viewer|editor|admin` + a separate `canDeploy` flag, scoped per Configuration. Permissions used by `can()`: `'view'`, `'edit'`, `'deploy'`, `'admin'`.
- Enforcement is mocked. Put a `// mock: real enforcement is the backend's job` comment at each faked check (password compare, key validation).
- TypeScript strict; `tsc --noEmit` stays clean. Gate each task: own tests green; final task runs full `vitest run` + `vite build`.
- Commits authored by the repo user (`barun-labs`); NO `Co-Authored-By`, NO "Generated with", no session URLs.
- Implementation delegated down the ladder — agy flash 3.7 → deepseek → Claude Sonnet 5. Orchestrator reviews every diff.
- Fixture facts: config ids include `dns-lab` (active); reuse existing `useApi()` from `src/data/store.ts`.

---

## Task 12: auth core — types, user seed, AuthProvider, can()

**Files:**
- Modify: `src/types/entities.ts` (add `User`, `RoleAssignment`, `Permission`; extend `ApiKey`)
- Create: `src/data/users.seed.ts` (seed users with per-config roles)
- Create: `src/auth/AuthProvider.tsx` (context + `useAuth`), `src/auth/can.ts` (pure permission fn)
- Create: `src/auth/can.test.ts`
- Modify: `src/data/apiAdapter.ts` (mock `login`, `logout`, `getMe`; `createApiKey` stamps `ownerUserId`, `scopes`, `readOnly`, `expiresAt`)
- Modify: `src/data/apiAdapter.test.ts` (add: createApiKey stamps owner + scopes)

**Interfaces:**
- Produces: `type Permission = 'view'|'edit'|'deploy'|'admin'`; `interface RoleAssignment { configurationId: string; role: 'viewer'|'editor'|'admin'; canDeploy: boolean }`; `interface User { id: string; username: string; displayName: string; isActive: boolean; roles: RoleAssignment[] }`; `ApiKey` extended with `ownerUserId: string; scopes: ('read'|'write'|'deploy')[]; readOnly: boolean; expiresAt: string | null`.
- `can(user: User, permission: Permission, configId: string): boolean`.
- `useAuth(): { currentUser: User | null; login(username, password): Promise<User>; logout(): void; can(permission: Permission, configId: string): boolean }`.

- [ ] **Step 1: Write failing `can.test.ts`**

```ts
import { can } from './can';
const u = (role, canDeploy) => ({ id:'u1', username:'a', displayName:'A', isActive:true,
  roles:[{ configurationId:'dns-lab', role, canDeploy }] }) as any;
test('viewer can view not edit', () => { const v=u('viewer',false);
  expect(can(v,'view','dns-lab')).toBe(true); expect(can(v,'edit','dns-lab')).toBe(false); });
test('editor can edit not deploy without flag', () => { const e=u('editor',false);
  expect(can(e,'edit','dns-lab')).toBe(true); expect(can(e,'deploy','dns-lab')).toBe(false); });
test('editor with canDeploy can deploy', () => { expect(can(u('editor',true),'deploy','dns-lab')).toBe(true); });
test('admin can admin + edit', () => { const a=u('admin',false);
  expect(can(a,'admin','dns-lab')).toBe(true); expect(can(a,'edit','dns-lab')).toBe(true); });
test('no assignment on other config = no access', () => { expect(can(u('admin',true),'view','other')).toBe(false); });
```

- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** `can.ts` (role hierarchy: admin⊇editor⊇viewer for view/edit; `admin` perm needs role admin; `deploy` needs `canDeploy` on that config's assignment). Add types to `entities.ts`. Write `users.seed.ts` (≥3 users: an admin, an editor with canDeploy on `dns-lab`, a viewer). `AuthProvider` holds `currentUser` (init from `localStorage['bnd_user']`), `login` matches a seed user by username (password ignored — `// mock:` comment), persists, `logout` clears. `useApi().createApiKey` now takes `{name, scopes, readOnly, expiresAt}` and stamps `ownerUserId` from the current user.
- [ ] **Step 4: Run `npx vitest run src/auth/can.test.ts src/data/apiAdapter.test.ts` — expect pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: mock auth core — RBAC model, user seed, can()"`

---

## Task 13: login page + route guard + user menu

**Files:**
- Create: `src/routes/Login/Login.tsx`, `src/routes/Login/Login.test.tsx`
- Modify: `src/App.tsx` (wrap the app in `AuthProvider` inside `StoreProvider`)
- Modify: `src/router.tsx` (add `/login` OUTSIDE the Chrome layout; wrap all Chrome routes in a `<RequireAuth>` guard that redirects to `/login` when `currentUser` is null)
- Modify: `src/layout/Chrome/Chrome.tsx` (topbar user menu: display name + role + Logout)

**Interfaces:**
- Consumes: `useAuth()`.
- Produces: `RequireAuth` wrapper (in `router.tsx` or `src/auth/RequireAuth.tsx`).

- [ ] **Step 1: Build** the `/login` page (username + password `Input`s, submit → `useAuth().login` → navigate to `/configurations`). `RequireAuth` reads `currentUser`; null → `<Navigate to="/login" replace/>`. User menu in the topbar calls `logout()` (→ back to `/login`).
- [ ] **Step 2: Failing test then pass** — `src/router.test.tsx` (existing) still passes; add `Login.test.tsx`:

```tsx
// render router at a protected path with no user -> lands on /login (shows a Sign in control)
// then after login(seed admin), the protected route renders chrome
```

Concrete assertions: (1) memory router at `/config/dns-lab/zones/zone-lab/records` with no persisted user shows the login form (`/sign in/i` or the login button label the screen uses); (2) after logging in as a seed user, the same route shows the records screen's "Add record".

- [ ] **Step 3: Run** `npx vitest run src/routes/Login/Login.test.tsx src/router.test.tsx` + `npm run typecheck`. Expected: pass, clean.
- [ ] **Step 4: Commit** — `git commit -m "feat: login page, route guard, topbar user menu"`

---

## Task 14: role-gate Records + extend API Keys UI (parallel-safe with Task 15)

**Files:**
- Modify: `src/routes/ZoneRecords/ZoneRecords.tsx` (gate Add / quick-add / edit / disable behind `can('edit', configId)`; a viewer gets a read-only table)
- Modify: `src/routes/ApiKeys/ApiKeys.tsx` (owner column; scope checkboxes + read-only toggle + expiry field in the create modal; delete allowed for owner or `can('admin', ...)`)
- Modify: `src/routes/ZoneRecords/ZoneRecords.test.tsx`, `src/routes/ApiKeys/ApiKeys.test.tsx`

**Interfaces:** consumes `useAuth().can`, extended `createApiKey` from Task 12.

- [ ] **Step 1: Gate Records** — wrap mutating controls in `{can('edit', configId) && …}`; when not editable, render the table read-only (no quick-add row, no action buttons).
- [ ] **Step 2: Extend API Keys** — create modal gains scope checkboxes (`read`/`write`/`deploy`), a read-only toggle, and an expiry date input; on submit pass them to `createApiKey`. List shows the owner's display name. Delete button shows only for the key owner or an admin.
- [ ] **Step 3: Add tests** — Records: rendering as a viewer (login a viewer seed in the test's AuthProvider) shows NO "Add record"; as an editor it does. API Keys: creating a key shows the current user as owner and the chosen scopes persist to the row.
- [ ] **Step 4: Run** the two screens' tests + `npm run typecheck`. Do NOT edit `router.tsx`. DO NOT git commit (orchestrator commits — parallel wave with Task 15).
- [ ] **Step 5:** report files changed + test output.

---

## Task 15: Users admin screen (parallel-safe with Task 14)

**Files:**
- Create: `src/routes/Users/Users.tsx`, `src/routes/Users/Users.test.tsx`
- Modify: `src/router.tsx` (point `/settings/users` at `<Users/>` instead of the placeholder; keep it inside `RequireAuth`)
- Modify: `src/data/apiAdapter.ts` (add `listUsers`, `setUserRole(userId, assignment)`, `setUserActive(userId, isActive)` over the store's `users` seed)

**Interfaces:** consumes `useApi()` (new user fns), `useAuth().can('admin', ...)`.

- [ ] **Step 1: Build** the Users screen — a `_ds` `.table` of users (name, username, per-config roles, active toggle). An admin can change a user's role for a config and deactivate a user; a non-admin sees it read-only (gate with `can('admin', configId)`). Add the three adapter fns over the store's `users`.
- [ ] **Step 2: Add tests** — as admin: changing a user's role updates the row; deactivating flips the active state. (Login an admin seed in the test's AuthProvider.)
- [ ] **Step 3: Run** `npx vitest run src/routes/Users/Users.test.tsx` + `npm run typecheck`. DO NOT git commit (parallel wave with Task 14) — but note this task DOES edit `router.tsx`; Task 14 does NOT, so no conflict.
- [ ] **Step 4:** report files changed + test output.

---

## Task 16: v1.1 gate

- [ ] **Step 1: Full gate** — `cd bind9-manager/app && npm run typecheck && npm run test && npm run build`. All clean/green/successful.
- [ ] **Step 2: Route probe** — confirm `/login` renders unauthenticated, a protected route redirects, `/settings/users` renders for an admin. (Temp test, then delete it.)
- [ ] **Step 3: Commit** any residual + tag the increment done.

---

## Self-review notes

- **Spec coverage:** login+guard (13), user menu (13), RBAC model + can() (12), account-owned keys + scopes (12 types/adapter, 14 UI), role-gated Records/Keys (14), Users admin (15), contract additions recorded in spec (no build task, correct). Every v1.1 spec bullet maps to a task.
- **File-contention:** `entities.ts` edited only in Task 12; `router.tsx` edited in Task 13 then Task 15 (14 leaves it alone) — the 14/15 parallel wave is disjoint. `apiAdapter.ts` edited in 12 then 15 (sequential, 15 after 12). No two concurrent tasks touch the same file.
- **Type consistency:** `Permission`, `RoleAssignment`, `User`, extended `ApiKey`, `can()`, `useAuth()` signatures defined in Task 12 and consumed unchanged in 13/14/15.
