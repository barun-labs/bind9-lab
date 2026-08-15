# QA pipeline — build → test → review → decide

The delivery process for Bind9-Manager. Every function/task passes through it before it is
accepted. It is the diagram's **Orchestrator-Worker** (fan work out, synthesize) wrapped in an
**Evaluator-Optimizer** loop (independent test + review feed back until clean).

## Roles (who does what, and on which model)

| Role | Model | Job | Never does |
|---|---|---|---|
| **Orchestrator** | Opus (this session) | Plan, dispatch, read every diff, decide next move, commit | Write app code |
| **Builder** | agy flash 3.7 → deepseek → Sonnet (ladder) | Implement the task + its own tests | Judge its own work |
| **Tester (Evaluator)** | deepseek-v4-pro | *Independent, adversarial* test pass: write tests BEYOND the happy path — edge cases, error paths, boundaries, security/permission bypass — run the full suite + build, report a structured verdict | Fix the code |
| **Reviewer** | Claude (`cavecrew-reviewer`) — cross-model from the tester | Review the diff for correctness, security, and needless complexity; severity-tagged findings | Fix the code |

The tester and reviewer are **different models** on purpose — deepseek and Claude miss different
things; disagreement between them is signal.

## The loop (per task)

```
Build (builder)
  → Test (deepseek-pro)  ┐  run in PARALLEL — independent
  → Review (cavecrew)    ┘
  → Orchestrator reads BOTH + git-diffs the change, then decides:
        clean            → commit, task done
        fixable findings → dispatch a fix (builder, with the exact findings) → back to Test
        fundamental      → escalate up the ladder or redesign
```

- **Test and review run in parallel** once the build lands — they don't depend on each other.
- **Loop cap: 2 fix rounds.** A third failure escalates the builder up the ladder (flash→pro→Sonnet)
  or triggers a redesign — no infinite optimize.
- **Accept gate:** tester's suite green + `build` clean + reviewer has no unresolved High finding +
  orchestrator sign-off. Only then is it committed.

## Artifacts (structured, so it's auditable)

Each task produces, under `docs/qa/<task-id>/`:
- `test-report.md` — deepseek-pro's verdict: what it tested, pass/fail counts, each bug with a repro,
  coverage gaps.
- `review-report.md` — reviewer's findings: `severity | file:line | problem | fix`.
- `decision.md` — orchestrator's call: accept / fix / escalate, with the reasoning and the commit hash.

## Efficiency rules

- Independent builds fan out in parallel (disjoint files, no in-wave git — orchestrator commits).
- Test + review of a task run concurrently.
- Only loop on *real* findings; a nit the reviewer flags but the tester can't trigger is logged, not
  looped on.
- Escalate the builder, don't re-prompt the same rung twice on the same failure.

## Why this shape (the tradeoff being measured)

Cheap builder + expensive independent QA. The bet: a fast first-rung build plus a rigorous,
cross-model test/review catches more real bugs per token than one careful build alone — and keeps the
orchestrator's decision gate (the human-in-the-loop stand-in) on every change. This doc is the
experiment; the assessment of whether it pays off at this project's scale is fed back after the first
phase runs through it.
