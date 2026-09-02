# Knowledge fast-check templates

These dependency-free Node 22 entrypoints validate a domain repository without
network access. Copy this directory, `knowledge-manifest.schema.json`, and
`provenance-record.schema.json` together; each entrypoint resolves the schemas
from their shared parent.

Run a check with `--root <repository>` and, when needed, `--manifest <path>`.
The boundary check additionally accepts one `--changed-path <path>` for every
candidate path. With no changed paths it validates only repository-wide
structure and marker policy, which supports an initialization-time baseline
check. A candidate gate must fail closed without the frozen base, derive the
complete path list from Git, and pass every path to this check. The example
gate demonstrates that contract with exact `SCE_CANDIDATE_BASE_OID`; the
verification executor sets it only from the journaled verify effect's
`candidate.baseOid`, while the frozen worktree supplies `HEAD`. The gate
refuses a symbolic revision or a non-ancestor base. Initialization-only
validation is distinct and explicit:

```bash
SCE_KNOWLEDGE_BASELINE=1 node test-fast.mjs
```

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
