# Single-Controller Engineer

**Date:** 2026-08-24
**Status:** Reviewed twice and amended
**Seed:** `../../incept5/beta-factory/agents/skills/controlled-bootstrap-development`
**Delivery companion:**
[Accelerated Beta Engineering](2026-08-25-accelerated-beta-engineering.md)
**Controller decisions:** [Decision records](../decisions/README.md)

The delivery companion is normative for beta cadence, test tiers, review
frequency, and severity-based acceptance. This document remains authoritative
for architecture, authority, privacy, secrets, fencing, integration safety,
and topology correctness.

Two independent fresh-agent reviews were completed on 2026-08-24. Their
supported findings are incorporated below. The first drove the repository-wide
controller fence, durable Dolt checkpoints, integration compare-and-swap,
crash-consistent protocol states, honest worker-isolation boundary, and
executable test layers. The second tightened the repository-run aggregate,
effect and model-judgment schemas, harness recovery contract, topology-specific
fences, provider integration profiles, installation and publication boundary,
and feedback privacy, outbox, deduplication, and triage protocols.

## Decision summary

This repository will ship one primary agent skill, `single-controller-engineer`,
plus a narrow `single-controller-feedback` companion interface. The primary
skill delivers software through one decision-making controller, a Beads-backed
work queue, and fresh bounded implementation and review agents.

The skill is backed by a TypeScript/Node.js executable protocol engine. A pure,
typed state reducer plus runtime-validated schemas is the authoritative
controller contract. Code owns every closed-input protocol act; models are
used only for product decomposition, implementation, semantic diagnosis,
conflict resolution, and adversarial review. The same compiled runtime is
vendored with the skill and published as an npm CLI.

The controller may fan out a wave of up to three independent implementation
agents. Implementation runs in parallel; qualification and integration run
against the current integration head in a serialized queue. The controller is
the only actor that mutates Beads, publishes work, or integrates it.

A root issue claim is scope ownership, not the single-controller fence. Before
dispatch, the run must acquire and read back a repository-wide controller slot
scoped to immutable Beads-store identity, Git-repository identity, and the
integration branch.
Before integration, the repository's integration mechanism must also enforce
the reviewed base/head pair with a protected compare-and-swap or equivalent.

The skill supports both Beads storage topologies:

- embedded Dolt with cross-clone synchronization through the Git remote; and
- a shared Dolt SQL server.

Storage topology changes synchronization mechanics, not ownership: workers do
not become tracker writers in server mode. The skill detects and proves the
topology before work starts and never silently switches or repairs it.

Model routing is capability-based. The controller and independent reviewers
use a frontier tier, while implementation and ordinary diagnosis use a
workhorse tier. Fable/Sol and Opus/Terra are current examples, not permanent
names in the contract.

A structured feedback path lets consuming agents prepare and, when authorized,
submit bugs and enhancement requests to this GitHub repository. Feedback
separates controlled telemetry from user-reviewed narrative, uses stable
fingerprinting and best-effort client deduplication, and has a durable local
outbox when external mutation is unavailable.

## Context

The controlled-bootstrap-development skill in beta-factory has a strong safety
spine:

- one controller owns sequence and fixed-answer protocol acts;
- preserve and inventory existing work before mutation;
- bind one issue, branch, worktree, and review identity to each change;
- use fresh bounded implementation and review sessions;
- verify and review exact Git objects, not agent assertions;
- integrate through one protected authority and read the result back; and
- keep durable evidence sufficient to resume after context loss.

That seed is intentionally specific to beta-factory. Its fleet census, hub
leases, release trains, canaries, protocol epochs, and fixed model names are not
generic software-delivery requirements. This design retains the safety spine
without importing that control plane into adopting repositories.

The sibling `software-factory` repository already supplies a broad engineering
method spanning requirements, architecture, planning, delivery profiles,
vendor gates, host fleets, and publication. This repository has a narrower
purpose: one compact orchestration skill that accepts a concrete outcome or
existing plan and drives its engineering work to evidence-backed completion.

## Goals

1. Let one controller deliver a multi-issue software outcome using fresh
   implementation and review agents.
2. Allow two or three independent implementation agents to work concurrently
   without creating multiple schedulers or integration authorities.
3. Make Beads the durable queue, dependency graph, ownership record, and
   evidence ledger.
4. Work correctly with embedded Git-synchronized Dolt and shared-server Dolt.
5. Survive controller compaction or restart through a crash-consistent,
   idempotent state machine recorded in Beads, Git, worktrees, pull requests,
   and exact readbacks rather than conversation history.
6. Adapt to the adopting repository's branch, test, review, documentation, and
   authority conventions.
7. Keep the installed skills small through progressive disclosure while the
   typed runtime owns topology, preflight, protocol, evidence, and recovery.
8. Put scheduling, transition legality, evidence binding, prompt construction,
   recovery, and feedback packet generation in typed deterministic code.
9. Publish the executable CLI to npm from GitHub Actions with short-lived OIDC
   authentication and provenance, while keeping GitHub skill installation
   self-contained and offline at runtime.
10. Give consuming agents a safe upstream GitHub Issues feedback loop without
    collecting source code, secrets, or arbitrary logs.

## Non-goals

- A requirements, architecture, or product-management methodology.
- Multiple simultaneous controllers or automatic controller takeover.
- A persistent autonomous fleet, daemon, hub, or remote-host scheduler.
- Provisioning or administering a shared Dolt service.
- Migrating, force-repairing, or changing an existing Beads topology.
- Deploying, releasing, publishing, or changing external services without
  authority supplied by the user or adopting repository.
- Pinning permanent product/model names or silently substituting weaker models.
- Teaching the full Beads CLI when `bd prime` and current CLI help are the
  authoritative command references.
- Claiming support for untested Beads modes, CLI schemas, or agent harnesses.
- Automatically filing external issues without current or pre-authorized
  external-write authority.
- Treating TypeScript's erased compile-time types as validation of untrusted
  Git, Beads, harness, GitHub, configuration, or feedback input.

## Core invariants

### One controller

One frontier controller owns:

- decomposition and wave formation;
- Beads creation, claims, dependencies, notes, and closure;
- branch and worktree creation;
- worker and reviewer dispatch;
- verification gates and retry decisions;
- publication, pull requests, integration, and readback; and
- the durable current-state and evidence record.

Ownership is authority and accountability, not a request for the model to
perform mechanics. The typed runtime executes fixed-answer Beads, Git, state,
packet, publication, and readback operations on the controller's behalf.

Implementation and review agents are bounded evidence producers, not
controllers. They do not create or close issues, alter dependencies, publish
branches, open or merge pull requests, or mutate the integration branch.

The controller uses a unique run identity as its tracker actor/holder, not only
as metadata. It must hold a repository-wide controller slot independent of the
requested root Bead: another controller working a different root could
otherwise integrate concurrently, and two sessions using the same default
actor could both appear to own one claim. The root Bead is also atomically
claimed, but that claim binds objective scope rather than repository-wide
exclusivity. Version 1 does not infer that an old controller is dead or
automatically steal its slot; takeover requires positive evidence and explicit
authority.

### One identity per causal unit

Every independently owned change has exactly one:

- child Bead with acceptance criteria;
- branch;
- worktree;
- implementation lineage; and
- pull request or repository-native integration record, when the repository
  uses one.

Corrections, conflict resolution, and review rework remain on that identity.
They do not create replacement branches or recovery issue graphs. Independent
discoveries become separate Beads and are linked into the dependency graph.

### Positive evidence

The controller decides on facts it can read back:

- exact local and remote OIDs;
- exact Beads database identity, mode, Dolt head, and working-set state;
- repository-wide controller-slot holder and durable acquisition readback;
- atomic issue ownership;
- test commands, exit results, and relevant tool/environment identity bound to
  a clean committed tree;
- review verdict bound to exact base and head OIDs;
- remote branch or pull-request head and base readback immediately before
  integration submission;
- integration compare-and-swap or protected-queue result; and
- landed integration OID and delta.

