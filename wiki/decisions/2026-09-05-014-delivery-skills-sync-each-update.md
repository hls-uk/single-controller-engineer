# DEC-20260905-014: Delivery Skills Sync Each Update

**Date:** 2026-09-05
**Status:** Accepted
**Scope:** Shipped engineer and knowledge skill workflows
**Beads:** `sce-36o`

## Context

[DEC-20260905-013](2026-09-05-013-automatic-git-and-beads-sync.md) established
automatic Git and Beads synchronization for this repository. The user then
explicitly requested the same delivery obligation in both shipped skills,
subject to each adopting repository's authority and topology.

## Decision

Both skill entrypoints require remote refresh at startup and synchronization
after every completed work unit or controlled tracker update. A shared
procedure in the shipped controller contract defines authority reuse,
controller ownership, validation and integration gates, and independent Git
and Beads readbacks. Existing authorization is sufficient; agents must not
repeatedly ask for routine sync approval.

The procedure respects local-only/no-push/no-commit restrictions, protected
Git integration, embedded Git-sync, and shared-server Beads. Missing authority
still blocks its affected action. Knowledge provenance, materialisation, and
audience gates remain binding. Sync failures preserve local work and report
the exact unsynced state.

## Rejected alternatives

- Repository instructions alone: installed skills otherwise omit the cadence.
- A blanket push grant: a skill cannot override an adopting repository's
  authority or turn local-only work into remote publication.
- Embedded Dolt commands in every topology: shared-server durability uses
  the server contract and authoritative readback instead.

## Consequences and follow-up

This extends the workflow scope of DEC-20260905-013 to the shipped skills,
without extending its repository-specific authority grant. The shared
procedure is packaged with both skills through the existing installer. No
runtime behavior, package version, tag, or publication changes are required.
