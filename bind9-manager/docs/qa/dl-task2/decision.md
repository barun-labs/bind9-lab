# Declarative-lab Task 2 — decision
**Verdict: DEFECTS (2 HIGH crash + 5 MED wrong-shape) → fix round 1 → accept.** Import parser =
untrusted input, so FULL adversarial pass (deepseek-pro, $2.65). 415 pass / 7 fail.
- Crashes (500): `links:[null]` (topology.ts validateTopology reads .endpoints on null);
  bind `interfaces:[null]` (labStore reconcileServers maps .address on null).
- Wrong-shape accepted (201 empty lab, should be 422): array top-level, no `topology`, `topology`
  without `nodes`, `topology` scalar. Guard `typeof doc!=='object'` misses arrays; no `topology.nodes`
  check; try/catch only wraps js-yaml.load, not validateTopology/reconcileServers.
- VERIFIED ROBUST (kept): malformed→422, scalar/null→422, NO prototype pollution, 2000-deep→422,
  2000-node/alias bounded, undefined-node link→422, router heuristic, viewer 403 / unauth 401, no leak.
- Fix: harden the import handler (require plain object with `topology.nodes`; reject arrays; wrap ALL
  post-parse work in try/catch → 422); null-guard validateTopology link entries + reconcileServers
  interfaces.

**Committed:** 82d27d1
