# DEC-20260901-008: Claude Code Host and Harness Family Classification

**Date:** 2026-09-01
**Status:** Accepted
**Scope:** Claude Code as an install host; claude harness-family capability
classification, model routes, and skill metadata
**Beads:** `sce-k4c`, `sce-366`

## Context

The shipped skills carry only `agents/openai.yaml` harness metadata, and
`install-skill --host claude` parses but changes nothing host-specific. The
design admits a harness family to advertised support only with a declared and
tested capability seam, a proven model-tier mapping with trusted identity
telemetry, deterministic CI simulation of every capability, and live-agent
release evaluations. The harness runtime is already family-agnostic; only a
codex-family example and codex test fixtures exist.

## Decision

1. Claude Code becomes a supported install host now. The claude harness
   family is defined and deterministically tested now. Advertised dispatch
   support waits for live-agent release evidence at the next tag; until then
   documentation states the classification below, never blanket support.
2. Claude-family capability classification, version 1:
   - `launch`, `inspect`, `poll`, `collect`, `cancel`, and
     `returnedModelIdentity` are declared true: headless dispatch returns a
     session identity and returned-model identity, sessions can be resumed,
     inspected, and cancelled.
   - `lookupByClientKey` is false. The host offers no exact session lookup
     keyed by a client idempotency key, so a launch that completed before its
     acknowledgement persisted cannot be rediscovered deterministically. The
     family is classified `at-most-once/manual-reconciliation`: an ambiguous
     launch blocks the unit, preserves the worktree, and requires a
     human-bound session observation. Crash-safe dispatch is not advertised.
   - `controllerIdentity` is false. The host does not return trusted
     controller-session identity telemetry, so the model-tier-enforcement
     profile is not advertised; preflight fails that profile rather than
     accepting controller self-attestation.
3. Example model routes mirror the codex example and are examples, not
   permanent pins: controller and frontier request `claude-fable-5` and
   accept only `claude-fable-5` returned; workhorse requests `claude-opus-5`
   and accepts only `claude-opus-5` returned.
4. Both skills ship `agents/claude.yaml` beside `agents/openai.yaml` with the
   same minimal interface shape; `SKILL.md` remains the native Claude skill
   contract. The installer stays host-agnostic and always installs the
   complete pair; `--host` remains a validated declaration echoed in the CLI
   result, and the install-manifest schema is unchanged.

## Rejected alternatives

- Synthesize `lookupByClientKey` by scanning host session files or resuming
  candidate sessions. That is inference over ambiguous machine state, not an
  exact readback keyed by the client key.
- Prove `controllerIdentity` by asking the controller model to report its own
  identity. Self-attestation is explicitly forbidden by the design.
- Install host-specific metadata subsets per `--host`. The design installs
  one versioned set; pair integrity stays simpler than per-host manifests.
- Advertise full Claude support immediately. Claiming support for an
  untested harness is a design non-goal; live release evidence is pending.

## Consequences

- The claude family enters examples and the support matrix as
  `at-most-once/manual-reconciliation` without tier enforcement, and routing
  documentation must state exactly that.
- Deterministic claude-family capability tests join the fast/eval gates; the
  live-agent evaluation is a deferred release-tier bead, not CI.
- A future host version that adds trusted identity telemetry or client-key
  lookup requires a new decision record and requalification, not an edit.

## Follow-up

- Implementation epic `sce-366` (harness example and capability matrix, skill
  metadata and installer coverage, routing documentation).
- Deferred release-tier bead for claude-family live-agent evaluation before
  the next tag.
