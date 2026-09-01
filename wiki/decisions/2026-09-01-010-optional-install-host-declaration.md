# DEC-20260901-010: Optional Install Host Declaration

**Date:** 2026-09-01
**Status:** Accepted
**Scope:** `install-skill`/`uninstall-skill` `--host` option semantics
**Beads:** `sce-366.2` (context), implementation bead recorded on creation

## Context

DEC-20260901-008 made the installer host-agnostic: every install ships the
identical manifest-hashed pair carrying both `agents/claude.yaml` and
`agents/openai.yaml`, and `--host` is a validated declaration echoed in the
result with no effect on the installed bytes. The flag is nevertheless
mandatory, so a caller must declare a host even though the destination
directory alone determines which host loads the pair. The user directed that
the declaration become optional.

## Decision

1. `--host` becomes optional for `install-skill` and `uninstall-skill`. When
   present it is validated to `codex` or `claude` exactly as today and echoed
   in the result; when absent the result omits the host field. Unknown values
   still refuse.
2. Installed content is unchanged in every case: the complete two-skill pair
   with both host metadata files.
3. Usage strings and the design contract line show the option as optional.

## Rejected alternatives

- `--host both` or a repeatable flag: only meaningful with multiple
  destinations per invocation, a larger CLI contract change with no current
  need.
- Removing `--host` entirely: discards a declaration that future
  host-specific validation can use, and breaks recorded invocations for no
  simplification the optional form does not already provide.

## Consequences

- Setup documentation drops the flag from its command examples; the pair
  serves whichever host loads the destination directory.
- A future host-specific install behavior would make the declaration
  meaningful again without a breaking flag change.
