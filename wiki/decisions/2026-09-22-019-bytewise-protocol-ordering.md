# DEC-20260922-019: Protocol order is UTF-16 code-unit order

Date: 2026-09-23. Status: accepted. Controller: the single-controller-engineer
dogfood run on this repository (bead sce-7g9.2.3, acceptance
`sce-7g9.2.3:A1`). Names the ordering DEC-20260903-012 left implicit; it
changes no decision recorded there.

## Context

Determinism is the whole promise of this engine: the same facts must produce
the same bytes on every machine, so a controller that resumes elsewhere reads
back exactly what it wrote. Several ordered surfaces reached that promise
through `String.prototype.localeCompare`, which is not a property of the bytes
at all. It consults ICU with whatever locale `LANG` or `LC_ALL` selected for
the process, and its answer differs from code-unit order for ordinary
repository names: every collation puts `agents/claude.yaml` before `SKILL.md`,
while code units put `SKILL.md` first. A launch packet ordered on one host and
a task binding derived on another could therefore disagree, and the K2
acceptance audit found the same hazard in the installed skill manifest, whose
bytes a host later verifies its tree against.

## Decision

1. **Protocol order is UTF-16 code-unit order.** That is JavaScript's default
   `Array.prototype.sort` for strings, the same order RFC 8785 gives object
   keys, and the order `compareProtocolText` in `src/protocol/reducer.ts`
   implements for every comparator the reducer and `src/protocol/actions.ts`
   pass to a sort. No protocol comparator may consult a collation:
   `localeCompare`, `Intl.Collator`, and the `toLocale*` conversions are
   forbidden on the ordered surfaces.
2. **Code-unit order is byte order here.** `identifier()`, the canonical
   relative path, the materialisation source path, and the installed manifest
   path are all ASCII-restricted by schema, so a UTF-8 byte comparison and a
   UTF-16 code-unit comparison cannot disagree on any admissible value. Where
   the bytes are already in hand the code compares them directly:
   `resolveMaterialisationSources` in `src/adapters/materialise/index.ts`
   orders matched tree entries with `Buffer.compare` before any blob is read.
3. **Materialise execution and observation order is stage, then gate entry.**
   Scheduling compares `compareProtocolText(stage)` first and
   `compareProtocolText(gateEntryId)` second, so a unit-stage entry can never
   be overtaken by a gate-stage one: `actionsForGate` in
   `src/protocol/actions.ts` for resolution, destination probe, and
   materialise selection, and the matching sorts in `src/protocol/reducer.ts`.
   The closure snapshot's observation tuples are ordered the same way:
   destination probe evidence by `gateEntryId`, and target evidence by
   `originUnitId`, then the numeric `targetOrdinal`, then `targetId`.
4. **The remaining collation sites are converted.** `src/harness/index.ts`
   (`sortedStrings`, the launch packet's acceptance ids, mandatory
   verification, and owned paths), `src/install/index.ts` (the manifest built
   on parse, the directory walk in `filesAt`, and the installed tree
   `validateTree` compares against), and `src/feedback/outbox.ts` (the durable
   outbox listing) each order by code unit.

## Rejected alternatives

- **A locale-pinned collator (`Intl.Collator("en-US")`).** It removes the host
  dependency but keeps an ICU table, a collation version, and a dependency on
  the Node build's ICU data in the definition of the bytes. Code-unit order is
  defined by the language.
- **Leaving `localeCompare` where the values happen to be hex.** Derived ids
  such as `sce:gate:<sha256>` do sort the same either way today, so the defect
  is invisible until a free-form identifier or path reaches the same sort. The
  guarantee belongs in the comparator, not in the current shape of the values.

## Consequences

- The installed skill manifest changes order: `<skill>/SKILL.md` now precedes
  `<skill>/agents/`, `<skill>/references/`, and `<skill>/scripts/` instead of
  following them. The entries and their digests are unchanged, so only the
  order of `files` in `.sce-skill-install.json` differs. `parseManifest`
  re-orders on read, so a manifest an earlier release wrote under a collation
  still verifies, upgrades, and uninstalls; `test/install/installer.test.ts`
  pins that path explicitly.
- Tests: `test/protocol/canonical.test.ts` pins code-unit order for
  identifiers, paths, and the stage/gate-entry and observation tuples against
  two named collations and the host's own, and refuses a locale-sensitive
  comparison anywhere on the ordered surfaces;
  `test/install/installer.test.ts` pins the manifest order end to end;
  `test/feedback/feedback.test.ts` pins the outbox listing;
  `test/harness/harness.test.ts` pins the launch packet's owned paths.
