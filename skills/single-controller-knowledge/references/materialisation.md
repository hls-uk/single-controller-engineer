# Materialisation

Materialisation publishes landed Git artifacts to a partnered Drive through
typed gate effects. It is never a direct write. The engine owns the contract;
this reference states what the controller sees and must never supply from
memory. Read [protocol state](../../single-controller-engineer/references/protocol-state.md)
for the intent-then-observation pattern every effect follows.

## Targets

A target names a bounded source pattern in the landed tree, a destination
alias and subpath, a naming policy, and `sidecarRequired: true`. Unit targets
come from the task card and run after the unit lands; gate targets come from
the manifest and run after the wave's provenance commit is verified. The
source pattern is a slash-separated ASCII path whose segments never begin
with a wildcard; it admits `*` and `?` within a segment and rejects `**`,
pathspec magic, empty, dot, and parent segments.

## Effects in order

1. **Resolve** (`materialisation_resolve`): the source executor enumerates the
   exact landed OID's tree under a replacement-disabled, no-lazy-fetch,
   sanitized Git context, applies the closed matcher itself, and observes
   byte-sorted `(path, blob OID, sha256, byte count)` tuples. It expands every
   valid match or refuses the whole result: zero or more than 64 matches, more
   than 128 outputs or 64 MiB per wave, a non-blob, an oversize blob, an
   unsafe path, or an evidence budget the run cannot retain.
2. **Probe** (`destination_probe`): one deduplicated probe per alias and
   subpath observes the final directory's canonical path, device, and inode
   after walking the destination no-follow and checking the marker file and
   containment. A missing marker is `optional_alias_unmounted` (the dependent
   entries are voided) or `required_alias_unmounted` (the probe stays pending
   until the Drive is mounted and a new probe is journaled, or the controller
   defers it). Any other topology violation is `invalid_destination`.
3. **Clock** (`gate_clock_observed`): after every stage probe settles, a
   validated UTC second per entry lets the reducer derive the exact artifact
   and sidecar names. The final clock of a stage records a bounded
   `output_name_collision` refusal on every colliding pending entry, grouped
   by observed device and inode; a later clock recomputes the whole stage.
4. **Materialise** (`materialise`): the intent binds the source facts, the
   alias with its recorded root, marker, mount and namespace policy, the
   observed destination identity, the driver, scope, executor tool, clock,
   and the complete artifact and sidecar names. The adapter re-probes, reads
   the blob by OID, requires the recorded digest and byte count, writes the
   sidecar and then the artifact to reserved temporary names, and publishes
   each with an atomic no-clobber hard link. Identical existing bytes are an
   already-observed act; different bytes are ambiguous and block. Nothing is
   ever overwritten, renamed over, or deleted.

## Names and sidecar

Final names follow one fixed grammar per policy (`source-basename`,
`iso-date-prefix`, `content-hash-suffix`) built from a safe source stem, the
first twelve source-OID characters, the UTC token, and the extension. The
sidecar is strict canonical JSON followed by one line feed, bounded to 8,192
bytes, carrying the run, wave, unit, target, gate entry, source OID and path,
blob OID, sha256, byte count, destination alias and subpath, artifact name,
driver, domain scope, executor tool, and timestamp. Admission proves the
worst-case sidecar for the exact driver fits before any promise exists.

## What the controller does

- Journal the next legal gate intent the runtime exposes; never choose a
  source path, digest, clock, name, or physical identity.
- Mount a required Drive and journal a new probe intent, or defer the shared
  probe and its dependents to a follow-up Bead.
- Defer a refused resolution, materialisation, or collision to a follow-up
  Bead when repair belongs to a later unit.
- Stop on an ambiguous outcome: an unexpected file, a changed inode, a
  different-byte final, or a foreign hard link is preserved for a human
  decision, never guessed through.
