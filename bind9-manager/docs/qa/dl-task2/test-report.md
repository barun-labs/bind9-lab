# Declarative-Lab Task 2 — Independent Adversarial Test Verdict

Evaluator test file: `test/app.labs.import.adversarial.test.ts` (27 tests).

## Verdict: DEFECTS FOUND

Full backend suite: `npx vitest run` — **422 tests, 415 passed, 7 failed** (28 files).
The 7 failures are all in the new adversarial import test; every pre-existing test
file stays green. Failures are left in place (not fixed), per evaluator instructions.

## Defects (7)

### Class A — unhandled throw → 500 on malformed-but-parseable YAML (2)

The import handler wraps only `js-yaml.load` in try/catch. The parsed document is
then passed to `validateTopology` and `reconcileServers` (via `createLab`) with no
error boundary, so a parseable-but-malformed doc throws a `TypeError` and Fastify
returns 500.

1. `links: [null]` → 500.
   `validateTopology` (`src/config-engine/topology.ts:124`) does
   `link.endpoints.length` where `link` is `null` → `Cannot read properties of null`.
   Repro YAML:
   ```yaml
   topology:
     nodes: { ns1: { kind: linux, image: dnsnode:1.0 } }
     links:
       - null
   ```
2. bind node with `interfaces: [null]` → 500.
   `reconcileServers` (`src/server/labStore.ts:96`) does
   `(node.interfaces || []).map((i) => ({ address: String(i.address) ... }))`
   where `i` is `null` → throw. `validateTopology` never checks interface shape.
   Repro YAML:
   ```yaml
   topology:
     nodes:
       ns1:
         kind: linux
         image: dnsnode:1.0
         interfaces:
           - null
   ```

### Class B — wrong-shape docs accepted as empty labs instead of 422 (5)

The shape guard in `src/server/app.ts:675` (`!doc || typeof doc !== 'object'`)
does not reject arrays, and there is no check that `doc.topology` exists and is an
object with a `nodes` object. Result: the following inputs return **201** and create
an empty lab instead of 422 `BAD_YAML`.

1. Array at top level (`- 1\n- 2`) → 201 (arrays are `typeof === 'object'`).
2. `:::` → 201 (js-yaml parses it to `{"::": null}`, then missing topology is accepted).
3. Doc with no `topology` key → 201.
4. `topology` without `nodes` → 201.
5. `topology` as a scalar string → 201.

## Passed (20) — verified robust

- Malformed YAML (`unterminated quote`, tab indentation, unclosed flow seq/map,
  bad mapping) → 422 `BAD_YAML`, no 500.
- YAML scalar / `null` / empty doc → 422.
- `links: ["just a string"]` → 4xx, no 500.
- Prototype pollution: `__proto__` / `constructor` keys at top level and inside a
  node do **not** pollute `Object.prototype` and do not 500.
- Resource abuse: 2000-deep flow nesting → 422 (js-yaml v5 `maxDepth` guard), no
  stack overflow; 2000-node doc → 201 bounded; 2000 alias reuse → 201 bounded.
- Semantic: link to undefined node → 422 `INVALID_TOPOLOGY`; valid doc → 201 with
  topology preserved; `router1` / `r7` (name heuristic, no `ip-forward`) → intent
  `router`, not reconciled to a Server; `ns1` → `bind` and reconciled.
- Permissions: viewer → 403 import, 200 render/validate; unauth → 401 on all four.
- No secret leakage in import/render/validate bodies (no token/keyHash/pwHash/pwSalt/password).

## Notes

- `js-yaml` is v5.3.0. Its default `maxDepth` (100) prevents deep-nesting stack
  overflow, and aliases are reference-resolved (no expansion DoS). This is why the
  resource-abuse cases are bounded.
- The two 500s are the high-severity findings (untrusted input reaches a plain
  throw). The five 201s are medium-severity validation gaps.
