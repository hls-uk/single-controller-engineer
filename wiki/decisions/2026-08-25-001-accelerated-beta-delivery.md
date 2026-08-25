# DEC-20260825-001: Accelerated Beta Delivery

**Date:** 2026-08-25
**Status:** Accepted
**Scope:** Repository and resulting skill delivery policy
**Beads:** `sce-1kv`
**Base Git OID:** `8159e2bcef0251213310c2bb3fadd7cc86fa84ec`

## Context

Implementing every failure combination and repeating every slow topology gate
at each phase boundary made time to first use materially longer than intended.
The product goal is beta software that works on its promised core paths and is
delivered quickly, not a claim of zero defects.

## Decision

[Accelerated Beta Engineering](../designs/2026-08-25-accelerated-beta-engineering.md)
is the normative policy for delivery cadence, test tiers, review frequency,
and severity-based beta acceptance.

Prefer deterministic typed mechanisms over model inference. Run lean fast
tests during implementation, affected integration evidence when a seam
changes, and the full slow release gate before the next tagged version. P0 and
P1 findings block a beta candidate; P2 and P3 findings are recorded and
deferred unless real use raises their severity.

## Rejected alternatives

- Continue exhaustive per-phase hardening. This preserves the strongest early
  proof but delays useful feedback and encourages speculative work.
- Reduce the project to an unguarded thin wrapper. This is faster but discards
  the authority, privacy, fencing, and duplicate-effect boundaries that make
  orchestration safe enough to use.

## Consequences

Phases may overlap across up to three disjoint workhorse lanes. One controller
still owns Beads and serial integration, and a fresh frontier reviewer still
judges each frozen candidate for P0/P1 defects. Slow suites remain maintained
and directly runnable but no longer sit in the primary edit loop.

The full release suite is required before a tag, not before every untagged beta
checkpoint.
