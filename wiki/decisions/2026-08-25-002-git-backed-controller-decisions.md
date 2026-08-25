# DEC-20260825-002: Git-Backed Controller Decisions

**Date:** 2026-08-25
**Status:** Accepted
**Scope:** Human controller decision provenance
**Beads:** `sce-1kv`
**Base Git OID:** `8159e2bcef0251213310c2bb3fadd7cc86fa84ec`

## Context

Controller decisions were split among Beads notes, field-change audit records,
runtime judgments, design documents, and Git commits. Those sources provide
evidence, but they do not form one simple, readable log of accepted engineering
choices and rejected alternatives.

## Decision

Substantive human controller decisions are source-controlled as individual
Markdown records under `wiki/decisions`. The directory index is the discovery
surface, and Git history is the change audit.

Beads stores execution state and links to the relevant decision ID and path.
The protocol effect journal continues to record machine intent and outcome; it
does not carry human architectural rationale.

## Rejected alternatives

- Beads notes alone. They are useful resume state but make product decisions
  harder to review with the code and can accumulate into a single large field.
- A new decision database or `sce decision` subsystem. This adds code and
  another authority boundary before beta usage demonstrates a need for it.
- Runtime effect-journal entries. They solve idempotent side effects, not
  durable human explanation.

## Consequences

The controller creates a short record for a substantive decision and commits
it promptly. Accepted decisions are superseded rather than rewritten. Beads
comments or notes contain only the decision ID/path and any immediate resume
instruction.

This is intentionally a source convention rather than a new service. It can
later gain deterministic linting or CLI helpers if real usage warrants them.
