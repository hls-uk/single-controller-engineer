# Embedded Beads topology

Use only when `bd context --json` and pinned Dolt/config observations prove an
embedded store, its canonical database directory, exact prefix, supported tool
version, and either `local-only` or `git-sync` mode. `.beads/issues.jsonl` is a
passive export, never synchronization truth.

The controller is the sole `bd` writer. Workers may receive compact issue
metadata but do not run mutating `bd` commands. In `git-sync` mode, bind the
exact remote and `refs/dolt/data`; pull before a write batch, accept only the
supported metadata-only clone-lineage edges, commit the one controlled batch,
push without force, and read the remote OID back. In local-only mode, do not
claim cross-clone or cross-host exclusion.

Refuse dirty/pending Dolt state, ambiguous clone lineage, an unproved controller
slot, remote movement, schema skew, missing executable identity, or another
writer. Do not use `bd import`, hand-edit JSONL, delete the Dolt database, or
reset/reclone as recovery. Preserve state and request authority for repair.
