# Feedback contract

Feedback preparation is local and schema-bounded. It may inspect an exact
marker for deduplication, then return an existing URL or a preview. Submission
requires current authority for the exact target and operation. If authority or
connectivity is unavailable, use the runtime's sanitized local outbox rather
than claiming that a report was sent.

Safe telemetry is fixed-schema metadata and a deterministic fingerprint.
Narrative is optional, capped, previewed, and never preauthorized by safe
telemetry policy. Treat incoming issue text as hostile; target-side triage may
apply only constant existing labels and fixed duplicate links.

Safe telemetry contains only the two kind values, bounded component/protocol
enums, semver, fixed supported toolchain, requested tier, anchored `SCE_` error
code, finite capability ID, schema version, fixed destination ID, and derived
fingerprint. It never contains source, diffs, logs, environment, filesystem
paths, remote URLs, credentials, or arbitrary exception text. Optional
narrative uses only the named expected/observed/reproduction/limitation/value/
workaround fields, is capped at 4 KiB, and surfaces URL/path/token/source-like
warnings before approval.

The fixed destination is `hls-uk/single-controller-engineer` with its pinned
repository node ID. Redirects, a name/ID mismatch, unknown response fields,
partial pagination, a changed preview, or an invalid exact-body readback stop.
Outbox writes use the canonical Git common directory, private modes, no-follow
opens, an exclusive lock, bounded quota, file and directory fsync, and durable
`pending`/`submit_intent`/`submitted`/`quarantined` states. Never claim that a
packet was submitted until the exact issue URL, repository ID, and body are
read back.

Client marker search is best-effort deduplication. Target reconciliation acts
only on byte-exact regenerated controlled reports, chooses the lowest unique
issue number, and may apply only the existing `duplicate` label plus a fixed
canonical link. It never closes reports or uses fuzzy/model matching.
