# Protocol state and recovery

Use the vendored `sce` executable as a stepwise protocol engine, not a daemon.
`inspect`, `status`, and `next` are read-only. Mutating progress uses an
explicit controller config, expected revision, idempotency key, and strict JSON
event. Typical order is controller acquire, harness configure, wave plan,
reservation/branch/worktree, dispatch/collect, candidate observation,
verification, reviewer dispatch/collect, publish/integrate, cleanup, and
controller release. Invoke `sce --help` and command help for the current exact
surface; do not manufacture an event from this prose.

Persist intent before an external act and read back its exact result before the
next transition. The runtime reducer decides whether a transition/effect is
legal before the adapter acts, and the same reducer validates persisted state.
Host-only harness operations cross the narrow tool request/acknowledgement
seam; the controller makes exactly that call and returns the strict
acknowledgement without rewriting prompt, model, role, or worktree.

Bind qualification, approval, review, and integration to the current exact
base/head/tree and observed commands. A moved pair, crash ambiguity, missing
authority, unsafe privacy/secret boundary, unknown topology, malformed
readback, or unsupported schema blocks the affected action.

Do not infer completion from elapsed time, an empty queue, or a missing process.
Preserve the candidate and durable evidence; resume only through the recorded
idempotency key and authority boundary.
