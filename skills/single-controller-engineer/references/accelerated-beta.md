# Accelerated beta delivery

Use the smallest coherent core path. Prefer a deterministic check whenever
Git, Beads, a schema, a provider readback, a manifest, or a hash can establish
the fact. Use model judgment for decomposition, implementation, diagnosis, and
adversarial review—not as a substitute for machine state.

Classify findings by user and authority impact:

- **P0:** data loss, destructive or unauthorized action, secret exposure, or
  systemic inability to use the product. Stop immediately.
- **P1:** a broken promised core path, unsafe duplicate effect, invalid
  ownership/integration, or a common-path failure without a practical
  workaround. Block the beta candidate.
- **P2:** a bounded edge case, hardening gap, usability defect with a
  workaround, or non-core provider limitation. Record durably and continue.
- **P3:** polish, optimisation, or speculation. Defer unless it is effectively
  free and cannot delay the candidate.

Do not lower severity because a defect is inconvenient to repair, and do not
promote speculative hardening merely because it is interesting.

Fast evidence is hermetic formatting, types, units, and core paths. Run
affected integration evidence only when its seam changes. Before the next tag,
run the separately invokable release tier: install/package/upgrade evidence,
topology, crash and concurrency, provider behavior, and recorded live-agent
evaluation. A live run is evidence, not proof of deterministic safety.

A slow failure blocks only the capability or tagged release whose evidence it
invalidates. Record the exact failure and severity; do not repeatedly rerun
unaffected suites. Keep the fast command lean as the repository grows.

Keep evidence compact: issue/decision, exact candidate pair, gates actually
run, P0/P1 disposition, deferred P2/P3, and missing authority. Re-review any
repair that changes a frozen candidate while a P0/P1 decision remains open.

An untagged beta is ready only when its public core paths work, fast and
affected integration evidence pass, no promised-path P0/P1 remains, a fresh
frontier reviewer accepts the frozen exact candidate, installable artifacts
agree with their sources, known P2/P3 are visible, and authoritative Git plus
Beads state is reported honestly. This does not waive a consuming repository's
stronger security, regulatory, release, or test requirement.
