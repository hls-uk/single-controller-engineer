# DEC-20260825-003: Phase 2 Recovery Boundary

**Date:** 2026-08-25
**Status:** Accepted
**Scope:** `sce-1kv.2.6` recovery implementation and acceptance
**Beads:** `sce-1kv.2.6`
**Base Git OID:** `8159e2bcef0251213310c2bb3fadd7cc86fa84ec`

## Context

Candidate integration alone cannot recover a controller after process loss.
Embedded and shared-server controller transitions require complete durable
authority, while an idempotency key and parameter hash alone cannot reconstruct
the exact transition after restart.

Recovery crosses the reducer, aggregate and child compare-and-swap, controller
slot, operation lock, Git effects, and both Beads topologies. The shared
contract is cross-cutting, but topology qualification becomes independent once
that contract is stable.

## Decision

Persist a typed transition record binding the expected and resulting state,
scope, holder, idempotency key, and topology-specific authority before acting.
Authoritative load must distinguish positive absence from outage, corruption,
foreign state, and ambiguity. Recovery reconciles durable intended or ambiguous
effects before emitting new effects.

Keep `/root` as the only tracker and integration writer. Split bounded work
between disjoint core/server/Git and embedded-topology workhorse lanes after
the shared interface stabilises, then form one frozen candidate for fresh
frontier P0/P1 review.

Apply the accelerated-beta evidence policy: fast focused gates per unit,
affected real topology smokes for this candidate, and full combinatorial crash
and provider matrices in the separately invokable release tier before the next
tag.

## Rejected alternatives

- Reconstruct authority from in-memory agent context after restart. This is
  not durable or deterministic.
- Permit multiple tracker or integration writers. This breaks the controller
  fence.
- Block the untagged beta on every theoretical crash interleaving. This moves
  release-tier proof into the primary delivery loop without changing the core
  authority contract.

## Consequences

P0/P1 recovery gaps in promised embedded or shared-server core flows block the
candidate. Bounded matrices, uncommon histories, and speculative hardening may
be recorded as P2/P3 release work. No topology downgrade, force push,
destructive repair, or external mutation is authorised by this decision.
