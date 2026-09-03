# Single-Controller Knowledge

**Date:** 2026-09-02
**Status:** Amended through successive fresh frontier reviews; accepted with
DEC-20260902-011 and DEC-20260903-012
**Architecture authority:**
[Single-Controller Engineer](2026-08-24-single-controller-engineer.md)
**Delivery companion:**
[Accelerated Beta Engineering](2026-08-25-accelerated-beta-engineering.md)
**External inputs:** `vdb-uk/adam-root` DEC-002 (agent-safe knowledge
collaboration), DEC-003 (projects compose access-domain repos and partnered
Drives), `wiki/projects/agent-knowledge-migration.md`, and the IWPRB
Git-and-Drive pilot technical runbook
**Controller decisions:**
[DEC-20260902-011](../decisions/2026-09-02-011-knowledge-profile-extends-engine.md),
[DEC-20260903-012](../decisions/2026-09-03-012-materialisation-source-and-no-clobber.md)
**Beads:** `sce-9f5`, `sce-085`

The Single-Controller Engineer design remains authoritative for architecture,
authority, privacy, secrets, fencing, integration safety, and topology
correctness. The Accelerated Beta companion remains authoritative for cadence,
test tiers, review frequency, and severity-based acceptance. This document
adds a second material to the same engine. Where it is silent, the parent
contracts apply unchanged; where it appears to conflict with them, the parent
wins and this document is defective.

## Decision summary

The single-controller engine delivers a second material, **knowledge**, through
the same controller, Beads queue, isolated worktrees, serialized fresh frontier
review, and compare-and-swap integration that it uses for software. Knowledge
means the Git-canonical artifacts of an access-domain knowledge repository:
Markdown wiki topics, decisions, workflows, task outcomes, agent instructions,
skills, scripts, immutable provenance records, and the generated views and
deliverables that are materialised one way into a partnered Google Drive.

The engine is extended, not forked and not duplicated. Three bounded,
profile-neutral capabilities are added to the runtime:

1. a journaled `materialise` effect with a filesystem adapter that publishes an
   accepted, landed artifact to a mounted Drive destination exactly once, with
   a unique name and a provenance sidecar;
2. a deterministic projection from closure evidence to an immutable,
   committed provenance record, landed through a journaled provenance commit
   with regenerated rollups; and
3. digest-bound reviewer packets that carry the exact diff hash and snapshot
   path instead of the diff bytes, which closes `sce-cfl` for every profile.

Those capabilities bring the schema they require: optional targets and
supersession fields on task metadata, a journaled source-resolution effect,
gate state on the run aggregate with voided dispositions, the existing
`verify` effect extended to admit a null unit for the wave's combined
verification, a clock observation event, closure evidence extended with the
task-metadata facts a record needs, and a knowledge contract in the controller
configuration.

Everything else that distinguishes knowledge from software is a **profile**:
verification vocabulary, severity table, author and reviewer charges, Drive
publication policy, repository manifest conventions, and the human driver's
entry path. The profile ships as a third skill, `single-controller-knowledge`,
inside the same package and vendored runtime, beside
`single-controller-engineer` and `single-controller-feedback`.

**Beads is first class for knowledge repositories.** Each access-domain
repository runs embedded, Git-synchronized Beads. Task cards are child Beads
carrying the existing validated task metadata. Live task and output claims are
Beads claims and reservations. The controller lock is the repository's merge
slot, read back from the remote Dolt ref. This supersedes the "local sign-out
sheet, Beads not part of the pilot" scoping in the adam-root migration plan,
pilot brief, and runbook, and the corresponding sections of DEC-002 and
DEC-003; the reasons are recorded below and in DEC-20260902-011.

The name does not change. SCE remains Single-Controller Engineer; software and
knowledge are materials the engineer works. A package rename is deferred to a
later decision.

## Context

### The knowledge architecture already decided

On 2026-08-10 adam-root recorded DEC-002 and DEC-003 after Google Drive
synchronization corrupted Git metadata that had been living inside shared
Drives. The accepted model is **isolate, append, reconcile, materialise**:

- every concurrent writer gets an isolated branch and worktree outside Drive;
- activity and provenance are immutable, uniquely named records, never a
  prepended shared log;
- one automatic landing worker serialises acceptance through deterministic
  checks and never invents a semantic resolution; and
- human-facing Drive views are generated one way from accepted state.

Each artifact class has exactly one canonical home. Git owns instructions,
skills, scripts, machine-readable wiki, decisions, workflows, immutable events,
task definitions and outcomes, and agent-authored Markdown masters. This
design moves task definitions and live claims from structured Git records and
per-clone local state into embedded Beads, and says so where it does. Google
Drive owns incoming and raw sources, attachments, Office and Google-native
documents, human-collaborative files, rendered deliverables, and generated
human-facing views. Per-machine secure state holds credentials, caches, local
worktrees, and live claims. Google Drive and GitHub are never both canonical
for the same artifact.

The unit of separation is an **access and reconciliation domain**, not a
project name. IWPRB, the first pilot, has a management domain (Adam and
Hannah) and an operations domain (Adam, Hannah, Grace, later contractors),
each with its own private knowledge repository and partnered Drive. Personal
roots (`adam-root`, `hannah-root`, generic `vdb-root`) remain thin entry points
that route writes into the owning domain.

Claude and Codex are equal clients of an agent-neutral protocol. Required state
must never live only in a provider session, task, thread, or team; another
supported agent must be able to resume from the canonical records alone.

The pilot runbook's Stage 2 asks for one provider-neutral launcher that
creates worktrees from a shared domain clone, acquires local task and output
claims, and queues completed work for automatic landing, plus per-task
immutable events, generated rollups, and serial Drive publication. The
migration plan's Stage 5 describes Beads on a shared Dolt server as an
optional later coordination service, explicitly outside the pilot, and the
pilot brief names the per-clone claim mechanism a "local sign-out sheet".

### The engine already built

Two weeks later this repository recorded the Single-Controller Engineer
design and delivered it as a typed protocol engine. A repository run is a
crash-consistent aggregate: one controller holding a repository-wide merge
slot; units with acceptance identifiers, dependencies, owned paths, conflict
domains, reservations, mandatory verification, and a risk class; branches and
worktrees cut from one verified base; workhorse sessions bounded by generated
packets; candidates frozen as exact base, head, and tree OIDs; verification
bound to the candidate tree; a fresh frontier review bound to the exact pair;
compare-and-swap integration; an intent-first effect journal; and exact
closure evidence retained after a unit closes. Embedded Git-synchronized Dolt
and shared Dolt server topologies are both supported. Claude and Codex harness
families are both classified.

Reading the reducer and schemas for the word "software" finds none. A unit does
not know whether its owned paths hold TypeScript or Markdown. Verification is a
list of commands and exit results bound to a tree. Review is a hashed packet
and a schema-valid verdict. Integration is a fast-forward or non-force push
whose rejection on base movement is mandatory. The software-specific content
lives in the primary skill's prose, the severity examples, the packet guidance,
and the parent design's goal statement.

### The gap between them

Placing the two side by side, the engine already provides the launcher, the
isolation, the atomic claims, the serialized deterministic landing lane, and the
provider-neutral handoff records that Stage 2 planned to build. Four things
are missing from the engine and two decisions must be taken deliberately:

| Gap | Nature |
|---|---|
| A second canonical store with one-way publication | Engine: new effect and adapter |
| Provenance as committed, immutable Git records | Engine: projection from existing closure evidence |
| Reviewer packets that fit a prose diff | Engine: `sce-cfl`, promoted to P1 for this profile |
| Per-unit ceremony versus a ten-line wiki edit | Measure in the pilot; deferred lane |
| Beads or a file-backed sign-out sheet | Decision: Beads, first class |
| Deterministic-only landing or mandatory model review | Decision: keep the fresh frontier review |

## Goals

1. Let one controller deliver a bounded knowledge outcome in an access-domain
   repository using the same engine, fences, evidence, and recovery as a
   software outcome.
2. Make Beads the durable queue, dependency graph, claim record, controller
   slot, and execution ledger for knowledge repositories, replacing shared hot
   files and per-clone sign-out sheets.
3. Keep Google Drive canonical for Office, PDF, raw, and human-collaborative
   artifacts, and make every Drive output a journaled, serialized, one-way
   materialisation of an accepted Git object.
4. Commit provenance for every accepted unit as an immutable Git record with
   deterministic, reproducible rollups, so Git alone reconstructs who changed
   what, from which base, with what evidence.
5. Preserve Claude and Codex parity and satisfy the migration plan's
   first-class parity acceptance criteria for completed and unstarted work;
   in-flight handoff between runs, and therefore between harness families on
   any machine, is deferred, as stated below.
6. Keep the personal root skill as the human driver's only entry path; the
   driver never types `bd`, `git`, or `sce`.
7. Keep engine changes bounded and profile-neutral: no reducer branch, effect,
   or schema keyed on "knowledge".
8. Measure, rather than assume, that the profile is not materially slower than
   the Drive-first workflow it replaces.

## Non-goals

- Performing DEC-002 Stage 1 history recovery, quarantining Drive `.git`
  metadata, or moving any Drive content.
- A Google Drive API adapter, Workspace document conversion, or DOCX/PDF
  rendering inside the engine. Version 1 materialises to a mounted filesystem
  path; rendering is a repository verification or build command.
- Provisioning a shared Dolt server or a cross-machine claim service. The
  shared-server topology remains supported by the parent design; it is not
  required by this profile.
- Editing `adam-root`, `hannah-root`, `vdb-root`, or the VDB Agentic
  Playbook. Those changes are follow-ups under their own authority.
- Search, embedding, or knowledge-graph indexes. They remain derived and
  rebuildable, never authoritative, and outside the engine.
- Replacing the fresh frontier review with deterministic-only landing.
- A controller-direct editing lane that skips workhorse dispatch. It is a
  measured deferral, not a rejection.
- Multiple simultaneous controllers per domain, automatic takeover, email,
  external publication, deployment, or any destructive Drive act.

## Core invariants

Every invariant of the parent design applies unchanged: one controller, one
identity per causal unit, positive evidence, and preserve before mutation. The
profile adds five.

### One canonical home per artifact

Every artifact a unit touches has exactly one editable canonical home, declared
in the repository manifest. Owned paths are always Git paths. Drive paths are
read-only sources for authors and write destinations only for the controller's
materialise adapter. A unit that would create a second editable copy of an
artifact is defective at planning time.

### Drive is outside the fence

Worktree isolation, reservations, and the merge slot protect Git. They do not
protect a synced Drive. Therefore no worker, reviewer, or controller session
writes to a Drive path directly. Drive writes are typed effects: the intent
journals the complete artifact and sidecar destination names, the adapter
performs an ordered pair of atomic no-clobber hard links to those names, and a
strict readback is recorded. A destination that already exists with different
bytes is ambiguous and blocks; it is never overwritten.

### Provenance is a projection, not prose

The provenance record for a unit is generated deterministically from validated
closure evidence, journal observations, and the named run inputs below. A
controller never types one. Two projections from the same evidence produce
identical bytes; the engine's fast suite proves that, and the repository's
fast gate proves every committed record still validates and binds a landed
OID in the branch history. Records are not rebuilt from a plain clone, because
closure evidence lives in the run store, not the repository.

### The profile never changes state legality

The reducer decides which transitions and effects are legal. The profile
decides meaning: which commands verify, which findings block, what an author
or reviewer is charged with, where an artifact lives. If a knowledge need
cannot be expressed without a new transition or effect, the engine gains that
transition or effect for every profile, by decision record.

### The access domain is the repository

A unit never spans domains. Management knowledge is absent from the operations
repository, its worktrees, its generated views, and its Drive outputs. The
boundary is a deterministic path and marker policy declared in the manifest and
enforced by the fast gate and by review, not by an agent remembering the rule.

## Engine and profile boundary

