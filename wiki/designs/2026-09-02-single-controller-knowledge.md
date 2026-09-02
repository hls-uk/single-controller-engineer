# Single-Controller Knowledge

**Date:** 2026-09-02
**Status:** Amended through successive fresh frontier reviews; accepted with
DEC-20260902-011
**Architecture authority:**
[Single-Controller Engineer](2026-08-24-single-controller-engineer.md)
**Delivery companion:**
[Accelerated Beta Engineering](2026-08-25-accelerated-beta-engineering.md)
**External inputs:** `vdb-uk/adam-root` DEC-002 (agent-safe knowledge
collaboration), DEC-003 (projects compose access-domain repos and partnered
Drives), `wiki/projects/agent-knowledge-migration.md`, and the IWPRB
Git-and-Drive pilot technical runbook
**Controller decisions:**
[DEC-20260902-011](../decisions/2026-09-02-011-knowledge-profile-extends-engine.md)
**Beads:** `sce-9f5`

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
supersession fields on task metadata, gate state on the run aggregate with
voided dispositions, the existing `verify` effect extended to admit a null
unit for the wave's combined verification, a clock observation event, closure
evidence extended with the task-metadata facts a record needs, and a
knowledge contract in the controller configuration.

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
pilot brief, and runbook; the reasons are recorded below and in
DEC-20260902-011.

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
task definitions and outcomes, and agent-authored Markdown masters. Google
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
journals the complete destination name, the adapter performs an ordered pair
of atomic renames to that name, and a strict readback is recorded. A
destination that already exists with different bytes is ambiguous and blocks;
it is never overwritten.

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
| Materialisation | | `materialise` effect with clock-bound destination names, filesystem adapter | Destination policy, naming, sidecar fields |
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
alias table (alias, canonical root, marker file, mount policy), the
provenance contract (events directory, record format version, rollup
generator command, reproducibility command), the human driver, the domain
scope, and the gate targets. The controller derives it from the repository
manifest when composing the configuration; the engine never reads the
manifest. The `wave_planned` event carries the contract and the reducer
records it in the run aggregate, so every later gate decision is a function
of aggregate state. A run without a knowledge contract creates no provenance
entry and no gate targets and gates exactly as today; that is how software
runs remain unchanged.

## Artifact classes and canonical homes

The DEC-003 artifact map, expressed in engine terms:

| Artifact | Canonical home | Engine treatment |
|---|---|---|
| Agent instructions, skills, scripts, templates | Domain Git repository | Owned paths |
| Wiki topics, decisions, workflows, entities | Domain Git repository | Owned paths |
| Agent-authored Markdown masters | Domain Git repository | Owned paths; human-edited exceptions classified in the manifest |
| Task definitions, claims, execution state | Embedded Beads in the domain repository | Root and child Beads, reservations, merge slot |
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
  the local mount path variable the controller configuration resolves;
- the canonical home of each artifact class, including the events and
  generated directories;
- the boundary policy: allowed write roots, forbidden paths, and forbidden
  content markers for this audience;
- fast, integration, and release verification commands;
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
each naming a destination alias, a source path pattern in the landed tree, a
naming policy, and whether a sidecar is required; and `supersedes` and
`tombstones`, lists of provenance record identifiers, so supersession is a
validated fact the projection reads rather than a note. Both are committed
with the wave plan, so the wave gate's promise set and every record's
supersession links are aggregate state the reducer owns, never facts the
controller remembers. The profile adds conventions in the design and notes
fields for facts the engine does not execute:

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
that repository's authority (`sce-9f5.3`). Until it lands, the migration plan
text stands as written there and this design records the intended change.

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

A `materialise` intent binds the run, the source OID, the source path in that
tree, the destination alias with its canonical root, marker file, and mount
policy from the knowledge contract, the human driver and domain scope, and the
**complete destination name**, so that every fact the adapter and the sidecar
use enters the parameters hash. The name is computed inside the intent, not by
the adapter: a stable slug, the short source OID, and a UTC timestamp taken from
a validated clock observation event bound to the intent. The idempotency key is
derived from those journaled facts. A crash after the act therefore resumes
against the same name and compares bytes; it never mints a second name.

The version 1 adapter is a filesystem adapter against a Drive for Desktop
folder:

