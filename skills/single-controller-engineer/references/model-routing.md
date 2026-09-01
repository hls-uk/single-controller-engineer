# Model routing

Pin one versioned harness family and support map for the entire run. Current
examples are Sol/frontier plus Terra/workhorse for Codex-family harnesses, and
Fable/frontier plus Opus/workhorse for Claude-family harnesses; names are
examples, not permanent pins or aliases to guess. Pin a lifecycle-complete
mapping — launch, inspect, poll, collect, cancel, returned-model identity —
and record its classification with it: without lookup by client key, dispatch
recovery is at-most-once-manual; without trusted controller identity, tier
enforcement is unavailable. Such a profile runs through the manual model-tool
request/acknowledgement seam on human-bound observations, and any path that
requires the missing operation fails explicitly. Advertise crash-safe dispatch
or a proven tier only with both trust operations and live release evidence.

The controller and fresh final reviewer require the configured frontier
capability. Implementation, repair, and ordinary diagnosis use workhorse, with
at most three modifying sessions across the repository and one per unit.
Reviewers are read-only and only one current-base reviewer is active. “Fresh”
means a new context with no inherited implementation conversation.

Generate the exact prompt packet before launch and persist its bytes/hash,
role, unit, worktree, base/candidate OIDs, model request, and idempotency key.
Accept a session only when client key, prompt hash, worktree, role, harness
identity, requested model, and returned identity all match. Recover an
ambiguous launch only through exact client-key lookup; otherwise block for a
human-bound observation rather than redispatch.

Persist requested and returned identities for every call. An unavailable
tier, missing identity, mismatch, or downgrade is unavailable evidence—not
permission to substitute silently. A reviewer verdict applies only to its
frozen exact base/head and must be discarded after any repair or base change.
