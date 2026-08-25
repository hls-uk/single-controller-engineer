# Accelerated Beta Engineering

**Date:** 2026-08-25
**Status:** Normative delivery companion
**Applies to:** this repository and software delivered with the
`single-controller-engineer` skill
**Companion:** [Single-Controller Engineer](2026-08-24-single-controller-engineer.md)
**Controller decisions:** [Decision records](../decisions/README.md)

## Decision

The default delivery profile is **accelerated beta**: deliver useful software
that works on its core paths as soon as possible, expose its limitations, and
improve it through real use. Beta means operational and supportable, not
perfect, exhaustive, or free of known non-critical defects.

This document is authoritative when the companion design conflicts with it on
delivery cadence, test frequency, review frequency, severity thresholds, or
whether speculative hardening blocks a beta candidate. The companion design
remains authoritative for architecture, ownership, authority, privacy,
secrets, fencing, non-force integration, and topology safety. Speed never
grants authority or permits destructive repair.

## Engineering principles

### 1. Prefer deterministic code over inference

Use a model only where judgment is the point of the work. Closed-input acts
belong in typed, testable code.

Prefer, in order:

1. schemas and bounded parsers;
2. pure reducers, decision tables, and state machines;
3. generated manifests, hashes, and exact comparisons;
4. allowlisted adapters with structured results;
5. model inference for decomposition, implementation, diagnosis, product
   judgment, and adversarial review.

Never ask a model to remember or infer facts that Git, Beads, a schema, a
provider readback, or a deterministic program can establish. Ambiguous
machine state blocks the affected action; it does not invite a guess.

Determinism is an economic control as well as a correctness control. Reusable
code reduces prompt size, repeated reasoning, token usage, and behavioral
variance while leaving models available for the work where they add the most
value.

### 2. Optimise for time to a working beta

Choose the smallest coherent vertical slice that exercises a real user path.
Implement the core use cases before broad option surfaces, speculative
abstractions, uncommon providers, or exhaustive failure combinations.

A candidate may ship with documented P2 defects, missing conveniences, or
deferred hardening. It may not ship with a known P0 or P1 defect in a promised
core path.

When new work appears, classify it before expanding scope:

- **P0:** data loss, destructive or unauthorized action, secret exposure, or
  systemic inability to use the product. Blocks immediately.
- **P1:** broken core use case, unsafe duplicate effect, invalid ownership or
  integration, or a common-path failure without a practical workaround.
  Blocks the beta candidate.
- **P2:** bounded edge case, hardening, usability defect with a workaround, or
  non-core provider limitation. Record durably and continue.
- **P3:** polish, optimisation, or speculation. Defer unless it is nearly free
  and cannot delay the candidate.

Severity is determined by user impact and authority risk, not by how
interesting a defect is to investigate.

### 3. Keep the primary feedback loop lean

The primary suite exists to help an implementer make the next correct change
quickly. It must be deterministic, hermetic, focused on core behavior, and
fast enough to run repeatedly.

The default primary gate contains:

- formatting and static checks;
- type checking;
- unit tests for deterministic contracts;
- focused tests for the changed unit; and
- a compact set of core-use-case tests.

Primary tests must not require a network, external account, long-lived server,
multiple real clones, provider publication, broad crash matrices, or sleeps.
The target is under ten seconds for a focused unit loop and under sixty
seconds for the repository fast gate on a normal development machine. If a
test makes the primary gate materially slower, keep only a representative
core assertion there and move the broader matrix to a secondary suite.

Do not pursue coverage percentage as a release objective. Test important
decisions, invariants, public behavior, and regressions. Avoid duplicating the
same assertion at many layers.

### 4. Separate secondary and release evidence

Slow tests remain valuable; they run at a lower frequency.

Use three explicit tiers:

| Tier | Purpose | Default trigger | Blocking |
| --- | --- | --- | --- |
| Fast | Types, units, core paths | Every implementation unit | Yes |
| Integration | Affected adapters and real seams | Ad hoc or when that seam changes | Only for the affected candidate |
| Release | Full E2E, topology, crash/concurrency, install, package, provider and upgrade evidence | Once before the next tagged version | Yes for the tag |

Integration and release suites must be directly invokable and deterministically
discovered, but they must not hide inside the default fast command. Optional
scheduled runs may expose drift earlier; their absence must not stop ordinary
beta iteration.

A slow failure blocks only the capability or release whose evidence it
invalidates. Record the exact failure, make an explicit severity decision, and
avoid repeatedly rerunning unaffected suites.

### 5. Parallelise implementation, not authority

One controller owns the queue, tracker mutations, integration order, and
release judgment. It may fan out up to three independent workhorse
implementation lanes when their ownership can be expressed with disjoint
paths or stable interfaces.