Missing, contradictory, or unreadable evidence closes the relevant gate. It is
never converted into success by prose or inference.

### Preserve before mutation

Before starting or resuming, inventory the relevant worktrees, dirty and
untracked bytes, branches, remote candidate refs, open pull requests, and
in-progress Beads. Preserve unrelated and ambiguously owned work in place.
Never reset, delete, force-push, close, or relocate uncertain artifacts merely
because their names resemble the current unit.

## Deterministic versus inference contract

The stable boundary is: models decide meaning; code decides state. If an
operation has closed inputs and outputs, repeats across units, protects shared
state, or can be verified mechanically, the runtime performs it rather than
prompting an agent to remember it.

| Concern | Deterministic runtime | Model judgment |
|---|---|---|
| Queue | Dependencies, readiness, claims, priorities, state | Initial decomposition and acceptance quality |
| Parallelism | Cap, graph conflicts, path/domain/resource exclusion | Declaring semantic conflict domains during decomposition |
| Git | Worktrees, refs, OIDs, cleanliness, ancestry, publish and CAS | Semantic conflict resolution |
| Beads | Topology, commits, synchronization, rows, checkpoints | Product rationale and discovered work |
| Models | Tier mapping, availability, requested/returned identity | Implementation and review reasoning |
| Verification | Commands, exit status, tree binding, cache keys | Proposing extra relevant tests or interpreting qualitative evidence |
| Review | Exact packet, hashes, schema, verdict binding | Finding semantic, security, and architecture defects |
| Recovery | Intent/result states, discovery, idempotency, readback | Diagnosis only when observed evidence changed |
| Completion | Criteria-to-landed-evidence mapping and mechanical gates | Explicitly qualitative acceptance decisions |

### Typed protocol engine

The controller runtime is TypeScript compiled for a supported active Node.js
release. Runtime schemas, not bare TypeScript interfaces, validate every
external boundary and are the source for inferred internal types. Protocol
state is a discriminated union; transition handling uses exhaustive switches
that fail compilation when a state or event is unhandled.

The core is a pure reducer:

```text
reduce(validated_state, validated_event)
  -> { next_state, effects }
```

The reducer never shells out, reads environment variables, starts agents, or
calls GitHub. Adapters execute its typed effects against Git, Beads, the
selected harness, and GitHub, then return newly observed facts as validated
events. The reducer is deterministic for the same state and event.

The reducer operates on one repository-run aggregate, not on independent child
records. The aggregate contains a monotonic revision, immutable store and Git
identities, controller fencing token, unit map, wave and qualification queues,
active modifying-session set, current reviewer, resource reservations,
authority profile, and effect journal. A transition is accepted only against
the expected aggregate revision. Its compare-and-set persistence and readback
therefore enforce at most three active modifying sessions and at most one unit
in final qualification, publication, or integration even if two CLI processes
are accidentally invoked for the same run.

Every non-pure operation has a journal entry:

```text
{ effect_id, idempotency_key, kind, params_hash,
  status: intended | observed | ambiguous,
  observation_hash?, schema_version }
```

The runtime persists the new aggregate revision and intended effect before an
adapter runs. It then records only a validated observation, or `ambiguous` when
the outcome cannot be proved. Time, UUIDs, capacity, filesystem state, and
provider state enter the reducer as observations; the reducer has no hidden
clock, random source, or mutable singleton. `blocked`, `failed`, `timed_out`,
`parked`, `cancelled`, repair, reservation release, and controller release are
first-class transitions rather than prose-only exceptions.

External and persisted wire formats use strict TypeBox JSON Schemas and Ajv
validation, with `additionalProperties: false`, explicit byte/item limits, and
no implicit coercion or defaults. Canonical hashes use RFC 8785 JSON
canonicalization after field-specific Unicode normalization. Every envelope
has a schema name and version. Pure, fixture-tested upcasters may read an
explicitly supported prior version; unknown versions, keys, or lossy migrations
stop before mutation. Generated schemas and inferred TypeScript types come from
the same definitions and are bundled into the executable.

The CLI is an idempotent, stepwise protocol engine rather than a daemon. Its
top-level commands include:

```text
inspect                     acquire-controller
next                        plan-wave
prepare-wave                dispatch-request
record-dispatch             collect-candidate
qualify                     review-prepare
review-record               publish
integrate                   gate-wave
resume                      status
release-controller          feedback
```

`next --json` computes legal actions from authoritative Git and Beads facts;
the controller model does not infer the next state from conversation. Commands
persist intent before effects, reconcile idempotency keys on resume, and reject
illegal or stale transitions before mutation.

Schemas cover CLI input/output, configuration observations, persisted run,
unit, event, judgment, and effect envelopes, Beads metadata, Git and subprocess
observations, harness requests/acknowledgements/results, GitHub API and workflow
events, feedback packets, and outbox files. Adapter-specific raw data never
enters the reducer.

### Narrow harness seam

Each versioned harness adapter declares and tests these capabilities:
`launch`, `lookupByClientKey`, `inspect`, `poll`, `collect`, `cancel`, and
`returnedModelIdentity`. Where the adapter can execute an operation, the
runtime does so. Where the host exposes one or more operations only as model
tools, the runtime uses the same narrow request/acknowledgement seam for every
unavailable operation:

1. persist `dispatch_intent`;
2. emit the exact role, worktree, prompt file, model identifier, bound, and
   idempotency key;
3. let the frontier controller make that one tool call;
4. accept only a schema-valid acknowledgement; and
5. inspect and bind the session to the client key, prompt hash, worktree,
   requested model, returned model, role, and harness identity before recording
   the observation.

The controller does not rewrite the generated prompt, select a different
model, invent a worktree, or choose another protocol action at this seam.
Polling, collection, cancellation, and telemetry use separate persisted
intents and acknowledgements; a launch acknowledgement is not authority to
perform them.

Crash-safe dispatch is advertised only when `lookupByClientKey` can discover a
launch that completed before its acknowledgement was persisted. A harness
without that capability is explicitly classified
`at-most-once/manual-reconciliation`: an ambiguous launch blocks the unit,
preserves the worktree, and requires a human-bound session observation. It is
never blindly
redispatched or described as automatically recoverable.

### Typed model judgments

Models can supply meaning, but they cannot write arbitrary state. The protocol
accepts a closed `JudgmentEvent` union for decomposition, conflict-domain and
risk classification, additional-test selection, semantic conflict resolution,
qualitative acceptance, repair disposition, and reviewer verdict. Each event
carries the aggregate revision, schema version, role and session identity,
requested and returned model identities, prompt and response hashes, exact
fact or Git OID bindings, a bounded decision enum, and rationale.

The reducer validates the event's role, precondition, freshness, scope, and
evidence bindings. It cannot validate that a semantic judgment is true, and
the design does not claim otherwise. Invalid or stale judgments have no state
effect. Equal-priority ready units are packed deterministically by dependency
depth, risk ordering, priority, and finally stable Bead ID; database return
order never selects a wave.

### Machine-readable task and result contracts

Decomposition produces child Bead fields that the runtime validates before
wave formation: acceptance identifiers, dependencies, owned paths, conflict
domains, resource reservations, mandatory verification, and risk class. Code
packs ready units mechanically. Missing or ambiguous independence fields force
a singleton wave rather than another recurring inference call.

Implementation agents receive a compact generated packet containing exact
OIDs, criteria, scope, repository paths, mandatory verification, and a return
schema. They do not load this full design, the orchestration skill, controller
history, or unrelated Beads. One `WorkerResult` schema contains only semantic
status, bounded summary, residual risks, and suggested follow-up. Changed
files, commits, cleanliness, commands, results, and model telemetry are
adapter-observed `CandidateObservation` and `VerificationObservation` events;
worker claims about those facts are untrusted narrative and never gate state.

Frontier reviewers receive a deterministically generated and hashed packet
bound to exact base/head OIDs, criteria, scope, diff, verified commands, and
authoritative document paths. The verdict schema permits only approve or
request-changes plus actionable findings. The runtime rejects mismatched OIDs,
unknown verdicts, malformed findings, or approval after object movement.
Review runs against a read-only detached snapshot. Where the harness cannot
enforce that boundary, the runtime rechecks the candidate object and reruns a
pristine-tree gate after review; any movement invalidates the verdict.

