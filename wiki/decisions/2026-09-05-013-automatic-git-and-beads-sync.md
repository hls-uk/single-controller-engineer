# DEC-20260905-013: Automatic Git and Beads Sync

**Date:** 2026-09-05
**Status:** Accepted
**Scope:** This repository's agent delivery and synchronization authority
**Beads:** `sce-vrm`

## Context

The conservative agent profile required fresh approval for routine remote
sync. Beads accumulated 122 local commits absent from its remote while the
Git code branch was synchronized. On 2026-09-05 the user explicitly requested
the push and a policy requiring agents to keep remote Beads and Git updated
and pushed after every update.

## Decision

This repository adopts the team-maintainer profile with standing authority
for routine project issue maintenance, Git commits, and non-force Git and
Beads pull/push operations. The operational instructions are mirrored in
`AGENTS.md` and `CLAUDE.md` under Automatic Git and Beads Sync.

The controller refreshes both remote states at session start, syncs each
completed Beads update, and commits and pushes each coherent file update
after applicable validation and exact-diff review. Both remote states must
be verified before reporting completion; a Git push alone does not sync Dolt.
Worker lanes hand changes to the controller for serialized integration.

Preserve unrelated work and stop on sync errors or unresolved conflicts.
Current narrower user instructions override this standing authority. Force
pushes, destructive resets, tags, releases, package publication, deployment,
external messaging, and other repositories are outside this authority.

## Rejected alternatives

- Asking for approval on every routine sync: the user explicitly removed
  that gate, and it allowed shared tracker state to become stale.
- Syncing only at session end: intermediate completed updates must also be
  available to other machines and controllers.
- Automatically pushing arbitrary working-tree edits: validation, ownership,
  exact staging, and non-destructive integration remain required.

## Consequences and follow-up

Routine Git and Beads synchronization is now required work for each update.
The agent reports exact unsynced state if an operation cannot complete.
This is a repository-specific grant under the accelerated-beta authority
rules; it does not change the shipped engine's runtime authorization contract
or impose this policy on repositories adopting its skills.
