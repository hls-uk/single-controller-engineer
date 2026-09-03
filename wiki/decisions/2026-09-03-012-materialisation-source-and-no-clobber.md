# DEC-20260903-012: Resolve Sources Before No-Clobber Materialisation

**Date:** 2026-09-03
**Status:** Accepted
**Scope:** Version 1 source expansion, destination naming, sidecar policy,
filesystem publication, bounded recovery identity, alias admission, and the
K2/K3 implementation boundary
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
   Git as a pathspec. It uses a fixed Git executable and verified repository
   context, disables replace objects, lazy promisor fetches, prompts and
   optional locks, and strips inherited Git repository, object, config,
   credential, and network redirection from its bounded environment. Missing
   promised objects refuse without hidden I/O. NUL-delimited Git paths remain
   raw bytes while literals,
   `?`, and `*` match ASCII bytes within slash-separated segments. Every
   matched path is then fatal-UTF-8-decoded and required canonical ASCII; one
   unsafe match refuses the whole result rather than selecting safe siblings.
   A returned path is canonical ASCII and at most 192 bytes,
   one blob is at most 16 MiB, one target resolves at most 64 blobs, and one
   wave admits at most 128 outputs totalling 64 MiB. Zero, excessive, non-blob,
   unsafe, or oversize results refuse the whole resolution. Every target in a
   stage resolves and every resulting entry receives its validated clock and
   exact artifact and sidecar names before any materialisation intent. The
   combined final-name set must be pairwise distinct within each destination,
   across all naming policies and across artifact and sidecar names. A
   collision refuses the stage before publication, so a later collision cannot
   follow a partial publication. Gate-stage preflight additionally compares
   every candidate with all already-observed unit-stage finals in the same
   physical destination; a collision refuses only the pending gate entries
   before gate-stage publication. The final `gate_clock_observed` event records
   that outcome atomically as a reducer-derived `output_name_collision`
   refusal on each affected pending entry, with the lexicographically first
   other colliding gate entry ID as its bounded witness. A later clock may
   retry only such an entry and recomputes the complete stage preflight; an
   explicit controller deferral may consume the recorded refusal.
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
   If a final and its exact temporary are regular expected bytes on the same
   inode with link count two, recovery recognizes the legitimate post-link
   crash, unlinks only that temporary, fsyncs the directory, and never
   republishes the final. Any other linked-temporary evidence is ambiguous.
   A filesystem that positively reports hard links as unsupported is refused
   only when readback proves that no final was created. Real mounted-Drive
   support remains a release-tier gate before a tag.
7. The K2-stable provenance intent binds the complete target definition,
   resolution observation or refusal, materialisation results, and deferral
   disposition. K3 can therefore project a target deferred before resolution
   without inventing a path, digest, or final name.
8. K2 owns the complete strict gate-facing protocol contract, the bounded
   source and destination executors under `src/adapters/materialise/`, and the
   additive Beads embedded/server carry-export CAS needed for authoritative
   cross-run import. Its owned boundary explicitly includes those two Beads
   adapter subtrees and their focused tests. K3 owns provenance projection,
   detached-worktree and provenance Git execution, discovery, and production
   observations. The short intermediate K2 commit fails closed at the
   unavailable provenance-adapter boundary.
9. The shared recovery-event-ID helper preserves the existing
   `recover-${effectId}` bytes whenever that value fits the strict 160-byte
   identifier. Only an overlength value becomes
   `recover-${sha256(RFC8785({domain: "sce.recovery-event.v1", effectId}))}`.
   Generic and production recovery use the same helper, fixing maximum-length
   effects without changing ordinary software recovery IDs.
10. Knowledge-contract aliases have unique names and lexically canonical
    absolute roots that are pairwise distinct and non-overlapping. This rejects
    obvious aliases but is not physical-identity proof. After source resolution
    and before any stage clock, one deduplicated `destination_probe` effect per
    alias/subpath observes the final directory's canonical path, device, and
    inode. The reducer groups all stage and cross-stage collision checks by
    device/inode, including lexically different bind or case-folded paths, and
    gate-stage reprobe drift is ambiguous. Each alias also carries the required
    v1 `namespaceControl: "exclusive"` assertion through the manifest,
    contract, wave state, probe, and materialise parameters; absence or any
    other value refuses before intent or act.
11. The manifest names a bounded provenance worktree-root environment
    variable; controller composition has no implicit default and resolves it
    into the knowledge contract's canonical absolute non-root
    `provenanceWorktreeRoot`, at most 3,840 UTF-8 bytes and non-overlapping with
    every alias root. The reducer derives each attempt path as a direct child
    named `sce-provenance-<sha256>` from canonical domain
    `sce.provenance-worktree-path.v1` and the intent's idempotency key. The
    provenance and aggregate-verify parameters bind that exact path; an event
    never supplies it.