To preserve throughput:

- stabilise the narrow shared contract first;
- give each workhorse a bounded outcome and owned paths;
- let independent implementation proceed in parallel;
- use fast focused checks inside each lane;
- integrate one exact candidate at a time; and
- use a fresh frontier reviewer on a frozen candidate, not on every edit.

Batch related review repairs before producing the next exact candidate.
Re-review when a repair changes the reviewed object and a P0/P1 decision still
depends on it. Record P2 findings without forcing an unbounded review loop.

Do not delegate a tiny unit when coordination would take longer than direct
implementation. Parallelism is a throughput tool, not a target.

### 6. Keep evidence compact and decision-oriented

Durable evidence must let another controller resume safely without replaying
the conversation. Record:

- the issue and decision;
- exact candidate and integration object identifiers where relevant;
- the fast gate result;
- affected integration or release results actually run;
- P0/P1 disposition;
- deferred P2/P3 work; and
- blockers or missing authority.

Substantive human controller decisions live with the source under
[`wiki/decisions`](../decisions/README.md). Beads stores the execution state and
links to the decision ID/path. The runtime effect journal remains the machine
record of side-effect intent and observation. Do not duplicate one decision's
full rationale across all three surfaces.

Do not store verbose transcripts, secrets, repeated test output, or narrative
that does not change the next action. Prefer structured summaries and hashes
over prose duplication.

### 7. Use existing tools before building a framework

Prefer a thin deterministic wrapper around established repository, Git,
Beads, package, test, and provider capabilities. Add a new abstraction only
when it removes repeated inference, makes an authority boundary executable,
or supports more than one immediate core use case.

Do not rewrite working code merely to reach an ideal architecture during beta
delivery. Refactor when the current shape blocks a core path, makes safe change
unreasonably difficult, or creates repeated defects.

## Accelerated delivery loop

1. Read the repository contract and authoritative Beads state.
2. Define the beta's promised core use cases and explicit non-goals.
3. Convert closed decisions into deterministic schemas, reducers, adapters,
   manifests, or checks.
4. Split at most three genuinely independent implementation lanes.
5. Run fast focused gates in each lane and repair failures locally.
6. Serialize integration against the current exact base.
7. Freeze a candidate and obtain one fresh frontier review focused on P0/P1.
8. Batch blocker repairs; log P2/P3 follow-up rather than expanding the wave.
9. Run affected integration evidence and one real smoke for each capability
   promised by the candidate.
10. Deliver the beta, read back its durable state, and learn from feedback.

Run the full release tier before the next tagged version, not before every
untagged candidate or internal integration.

## Beta definition of done

A beta candidate is done when:

- its named core use cases work through their public entry points;
- the fast suite passes and remains within its documented budget;
- affected integration tests and representative real smokes pass;
- no known P0/P1 remains in a promised capability;
- a fresh frontier review of the frozen candidate has no unresolved P0/P1;
- known P2/P3 limitations are visible in Beads or release documentation;
- installable artifacts agree with their reviewed sources;
- authority, secrets, privacy, and non-destructive integration boundaries are
  preserved; and
- Git, Beads/Dolt, package, and publication state are reported honestly.

This definition does not require every theoretical interleaving, provider,
upgrade history, or fault combination to pass before users can exercise the
beta.

## Resulting skill contract

The `single-controller-engineer` skill must make this profile its default and
teach consuming agents to:

- state the core beta slice and non-goals before implementation;
- select deterministic mechanisms before model inference;
- maintain separate fast, integration, and release commands or manifests;
- keep the fast command lean as the repository grows;
- schedule slow evidence according to change impact and tag cadence;
- use up to three workhorse implementers and a fresh frontier reviewer;
- treat P0/P1 as blockers and P2/P3 as durable follow-up;
- record substantive human controller decisions with the adopting repository's
  source-controlled decision records, using `wiki/decisions` when it has no
  established convention;
- deliver a working candidate instead of silently pursuing perfection; and
- request authority before publication or externally visible mutation.

Repositories may tighten this profile explicitly. The skill must not silently
replace an adopting repository's stronger security, regulatory, release, or
test requirements with beta defaults.

## Measures

Track trends rather than impose vanity targets:

- elapsed time from claim to working candidate;
- duration and stability of the fast suite;
- number of model decisions replaced by deterministic mechanisms;
- P0/P1 findings before and after release;
- slow-suite failures that would have affected a tagged version; and
- deferred work closed because real feedback showed it mattered.

The desired outcome is shorter lead time without an increase in escaped
authority, privacy, secret, destructive-action, or core-path failures.
