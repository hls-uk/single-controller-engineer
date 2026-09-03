# Knowledge contract

The knowledge profile adds five invariants to the controller contract and
changes no state legality. The reducer decides which transitions and effects
are legal; the profile decides meaning. Read
[the controller contract](../../single-controller-engineer/references/controller-contract.md)
first; everything there applies unchanged.

## Invariants

1. **One canonical home per artifact.** Every artifact a unit touches has one
   editable home declared in the manifest. Owned paths are Git paths. Drive
   paths are read-only sources for authors and write destinations only for the
   materialise adapter. A unit that would create a second editable copy is
   defective at planning time.
2. **Drive is outside the fence.** Worktrees, reservations, and the merge slot
   protect Git only. No worker, reviewer, or controller session writes a Drive
   path directly. Drive writes are typed `materialise` effects whose intent
   journals the exact artifact and sidecar names; the adapter publishes an
   ordered pair of atomic no-clobber hard links and records a strict readback.
   An existing destination with different bytes is ambiguous and blocks; it is
   never overwritten.
3. **Provenance is a projection, not prose.** Each landed unit's record is
   generated deterministically from validated closure evidence, journaled gate
   observations, and the named run inputs. A controller never types one.
4. **The profile never changes state legality.** A knowledge need that cannot
   be expressed without a new transition or effect gains that transition for
   every profile, by decision record.
5. **The access domain is the repository.** A unit never spans domains. The
   boundary is the manifest's path and marker policy, enforced by the fast
   gate and by review, never by an agent remembering the rule.

## The contract the engine records

The engine learns about a knowledge repository through one validated input:
an optional **knowledge contract** in the controller configuration, composed
from the manifest and parsed by the same strict parser as the rest of the
configuration. It records:

- `projectId`, `domainScope` (the access-domain identifier), and `audience`,
  copied into every provenance record;
- the alias table: alias, marker file, mount policy (`required` or
  `optional`), the canonical absolute root, and the required version 1
  `namespaceControl: "exclusive"` assertion. Composition resolves each
  manifest mount-path variable exactly once into that root; alias names are
  unique and roots are pairwise disjoint, checked at composition and again
  when the reducer admits the contract;
- `humanDriver`, the person accountable for the domain;
- the provenance block: events directory, generated directory, record format
  version, rollup generator argv, reproducibility argv, and the worktree-root
  environment variable resolved into `provenanceWorktreeRoot`, which may not
  overlap any alias root;
- `combinedVerificationCommands`: the manifest's `fast` argv vectors followed
  by its `integration` vectors, byte for byte; `release` stays outside a run;
- `gateTargets`: repository-level materialisation targets that run after the
  provenance commit is verified.

Environment values are the sole host-path authority. The reducer sees only
the recorded resolved roots and records the contract at `wave_planned`; a
later wave, hydration, or recovery that presents a different contract is
refused before any effect. A run without a contract is a software run: it
creates no promise, probe, provenance entry, or gate target.

## Executable commands

Every command in the contract is an argv vector executed without a shell: one
to 32 nonempty arguments, each at most 1,024 UTF-8 bytes of canonical Unicode
scalar text with no NUL. The aggregate verification set has at most 32
vectors and 32,768 canonical bytes. Ordering and byte-exact equality are part
of the recorded contract; the reducer admits an aggregate verify intent only
when its commands equal the recorded set.

## What the controller may never supply from memory

A resolved source path, blob digest, destination name, clock, physical
destination identity, provenance base, or collision decision. Each enters the
run only as a validated observation of a journaled effect, or as a
reducer-derived fact from such observations.
