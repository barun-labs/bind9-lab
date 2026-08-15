# QA-pipeline assessment — after slice 2a

First real run of the build → test → review → decide pipeline (see
`../superpowers/process/qa-pipeline.md`), across three security-critical units (auth persistence,
authorize, HTTP surface). Honest verdict for a small-scale project.

## Did it work? Yes — it caught a real bug nothing else did.

The headline: deepseek-pro's adversarial test pass on Unit B found a **privilege-escalation bug** —
`can(user,'deploy',cfg)` granted deploy on the `canDeploy` flag alone, no role check, so a **viewer**
with the flag could deploy. It was reachable (the Users screen kept the flag when demoting to viewer).

What's telling: the **build passed**, its own tests passed, AND the independent **code review said "no
issues."** Only the independent, cross-model *adversarial test* caught it. That single find justifies
the whole experiment on security-critical code.

## Where the value actually sat

| Rung | Cost/unit | What it caught | ROI |
|---|---|---|---|
| Build (agy flash) | ~free (subscription) | the feature + happy-path tests | baseline |
| **Test (deepseek-pro)** | ~$1.3–1.6 | the real escalation bug; 147 adversarial tests total | **high** |
| Review (cavecrew/Claude) | ~30k tokens | nits (JSON.parse guards, salt bytes); **missed** the real bug | low–medium |
| Decide (orchestrator) | small | synthesis + log-not-loop calls | the gate |

The **adversarial test pass is the engine**. The code review caught real-but-minor hardening items and
missed the one that mattered — its worth here is cheap insurance and a *different* failure class (it did
flag the unguarded parse), not primary defense. The cross-model split (deepseek tests, Claude reviews)
paid off precisely because they disagreed.

## On the four things you wanted to judge

- **Manage:** good. Every unit leaves `test-report.md` / `review-report.md` / `decision.md`, so *why*
  each change was accepted is auditable, not vibes. At unit granularity (3 units/slice) the overhead is
  fine; per-tiny-function it would drown you — keep the unit the size of a real module.
- **Detect bugs:** strong, *when the tester is adversarial and independent*. The prompt that says
  "you didn't write this, break it, leave a failing test" is what found the escalation.
- **Fix bugs:** fast and safe. The tester's failing tests *become the regression guard* — the fix
  round re-runs against them, so a fixed bug can't silently come back. One agy-flash round closed it.
- **Review:** the decision gate + artifacts give real accountability. But an LLM review alone is weak on
  logic bugs — don't rely on it as the safety net; rely on the adversarial tests.

## Cost, honestly

~$4.3 in deepseek + the Claude review tokens for one small slice's QA. Fine for this experiment and for
risk-worthy units. It is NOT worth running the full three-agent loop on every mechanical/UI/doc task.

## Recommendation for this project (small scale)

- **Full pipeline (build + adversarial test + review + decide):** auth, permissions, config generation,
  the deploy engine — anything where a bug is a security hole or breaks the lab. This is where it pays.
- **Test-only (skip the separate review):** most backend logic. The review's marginal find rarely
  justified its cost here.
- **Build + own tests + orchestrator diff-review (no extra agents):** UI components, scaffolding, docs,
  mechanical refactors. The v1 frontend was built this way and held up.
- **Efficiency levers that worked:** run test ∥ review in parallel; batch independent builds into waves;
  cap fix loops at 2; *log-don't-loop* on nits the tester can't actually trigger (used on Unit C).

## One structural debt surfaced

The escalation bug lived in **two copies** of `can.ts` (app + shared) — the duplication I flagged when
promoting it. The fix had to touch both. Unify them into `shared/` and have the app import it; schedule
as a small cleanup task so the next logic change doesn't have to be made twice.

## Bottom line

For a small-scale deployment, adopt the pipeline **selectively**: it demonstrably catches real bugs on
the risky 20% of the code, and its ceremony is only worth paying there. Applied to everything it would
be slow and expensive; applied to security/deploy-critical units it already earned its place by finding
a hole a human-style review missed.
