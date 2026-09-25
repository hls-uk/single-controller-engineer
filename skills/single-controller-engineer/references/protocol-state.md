# Protocol state and recovery

Use the vendored `sce` executable as a stepwise protocol engine, not a daemon.
`inspect`, `status`, and `next` are read-only: they perform no act on an
outstanding manual launch and journal nothing for it, so it stays intended
until `record-dispatch` settles it. Mutating progress uses an explicit
controller config, expected revision, idempotency key, and strict JSON
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

Not every negative blocks; some are typed refusals that settle the effect and
name the next step. A candidate diff measured past the reviewer packet's bound
is refused as `candidate_refused` carrying that measurement and routes to
repair, never to review. An integration refused because the integration ref
moved or its checkout was dirty is refused as `integrate_refused` and returns
the unit to approved with its candidate, review, and approval bindings intact.
A prepared unit still on a stale base refreshes before its first dispatch,
fast-forwarding its empty branch and worktree so the first packet binds the
base the worker starts on. Read the event schemas through `sce --help` and the
engine, not from this prose.

Do not infer completion from elapsed time, an empty queue, or a missing process.
Preserve the candidate and durable evidence; resume only through the recorded
idempotency key and authority boundary.

## Attested malformed-publication recovery

New unit branches are short names only; a `refs/heads/...` value is rejected
before branch or worktree effects exist. Legacy stored runs remain readable.
For the one case where an earlier full ref reached an ambiguous publish,
`recover-publication-ref` accepts only an exact
`sce.publication-recovery-acknowledgement` v1. The operator must first inspect
the exact provider rejection and attest that inspection, then bind the run,
revision, holder, incarnation, fence, effect, old params hash, candidate
base/head/tree, old full ref, and a valid short replacement.

Recovery performs read-only repository and sole-push-remote checks: the old
expanded target must be absent and the replacement must be absent or already
at the candidate. It records a truthful attested refusal but issues no push.
The physical `unit.branchRef` and worktree stay unchanged; only the optional
publication ref is set, so a later normal publish derives a distinct intent.
The acknowledgement is an operator assertion, not a provider receipt or
cryptographic proof. A generic raw `publish_refused` event is not an admitted
recovery path.

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
plain `sha256` of the same bytes so the two are visibly different values. A
`--file` is measured before it is read, so a path that is not a regular file
is refused rather than consumed, and a leading byte-order mark is dropped
exactly as the collector's decoder drops it. Refusals carry
`SCE_CANDIDATE_DIFF_INVALID` for bytes no candidate could have had and
`SCE_CANDIDATE_DIFF_UNREADABLE` for bytes that could not be read at all.
The same derivation by hand is
`printf 'sce.protocol.candidate-diff/v1\n' | cat - diff.txt | sha256sum`,
using `shasum -a 256` in place of `sha256sum` where only that one is
installed, as on stock macOS.
Compare both printed values with the packet's fields of the same name: a
difference means the reproduced bytes are not the reviewed candidate, which
blocks the review rather than being explained away.
