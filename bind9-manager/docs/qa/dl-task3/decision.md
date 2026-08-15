# Declarative-lab Task 3 (deploy trigger) — decision
**Verdict: DEFECTS (1 CRITICAL + 2 HIGH path-traversal) → fix round 1 → accept.** FULL loop.
- Reviewer (cavecrew): CRITICAL app.ts — `labDir` taken from request body → arbitrary-dir write
  (`labDir="/etc"`); HIGH — `topology.name` used in labDir path with no charset guard → `../../../etc`
  escapes (shellQuote stops command injection, NOT path traversal); HIGH — deployEngine reserved-name
  guard only blocks `dns`/`clab-` prefix, allows `../`. Positives: authz-before-job, GET IDOR check,
  shellQuote, 404-not-500.
- Tester (deepseek-v4-pro): ABORTED mid-run (tool-boundary kill); left 19 passing tests, no traversal
  repro, no report. Reviewer is the signal.
- Fix: (1) derive labDir SERVER-SIDE only, ignore any body.labDir; (2) validate topology.name + lab name
  against ^[A-Za-z0-9_-]+$ at lab create/import (422) so bad names never persist; (3) expand the
  deployEngine guard to also reject names failing ^[A-Za-z0-9_-]+$. Add regression tests for all three.

**Committed:** a7404a9