### Token and throughput controls

- Load the full skill and topology reference only in the controller session.
- Give workers and reviewers generated packets and repository paths, not copied
  source, tracker history, or controller narration.
- Query Beads and Git as structured data and store compact metadata rather than
  repeatedly invoking a model to summarize them.
- Cache verification only by candidate tree, exact command, toolchain, and
  relevant environment fingerprint; any changed input invalidates it.
- Run candidate cleanliness, scope, and focused prequalification concurrently
  across isolated worktrees. Keep only current-base review and integration
  serialized.
- Send changed failure evidence on repair; never redispatch unchanged prose.

These controls reduce repeated context without removing the source, diff,
criteria, or test evidence needed for high-quality implementation and review.

## Roles and model tiers

| Role | Required tier | Current examples | Responsibilities |
|---|---|---|---|
| Controller | Frontier | Fable, Sol | Decomposition, authority, semantic gates, bounded harness-tool seam |
| Reviewer | Frontier | Fable, Sol | Fresh adversarial exact-base/exact-head verdict |
| Implementer | Workhorse | Opus, Terra | One bounded unit in one worktree |
| Diagnostician | Workhorse first | Opus, Terra | Explain changed failure evidence and propose/perform bounded repair |
| Mechanical step | Runtime | No model | Fixed-answer inspection, transition, or transformation |

The selected harness resolves capability tiers through a versioned mapping to
exact requested model identifiers proven available in that environment. A
Claude-family adapter may map Fable to frontier and Opus to workhorse; a
Codex-family adapter may map Sol and Terra. These mappings become advertised
support only after that harness's dispatch and telemetry behavior is tested.
One harness family per controller run is mandatory so dispatch, accounting,
session discovery, and model evidence remain coherent.

Preflight proves that the controller is frontier and that the selected mapping
can launch the required worker and reviewer tiers. There is no silent
downgrade. A missing workhorse may wait or be explicitly promoted to frontier.
A missing frontier reviewer or returned model mismatch blocks integration.
Utility models never implement, diagnose, or approve code. Record requested
and returned model identifiers plus available usage evidence when each session
returns; unreadable usage is recorded as unknown with the reason, never as
zero.

An adapter may advertise model-tier enforcement only when the host returns
trusted controller and session identity telemetry. If it cannot prove the
active controller tier, preflight fails the advertised profile rather than
asking the controller to attest to itself. The adapter support matrix is keyed
by adapter version, harness version, exact requested identifiers, accepted
returned identifiers, and capability-test evidence.

The implementation cap counts every active workhorse session that can modify a
unit worktree, including implementation, diagnosis, conflict resolution, and
repair. A unit has at most one such session at a time, and the repository run
has at most three. A slot is consumed when `dispatch_intent` is persisted and
is released only after collection plus termination/cancellation readback or a
manual ambiguity resolution; an in-flight or ambiguous launch therefore still
counts. Read-only reviewers do not consume an implementation slot,
but only one current-base final reviewer may be active because final
qualification is serialized. “Fresh” means a newly created context/session
with no inherited conversation or hidden implementation lineage. It need not
use a different vendor; its exact model and prompt/object bindings must still
be independently recorded.

## Parallel implementation waves

### Wave selection

The runtime packs a wave of one to three ready child Beads from validated task
metadata. Three is a cap, not a utilization target. A unit joins a parallel
wave only when all of these are positively established:

1. No dependency path exists between it and another unit in the wave.
2. Its acceptance criteria and owned scope are self-contained.
3. Its file ownership is disjoint, or any overlap is explicitly demonstrated
   safe. File disjointness alone is not proof of semantic independence.
4. It holds durable, collision-checked reservations for ports, databases,
   schemas, fixtures, external sandboxes, or other mutable test state.
5. It does not require the output or landed OID of another wave member.
6. The host and agent harness have capacity to run it without degrading active
   work.

Changes to shared migrations, global configuration, generated artifacts,
cross-cutting contracts, or critical invariants default to singleton waves.
When independence is ambiguous, use fewer agents.

### Dispatch contract

The runtime sequentially claims the selected Beads, records the wave and
resource reservations, reads those reservations back, cuts one branch and
worktree per Bead from the same verified integration OID, and emits or executes
the workhorse dispatches concurrently. A reservation records its namespace or
resource ID, controller run, Bead, acquisition state, and eventual release
evidence. Version 1 reservations do not expire automatically; an unresolved
reservation remains occupied after interruption.

Each implementation prompt contains only the unit's:

- Bead identity and exact base OID;
- acceptance criteria and authoritative design/plan links;
- owned paths and prohibited scope;
- focused verification commands or repository-native discovery pointers;
- time or token bound; and
- required return evidence.

Each implementer returns the schema-valid semantic `WorkerResult`. The runtime
separately observes changed files, commits or preserved partial working-tree
state, commands and results, and model/usage evidence from the worktree and
harness. Partial or dirty state may be preserved for repair, but it is not a
qualifying candidate. Entry to verification and review requires a clean
committed head/tree OID, expected-base ancestry, scoped diff, and no staged,
unstaged, deleted, or untracked candidate bytes. The implementer does not
perform tracker, publication, pull-request, or integration mechanics.

### Serialized qualification and integration

Parallel candidates enter one controller-owned queue. For each candidate in
turn, the controller:

1. fetches and proves the current integration head;
2. updates the candidate to that base using the repository's permitted
   strategy;
3. routes semantic conflicts back to a workhorse agent on the same identity;
4. reruns affected verification and inspects the exact diff;
5. dispatches a fresh frontier reviewer against the current exact base/head;
6. routes blockers back to the same implementation identity;
7. immediately re-reads the remote candidate head and integration base;
8. publishes and submits only the approved pair through the repository's
   protected compare-and-swap or merge-queue contract;
9. invalidates qualification and review if the provider changes either object
   or builds a different merge candidate;
10. reads back the integration result and durable Beads evidence; and
11. closes or advances the unit before qualifying the next candidate.

An earlier review does not survive a changed candidate head or changed review
base. This is why final reviews and integration are serialized even though
implementation is parallel. Review of one candidate may overlap unrelated
implementation, but it may not be treated as current after its base advances.
The controller queue alone cannot serialize external maintainers, bots, or
provider merge queues; the repository's integration authority must reject a
stale reviewed pair atomically. Without that protection, integration stops.

After all candidates in a wave land, run the repository's aggregate or
interaction-sensitive verification on the combined integration head. Use a
frontier union review when the risk or resulting interaction surface warrants
it. Only then form the next wave.

## Beads contract

Beads owns execution state, not product truth. Requirements, architecture,
decisions, and plans remain in the adopting repository's established durable
documents and are linked rather than copied into issue descriptions.

### Durable structure

The root Bead records:

- objective, scope, exclusions, and final evidence gate;
- links to authoritative repository documents;
- integration branch, authority profile, and compare-and-swap contract;
- repository-wide controller-slot key and holder;
- Beads topology, database identity, effective auto-commit policy, and Dolt
  head;
- controller run identity, model tier mapping, and implementation cap; and
- protocol schema version, aggregate revision, current wave/state, effect
  journal summary, blocked decisions, and resume point.

Each child Bead records:

- acceptance criteria, parent, dependencies, priority, and owned scope;
- base OID, branch, worktree, candidate head, and integration record;
- implementer, diagnosis, test, and review session identities;
- actual models and available usage evidence;
- protocol state, unit revision, and stable external-act idempotency keys;
- verification commands, results, candidate tree, and relevant environment;
- exact review base/head and verdict;
- Beads checkpoint commit, landed OID, and claim-to-land elapsed time; and
- decisions, rejected alternatives, residual risks, and discovered work.

