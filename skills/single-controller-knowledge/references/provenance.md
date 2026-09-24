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

Destination evidence is deduplicated as a whole destination, digest, and
status triple, so two targets deferred before resolution that share one
`alias:subpath` home contribute a single destination entry while the body
table still lists each target on its own row. The three materialisation
arrays stay positional and equal in length, destination entries are unique,
and a unit whose deduplicated destinations exceed sixty-four is refused
rather than truncated.

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

That discovery is bounded: the walk reads at most sixty-four commits back
from the integration head, in topological order, and it proves absence only
as far as it reached. The ordering is what makes the proof exact: no commit
is listed before every reachable child of it has been listed, so a walk that
has met the attempted base has already read every commit built on that base,
a landed keyed commit among them. Absence is therefore proven when the walk
meets that base, or when the whole reachable history was shorter than the
bound. A fresh attempt is proven at once, since its base is the head the
walk starts from. A window filled without either is unreadable, so the
attempt is ambiguous rather than absent: it blocks and asks instead of
committing a second time. The bound is deliberate and keeps discovery one
bounded read.

Every commit the walk reaches spends the window, including commits merged in
from a side branch, so the bound counts commits rather than landings and its
reach can be shorter than sixty-four landings. That costs reach, never
proof: a walk cut short is unreadable, never absent. Walking first parents
only would buy the reach back, but it would narrow what counts as reachable
and call a commit that arrived through a merge absent, which is the one
direction this discovery must never fail in.

## The frozen projection snapshot

The snapshot is bounded at 65,536 canonical bytes, measured on the bytes
actually stored, and is held in a strict versioned compact encoding: the
target definition and resolution are stored once and each per-output entry is
associated with them positionally, by its index in the stored arrays rather
than by a stored key, with compaction and hydration both enforcing equal
lengths. The destination target, the target and origin identifiers, the
resolved source OID and tuple, and the observation digests are therefore no
longer repeated per output. Hydration is total and exact, and the view it
produces is validated against the one schema every consumer reads, so a
stored encoding that is legal in itself cannot smuggle an illegal view past
it. The snapshot commitment, the provenance entry id, and the carry export id
all bind that hydrated view rather than the stored bytes, so a run holding
the older version-free encoding keeps the identifiers it was issued and a
carry crossing the two encodings commits to the same snapshot.

Version 3 also retires the resolution's remaining live budget. That budget is
the controller's own bookkeeping at the moment the resolve intent was issued:
the live gate record still holds it, and no provenance reader can act on it,
so freezing drops it rather than parking it beside the snapshot. The drop
happens where a live target is frozen and never when a stored projection is
re-encoded, so a projection frozen before version 3 keeps its budget, keeps
hydrating to the exact view its commitments were taken over, and is never
migrated. A version-3 entry is resolution-bearing and never restates the
budget it dropped; bearing a resolution is not being settled, so a pending
one is legal in the encoding and is refused by the projection's settlement
rule instead. A carried entry frozen earlier sits beside a newly frozen one
and each stays the one canonical encoding of itself.

Because the budget is gone from the stored bytes, a version-3 run no longer
binds capacities-only drift: the run invariant compares the snapshot against
the live evidence with that budget retired, so a live gate record differing
from its snapshot in nothing but its remaining budget is no longer drift. A
run frozen before version 3 is still compared against the exact budget it
stored, so neither form is normalised into the other.

The capacity is exact, not estimated, and it is measured on projections the
protocol accepts rather than on shapes the schema merely admits. One more
minimal accepted output costs 645 stored bytes instead of 1,312, so
sixty-four occupy 47,441 bytes where they needed 90,447 and did not fit; at
most forty-five fitted before and ninety-one fit now. The retired budget is
charged per resolved target rather than per output: one minimal target
holding one output costs 1,173 stored bytes instead of 1,351, so sixty-four
of them occupy 80,759 bytes instead of 92,151 and fifty-one fit where
forty-four did. A resolved unit tuple reserves the full live gate record,
1,903 bytes, plus the frozen copy, 1,239 bytes, for an aggregate of 3,142
rather than twice the live one. No ceiling moves: 65,536 snapshot bytes,
131,072 envelope bytes, and sixty-four outputs per target are all
unchanged.

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
