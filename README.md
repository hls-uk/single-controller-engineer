# single-controller-engineer

`@hls-uk/single-controller-engineer` ships a deterministic Node 22 CLI and a
paired primary/feedback Codex skill set for accelerated-beta delivery with one
Beads-backed controller.

The default loop is small core slice first, deterministic checks before model
inference, no more than three isolated workhorse lanes, a fresh frontier review
of each frozen candidate, and serialized exact-pair integration. `P0` and `P1`
findings block promised paths; record bounded `P2`/`P3` work as follow-up.

## Development and evidence

```sh
npm run test:fast          # deterministic units and core paths
npm run test:integration   # affected seams only
npm run test:package       # offline lifecycle-disabled npm tarball inspection
npm run test:release       # release-only aggregate; includes the slow checklist
```

The release manifest keeps topology, crash/concurrency, provider, package and
live-agent evidence separate from the fast loop. Live-agent evaluations are
non-hermetic release evidence, not a CI substitute for deterministic fencing.

## Installation and authority

The CLI's `install-skill` integration is intentionally explicit: it installs
the primary and feedback skills as one manifest-hashed pair, refusing an
unrelated collision, partial pair, changed owned files, or cross-filesystem
staging. npm has no `postinstall` side effect and does not download a CLI at
runtime. Publishing, tags, pushes, and feedback submission all need separate
current authority.

See the
[accelerated beta design](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/designs/2026-08-25-accelerated-beta-engineering.md)
and
[controller design](https://github.com/hls-uk/single-controller-engineer/blob/main/wiki/designs/2026-08-24-single-controller-engineer.md)
for the governing contracts (the npm tarball intentionally omits repository
wiki history).
