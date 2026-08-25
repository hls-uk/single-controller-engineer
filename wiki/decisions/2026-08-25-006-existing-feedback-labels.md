# DEC-20260825-006: Use Existing Feedback Labels

**Date:** 2026-08-25
**Status:** Accepted
**Scope:** GitHub feedback forms and deterministic duplicate reconciliation
**Beads:** `sce-1kv.4.1`, `sce-1kv.4.2`

## Context

The reviewed design named `duplicate-feedback` and optional `needs-triage`
labels. A read-only GitHub API inventory proved that neither label exists in
this repository; the standard `duplicate`, `bug`, and `enhancement` labels do.
Creating or administering labels is outside the current authority boundary.

## Decision

Use only the confirmed existing `duplicate`, `bug`, and `enhancement` labels.
The trusted triage workflow applies `duplicate` to later exact matches and adds
the fixed canonical-link comment. Ambiguous and ordinary unmarked issues are
left unchanged. The issue forms use `bug` or `enhancement` only.

## Rejected alternatives

- Create the labels during implementation without repository-administration
  authority.
- Keep a source contract that cannot execute in the target repository.
- Derive a label name from hostile issue content.

## Consequences

The beta works with current repository state and needs no administrative side
effect. A future label change requires a new decision plus a read-only
existence check before workflow source is updated.
