# DEC-20260922-016: Candidate base refresh on the same unit identity

Date: 2026-09-22. Status: accepted; amended 2026-09-23 (see "Amendment
2026-09-23"). Controller: the single-controller-engineer
dogfood run on this repository (roots sce-296 and sce-dtj).

## Context

Every unit is planned on one exact base, and every candidate, verification,
review, and integration is bound to that base. Fast-forward integration
refuses a candidate whose base is not the current integration head. The
design already names the case ("stale base or conflict: refresh on the same
identity"), but the protocol had no transition that records a refreshed base:
once one unit landed, or the controller committed anything to the integration
branch, every other planned unit was unintegrable and the run could neither
wave nor release. On this repository's own run both wave units were stranded
that way.

## Decision

1. Add one unit transition, `refresh_intent` → `candidate_refresh` →
   `refresh_observed` | `refresh_failed`, legal from `collected`,
   `candidate_committed`, `qualified`, and `approved`, never during an act.
   The intent names the target base (the integration head the controller has
   just read back), and the unit leaves the qualification and integration
   queues.
2. The production adapter rebases the unit branch in its own worktree onto
   that head (`git rebase <oid>`, allowlisted with `--abort`), only from a
   clean checkout that descends from the previous base. A conflict aborts the
   rebase and refuses with the unchanged head, which the reducer records as
   `repair_required`; recovery probes read-only and never rebase.
3. `refresh_observed` moves the unit back to `collected` on the new base and
   discards every candidate, verification, review, and approval binding. The
   worker's launch packet stays as historical evidence: the unit records the
   base it was launched against (`launchBaseOid`) only when a refresh moves
   the unit off it, so a run that never refreshes keeps its byte-identical
   wire. A reviewer packet always binds the current base.
4. compose-config stores planned units in the reducer's canonical task form,
   and a wave plan that rewrites a unit's binding advances that unit's
   revision, so the first wave rewrites nothing and any rewrite is a
   revision.

## Consequences

- The controller refreshes a collected unit onto the current integration
  head before its first candidate observation, and refreshes each remaining
  unit again after a sibling lands; verification and review then run once on
  the base that will actually integrate.
- `refresh-candidate` is a new stepwise command; `next` offers it wherever it
  is legal. Reviewer verdicts never survive a refresh, exactly as the design
  requires for any base change.
- Recorded as bead sce-296.8 under the dogfood epic; tests: reducer lifecycle,
  git adapter real-repository rebase and conflict refusal, golden software
  traces unchanged.

## Amendment 2026-09-23

Decision 1 also admits `refresh_intent` from `worktree_observed`, and only
there while the unit holds no candidate head and no launch packet. Units are
composed on the integration head and dispatched hours later, after siblings
have landed on files they own, so the first act on a prepared unit is not a
rebase: its branch carries no commits, and the adapter fast-forwards
`refs/heads/unit/<id>` and the unit worktree with `merge --ff-only`, refusing
a branch that already carries commits, or a dirty or foreign worktree, with
the exact pair it rests on and never reaching for `git rebase`; the read-only
probe reports absence instead, and a worktree already on the new base is
observed as is. Amending decision 3, such an observation must carry
`headOid == baseOid` and returns the unit to `worktree_observed` with only
`baseOid` advanced: no candidate, verification, or review binding exists to
discard, and no `launchBaseOid` is recorded, because no packet was ever bound,
so the worker packet issued afterwards has to bind the refreshed base. A
refused pre-dispatch refresh routes to `repair_required` on the conflicting
head like any other refused refresh. Recorded as bead sce-296.18; tests: the
reducer's pre-dispatch refresh and its refusals, the advertised legal action,
and a production-recovery fast-forward, diverged-branch and dirty-worktree
trio with a fake Git runner.