Use Beads metadata for compact machine-readable phase and identity fields and
notes for compact human-readable execution evidence. Substantive human
controller decisions live in the adopting repository's established decision
records and are linked from Beads. This repository uses
[`wiki/decisions`](../decisions/README.md). Avoid creating a second decision
database inside every adopting repository.

The root's versioned metadata envelope is the authoritative aggregate header;
child envelopes are its unit projections. A transition writes the expected and
next aggregate revisions, affected child revision, and effect-journal entry in
one topology-specific mutation batch. Shared-server mode uses the conditional
transaction described below. Embedded mode uses the operation lock, a single
Dolt mutation/commit, and remote non-force push/readback when configured. Files
under the Git common directory may cache request bodies and outbox data but can
never advance protocol state independently of the Beads checkpoint.

### Controller and integration fences

Version 1 selects the rig's built-in `<prefix>-merge-slot` Bead and the tested
`bd merge-slot acquire|check|release` commands as the single controller
primitive. The slot is created only during authorized SCE/Beads initialization,
never lazily during dispatch. Its immutable scope identity is the tuple
`{Beads store identity, Git repository identity, integration branch}` and is
recorded on creation; a mismatch refuses acquisition. Its holder contains the
unique controller run and controller-incarnation identities and is also used
as the Beads actor. The requested root Bead and mutable Dolt checkpoint head
are deliberately not part of the slot key.

`Beads store identity` means the immutable mode, rig/prefix, canonical embedded
store or sanitized server identity, and database name. `Git repository
identity` prefers the provider's immutable repository ID; otherwise the
runtime canonicalizes and records the local bare repository or all observed
SSH/HTTPS remote aliases and refuses an ambiguous alias set. Current Git and
Dolt heads are observations attached to a checkpoint, never identity fields.

The supported `bd` pin is admitted only if the real topology gates prove that
merge-slot acquisition is atomic for different actors, returns the holder, and
survives the required Dolt commit/readback path. A future `bd` version that
changes those properties is unsupported until requalified; the runtime does
not replace the slot with a read-then-update sequence.

In shared-server mode, acquisition requires an authoritative server-side
`bd merge-slot acquire --actor <run-id>/<controller-incarnation-id>` and holder
readback. In
remote-backed embedded mode, acquisition is a clean pull followed by the same
local acquire, a Dolt commit when the effective auto-commit policy requires it,
non-force push, and authoritative remote readback of the slot holder and Dolt
head. A concurrent push or holder conflict loses acquisition. A local embedded
repository without a sync remote can provide only host-local exclusivity and
must declare a local-only authority profile.

Every CLI invocation also takes a no-follow exclusive operation lock beneath
the canonical Git common directory and compare-and-sets the expected run
aggregate revision before emitting an effect. This fences duplicate local CLI
processes using the same holder. Continuing one run identity concurrently from
another clone or host is unsupported and blocked; moving a run requires the
explicit continuation/takeover protocol to mint a new controller incarnation
and read back the updated holder before work resumes.

The controller slot prevents cooperating controller runs from overlapping. It
does not fence an external maintainer, bot, or provider. Integration therefore
also requires one executable repository-native compare-and-swap profile:

- `local-ff`: `git merge --ff-only` after the local integration ref still
  equals the approved base;
- `remote-ff`: one non-force candidate-to-integration push whose rejection on
  any competing base advance is mandatory, followed by remote OID readback;
  or
- `github-merge-group`: a required SCE check is emitted only after qualifying
  and reviewing GitHub's exact `merge_group` SHA, and branch protection cannot
  land that group without the check.

Direct PR merge APIs that pin only the candidate head, auto-rebase before
merge, or otherwise admit an unreviewed base are not an integration profile;
they stop at the `open-pr` handoff boundary. Any base/head/merge-group movement
after review invalidates the verdict. Each advertised provider profile needs a
real sandbox-repository contract evaluation in addition to fakes. The
controller releases its slot only after final checkpoint and positive release
readback.

Another controller encountering a different unresolved holder does not
dispatch or integrate. Automatic expiry and multi-host failover are out of
scope until a deterministic liveness authority exists. Continuing the same
run identity after compaction is distinct from taking over an abandoned run;
the latter requires positive evidence and explicit authority.

### Crash-consistent protocol states

The repository-run aggregate has lifecycle states `initializing`, `active`,
`draining`, `release_intent`, `released`, and `blocked`. Its active-session set,
qualification owner, integration owner, reservations, and effect journal are
validated on every revision. Each unit uses this versioned lifecycle:

```text
planned
  -> reservation_intent -> resources_reserved
  -> branch_intent -> branch_observed
  -> worktree_intent -> worktree_observed
  -> dispatch_intent
  -> dispatched(session_id)
  -> collect_intent -> collected(worker_result)
  -> candidate_committed(tree, head)
  -> verification_intent -> qualified(base, head, evidence)
  -> reviewer_dispatch_intent -> reviewer_dispatched(session_id)
  -> review_collect_intent -> approved(base, head, verdict)
  -> publish_intent
  -> published(remote_head)
  -> integrate_intent(base, head)
  -> landed(integration_oid)
  -> reservation_release_intent -> closed
```

`repair_required` returns the same unit to a bounded repair dispatch and new
candidate/verification/review cycle. `failed`, `timed_out`, `parked`, and
`cancelled` preserve evidence and proceed only to authorized repair,
cancellation cleanup, or reservation release. Dirty candidates and ambiguous
effects are explicit blocked substates. Controller release is itself an
intent/observed pair after all units and reservations reach a legal terminal
state.

Persist and read back an intent before each external side effect, then persist
and read back its result immediately afterward. Dispatches, publication, pull
requests, and integration submissions use stable idempotency keys whenever the
harness or provider supports them. Resume first discovers an existing session,
remote ref, pull request, queue item, or landed delta by that key; it does not
repeat an ambiguous act. An unresolved intent is blocked evidence, not an
instruction to retry blindly.

The state list expresses domain progress; the effect journal covers every
individual external act, including branch/worktree creation, reservation
acquisition/release, verification, reviewer launch/collection/cancellation,
repair, timeout handling, publication, integration, and controller release.
The aggregate and affected child revision are persisted and read back together
under the controller slot and operation lock. A duplicate event or stale
expected revision is a no-op error, never a second effect.

Each durable tracker transition is committed to Dolt if it is not already in a
verified commit. The checkpoint records the resulting Dolt head, verifies the
working set clean, and—when embedded remote sync applies—pushes without force
and reads back the remote state before the next irreversible side effect.

### Supported topology classification

Version 1 targets `bd` 1.1.0 and `bd context --json` schema version 1. CI pins
that version. Later CLI or output schemas become supported only after the
topology and protocol fixtures pass; unknown modes or schemas fail closed.
Classification starts with the configuration-only `bd context --json`, not
process discovery or the fact that a SQL endpoint answers.

| Classification | Version 1 behavior |
|---|---|
| `UNINITIALIZED` | Report a bootstrap plan; require initialization authority; initialize, then rerun proof |
| Embedded project store | Supported by the embedded contract, with optional Dolt remote sync |
| Managed local shared server (`--shared-server`) | Supported by the shared-server contract after identity/connection proof |
| Existing external server (`--server`/`--external`) | Supported by the shared-server contract after identity/credential proof |
| Proxied server, global database, or unknown mode | Refused until explicitly designed and tested |

Immutable store identity includes CLI and context schema versions, canonical
repository and Beads directories, rig/prefix, effective mode and configuration
provenance, canonical embedded data directory or sanitized server identity,
database name, and sync remote/ref when present. The current Dolt head and
working set are mutable checkpoint observations recorded beside that identity.
A reachable server alone does not identify the intended database.

An uninitialized repository is not silently treated as embedded. Preflight
returns `UNINITIALIZED`, shows the non-mutating `bd bootstrap --dry-run` plan
when applicable, and requires authority for initialization. Embedded is the
recommended portable choice only after that authority is present. Existing
configuration is preserved.

### Embedded Dolt with Git synchronization

