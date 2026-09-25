# DEC-20260925-021 — Recover a rejected malformed publication explicitly

- Date: 2026-09-25
- Status: Accepted
- Beads: `sce-4b5`, `sce-4b5.1`
- Report: [GitHub issue #1](https://github.com/hls-uk/single-controller-engineer/issues/1)

## Context

The 0.1.0 branch boundary admitted a full `refs/heads/...` reference where the Git adapter expected a short branch name. Prefixing it again produced a provider-rejected target. The reviewed candidate survived, but the unresolved publication could not be corrected through the protocol.

## Decision

Reject full references before new branch side effects. Keep persisted legacy branch fields readable. A narrow explicit recovery acknowledgement binds the acquired controller, aggregate revision, exact publication effect and parameters, reviewed candidate and deterministic removal of the mistaken prefix. It records operator-attested provider rejection and separately requires fresh absence of the old target from the verified repository and push remote. Absence alone is insufficient.

Settle the original effect with truthful refusal evidence, preserving its parameters and audit commitment. Preserve the physical local branch/worktree binding and candidate/review tuple. A distinct optional publication branch override is used only by a new normal publication intent. The recovery command performs no push and does not rename local branches, edit projections or release a lock.

## Rejected alternatives

- Silently stripping prefixes during initial admission hides invalid inputs.
- Tightening persisted schemas prevents affected runs from being loaded.
- A receipt hash without a verifier does not prove provider rejection.
- Replacing the physical branch binding breaks later refresh and verification.
- Generic journal editing, forced unlocks and absence-only settlement bypass existing crash-recovery guarantees.

## Consequences and follow-up

The operator must inspect the exact rejected operation before attesting to it. Moved, unreadable or foreign state remains blocked. Candidate/base changes still invalidate review through the normal refresh path. This bounded repair does not add a generic abort mechanism, provider administration or a new release. The exact request, regressions and validation evidence belong with the implementation and Bead.
