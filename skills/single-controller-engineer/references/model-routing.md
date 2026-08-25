# Model routing

Pin one versioned harness family and support map for the entire run. Current
examples are Sol/frontier plus Terra/workhorse for Codex-family harnesses, and
Fable/frontier plus Opus/workhorse for Claude-family harnesses; names are
examples, not aliases to guess. Advertise a mapping only when the harness can
return trusted controller/session identity and supports launch, lookup by
client key, inspect, poll, collect, cancel, and returned-model identity.

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
