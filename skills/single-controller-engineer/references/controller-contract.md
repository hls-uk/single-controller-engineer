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

Use the packaged CLI only after explicit preflight. Installation is an explicit
paired operation; npm never mutates a host skill directory during postinstall.
