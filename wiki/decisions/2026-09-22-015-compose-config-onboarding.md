# DEC-20260922-015: Composed Controller Configuration for Onboarding

**Date:** 2026-09-22
**Status:** Accepted
**Scope:** CLI onboarding of a repository into a first controller run; the
configuration parser's admission of a pristine run with a knowledge contract;
two embedded-adapter observations against the pinned real Dolt
**Beads:** `sce-bih`

## Context

Every command needs an explicit `sce.controller-config` document, and nothing
composed one. The first knowledge repository to adopt the skills
(`ai-accountant`, 22 September 2026) could not start a run: the document
needs the Git identity preflight derives, the fencing scope, the harness
capability matrix and its commitment hash, a pristine `initialRun`, the
embedded topology with its preflight envelope, the manifest projected into a
knowledge contract, and the exact first `acquire-controller` request whose
idempotency key is derived from the run identities. Composing it by hand is
error-prone and the parser refuses silently.

Trialling the composed document exposed four further gaps. The parser
refused a fresh knowledge run because it admitted a configuration contract
only beside an already-acquired controller. The merge-slot bead that
`bd merge-slot create` makes is unbound to any scope, and only an
"authorized bootstrap" method with no CLI surface binds it, so the first
acquire was always quarantined. Against the pinned Dolt 2.2.1, `-r json`
omits NULL columns, which the projection loader read as ambiguous rather
than absent. The Dolt remote check compared the raw `git+ssh`/`git+file` URL
Dolt prints with the normalized identity preflight records for `sync.remote`,
so `git-sync` mode never observed a remote head.

## Decision

1. Add `sce compose-config`. It observes the repository read-only
   (`inspectPreflight`, Git remotes and branch, executables on PATH, the
   manifest), refuses a `bd` or `dolt` whose version differs from the engine
   pins, composes the document from a pure function of that observation,
   self-validates it through the strict parser, writes it with no-clobber
   semantics, inspects the merge-slot binding and the Dolt sync state, and
   prints the exact first request. `--bind-slot` performs the authorized slot
   bootstrap (and pushes Dolt data in `git-sync` mode); a slot bound to a
   different scope is reported `foreign` and never rebound. The same command
   serves software and knowledge repositories; the manifest decides.
2. Admit a configuration knowledge contract beside a pristine
   `initializing`/`unacquired` run (`isPristineUnacquiredRun`), in addition to
   the acquired unit-free run the first wave already accepts.
3. Treat an absent `$.sce` key on the exact root row as positive absence in
   the projection loader, and compare Dolt remote URLs by normalized identity
   (raw equality still accepted).
4. Export the pinned versions and the local bare-remote canonicalizer so
   onboarding and the adapter share one definition.

## Rejected alternatives

- Documenting the hand-composed document: it duplicates parser logic in
  prose and still leaves the commitment, idempotency key and slot bootstrap
  to the operator.
- Relaxing the exact `dolt` pin: the adapter's parsers are written against
  one release; naming the mismatch up front is cheaper than a silent
  `unreachable` later.
- Binding the merge slot lazily inside `acquire-controller`: the existing
  design keeps bootstrap authority explicit; onboarding is where that
  authority is stated.

## Consequences and follow-up

The sandbox trial now passes preflight, composition, slot binding, Dolt sync
and intent persistence. The first acquire still ends `SCE_RECOVERY_BLOCKED`:
the planned slot transition records a Dolt head captured before the intent
commit, so reconciliation after the commit sees a moved head, reports
ambiguous, and the ambiguous-event write is refused by the pre-ownership
holder check. That is the release-tier adapter path already tracked as
`sce-jbu` and is recorded as its own bug with the trace. Live evidence for a
complete first wave on the Claude family remains pending.
