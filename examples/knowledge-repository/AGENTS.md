# Example knowledge repository

This access-domain repository runs in `git-first` mode for the
`example-internal` audience. Git is authoritative for knowledge; Beads is the
execution ledger; the partnered Drive is a read-only source and a destination
for journaled rendered copies.

The example human driver is `Example Knowledge Lead`. `AGENTS.md` is the
driver's instruction entrypoint, not the driver identity recorded in evidence.

## Artifact map

| Artifact | Canonical home |
| --- | --- |
| Instructions | `AGENTS.md` and `CLAUDE.md` |
| Current and superseded knowledge | `knowledge/` |
| Immutable provenance records | `events/` |
| Rebuilt and committed views | `generated/` |
| Page metadata schema | `schemas/page-frontmatter.schema.json` |
| Incoming evidence | `partner-drive:incoming` |
| Rendered deliverables | `partner-drive:rendered` |
| Credentials | Approved external credential store only |

The manifest at [knowledge-manifest.json](knowledge-manifest.json) is the
machine-readable contract. The current example page is the
[access guide](knowledge/current/access-guide.md), and the generated view is
the [knowledge timeline](generated/timeline.md).

## Controller boundaries

- Content units may write only under `knowledge/`.
- Units never edit `events/`, `generated/`, `.beads/`, or Drive paths.
- The controller supplies every candidate path to the boundary check.
- The provenance step alone writes events and rebuilds generated views.
- No check makes a network request or writes outside a disposable directory.

Run `node test-fast.mjs` from this directory for the complete example gate.
The integration and release command entries are declarations: they require
the K6 disposable-materialisation fixture or separately authorized live Drive
evidence and are not part of this example's fast gate.
