# Controller Decision Records

This directory is the authoritative, Git-versioned log of substantive human
controller decisions for Single-Controller Engineer.

Beads remains the durable execution queue. A relevant Bead links to a decision
record and retains the current resume point; it does not duplicate the full
rationale. The runtime effect journal separately records machine-effect intent
and observation for crash recovery.

## Rules

- Use one Markdown file per substantive architecture, delivery, severity,
  integration, or scope decision.
- Name records `YYYY-MM-DD-NNN-short-title.md` and give them a stable
  `DEC-YYYYMMDD-NNN` identifier.
- Bind a decision to the relevant Beads issue and exact facts or Git object IDs
  when those facts matter.
- Keep records short enough to scan. Include context, decision, rejected
  alternatives, consequences, and follow-up.
- Commit important decisions promptly so they survive controller replacement
  and cross-machine resumption.
- Do not rewrite an accepted decision to change its meaning. Add a new record
  that supersedes it; corrections to spelling and links are allowed.
- Never record secrets, credentials, raw model transcripts, or unnecessary
  private data.

The controller is the only writer during an SCE run. Reviewers and workhorses
may recommend decisions, but the controller records the accepted disposition.

## Index

| ID | Status | Decision | Beads |
| --- | --- | --- | --- |
| [DEC-20260825-001](2026-08-25-001-accelerated-beta-delivery.md) | Accepted | Accelerated beta is the default delivery profile | `sce-1kv` |
| [DEC-20260825-002](2026-08-25-002-git-backed-controller-decisions.md) | Accepted | Human controller decisions live under `wiki/decisions` | `sce-1kv` |
| [DEC-20260825-003](2026-08-25-003-phase-2-recovery-boundary.md) | Accepted | Finish Phase 2 recovery with durable authority and beta-tier evidence | `sce-1kv.2.6` |
| [DEC-20260825-004](2026-08-25-004-explicit-production-recovery-authority.md) | Accepted | Production recovery requires explicit exact authority | `sce-1kv.2.6` |
| [DEC-20260825-005](2026-08-25-005-path-independent-vendored-bundle.md) | Accepted | Vendored bundles must be path-independent | `sce-1kv.2.6` |
