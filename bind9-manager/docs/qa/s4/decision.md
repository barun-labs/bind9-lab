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