Embedded mode is a local Dolt database and is single-writer. Cross-clone
synchronization uses the configured Dolt remote, commonly the Git repository's
`refs/dolt/data`; JSONL is an optional viewer/interchange export, not the
authoritative sync or backup mechanism.

Rules:

- only the controller invokes mutating `bd` commands;
- preflight records the effective `dolt.auto-commit` policy and refuses an
  unexplained pending working set;
- every durable mutation batch is followed by `bd dolt commit` when required,
  a clean-working-set check, and Dolt-head readback;
- pull before selecting or claiming shared work and commit/push after durable
  transition batches when a remote is configured and authority permits it;
- push without force and read back the authoritative remote Dolt head and
  affected rows before the next external act;
- never force sync or blanket-resolve conflicts;
- never perform schema migration independently on multiple remote-backed
  clones;
- workers receive criteria in their prompt and normally do not invoke Beads;
- Git worktrees share the canonical Beads store, so this is a cooperative
  invariant unless the harness or OS can deny that path;
- where enforcement is available, workers cannot write the canonical Beads
  store or controller credentials; otherwise the controller records Beads
  head/working-set baselines before dispatch and rejects unexpected movement
  after every returned session;
- any necessary worker/reviewer tracker access is pinned to the canonical
  Beads directory and made read-only in its environment and invocation; and
- local-only tracker state is reported rather than represented as shared.

### Shared Dolt server

Server mode connects to an existing shared Dolt SQL server and database. The
server is authoritative, so embedded pull/push rituals do not apply.

Rules:

- preflight proves the supported server variant, exact database identity,
  configuration provenance, schema, and connectivity;
- credentials come from the adopting environment and are never copied into
  the skill, prompts, logs, or tracked configuration;
- the controller remains the sole writer to SCE-owned rows even though the
  backend may have unrelated writers;
- each SCE-owned row has a monotonic revision and holder; controller mutations
  execute in a transaction whose predicate includes the expected revision and
  holder, require the exact affected-row count, and read back the row before
  the effect can advance;
- the required isolation level and conditional-write behavior are proven in
  the pinned server fixture; a server or `bd` path that cannot provide them is
  refused rather than approximated with read-then-update;
- durable protocol transitions record exact changed-row hashes and the Dolt
  commit/head when available; because unrelated writers are permitted, the
  global Dolt head is supplementary rather than proof of row ownership;
- preflight pins `dolt.auto-commit` to one tested policy for the run. Version 1
  supports `on` or explicit `off`/`batch` transitions only when the adapter can
  prove write transaction, explicit commit, clean working set, exact row
  readback, and crash reconciliation in that order;
- workers and reviewers receive criteria directly or use separate genuinely
  read-only database credentials enforced by server grants, not a cooperative
  `bd --readonly` flag;
- if read-only credentials or a denying sandbox are unavailable, unexpected
  movement of the slot or controller-owned rows is detected and blocks
  qualification rather than being misrepresented as enforced isolation;
- unrelated shared-server row movement is supported only outside SCE-owned and
  active child rows; it is reconciled and preserved rather than rejected merely
  because the global Dolt head advanced;
- an outage pauses tracker-dependent dispatch and integration while preserving
  local code artifacts; and
- missing server access never triggers a fallback embedded initialization.

Provisioning databases, rotating credentials, backups, and server operation
remain external authority boundaries.

### Topology refusal cases

Stop without mutation when:

- `bd` or `bd context` has an unsupported version, schema, or mode;
- `.beads` configuration is contradictory or partially initialized;
- metadata and effective `bd` behavior disagree;
- the configured server/database cannot be identified;
- a remote-backed embedded database requires an undesignated schema migration;
- a sync conflict cannot be resolved without discarding another writer's
  state; or
- tracker state is unreadable while ownership or integration depends on it.

### Authority profiles

Before mutation, record one explicit authority profile and the requested
completion boundary:

| Profile | Allowed Git/provider acts | Valid completion evidence |
|---|---|---|
| `local-change-only` | Local branches, commits, worktrees, and `local-ff` when requested | Reviewed local Git objects and local integration-ref readback |
| `push-branch` | Above plus non-force candidate-branch publication | Remote candidate-head readback; integration remains a handoff unless separately authorized |
| `open-pr` | Above plus creating/updating a pull request | Exact remote head/base and open PR readback; merge remains a handoff |
| `integrate` | Above plus one qualified `remote-ff` or `github-merge-group` profile | Landed remote integration OID, provider object, and delta readback |

The user's requested outcome determines whether a handoff boundary satisfies
the root objective. A remote-backed profile requires readable fresh remote
state; fetch and provider checks are not optional. An explicitly local-only
repository can complete against local Git objects and local integration
evidence rather than being categorically treated as incomplete. Preflight
records both the authority profile and exact integration profile; a repository
that supports neither qualified remote profile can still stop safely at
`open-pr`. No profile grants deployment, release, external-service, or
destructive authority.

## End-to-end controller loop

The runtime executes every fixed-answer bullet below and records the observed
result. The frontier controller supplies only the named semantic judgment or
harness-tool call that the runtime cannot perform, then returns that result to
the state machine.

### 1. Preflight

- Read repository instructions and discover its integration branch, branch
  protection, test commands, documentation conventions, and authority limits.
- Record the authority profile and its completion boundary.
- Verify supported `bd` and context schema versions; use `bd context --json`
  for pure configuration identity, then run separately identified operational
  connection and Dolt-state probes. `bd prime` supplies workflow context but
  is not topology evidence.
- Return `UNINITIALIZED` and obtain initialization authority before any
  bootstrap; rerun the complete topology proof afterward.
- Detect and prove Beads topology, database identity, effective auto-commit
  policy, clean working set, and current Dolt head.
- Resolve and prove the versioned model-tier mapping and actual frontier
  controller tier.
- In a remote-backed authority profile, fetch and record exact local and remote
  integration OIDs; unreadable remote state closes entry.
- Inventory existing work and reconcile only positively owned artifacts.
- Acquire and durably read back the repository-wide controller slot with the
  unique run identity, then claim or verify the root objective.

### 2. Reconstruct or plan the queue

- Resume from the root Bead, child states, worktrees, branches, pull requests,
  and exact OIDs.
- If the root outcome is not decomposed, create bounded child Beads with
  acceptance criteria and dependencies.
- Use the repository's existing plan instead of inventing a parallel one.
- Select the next safe wave from ready work.
- Commit and read back the planned wave, transition states, and resource
  reservations before creating external artifacts.

### 3. Implement in parallel

- Create isolated branches/worktrees and acquire durable resource
  reservations.
- Persist each `dispatch_intent`, dispatch one workhorse implementation agent
  per unit up to the cap, then persist the discovered session identity.
- Record returned evidence and move only clean committed candidates into the
  qualification queue.
- Preserve partial work on timeout or failure; never reuse its identity for an
  unrelated task.

### 4. Qualify and integrate serially

- Bring one candidate to the current integration base.
- Require a clean committed candidate and rerun verification bound to its exact
  tree rather than trusting the worker summary.
- Obtain a fresh frontier exact-base/exact-head review.
- Repair on the same identity and repeat affected checks and review.
- Persist publish/integration intents, re-read the approved remote pair, and
  integrate through the repository's protected compare-and-swap path.
- If the base, head, or provider-built candidate changes, invalidate the gate
  and repeat qualification/review.
- Fetch/read back the landed delta and durably commit its tracker result before
  advancing dependents.

### 5. Gate the wave

- Run combined verification on the integration head.
- Record interaction findings as blocking or follow-up Beads with dependencies.
- Release resource reservations with positive readback.
- Durably update the root resume point and form another wave only after the
  gate and checkpoint are readable and green.

### 6. Prove completion

The root objective is complete only when:

- every in-scope acceptance criterion maps to landed child evidence;
- every blocking Bead is closed or explicitly resolved by the appropriate
  authority;
- the required aggregate suite and user-visible journey checks are green on
  the final integration OID;
- reviews and integration readbacks are recorded;
- no owned worktree, branch, claim, or unpublished tracker mutation is
  stranded; and
