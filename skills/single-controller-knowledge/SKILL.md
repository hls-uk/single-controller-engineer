---
name: single-controller-knowledge
description: Run the single-controller loop for a knowledge repository, a Git domain repository with a knowledge-manifest.json, Beads task cards, deterministic provenance records, and partnered Drive materialisation. Use for knowledge work in a repository that declares a manifest; not for unapproved publication, Drive overwrites, or external mutations.
---

<!-- sce-skill-version: 0.1.0 -->

# Single-controller knowledge

Use this loop to deliver bounded knowledge work in one access-domain
repository. It grants no authority to publish, force Git, overwrite or delete
anything on a partnered Drive, repair Git/Dolt destructively, administer a
provider, or send feedback.

## Start or resume

1. Read the repository's agent instructions and its `knowledge-manifest.json`
   at the repository root. If no manifest exists, stop: this repository is not
   a knowledge repository; use the sibling `single-controller-engineer` skill.
2. Validate the manifest with the shipped template
   (`references/manifest/checks/validate-manifest.mjs`), then compose the
   knowledge contract exactly as [the knowledge contract](references/knowledge-contract.md)
   describes: alias roots and the provenance worktree root come only from the
   named environment variables; the contract is recorded at `wave_planned`.
3. Load authoritative Beads state (`bd prime`, then structured `bd show` or
   `bd ready`). The merge slot bead is a lock, never user work.
4. Run pure preflight with the shared runtime,
   `../single-controller-engineer/scripts/sce.mjs`, and select exactly one
   topology reference below. Do not infer topology, repository identity, a
   controller holder, mounts, or remote state.
5. State the promised outcome and explicit non-goals in the driver's terms.
   Classify known findings with [the knowledge severity table](references/knowledge-severity.md).
6. Establish one controller. Only it writes Beads, holds the controller slot,
   grants authority, freezes candidates, materialises, and integrates.

## Plan deterministically

Every task card is a child Bead with acceptance identifiers, dependencies,
owned Markdown paths, conflict domains, reservations, mandatory verification,
risk, priority, and independence, plus the optional `materialisationTargets`,
`supersedes`, and `tombstones` facts described in
[the repository manifest reference](references/repository-manifest.md). Owned
paths are Git paths inside the allowed write roots; Drive paths, other
domains, the events and generated directories, and Beads are never owned.
Manifest, boundary, instruction, and shared-skill changes are singleton waves.

## Execute the knowledge loop

1. Select one to three dependency-ready, independent task cards.
2. Reserve shared resources, cut isolated worktrees from one verified base,
   and generate exact author packets with `sce harness-packet`; the packet
   names the read-only source list and the prohibited scope.
3. Dispatch workhorse authors only. Authors write Markdown in their worktree
   and run the declared fast gate; they never publish, materialise, run `bd`,
   or edit provenance.
4. Collect only a clean committed head with expected-base ancestry and a
   scoped diff. Verification is the manifest's declared fast commands bound
   to the candidate tree; never invent a check.
5. Freeze the candidate and launch a fresh read-only frontier review with the
   knowledge reviewer charge: boundary leakage, contradiction without
   supersession, provenance and supersession errors, unsupported claims,
   audience fit, then style. Repair only confirmed P0/P1 in the same lane.
6. Integrate one accepted candidate at a time through the repository's
   fast-forward or non-force push contract and read it back.
7. Materialise and record provenance only through the typed gate effects:
   resolve sources, probe destinations, observe the clock, publish the
   sidecar and artifact with the no-clobber adapter, then commit the
   projected records. Read [materialisation](references/materialisation.md)
   and [provenance](references/provenance.md) before the wave gate.
8. The wave is green only when every promise, probe, entry, provenance
   commit, and aggregate verification is observed or voided and reservations
   are released. Defer a refused entry to a follow-up Bead; never retry an
   ambiguous effect blindly.

Requested and returned model identities must match the pinned support map;
never silently substitute a model. Three lanes is a cap, not a target.

Record substantive controller decisions in the repository's decision records;
Beads tracks execution. Keep exact candidate IDs, gates, dispositions, landed
IDs, materialised destinations, provenance commit IDs, and blockers compactly
in Beads.

Stop, in plain language for the human driver, on: a missing manifest or
mount, missing authority, a secret or audience-boundary risk, an ambiguous
Drive or Git state, a moved reviewed object, a deferred provenance commit
that needs a repair decision, or a scope-changing decision. Say what was
started, what could not be confirmed, and the one action that resolves it.

Read [the controller contract](../single-controller-engineer/references/controller-contract.md)
for fencing, Beads ownership, recovery, and stop conditions, and
[the accelerated-beta reference](../single-controller-engineer/references/accelerated-beta.md)
for tier selection and compact evidence. Read
[model routing](../single-controller-engineer/references/model-routing.md)
immediately before dispatch and
[protocol state](../single-controller-engineer/references/protocol-state.md)
for recovery, intent, and exact-pair review and integration. After preflight,
read exactly one topology reference:
[embedded Beads](../single-controller-engineer/references/beads-embedded.md)
for local Dolt with Git-remote sync, or
[shared-server Beads](../single-controller-engineer/references/beads-server.md)
for server mode. For an explicit upstream report, route to the sibling
`single-controller-feedback` skill.
