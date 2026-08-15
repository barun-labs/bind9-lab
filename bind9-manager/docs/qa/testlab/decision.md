# Test lab (roles/options deploy) — decision
**Verdict: ACCEPT (Sonnet build + orchestrator independent verify).** Deploy/provisioning is
security-relevant (runs host `ip`/`docker exec`), but it is fully `shellQuote`-guarded with injection
tests and independently reviewed (all 5 interpolation sites quoted) — bar met without a redundant agent.
- 351 tests; independent re-dig: cache/recursive `www.test` -> 10.99.0.1; auth recursion REFUSED.
- 3 real blockers found only by deploying: bridge pre-create, `ip addr/route replace` vs add, multi-view leak.
- testlab left running for inspection; production `dns` untouched (10 containers).
- Engine gaps filled (committed features): root-hints generation, data-plane provisioning.