1. resolve the destination root from the controller configuration by alias;
   require that its canonical real path equals the configured path, that it
   is a directory, and that the manifest-declared marker file for that alias
   is present in it, because a missing marker means the Drive is not mounted;
2. if either journaled destination name already exists, read back what is
   there: artifact and sidecar both identical to the intent facts is an
   already-observed act; artifact identical and sidecar missing completes the
   sidecar from the same intent facts and then observes; sidecar identical
   and artifact missing continues to the artifact write; any other state,
   including different bytes in either file, records `ambiguous` and blocks;
3. otherwise write the sidecar, then the artifact, each to a temporary name
   derived deterministically from its journaled destination name with a dot
   prefix and a fixed suffix, inside the destination directory; a leftover
   temporary with exactly that name from a crashed attempt is replaced,
   because it is never a published object, and nothing else in the directory
   is touched; fsync each and rename each atomically, sidecar first so an
   artifact never exists without its provenance; and
4. read back size and sha256 of both files and record the observation.

Dot-prefixed temporary names keep partial writes out of Drive views. Rename
and fsync semantics on a synced folder are not those of a local filesystem,
so the atomicity claim is release-tier evidence on a real mounted Drive (K6),
not an assumption.

The sidecar names the unit or wave, run identity, source OID, source path,
sha256, driver, executor tool, and timestamp, so a Drive reader can trace any
generated file to its Git object without Beads access. The driver and scope
are read from the journaled intent, where the controller configuration placed
them; the timestamp is the intent's clock observation.
Generated Drive directories are marked generated in their own instructions;
reverse edits are never read back into Git. The adapter never overwrites,
deletes, moves, or lists beyond its destination directory.

A Google Drive API adapter, if ever added, implements the same effect with
provider object identifiers as its readback. It is a separate decision with
its own release evidence.

### 8. Record provenance

New. At the wave gate the controller emits one `provenance_commit` intent. The
runtime projects the closure evidence of each unit closed as landed, its
unit-target materialise observations, and the named run inputs to a canonical
Markdown
record with a stable identifier, writes the records under the events
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
worktree at the landed integration OID, at a deterministic path derived from
the provenance intent's idempotency key, through an allowlisted
`worktree add --detach` that takes the exact OID; the intent journals that
path. Inside the worktree the runtime writes the records under the events
directory, runs the rollup generator the knowledge contract declares, builds
the commit object from the resulting tree, and points the worktree's
detached HEAD at that object, which moves no branch ref. It then runs the
reproducibility check the contract declares in the same worktree against
that tree: regenerate rollups and views and require no diff, and validate
every record under the events directory. A failing check is the
`provenance_commit` effect's `refused` observation, carrying the checked tree
and the reason, with no ref moved; the worktree is preserved as evidence,
and the entry stays pending until the controller repairs the generator
through a unit in a later wave, which requires deferring the entry to a
follow-up Bead as the wave gate section describes. Only after the check
passes is the local integration ref fast-forwarded or the remote pushed
without force, then read back, under either integration profile.

The same worktree, at the provenance-commit OID, is the working directory of
the wave's aggregate verification, which is a gate entry of its own;
`verification_failed` is reserved for that entry. The worktree is preserved
on `verification_failed` and removed only after the verify entry is observed
or voided; the removal is carried by that observation, so a crash between
them resumes into a preserved worktree. On resume, an existing worktree at
the journaled path is admitted only when its HEAD equals the journaled OID
and its tree is clean; any other state is refused and preserved for a human
decision.

Discovery on resume is by key: fetch the integration branch and look for a
commit whose trailer carries the key; if present, verify the record paths at
that commit are byte-identical to the projection and record the observation.
If the non-force push is rejected because the base advanced, the intent is
observed as rejected, a new intent is journaled on the new base with a new
key, and the projection runs again; the rejected attempt is never retried
blind. An ambiguous outcome blocks.

This is the one commit on the integration branch that carries no unit
identity and no review. It is exempt from "one identity per causal unit"
because it is a pure projection of already-reviewed, already-landed evidence
whose bytes the engine proves, not a change a model authored; this
repository already lands unreviewed commits of its Beads interaction records
in the same way.

The projection's inputs are validated schemas only: closure evidence, which
K3 extends to retain the task-metadata facts a record needs (owned paths,
acceptance identifiers, supersessions) after the unit leaves the live map;
the unit's materialise observations; and the intent's own parameters, which
carry the human driver, the domain scope, the alias table, the provenance
contract, and the clock observation. Those values originate in the
controller configuration but the projection reads them from the journaled
intent, never from live configuration, so the same run store always projects
the same bytes. Nothing is read from prose or the conversation.

