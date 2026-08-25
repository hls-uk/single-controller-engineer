---
name: single-controller-engineer
description: Deliver a bounded software beta through one controller, deterministic protocol checks, isolated workhorse lanes, and serialized frontier review. Use for repository engineering work tracked in Beads; not for unapproved publication or external mutations.
---

<!-- sce-skill-version: 0.1.0 -->

# Single-controller engineering

Use this loop to deliver a bounded, working beta. It does not grant authority
to publish, force Git, repair Git/Dolt destructively, administer a provider, or
send feedback.

## Start or resume

1. Read repository agent instructions, its normative design/plan, and its
   source-controlled decision index. The repository's stronger policy wins.
2. Load authoritative Beads state (`bd prime`, then structured `bd show` or
   `bd ready`). A controller-slot artifact or issue labelled `gt:slot` is a
   lock, never user work.
3. Run pure preflight and select exactly one topology reference below. Do not
   infer topology, repository identity, a controller holder, or remote state.
4. State the promised core use cases and explicit non-goals. Classify known
   findings P0–P3 using the accelerated-beta reference.
5. Establish one controller. Only it writes Beads, holds the controller slot,
   grants external authority, freezes candidates, and integrates.

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
   command.
3. Dispatch workhorse models only. Workers edit their owned scope and run the
   focused fast gate; they do not write Beads, publish, or integrate.
4. The controller collects and observes Git/test facts, rebases or otherwise
   updates one candidate using the repository's permitted non-force strategy,
   and freezes its exact base/head/tree.
5. Generate a reviewer packet and launch a fresh read-only frontier session.
   Batch P0/P1 repairs in the same workhorse lane, then freeze and re-review the
   changed object. Record bounded P2/P3 follow-up instead of widening the wave.
6. Re-read the exact pair, integrate it under the repository's CAS/protected
   contract, record the result in Beads, then qualify the next candidate.
7. After the wave lands, run interaction-sensitive fast/affected integration
   evidence before selecting another wave.

Requested and returned model identities must match the pinned support map. An
unavailable tier, unreadable identity, or downgrade blocks that action; never
silently substitute a model. Three is a cap, not a target.

Run `npm run test:fast` during implementation; invoke affected integration
smokes explicitly; reserve `npm run test:release` for tagged-release evidence.
Never put slow topology, crash, provider, or live-agent evidence into the fast
gate. Publication, tagging, pushing, issue submission, and other external
mutation require current explicit authority.

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