12. `gate_clock_observed` is the sole clock event for materialisation and the
    provenance entry. A materialisation clock is legal only after all stage
    destination probes settle. A provenance clock is legal only after every
    immutable original-wave unit and unit target settles and before its intent.
    Aggregate verify has no clock, and intent events cannot supply or replace a
    timestamp.
13. Deferring provenance preserves its complete canonical projection-input
    snapshot and carry lineage in the voided gate entry. A later same-run wave
    atomically transfers and deterministically merges it before replacing the
    gate; a distinct run uses the authoritative claim protocol in decision 19.
    Only an observed provenance commit clears the logical carry. The snapshot
    survives journal compaction and is bounded to 65,536 UTF-8 bytes, 64 unit
    IDs, and 128 expanded materialisation entries across carried and current
    evidence. Resolution
    intents bind the exact remaining item, source-byte, snapshot-byte, and
    aggregate-envelope capacities. The adapter returns a bounded ordinary
    `evidence_budget_exceeded` refusal rather than tuples that cannot fit. A
    shared pure cost function includes schema-derived worst-case durable
    per-output entry, clock/name, status, and provenance overhead, not merely
    tuple bytes. Sidecar bytes are derived for execution rather than duplicated
    in state. The reducer reserves fixed gate/journal structure and rechecks
    full prospective state, so later legal transitions stay within the
    131,072-byte envelope.
14. Knowledge commands are bounded argv vectors executed without a shell. The
    aggregate `verify` runtime branch has null `unitId`, a gate entry ID, exact
    provenance OID and worktree path, and ordered `commands: string[][]`. The
    existing unit/software verify branch retains string `unitId` and
    `commands: string[]` byte-for-byte. A single argv is at most 32 nonempty
    1,024-byte canonical-Unicode-scalar, non-NUL arguments and 8,192 canonical
    bytes; the aggregate set is at
    most 32 argv vectors and 32,768 canonical bytes. Normal controller
    composition concatenates manifest `fast` then `integration` vectors;
    `release` remains outside the run until the next-tag release tier.
15. `wave_planned` rejects nonempty materialisation targets without a knowledge
    contract and rejects a target whose alias is absent from that contract.
    The repository manifest has no `canonicalRoot` field; its
    `mountPathVariable` is resolved exactly once and is the sole source of the
    runtime canonical absolute root.
    Omitted or empty target arrays are the only new task-metadata shapes that
    an ordinary software run admits, preserving its behavior.
    Controller configuration is the sole authority source: wave command
    admission requires its optional contract and the event copy to be both
    absent or canonically byte-identical, and recovery rejects persisted/config
    drift before effects.
16. Gate state distinguishes target promises and dependent placeholders from
    actual gate entries. Promises have only `targetId` and may be voided before
    a source exists; provenance and verify begin as placeholders. Pending or
    voided promises live in `targetPromises`; source-bound groups live in
    `targets` and contain their actual resolution and materialisation entries.
    Successful derivation atomically removes/replaces the pending promise or
    placeholder; voided ones remain, and dual or missing lineage is invalid.
    The reducer creates source-bound resolution entries only after unit or
    provenance OIDs exist, destination-probe entries only for expanded outputs, the provenance
    entry only after freezing the complete merged snapshot, and aggregate
    verify only after provenance is observed. A refused shared probe cascades
    deferral or optional-unmounted voids to every dependent unclocked output
    while retaining the resolution, probe, and follow-up evidence in each
    source-bound target group; no promise exists or is recreated after
    successful expansion. Every actual entry has a stable gate ID;
    placeholders never fabricate one and cannot receive effect events. Pending
    promises and placeholders block wave planning and controller release
    exactly like pending entries; gate green requires all three layers settled
    plus released reservations.
17. `provenance_commit_observed` is a closed result union. `committed` carries
    attempted base, commit, and tree OIDs. `reproducibility_failed` carries
    attempted commit/tree and a bounded diagnostic digest. `base_advanced`
    carries attempted commit/tree and the newly observed integration base.
    `worktree_refused` carries expected base, nullable observed HEAD,
    `dirty_worktree` or `unexpected_head`, and a diagnostic digest.
    `integration_refused` carries attempted commit/tree and a diagnostic
    digest. Only `base_advanced` automatically creates a new revision-bound
    intent on the same gate entry. Other refusals permit explicit deferral;
    unavailable emits no observation, and uncertainty is ambiguous.
18. Each gate snapshots immutable `originalUnitIds`; live wave drain never
    destroys provenance membership. A bounded durable map records a landed
    unit's exact closure-evidence commitment as `uncommitted`, changes it to
    `committed` with the provenance OID only on a committed observation, and
    never adds failed or voided units. Snapshot construction merges carried
    members with exactly the landed uncommitted originals, including a unit
    with no targets, rejects contradictory duplicates, and excludes records
    committed by an earlier successful wave.
