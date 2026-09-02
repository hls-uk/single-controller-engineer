# Knowledge fast-check templates

These dependency-free Node 22 entrypoints validate a domain repository without
network access. Copy this directory, `knowledge-manifest.schema.json`, and
`provenance-record.schema.json` together; each entrypoint resolves the schemas
from their shared parent.

Run a check with `--root <repository>` and, when needed, `--manifest <path>`.
The boundary check additionally accepts one `--changed-path <path>` for every
candidate path. With no changed paths it validates the repository-wide marker
policy only, which supports an initialization-time baseline check; candidate
verification must pass its complete deterministic path list.

The generated-output check runs the manifest's argv-form generator in a fresh
temporary directory with a reduced environment. The generator must accept
`--output <directory>` and produce the complete generated tree there. The check
hashes that tree and the committed generated directory and refuses any drift.

The provenance check validates strict Markdown records in the declared events
directory, including scope, driver, executor, timestamp, Git, verification,
review, materialisation, and supersession evidence. It rejects unknown fields
and invalid links, then asks local Git whether each full landed object
identifier is an ancestor of `HEAD`. An empty initialized events directory is
valid.
