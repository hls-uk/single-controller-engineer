# Getting started

This guide installs the Single-Controller Engineer CLI and skill set into an
existing repository and takes you to a first controller run. It assumes a
POSIX shell and a repository you are allowed to change.

## Prerequisites

- Node.js 22.14 or newer.
- Git, with the repository you want to work in cloned locally.
- The Beads CLI (`bd`), version 1.1.0 — the issue tracker the controller
  drives. See the [Beads repository](https://github.com/gastownhall/beads)
  for installation.
- A Claude Code or Codex host if you want the skills loaded by an agent; the
  CLI itself needs neither.

## 1. Get the CLI

The npm package is not published yet (the publish workflows deliberately ship
disabled), so install from a checkout of this repository. The build output is
one self-contained executable; there are no runtime dependencies and no
`postinstall` side effects.

```sh
git clone git@github.com:hls-uk/single-controller-engineer.git
cd single-controller-engineer
npm pack
npm install -g ./hls-uk-single-controller-engineer-0.1.0.tgz
sce --help
```

Alternatively, skip the global install and run the vendored bundle directly:

```sh
node skills/single-controller-engineer/scripts/sce.mjs --help
```

## 2. Install the skill set

The installer places the primary skill (`single-controller-engineer`), the
knowledge skill (`single-controller-knowledge`), and the feedback companion
(`single-controller-feedback`) as one manifest-hashed set. It stages first,
validates hashes and all three skill versions, then atomically replaces only
an installation it previously recorded; unrelated collisions, partial sets,
and version mismatches refuse without touching anything.

Pick the destination your host loads skills from:

- Claude Code, project-scoped: `<your-repo>/.claude/skills`
- Claude Code, personal: `~/.claude/skills`
- Codex: the skill directory your Codex host loads from

Preview the manifest, then install (the destination must be an absolute
path):

```sh
sce install-skill --destination /path/to/your-repo/.claude/skills --dry-run
sce install-skill --destination /path/to/your-repo/.claude/skills
```

The destination is what decides where the set lands; the installed files are
the same set for either host. Upgrading is the same command from a newer
checkout; `sce uninstall-skill --destination <path>` removes exactly the
recorded manifest.

## 3. Initialize Beads in the target repository

The controller keeps all task state in Beads, and the controller lock is the
`<prefix>-merge-slot` bead. `bd init` does not create that slot; creating it
is the explicit, authorized initialization step, and the skill never creates
it lazily during a run.

```sh
cd /path/to/your-repo
bd init                # embedded Dolt store under .beads/ (default)
bd merge-slot create   # the controller lock; one per repository
bd merge-slot check    # expect "available"
bd prime               # workflow context; verify the store answers
```

`bd init` defaults to an embedded Dolt engine with no external server. Teams
sharing one tracker can pass `--server` with connection details for an
externally managed `dolt sql-server` instead. Choose one topology and keep
it; the skill's preflight refuses ambiguous or mixed configurations rather
than guessing.

## 4. Compose the controller configuration

Every run is driven by one explicit `sce.controller-config` document: the
repository's Git identity, the fencing scope, the harness capability matrix
with its commitment, a pristine initial run, the embedded Beads topology with
its preflight envelope and, for a knowledge repository, the contract derived
from `knowledge-manifest.json`. `compose-config` observes the repository and
writes that document, self-validated through the same strict parser the
engine uses, so nothing is typed by hand:

```sh
export HLS_PROVENANCE_WORKTREE_ROOT=/abs/path/outside/the/repo   # knowledge repositories only
sce compose-config --harness claude --root-bead <epic-id> \
  --output /abs/path/controller-config.json --bind-slot --json
```

- `--harness` is `claude` or `codex`; the default model routes for the family
  are starting points, override them with `--controller-model`,
  `--frontier-model` and `--workhorse-model` if your host returns other ids.
- The Beads mode follows `bd config sync.remote`: a configured remote means
  `git-sync`, none means `local-only`. In `git-sync` mode the Dolt data must
  already be on the remote (`bd dolt push`), or the first acquire refuses the
  store as ambiguous; the result's `doltSync` field says where you stand.
- `--bind-slot` performs the one authorized bootstrap the engine's normal
  acquire path never does: it binds the fresh `<prefix>-merge-slot` bead to
  the run's scope (and pushes the Dolt data in `git-sync` mode). Without it
  the result warns and the first `acquire-controller` is quarantined. A slot
  already bound to a different scope is reported as `foreign` and never
  rebound.
- A `knowledge-manifest.json` at the repository root is projected into the
  knowledge contract automatically; `--no-knowledge` ignores it and
  `--knowledge` requires it. Every mount-path variable and the provenance
  worktree-root variable must be exported as canonical absolute paths first.
- The engine pins `bd` 1.1.0 and `dolt` 2.2.1 exactly. A mismatch is refused
  with `SCE_COMPOSE_EXECUTABLE_VERSION`; install the pinned release and pass
  `--bd-executable` or `--dolt-executable`.
- The root bead's open children become the run's planned units when each
  carries a strict machine-readable `sce_task` record in its metadata (the
  wave task fields: `acceptanceIds`, `conflictDomains`, `dependencies`,
  `independence`, `mandatoryVerification`, `ownedPaths`, `priority`,
  `reservations`, `risk`). The unit id is the bead id and its base is the
  integration branch head at compose time. A child without a record is
  reported and left unplanned; an invalid record or a dependency on an
  unplanned sibling refuses the composition with `SCE_COMPOSE_UNIT_INVALID`.
  The result's `plannedUnits` lists what was planned, for example:

```sh
bd update <child-id> --metadata '{"sce_task":{"acceptanceIds":["<child-id>:A1"],"conflictDomains":["docs"],"dependencies":[],"independence":"proven","mandatoryVerification":["npm run test:fast"],"ownedPaths":["docs"],"priority":2,"reservations":[],"risk":"low"}}'
```

- The result's `firstRequest` is the exact `acquire-controller` request the
  fresh run accepts (its idempotency key is derived from the run identities),
  so the first command is:

```sh
sce acquire-controller --controller-config /abs/path/controller-config.json \
  --json --request '<firstRequest.request>'
```

Compose once per run: the document carries the run and incarnation ids, and
recomposing after a run has started produces a different holder that the
store refuses.

## 5. Run the loop

Open your agent host in the target repository and invoke the
`single-controller-engineer` skill. The skill walks the controller through
the loop this repository uses on itself:

1. Pure preflight (`bd context --json`) proves the topology; exactly one
   topology reference is loaded.
2. The controller acquires the merge slot, states the promised core paths and
   non-goals, and creates one epic with dependency-linked children carrying
   acceptance criteria, owned paths, and mandatory verification.
3. One to three genuinely independent units are dispatched to isolated
   worktrees with packets generated by `sce harness-packet`.
4. Each frozen candidate gets a fresh adversarial frontier review bound to
   its exact base/head pair, then integrates serially. Before a unit's first
   candidate observation, and again after a sibling lands, the controller
   refreshes it onto the current integration head (`refresh-candidate`), which
   rebases the unit branch in its own worktree and discards every binding to
   the old base.

Authority is profiled, never assumed: a run records `local-change-only`,
`push-branch`, `open-pr`, or `integrate` and stops at its completion
boundary. Publishing, tags, pushes, external issue mutation, and feedback
submission always need separate current authority.

## What is and is not supported today

Claude Code is a supported install host, and the Claude harness family is
defined, classified, and deterministically tested. Its classification is
honest rather than aspirational: dispatch recovery is
`at-most-once-manual` (an ambiguous launch blocks for a human-bound
observation; it is never blindly redispatched) and tier enforcement is
`unavailable` (paths requiring a proven controller tier fail explicitly). In
practice a Claude-hosted run drives dispatch through the manual model-tool
seam, with the controller model executing the loop — the same way this
repository dogfoods itself. Live-agent release evaluation is still pending,
so dispatch and telemetry support for the family is not advertised yet; see
[DEC-20260901-008](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/decisions/2026-09-01-008-claude-code-harness-host.md)
and
[DEC-20260901-009](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/decisions/2026-09-01-009-classified-harness-support-profiles.md).

## Where to go next

- [README](../README.md) — what the system creates and how it works.
- [Single-Controller Engineer design](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/designs/2026-08-24-single-controller-engineer.md)
  — the governing contract.
- `bd prime` in your repository — the live Beads command reference.
