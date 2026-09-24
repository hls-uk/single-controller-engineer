---
name: single-controller-engineer
description: Deliver a bounded software beta through one controller, deterministic protocol checks, isolated workhorse lanes, and serialized frontier review. Use for software delivery in a repository with a test suite and Beads task tracking; not for unapproved publication or external mutations.
---

<!-- sce-skill-version: 0.1.0 -->

# Single-controller engineering

Use this loop to deliver a bounded, working beta. It does not grant authority
to publish, force Git, repair Git/Dolt destructively, administer a provider, or
send feedback.

## Start or resume

1. Read repository agent instructions, its normative design/plan, and its
   source-controlled decision index. The repository's stronger policy wins.
   If the repository root declares `knowledge-manifest.json`, stop: it is a
   knowledge repository; use the sibling `single-controller-knowledge` skill,
   which applies that material's contract and severity table.
2. Load authoritative Beads state (`bd prime`, then structured `bd show` or
   `bd ready`). A controller-slot artifact or issue labelled `gt:slot` is a
   lock, never user work.
3. Run pure preflight and select exactly one topology reference below. Do not
   infer topology, repository identity, a controller holder, or remote state.
   For a repository's first run, compose the controller configuration with
   `sce compose-config --harness <family> --root-bead <epic> --output <abs>
--bind-slot --json` (it observes Git, Beads and the pinned executables,
   self-validates, binds the fresh merge slot, and prints the exact first
   `acquire-controller` request); reuse that document for the rest of the
   run rather than recomposing, which would change the holder.
4. State the promised core use cases and explicit non-goals. Classify known
   findings P0–P3 using the accelerated-beta reference.
5. Establish one controller. Only it writes Beads, holds the controller slot,
   grants external authority, freezes candidates, and integrates.

## Keep Git and Beads synchronized

After preflight, refresh Git and Beads before starting work. The controller
must sync each completed work unit or tracker update and verify the required
remote state before reporting completion or selecting the next unit. Follow
[the synchronization procedure](references/controller-contract.md#synchronization-after-each-update),
using existing repository/user authority without repeated approval requests.
Explicit `local-only`, `no-commit`, and `no-push` instructions still apply.
Never claim or assign a projected child bead: the pinned row shape admits the
assignee column a claim writes, but a claim landing inside an uncommitted
checkpoint batch is still refused as an unintended write and the run blocks
until the working set is reconciled.

## Plan deterministically

The controller creates or resumes one epic and dependency-linked children.
Each implementation child must have bounded acceptance identifiers,
dependencies, owned paths, conflict domains, resource reservations, mandatory
verification, and risk. Missing independence proof forces a singleton.

Use schemas, reducers, manifests, hashes, exact Git/Beads observations, and
allowlisted adapters for closed-input facts. Use model judgment for
decomposition, implementation, diagnosis, qualitative acceptance, and
adversarial review. Never ask a model to remember a fact that a deterministic
readback can establish.

## Execute the beta loop

1. Select one to three dependency-ready, genuinely independent children.
2. Reserve shared resources, cut isolated worktrees from one verified base,
   and generate exact worker packets with the vendored `sce harness-packet`
   command. A fresh worktree has no installed dependencies, so each lane's
   first step is a gitignored link to the integration checkout's installed
   tree (or an `npm ci` from the committed lock) that it leaves in place: the
   controller qualifies a candidate by running the packet's
   `mandatoryVerification` inside that same worktree.
3. Refresh any unit whose base is behind the integration head before its first
   dispatch: with no commits on the unit branch the refresh fast-forwards it
   and its worktree, so the packet binds the base the worker starts on. Then
   dispatch workhorse models only. Workers edit their owned scope and run the
   focused fast gate; they do not write Beads, publish, or integrate. A
   manual launch is acknowledged, never retried: the dispatch (or repair)
   request persists the intent and prints a launch tool request, the
   controller launches by hand, and `record-dispatch` settles that intent
   with a `launch_inspected` acknowledgement for the inspected session.
   `next` and `status` stay read-only meanwhile — they do not act on the
   outstanding launch and journal nothing for it, so they leave it intended
   and report it — and need no sequencing around it.
4. The controller collects and observes Git/test facts, rebases or otherwise
   updates one candidate using the repository's permitted non-force strategy,
   and freezes its exact base/head/tree.
5. Generate a reviewer packet and launch a fresh read-only frontier session.
   The reviewer reproduces the frozen diff with the packet's
   `candidateDiffCommand` and turns those exact bytes into the packet's
   `candidateDiffHash` with `sce candidate-digest`; a plain checksum of the
   same bytes is a different value. Batch P0/P1 repairs in the same workhorse
   lane, then freeze and re-review the changed object. Record bounded P2/P3
   follow-up instead of widening the wave.
6. Re-read the exact pair, integrate it under the repository's CAS/protected
   contract from a clean integration checkout — a dirty non-passive working
   tree there is a named refusal that leaves the unit approved for the same
   intent, and only bd's passive `.beads/*.jsonl` exports may be modified —
   record the result in Beads, then qualify the next candidate.
7. After the wave lands, run interaction-sensitive fast/affected integration
   evidence before selecting another wave.

Requested and returned model identities must match the pinned support map. An
unavailable tier, unreadable identity, or downgrade blocks that action; never
silently substitute a model. Three is a cap, not a target.

Run the adopting repository's declared fast command during implementation
(this package uses `npm run test:fast`); invoke affected integration smokes
explicitly; reserve its full release command for tagged-release evidence. Never
put slow topology, crash, provider, or live-agent evidence into the fast gate.
Publication, tagging, pushing, issue submission, and other external mutation
require current explicit authority; an applicable standing repository/user
grant is sufficient for routine Git and Beads sync.

Record substantive controller decisions in the adopting repository's
source-controlled decision records (use `wiki/decisions` when no established
convention exists); Beads tracks execution, not duplicated decision rationale.
Keep exact candidate IDs, gates, P0/P1 disposition, landed IDs, deferred P2/P3,
and blockers compactly in Beads. Machine side-effect intent/observations belong
in the runtime journal, not prose.

Stop on missing authority, secret/privacy risk, ambiguous topology or
side-effect state, moved reviewed objects, unsafe controller ownership, or a
scope-changing decision. A beta is done when its public core paths work, the
fast and affected integration gates pass, no promised-path P0/P1 remains, the
fresh frontier review accepts the frozen candidate, artifacts agree, and Git
plus Beads are clean and read back from their authoritative remotes.

Read [the controller contract](references/controller-contract.md) for fencing,
Beads ownership, recovery, and stop conditions. Read
[the accelerated-beta reference](references/accelerated-beta.md) for tier
selection, severity, and compact evidence. For an explicit upstream report,
route to the sibling `single-controller-feedback` skill; do not create an
issue merely because a failure was observed.

Read [model routing](references/model-routing.md) immediately before dispatch.
Read [protocol state](references/protocol-state.md) for recovery, intent, and
exact-pair review/integration. After preflight, read exactly one topology
reference: [embedded Beads](references/beads-embedded.md) for local Dolt/Git
sync, or [shared-server Beads](references/beads-server.md) for server mode.
