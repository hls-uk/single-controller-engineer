# Repository manifest

Each access-domain repository carries one provider-neutral manifest,
`knowledge-manifest.json`, at its root. The strict schema lives beside this
reference at [`manifest/knowledge-manifest.schema.json`](manifest/knowledge-manifest.schema.json)
and the fast-gate templates under [`manifest/checks/`](manifest/checks/README.md).
They are the single home of both; a root skill copies the templates into a
domain repository when it initializes or upgrades it, and the manifest's
minimum profile version records which templates it carries.

## What the manifest declares

- stable `projectId` and `accessDomainId` identifiers and the `audience`
  label, which every provenance record must repeat exactly;
- the migration `mode`: `legacy`, `pilot`, or `git-first`;
- `driveAliases`: each with an alias, marker file, mount policy (`required`
  or `optional`), the `mountPathVariable` the controller configuration
  resolves, and the required version 1 `namespaceControl: "exclusive"`
  assertion;
- `artifactHomes`: the canonical home of each artifact class, including the
  events and generated directories;
- the `boundaryPolicy`: allowed write roots, forbidden paths, and forbidden
  content markers for this audience;
- `verification`: `fast`, `integration`, and `release` argv vectors; the
  controller runs `fast` and `integration` and never invents a check;
- `provenance`: the events directory, record format version, rollup
  generator argv (it must accept `--output <directory>`), reproducibility
  argv, and the `worktreeRootVariable` resolved during composition;
- `materialisationTargets`: repository-level gate targets with a source
  pattern, destination alias and subpath, naming policy, and
  `sidecarRequired: true`;
- `minimumVersions` for the root, playbook, and profile.

The manifest is a repository document: root `init` and `doctor` procedures
read it, and the controller reads it to compose the knowledge contract. The
engine validates the contract and the effect parameters, never the manifest.

## Bounds and validator authority

The schema's bounds are the engine's bounds, so a manifest the shipped checker
accepts is one controller composition accepts. Changing one side alone is the
defect this parity prevents: a manifest that passes the gate and then refuses
composition strands the repository between two valid states.

| Fact                                                   | Bound                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `humanDriver`                                          | 1 to 8192 code units and at most 8192 UTF-8 bytes                                                      |
| `driveAliases`                                         | at most 64 declared aliases, each alias name unique                                                    |
| `driveAliases[].alias`                                 | 1 to 63 characters matching `^[a-z][a-z0-9-]{0,62}$`                                                   |
| `driveAliases[].markerFile`                            | an exact safe basename, at most 255 bytes; `.`, `..`, and any separator refused                        |
| `mountPathVariable`, `provenance.worktreeRootVariable` | 1 to 160 characters matching `^[A-Z_][A-Z0-9_]{0,159}$`, each naming one distinct environment variable |
| `materialisationTargets`                               | at most 64 targets, each destination naming a declared alias                                           |

The schema states three bounds with keywords draft 2020-12 does not define:
`maxUtf8Bytes`, `maxCanonicalBytes`, and `canonicalUnicodeScalar`. A generic
validator ignores an unknown keyword rather than failing on it, so it enforces
only the standard sibling each one carries and accepts strictly more than the
engine. The shipped checker, `manifest/checks/validate-manifest.mjs`, is the
authority: it evaluates all three, and it refuses at load time any schema
keyword outside the subset it declares, so a bound can never appear to be
enforced when it is not. `canonicalUnicodeScalar` additionally carries a
portable `pattern` that states the same no-NUL, no-unpaired-surrogate rule for
any draft 2020-12 validator. The checks README tabulates all three.

## Task cards

A task card is a child Bead beneath the domain's current root objective. It
carries the task metadata the wave planner requires (acceptance identifiers,
dependencies, owned paths, conflict domains, reservations, mandatory
verification, risk, priority, independence) plus the optional
`materialisationTargets`, `supersedes`, and `tombstones` facts. Owned paths
are Git paths inside the allowed write roots. Supersession is a validated fact
the projection reads: every identifier named in `supersedes` or `tombstones`
must be an existing provenance record id in the events directory. Notes may
add the read-only source list and the audience label, which must equal the
repository's domain.

## Declared gates

| Check                     | Establishes                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Markdown format           | The bundled formatter reports no change                                                                                  |
| Frontmatter schema        | Every page's metadata matches the repository's strict schema                                                             |
| Relative link resolution  | Every intra-repository link resolves                                                                                     |
| Boundary policy           | No write outside allowed roots; no forbidden marker for this audience                                                    |
| Secret scan               | No credential shape in any changed file                                                                                  |
| Generated reproducibility | Rebuilding the generated directory produces no drift                                                                     |
| Provenance validity       | Every record validates, has a unique id and valid supersession links, and binds a landed OID that is an ancestor of HEAD |
| Supersession              | Every superseded page names its successor and vice versa                                                                 |

The candidate gate excludes the generated-reproducibility check, because a
candidate that adds a topic legitimately changes a rollup's input without
owning the generated directory; that check runs on the provenance-commit tree
before landing and again in the wave's aggregate verification.

## Environment the controller must provide

Every `mountPathVariable` and the `worktreeRootVariable` must be set to a
canonical absolute path when the controller configuration is composed. The
roots must be pairwise disjoint, and the provenance worktree root may not
overlap any alias root. Missing or malformed values refuse composition; the
run never guesses a host path.