A provenance record contains at least the fields DEC-002 requires: a globally
unique identifier, project and domain scope, human driver, executor tool and
session identity where available, UTC timestamp, base and landed OIDs, owned
paths, verification commands and results, review verdict binding, materialised
destinations and digests, and superseded or tombstoned records. It never
contains secrets, transcripts, or narrative beyond the bounded `WorkerResult`
summary.

The engine's fast suite proves byte-identical output for identical input, and
the knowledge repository's fast gate proves every committed record still
validates and binds an OID in the branch history.

### 9. Gate the wave

The wave gate gains aggregate state. The repository run carries a `gate`
field holding, for the current wave, the unit-target materialisations, the
provenance commit, and the gate-target materialisations, each with its effect
identifier and a status of `pending`, `observed`, or `voided`. The reducer
populates them from committed task metadata and from the knowledge contract
recorded at `wave_planned`; the provenance entry and the gate-target entries
exist only when the contract declares them, and the controller supplies
nothing from memory. Ordering within the gate is fixed: unit targets, then
the provenance commit, then combined verification on its OID, then gate
targets. Their events are `materialise_intent` and `materialise_observed`, and
`provenance_commit_intent` and `provenance_commit_observed`, all following the
existing intent-then-observation pattern with `ambiguous` as a first-class
outcome. Combined verification is itself a gate entry: the existing `verify`
effect kind, extended to admit a null unit, emitted at aggregate level with
the provenance step's journaled detached worktree as its working directory,
bound to the provenance-commit OID and tree, and reusing
`verification_observed` and `verification_failed`. Like
the provenance entry and the gate targets, it exists only when the knowledge
contract is present, so a run without one gates exactly as today. The
gate-green predicate therefore reads observations and never a controller's
memory.

A gate entry can never wedge a run, because every way it can fail to be
observed has a reducer-owned `voided` disposition with a validated reason:

- `unit_not_landed`: the unit closed as failed, timed out, parked, or
  cancelled, so it has no landed OID; the reducer voids its unit targets at
  closure from aggregate state alone;
- `handoff_boundary`: the run's completion boundary is a branch or pull
  request handoff, so there is no landed integration OID and no integrate
  authority; the reducer records the provenance commit, the aggregate verify
  entry, and every gate target as void at `wave_planned`, and unit targets
  as void at closure; and
- `optional_alias_unmounted`: the alias is declared optional and the adapter
  observed the marker file absent; this is an adapter observation recorded
  through `materialise_observed`, never an inference; and
- `no_landed_units`: the wave closed no unit as landed, so there is nothing
  to project or verify; the reducer voids the provenance entry, the aggregate
  verify entry, and the gate targets from aggregate state alone; and
- `deferred_by_controller`: the entry's last effect, or the wave's aggregate
  verification on the provenance-commit OID, is a positive `refused`
  observation or a `verification_failed` observation, and the controller has
  recorded a follow-up Bead for the repair; the event carries that Bead
  identifier, and the reducer admits it only from those observed states,
  never from `pending` or `ambiguous`.

A required alias whose marker is absent is observed as `refused` with nothing
written; the entry stays pending and blocks the gate until the controller
either mounts the Drive and journals a new intent, which is legal because the
refusal positively proves that no act occurred, or defers the entry to a
follow-up Bead. A deferred provenance commit carries its units forward: the
next wave's provenance commit projects every unit closed as landed whose
record has not yet been committed, and its idempotency key binds that full
set. Carry-forward is bounded by the closed-unit ledger: the reducer refuses
to plan a wave whose closures could exceed the ledger while records remain
uncommitted, and blocks for a human decision. A deferred unit or gate target
is republished by a later intent when the controller declares it again.

Legality rules for `next`: while any gate entry is pending, `wave_planned` and
`controller_release_intent` are illegal, and the existing ambiguity-recovery
actions expose the pending or ambiguous gate effects for observation. An
ambiguous gate effect moves the aggregate to the existing `blocked` state and
is recovered through the existing ambiguity path. The gate is green when every
entry is observed or voided and reservations are released; the aggregate
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

