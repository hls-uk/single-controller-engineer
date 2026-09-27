# DEC-20260927-023: Extend ownership for an exact repair

**Date:** 2026-09-27
**Status:** Accepted
**Beads:** `sce-ywl`

## Context

A review or verification can identify a required file outside a unit's committed ownership. The worker packet binds those paths exactly, so changing only task metadata would leave an invalid packet and changing the plan would disturb the live unit's candidate and evidence.

## Decision

Admit one additive ownership change through `extend-repair-scope` only while an acquired controller holds a singleton `repair_required` wave with no unresolved effect, active session owner, or qualification/integration queue. The event binds the current revision, unit, base/head/tree, branch/worktree, and hash of the retained repair context. The new path list must contain every old path and at least one additional valid path. The reducer changes only the task's owned paths, advances the unit and run revisions, and removes obsolete worker packet/prompt and qualification/review bindings. It retains the physical checkout, exact candidate, repair findings, prior session lineage, acceptance, dependencies, resources, risk, and mandatory verification.

A new worker packet must bind the expanded metadata before `repair_intent`. Candidate collection remeasures the full diff under the existing 65,536-byte limit; qualification uses the unchanged commands and review is fresh.

## Alternatives and consequences

Replanning the active wave or editing a projection directly would bypass the unit's retained evidence and crash-safe transition. Those paths remain refused. The command records no external act, so its one CAS is the durable boundary; stale requests and replay are refused. This is a narrow repair escape hatch, not a general change to active wave scope.
