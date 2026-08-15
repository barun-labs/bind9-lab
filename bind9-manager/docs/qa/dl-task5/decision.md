# Declarative-lab Task 5 (Deploy button + progress) — decision
**Verdict: ACCEPT on orchestrator review.** Low-risk UI (deploy authz/validation enforced backend-side);
labs tests 13/13, full app suite 93, tsc+build clean, no orphan files. Deploy button validates first
(blocks on errors), then deploys + polls the job to per-server SUCCEEDED/FAILED. Fixture default offline.