| Concern | Engine, unchanged | Engine, new and profile-neutral | Knowledge profile |
|---|---|---|---|
| Queue, claims, slot | Beads contract, merge slot, reservations, wave packing | Optional `materialisationTargets`, `supersedes`, and `tombstones` on task metadata; gate state on the run aggregate | Task-card conventions and manifest fields |
| Isolation | Branch and worktree per unit from one verified base | | |
| Candidate | Clean committed head, tree, scoped diff hash | | |
| Verification | Commands, exit status, tree binding, cache keys | The existing `verify` effect kind extended to admit a null unit, emitted at aggregate level in the provenance step's journaled detached worktree at the provenance-commit OID | Prose verification vocabulary and templates |
| Review | Packet hash, schema-valid verdict, exact-pair binding | Digest-bound reviewer packet (`sce-cfl`) | Reviewer charge and severity table |
| Integration | Local and remote fast-forward (the parent's merge-group profile is designed, not yet implemented) | | |
| Materialisation | | Journaled source resolution and `materialise` effects with clock-bound destination names, filesystem adapter | Destination policy, naming, sidecar fields |
| Provenance | Closure evidence in the run store | Provenance record projection and deterministic provenance commit | Rollup generators in the repository |
| Recovery | Intent, observation, ambiguity, idempotency | New effects join the journal | |
| Roles and tiers | Frontier controller and reviewer, workhorse implementer | | Author and reviewer packet guidance |
| Human driver | | | Root-skill entry path and plain-language stops |

A profile is a skill directory, its references, and repository-level
conventions validated by that repository's own checks. The engine has no
`profile` field in version 1. The engine validates every input it executes, so
the parameters of a materialise effect and the shape of a provenance record are
strict runtime schemas; the repository manifest as a whole is a repository
document validated by the repository's fast gate using a schema the profile
ships. If a second engine-level divergence between materials ever appears, a
profile field is added by decision record, never as an implicit branch.

The engine learns about a knowledge repository through one validated input:
an optional **knowledge contract** in the controller configuration, parsed by
the same strict parser as the rest of that configuration. It declares the
alias table (alias, canonical root, marker file, mount policy, and the version
1 namespace-control assertion), the
provenance contract (events directory, record format version, rollup
generator command, reproducibility command), the combined-verification
commands, a provenance worktree root, the human driver, the domain scope, and
the gate targets. The controller derives it from the repository
manifest when composing the configuration; the engine never reads the
manifest. The `wave_planned` event carries the contract and the reducer
records it in the run aggregate, so every later gate decision is a function
of aggregate state. A run without a knowledge contract creates no provenance
entry and no gate targets and gates exactly as today; that is how software
runs remain unchanged. Configuration admission requires alias names to be
unique and their lexically canonical absolute roots to be pairwise disjoint:
no two roots may be equal and no root may be an ancestor or descendant of
another. This rejects obvious configuration aliases but does not treat lexical
or real-path inequality as proof of physical independence: bind mounts and
case-folding filesystems can expose one directory through distinct paths.
Before names are compared or a materialise intent is admitted, the destination
probe described below observes the final directory's device and inode. The
reducer groups collision checks by that observed physical identity.
Every alias has `namespaceControl: "exclusive"`; absence or another value
refuses the knowledge contract. The reducer records it and every materialise
intent carries it, and the adapter requires it before the helper starts. This
is the explicit authority assertion behind version 1's exclusive-namespace
precondition and the recorded follow-up for stronger concurrency control.
The manifest's provenance block declares a bounded
`worktreeRootVariable`, never a host path or default. Controller composition
resolves that named variable exactly once into `provenanceWorktreeRoot`, a
lexically canonical absolute non-root path bounded to 3,840 UTF-8 bytes. It may
not equal, contain, or be contained by an alias root. A missing, relative, root,
noncanonical, or secret-shaped value refuses configuration. K3 later requires
it to be a real directory before creating a detached worktree child; K2 records
the resolved path at `wave_planned` so the pure reducer never accepts a
worktree path from controller memory.

`wave_planned` rejects a task with a nonempty `materialisationTargets` array
when no knowledge contract is present, because no alias, driver, or provenance
context exists. Every wave that does carry a knowledge contract, including a
unit-free carry-only wave, requires an already recorded exact harness
configuration; its family is the sole `executorTool` source. With a contract,
every target's destination alias must exactly match one admitted alias. Omitted
or empty target arrays remain valid and are
the only new task-metadata shapes admitted on an ordinary software run.
Controller configuration is the sole authority input for that optional
contract. Command admission requires the `wave_planned` event contract to be
canonically byte-identical to it, including order: both must be absent or both
present and exact. Recovery likewise rejects a persisted run contract that
differs from current configuration before any effect. The reducer records only
the already-bound event copy, so a request cannot invent a root, alias, or
command.

Knowledge-contract admission also proves that every later exact sidecar can
fit before creating a target promise. One pure helper constructs a strict
`MaterialisationSidecar` upper-bound value from the exact `humanDriver`,
`domainScope`, and pinned harness family plus schema-maximum safe values for
every fact not known until resolution or clocking. It serializes that value by
the same RFC 8785-plus-LF path used for the real sidecar and requires at most
8,192 UTF-8 bytes. The limits come from the exported runtime schema constants,
not a hand-estimated reserve. Controller composition performs the proof, and
`wave_planned` recomputes it against the exact recorded contract before adding
any promise; hydration validates the same invariant. Thus an escape-heavy but
otherwise schema-valid driver is rejected before gate work and cannot turn a
later `gate_clock_observed` event into an undeferrable invalid event.

Every executable knowledge-contract command is an argv vector, never a shell
string. `rollupGeneratorCommand` and `reproducibilityCommand` are each one
`string[]`; `combinedVerificationCommands` is a nonempty ordered `string[][]`.
One argv has one to 32 nonempty arguments, each at most 1,024 UTF-8 bytes, and
each argument must be canonical Unicode scalar text with no NUL or unpaired
UTF-16 surrogate; canonical serialized size is at most 8,192 bytes. The
combined set has one to 32
argv vectors and canonical serialized size at most 32,768 bytes. K3 executes
each vector with `shell: false`; ordering and byte-exact equality are part of
the recorded contract. Controller composition derives
`combinedVerificationCommands` by concatenating the manifest's `fast` vectors
and then its `integration` vectors without reordering or deduplication. The
`release` vectors are excluded from a normal accelerated-beta run and remain
reserved for the next tag's separately authorized release tier.

## Artifact classes and canonical homes

The DEC-003 artifact map, expressed in engine terms:

| Artifact | Canonical home | Engine treatment |
|---|---|---|
| Agent instructions, skills, scripts, templates | Domain Git repository | Owned paths |
| Wiki topics, decisions, workflows, entities | Domain Git repository | Owned paths |
| Agent-authored Markdown masters | Domain Git repository | Owned paths; human-edited exceptions classified in the manifest |
| Task definitions, claims, execution state | Embedded Beads in the domain repository, moved from DEC-002's structured Git records and per-clone claims | Root and child Beads, reservations, merge slot |
| Task outcomes and provenance | Immutable records under a declared events directory in Git | Deterministic projection, provenance commit |
| Generated rollups and human-readable views of Git state | Declared generated directory in Git | Rebuilt by a verification command; reproducibility checked |
| Incoming files, attachments, raw evidence, Office and Google-native documents | Partnered Drive | Read-only sources named in packets; never owned paths |
| Rendered deliverables and Drive-facing generated views | Partnered Drive | Materialise effect outputs |
| Credentials and tokens | Keychain or approved local state | Never enter Git, Beads, packets, or records |
| Search, embeddings, graphs | Derived index | Rebuildable; never authoritative; outside the engine |

Generated rollups are committed, as this repository commits its vendored
bundle: the build is deterministic and reproducibility is proven by a check
that rebuilds and expects no diff. The difference is who rebuilds. Engine
units own and rebuild the bundle inside their candidate; knowledge units
never own the generated directory, and the provenance commit rebuilds rollups
after landing and proves them before pushing. This keeps the human-readable
timeline in Git where any clone can read it without running a generator, and
it makes drift visible as a failed check rather than a stale page.

### Repository manifest

Each domain repository carries one provider-neutral manifest,
`knowledge-manifest.json` at the repository root, validated by a strict JSON
schema shipped in the knowledge skill's references. It declares:

- stable project and access-domain identifiers and the audience label;
- migration mode: `legacy`, `pilot`, or `git-first`, per DEC-003;
- partnered Drive aliases, each with a mount policy (required or optional) and
  the local mount path variable the controller configuration resolves, plus
  the required version 1 `namespaceControl: "exclusive"` assertion;
- the canonical home of each artifact class, including the events and
  generated directories;
- the boundary policy: allowed write roots, forbidden paths, and forbidden
  content markers for this audience;
- fast, integration, and release verification commands;
- the provenance worktree-root environment-variable name, resolved explicitly
  during controller composition with no implicit default;
- materialisation targets: source pattern in the landed tree, destination
  alias and subpath, naming policy, and sidecar requirement;
- minimum root, playbook, and profile versions.

The manifest is a repository document. Root `init` and `doctor` procedures read
it to create navigation views and to report missing access or mode mismatch,
exactly as the runbook planned. The controller reads it to compose the
knowledge contract in the controller configuration, materialise parameters,
and verification commands; the engine validates the contract and those
parameters, never the manifest.

## Beads contract for knowledge repositories

Beads is the durable execution ledger for knowledge exactly as it is for
software. The parent Beads contract applies without modification. The
following states how it binds to the knowledge architecture and why it
supersedes the earlier scoping.

### Topology

Each access-domain repository runs **embedded, Git-synchronized Beads**: a
local Dolt store under `.beads/` with `refs/dolt/data` on the repository's own
Git remote as the sync transport. The merge slot is created once, during
authorized initialization, by the person standing up the domain repository.
The controller pulls before a write batch, commits, pushes without force, and
reads the remote Dolt head back before the next irreversible act. Adam's and
Hannah's clones synchronize through GitHub; no server, VPS, Tailscale, or
database service is introduced.

The shared-server topology remains available for a domain whose contention
outgrows Git transport. Choosing it is a separate decision under the parent
design's topology rules, not a requirement of this profile.

### Task cards

A task card is a child Bead beneath the domain's current root objective. It
carries the validated task metadata the wave planner already requires:
acceptance identifiers, dependencies, owned paths, conflict domains,
reservations, mandatory verification, risk, priority, and independence. Two
optional
fields are added to that schema for every profile: `materialisationTargets`,
each naming a destination alias, a bounded canonical Git glob in the landed
tree, a naming policy, and the version 1 constant `sidecarRequired: true`; and
`supersedes` and `tombstones`, lists of provenance record identifiers, so
supersession is a validated fact the projection reads rather than a note. A
source pattern is a slash-separated ASCII path whose segments do not begin
with a wildcard; it admits `*` and `?` within a segment, rejects `**`, pathspec
magic, empty, dot, and parent segments, and never matches a directory. Both
sets of fields are committed with the wave plan, so the wave gate's promise
set and every record's supersession links are aggregate state the reducer
owns, never facts the controller remembers. The profile adds conventions in
the design and notes fields for facts the engine does not execute:

- the source list: Drive or Git paths an author may read, informational for
  the packet and for review; and
- the audience label, which must equal the repository's domain.

Owned paths are Git paths. Declared write scopes may not overlap unless the
units deliberately produce uniquely named alternatives, which is the existing
disjointness rule. Shared index and rollup pages are generated, so they are
never owned paths and never a source of conflict.

### Claims, reservations, and the sign-out sheet

The pilot brief and runbook designed a per-clone "local sign-out sheet":
atomic task and output locks under the Git common directory, shared by that
clone's worktrees, deliberately not cross-machine. The engine already holds
that exact primitive and a stronger one:

| Runbook requirement | Engine mechanism |
|---|---|
| Atomic claim of one task before dispatch | Beads claim by the controller holder, read back |
| Declared output scope rejected on overlap before work starts | Owned-path and conflict-domain disjointness at wave packing |
| Shared mutable resources locked | Durable reservations with positive release readback |
| One active batch driver per domain | Repository-wide merge slot, read back from the remote Dolt ref |
| Crashed runner's branch and worktree preserved before claim recovery | Preserve-before-mutation, intent-first journal, no automatic takeover |
| Duplicate local CLI processes fenced | No-follow exclusive operation lock under the Git common directory |

What the sign-out sheet could not do, the merge slot does: two people on two
machines cannot both integrate into one domain, because acquisition requires
a clean pull, a local acquire, a non-force push, and an authoritative remote
readback of the holder. The runbook's social rule "coordinate before starting
overlapping batches" becomes an enforced property.

### Why this supersedes the pilot scoping

The migration plan's Stage 5 and the runbook's coordination boundary state
that Beads on a shared Dolt server is a possible later implementation, "not
part of this pilot and not a dependency of the knowledge repositories". That
text was written on 2026-08-10, fourteen days before the engine design
existed, and it scoped against three concrete costs: a cross-machine claim
authority, a VPS or Tailscale dependency, and a database service in Hannah's
routine flow.

Embedded Git-synchronized Beads has none of those costs. It is per-clone local
state, transported by the Git remote the repository already has, with no
server. Its requirements are `bd`, Dolt, and Node on each machine. The roots'
`init` and `doctor` scripts check none of them today; extending both scripts
to install and verify that toolchain is part of the adam-root follow-up (K7)
and is a real cost of this decision. The human driver never invokes them; the
root skill drives the controller, and the controller drives Beads.

Adopting Beads now also answers the plan's Stage 5 trigger conditions before
they occur: cross-machine duplicate claims are prevented by the slot, stale
claim recovery follows the engine's recovery contract, and task dependencies
are a first-class graph rather than a per-task file convention.

The adam-root decision that records this supersession is a follow-up under
that repository's authority (`sce-9f5.3`). It must amend DEC-002 section 2
(task definitions and outcomes as structured Git records, live claims as
per-clone state that is not cross-machine authority) and section 6
(cross-machine live coordination reserved for a separate decision) and its
consequence that a shared claim service waits for a measured problem, DEC-003
section 3 (per-machine atomic claims) and its consequence that no
cross-machine task service is added, and the migration plan, brief, and
runbook. The merge slot is deliberately the cross-machine authority those
sections reserved for a separate decision; on the engine side, this design
is that decision. Until the adam-root record lands, those texts stand as
written there and this design records the intended change.

### Beads holds execution, Git holds knowledge

The parent rule stands: Beads owns execution state, not product truth.
Requirements, wiki content, decisions, and plans live in the repository and are
linked from Beads, never copied. Task outcomes are summarised compactly in Bead
notes and recorded exactly in the committed provenance record, so Git alone
reconstructs provenance and Beads alone reconstructs the queue. The two must
agree: the fast gate proves every provenance record's landed OID is an ancestor
of the integration head, and closure notes link the record path.

Because `refs/dolt/data` travels with the Git remote, Beads state satisfies the
parity requirement that durable work be recoverable from Git revisions and
durable records. A clean Claude or Codex session on either machine resumes the
queue from the remote.

## Unit lifecycle for knowledge work

The reducer, states, and effects are the parent design's. This section walks
the same lifecycle and names what the profile supplies at each step and what
the engine adds.

### 1. Plan

The controller reads the domain's instructions, manifest, and current Beads
state, acquires the merge slot, states the promised outcome and non-goals, and
decomposes into units. A knowledge unit is bounded like a software unit: one
outcome, owned Markdown paths, acceptance identifiers, sources, mandatory
verification, and risk. Units that must touch generated rollups do not own
them; the provenance commit regenerates them after landing.

Changes to the manifest, boundary policy, instructions, or shared skills are
cross-cutting and default to singleton waves.

### 2. Dispatch

The author packet is the existing worker packet. For knowledge it contains
the unit identity and exact base OID; acceptance identifiers; owned paths and
prohibited scope, which always includes every Drive path, every other domain,
the events and generated directories, and Beads; the read-only source list;
the repository instruction and style pointers; the mandatory verification
commands; the token or time bound; and the `WorkerResult` return schema.

Authors write Markdown in their worktree, run the focused fast gate, and
return status, summary, residual risks, and suggested follow-up. They do not
publish, materialise, run `bd`, or edit provenance.

### 3. Collect and freeze

Unchanged. Only a clean committed head with expected-base ancestry and a
scoped diff becomes a candidate. Dirty or partial state is preserved for
repair and never qualifies.

### 4. Verify

Mandatory verification is a list of repository-declared commands bound to the
candidate tree. The profile ships templates for a knowledge repository's fast
gate; the repository declares which it uses:

| Check | Establishes |
|---|---|
| Markdown format | Formatter reports no change |
| Frontmatter schema | Every page's metadata matches the repository's strict schema |
| Relative link resolution | Every intra-repository link resolves to an existing path or anchor |
| Boundary policy | No write outside allowed roots; no forbidden marker for this audience |
| Secret scan | No credential shape in any changed file |
| Generated directory untouched | The candidate changes nothing under the generated directory, and every record under the events directory validates |
| Provenance validity | Every record has a unique identifier, valid supersession links, and a landed OID that is an ancestor of the head |
| Supersession | Every page or decision marked superseded names its successor and vice versa |

These are deterministic, hermetic, and fast; the parent's sixty-second budget
holds. The rebuild-produces-no-diff check for rollups and views does not run
on a candidate, because a candidate that adds a topic legitimately changes a
rollup's input without owning the generated directory. It runs on the
provenance-commit tree before that commit is pushed, as a mandatory
verification bound to that exact tree, and again in the combined verification
at the gate. Integration-tier checks add Drive mount presence and a
materialise dry-run for the unit's declared targets. Release-tier evidence is
listed under verification strategy.

### 5. Review

Every frozen candidate receives a fresh frontier review bound to its exact
base and head. The engine already binds a reviewer packet to the candidate:
the candidate observation derives `candidateDiffHash` from one canonical
`git diff` invocation (full index, no renames, binary, histogram, fixed
context), and the reducer rejects a reviewer packet whose diff bytes do not
hash to it. Today that means the packet must carry the whole diff, which is
why `sce-cfl` fails closed on a realistic candidate. After the `sce-cfl`
change the reviewer packet carries `candidateDiffHash` itself, the diff byte
count, a bounded stat summary (file count, insertions, and deletions), the
exact canonical reproduction command,
and the path of the unit's worktree, in which the reviewer is launched
read-only and which the launch request already binds; the reducer accepts the
packet only when its digest equals the committed `candidateDiffHash`. The
reviewer reproduces the diff in that worktree with the named command and
checks the digest before reading. The reducer binds a packet to the unit's
exact base, head, and role and stores it in the run's unit state; the
worktree path additionally binds it to this host. Acceptance identifiers,
owned paths, sources, verified commands and results, and authoritative
document paths are carried as before.

The reviewer's charge for knowledge is fixed by the profile and ordered by
severity: access-boundary leakage; contradiction with an accepted decision or
page that is not explicitly superseded; provenance or supersession errors;
factual claims in a promised deliverable that the cited sources do not
support; audience fit; then style. The verdict schema is unchanged: approve or
request changes, with actionable findings.

The review is retained deliberately. The runbook's landing worker lands
routine work on deterministic checks alone and holds exceptions for a human.
In this design the deterministic checks are the fast gate and the integration
compare-and-swap, and the fresh frontier review is the semantic safety lane
that would otherwise be a human queue. It costs one bounded model call per
candidate. A risk-gated skip that lets low-risk, independence-proven units
integrate on the fast gate alone is a possible later transition, added by
decision record only if pilot latency evidence demands it.

### 6. Integrate

Unchanged. One accepted candidate at a time, brought to the current base,
verified on its exact tree, reviewed on its exact pair, landed through the
repository's fast-forward or non-force push contract, and read back.

### 7. Materialise

New. Materialisation has two emission points, both aggregate-level effects
that leave the unit state machine untouched:

- **unit targets**, declared in the unit's committed `materialisationTargets`,
  are emitted after that unit lands and are sourced from the landed
  integration OID; their observations enter the unit's provenance record; and
- **gate targets**, declared in the knowledge contract for repository-level
  generated views such as the timeline, are emitted after the wave's
  provenance commit is read back and combined verification on its OID is
  observed green, and are sourced from that commit's OID, so a Drive-facing
  view is never one wave stale and never published from a tree that failed
  the aggregate suite; their observations enter the journal and the sidecar,
  and no per-wave record exists in version 1.

A target definition is not yet a materialisation. The reducer preserves each
committed target array's order and derives its identifier as
`sce:tgt:<sha256>`, where the digest is RFC 8785 canonical JSON over the domain
`sce.materialisation-target.v1`, its `unit` or `gate` scope, origin unit ID when
present, zero-based target ordinal, and complete target definition. At its
emission point the reducer first journals one `materialisation_resolve` intent
bound to the run, wave, that target identifier, source OID, canonical source
pattern, and the remaining item and byte capacities.

Every aggregate gate entry also has a stable `sce:gate:<sha256>` identifier.
Its RFC 8785 input uses domain `sce.gate-entry.v1`, run and wave IDs, stage,
and the complete logical stage identity: target ID and source OID for
resolution; alias configuration and subpath for a destination probe; target,
source, observed destination-probe ID, resolved path, and blob OID for one
materialisation; or the provenance projection input snapshot, including its
ordered unit set and stable target-evidence digests, for provenance. The
attempt-local integration base OID is deliberately excluded from the
provenance gate-entry identity. Aggregate verify uses the upstream provenance
entry ID. This `gateEntryId` is required on every aggregate **gate** clock,
intent, observation, refusal, and deferral event and in every aggregate gate
effect's typed parameters. The pre-gate controller-ownership and carry-claim
effects are the explicit exceptions because no gate exists. The effect journal
stores it where applicable and includes it in the intent
commitment; the aggregate idempotency-key derivation binds it; recovery selects
the exact gate entry by identifier and effect kind before reconstructing the
parameters hash. A retry retains the logical gate entry ID but has the new
revision's effect ID and idempotency key. In particular, an observed
base-advance rejection leaves the provenance entry pending: the replacement
intent uses the newly observed base OID, the same gate entry ID, and a new
effect ID and key. No entry is replaced, voided, or migrated, and recovery
selects the latest unresolved revision within that entry. Unit effects omit
the field, so existing software keys and recovery remain byte-for-byte
unchanged.

Target promises and dependent placeholders are not gate entries. At
`wave_planned`, the reducer records each unit or gate target definition as a
promise keyed by its already-derivable `targetId`; a promise has no source OID
and no `gateEntryId`. A unit landing supplies the source OID that lets the
reducer create its resolution gate entry. An observed provenance commit does
the same for gate-target resolution. A promise may instead be voided before a
source exists. Similarly, provenance and aggregate verify begin as dependent
placeholders without gate IDs. Once every immutable original unit and
unit-target promise settles, the reducer freezes the merged projection snapshot
and atomically replaces the provenance placeholder with its gate entry and ID.
Supplying a target source similarly replaces that pending promise with its
source-bound resolution entry; an observed provenance commit replaces the
verify placeholder and later the gate-target promises when their identities
become derivable. There is no `fulfilled` promise status and no successful
promise remains beside its derived entry. Voided promises and placeholders do
remain as the provenance disposition. Hydration rejects both a pending promise
plus its derived entry and an entry with no valid promise lineage. Every object
called a gate entry therefore has the complete identity inputs and stable gate
ID; promises and placeholders cannot receive effect events.

That compatibility promise also governs the bounded recovery-event-ID repair.
Both generic and production recovery use one helper. It first forms the legacy
`recover-${effectId}` value and preserves it byte-for-byte when it satisfies
the strict identifier schema and its 160-byte limit. Only when that candidate
is too long does it return
`recover-${sha256(RFC8785({domain: "sce.recovery-event.v1", effectId}))}`.
The digest input is canonical and domain-separated, the output is a bounded
identifier, and the same effect produces the same value on both recovery
paths. Thus a maximum-length legal source event can always be recovered while
ordinary software recovery IDs do not change.

K2's source-specific Git executor lives under `src/adapters/materialise/`; it
does not extend the general provenance Git adapter owned by K3. It enumerates
the exact OID's tree without giving the pattern to Git as a pathspec, applies
the closed `*` and `?` segment matcher itself, and reads each selected blob by
OID. Every invocation uses the fixed admitted Git executable, the exact
verified repository working directory and object format, `--no-replace-objects`
or `GIT_NO_REPLACE_OBJECTS=1`, disabled prompts and optional locks, and a
bounded sanitized environment with `GIT_NO_LAZY_FETCH=1`. It never inherits
`GIT_DIR`, `GIT_WORK_TREE`,
alternate-object-directory, replace-ref, config-injection, or other `GIT_*`
redirection, prompt, credential, or network-helper settings. A missing
promised object is a positive source-unavailable refusal, never a lazy fetch.
An inability to establish that context refuses before returning tuples. Tree
enumeration is NUL-delimited and paths remain raw bytes while
matching: pattern literals compare ASCII bytes, slash separates segments and
is never matched within one, `?` matches exactly one byte, and `*` matches zero
or more bytes within one segment. Only matched candidates are fatal-UTF-8
decoded and then required to be canonical ASCII. One matched invalid UTF-8,
multibyte, tab, newline, non-ASCII, or otherwise unsafe path refuses the whole
resolution, including safe siblings; the executor never silently selects a
safe subset. Its observation returns byte-sorted, unique regular blobs as `(path, blob
OID, sha256, byte count)` tuples. A returned path is ASCII and at most 192
bytes; one blob is at most 16 MiB; one target resolves at most 64 blobs; and one
wave admits at most 128 outputs totalling 64 MiB. The observation carries no
blob bytes and remains inside the 131,072-byte aggregate envelope.

One target may match many files; the reducer creates one materialisation gate
entry per tuple in that exact order. It resolves every target in the unit stage,
then creates one deduplicated `destination_probe` entry for
each exact destination-alias and subpath pair that has at least one expanded
output. A probe entry's `sce:gate:<sha256>` identity binds the run, wave,
stage, complete recorded alias configuration, and subpath. Its intent carries
those facts and the stable gate entry ID. Its strict observation is either an
observed canonical path plus device and inode as bounded unsigned decimal
strings, a positive bounded refusal, or the ordinary ambiguous effect outcome.
The probe walks the complete existing destination no-follow, checks the marker
and containment rules, and observes the final directory rather than merely the
alias root. Every probe in the stage must settle before clocks are accepted.
The reducer then obtains the validated UTC-second observations and derives the
complete artifact and sidecar names for every resulting entry before admitting
any unit materialise intent. It performs the same resolve, probe, clock, and
name-preflight sequence for every gate target before admitting any gate
materialise intent.
Zero matches, an exceeded item or byte limit, a non-blob match, or an unsafe
returned path is a positive
`refused`
observation with no publication, not a controller-selected subset. Every
observed path must also be valid UTF-8 and a canonical slash-separated ASCII
path whose segments match `[A-Za-z0-9][A-Za-z0-9._-]*`; a wildcard that reaches
any other path refuses the whole result. The reducer likewise refuses the
whole result if the exact derived artifact and sidecar basenames for all
entries in the stage are not pairwise distinct within the same observed
destination device and inode. The comparison is over the combined final-name
set, so it catches artifact/artifact, sidecar/sidecar, and artifact/sidecar
collisions even when the targets use different aliases, paths, or naming
policies. Unit-stage preflight compares every unit candidate mutually.
Gate-stage preflight also compares every gate candidate with every
already-observed unit artifact and sidecar whose stored probe identity has the
same device and inode. The gate stage probes its destinations again; when it
references the same logical alias/subpath as an observed unit output, that
probe must reproduce the stored unit-stage physical identity or the outcome is
ambiguous. A cross-stage collision leaves the observed unit entry unchanged
and refuses each affected pending gate entry.
These checks occur after every stage clock is observed but before any
materialise intent in that stage, so a refusal cannot leave a partial stage
publication. The final
`gate_clock_observed` event for the stage atomically records a reducer-derived
`output_name_collision` refusal on every colliding pending materialisation
entry. Each refusal carries the lexicographically first other colliding gate
entry ID, which may identify an already-observed unit entry during gate-stage
preflight; the entries already retain the exact names, so this witness is
bounded. No external refusal event or effect is invented. A subsequent clock
observation is legal only for a collision-refused entry and recomputes the
complete stage preflight; a collision-free preflight clears those refusals.
Otherwise the entries remain pending until an explicit controller deferral
with a follow-up Bead. The controller never supplies a resolved path, digest,
clock, name, or collision decision from memory.

A `materialise` intent binds the run, the source OID, the source path in that
tree, its observed blob OID, sha256 and byte count, the destination alias with
its canonical root, marker file, and mount policy from the knowledge contract,
the required namespace-control assertion, the exact destination-probe gate
entry ID and its observed canonical path, device, and inode, the human driver
and domain scope, the run's pinned harness family as the executor tool, and the
**complete artifact and sidecar destination names**, so that every fact the
adapter and the sidecar use enters the parameters hash.
Before that intent the reducer accepts one validated UTC clock observation for
the exact resolved entry. The timestamp syntax is `YYYY-MM-DDTHH:MM:SSZ` and
must round-trip as a real UTC second.

Destination names have one exact grammar. Treat the last non-leading dot as an
extension separator only when it is followed by one to ten ASCII alphanumeric
characters; otherwise the whole basename is the stem and the extension is
empty. Convert ASCII uppercase to lowercase, collapse every non-alphanumeric
stem run to `-`, trim dashes, take the first 80 ASCII bytes, and trim a trailing
dash again. Because an admitted source basename begins with an alphanumeric,
the slug cannot be empty. A retained extension is a dot plus its lower-case
suffix. The three naming policies produce:

- `source-basename`: `<slug>--<oid12>--<YYYYMMDDTHHMMSSZ><ext>`;
- `iso-date-prefix`:
  `<YYYY-MM-DD>--<slug>--<oid12>--<YYYYMMDDTHHMMSSZ><ext>`; and
- `content-hash-suffix`:
  `<slug>--<sha256-12>--<oid12>--<YYYYMMDDTHHMMSSZ><ext>`.

The reducer computes and journals that name; the adapter never invents or
normalises it. The idempotency key is derived from the journaled facts. A crash
after the act therefore resumes against the same name and compares bytes; it
never mints a second name. Version 1 requires a provenance sidecar for every
output. `sidecarRequired: false` is rejected by both the repository manifest
schema and the runtime contract rather than creating an untraceable artifact.
The materialise intent journals the artifact name above and the sidecar name,
which is exactly `<artifact-name>.sce-provenance.json`; both are validated as
plain basenames and neither may contain a separator.

The sidecar is strict canonical data, not adapter-authored prose. Its schema is
`sce.materialisation-provenance` version 1 with no unknown keys and the fields
`runId`, `waveId`, `gateEntryId`, nullable `originUnitId`, `targetId`,
`sourceOid`, `sourcePath`, `blobOid`, `sha256`, `byteCount`,
`destinationAlias`, `destinationSubpath`, `artifactName`, `driver`,
`domainScope`, `executorTool`, and `timestamp`. The reducer derives the exact
bytes as RFC 8785 canonical JSON encoded as UTF-8 followed by one LF; the
result is bounded to 8,192 bytes and its SHA-256 and byte count are bound into
the materialise intent. Knowledge-contract and wave admission have already
proved the schema-derived worst case fits that bound; deriving exact bytes at
the clock transition therefore cannot fail for size. Before any filesystem
write, the adapter reads the source blob by its journaled blob OID, enforces the
16 MiB cap, and requires its SHA-256 and byte count to equal the resolution
observation. Absence before a final exists is a positive refusal; any
contradictory object bytes are ambiguous and publish nothing.

The version 1 adapter is a filesystem adapter against a Drive for Desktop
folder. Its read-only destination-probe port performs the root, marker,
component, containment, real-path, device, and inode checks below and returns
only their strict bounded observation. Device and inode are encoded as one to
20 ASCII decimal digits with no sign or leading zero except the value `0`;
canonical path is bounded like the configured root. A missing marker has the
distinct refusal `optional_alias_unmounted` or `required_alias_unmounted`
according to the recorded mount policy. Any other positively established
pre-act topology violation is `invalid_destination`; an indeterminate or
changing topology is ambiguous. An optional-unmounted observation atomically
voids its probe and all materialisation entries that depend on it, without a
clock or materialise intent. Required-unmounted and invalid-destination
refusals remain pending for a new probe intent or explicit deferral.

The mutating port repeats the complete probe before mutation and requires the
same canonical path, device, and inode carried by the materialise intent. It
then starts the current Node executable with
`shell: false`, a fixed bundled helper program, a bounded sanitized environment,
and the validated destination directory as the child process's `cwd`. The
parent passes
the directory's expected device, inode, and canonical path plus plain final and
temporary basenames; artifact and sidecar bytes use a fixed length-prefixed
stdin frame bounded by the limits above. The child first requires `stat(".")`
and `realpath(".")` to equal those expected facts, then performs every final and
temporary lookup relative to that inode-bound `cwd`; it never resolves the
original destination path again. It returns only a strict bounded observation.
The parent validates that observation. This uses the shipped Node runtime, not
a shell, library, or system helper, and introduces no runtime dependency.

The helper also rechecks the `cwd` device, inode, and canonical path after final
readback. Failure to start the helper or prove its initial identity fails closed
before mutation. A later identity change is ambiguous and preserves the exact
evidence. The engine's merge slot serializes compliant controller writers.
Version 1 additionally requires exclusive namespace control for the admitted
destination directory during the helper call: any concurrent process that can
rename that directory through its parent, including a same-user process or a
Drive sync client, is outside the supported authority model. Post-act identity
checking detects such interference as ambiguous but cannot prove that the
inode was not moved during the publication syscall, just as for Git worktrees.

The complete probe and repeated materialise-admission algorithm is:

1. resolve the destination root from the controller configuration by alias;
   require `lstat` to identify a real directory rather than a symbolic link,
   require its canonical real path to equal the configured absolute path, and
   require the manifest-declared marker to be a no-follow regular file in that
   root, because a missing marker means the Drive is not mounted; every
   component of the destination subpath must already be a real directory, not
   a symbolic link, and the final directory's real path must equal the lexical
   path below the canonical root; version 1 never creates destination
   directories;
2. start the helper only after those checks, and use no-follow opens and `fstat`
   relative to its verified `cwd` for every existing final or temporary path;
   a symbolic link, directory, device, socket, or other special file is
   ambiguous and is preserved; if either journaled final name exists, read
   back what is there and inspect that final's exact reserved temporary name
   no-follow. An absent temporary is normal. A regular temporary with the same
   device and inode as the regular final, expected bytes, and link count
   exactly two on both names is the legitimate crash state after hard-link
   publication: unlink only that temporary, fsync the directory, revalidate
   the helper identity, and never publish that final again. A special,
   different-inode, different-byte, or other-link-count temporary is ambiguous
   and preserved. Apply this independently to sidecar and artifact, sidecar
   first. Artifact and sidecar both identical is an already-observed act;
   artifact identical and sidecar missing completes the sidecar from the same
   intent facts and then observes; sidecar identical and artifact missing
   continues to the artifact write; any other state, including different
   bytes in either final, records `ambiguous` and blocks;
3. inside that same helper, otherwise write the sidecar, then the artifact,
   each to a temporary name
   derived deterministically from its journaled destination name with a dot
   prefix and the suffix `.sce-tmp`, inside the destination directory; a
   leftover temporary whose final is absent must be a no-follow regular file
   with link count one;
   identical bytes are reused, different bytes are unlinked because that exact
   reserved name is never a published object, and no other path is touched;
   create or recreate with `O_CREAT | O_EXCL | O_NOFOLLOW` and mode `0600`,
   require `fstat` to confirm the same regular inode, write and fsync it, and
   revalidate the helper's directory identity; atomically publish it with the
   same-filesystem hard-link operation, require final readback to be the same
   inode and expected bytes, fsync the directory, and unlink only that exact
   temporary, sidecar first; an `EEXIST` race at temporary creation is
   ambiguous rather than retried; and
4. read back size and sha256 of both files, revalidate the helper's directory
   identity, and record the strict observation.

The link operation is the version 1 no-clobber primitive: it fails when the
final name already exists and therefore cannot replace another writer's file.
There is no rename, copy, or direct-write fallback. `EEXIST` triggers an exact
readback: identical bytes resume or observe, different bytes are ambiguous.
An unsupported hard-link operation is a positive refusal only when no final
name was created; any uncertain or partial outcome is ambiguous. Dot-prefixed
temporary names keep partial writes out of Drive views. Hard-link and fsync
semantics on a synced folder are not assumed: K6 records them on a disposable
directory, and real mounted-Drive support remains a release-tier gate before a
tag. A filesystem that cannot prove this primitive is unsupported by the v1
adapter and receives no unsafe fallback.

The sidecar names the unit or wave, run identity, source OID, source path,
sha256, driver, executor tool, and timestamp, so a Drive reader can trace any
generated file to its Git object without Beads access. The driver and scope
are read from the journaled intent, where the controller configuration placed
them; the timestamp is the intent's clock observation.
Generated Drive directories are marked generated in their own instructions;
reverse edits are never read back into Git. The adapter never overwrites,
deletes or moves a published object, and never lists beyond its destination
directory. It may replace or unlink only the two exact journaled temporary
names that are never published objects. All containment, no-follow, inode, and
byte checks are repeated during reconciliation; missing evidence never becomes
permission to act.

A Google Drive API adapter, if ever added, implements the same effect with
provider object identifiers as its readback. It is a separate decision with
its own release evidence.

### 8. Record provenance

New. `wave_planned` snapshots the exact selected unit IDs in the gate's
immutable `originalUnitIds`; unit closure never removes an ID from that set.
The active knowledge gate also retains optional `currentIntegrationOid`,
updated only by each validated `integrate_observed.integrationOid` in the
controller's serialized landing order and never deleted with a closed unit.
No such field exists on a software run. After the originals settle, the
reducer freezes the provenance base from the last current-wave integration
observation; if the wave landed none while carrying prior work, it uses that
carry's last attempted or base-advanced provenance base; and a carry-only
import uses the import adapter's authoritative current-integration observation.
No provenance intent or controller event may supply or replace this base.
After every original unit and unit-target promise or entry has settled, the
reducer derives the current projection membership from those IDs and the
durable provenance accounting described below. The newly created pending
provenance entry accepts one `gate_clock_observed` event carrying its
gate entry ID and a validated UTC second. That event is the sole provenance
clock input and the reducer records it before it admits one
`provenance_commit` intent; the intent event cannot supply or replace the
timestamp. Aggregate verify needs no clock. The runtime projects the closure
evidence of each unit closed as landed, its
complete unit-target resolution, materialisation, refusal, and deferral
evidence, and the named run inputs to a canonical Markdown record with a stable
identifier, writes the records under the events
directory, runs the repository's declared rollup generator, and produces one
deterministic commit on the integration branch.

The commit is deterministic because every input is journaled: author and
committer name is the controller holder string and email is the constant
`sce@noreply.invalid`; author and committer dates are the intent's clock
observation rendered as Unix seconds with a `+0000` offset; the message
carries the idempotency key as a trailer; and the tree is the landed tree
plus the projected records and regenerated rollups. The idempotency key binds
the run, the wave, the set of unit identifiers, and the base OID the commit
is built on. The commit lands under the run's authority profile through the
same local or remote fast-forward contract as any integration, with non-force
push and readback.

The provenance step has one working directory with one journaled lifecycle.
Before any record is written, the runtime creates a temporary detached
worktree at the landed integration OID. The reducer derives its exact path as
`<provenanceWorktreeRoot>/sce-provenance-<token>`, where `token` is
`sha256(RFC8785({domain: "sce.provenance-worktree-path.v1", idempotencyKey}))`.
It rejects any derivation that is not one direct child of the recorded root or
exceeds the strict path bound. The intent journals that derived path; no event
supplies it. K3 executes allowlisted `worktree add --detach` with the exact OID
at that path. Inside the worktree the runtime writes the records under the events
directory, runs the rollup generator the knowledge contract declares, builds
the commit object from the resulting tree, and points the worktree's
detached HEAD at that object, which moves no branch ref. It then runs the
reproducibility check the contract declares in the same worktree against
that tree: regenerate rollups and views and require no diff, and validate
every record under the events directory. A failing check is the strict
`reproducibility_failed` result of the `provenance_commit` refusal, carrying
the attempted commit OID, attempted tree OID, and a bounded SHA-256 digest of
the adapter's private diagnostic, with no ref moved. The worktree is preserved
as evidence, and the entry stays pending until the controller defers it to a
follow-up Bead. The repair unit may run in a later wave of the same run or in a
new run that imports the authoritative carry as described below. Only after
the check passes is the local integration ref fast-forwarded or the remote
pushed without force, then read back, under either integration profile.

The same worktree, at the provenance-commit OID, is the working directory of
the wave's aggregate verification, which is a gate entry of its own;
`verification_failed` is reserved for that entry. The worktree is never
removed by the engine in version 1: like unit worktrees, it is preserved as
evidence, and a journaled cleanup effect for preserved worktrees of both
kinds is a later engine unit by decision record. On resume, an existing
worktree at the journaled path is admitted in exactly two states: its HEAD
equals the journaled OID and its tree is clean; or, while the provenance
entry is pending, its HEAD is a commit whose parent is the journaled landed
OID and whose trailer carries the key, its tree is clean, and the record
paths in that commit are byte-identical to the projection, in which case the
step resumes at the reproducibility check. A dirty tree or any other HEAD is
refused and preserved for a human decision. When the worktree is absent while
the aggregate verify entry is pending, that verify effect's executor recreates
it detached at the already observed provenance-commit OID. The verify intent
carries both that OID and the deterministic path, and the recreation is itself
a journaled worktree act at the same path; the OID remains discoverable by key.
A rejected push mints a new key and therefore a new path, and the earlier
attempt's worktree is preserved like any other.

Discovery on resume is by key: fetch the integration branch and look for a
commit whose trailer carries the key; if present, verify the record paths at
that commit are byte-identical to the projection and record the observation.
The `provenance_commit_observed` result is one closed discriminated union:

- `committed` carries the attempted base OID, observed commit OID, and observed
  tree OID;
- `reproducibility_failed` carries the attempted commit and tree OIDs plus the
  bounded diagnostic digest described above;
- `base_advanced` carries the attempted commit and tree OIDs and the exact
  newly observed integration `advancedBaseOid`;
- `worktree_refused` carries the expected base OID, nullable observed HEAD OID,
  one of `dirty_worktree` or `unexpected_head`, and a diagnostic digest; and
- `integration_refused` carries the attempted commit and tree OIDs and a
  diagnostic digest for a positively established non-base-advance rejection.

Every object has only the fields of its variant. OIDs use the run's object
format, digests are lowercase SHA-256, and no free-form diagnostic enters the
aggregate. The first variant is observed; the remaining four are refused.
`unavailable` is an adapter/coordinator status that emits no observation and
leaves the journaled intent unresolved. Contradictory discovery or uncertain
ref movement is the existing ambiguous effect outcome, not a fabricated union
member. Only `base_advanced` automatically admits a new intent: it retains the
same provenance gate entry, increments its attempt revision, binds the exact
advanced base, and derives a new effect ID, key, and worktree path. The other
refusals qualify only for explicit deferral with a follow-up Bead. A rejected
attempt is never retried blindly.

This is the one commit on the integration branch that carries no unit
identity and no review. It is exempt from "one identity per causal unit"
because it is a pure projection of already-reviewed, already-landed evidence
whose bytes the engine proves, not a change a model authored; this
repository already lands unreviewed commits of its Beads interaction records
in the same way.

The projection's inputs are validated schemas only: closure evidence, which
K3 extends to retain the task-metadata facts a record needs (owned paths,
acceptance identifiers, supersessions) after the unit leaves the live map;
the K2-stable target evidence snapshot copied into the provenance intent,
which retains each target definition, source-resolution observation or
refusal, each resolved materialisation observation, and every deferral reason
and follow-up Bead; and the intent's own parameters, which carry the human
driver, domain scope, alias table, provenance contract, and clock observation.
Those values originate in the committed task metadata, gate journal, and
controller configuration, but the projection reads them only from the
journaled provenance intent, never from live configuration or a later mutable
gate. The same run store therefore projects the same bytes. Nothing is read
from prose or the conversation.

The run also retains a bounded `provenanceUnitAccounting` map keyed by unit ID.
Closing a unit as landed atomically adds an `uncommitted` record bound to that
unit's exact closure-evidence commitment; a non-landed closure adds none. An
observed provenance commit atomically marks every unit in that entry's frozen
projection snapshot `committed` and records the commit OID. No other transition
can mark or remove one. At wave planning the immutable `originalUnitIds` set
therefore distinguishes this wave from cumulative closure evidence, includes a
landed unit even when it declared no targets, and excludes failed or voided
units from projection. Snapshot creation merges carried units with exactly the
landed, uncommitted members of `originalUnitIds`, rejects a duplicate whose
closure or target evidence differs, and never reprojects a committed member.
The accounting map survives checkpointing and closure-ledger compaction. Its
64-entry bound is shared with projection membership. Two successful waves
therefore commit disjoint new records, while a deferred wave retains its exact
uncommitted membership until a later observation marks it committed.

A provenance record contains at least the fields DEC-002 requires: a globally
unique identifier, project and domain scope, human driver, executor tool and
session identity where available, UTC timestamp, base and landed OIDs, owned
paths, verification commands and results, review verdict binding, materialised
destinations and digests each marked observed or deferred, and superseded or
tombstoned records. A target deferred before source resolution has no invented
path, digest, or final name: its record carries the target identifier, source
pattern, destination alias and subpath, refusal code, follow-up Bead, and
`deferred` disposition. It never contains secrets, transcripts, or narrative
beyond the bounded `WorkerResult` summary.

The engine's fast suite proves byte-identical output for identical input, and
the knowledge repository's fast gate proves every committed record still
validates and binds an OID in the branch history.

### 9. Gate the wave

The wave gate gains aggregate state. The repository run carries a `gate`
field holding, for the current wave, target promises, dependent provenance and
verify placeholders, and the lazily created source-resolution,
destination-probe, materialisation, provenance-commit, aggregate-verify, and
gate-target entries. It also retains immutable `originalUnitIds`, separate
from the draining live-wave membership, and the current or carried projection
membership described above.
A `targetPromises` collection contains only pending or voided unresolved
promises. A separate `targets` collection contains source-bound target groups:
the definition, target ID, source OID, resolution gate entry, and any expanded
materialisation gate entries. The group is not itself a gate entry. Successful
source availability atomically removes the pending promise and adds its exact
group; a voided promise remains. `provenancePromise` and
`aggregateVerifyPromise` are optional fields deleted atomically when optional
actual `provenance` and `aggregateVerify` entries replace them; voided
placeholders remain.
A promise or placeholder is `pending` or `voided` and has no gate ID. Each
actual entry has its stable gate entry identifier, optional current or last
effect identifier, and a status of `pending`, `observed`, or `voided`. The
reducer populates promises from committed task metadata and from the knowledge
contract recorded at `wave_planned`; it creates entries only when their
identity inputs exist. Resolved paths and digests enter only through the
journaled source-resolution observation, and the controller supplies nothing
from memory. A pending entry can retain a strict bounded last-refusal variant;
for reducer-derived `output_name_collision` it stores only the reason and the
deterministic conflicting gate entry ID. Ordering within the gate is fixed:
resolve every unit target, probe every deduplicated destination, observe every
resulting clock and preflight all exact names by observed device/inode, then
run every sorted unit materialisation; emit the provenance commit; run
combined verification on its OID; resolve every gate target, repeat every
destination probe, observe every resulting clock and preflight all exact names
by observed device/inode, then run every sorted gate materialisation. Their
events are `materialisation_resolve_intent` and
`materialisation_sources_observed`,
`destination_probe_intent` and `destination_probe_observed`,
`materialise_intent` and
`materialise_observed`, and `provenance_commit_intent` and
`provenance_commit_observed`, all following the existing
intent-then-observation pattern with `ambiguous` as a first-class outcome.
`gate_clock_observed` is the sole timestamp event: it precedes name preflight
for each pending materialisation entry and, after every `originalUnitIds`
member and unit-target promise or entry settles, precedes the provenance
intent. It is never used for
aggregate verify. The intent events carry no controller-supplied clock.
Combined verification is itself a gate entry: the existing `verify`
effect kind gains a distinct aggregate runtime-schema branch with null
`unitId`, the stable gate entry ID, the provenance step's exact journaled
detached worktree path, the provenance-commit OID and tree, and the recorded
bounded `commands: string[][]` argv vectors. The existing unit/software branch
keeps its string `unitId` and `commands: string[]` bytes unchanged. The
aggregate branch reuses `verification_observed` and `verification_failed`.
Like
the provenance entry and the gate targets, it exists only when the knowledge
contract is present, so a run without one gates exactly as today. The
provenance entry is admitted only after every immutable original unit has
closed and every unit-target promise, probe, and entry is observed or voided.
The aggregate verify
entry is admitted only after the provenance commit is observed and only when
its commands equal the combined-verification commands recorded with the
knowledge contract at `wave_planned`. A gate target is admitted only after
aggregate verification is observed green. The gate-green predicate therefore
reads observations and never a controller's memory.

K2 owns the complete strict wire shapes and reducer legality for
`materialisation_resolve`, `destination_probe`, `materialise`,
the gate-facing `provenance_commit`, and aggregate `verify`, including refused
observations, idempotency, recovery selection, command admission, actions, and
deferral. K3 owns provenance projection, record and rollup bytes, detached
worktree and provenance Git execution, discovery, and production observation;
the source-specific Git executor remains in K2's materialise subtree. Between
the two commits a production knowledge run fails closed as unavailable at the
provenance adapter boundary; K2 reducer tests use schema-valid synthetic host
observations to prove the gate transitions. This staging boundary does not
weaken or version an incomplete wire contract.

A gate entry can never wedge a run, because every way it can fail to be
observed has a reducer-owned `voided` disposition with a validated reason:

- `unit_not_landed`: the unit closed as failed, timed out, parked, or
  cancelled, so it has no landed OID; the reducer voids its unit target
  promises at closure without fabricating source-bound gate entries;
- `handoff_boundary`: the run's completion boundary is a branch or pull
  request handoff, so there is no landed integration OID and no integrate
  authority; the reducer records the provenance and aggregate-verify
  placeholders and every gate-target promise as void at `wave_planned`, and
  unit-target promises as void at closure, without fabricating gate IDs; and
- `optional_alias_unmounted`: the alias is declared optional and the adapter
  observed the marker file absent; this is an adapter observation recorded
  through `destination_probe_observed`, never an inference;
  the reducer atomically voids the shared probe, every dependent unclocked
  materialisation entry, while each already source-bound target group retains
  its resolution and probe evidence for provenance; no target promise exists
  after successful source expansion and none is recreated or mutated; and
- `no_landed_units`: the projection set is empty because the durable accounting
  contains no carried member and no landed, uncommitted original unit, so there
  is nothing to project or verify; the reducer voids the provenance and verify
  placeholders and the gate-target promises from aggregate state alone; and
- `deferred_by_controller`: the entry's own last effect is a positive
  `refused` source-resolution, materialisation, or provenance observation, or a
  `verification_failed` observation, or the entry carries the reducer-derived
  `output_name_collision` refusal from the completed stage preflight, and the
  controller has recorded a follow-up Bead for the repair; the event carries
  that Bead identifier, and the reducer admits it only from that same entry's
  recorded failure, never from an unattempted `pending` or `ambiguous` state;
  and
- `deferral_cascade`: recording `deferred_by_controller` on the provenance
  entry voids, in the same event, the wave's aggregate-verify placeholder or
  entry and every pending gate-target promise or entry; recording it on the
  aggregate verify entry voids every pending gate-target promise or entry.
  Recording it on a required-unmounted or invalid-destination probe atomically
  voids every dependent unclocked materialisation entry; each affected
  source-bound target group retains the resolution, probe refusal, and
  follow-up evidence that settles its dependent entries. One deduplicated probe
  may cascade to several target groups. No successfully expanded target has a
  promise at this point, so the cascade neither recreates nor mutates one. The
  voided targets are carried forward with the units and their retained
  evidence.

A required alias whose marker is absent is observed by the destination probe
as `required_alias_unmounted` with nothing written; the probe stays pending and
blocks clocks until the controller either mounts the Drive and journals a new
probe intent, which is legal because the refusal positively proves that no act
occurred, or defers the shared probe and its dependents to a follow-up Bead. A
deferred provenance commit carries its units forward: the deferral event leaves
the complete canonical projection-input snapshot and its lineage in the voided
provenance entry rather than relying on effect-journal history. When a later
`wave_planned` event in the same run replaces that gate, the reducer atomically
copies the carry into the new gate before dropping the old one. New landed-unit
evidence is merged by unit ID and target order; duplicate unit IDs or
contradictory closure or target evidence are rejected. A second deferral
retains the merged snapshot and lineage, including every earlier unit-target
resolution, destination probe, refusal, materialisation, and deferral fact,
and a committed provenance observation is the only transition that clears the
logical carry. Journal checkpointing cannot remove this state.

A last-wave deferral has a fully protocol-owned repair route rather than
requiring a pre-seeded spare unit. Once the deferral cascade settles the gate,
the controller may release the run normally. A distinct newly acquired run may
journal one active `provenance_carry_claim_intent` at a time after acquisition
and before its first wave or any gate work. This pre-gate effect is intentionally
not a gate entry and has no `gateEntryId`, like controller ownership effects,
because no gate exists yet. Its exact parameters are
`predecessorRootBeadId`, `predecessorRunId`, `predecessorWaveId`,
`predecessorFinalRevision`, `predecessorJournalCheckpointCommitment`,
`predecessorRootAggregateCommitment`, `snapshotCommitment`, `exportId`, and
`claimToken`, where `claimToken` is the effect's idempotency key; they never
accept a free snapshot. The production adapter reads the authoritative
predecessor run from its Beads projection/root row, validates the full envelope and invariants,
same store, repository, integration branch, and object format, terminal
`released` state, exact voided provenance deferral, absence of unresolved or
ambiguous effects, and the current integration head through an allowlisted
read.

While holding the global controller slot, that adapter atomically CAS-creates
an immutable claim record in the predecessor root Bead's sibling metadata
object `sce_carry_claims`, outside its `sce` root projection. The safe object
key is `exportDigest`, computed as
`sha256(RFC8785({domain: "sce.provenance-carry-export.v1", storeIdentity,
repositoryIdentity, integrationBranch, predecessorRunId, predecessorWaveId,
predecessorFinalRevision, predecessorRootAggregateCommitment,
snapshotCommitment}))`. `exportId` is
`sce:carry:<exportDigest>`. The strict claim record contains only `schema:
"sce.provenance-carry-claim"`, `version: 1`, `exportId`,
`predecessorRootBeadId`, `predecessorRunId`, `predecessorWaveId`,
`snapshotCommitment`, `claimantRunId`, `claimToken`, and `claimRevision: 1`.
Keeping it outside the projection leaves predecessor run, root-projection, and
software bytes unchanged. The sibling is a strict bounded boundary: before a
claim, `sce_carry_claims` must be absent or the exact empty object; after a
claim, it must be the exact singleton `{<exportDigest>: <ClaimRecord>}`. A
wrong type, a second or unknown key, a noncanonical record, or an oversized
record is `predecessor_refused` with `projection_invalid` before mutation. The
record and singleton use the existing metadata and canonical-byte bounds. An
absent singleton entry is created as claimed; the exact singleton with the same
record and token is an idempotent readback; the exact singleton with a different
record is `already_claimed`; and an uncertain CAS or readback is ambiguous. The
embedded Git-sync adapter proves a sibling-only metadata delta, while both
Beads topologies perform the acquired-slot predicate and exact singleton
readback inside the claim transaction. The intent therefore precedes the only
cross-run state change, and a crash after the claim but before local persistence
resumes by the same token rather than claiming twice. No ordinary retry may
steal or clear a claim.

All carry commitments have one exact canonical formula. `snapshotCommitment`
is SHA-256 of RFC 8785
`{domain: "sce.provenance-carry-snapshot.v1", projectionInputSnapshot}`.
`claimRecordDigest` is SHA-256 of RFC 8785
`{domain: "sce.provenance-carry-claim-record.v1", claimRecord}` over every
strict claim-record field above. A carry retains ordered
`lineageAncestorDigests`, at most 128 lowercase SHA-256 values. One ancestor
digest is SHA-256 of RFC 8785
`{domain: "sce.provenance-carry-ancestor.v1", rootBeadId, runId}`.
`lineageCommitment` is SHA-256 of RFC 8785
`{domain: "sce.provenance-carry-lineage.v1", lineageAncestorDigests}`. A first
same-run deferral has an empty ancestor array and its corresponding commitment.
An import validates the predecessor array and commitment, refuses duplicates or
the importing root/run digest, then appends the predecessor root/run digest.
The production adapter performs this check before CAS. A 128-entry predecessor
is a positive `lineage_limit_exceeded` refusal with no claim mutation; this is
an explicit bounded external repair gate rather than an unbounded aggregate.

The corresponding `provenance_carry_claim_observed` event has one strict
`result` union. `imported` carries a `carry` object with exactly `exportId`,
`predecessorRootBeadId`, `predecessorRunId`, `predecessorWaveId`,
`predecessorFinalRevision`, `predecessorJournalCheckpointCommitment`,
`predecessorRootAggregateCommitment`, `snapshotCommitment`,
`projectionInputSnapshot`, `integrationOid`, `claimRecordDigest`,
`claimRevision: 1`, `lineageAncestorDigests`, and `lineageCommitment`.
`already_claimed` carries exactly `exportId`,
`claimantRunId`, `claimRecordDigest`, and `claimRevision: 1`.
`predecessor_refused` carries exactly `predecessorRootBeadId`,
`evidenceDigest`, and one reason from `not_found`, `projection_invalid`,
`scope_mismatch`, `not_released`, `effects_unsettled`,
`provenance_not_deferred`, `snapshot_invalid`, `lineage_invalid`, or
`lineage_limit_exceeded`.

All identifiers and hashes use their existing strict bounds; the claimant is a
run ID, not prose or personal data. Every union member marks the matching claim
effect observed. An imported result records the members as uncommitted
accounting and requires the next wave to carry a knowledge contract. A refusal
stores only the bounded last pre-gate refusal and permits safe controller
release or one new dedicated claim; it never creates a carry. Uncertainty uses
`effect_ambiguous`. The reducer recomputes every success binding and rejects a
tampered or differently claimed observation. Two new runs racing or
sequentially attempting one export cannot both import it.

The claim has one dedicated production command whose caller supplies only the
bounded predecessor Beads root identity. The command itself loads, validates,
claims, reads back, and composes the intent and observation fields. Neither
`provenance_carry_claim_intent` nor `provenance_carry_claim_observed` is admitted
through the generic CLI/recovery `options.event`, `gate-wave`, or command-event
mapping, where self-consistent but invented commitments could otherwise look
valid. Generic recovery can only resume an already journaled carry-claim effect
by its exact effect ID and claim token; production recovery reruns the same
authoritative read/CAS/readback path.

The latter is the bounded carry-only path: `wave_planned.tasks` may be empty
only when the run has no remaining units, an imported nonempty carry is pending,
and a knowledge contract is present. The reducer creates an empty
`originalUnitIds` set, uses the import event's observed integration OID as the
provenance base, and creates the provenance entry from the carry without
inventing a unit. This is not a general empty wave. In particular, a legal
64-unit carry is first repaired by a separate ordinary run, then imported into
a unit-free run and committed through this path; it is never forced to merge a
65th repair record. Repeated failed repairs can repeat separate repair and
carry-only runs without growing the carried membership. A later deferral
exports the complete merged lineage. These paths permit last-wave deferral,
orderly release, a reviewed repair, and then one provenance observation without
an out-of-protocol Git landing.

The snapshot is strict canonical data bounded to 65,536 UTF-8 bytes, 64 unit
IDs, and 128 expanded materialisation entries across carry-forward and current
work. Wave planning rejects an aggregate that cannot preserve the carried
snapshot. Every `materialisation_resolve` intent binds the exact remaining
item, source-byte, projection-snapshot-byte, and aggregate-envelope capacities.
The adapter and reducer share one pure schema-derived expansion-cost function.
It adds the canonical prospective source-tuple bytes to the exact worst-case
durable reserve per output for its target group, worst-case one destination
probe, materialisation entry, clock and names, bounded refusal/status fields,
and provenance linkage. Deduplicated probes may use less but are never assumed
for admission. The reducer subtracts all fixed gate, provenance, verify,
carry-claim state and observation, journal, and event-history structure before
committing the remaining aggregate capacity; the snapshot capacity uses the
corresponding exact snapshot expansion cost. Exact sidecar bytes are derived
when executing and are not duplicated in state; journaled source/destination
fields plus sidecar digest and byte count bind them. The adapter emits an
ordinary bounded `refused` observation with reason `evidence_budget_exceeded`
when either complete expansion cannot fit; it never emits a subset. The reducer
rechecks the committed costs and full prospective state. Later clock/name
transitions cannot exceed the reserved strict-schema maxima, so an accepted
intent never has an exact recovery observation that cannot commit. The 128
output value is a hard ceiling, not guaranteed capacity in an already-large
aggregate. Reducer and adapter tests cover near-boundary acceptance and refusal,
no partial tuples, retry or deferral, subsequent clocks and snapshot creation,
two-wave deferral, checkpoint and rehydration, and the 131,072-byte envelope.
The next provenance key binds the complete merged set. A
deferred gate target is republished by a later intent when the controller
declares it again. A deferred unit target is republished the same way, but
the unit's provenance record is immutable and already lists that destination
as deferred; the later observation lives in the journal and the sidecar
only.

Legality rules for `next`: while any target promise, dependent placeholder, or
actual gate entry is pending, `wave_planned` and `controller_release_intent`
are illegal. Existing ambiguity-recovery actions expose pending or ambiguous
gate effects for observation; promises and placeholders have no effects to
expose. An ambiguous gate effect moves the aggregate to the existing `blocked`
state and is recovered through the existing ambiguity path. The gate is green
only when every promise, placeholder, and actual entry has settled as observed
where applicable or voided, and reservations are released. The aggregate
verify entry is the combined verification, so no separate predicate exists.

## Roles and model tiers

| Role | Required tier | Responsibilities |
|---|---|---|
| Controller | Frontier | Decomposition, authority, semantic gates, materialisation and provenance effects, plain-language stops for the driver |
| Reviewer | Frontier | Fresh exact-pair verdict on boundary, contradiction, provenance, support, audience, style |
| Author | Workhorse | One bounded knowledge unit in one worktree |
| Diagnostician | Workhorse first | Explain changed verification failures and perform bounded repair on the same identity |
| Mechanical step | Runtime | Packets, verification binding, materialise, projection, readback |
| Human driver | Person | Objective, scope, exceptions, and every authority the profile does not grant |

Model routing, tier proof, no silent downgrade, and the three-lane cap are the
parent's. Where the harness family is classified `at-most-once-manual`, an
ambiguous author launch blocks for a human-bound observation. The root skill
must present that stop to a non-technical driver in plain language: what was
started, what could not be confirmed, and the one action that resolves it.

## Human driver and agent parity

The personal root skill is the entry path. It resolves the selected domain's
repository and partnered Drives, proves the mounts and versions the manifest
demands, and invokes the knowledge skill as the controller session. The driver
sees the objective, the task cards, plain-language stops, and the landed
result; branches, worktrees, slot mechanics, and Dolt synchronization stay in
the background, exactly as the pilot brief promises.

The migration plan's first-class parity criteria map to engine properties:

| Parity criterion | Where it is satisfied |
|---|---|
| Discover the same instructions, skills, and authority boundaries | `AGENTS.md` and `CLAUDE.md` pointer; one skill set installed for either host |
| Create an isolated workspace without touching a Drive or another writer's index | Worktree per unit from one verified base; Drive never an owned path |
| Claim a task and output scope through one launcher with one schema | Controller-owned Beads claim and reservations; task metadata schema |
| Produce a proposal that passes the same deterministic checks | Candidate verification bound to the tree, identical for both families |
| Hand work to the other agent using only Git revisions and durable records | Closed and unstarted units: landed commits, Beads over `refs/dolt/data`, committed provenance records; in-flight units stay with the run that started them, see below |
| Recover after local runtime state is discarded | Intent-first journal, exact readbacks, no completion inferred from missing processes |
| Continue if one provider is unavailable | Both harness families classified; a run pins one family, a new run may pin the other |

One honest boundary: a **run** is per clone. The run aggregate, including its
effect journal, is checkpointed in Beads and synchronized, but the operation
lock, the worktrees, and the controller incarnation are host-local, and the
parent design forbids continuing one run identity from another clone without
its explicit takeover protocol. Handing a domain from one machine to another
is therefore an orderly release followed by a new run. The reducer refuses
controller release until every unit is closed and every reservation is
released, so the first machine must bring every unit to closure first: land
what is ready, and either finish or explicitly cancel what is in flight,
which preserves the branch and worktree as evidence and voids the unit's gate
entries. It then releases reservations with positive readback, checkpoints
and pushes Dolt, and releases the slot. The second machine starts a new run
and plans from the queue the remote holds: closed units are done, unstarted
units are planned afresh. In-flight work does not transfer between runs in
version 1, on any machine and therefore between harness families, because a
run pins one family and a new run cannot adopt an existing branch at a head
other than its base; a journaled discover-and-adopt effect is a possible
later engine unit, by decision record, if the pilot shows that in-flight
handoff is needed. This is the runbook's "one active human batch driver per
domain", made explicit.

## Severity for knowledge

The Accelerated Beta severity definitions apply; these are the knowledge
examples that bind them.

| Severity | Knowledge examples | Effect |
|---|---|---|
| P0 | Management content in an operations repository, worktree, view, or Drive output; a credential in Git or a Drive output; any overwrite, deletion, or reverse sync of Drive content; a lost or altered provenance record; two editable canonical copies of one artifact | Blocks immediately |
| P1 | A page contradicting an accepted decision without supersession; a broken canonical link or missing successor in a promised page; a deliverable claim the cited sources do not support; materialisation to the wrong destination or alias; a stale base landed | Blocks the candidate |
| P2 | Audience or clarity defects with a workaround; incomplete rollup polish; a non-core generated view out of date; a missing optional source citation | Recorded, continues |
| P3 | Wording, ordering, formatting preferences, optimisation | Deferred |

Severity is decided by user impact and authority risk, not by how interesting
the defect is.

## Verification strategy

### Engine fast gate

- strict schema tests for the `materialisation_resolve`,
  `destination_probe`, `materialise`, and `provenance_commit`
  effect kinds, the pre-gate `provenance_carry_claim` effect, their parameter
  and observation envelopes, the aggregate-only verify branch and
  bounded argv vectors, and the
  digest-bound reviewer packet, including unknown-key rejection and byte
  limits while the unit verify branch remains byte-identical;
- reducer traces proving no materialise effect before the unit is landed, no
  controller-selected source path, sorted bounded expansion for multiple
  matches, raw-byte wildcard handling and whole-result refusal for invalid
  UTF-8, multibyte, tab, newline, or non-ASCII matches, positive refusal for
  zero or excessive matches, replacement refs and hostile inherited Git
  environments unable to redirect the exact source OID, exact source digest,
  destination probing before
  clocks, device/inode collision grouping across lexical aliases, optional
  probe cascade, required-probe deferral cascade, gate-stage reprobe ambiguity,
  and filename derivation from a resolved tuple and clock observation, atomic
  bounded collision refusal on the final stage clock, deterministic collision
  retry, deferral admitted from that reducer-derived refusal, and equal or
  nested knowledge-contract alias roots rejected before a wave is admitted,
  missing or non-exclusive alias namespace control rejected before intent,
  nonempty targets rejected without a knowledge contract, and unknown target
  aliases rejected against the recorded contract, knowledge and carry-only
  waves rejected before and admitted after exact harness configuration,
  absent/present event/config mismatch, alias mutation, command reordering, and
  a 4,096-byte escape-heavy driver whose schema-derived maximum sidecar exceeds
  8,192 bytes rejected before wave admission or recovery,
  provenance commit while an original wave unit is open or without every unit
  probe and materialisation observed or voided, immutable original membership
  and uncommitted/committed accounting across two successful waves, no
  base ambiguity across opposite integration orders, a last-landed no-target
  unit, an all-failed wave with same-run carry, base advance then deferral, or
  cross-run carry-only projection, golden software trace/state/root-projection/
  commitment equality through integrate and release, no
  `wave_planned` or controller release
  while a gate entry is pending, an aggregate verify intent refused unless its
  commands exactly equal the knowledge contract recorded at `wave_planned`,
  lazy ID derivation and recomputation across failed-unit, handoff,
  empty-projection, and provenance-deferral hydration, strict mutually
  exclusive provenance result variants and base-advance-only automatic retry,
  voided dispositions for
  a unit closed without landing, a handoff boundary, an
  optional unmounted alias, the defined empty projection set, and a controller
  deferral admitted only from a refused or verification-failed observation, a
  required-alias refusal that keeps its entry pending, no gate target before
  the aggregate verification on the provenance-commit OID is observed, a
  deferral of a shared destination probe, the provenance entry, or the verify
  entry cascading to every
  dependent pending entry in the same event, a preserved worktree whose HEAD
  is the keyed commit on the landed OID resumed at the reproducibility check,
  no
  provenance, verify, or gate-target entry for a run without a knowledge
  contract, the verify entry voided with the provenance entry when the
  projection set is empty and under a handoff boundary, a pending verify entry
  whose absent worktree is recreated by the aggregate verify executor from the
  path and observed provenance-commit OID carried by its journaled intent,
  resume against the
  journaled destination name after a crash, authoritative cross-run import and
  carry-only projection for a full 64-unit predecessor, rejection of tampered,
  wrong-repository, nonterminal, ambiguous, repeated, or cyclic imports, no
  approval on a digest mismatch, a 160-byte probe intent event deriving a legal
  effect ID and the conditional recovery-ID fallback,
  and no effect after a blocked or ambiguous state;
- property tests extending the parent invariants to the new effects;
- byte-identical provenance projection for identical evidence and refusal of
  evidence that fails validation;
- upcaster coverage for persisted envelopes that predate the new effect
  kinds; and
- skill layout tests extended to the three-skill set, including relative links
  between skills.

### Engine integration and release gates

- filesystem materialise adapter against a disposable directory: ordered
  destination-probe admission and recovery, shared-probe fanout, device/inode
  identity grouping, optional and required probe refusals, gate-stage identity
  drift ambiguity,
  sidecar-then-artifact atomic no-clobber links, identical-bytes idempotency,
  missing sidecar completion, sidecar-only crash continuation, leftover
  temporary replacement, different-bytes ambiguity in either file,
  `EEXIST` readback, unsupported-link refusal, required-alias refusal,
  optional-alias void observation, canonical path refusal, replacement-ref and
  hostile-Git-environment source reads, and crash between intent and
  observation; and, at release
  tier, the same adapter against a real Drive for Desktop folder to establish
  hard-link and fsync behaviour on a synced directory;
- a knowledge repository fixture with two clones and a local bare remote,
  covering slot contention, task-card packing, boundary-policy failure,
  reproducibility failure, and provenance-commit readback;
- the existing two-clone embedded and process-kill matrices rerun with the new
  effects present; and
- a live-agent release evaluation that runs the runbook's management rehearsal
  scenario: a realistic batch of isolated units, a deliberately overlapping
  output rejected before dispatch, a stopped author whose branch survives
  recovery, bidirectional Claude and Codex handoff of completed and unstarted
  work, and measured startup, search, proposal, landing, materialise, and
  end-to-end times.

### Knowledge repository gates

The knowledge skill's references are the single home of the manifest schema
and the fast-check templates. The root skill copies the templates into a
domain repository when it initializes or upgrades it, and the manifest's
minimum profile version records which templates it carries. Each domain
repository declares its own commands in its manifest; the controller runs
what is declared and never invents a check.

## Skill packaging

The package gains a third skill beside the existing pair:

```text
skills/
|-- single-controller-engineer/        (unchanged)
|-- single-controller-feedback/        (unchanged)
`-- single-controller-knowledge/
    |-- SKILL.md
    |-- agents/claude.yaml
    |-- agents/openai.yaml
    `-- references/
        |-- knowledge-contract.md      profile invariants, artifact map, manifest
        |-- knowledge-severity.md      the severity table and reviewer charge
        |-- materialisation.md         effect, adapter, naming, sidecar
        |-- provenance.md              record fields, rollups, reproducibility
        |-- repository-manifest.md     manifest contract and template use
        `-- manifest/
            |-- knowledge-manifest.schema.json
            `-- checks/                fast-gate templates
```

The knowledge skill's `SKILL.md` is the controller loop for a knowledge
repository. It routes to its own references for profile content and to the
primary skill's references, by relative path within the installed set, for the
controller contract, protocol state, model routing, the accelerated-beta
reference, and the topology reference selected at preflight. Those contracts
are shared on purpose; duplicating them would let the two materials drift.

The knowledge skill ships no `scripts/` directory. It invokes the shared
runtime at `../single-controller-engineer/scripts/sce.mjs` relative to its own
directory, which exists because the installer places the set atomically.
Because two implicitly invocable skills share one runtime, their descriptions
must be disjoint by material: the engineer description names software delivery
in a repository with a test suite, the knowledge description names a knowledge
repository with a manifest and partnered Drive, and the layout test asserts
neither description contains the other's trigger terms. A host that selected
the wrong skill would apply the wrong severity table, so the knowledge
`SKILL.md` stops when the repository declares no manifest, and the engineer
`SKILL.md` stops when it finds one; both stops name the sibling skill.

Consequences for the runtime and package:

- the installer's skill set becomes a triple installed and removed as one
  manifest-hashed unit; all three declare the same version; the feedback skill
  stays explicit-only while the knowledge skill is implicitly invocable for
  knowledge repositories;
- the package allowlist, package check, skill layout test, README,
  getting-started guide, and agent instructions (`AGENTS.md`, `CLAUDE.md`)
  name the three skills;
- one vendored `sce.mjs` serves all three; no second executable and no new
  runtime dependency; and
- the `sce` bin and package name stay as they are for 0.x. The engineer name
  is read as the discipline, with software and knowledge as materials; a
  rename is a 1.0 decision.

## Pilot alignment and measures

The runbook's Stage 2 additive foundation maps onto this design directly:

| Runbook item | Provided by |
|---|---|
| Provider-neutral manifest | Repository manifest and shipped schema |
| Root init and doctor binding repo and Drive | Roots read the manifest; unchanged responsibility |
| One provider-neutral launcher: worktrees, claims, landing queue | The engine's controller loop under the knowledge profile |
| Per-task immutable events and rollups | Provenance projection and provenance commit |
| Serial Drive publication | Materialise effect |
| Both roots and both agents discover the pairing | Parity table above |

Stage 3's management rehearsal becomes the profile's live-agent release
evaluation, and its gate remains the runbook's: no shared-index or hot-file
collision, common validation passing for both tools, and the drivers accepting
clarity and performance.

Track trends, not targets:

- claim-to-land time per unit, split into author time, verification time,
  review latency, and controller ceremony;
- landing exceptions per batch and their causes;
- materialise refusals and ambiguities;
- provenance reproducibility failures;
- parity scenario passes for each harness family; and
- model decisions replaced by deterministic checks.

If median controller ceremony for small units exceeds author time across the
rehearsal, that is the evidence for a controller-direct lane or a risk-gated
review skip, recorded as a new decision rather than assumed here.

## Implementation plan

Units are bounded for direct transcription into Beads. Owned paths are
exact; conflict domains decide wave packing.

| Unit | Outcome | Owned paths | Conflict domain | Risk | Verification |
|---|---|---|---|---|---|
| K1 | Digest-bound reviewer packets: the reviewer variant carries the committed `candidateDiffHash`, byte count, bounded stat summary (file count, insertions, deletions), canonical reproduction command, and the unit's worktree path in place of diff bytes; the reducer accepts a packet only when its digest equals the committed hash; closes `sce-cfl` | `src/protocol/schemas.ts`, `src/protocol/reducer.ts`, `src/harness/index.ts`, `src/commands/index.ts`, `test/harness/*`, `test/protocol/*`, `test/cli/cli.test.ts`, `test/fast.manifest.json`, `skills/single-controller-engineer/scripts/sce.mjs` | protocol-core | High | `npm run check` (the harness suite is fast tier) |
| K2 | Journaled bounded exact-OID source resolution and destination-identity probing through a source-specific Git/filesystem executor under `src/adapters/materialise/`; `materialise` with clock-bound exact names and atomic no-clobber filesystem publication; optional target and supersession metadata; recorded knowledge contract; durable provenance membership and authoritative cross-run carry with Beads CAS; aggregate gate state, voids, deferral and legality; complete gate-facing `provenance_commit` and aggregate-verify protocol scaffolding; recovery and CLI admission | `src/protocol/schemas.ts`, `src/protocol/reducer.ts`, `src/protocol/guards.ts`, `src/protocol/actions.ts`, `src/fencing/**`, `src/adapters/materialise/**`, `src/adapters/beads-embedded/**`, `src/adapters/beads-server/**`, `src/commands/index.ts`, `src/commands/recovery.ts`, `src/commands/production-recovery.ts`, `src/cli.ts`, `src/controller-config.ts`, `test/controller-config.test.ts`, `test/commands/recovery.test.ts`, `test/commands/production-recovery.test.ts`, `test/protocol/*`, `test/fencing/**`, `test/adapters/beads-embedded/**`, `test/adapters/beads-server/**`, `test/integration/materialise/*`, `test/fast.manifest.json`, `skills/single-controller-engineer/scripts/sce.mjs` | protocol-core | High | `npm run check`; `npm run test:integration` for the materialise fixture |
| K3 | Provenance record projection from journaled inputs, closure evidence extended with owned paths, acceptance identifiers, and supersessions, `provenance_commit` effect with deterministic author, dates, and key trailer, allowlisted provenance Git operations for building the commit detached, discovering it by key, and landing it under either integration profile, rejected-push handling, deferred carry-forward, rollup generator invocation, one journaled detached worktree per provenance step, created at the landed OID before records are written and preserved as evidence like unit worktrees, serving record writing, generator run, commit build, reproducibility check, and the aggregate-level `verify` gate entry with its null-unit executor path, with recreation of an absent worktree at the observed provenance-commit OID on resume, and recovery admission of the new kind | `src/protocol/evidence.ts`, `src/protocol/schemas.ts`, `src/protocol/reducer.ts`, `src/protocol/actions.ts`, `src/harness/index.ts`, `src/commands/index.ts`, `src/commands/recovery.ts`, `src/commands/production-recovery.ts`, `src/controller-config.ts`, `src/adapters/git/index.ts`, `test/controller-config.test.ts`, `test/commands/recovery.test.ts`, `test/commands/production-recovery.test.ts`, `test/adapters/git/git.test.ts`, `test/harness/*`, `test/protocol/*`, `test/integration/provenance/*`, `test/fast.manifest.json`, `skills/single-controller-engineer/scripts/sce.mjs` | protocol-core | High | `npm run check`; projection determinism test; `npm run test:integration` for the provenance fixture; the release-tier adapter suite for the Git adapter change |
| K4 | Manifest schema and fast-gate templates in the knowledge skill's manifest references, plus a knowledge repository example that uses them: manifest, events and generated directories, instructions | `skills/single-controller-knowledge/references/manifest/**`, `examples/knowledge-repository/**` | examples | Low | Example's own fast gate; `npm run check` |
| K5 | Third skill package: `SKILL.md`, host descriptors, contract references; engineer `SKILL.md` manifest stop; feedback `SKILL.md` wording from pair to set; installer triple; package allowlist; layout test with description disjointness; README and getting-started | `skills/single-controller-knowledge/SKILL.md`, `skills/single-controller-knowledge/agents/**`, `skills/single-controller-knowledge/references/knowledge-contract.md`, `skills/single-controller-knowledge/references/knowledge-severity.md`, `skills/single-controller-knowledge/references/materialisation.md`, `skills/single-controller-knowledge/references/provenance.md`, `skills/single-controller-knowledge/references/repository-manifest.md`, `skills/single-controller-engineer/SKILL.md`, `skills/single-controller-feedback/SKILL.md`, `skills/single-controller-engineer/scripts/sce.mjs`, `src/install/index.ts`, `scripts/package-check.mjs`, `test/eval/skill-layout.test.ts`, `test/install/*`, `test/cli/cli.test.ts`, `test/integration/installer-smoke.test.ts`, `README.md`, `docs/getting-started.md`, `AGENTS.md`, `CLAUDE.md`, `package.json` | skills-packaging | Medium | `npm run check`; `npm run test:package`; `npm run test:integration` for the installer smoke |
| K6 | Knowledge repository two-clone fixture, release-tier materialise evidence on a real Drive for Desktop folder, and release-tier live evaluation of the management rehearsal scenario with handoff scoped to completed and unstarted work | `test/integration/knowledge/**`, `test/release/**`, `scripts/release-gates.mjs` | release-evidence | Medium | `npm run test:integration`; release tier before the next tag |
| K7 | adam-root decision amending DEC-002 sections 2 and 6 and its consequences, DEC-003 section 3 and its consequences, the migration plan, the pilot brief, and the runbook, with Hannah's re-brief; root `init` and `doctor` extended to install and verify `bd`, Dolt, and Node; root skill entry path | Sibling repository; separate authority | external | Low | That repository's checks |

Ordering: K1 and K4 are independent and may share a wave. K2 follows K1 in
the same conflict domain. K3 follows K2. K5 follows K1 through K4 because its
references describe them. K6 follows K5. K7 follows this design landing and
proceeds under adam-root authority. K1, K2, and K3 share the protocol-core
domain and are strictly serial; the parallelism the profile promises its
users does not apply to building the profile. K5 rebuilds the vendored
bundle, which overlaps the protocol-core units' owned path safely because K5
is serial after them.

Acceptance identifiers, one list per unit, for transcription into task
metadata:

- K1: `K1-AC1` the reviewer packet schema binds the committed diff hash, byte
  count, bounded stat summary, command, and worktree path; `K1-AC2` the reducer
  rejects a digest mismatch; `K1-AC3` a realistic candidate no longer fails
  packet generation; `K1-AC4` persisted packet envelopes upcast or refuse
  explicitly; `K1-AC5` fast, typecheck, format, and package gates are green with
  a reproducible bundle.
- K2: `K2-AC1` source-resolution, destination-probe, materialise, gate-facing
  `provenance_commit`, cross-run carry-claim/import, and aggregate-verify schemas are
  strict; materialise parameters carry resolved path and blob facts, alias,
  root, marker, mount and namespace policy, observed destination path/device/
  inode and probe ID, driver, scope, pinned harness family, clock, and complete
  artifact and sidecar destination names, while every actual aggregate event,
  effect, journal entry, deferral, idempotency input, and recovery selector
  carries the stable gate entry ID (the documented pre-gate import is the sole
  non-entry exception), and aggregate verify uses bounded ordered argv vectors
  with canonical Unicode scalar non-NUL arguments without changing the
  unit/software verify branch;
  `K2-AC2` `materialisationTargets` validate a
  canonical bounded glob and mandatory v1 sidecar on task metadata, and the
  knowledge contract admits only unique aliases with pairwise-disjoint
  canonical roots, while software runs without a knowledge contract are
  unchanged and cannot smuggle nonempty targets, and every knowledge wave
  requires a previously recorded harness configuration; the schema-derived
  sidecar upper-bound proof rejects an oversized exact driver before any
  promise; `K2-AC3` gate
  state enforces resolve-probe-clock-materialise ordering and pending blocks,
  immutable original-wave membership and committed/uncommitted provenance
  accounting, retains a knowledge-gate-only reducer-owned current integration
  OID across unit closure and deterministically freezes the provenance base,
  supports
  unit-not-landed, handoff, optional-unmounted,
  empty-projection, controller-deferral, shared-probe and dependent cascade
  voids, keeps required-alias and invalid-destination probe refusals pending,
  and admits no provenance commit while an original unit, target promise,
  probe, or materialisation entry is pending; `K2-AC4`
  target and expanded gate entry IDs derive deterministically, source
  resolution expands every byte-sorted match without controller selection,
  bounded to 64 matches per target, 128 outputs and 64 MiB per wave, uses a
  replacement-disabled sanitized Git context for the exact source OID,
  and positively refuses zero, excessive, non-blob, oversized, unsafe-path, or
  colliding-output results without publication, with the final stage clock
  atomically recording a bounded reducer-derived refusal on every collision
  grouped by observed destination device/inode;
  `K2-AC5` every naming policy
  and the exact sidecar name follow the fixed grammar, the admitted worst case
  and every exact canonical sidecar fit 8,192 bytes, and crash recovery reuses
  both journaled names; `K2-AC6` the materialise fixture covers ordered
  sidecar/artifact publication, identical bytes, either one-file crash state,
  exact temporary replacement, different-byte ambiguity, `EEXIST` readback,
  unsupported hard-link refusal, required and optional alias behavior, shared
  destination probes, physical aliasing, gate-stage reprobe mismatch,
  canonical-path and symlink refusal, replacement-ref and hostile-Git-env
  isolation, crash between intent and observation, inode-bound helper
  admission, and proof no final file is overwritten;
  `K2-AC7` the knowledge contract
  validates and records alias, root, marker, mount policy, driver, scope,
  provenance contract, bounded argv-vector combined-verification commands,
  and gate targets at
  `wave_planned`, including the bounded non-overlapping provenance worktree
  root and env-derived alias roots as the sole root authority, and aggregate
  verify accepts only the recorded commands and exact
  reducer-derived path;
  `K2-AC8` K3 production provenance actions fail closed as unavailable without
  fabricating an observation or corrupting software behavior, provenance
  results are a strict union whose base-advance variant alone automatically
  retries, overlength recovery IDs use the shared domain-separated digest
  fallback without changing legacy IDs that already fit, and authoritative
  same-run and cross-run carry (including a full 64-unit carry-only wave)
  cannot be dropped, replayed, or contradicted; `K2-AC9` focused tests, the materialise
  integration fixture, `npm run check`, and a reproducible bundle pass.
- K3: `K3-AC1` projection is pure and byte-identical for identical journaled
  input; `K3-AC2` commit author, constant email, dates, tree, and trailer derive
  only from journaled facts and the OID is stable across recovery or
  re-execution of the same journaled base and key; a deliberate base-advance
  revision has a new commit OID; `K3-AC3`
  discovery by key and byte-identical record readback observes an existing
  commit without a second act; `K3-AC4` rejected push journals a new intent on
  the new base and ambiguity blocks; `K3-AC5` the reproducibility check runs in
  the journaled preserved worktree before any ref move under both profiles,
  resume admits only clean allowed states and recreates an absent worktree
  through the journaled aggregate-verify act, and deferred provenance carries
  units forward in-run or through the authoritative claimed cross-run and
  carry-only paths; `K3-AC6` each record carries every DEC-002 field and no secret,
  including closure-owned paths, acceptance identifiers, supersessions, and
  each target or materialised destination observed or deferred; `K3-AC7` a run
  without a knowledge contract has no provenance entry and behaves exactly as
  software; `K3-AC8` aggregate verify runs on the provenance-commit OID and tree
  in the preserved worktree and failure qualifies pending gate targets for
  deferral; `K3-AC9` production commands and observations conform to the
  K2-stable strict wire shapes without a parallel contract; `K3-AC10` focused
  tests, provenance integration, `npm run check`, and a reproducible bundle
  pass, while full release Git-adapter evidence remains next-tag only.
- K4: `K4-AC1` the manifest schema rejects unknown keys and validates the
  example; `K4-AC2` every template check runs hermetically under sixty seconds;
  `K4-AC3` a seeded boundary violation and a seeded reproducibility drift each
  fail; `K4-AC4` the example documents its artifact map and mode.
- K5: `K5-AC1` install and uninstall handle the triple atomically and refuse a
  partial set or version skew; `K5-AC2` the layout test validates the third
  skill, its cross-skill relative links, and description disjointness; `K5-AC3`
  both `SKILL.md` files stop on the wrong repository kind and name the sibling;
  `K5-AC4` the package allowlist matches the tarball; `K5-AC5` the docs name
  three skills; `K5-AC6` check and package gates are green.
- K6: `K6-AC1` the two-clone fixture is deterministic and tier-discovered;
  `K6-AC2` every listed failure mode has an assertion; `K6-AC3` the real Drive
  folder evidence records hard-link and fsync behaviour; `K6-AC4` the live
  evaluation records model identities, split timings, and the parity result per
  harness family.

## Rejected alternatives

### A separate knowledge tool

Rejected. The controller slot, reservations, intent-first journal, exact-pair
review binding, compare-and-swap integration, recovery contract, and two
harness families are the expensive, twice-reviewed, crash-tested part of the
engine, and none of them is specific to software. A second implementation
would duplicate that work and then diverge from it.

### Fork the engine

Rejected for the same reason, with the added cost of two release trains and
two Beads stores for one person's work. Divergence would be certain.

### A separate repository depending on the engine as a library

Rejected for version 1. The package exposes one vendored executable, not a
library surface, and the profile seams this design needs do not exist yet; a
dependent repository would still require every engine change listed here. If
the knowledge profile later grows adapters with their own release cadence,
splitting is possible without moving the engine.

### A file-backed tracker instead of Beads

Rejected. The local sign-out sheet is a subset of what reservations, claims,
and the merge slot already provide, and it cannot fence two machines. Building
a second tracker adapter would give the skill two ownership models, which the
parent design already rejected for workers.

### Deterministic-only landing without model review

Rejected for version 1. The runbook's deterministic checks are preserved as
the fast gate and the integration compare-and-swap. Removing the fresh frontier
review would return boundary, contradiction, and support judgments to a human
queue or to nobody. A risk-gated skip remains a measured future decision.

### A Google Drive API adapter in version 1

Rejected. The Drives are mounted; a filesystem adapter with atomic writes and
digest readback delivers one-way publication with no new runtime dependency
and no credential handling in the engine. A provider adapter can implement the
same effect later.

### A profile flag inside the reducer

Rejected. A flag invites conditional transitions and untested combinations.
Every knowledge need in this design is expressed as either a profile-neutral
effect or profile-owned meaning outside the reducer.

### Materialisation as a unit state

Rejected. Adding states to the unit machine for an act that happens after
landing would couple Git closure to Drive availability and enlarge the
exhaustive transition surface. An aggregate-level effect at the wave gate is
journaled, recoverable, and blocks the gate without changing unit legality.

### Uncommitted generated rollups

Rejected. A rollup that exists only when a generator runs is invisible to a
plain clone, a Drive reader, and a reviewer. Committing it and proving
reproducibility mirrors the vendored bundle and turns drift into a failed
check.

### Rename the package now

Rejected. The name is a 1.0 question and a rename during 0.x would churn
installation manifests and documentation for no capability.

## Consequences

The engine gains five effect kinds with their ten intent/observation events,
an aggregate-level use of the existing `verify` effect, a clock observation
event, an authoritative pre-gate carry-import event, a controller deferral
event, a `gate` field on the run aggregate with voided dispositions
(including the cascading provenance deferral), optional targets and supersession
fields on task metadata, immutable wave membership and provenance accounting,
a knowledge contract in the controller configuration recorded at
`wave_planned`, closure evidence extended with the task-metadata facts a record
needs, allowlisted Git operations for the provenance commit, one adapter, one
projection, and a tighter reviewer packet, all profile-neutral and all
journaled where they represent an act. Software runs gain digest-bound review packets and may adopt
provenance records without further design. One preserved worktree per provenance
step joins the preserved unit worktrees; neither is removed by the engine in
version 1, and a journaled cleanup effect for both is a later decision.

Knowledge repositories gain enforced isolation, atomic claims, serialized
landing, fresh review, one-way Drive publication, and Git-committed
provenance, with Beads as the queue and lock. The costs are `bd`, Dolt, and
Node on each driver's machine, the roots' `init` and `doctor` scripts extended
to install and verify that toolchain, a merge slot per domain repository, and
the engine's per-unit ceremony, which the pilot measures rather than assumes.

The migration plan's Stage 5 optional coordination service is answered
early and locally; its shared-server form remains available by decision. The
adam-root wording that excluded Beads from the pilot must be superseded there
under that repository's authority.

The human driver's experience is the pilot brief's promise: one root entry
point, task cards, plain-language stops, and Drive documents where people
expect them. The driver never sees a branch.

The design accepts one boundary honestly: a run belongs to one clone.
Cross-machine continuation is an orderly release and a new run, and in-flight
units are finished or cancelled by the machine that started them. The migration
plan's parity criterion for unfinished work is therefore met only by the
originating run finishing or cancelling; a run pins one harness family, so
in-flight work does not pass between agents either, and the release evaluation
demonstrates handoff of completed and unstarted work. A proven controller lease
remains the parent design's principal future extension and is not required by
this profile; a discover-and-adopt effect for in-flight handoff is a possible
later decision.

The pilot brief assured Hannah that no Beads, Dolt, VPS, or Tailscale change
was involved. Adopting embedded Beads reverses the Beads and Dolt half of
that assurance, so the adam-root follow-up includes a re-brief and Hannah's
re-acknowledgement, not only a document edit.

## Follow-up

- `sce-9f5.2` seeds the implementation epic and units K1 through K6 in Beads
  once this design lands.
- `sce-9f5.3` records the adam-root decision and root entry path (K7) under
  that repository's authority.
- `sce-cfl` is promoted to P1 and becomes a dependency of K1.
