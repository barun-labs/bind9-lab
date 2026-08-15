# Slice 4 (deploy engine) — decision
**Verdict: DEFECTS (4 CRITICAL + 1 MED) → fix round 1 → re-QA.** FULL loop; both models found DIFFERENT
real bugs (cross-model win).
- Reviewer (cavecrew): validate.ts:63,77 command injection (double-quoted zone/file); deployEngine
  122-126 exit-code masking (rndc reload failure hidden); 119 no production-name guard (MED).
- Tester (deepseek-pro, $1.92): serverId unquoted in marker echoes → injection (failing test). Gate
  un-bypassable, no partial deploy, name safety, runner-failure surfacing all PASS.
- Fix (round 1): a shared `shellQuote`; single-quote/escape zoneName + all file paths in validate.ts;
  shellQuote serverId in deployEngine echoes; capture rndc-reload's own exit explicitly; reject
  reserved production lab names (`dns`, `clab-*`) in deploy pre-flight.

**Fixed round 1 (deepseek partial + Sonnet completion):** all 5 defects closed; also fixed a template-literal bug (JS `${NODE_ID}` vs bash `$NODE_ID`) and an unrelated 1/16 flaky crypto test. Full suite 337/337, tsc+build clean.
**Escalation:** agy down → deepseek (aborted mid-run twice) → Sonnet (sonnet-worker) completed it. Ladder walked to the top rung as designed.

## Real end-to-end (the mock tests could not catch these — value of actually deploying)
The first real deploy against clab-mini exposed 3 bugs the mock-runner unit tests structurally could not:
1. container name `${name}-${node}` → containerlab uses `clab-${name}-${node}`.
2. no cold-start: `dnsnode` starts only dropbear; `named` must be STARTED, not just `rndc reload`ed.
3. `/var/log/named.log` must be touched+chowned before first `named` start (entrypoint doesn't).
Fixed by mirroring `anycast-dns/dns-deploy.sh`'s proven bring-up. RE-PROVED engine-only:
`deploy()` → ns1 ok:true (no manual step); `dig www.demo.test` → 10.99.99.99; genuine cold start
(boot time == deploy time). Throwaway lab `bind9mgr-demo` on 172.100.100.0/24, torn down clean;
production `dns` lab (10 containers) untouched. Slices 4 (deploy) + 5 (verify) proven end-to-end.
