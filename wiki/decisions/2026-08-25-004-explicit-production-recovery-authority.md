# DEC-20260825-004: Explicit Production Recovery Authority

**Date:** 2026-08-25
**Status:** Accepted
**Scope:** Production controller composition and replacement-process recovery
**Beads:** `sce-1kv.2.6`
**Landed Git OID:** `12488d45620d15761941b427cc02cdf88db0e1f3`

## Context

Recovery may retry an effect after the process that planned it has disappeared.
Inference from the current checkout, environment defaults, or partial journal
fields can select the wrong repository, topology, scope, identity, or base OID.

## Decision

Production mutation commands require an explicit absolute controller-config
path. The validated config binds the run, repository identity and object format,
scope, holder, topology, authoritative state stores, and topology-specific
credential environment-variable names. Loaded state and runtime observations
must match those bindings exactly before intent persistence or an external act.

Recovery may classify exact positive evidence as observed or safely absent.
Missing authority, conflicting evidence, unsupported formats, and ambiguous
local or remote state block without fallback or topology/model downgrade.

## Rejected alternatives

- Infer production authority from the current directory or ambient Git config.
- Reconstruct omitted bindings from model context after restart.
- Fall back from shared-server to embedded mode when validation fails.

## Consequences

Callers must create and protect a complete config before production mutation.
This extra setup is accepted because replacement processes can then make the
same deterministic decision and retry only an exact guarded effect.
