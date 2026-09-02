# single-controller-engineer

`@hls-uk/single-controller-engineer` ships a deterministic Node 22 CLI (`sce`)
and a paired set of agent skills — `single-controller-engineer` and
`single-controller-feedback` — for delivering software through one
decision-making AI controller, a Beads-backed work queue, and fresh, bounded
implementation and review agents.

## What it creates

This package is not a code generator. It is an orchestration protocol engine:
installed into an agent harness (Codex or Claude families), it drives an
engineering run that delivers **working beta software in an adopting
repository** — small vertical slices whose core use cases work through their
public entry points, landed as reviewed, integrated Git changes with durable
evidence (test results, review verdicts, exact object IDs) recorded in Beads.

It works in any Git repository that uses the [Beads](https://github.com/gastownhall/beads)
issue tracker, whether a solo embedded database or a shared team server. The
adopting repository's own branch, test, review, and authority conventions are
discovered and respected, not replaced.

## How it works

The design splits every action along one boundary: **models decide meaning;
code decides state.**

- **One controller.** A single frontier-tier controller owns decomposition,
  Beads mutations, dispatch, verification gates, publication, and integration.
  It holds a repository-wide controller slot fenced to the Beads store, Git
  repository, and integration branch, so two controllers can never integrate
  concurrently.
- **Up to three workhorse lanes.** Implementation fans out to at most three
  independent workhorse agents, each in an isolated worktree cut from the same
  verified base, with disjoint owned paths and reserved resources. Three is a
  cap, not a target.
- **Serialized review and integration.** Candidates queue for qualification
  one at a time. Each frozen candidate gets a fresh frontier review bound to
  its exact base/head pair; any movement of either object invalidates the
  verdict. Integration lands through the repository's protected
  compare-and-swap contract and is read back before the next candidate.
- **A typed protocol core.** A pure reducer over runtime-validated schemas
  (`reduce(state, event) -> { next_state, effects }`) owns every closed-input
  protocol act. Adapters execute its typed effects against Git, `bd`, GitHub,
  and the agent harness, then return validated observations. Every external
  side effect is journaled intent-first, so a crashed or compacted run resumes
  from readbacks rather than conversation history.
- **Capability-based model routing.** Controller and reviewers require a
  frontier tier; implementers and diagnosis use a workhorse tier. Requested
  and returned model identities are recorded, and there is no silent
  downgrade. Each harness family is admitted with an explicit trust
  classification rather than an assumed one: the Codex-family example declares
  every trust operation and classifies as crash-safe dispatch with proven tier
  enforcement, while the Claude-family example
  (`examples/controller-config.claude-embedded.json`) classifies as
  at-most-once-manual dispatch recovery with tier enforcement unavailable — an
  ambiguous launch blocks for a human-bound observation instead of
  redispatching, and any path needing a proven tier fails explicitly.

Delivery follows the **accelerated-beta** policy: prefer deterministic typed
checks over inference, ship the smallest coherent vertical slice, and expose
limitations rather than pursuing silent perfection. `P0`/`P1` findings block
promised core paths; bounded `P2`/`P3` work is recorded as follow-up.

## The CLI and skill pair

The TypeScript build produces one self-contained executable,
`skills/single-controller-engineer/scripts/sce.mjs`, vendored inside the
primary skill and exposed as the `sce` bin. The CLI is a stepwise, idempotent
protocol engine, not a daemon: `sce next --json` computes the legal actions
from authoritative Git and Beads facts, and commands such as `preflight`,
`plan-wave`, `qualify`, `review-prepare`, `integrate`, and `resume` persist
intent before effects and reject stale or illegal transitions.

The primary skill, `single-controller-engineer`, teaches the controller loop
and routes to topology-specific references (embedded Dolt with Git-remote
sync, or a shared Dolt SQL server) proven during preflight. The companion
skill, `single-controller-feedback`, prepares privacy-bounded upstream bug and
enhancement reports; preparation and preview are local, and any submission
requires separate current authority.

## Development and evidence

```sh
npm run test:fast          # deterministic units and core paths
npm run test:integration   # affected seams only
npm run test:package       # offline lifecycle-disabled npm tarball inspection
npm run test:release       # release-only aggregate; includes the slow checklist
npm run check              # format check + typecheck + fast tests + package check + build
```

Evidence is tiered deliberately: the fast suite runs on every implementation
unit and stays under a minute; integration suites run when their seam changes;
the full release tier (topology, crash/concurrency, provider, package, and
live-agent evidence) runs once before the next tagged version. Live-agent
evaluations are non-hermetic release evidence, not a CI substitute for
deterministic fencing.

## Installation and authority

For step-by-step setup in an existing repository, see
[docs/getting-started.md](docs/getting-started.md).

The CLI's `install-skill` integration is intentionally explicit: it installs
the primary and feedback skills as one manifest-hashed pair, refusing an
unrelated collision, partial pair, changed owned files, or cross-filesystem
staging. npm has no `postinstall` side effect and does not download a CLI at
runtime.

Claude Code is a supported install host alongside Codex: both skills ship an
`agents/claude.yaml` beside `agents/openai.yaml`, and one
`sce install-skill --destination <absolute path>` installs the same
manifest-hashed pair for either host. The installer itself is host-agnostic,
so `--host` is optional — when declared it is validated as exactly `codex` or
`claude` and recorded in the result, never a separate code path.

Being an install host is not a claim about dispatch. The Claude harness family
is defined, classified, and deterministically tested — its example
configuration is admitted by the strict parser and its capability matrix is
covered by unit tests — but its live-agent release evaluation is still pending,
so dispatch and telemetry support for that family is not advertised yet. The
host and classification decisions are recorded in
[DEC-20260901-008](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/decisions/2026-09-01-008-claude-code-harness-host.md)
and
[DEC-20260901-009](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/decisions/2026-09-01-009-classified-harness-support-profiles.md).

Authority is profiled, never assumed. A run records one explicit profile —
`local-change-only`, `push-branch`, `open-pr`, or `integrate` — and stops at
its completion boundary. Publishing, tags, pushes, issue mutation, and
feedback submission all need separate current authority, and no profile grants
deployment, release, or destructive actions.

## Design documents

The governing contracts live in the repository wiki directories (the npm
tarball intentionally omits repository wiki history):

- [Single-Controller Engineer](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/designs/2026-08-24-single-controller-engineer.md)
  — architecture, authority, privacy, fencing, integration safety, and
  topology correctness.
- [Accelerated Beta Engineering](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/designs/2026-08-25-accelerated-beta-engineering.md)
  — normative delivery policy: cadence, test tiers, review frequency, and
  severity-based acceptance.
- [Single-Controller Knowledge](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/designs/2026-09-02-single-controller-knowledge.md)
  — the knowledge profile: Git-first knowledge repositories partnered with
  Google Drive, Beads first class, one-way materialisation, and committed
  provenance on the same engine.
- [Controller decision records](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/decisions/README.md)
  — the Git-versioned log of substantive human controller decisions.
