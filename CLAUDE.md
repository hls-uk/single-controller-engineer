# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

## Project Delivery Policy

Use the accelerated-beta policy in
[`wiki/designs/2026-08-25-accelerated-beta-engineering.md`](wiki/designs/2026-08-25-accelerated-beta-engineering.md): prefer deterministic typed checks over inference, keep the fast suite lean, run affected integration tests when their seam changes, and reserve the full release tier for the next tag. One controller owns Beads and serialized integration; it may use at most three disjoint workhorse lanes, with fresh frontier review of frozen candidates. P0/P1 findings block promised core paths; record P2/P3 follow-up. External publication and issue mutation require separate current authority.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Build & Test

Requires Node >= 22.14. Install dev dependencies with `npm install`.

```bash
npm run test:fast          # deterministic units and core paths (also `npm test`)
npm run test:integration   # affected adapter/seam tests; run when that seam changes
npm run test:package       # offline npm tarball inspection, lifecycle scripts disabled
npm run test:release       # release-only aggregate; includes the slow checklist
npm run typecheck          # tsc --noEmit
npm run check:format       # prettier --check .
npm run format             # prettier --write .
npm run build              # rebuild the vendored sce.mjs bundle
npm run check              # format check + typecheck + fast tests + package check + build
```

Keep the fast suite lean (target under sixty seconds). Slow topology, crash,
concurrency, provider, package, and live-agent evidence belongs to the release
tier, never the fast gate. `npm run check` is the pre-handoff quality gate for
code changes.

## Architecture Overview

The repository is a TypeScript/Node 22 protocol engine plus an installable
agent-skill pair. "Models decide meaning; code decides state."

- `src/protocol/` — the authoritative controller contract: strict TypeBox/Ajv
  schemas at every external boundary, a pure reducer
  (`reduce(validated_state, validated_event) -> { next_state, effects }`) over
  discriminated-union protocol states with exhaustive transition handling, and
  an intent/observed effect journal that makes every external act
  crash-consistent and idempotent.
- `src/adapters/` — allowlisted executors for the reducer's typed effects
  against Git, Beads (`bd`), GitHub, and the agent harnesses (Codex and Claude
  families). Raw subprocess output never enters the reducer; adapters emit
  validated observations.
- `src/commands/` — stepwise idempotent CLI commands (preflight, wave, review,
  integrate, resume, install, feedback). `src/cli.ts` is the entry point.
- `src/feedback/` — privacy-bounded upstream feedback packets: controlled
  telemetry, fingerprinting, deduplication, and a durable local outbox.
- `skills/` — the shipped pair: `single-controller-engineer` (primary) and
  `single-controller-feedback` (companion). `npm run build` bundles the whole
  runtime into `skills/single-controller-engineer/scripts/sce.mjs`, the single
  vendored executable that `bin.sce` points at.
- `test/` — mirrors `src/` and is tiered by `scripts/test-tier.mjs` (fast,
  integration, release) with deterministic, symlink-refusing discovery.
- `wiki/designs/` and `wiki/decisions/` — the governing design contracts and
  the controller decision records. They are authoritative; do not restate them
  in code comments or issues, link to them.

## Conventions & Patterns

- Deterministic-first: closed-input work belongs in schemas, reducers,
  manifests, and exact readbacks, not model inference. Ambiguous machine state
  blocks the action; it is never guessed through.
- Runtime schemas validate every external input (`additionalProperties:
  false`, explicit byte/item limits, no coercion); internal TypeScript types
  are inferred from those schemas. Never trust erased compile-time types as
  validation.
- The reducer stays pure: no subprocess, environment, clock, randomness, or
  network. Time, UUIDs, and observed facts enter as validated events.
- Persist an intent before every external side effect and a validated
  observation (or `ambiguous`) after it. An unresolved intent blocks; it is
  never retried blindly.
- No new runtime dependencies: the shipped bundle is self-contained, and npm
  `postinstall` must never gain side effects.
- Prettier formats the tree; `.prettierignore` lists the exemptions (managed
  agent files, wiki, vendored bundle).
- Conservative git profile: do not commit, push, tag, publish, or `bd dolt
  push` without explicit current authority.
