# DEC-20260901-009: Classified Harness Support Profiles

**Date:** 2026-09-01
**Status:** Accepted
**Scope:** `parseHarnessSupport` admission semantics and the runtime
representation of harness dispatch-recovery and tier-enforcement classes
**Beads:** `sce-366.1`, `sce-366.5`

## Context

DEC-20260901-008 classified the claude family
`at-most-once/manual-reconciliation` without tier enforcement. Implementation
evidence from `sce-366.1` (commit `1b6279d`) proved the runtime cannot express
that classification: `parseHarnessSupport` refuses any capability matrix in
which any of the eight operations is false, so the declared claude profile is
refused by `parseControllerConfig` and no runner is created. The design
instead describes an explicit classification for a harness without
`lookupByClientKey` and a failed advertised profile — not a refused
configuration — for a harness without trusted controller identity. The code
collapses both distinctions into one all-or-nothing gate.

## Decision

1. `parseHarnessSupport` admits a capability matrix when its six executable
   lifecycle operations — `launch`, `inspect`, `poll`, `collect`, `cancel`,
   and `returnedModelIdentity` — are all true. A missing lifecycle operation
   still refuses the matrix outright.
2. The two trust operations become an explicit derived classification on the
   admitted profile: `lookupByClientKey: false` classifies dispatch recovery
   `at-most-once-manual` (an ambiguous launch blocks for a human-bound
   observation and is never blindly redispatched, and lookup reconciliation
   remains unavailable); `controllerIdentity: false` classifies tier
   enforcement `unavailable` (any preflight or authority path that requires a
   proven controller tier fails that profile explicitly rather than accepting
   controller self-attestation).
3. The support-commitment derivation (canonical-JSON sha256 of the full
   matrix) is unchanged, so admitted profiles remain exactly bound to their
   declared operations. Adapter-level refusal of unavailable operations is
   unchanged.

## Rejected alternatives

- Keep the all-or-nothing gate. It contradicts the design's explicit
  at-most-once classification and makes an honest claude declaration
  unconfigurable, inviting dishonest all-true declarations instead.
- Make lifecycle operations optional too. An adapter that cannot launch,
  poll, collect, cancel, or prove returned identity cannot run the loop; that
  is refusal, not classification.
- Infer the classification at dispatch time from observed behavior. Admission
  must be a closed, deterministic function of the declared matrix.

## Consequences

- The claude example config becomes a valid, admitted configuration; the
  `sce-366.1` eval test's fail-closed third case flips to plain acceptance.
- Trusted all-true profiles (the codex example) are admitted unchanged; the
  existing harness suite must stay green as the regression guard.
- Documentation and the support matrix state the classification, never
  blanket support, per DEC-20260901-008; its requalification rule stands.

## Follow-up

- Implementation unit `sce-366.5` owns the bounded `src/harness` and
  `src/controller-config` change with its tests.
