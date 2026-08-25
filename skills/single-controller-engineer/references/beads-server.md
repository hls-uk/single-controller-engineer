# Shared-server Beads topology

Use only after preflight proves the configured server endpoint/database/schema,
transport policy, exact prefix, auto-commit policy, credential provenance, and
separate writer/worker roles. Managed-local mode additionally binds the pinned
server process and data/config directories; external mode never starts or
administers the server.

The controller alone uses the writer credential. Worker credentials are
read-only and their mutation probes must fail. Acquire/check/release the single
repository controller slot with server-side atomic compare-and-set and exact
readback; persist positive release evidence before reacquisition. Row revision,
holder, fencing token, run identity, and store scope must agree on every write.

Server mode changes synchronization mechanics, not ownership. Do not run
embedded Dolt push/pull against it, grant workers tracker writes, infer a slot
from issue claims, alter users/grants/schema, or restart an external server.
Outage, contradictory identity, unknown auto-commit behavior, ambiguous slot,
or schema/version skew blocks dispatch and recovery while preserving state.
