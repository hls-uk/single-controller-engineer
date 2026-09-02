# DEC-20260902-011: Knowledge Profile Extends the Engine; Beads First Class

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
2. The engine gains three profile-neutral capabilities and the schema they
   require, each by a bounded implementation unit: a journaled `materialise`
   effect with a filesystem adapter for one-way Drive publication; a
   deterministic projection from journaled evidence to committed provenance
   records with a journaled provenance commit; and digest-bound reviewer packets
   that close `sce-cfl`, which is promoted to P1. The schema is an optional
   targets field on task metadata, gate state on the run aggregate with voided
   dispositions, a clock observation event, and an optional knowledge contract
   in the controller configuration (alias table with mount policy, provenance
   contract, driver, scope, gate targets) recorded at `wave_planned`; a run
   without it gates exactly as before. The schema also adds optional
   `supersedes` and `tombstones` fields on task metadata, extends closure
   evidence with the task-metadata facts a record needs, and extends the
   existing `verify` effect to admit a null unit for the wave's combined
   verification. The provenance commit is the one commit on the integration
   branch without a unit identity or review; it is exempt from the parent's
   one-identity-per-unit invariant because it is a pure projection of reviewed,
   landed evidence whose bytes the engine proves, with this repository's
   unreviewed commits of its Beads interaction records (for example `e82d29a`)
   as precedent.
3. **Beads is first class for knowledge repositories.** Each access-domain
   repository runs embedded Git-synchronized Beads with its own merge slot; task
   cards are child Beads with the existing task metadata plus optional validated
   materialisation targets and supersession fields; live claims are Beads claims
   and reservations. This supersedes the adam-root "local sign-out sheet, Beads
   not part of the pilot" scoping, whose stated costs (cross-machine claim
   authority, a VPS or Tailscale dependency, a database service in the driver's
   flow) embedded Git-synchronized Beads does not carry. Its real cost is `bd`,
   Dolt, and Node on each machine, which the roots' `init` and `doctor` scripts
   do not yet install or check. The adam-root record of that supersession must
   amend DEC-002 sections 2 and 6 and DEC-003 section 3 and its consequences as
   well as the migration plan, brief, and runbook; it and the script extension
   are a follow-up under that repository's authority.
4. The fresh frontier review is retained for every knowledge candidate. A
   risk-gated skip is a possible later decision on pilot latency evidence.
5. The governing contract is [Single-Controller
   Knowledge](../designs/2026-09-02-single-controller-knowledge.md). The parent
   design and the accelerated-beta companion remain authoritative where it is
   silent, and win where it conflicts.
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
  locally and early; its wording, DEC-002 sections 2 and 6, and DEC-003
  section 3 must be amended in adam-root, and the roots' `init` and `doctor`
  scripts extended for the toolchain (`sce-9f5.3`).
- A run remains per clone: cross-machine continuation is an orderly release
  and a new run; in version 1 in-flight units are finished or cancelled by
  the run that started them, on any machine and therefore between harness
  families, so the migration plan's parity criterion for unfinished work is
  met only that way, and the release evaluation demonstrates handoff of
  completed and unstarted work.
- The pilot brief's assurance to Hannah that no Beads or Dolt change was
  involved is reversed; the adam-root follow-up includes a re-brief and her
  re-acknowledgement (`sce-9f5.3`).

## Follow-up

- `sce-9f5.2`: seed implementation units K1 through K6 from the design.
- `sce-9f5.3`: adam-root decision and root entry path (K7).
- `sce-cfl`: promote to P1; dependency of K1.
