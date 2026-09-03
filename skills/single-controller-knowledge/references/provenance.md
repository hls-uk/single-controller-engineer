# Provenance

A provenance record is a deterministic projection of validated evidence, not
prose. The runtime projects it, commits it, proves it reproducible, lands it,
and verifies the wave on it. The controller journals intents and reads back
observations; it never writes a record, a rollup, or a commit by hand.

## Records

One record per landed unit is written under the manifest's events directory
as `<record id>.md`, where the record id is the unit identifier made
filesystem-safe followed by `--` and the first twelve characters of the
landed OID. The frontmatter carries every DEC-002 field as JSON scalars and
arrays in a fixed order, validated by the shipped
`manifest/provenance-record.schema.json`: schema and version, id, project,
access domain, audience, unit, human driver, executor tool and session,
UTC timestamp, base and landed OIDs, owned paths, acceptance identifiers,
verification commands with results and evidence hashes, the review decision
and its bound base, head, tree, prompt and response hashes, materialised
destinations with digests and `observed` or `deferred` statuses, supersedes,
tombstones, and a bounded summary. The body begins with `# Provenance record`
and a table of every target with its resolution, refusal, disposition, and
follow-up Bead. A target deferred before resolution carries only the bound
target, refusal, and follow-up evidence; no path, digest, or final name is
invented. Records never contain secrets, transcripts, or narrative.

## The provenance commit

After every original unit of the wave and every unit target settles, the
reducer freezes the projection snapshot, accepts one clock observation for
the provenance entry, and admits one `provenance_commit` intent bound to the
current integration base and a reducer-derived worktree path under the
provenance worktree root. The runtime then:

1. creates a detached worktree at the landed integration OID at that path,
   or admits an existing one only when its HEAD is that OID and clean, or
   its HEAD is a keyed commit on that base with byte-identical records;
2. writes the projected records, runs the manifest's rollup generator with
   `--output <worktree>/<generated directory>`, stages everything, and builds
   one commit whose parent is the base, whose author and committer are the
   controller holder with the constant email `sce@noreply.invalid` and the
   journaled clock, and whose message is `sce: provenance for wave <wave>`
   with the trailer `SCE-Provenance-Key: <idempotency key>`;
3. runs the manifest's reproducibility command in that worktree and requires
   a clean tree and unchanged records; a failure is the
   `reproducibility_failed` result with no ref moved and the worktree
   preserved as evidence;
4. lands the commit by local fast-forward or non-force push and reads it
   back. `committed` carries the base, commit, and tree; `base_advanced`
   carries the newly observed base and is the only result that automatically
   admits a rebound intent on the same gate entry with a new key and path;
   `worktree_refused` and `integration_refused` qualify only for explicit
   deferral.

Discovery on resume finds the commit by its trailer on the integration branch
and observes it without a second act when the records read back byte for
byte. Two projections from the same journaled inputs produce identical bytes
and the same commit OID; a deliberate base advance produces a new one.

## Aggregate verification

The same preserved worktree, at the provenance-commit OID, is the working
directory of the wave's aggregate verification. The runtime recreates an
absent worktree there, then executes the recorded argv vectors without a
shell in a sanitized environment that carries `SCE_CANDIDATE_BASE_OID` and
`SCE_PROVENANCE_COMMIT_OID`. Every vector must exit zero within its bound;
`verification_failed` qualifies the entry for deferral, which voids the
pending gate targets in the same event. Only after a green aggregate
verification do gate targets resolve and materialise.

## Deferral and carry

Deferring the provenance entry preserves its complete projection snapshot
and lineage in the voided entry. A later wave in the same run merges the
carried members with its own landed units; a new run imports the carry with
the dedicated `claim-provenance-carry` command, which claims the predecessor
root Bead's export exactly once. A committed observation is the only
transition that clears the carry. The controller never edits the snapshot or
replays a claim.
