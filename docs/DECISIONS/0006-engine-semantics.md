# ADR 0006 — Engine semantics and the default persona policy

- Status: Accepted (Phase 2)
- Date: 2026-11-16

## Decisions

1. **One interpreter.** `checkAction` → `applyAction` → `perform` is the only place rules are enforced. Check
   order (first failure decides the error code): preconditions (`action.errorCode`), blocking rules
   (`rule.errorCode`, including generated limits/cooldowns), eligibility of placements the action shows,
   costs (`INSUFFICIENT_<RESOURCE>`).
2. **Step semantics.** All effects of a step — costs, action effects, outcome effects, placement `onShow` and
   `reward`, transition effects — are evaluated against the state before the step and applied in that order.
   Transition guards are evaluated before the step. Resources are whole numbers, clamped at 0 and at their
   cap (recorded as `range-violation` / `cap-hit`); variables outside their declared range are recorded, not
   clamped.
3. **Screens.** Entering a screen: reset mission variables if `beginsMission`, apply effects, push/pop the
   overlay stack, check `at: state` invariants, then show eligible state-triggered placements (checking
   `at: placement` invariants first), then add the screen's `duration`. `auto` transitions are taken as soon
   as their guard holds (more than 100 in a row is an error).
4. **Time and sessions.** Simulated seconds. Each day draws `sessionsPerDay`; sessions are spread evenly
   through the day and start at the initial screen; session- and day-scoped variables reset. A session ends
   once its sampled length is used up outside a mission (hard stop at twice the length). UI navigation costs
   `uiSeconds` (default 5).
5. **Default persona policy** (documented in `policy.ts`, weights in `DEFAULT_POLICY_WEIGHTS`): head for the
   next mission and keep playing inside one; with `metaVisitProbability` (0.5) per session visit a meta screen
   first; with `purchaseProbabilityPerSession` go to the store and buy; decide each rewarded video once per
   screen visit with the persona's opt-in probability; everything else at low weight. It is a model of
   behaviour under stated assumptions, not a prediction of real players.
6. **Churn.** After each session, `churnSensitivity × (base + perFailure × consecutive mission failures +
stall)` with defaults 0.03 / 0.05 / 0.1, where stall means the progression variable has not changed for
   three sessions.
7. **Determinism.** sfc32 seeded per (run seed, persona, player index); players aggregated in a fixed order;
   output hashed as canonical JSON (`record.outputHash`). Verified in Node and in a Chromium Web Worker in CI.
8. **Reachability** combines graph analysis (unreachable, dead end, trap = closed loop with no mission
   start/end), interval analysis over declared ranges (never-true guards, preconditions, eligibility) and a
   breadth-first concrete search (screen + variables, all outcomes) giving a witness path to every screen.
9. **Exploit search** is a beam search with restarts and best-case luck. A reward loop is a step sequence that
   returns to the same screen and variables with more of a resource without playing a mission in between.
10. **KPIs** that cannot be computed return `null` with a note (e.g. revenue without assumptions); aggregate
    invariants that depend on them are `skipped`, never silently passed.
