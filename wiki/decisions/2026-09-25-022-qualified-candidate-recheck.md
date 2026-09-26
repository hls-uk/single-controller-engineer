# DEC-20260925-022 — Recheck a qualified candidate on its frozen pair

- Date: 2026-09-25
- Status: Accepted
- Beads: `sce-noo`

## Context

An earlier local bundle patch let a 94,802-byte candidate pass collection while reviewer packets still required at most 65,536 bytes. Restoring the collector bound leaves that already qualified unit without a legal same-base collection step. Its old qualification cannot justify review of a diff the current collector refuses. The adopting run also owns `.github/workflows`, which is a valid relative path that the source ownership grammar previously rejected.

## Decision

Add an explicit `recheck-candidate` command, admitted only for a qualified unit with no active reviewer. The intent binds the current controller and revision through the normal coordinator, plus the unit's frozen base/head/tree and physical branch/worktree. It durably discards the old diff, verification and review bindings before the existing candidate collector reads Git. The intended effect retains the frozen head/tree and refuses to settle on a moved pair. A measured oversize diff follows the existing typed `candidate_refused` path to repair; a fitting diff returns to `candidate_committed`, requiring fresh verification and review. The 65,536-byte contract stays fixed.

The complete `git ls-files --cached -v -z` index read is separately bounded at
1 MiB because it validates every tracked entry before clean status can be
trusted. Its dedicated result schema and runner cap apply only to that exact
allowlisted command. The general Git result and candidate diff bounds remain
65,536 bytes. An index beyond 1 MiB, or any nonordinary flag anywhere in the
complete output, refuses collection.

Allow an initial dot in a repository-relative owned path so `.github/workflows` is admitted. Continue refusing `.` and `..` segments, traversal, absolute paths, backslashes and platform aliases.

## Rejected alternatives

- Raising the reviewer bound or editing the stored qualification would hide the mismatch.
- Refreshing onto the same base or launching a new unit would change the recovery contract and lose the existing identity.
- Accepting a newly moved branch during recheck would silently substitute different work for the qualified pair.

## Consequences

The recheck reads only the same clean Git pair. An unreadable or moved pair remains unresolved for explicit diagnosis; it does not inherit the old qualification. A repaired smaller candidate must complete normal collection, verification and frontier review. The dot-path grammar correction permits the existing ownership declaration without relaxing traversal checks.
