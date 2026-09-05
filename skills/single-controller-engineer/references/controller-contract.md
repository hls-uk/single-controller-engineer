# Controller contract

The controller is the only tracker writer and integration actor. It owns one
run/incarnation identity, the repository-wide slot, the active authority
profile, resource reservations, candidate queue, and final severity decision.
Workers and reviewers return bounded results; they never claim/close Beads,
publish branches, resolve shared conflicts, or integrate.

Before any effect, prove the Git common directory/object format, integration
branch/head, Beads topology/store identity/prefix, controller holder, and
applicable remote. Persist intent, perform one exact act, then persist a strict
readback. A crash between act and observation enters recovery; elapsed time,
PID guesses, or an empty queue never prove completion or permit replay.

Create work only beneath the durable epic. A valid unit has acceptance IDs,
dependencies, owned paths, conflict domains, reservations, mandatory
verification, risk, and an exact base. Do not treat slot artefacts (`gt:slot`)
as work. Only positively independent, dependency-ready units may share a wave;
the maximum is three modifying workhorse sessions.

Bind review and integration to the exact current base/head pair. A moved base,
conflict resolution, failed qualification, or changed candidate invalidates the
relevant review. Preserve evidence and stop on ambiguous external state;
request authority rather than retrying a potentially duplicated effect.

Integrate one accepted candidate at a time with the repository's protected
fast-forward/CAS or merge-queue contract. Re-read remote base and candidate
immediately before submission and the landed object afterward. Never force
Git, reset someone else's state, repair Dolt destructively, or interpret local
cleanliness as remote success.

Put a substantive human/controller decision with the source in the repository's
decision-record convention (`wiki/decisions` if none exists). Record only the
decision link and execution state in Beads; keep protocol intent/result facts
in the runtime journal. Do not substitute a transcript for any of these.

## Synchronization after each update

Remote synchronization is part of completing each coherent, validated work
unit or controlled tracker write batch, not each file save. Do not defer it
until session end. The controller alone owns synchronization; workers return
their scoped candidates for review and serialized integration.

1. Establish the adopting repository's authority, intended Git branch/remote,
   and Beads topology. Existing explicit repository or user authorization
   covers routine commits and sync without renewed approval. This skill does
   not grant missing authority: honor `local-only`, `no-commit`, `no-push`, and
   narrower scope, and request only the authority still needed. Do not create
   a remote or change topology to satisfy the sync requirement.
2. Before starting work, refresh the configured Git remote and authoritative
   Beads state using the selected topology's procedure. Reconcile upstream
   changes without overwriting unrelated or concurrent work; a failed refresh
   is not evidence of an empty or current queue.
3. After each work unit, run its required gates and exact-candidate review,
   inspect the diff for scope and secrets, stage only owned paths, and commit.
   Reconcile upstream changes through the repository's protected integration
   contract, requalifying a changed candidate as required. Push without force
   to the authorized target and independently verify the landed commit there.
   Knowledge work includes its required provenance commits and wave gates;
   synchronization never bypasses materialisation or audience boundaries.
4. After each controlled Beads update, complete the verified topology's durable
   write and readback. For embedded `git-sync`, pull before the batch, commit
   the controlled batch, use `bd dolt push`, and read back the remote state as
   [the embedded reference](beads-embedded.md) requires. For shared-server
   mode, verify the committed update on the authoritative server under
   [the server contract](beads-server.md); do not run embedded push/pull there.
   A Git push or JSONL export never substitutes for Beads synchronization.
5. Record both Git and Beads readbacks before reporting the update complete or
   moving to the next unit. For an explicitly local-only scope, report local
   completion and the remote-sync exemption without implying remote delivery.
   If required sync fails, stop the affected path, preserve local state, and
   report the exact command/error and unsynced work. Never force, reset,
   overwrite concurrent edits, or blindly retry an ambiguous effect.

Use the packaged CLI only after explicit preflight. Installation is an explicit
paired operation; npm never mutates a host skill directory during postinstall.