- remaining deferred work is explicit and does not contradict the requested
  outcome.

Elapsed time, an empty ready queue, worker summaries, or local-only merges do
not prove completion outside an explicit local authority profile and its named
readback gate.

## Failure and recovery

- **Implementation failure:** preserve the worktree and evidence. Dispatch a
  workhorse diagnosis or repair only with the new failure evidence. Repeated
  unchanged evidence parks the unit or explicitly escalates it; it does not
  justify unbounded retries.
- **Review blockers:** repair on the same branch/worktree, rerun affected
  checks, and obtain a new exact-head review.
- **Stale base or conflict:** refresh on the same identity. Semantic conflict
  resolution is implementation work and invalidates prior review.
- **Verification failure after another unit lands:** treat it as a candidate
  or interaction defect, preserve both proven states, and create or reopen the
  correct blocking Bead before proceeding.
- **Controller interruption:** continuation under the same run identity reads
  the protocol state, discovers the result of any pending intent through its
  idempotency key, and reconciles tracker state, worktrees, refs, pull
  requests, sessions, and exact OIDs. A different run remains blocked pending
  authorized takeover. Neither infers completion from missing processes.
- **Crash around an external act:** persist intent first. On resume, discover
  the session, ref, PR, queue item, or landed delta; repeat only when absence is
  positive and the operation is idempotent. Ambiguity remains blocked.
- **Unexpected worker tracker mutation:** fail qualification, preserve both
  code and tracker evidence, identify the changed rows/working set and actor,
  and reconcile without discarding legitimate state.
- **Tracker outage:** stop tracker-dependent dispatch and integration. Preserve
  local commits and exact state; do not create a competing database.
- **Embedded sync conflict or pending working set:** do not pull through it or
  force-push. Preserve the local Dolt head/working set and reconcile row by row
  against authoritative remote history.
- **Remote or integration ambiguity:** do not push, merge, delete, or reset.
  Diagnose read-only and request authority only when required.

## Skill packaging

The repository will contain:

```text
package.json
tsconfig.json
src/
|-- cli.ts
|-- protocol/
|   |-- schemas.ts
|   |-- reducer.ts
|   |-- effects.ts
|   |-- judgments.ts
|   |-- journal.ts
|   `-- evidence.ts
|-- adapters/
|   |-- beads.ts
|   |-- git.ts
|   |-- github.ts
|   |-- codex.ts
|   `-- claude.ts
|-- commands/
|   |-- preflight.ts
|   |-- wave.ts
|   |-- review.ts
|   |-- integrate.ts
|   |-- resume.ts
|   `-- install.ts
`-- feedback/
    |-- packet.ts
    |-- fingerprint.ts
    |-- normalize.ts
    |-- outbox.ts
    `-- submit.ts
test/
skills/
|-- single-controller-engineer/
|   |-- SKILL.md
|   |-- agents/openai.yaml
|   |-- references/
|   |   |-- controller-contract.md
|   |   |-- model-routing.md
|   |   |-- protocol-state.md
|   |   |-- beads-embedded.md
|   |   `-- beads-server.md
|   `-- scripts/sce.mjs
`-- single-controller-feedback/
    |-- SKILL.md
    |-- agents/openai.yaml
    `-- references/feedback-contract.md
.github/
|-- ISSUE_TEMPLATE/
|   |-- bug.yml
|   |-- enhancement.yml
|   `-- config.yml
`-- workflows/
    |-- validate.yml
    |-- publish.yml
    `-- feedback-triage.yml
```

`SKILL.md` holds routing, the core loop, invariants, and stop conditions. The
controller and protocol references hold wave formation, state transitions,
evidence, review, recovery, and integration detail. Model routing is loaded
for dispatch; only the detected Beads topology reference is loaded. No README
is added inside either skill. The feedback skill is a small discoverable
interface for explicit upstream reports; it calls the same CLI and does not
duplicate feedback policy or code.

Version 1 supports macOS and Linux on tested Node.js LTS lines beginning at
Node 22.14. Runtime prerequisites are `git`, the exact supported `bd` range,
and the selected agent harness; `gh` is optional and used only for authorized
feedback. Preflight reports paths and versions without installing them. The
self-contained bundle includes its TypeBox/Ajv and canonical-JSON code, begins
with a Node shebang, and is packaged with executable mode.

The CLI has two explicit preflight phases:

- pure inspection reads Git/configuration identity, beginning with
  `bd context --json`, and changes no repository or tracker state; and
- an operational probe may start a local managed Dolt process and create its
  runtime pid/log/lock files, but changes no Git refs, worktree bytes, Beads
  rows, Dolt commits, or remote state.

The adapters invoke a strict allowlist of current `git` and `bd` commands with a
sanitized environment, parse allowlisted JSON fields, and emit their own schema
rather than forwarding or regex-redacting arbitrary subprocess output. It
fails closed on unsupported versions, schemas, modes, missing evidence, or
secret-shaped unexpected fields. Tests put canary secrets in configuration,
environment, stdout, stderr, and exceptions and assert none reach output.

The reducer checks versioned protocol traces for legal state ordering, durable
intent/result pairs, stable identity keys, exact base/head binding, Dolt
checkpoint heads, reservation ownership/release, and integration readback.
The same reducer executes live transitions and validates recorded evidence;
there is no separate passive state-machine implementation that can drift.

The TypeScript build produces one self-contained
`skills/single-controller-engineer/scripts/sce.mjs` bundle. It is the one
physical executable in the source tree and npm tarball. `package.json` maps
`bin.sce` directly to that path and its `files` allowlist contains only the
bundle, both complete skill directories, license, and required package
metadata. CI rebuilds from a clean tree and fails if the vendored bundle
differs. The skill never performs an implicit networked `npx` download during
an engineering run.

`sce install-skill --host <supported-host> --destination <path>` explicitly
installs the primary and feedback skills as one versioned set; `--dry-run`
shows the manifest first. Installation stages into the destination filesystem,
validates hashes and both skill versions, then atomically replaces only a
previous installation recorded as this package. An unrelated name collision,
cross-filesystem non-atomic destination, partial pair, or version mismatch
fails without replacement. Upgrade and uninstall use the recorded file
manifest and support rollback to the prior staged set. The companion resolves
the primary sibling and rejects a missing or mismatched runtime. npm
`postinstall` never mutates a user's skill directory.

At repository level, add a concise README, agent instructions, a skill
validator, CI, and the minimal tracked Beads configuration needed for this
repository to dogfood embedded mode. Runtime databases, credentials, and local
state remain untracked.

## npm publication

GitHub remains the canonical source for the skills; npm distributes the same
typed executable as a conventional CLI. The provisional package name is
`@hls-uk/single-controller-engineer`, subject to scope ownership and
availability being resolved before the first release. The package's
`repository.url` must exactly identify this GitHub repository and
`publishConfig.access` is `public`.

