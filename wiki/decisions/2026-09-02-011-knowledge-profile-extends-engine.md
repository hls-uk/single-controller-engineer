# DEC-20260902-011: The Knowledge Profile Extends the Engine, with Beads First Class

**Date:** 2026-09-02
**Status:** Accepted
**Scope:** How general knowledge work (Git-first Markdown knowledge
repositories partnered with Google Drive) is delivered by this project; the
role of Beads in knowledge repositories; the governing design for that work
**Beads:** `sce-9f5`, `sce-9f5.1`

## Context

`vdb-uk/adam-root` DEC-002 and DEC-003 (2026-08-10) fixed the knowledge
architecture: isolated writers, append-only provenance, a serialized
deterministic landing lane, one canonical home per artifact class with Google
Drive keeping Office, PDF, raw, and human-collaborative files, and one Git
repository per access domain. Their migration plan asked for a
provider-neutral launcher, per-clone atomic claims, immutable event files,
generated rollups, and serial Drive publication, and, with the pilot brief
and runbook, it explicitly kept Beads out of the pilot in favour of a
per-clone local sign-out sheet.

Fourteen days later this repository delivered the Single-Controller Engineer:
a typed protocol engine whose reducer, schemas, fences, harness seam, and
recovery contract contain nothing specific to software. The question put to
the controller on 2026-09-02 was whether to build a separate knowledge tool or
extend this one, and whether Beads should be first class in knowledge
repositories.

## Decision

1. Knowledge work is delivered by the existing engine under a **knowledge
   profile**, shipped as a third skill, `single-controller-knowledge`, in the
   same package and vendored runtime. The engine is not forked, not duplicated,
   and not given a profile flag in the reducer.
2. The engine gains exactly three profile-neutral capabilities, each by a
   bounded implementation unit: a journaled `materialise` effect with a
   filesystem adapter for one-way Drive publication; a deterministic
   projection from closure evidence to committed provenance records with a
   journaled provenance commit; and digest-bound reviewer packets that close
   `sce-cfl`, which is promoted to P1.
3. **Beads is first class for knowledge repositories.** Each access-domain
   repository runs embedded Git-synchronized Beads with its own merge slot;
   task cards are child Beads with the existing task metadata plus optional
   validated materialisation targets; live claims are Beads claims and
   reservations. This supersedes the adam-root "local sign-out sheet, Beads
   not part of the pilot" scoping, whose stated costs (cross-machine claim
   authority, a VPS or Tailscale dependency, a database service in the
   driver's flow) embedded Git-synchronized Beads does not carry. Its real
   cost is `bd`, Dolt, and Node on each machine, which the roots' `init` and
   `doctor` scripts do not yet install or check. The adam-root record of that
   supersession and the script extension are a follow-up under that
   repository's authority.
4. The fresh frontier review is retained for every knowledge candidate. A
   risk-gated skip is a possible later decision on pilot latency evidence.
5. The governing contract is
   [Single-Controller Knowledge](../designs/2026-09-02-single-controller-knowledge.md).
   The parent design and the accelerated-beta companion remain authoritative
   where it is silent, and win where it conflicts.
6. The package and `sce` bin keep their names through 0.x; SCE reads as the
   discipline, with software and knowledge as materials.

## Rejected alternatives

- A separate knowledge tool or a fork of the engine: duplicates the
  crash-tested fencing, journal, review binding, and recovery contract and
  then diverges from them.
- A dependent repository consuming the engine as a library: the package
  exposes one executable, and the needed seams do not exist yet.
- A file-backed tracker instead of Beads: a strict subset of reservations,
  claims, and the merge slot, and unable to fence two machines.
- Deterministic-only landing without model review: returns boundary,
  contradiction, and support judgments to a human queue.
- A Google Drive API adapter in version 1: adds credentials and a dependency
  the mounted-filesystem adapter does not need.

## Consequences

- The design lands on `main` and the implementation epic is seeded in Beads
  (`sce-9f5.2`) so the work is ready to implement.
- The installer's skill pair becomes a triple; package allowlist, layout test,
  README, and getting-started guide follow in the packaging unit.
- The migration plan's Stage 5 optional coordination service is answered
  locally and early; its wording must be superseded in adam-root, and the
  roots' `init` and `doctor` scripts extended for the toolchain (`sce-9f5.3`).
- A run remains per clone: cross-machine continuation is a release and a new
  run, not a shared journal.

## Follow-up

- `sce-9f5.2`: seed implementation units K1 through K6 from the design.
- `sce-9f5.3`: adam-root decision and root entry path (K7).
- `sce-cfl`: promote to P1; dependency of K1.
