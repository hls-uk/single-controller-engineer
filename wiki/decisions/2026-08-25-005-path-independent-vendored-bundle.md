# DEC-20260825-005: Path-Independent Vendored Bundle

**Date:** 2026-08-25
**Status:** Accepted
**Scope:** Vendored CLI and npm artifact construction
**Beads:** `sce-1kv.2.6`
**Landed Git OID:** `7b1d6c4405fcbb3c8c597c1781a06af23ee8e730`

## Context

An isolated review checkout reused dependencies through a symlink. Esbuild
resolved that symlink and embedded the controller's absolute workspace path in
generated module labels. Runtime behavior was unchanged, but the reviewed
artifact was neither portable nor privacy-safe and differed from a primary
checkout build.

## Decision

Bundle with symlink preservation so dependency labels remain relative to the
package. The fast artifact gate builds twice, rejects the repository root and
traversal-form source labels, executes the bundle, and checks its mode. Phase
boundaries additionally compare a primary build with an isolated checkout that
uses a different absolute dependency path.

## Rejected alternatives

- Accept generated path-only differences because runtime code is equivalent.
- Minify solely to hide path labels; that would obscure the cause and create a
  larger generated-code change.
- Post-process generated JavaScript with an untyped textual rewrite.

## Consequences

Reviewed source, installed skill, and npm payload can share one reproducible
bundle without leaking a builder path. A bundle mismatch remains P1 even when
focused runtime tests pass.