- strict schema tests for the `materialise` and `provenance_commit` effect
  kinds, their parameter and observation envelopes, and the digest-bound
  reviewer packet, including unknown-key rejection and byte limits;
- reducer traces proving no materialise effect before the unit is landed, no
  provenance commit without every unit materialisation observed or voided, no
  `wave_planned` or controller release while a gate entry is pending, voided
  dispositions for a unit closed without landing, a handoff boundary, an
  optional unmounted alias, an empty landed set, and a controller deferral
  admitted only from a refused or verification-failed observation, a
  required-alias refusal that keeps its entry pending, no gate target before
  the aggregate verification on the provenance-commit OID is observed, every
  pending gate target deferrable after that verification fails, no
  provenance, verify, or gate-target entry for a run without a knowledge
  contract, the verify entry voided with the provenance entry when no unit
  landed and under a handoff boundary, the provenance worktree preserved on
  refusal and on failed verification and removed only by the verify
  observation, resume against the
  journaled destination name after a crash, no approval on a digest mismatch,
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
  sidecar-then-artifact atomic writes, identical-bytes idempotency, missing
  sidecar completion, sidecar-only crash continuation, leftover temporary
  replacement, different-bytes ambiguity in either file, required-alias
  refusal, optional-alias void observation, canonical path refusal, and crash
  between intent and observation; and, at release
  tier, the same adapter against a real Drive for Desktop folder to establish
  rename and fsync behaviour on a synced directory;
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
| K2 | `materialise` effect kind with clock-bound destination names, parameter and observation schemas, optional `materialisationTargets`, `supersedes`, and `tombstones` on task metadata, the knowledge contract in the controller configuration recorded at `wave_planned`, gate state on the run aggregate with voided dispositions (including empty landed set and controller deferral) and legality rules, unit and gate emission points, filesystem adapter, CLI command | `src/protocol/schemas.ts`, `src/protocol/reducer.ts`, `src/protocol/guards.ts`, `src/protocol/actions.ts`, `src/adapters/materialise/**`, `src/commands/index.ts`, `src/cli.ts`, `src/controller-config.ts`, `test/controller-config.test.ts`, `test/protocol/*`, `test/integration/materialise/*`, `test/fast.manifest.json`, `skills/single-controller-engineer/scripts/sce.mjs` | protocol-core | High | `npm run check`; `npm run test:integration` for the materialise fixture |
| K3 | Provenance record projection from journaled inputs, closure evidence extended with owned paths, acceptance identifiers, and supersessions, `provenance_commit` effect with deterministic author, dates, and key trailer, allowlisted Git operations for building the commit detached, discovering it by key, and landing it under either integration profile, rejected-push handling, deferred carry-forward, rollup generator invocation, one journaled detached worktree per provenance step, created at the landed OID before records are written and persisting until the aggregate verify entry is observed or voided, serving record writing, generator run, commit build, reproducibility check, and the aggregate-level `verify` gate entry with its null-unit executor path | `src/protocol/evidence.ts`, `src/protocol/schemas.ts`, `src/protocol/reducer.ts`, `src/harness/index.ts`, `src/commands/index.ts`, `src/controller-config.ts`, `src/adapters/git/index.ts`, `test/controller-config.test.ts`, `test/adapters/git/git.test.ts`, `test/harness/*`, `test/protocol/*`, `test/integration/provenance/*`, `test/fast.manifest.json`, `skills/single-controller-engineer/scripts/sce.mjs` | protocol-core | High | `npm run check`; projection determinism test; `npm run test:integration` for the provenance fixture; the release-tier adapter suite for the Git adapter change |
| K4 | Manifest schema and fast-gate templates in the knowledge skill's manifest references, plus a knowledge repository example that uses them: manifest, events and generated directories, instructions | `skills/single-controller-knowledge/references/manifest/**`, `examples/knowledge-repository/**` | examples | Low | Example's own fast gate; `npm run check` |
| K5 | Third skill package: `SKILL.md`, host descriptors, contract references; engineer `SKILL.md` manifest stop; feedback `SKILL.md` wording from pair to set; installer triple; package allowlist; layout test with description disjointness; README and getting-started | `skills/single-controller-knowledge/SKILL.md`, `skills/single-controller-knowledge/agents/**`, `skills/single-controller-knowledge/references/knowledge-contract.md`, `skills/single-controller-knowledge/references/knowledge-severity.md`, `skills/single-controller-knowledge/references/materialisation.md`, `skills/single-controller-knowledge/references/provenance.md`, `skills/single-controller-knowledge/references/repository-manifest.md`, `skills/single-controller-engineer/SKILL.md`, `skills/single-controller-feedback/SKILL.md`, `skills/single-controller-engineer/scripts/sce.mjs`, `src/install/index.ts`, `scripts/package-check.mjs`, `test/eval/skill-layout.test.ts`, `test/install/*`, `test/cli/cli.test.ts`, `test/integration/installer-smoke.test.ts`, `README.md`, `docs/getting-started.md`, `AGENTS.md`, `CLAUDE.md`, `package.json` | skills-packaging | Medium | `npm run check`; `npm run test:package`; `npm run test:integration` for the installer smoke |
| K6 | Knowledge repository two-clone fixture, release-tier materialise evidence on a real Drive for Desktop folder, and release-tier live evaluation of the management rehearsal scenario with handoff scoped to completed and unstarted work | `test/integration/knowledge/**`, `test/release/**`, `scripts/release-gates.mjs` | release-evidence | Medium | `npm run test:integration`; release tier before the next tag |
| K7 | adam-root decision superseding the no-Beads pilot scoping; root `init` and `doctor` extended to install and verify `bd`, Dolt, and Node; root skill entry path | Sibling repository; separate authority | external | Low | That repository's checks |

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
- K2: `K2-AC1` the effect kind, parameter, and observation schemas are strict
  and the parameters carry alias, root, marker, mount policy, driver, scope, and
  the complete destination name; `K2-AC2` `materialisationTargets` validate on
  task metadata and software runs without them are unchanged; `K2-AC3` gate
  state blocks `wave_planned` and release while pending, voids entries for a
  unit closed without landing, a handoff boundary, an optional unmounted alias,
  and an empty landed set, admits controller deferral only from a refused or
  verification-failed observation with a follow-up Bead, including every pending
  gate target after the aggregate verification fails, voids the verify entry
  with the provenance entry when no unit landed and under a handoff boundary,
  and keeps a required-alias refusal pending; `K2-AC4` the adapter fixture
  covers every listed failure mode including the sidecar-only crash state and
  leftover temporary replacement; `K2-AC5` resume after a crash reuses the
  journaled name; `K2-AC6` the knowledge contract validates alias, root, marker,
  mount policy, driver, scope, provenance contract, and gate targets, and is
  recorded at `wave_planned`; `K2-AC7` gates green with a reproducible bundle.
