# DEC-20260922-018: Publication binds to the admitted directory object

Date: 2026-09-22. Status: accepted. Controller: the single-controller-engineer
dogfood run on this repository (root sce-7g9). Amends the publication section
of [DEC-20260903-012](2026-09-03-012-materialisation-source-and-no-clobber.md).

## Context

Frontier review of DEC-20260903-012 recorded that the inode-bound Node helper
"detects but cannot prevent" another same-user process or a Drive sync client
from renaming the admitted destination directory through its parent during
publication, and that version 1 therefore requires exclusive namespace control
and records post-act drift as ambiguous. This unit was asked to find a stronger
primitive, define its support boundary, or prove the boundary honestly.

Two experiments on darwin 24.6.0 (Node 23) settled it.

The first tested the primitive the review proposed: hold the admitted directory
open and publish through the descriptor path, `/dev/fd/<fd>/<basename>` on
darwin and `/proc/self/fd/<fd>/<basename>` on linux. **It does not exist on
darwin.** A directory descriptor's `/dev/fd/<fd>` entry is not a traversable
directory there: `readdir` returns `ENOTDIR` and every `<fd>/<basename>` lookup
returns `ENOENT`, before and after any rename. Whatever `/proc/self/fd` may
offer on linux — untested here, and follow-up below — a primitive absent on the
only platform with recorded release evidence cannot be the load-bearing
mechanism.

The second tested what the adapter already does. The helper runs with the
admitted directory as its working directory and addresses every final and
temporary by basename. POSIX resolves a relative path through the kernel's open
reference to the working directory, not through that directory's name, so an
ancestor rename cannot redirect it. Measured directly: with the parent renamed
between the helper's identity check and its `link`, the file landed in the held
inode and a second `link` returned `EEXIST`; with the directory swapped for a
fresh sibling of the same name, the file landed in the admitted inode and the
substitute stayed empty. **The publication syscall was already identity-bound.
What version 1 lacked was a sound proof of that binding.**

The proof it used was unsound in both directions. `realpath(".")` is a path
string: under a benign ancestor rename on darwin it *throws* `ENOENT`, and
under a directory swap it *succeeds* while naming a different inode. The first
is a live defect. Under an ancestor rename the helper published the sidecar
correctly, then threw inside its post-act check, abandoned the artifact, and
reported the whole act ambiguous — leaving the destination in the half-
published state that discovery reports as `absent`. A correct, no-clobber,
identity-bound publication was reported as drift, and every publication
concurrent with any ancestor rename behaved this way.

## Decision

1. **The unit of admission is the directory object, not the path string.** The
   helper opens `.` once, holds that descriptor for the life of the call, and
   proves the binding with `fstat` on it, which no namespace change can
   invalidate, plus `stat(".")` equality to prove the working directory still
   denotes that same object. The `realpath` comparison and the
   `metadata.realpath` field are removed: a path string is admission evidence,
   never publication evidence. Every directory `fsync` goes through the held
   descriptor rather than reopening `.`.
2. **The support boundary is explicit and fails closed.** The binding is a
   property of POSIX working-directory semantics, so the mutating port admits
   only platforms with recorded release evidence for it — `darwin` and `linux`.
   Anywhere else, notably `win32` whose working directory is a re-resolved path
   string, `materialise` blocks before any Git read, any subprocess, and any
   write. The read-only discovery and probe ports stay available everywhere, so
   recovery can still read a published pair on any platform. Widening the set
   requires new evidence, not a new assumption.
3. **Nothing else moves.** The reducer stays pure, the intent-before-effect
   journal is unchanged, publication stays `O_EXCL` temporary plus no-clobber
   hard link with `EEXIST` readback, helper operations stay basename-only, and
   the positive-evidence rules are untouched. No runtime dependency is added.

The consequence for the authority model is narrow and stated deliberately:
version 1 required exclusive namespace control because it could not prove the
act was bound. It is bound, and now proved bound, so an ancestor rename
concurrent with a publication is a positive `published` observation rather than
ambiguity. Exclusive namespace control remains required for everything the
binding does not cover — pre-act admission, containment, and the marker — and a
destination that stays relocated still refuses admission on the next act.

## Rejected alternatives

- **Descriptor-path publication.** `/dev/fd/<fd>/<basename>`: measured
  unavailable on darwin (above). A primitive that silently degrades to the
  weaker path on the only platform with release evidence is worse than the
  binding already in hand.
- **A dedicated refusal code for an unsupported platform.** `MaterialiseRefusal`
  admits exactly `source_absent` and `hard_links_unsupported`, and both are
  consumed by the reducer. Minting a third code is a protocol-vocabulary change
  outside this unit, so the gate uses the blocking ambiguous observation the
  adjacent `namespaceControl` precondition already uses. Ambiguous blocks and is
  never guessed through, so this is fail-closed today; a distinct code is
  follow-up, not a correctness gap.
- **Dropping the post-act identity checks.** Once the binding is a proved
  precondition the checks cannot fail, but readback after every act is the
  house discipline and the checks are now sound and free. They stay.
- **Widening the platform set to every POSIX name.** No evidence, no admission.

## Consequences

- Deterministic tests in `test/adapters/materialise/namespace-binding.test.ts`
  interfere exactly once, between the helper's identity check and its
  publication syscall, so the whole remainder of the call runs in the relocated
  namespace: same-user ancestor rename, sync-client-style directory swap with a
  foreign final of the same name left untouched in the substitute, durable
  relocation still blocking the next admission, the unsupported-platform gate
  running no subprocess and writing nothing, and read-only discovery surviving
  it. The first and fourth fail against the previous adapter.
- Those tests are discovered by the release tier; `scripts/test-tier.mjs` scopes
  the integration tier to `test/integration`. The existing integration
  publication suite covers the seam they extend and passes unchanged.
- Real mounted-Drive provider evidence remains a separate release gate under
  its own authority (bead `sce-40r`, `SCE_RELEASE_DRIVE_ROOT`); this decision
  does not discharge it.
- Recorded as bead `sce-7g9.2.2`.

## Follow-up

- A distinct `MaterialiseRefusal` code for an unsupported publication platform,
  so the outcome is a decided refusal rather than a blocking ambiguity.
- Re-run the descriptor-path experiment on linux when linux release evidence is
  first recorded, and note in this record whether `/proc/self/fd` would add
  anything over the working-directory binding there.
