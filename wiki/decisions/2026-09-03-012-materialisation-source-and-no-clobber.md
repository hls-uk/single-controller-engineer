# DEC-20260903-012: Resolve Sources Before No-Clobber Materialisation

**Date:** 2026-09-03
**Status:** Accepted
**Scope:** Version 1 source expansion, destination naming, sidecar policy,
filesystem publication, and the K2/K3 implementation boundary
**Beads:** `sce-085`, `sce-7g9.2`, `sce-7g9.3`

## Context

Implementation of DEC-20260902-011 stopped before K2 because its accepted
materialisation prose left five core-path questions unresolved. A manifest
target can be a glob while one effect and sidecar are singular; content-hash
naming needs source bytes the reducer cannot read; `sidecarRequired: false`
conflicts with the promise that every artifact is traceable; portable Node
`rename` can replace an existing destination; and K2's gate acceptance depends
on provenance and aggregate-verification protocol shapes assigned to K3.

The user delegated authority on 2026-09-03 to resolve and record these design
questions. Two independent read-only implementation audits had reached the
same findings. Preserving the pure reducer, positive evidence, crash recovery,
and the no-overwrite P0 boundary rules out controller-selected paths and a
precheck followed by ordinary rename.

## Decision

1. A target first emits a journaled, read-only
   `materialisation_resolve` effect at an exact source OID. The reducer derives
   its `sce:tgt:<sha256>` identifier from the canonical complete target,
   scope, origin unit, and committed ordinal. The observation is a byte-sorted,
   unique, bounded list of regular blobs with path, blob OID, SHA-256, and byte
   count. The reducer expands every returned tuple into one materialisation
   entry. Every resolution, expanded materialisation, provenance, and aggregate
   verify entry has its own domain-separated `sce:gate:<sha256>` identifier.
   Aggregate events, effects, parameters, journal commitments, deferrals, and
   recovery selectors carry that stable ID; retries retain it while minting a
   revision-bound effect identity. A provenance entry's logical identity binds
   its projection input snapshot but excludes the attempt-local integration
   base OID: an observed base advance creates a new intent, effect identity,
   and key on the same gate entry. It never accepts a controller-selected
   subset.
2. Source globs are canonical slash-separated ASCII paths. They admit `*` and
   `?` inside a segment and reject `**`, pathspec magic, empty, dot, parent,
   and wildcard-leading segments. The K2 source executor enumerates the exact
   tree and applies this closed matcher itself; it never gives the pattern to
   Git as a pathspec. A returned path is canonical ASCII and at most 192 bytes,
   one blob is at most 16 MiB, one target resolves at most 64 blobs, and one
   wave admits at most 128 outputs totalling 64 MiB. Zero, excessive, non-blob,
   unsafe, or oversize results refuse the whole resolution. Every target in a
   stage resolves and every resulting entry receives its validated clock and
   exact artifact and sidecar names before any materialisation intent. The
   combined final-name set must be pairwise distinct within each destination,
   across all naming policies and across artifact and sidecar names. A
   collision refuses the stage before publication, so a later collision cannot
   follow a partial publication.
3. After resolution, a validated UTC-second observation supplies the clock.
   The reducer derives the final name from a fixed grammar containing a safe
   source stem, the first 12 source-OID characters, the UTC token, and, where
   selected, an ISO date prefix or the first 12 content-digest characters. An
   extension is retained only when the last non-leading dot has a one-to-ten
   character ASCII alphanumeric suffix. The artifact name and its exact
   `<artifact-name>.sce-provenance.json` sidecar name are journaled before
   publication and reused on resume.
4. Version 1 requires `sidecarRequired: true` in both manifest and runtime
   schemas. Sidecar schema `sce.materialisation-provenance` version 1 has no
   unknown keys. Its exact bytes are RFC 8785 canonical JSON, UTF-8, and one
   trailing LF, bounded to 8,192 bytes and derived only from journaled fields.
   An artifact-only policy requires a later decision; it is not silently
   interpreted.
5. The filesystem adapter admits only a canonical real alias root, no-follow
   regular marker, and an existing destination directory whose every component
   is a real directory contained below that root. Existing final and temporary
   paths are opened no-follow and must be regular files. Temporary creation is
   exclusive and no-follow. Symlinks and special files are preserved as
   ambiguous evidence, never traversed or replaced. Mutation runs in a fixed,
   shell-free helper under the shipped Node executable. Its `cwd` is the
   destination directory; it proves the expected device, inode, and canonical
   path, then uses basenames only and rechecks that identity after readback.
   Failure to establish that inode-bound context refuses before mutation;
   later topology drift is ambiguous. Version 1 requires exclusive namespace
   control during the helper call; same-user processes, sync clients, and any
   other actor able to rename the admitted directory are outside its authority
   model.
6. The adapter publishes same-directory, fsynced temporary files with atomic
   hard links to final names. Link creation is no-clobber: an existing final
   path is never replaced. There is no rename, copy, or direct-write fallback.
   Exact `EEXIST` readback may observe or resume; differing bytes are ambiguous.
   A filesystem that positively reports hard links as unsupported is refused
   only when readback proves that no final was created. Real mounted-Drive
   support remains a release-tier gate before a tag.
7. The K2-stable provenance intent binds the complete target definition,
   resolution observation or refusal, materialisation results, and deferral
   disposition. K3 can therefore project a target deferred before resolution
   without inventing a path, digest, or final name.
8. K2 owns the complete strict gate-facing protocol contract and the bounded
   source-specific Git executor under `src/adapters/materialise/`. K3 owns
   provenance projection, detached-worktree and provenance Git execution,
   discovery, and production observations. The short intermediate K2 commit
   fails closed at the unavailable provenance-adapter boundary.

## Rejected Alternatives

- Constrain every target to one exact path: narrows the accepted manifest and
  cannot represent repository rollups.
- Let the controller choose one glob match: makes gate completion depend on
  conversation memory instead of aggregate evidence.
- Use the integration commit OID as a content digest: names the wrong bytes.
- Permit sidecar-free artifacts: breaks the traceability invariant.
- Precheck then call ordinary `rename`: retains a race that can overwrite a
  file created after the check.
- Revalidate then call path-based `link`: permits an intermediate directory
  swap between proof and publication; the inode-bound helper closes that gap.
- Defer all provenance wire shapes to K3: makes K2-AC3 impossible to prove and
  leaves an incomplete gate contract.

## Consequences

- K2 grows one read-only effect and the strict gate-facing K3 scaffolding, but
  the unit state machine remains unchanged and the reducer stays pure.
- The manifest schema rejects unsafe patterns and `sidecarRequired: false`.
- Filesystems without the no-clobber primitive are unsupported in version 1;
  no weaker fallback is advertised.
- K6 records disposable-directory behavior. A real Drive write still requires
  separate authority and stays in the release tier before the next tag.

## Follow-up

- `sce-7g9.2`: implement and verify the amended K2 contract.
- `sce-7g9.3`: complete provenance projection and provenance Git execution on
  the stable K2 wire shapes.
