# DEC-20260825-007: Keep Release and Feedback Workflows Disabled

**Date:** 2026-08-25
**Status:** Accepted
**Scope:** npm release and GitHub feedback automation
**Beads:** `sce-1kv.4.2`, `sce-1kv.4.3`, `sce-1kv.5.6`

## Context

Read-only repository inventory found no `npm-release` environment, Actions
activation variables, or tag rulesets. The controller authorized adding the
workflow definitions and tests, but explicitly withheld authority to activate
them or mutate npm, tags, issues, or repository administration.

## Decision

Add both workflow definitions with missing-by-default, job-level activation
guards. Publish jobs require `SCE_NPM_RELEASE_ENABLED == 'true'`, the exact
repository, a protected tag, and a protected `npm-release` environment before
any step can run. Feedback triage requires
`SCE_FEEDBACK_TRIAGE_ENABLED == 'true'` and the exact repository before its
write-capable job can run.

Do not create the variables, environment, protection rules, tags, npm release,
or issue effects as part of this implementation. Track that separate pre-tag
administrative work in `sce-1kv.5.6`.

## Rejected alternatives

- Add workflows whose jobs run immediately when their event fires.
- Create activation variables, environments, or tag rules without explicit
  administrative authority.
- Omit the reviewed workflow contracts merely because activation is deferred.
- Hide activation behind a secret or token whose absence is less auditable
  than an exact repository variable.

## Consequences

The definitions and policy tests can ship without granting new runtime
authority. A later operator must deliberately complete `sce-1kv.5.6`, review
the protections, and set the exact activation variables before either workflow
can act. Publishing remains tokenless OIDC and feedback mutations remain
serialized and deterministic once separately activated.
