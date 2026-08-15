# Declarative-lab Task 1 — decision
**Verdict: DEFECT (MED, data integrity) → fix round 1 → accept.** Lighter loop (deepseek-pro test).
- Tester (deepseek-v4-pro, $2.13): 382 pass / 1 fail. Defect: `reconcileServers` keys Server id on node
  name alone (`srv-<node>`) + `deleteServerByNode` unscoped → two labs in one config sharing a node name
  clobber; deleting one removes the other's Server. All other probes pass (rename, distinct-node labs,
  remove-all, no-interface, CIDR strip, configId list filter, 401/403/200 perms, no leak, unicode).
- Fix: scope Server identity by lab — `id: 'srv-'+lab.id+'-'+node.name`; reconcile removal scoped to
  THIS lab's server ids. The tester's failing test (2 servers survive) then passes.

**Committed:** c10243c
