# Knowledge fast-check templates

These dependency-free Node 22 entrypoints validate a domain repository without
network access. Copy this directory, `knowledge-manifest.schema.json`, and
`provenance-record.schema.json` together; each entrypoint resolves the schemas
from their shared parent.

## Supported JSON Schema subset (version 1)

`lib.mjs` carries its own validator, so it declares exactly what it evaluates and
rejects everything else. Loading a schema walks the whole document, including
nodes no value ever reaches, and refuses any keyword outside the subset instead
of ignoring it. Version 1 evaluates `$ref` (local `#/` pointers only), `anyOf`,
`const`, `enum`, `type` (`array`, `boolean`, `null`, `number`, `object`, `string`),
`minLength`, `maxLength`, `maxUtf8Bytes`, `canonicalUnicodeScalar`, `pattern`,
`maximum`, `minItems`, `maxItems`, `maxCanonicalBytes`, `uniqueItems`, `items`
(one schema, never a tuple), `required`, `properties`, and
`additionalProperties`, which must be `false`. `$schema`, `$id`, `$comment`,
`$defs`, `title`, and `description` are inert annotations. Everything else is a
refusal: `format`, `oneOf`, `allOf`, `not`, `if`, `patternProperties`, the
`integer` type, a type union, a tuple `items`, a `$ref` or `anyOf` node carrying
sibling keywords the evaluator would skip, and a `properties` node without
`additionalProperties: false`. Raise `SCHEMA_SUBSET_VERSION` when that set
changes.

## Custom keywords and generic validators

Three of those keywords are not in draft 2020-12, so a generic validator treats
them as unknown annotations and ignores them silently. `validate-manifest.mjs`
is therefore the manifest's authority, and a generic validator is a supplement
that always accepts at least as much:

| Keyword                  | Applies to | The shipped checker evaluates                                        | Portable equivalent                                                                                                                                                              |
| ------------------------ | ---------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxUtf8Bytes`           | strings    | `Buffer.byteLength(value, "utf8")` against the bound                 | None. The sibling `maxLength` counts UTF-16 code units, which is an exact byte bound only where the `pattern` admits ASCII alone.                                                |
| `maxCanonicalBytes`      | arrays     | `Buffer.byteLength(JSON.stringify(value), "utf8")` against the bound | None. The sibling `maxItems` bounds the count, never the serialized size.                                                                                                        |
| `canonicalUnicodeScalar` | strings    | No NUL and no unpaired surrogate, code point by code point           | The sibling `pattern` `^(?:[^\u0000\uD800-\uDFFF]\|[\uD800-\uDBFF][\uDC00-\uDFFF])+$`, which states the same rule under both Unicode-mode and code-unit-mode ECMA-262 semantics. |

Every custom bound therefore carries its standard sibling, so the portable
reading of the schema is a strict weakening, never a contradiction: a manifest
a generic validator refuses is always refused here too, while the reverse does
not hold. Run this directory's checker as the gate.

The bounds themselves mirror the engine's `KnowledgeContract`: `humanDriver`
(8192 code units and 8192 UTF-8 bytes), the `driveAliases` count (64), each
`alias` (1 to 63 characters of `^[a-z][a-z0-9-]{0,62}$`), each `markerFile`
(an exact safe basename of at most 255 bytes, dot segments refused), and every
`mountPathVariable` and `worktreeRootVariable` (1 to 160 characters of
`^[A-Z_][A-Z0-9_]{0,159}$`). A manifest this checker accepts is one controller
composition accepts; changing a bound on one side without the other is the
defect these bounds exist to prevent.

Manifest semantics go beyond the schema. Every `materialisationTargets` source
pattern must be a canonical bounded glob contained in the repository, and
`driveIncoming` and `driveRendered` must each name a declared drive alias as
`<alias>:<subpath>` with a contained subpath; the two never overlap on one
alias. Drive aliases and their `mountPathVariable` names are each unique, and
the provenance `worktreeRootVariable` never names a variable that also mounts
an alias, because the controller resolves one host path per environment name.

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