19. A last-wave provenance deferral may settle, release, and export its
    snapshot without a pre-seeded repair unit. A distinct acquired run uses the
    journaled pre-gate `provenance_carry_claim` effect. Its dedicated production
    command accepts only predecessor Beads root identity, authoritatively loads
    and validates the released same-repository predecessor, reads current Git
    integration OID, and CAS-creates an immutable strict claim under the
    predecessor root Bead sibling metadata object `sce_carry_claims`, outside
    the root projection, keyed by a domain-separated export digest. That sibling
    is absent or exactly empty before claim and an exact singleton afterward;
    wrong type, extra key, noncanonical record, or oversize is
    `projection_invalid` before mutation. The record binds export ID,
    predecessor root/run/wave and snapshot, importing run, effect idempotency
    key, and fixed revision 1. Both topologies acquire and read back the exact
    singleton within the transaction; embedded Git-sync additionally proves
    that the persisted delta changes only the sibling claim object. Exact-token
    readback is idempotent, another claimant is refused, and uncertainty is
    ambiguous. The
    strict `provenance_carry_claim_observed` union is `imported` with the exact
    snapshot, predecessor commitments, current base, claim proof, and lineage;
    `already_claimed` with bounded claimant and claim proof; or
    `predecessor_refused` with a closed reason and evidence digest. Every
    nonambiguous result settles the effect; a refusal permits release or a new
    dedicated claim. Generic
    event, gate-wave, and command-event injection is forbidden. An empty task
    list is legal only for a unit-free imported carry-only wave; this lets a
    full 64-unit carry be committed after a separate repair run without a 65th
    member. Repeated repair failures need not grow membership, and two runs
    cannot consume one export.
20. The destination effect kind is the bounded literal `destination_probe`,
    with `destination_probe_intent` and `destination_probe_observed` events.
    It fits the existing 192-byte derived effect-ID bound even when its source
    event ID uses all 160 bytes. All five new effect kinds use the shared
    conditional recovery-ID rule in decision 9; no identifier limit is widened.
21. The active knowledge gate retains optional reducer-owned
    `currentIntegrationOid`, updated only from validated serialized
    `integrate_observed.integrationOid` facts and never removed with a closed
    unit; software runs have no such field. Provenance freezes the last current-wave
    integration OID; a no-land carry wave uses the carry's last attempted or
    base-advanced provenance base, and a carry-only import uses its
    authoritative Git readback. No provenance intent or controller event may
    invent or replace that base.
22. A `wave_planned` event with a knowledge contract, including a unit-free
    carry-only wave, requires the run to have recorded its exact harness
    configuration already. The pinned family is the sole source of the
    sidecar and materialise `executorTool`; ordinary software-wave admission is
    unchanged.
23. Carry snapshot, export, claim-record, ancestor, and lineage digests each use
    the exact separate RFC 8785/SHA-256 domains specified in the governing
    design. The carry retains at most 128 ordered unique root/run ancestor
    digests; first deferral uses the empty-list commitment, import validates and
    appends its predecessor, current or duplicate ancestry refuses, and a full
    predecessor lineage returns `lineage_limit_exceeded` before CAS.
24. Controller composition, `wave_planned`, and hydration use one pure
    schema-derived upper-bound sidecar serializer before any promise exists.
    It combines the exact driver, scope, and pinned harness with
    schema-maximum safe later facts and applies the same RFC 8785-plus-LF byte
    path as the real sidecar. A result above 8,192 bytes rejects admission, so
    clocking cannot discover an undeferrable oversize sidecar. After successful
    source expansion the target promise no longer exists; optional-probe and
    deferred required-probe cascades void dependent materialisation entries and
    retain evidence on the source-bound target group without recreating or
    mutating a promise.

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

- K2 grows exact-source resolution, destination probe, no-clobber
  materialisation, gate-facing provenance, and cross-run carry-claim effects,
  plus the strict aggregate-verify branch. Its owned boundary expands to the
  additive embedded/server Beads carry CAS and tests, but the unit state
  machine remains unchanged and the reducer stays pure.
- The manifest schema rejects unsafe patterns and `sidecarRequired: false`.
- Filesystems without the no-clobber primitive are unsupported in version 1;
  no weaker fallback is advertised.
- K6 records disposable-directory behavior. A real Drive write still requires
  separate authority and stays in the release tier before the next tag.

## Follow-up

- `sce-7g9.2`: implement and verify the amended K2 contract.
- `sce-7g9.3`: complete provenance projection and provenance Git execution on
  the stable K2 wire shapes.