Publication uses npm trusted publishing from a dedicated GitHub Actions
workflow and GitHub-hosted runner. A release owner first configures npm's
trusted-publisher record with the exact GitHub owner, repository, workflow
filename, release environment, and allowed action. The environment name in npm
and GitHub must match. The workflow uses a Node/npm version supported by npm
trusted publishing and carries no long-lived `NPM_TOKEN`. For a public package
built from this public repository, trusted publishing emits npm provenance. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[GitHub OIDC permissions](https://docs.github.com/en/actions/reference/security/oidc).

The workflow runs only for a protected release tag whose commit is on the
protected release branch. All third-party and GitHub actions are pinned to full
commit SHAs. It has two jobs with different trust boundaries:

1. The unprivileged build job has `contents: read` and no `id-token: write`.
   It installs from the lockfile, runs formatting, typecheck, unit, real-tool,
   protocol, skill, and bundle reproducibility gates, proves the tag version,
   creates the exact `npm pack` tarball with lifecycle scripts disabled,
   rejects unexpected files, and uploads it with a SHA-256 digest and manifest.
2. The environment-protected publish job has only `contents: read` and
   `id-token: write`. It checks the tag/branch/environment again, downloads the
   exact artifact, verifies its digest and manifest, runs no dependency
   installation, build, or repository lifecycle scripts, publishes that
   tarball through the configured trusted publisher, and reads back the
   registry version, integrity, public access, and provenance.

The release path never publishes from a pull-request workflow, fork, dirty
tree, self-hosted runner, unreviewed generated bundle, or mutable unpinned
source ref. Package publication is a separate authority from ordinary code
integration, and resolving the npm scope and trusted-publisher registration is
an explicit release-bootstrap task rather than something CI guesses.

## Consuming-agent feedback

GitHub Issues is the public intake and discussion surface for bugs and generic
enhancement requests about this skill/runtime. This repository's Beads remains
the execution tracker. An accepted GitHub issue gets a linked Bead when work is
selected; incoming issues are not mirrored automatically.

### Scope and triggers

The primary skill prepares feedback when it observes an apparent defect in the
controller runtime, documented protocol, supported topology, model adapter, or
generic missing capability. It does not report defects in the consuming
application, transient provider weather, or project-specific process choices
as upstream bugs. The companion `single-controller-feedback` skill handles an
explicit request to report or refine feedback using the same contract.

### Feedback lifecycle

```text
observe
  -> prepare controlled telemetry and optional narrative
  -> validate, normalize, and fingerprint controlled fields
  -> inspect existing exact markers
     -> existing: return its URL
     -> absent: preview
        -> authorized: submit and read back
        -> unavailable/not authorized: persist local outbox packet
```

The CLI exposes `feedback prepare`, `feedback preview`, `feedback submit`, and
`feedback flush`. Preparation and preview are local. Creating an issue or
comment is an external mutation and requires current user authorization or an
explicit consuming-repository policy that pre-authorizes this repository and
feedback class. Preauthorization permits only the controlled telemetry template
defined below; any narrative or attachment requires per-payload preview and
authorization. Authorization to create an issue is not authorization to append
a comment, upload an attachment, or flush another kind/target.

Failure to authenticate, connect, or obtain permission writes a sanitized
packet under the consumer repository's canonical Git common directory at
`sce/feedback-outbox/`. The runtime resolves the real common directory, rejects
symlinks, uses a `0700` directory and `0600` no-follow files, takes an exclusive
lock, and persists through same-directory temporary create, file `fsync`,
atomic rename, and directory `fsync`. Envelopes move through `pending`,
`submit_intent`, `submitted`, or `quarantined`; a crash after submit intent
forces fingerprint discovery before retry. The outbox is capped at 100 packets
and 5 MiB, never silently evicts pending or quarantined entries, and persists
only stable error codes, not raw `gh` output. Positively read-back `submitted`
tombstones are retained for 30 days and then removed by an explicit or
scheduled local cleanup; pending and quarantined entries require explicit
resolution. Read-only, full, or unavailable storage returns the safe
packet and a non-zero status to the controller rather than claiming durability.
This state cannot be committed accidentally and is shared by worktrees.
`feedback flush` revalidates each packet and rechecks its exact target, kind,
operation, authentication, and authority.

### Packet and privacy contract

The packet separates two trust classes:

- `SafeTelemetry` contains only schema version, fixed destination ID, kind and
  component enums, bounded semver/toolchain fields, requested model-tier enum,
  protocol-state enum, stable error code, capability ID, and fingerprint. Its
  title and body are generated from fixed templates. Repository policy may
  preauthorize this class.
- `ReviewedNarrative` contains expected/observed behavior, minimal reproduction,
  limitation, desired generic capability, value, workaround, or completion
  example. It is optional and can be submitted only after the user previews and
  authorizes those exact bytes.

All strings have field-specific byte limits, LF line endings, Unicode NFC
normalization, and control/bidirectional-character rejection. Safe telemetry
accepts only enum or anchored-format values. Narrative is capped at 4 KiB; the
preview identifies URL-, absolute-path-, credential-, token-, and source-like
content and refuses unattended submission rather than pretending redaction is
complete. The destination is fixed to `https://github.com` plus the immutable
repository ID and canonical name for `hls-uk/single-controller-engineer` pinned
in the release manifest; redirects or identity mismatches stop.

The runtime never collects environment values, source files, diffs, arbitrary
logs, repository issue content, credentials, raw server URLs, absolute home
paths, or proprietary context. It constructs output from allowlisted facts
rather than collecting raw text and attempting regex redaction. Optional trace
excerpts and attachments are not part of version 1.

### GitHub submission and deduplication

Version 1 prefers the consumer's existing authenticated `gh` session and
submits a generated title/body file to the fixed target
`hls-uk/single-controller-engineer` repository. The GitHub CLI supports
`--repo` and `--body-file`; direct REST fallback, if later added,
requires an existing token with target-repository `Issues: write` and never
persists it. See [GitHub CLI issue creation](https://cli.github.com/manual/gh_issue_create)
and [GitHub's create-issue API](https://docs.github.com/en/rest/issues/issues?apiversion=2022-11-28).

The issue body contains a hidden, versioned marker with kind, component, tool
version, and a SHA-256 fingerprint. The fingerprint input is RFC 8785 canonical
JSON over exactly `{schema_version, destination_repository_id, kind, component,
tool_major_minor, protocol_state, stable_error_code, capability_id}` after the
field normalization above. Narrative is excluded. Test vectors pin the bytes
and hash across platforms and releases.

Before creation, the CLI uses authenticated, paginated issue-body inspection
for the exact marker; indexed GitHub search is only an optimization. An exact
open match returns the canonical URL. Search-then-create is inherently racy, so
this is best-effort client deduplication, not uniqueness. Concurrent duplicate
creation is reconciled deterministically by the target workflow: the lowest
issue number is canonical, later exact matches receive the repository's
existing `duplicate` label and a fixed comment linking the canonical issue,
and none are automatically closed. Appending new evidence remains a separate
authorized mutation. Fuzzy model-based deduplication is excluded.

Consumers do not need label-management permission. A target-repository
`issues.opened` workflow with only `contents: read` and `issues: write` runs
trusted, full-SHA-pinned default-branch code in one serialized triage
concurrency group. It treats titles and bodies as hostile data, passes no issue
field through shell or generated source, validates parsed fields against the
schema, and recomputes the fingerprint rather than trusting the marker. Kind
and component enums map only to constant labels whose existence was verified;
issue values never become label names. “Marked duplicate” means only the
existing `duplicate` label and fixed canonical-link comment above. Ambiguous
reports and ordinary unmarked issues are left open and unmodified. The
workflow's broad issue-write token is confined to this
single event and code path. See GitHub's
[script-injection guidance](https://docs.github.com/en/actions/concepts/security/script-injections).

Human reporters receive matching bug and enhancement forms under
`.github/ISSUE_TEMPLATE`. Forms request the same actionable fields and may
apply labels that already exist. See
[GitHub issue-form syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms).

## Verification strategy

### Hermetic CI gates

- run formatting, TypeScript typecheck with exhaustive reducer handling, and
  runtime-schema tests for every external event/effect boundary;
- validate strict unknown-key rejection, byte/item limits, RFC 8785/Unicode
  test vectors, supported schema upcasts, and refusal of truncated, corrupt,
  future, or lossy persisted envelopes;
- validate skill frontmatter, name, links, and unfinished placeholders;
- test pure preflight parsing for embedded, managed shared-server, external
  server, uninitialized, proxied/global refusal, contradictory, schema-skewed,
  and unavailable configurations;
- test operational-probe state snapshots and secret canaries;
- exercise the production reducer with valid traces, illegal events, duplicate
  events, stale revisions/facts, injected clock/UUID/capacity events, and
  failures before and after every effect;
- property-test invariants including one controller, at most three active
  implementers, no approval for a moved pair, no integration without current
  approval, and no effect after a blocked/ambiguous state;
- test feedback schemas, stable fingerprints, best-effort client dedupe and
  deterministic target reconciliation, per-operation authority, free-text
  preview, malicious issue content, constant-label triage, and secret canaries
  in every input/error channel;
- test outbox symlink/no-follow defenses, modes, locking, atomic-write crash
  points, quotas, read-only/disk-full handling, intent recovery, quarantine,
  and flush reauthorization;
- simulate every harness capability, unavailable model-tool seam, false
  acknowledgement, session-binding mismatch, lookup recovery, ambiguous
  at-most-once launch, cancellation, and returned-model mismatch;
- build twice from clean inputs and prove the vendored skill bundle and npm
  binary are byte-identical;
- inspect and install the produced npm tarball in an isolated offline fixture;
  and
- check that every reference is routed from its `SKILL.md`.

### Pinned real-tool integration gates

CI installs the supported `bd` version and exercises disposable stores rather
than stubbing the behavior under claim:

1. Embedded mode uses two clones and a local bare Git remote. Tests cover
   same-root and different-root controller contention, default-off and batch
   auto-commit, clean commit/push/readback, pending working-set recovery,
   concurrent push conflict, crash before/after commit and push, and schema
   skew.
2. Managed shared-server mode tests authoritative controller-slot CAS, exact
   database identity, expected row revision/holder predicates, unrelated row
   movement, exact changed-row readback, auto-commit policies, concurrent
   contenders, server outage, and recovery.
3. A disposable externally managed local Dolt server exercises the existing
   `--server` configuration, credential, identity, server-enforced read-only,
   transaction, commit, and outage paths without production infrastructure.
4. Git/provider fakes exercise base movement between review and submit,
   provider-built candidate changes, stale integration rejection, duplicate
   external-act idempotency keys, and crash recovery at every state.
5. A deliberately misbehaving worker attempts a tracker mutation. The test
   proves denial where a sandbox/read-only credential boundary exists and
   proves detection plus closed qualification otherwise.
6. Resource tests cover reservation collision, process restart, unresolved
   ownership, and positive release readback.
7. CLI end-to-end tests start from authoritative Git/Beads state, ask `next`
   for each legal action, execute adapter effects, crash at every persisted
   intent/result boundary, and prove resume converges without duplicate acts.
8. Process-kill tests stop after durable intent, during the external act,
   after adapter return, and during result persistence. They cover two
   concurrent CLI processes with one run identity, corrupted journals, schema
   upgrade, dispatch lookup absence, and outbox flush recovery.

These real embedded, managed shared-server, and externally managed local-server
gates are required, not optional. External production credentials or
infrastructure are never required in CI.

### Live-agent release evaluations

Live model calls are non-hermetic release evidence rather than a deterministic
CI claim. For each advertised harness adapter:

1. forward-test the installed skill with a fresh frontier controller and a
   realistic request that forms a two- or three-agent workhorse wave;
2. verify requested and returned model identities, no silent downgrade,
   isolated worktrees, serialized exact-pair frontier reviews, and final
   aggregate integration evidence;
3. test unavailable workhorse/frontier tiers and explicit workhorse-to-frontier
   promotion; and
4. exercise compact generated worker/reviewer packets and compare their output
   quality against the full-contract baseline; and
5. run a fresh independent adversarial review of the skill and evidence, then
   address supported findings.

Each advertised GitHub integration profile also has a release evaluation in a
dedicated sandbox repository. It advances the base adversarially and proves
that `remote-ff` rejects the stale push or that the required check binds the
exact merge-group SHA before GitHub can land it. Provider fakes remain the fast
regression layer; they do not substantiate the advertised live contract alone.

One successful model run is an evaluation sample, not proof of fencing or
crash safety; those claims belong to the deterministic and real-tool gates.
The final repository gate combines skill validation, helper tests, protocol
simulation, every required topology fixture, and link checks in CI, with live
agent evaluations recorded separately for release.

## Rejected alternatives

### Separate orchestration and Beads skills

Rejected for version 1. Beads topology changes controller mechanics but is not
a separate user intent. One entry skill with topology-specific references is
more discoverable and prevents the two contracts from drifting.

### Let workers update their own Beads

Rejected. Embedded mode cannot safely support concurrent writers, and allowing
it only in server mode would give the same skill two ownership models. The
controller can serialize the small tracker mutations while implementation
remains parallel. This is enforced with read-only credentials or sandboxing
where available; otherwise it is a cooperative rule backed by actor/row and
working-set detection, not a false security claim.

### Use the root claim as the controller lock

Rejected. Separate roots can both be claimed, same-actor claims can be
idempotent across two sessions, and embedded clones can each claim local state
before sync exposes the conflict. The controller slot must be repository-wide,
held by a unique actor, durable in the active topology, and read back from the
authoritative store.

### Resume from prose checkpoints alone

Rejected. A crash between an external act and a note can duplicate a session,
branch publication, pull request, or integration submission. Versioned
intent/result states and stable idempotency keys make the ambiguous windows
explicit and testable.

### Keep protocol execution in model instructions plus passive validators

Rejected. A trace validator can detect an invalid history after the model has
already taken the wrong external action. The production reducer must decide
transition legality and emit effects before mutation; audit uses that same
implementation.

### Independent Python helpers for preflight and trace validation

Rejected for this repository. Python could implement the mechanics, but
TypeScript supplies one typed runtime for the reducer, CLI, harness adapters,
GitHub feedback, triage workflow, generated bundle, and npm distribution.
Separate helper implementations would create more contracts to keep aligned.

### Bare TypeScript interfaces at external boundaries

Rejected. Compile-time types are erased and do not validate JSON, subprocess
output, environment, GitHub events, or persisted protocol state. Versioned
runtime schemas validate first and derive internal types.

### Download the CLI through `npx` on every skill invocation

Rejected. It makes an engineering run depend on registry availability and a
mutable package lookup. The exact built CLI is vendored with the installed
skill; npm is an additional installation and upgrade channel.

### Automatically submit every detected failure upstream

Rejected. Many failures belong to the consuming project or transient provider
state, and GitHub issue creation is an external mutation that may disclose
context. Preparation, allowlisting, fingerprinting, and preview are local;
only controlled telemetry can use narrowly scoped prior authority, while any
narrative submission requires current per-payload authority.

### Review all parallel candidates before any integration

Rejected. Integrating the first candidate changes the base against which later
candidates must be judged. Final review must bind the current integration base
and candidate head immediately before integration.

### Permanent model names in the skill contract

Rejected. Product names and availability change. Frontier/workhorse capability
tiers are the stable requirement; current model names are defaults resolved by
the active harness.

### Automatic stale-controller takeover

Rejected for version 1. Beads alone does not provide a positive cross-host
liveness oracle. An expiring timestamp would infer death and risk split-brain
integration. Preserve and require explicit takeover authority until a stronger
mechanism exists.

## Consequences

The design gains implementation throughput without multiplying decision or
write authorities. It deliberately accepts a serialized review/integration
bottleneck; that bottleneck is the mechanism that keeps every approval bound
to current repository state.

Repository-wide controller fencing, topology-specific Dolt commits, and
intent/result checkpoints add machinery absent from a prompt-only workflow.
They are required because a root claim, a successful `bd` mutation, or a prose
note does not by itself survive cross-clone contention or a crash boundary.

The skill remains useful in a solo embedded repository and a centrally hosted
team backlog because topology affects synchronization rather than the
controller/worker contract. Supporting two modes increases preflight and test
cost, but isolates that complexity in two references and typed adapters rather
than spreading conditionals through every instruction.

The TypeScript runtime adds a supported Node.js floor, build toolchain, vendored
artifact, npm release process, and runtime-schema dependency. In return, the
same exhaustively tested state machine owns live execution, audit, packaging,
and feedback instead of asking each controller session to reconstruct the
protocol in tokens.

The public feedback loop adds an external authority and privacy boundary. Its
controlled telemetry, reviewed narrative, best-effort client deduplication,
deterministic target reconciliation, and secure preview/outbox behavior keep
that boundary inspectable. GitHub Issues remains intake; Beads remains selected
engineering work.

The principal future extension is a proven controller lease and failover
mechanism. It should be added only with a real liveness authority and tests;
parallel implementation does not require it.