- K3: `K3-AC1` the projection is pure and byte-identical for identical input;
  `K3-AC2` the commit's author, email, dates, tree, and trailer are derived from
  journaled facts only and its OID is stable across attempts; `K3-AC3` discovery
  by key observes an existing commit without a second act; `K3-AC4` a rejected
  push journals a new intent on the new base; `K3-AC5` the reproducibility check
  runs in the journaled provenance worktree and blocks before any local or
  remote ref moves, under both integration profiles, the worktree persists until
  the verify entry is observed or voided and a resume admits it only clean at
  the journaled OID, and a deferred provenance entry carries its units into the
  next wave's commit; `K3-AC6` the record carries every DEC-002 field and no
  secret, reading owned paths, acceptance identifiers, and supersessions from
  extended closure evidence; `K3-AC7` gates green with a reproducible bundle;
  `K3-AC8` a run without a knowledge contract has no provenance entry and gates
  exactly as before; `K3-AC9` the aggregate `verify` gate entry is bound to the
  provenance-commit OID, runs in the persisted provenance worktree, carries the
  worktree removal in its observation, and its failure qualifies pending gate
  targets for deferral.
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
  folder evidence records rename and fsync behaviour; `K6-AC4` the live
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

The engine gains two effect kinds with their four events, an aggregate-level use
of the existing `verify` effect, a clock observation event, a `gate` field on
the run aggregate with voided dispositions, optional targets and supersession
fields on task metadata, a knowledge contract in the controller configuration
recorded at `wave_planned`, closure evidence extended with the task-metadata
facts a record needs, allowlisted Git operations for the provenance commit, one
adapter, one projection, and a tighter reviewer packet, all profile-neutral and
all journaled. Software runs gain digest-bound review packets and may adopt
provenance records without further design.

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
