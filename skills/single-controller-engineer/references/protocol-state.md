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

## Reproduce the reviewed candidate diff

A reviewer packet carries `candidateDiffCommand`, the exact argv that prints
the frozen candidate diff in its worktree, and `candidateDiffHash`. That hash
is domain-separated: it commits `sce.protocol.candidate-diff/v1`, a newline,
and then the diff bytes, so a plain checksum of the reproduced bytes always
mismatches. Derive the comparable digest with the read-only public command
instead of rederiving it from engine source:

```sh
<candidateDiffCommand from the packet> | sce candidate-digest --raw
```

It reads the bytes from standard input or `--file <absolute path>`, refuses
anything the collector would not have hashed (empty, invalid UTF-8, a NUL
byte, or more than 65536 bytes), and prints `candidateDiffHash`,
`candidateDiffByteCount`, and the `domain` it prefixed; `--raw` adds the
plain `sha256` of the same bytes so the two are visibly different values.
The same derivation by hand is
`printf 'sce.protocol.candidate-diff/v1\n' | cat - diff.txt | sha256sum`.
Compare both printed values with the packet's fields of the same name: a
difference means the reproduced bytes are not the reviewed candidate, which
blocks the review rather than being explained away.
