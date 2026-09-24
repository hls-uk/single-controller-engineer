# DEC-20260924-020: A run that has spent its envelope is refused by name

Date: 2026-09-24. Status: accepted. Controller: the single-controller-engineer
dogfood run on this repository (bead `sce-ul2.8`, acceptances
`sce-ul2.8:A1` and `sce-ul2.8:A2`). It records the refusal a run at full
repair pressure now receives, and confirms the 61-unit guarantee
DEC-20260903-012's envelope work and `sce-dcx.14` first measured.

## Context

Three `LIMITS` in `src/protocol/schemas.ts` promise more together than any one
of them can pay for. `units` admits 64 units, `sessionHistory` admits their
2,176 `(ordinal, role, generation)` session slots, and `envelopeBytes` bounds
the whole durable aggregate at 131,072 bytes. Under full repair pressure —
every retained unit exhausting all 16 bounded repairs — the evidence is
incompressible, and the envelope runs out first. The reducer stress scenario
in `test/protocol/reducer.test.ts` measures every reduced step of that run:

- **61 units drain.** They peak at 131,066 bytes, at `unit-61`'s sixteenth
  `reviewer_observed`, with four units still retained: six bytes of headroom.
- **62 units do not.** The run stops at `unit-59`'s eleventh
  `reviewer_observed`, from an admitted preceding state of 130,898 bytes.
- **64 units do not.** The run stops at `unit-57`'s second
  `reviewer_observed`.

Those are unit names in the scenario's lexicographic drain order, not the
fifty-ninth and fifty-seventh units of the run; the earlier wording in the
`LIMITS` block read as ordinals and is corrected.

The gate observation path already admitted its own evidence budget before
committing, with a refusal that says so
(`"source observation exceeds its committed evidence budget"`). The repair and
review path did not. A 62-unit run — legal at every schema boundary, legal at
every transition, and within every declared slot bound — therefore ended as
`reject("invariant", "… repository run envelope exceeds byte limit …")`:
`invariant` is this reducer's code for "the aggregate I was handed is
internally inconsistent", and its reason is a joined list of free-form
invariant errors. A controller reading that cannot tell a run that spent its
envelope from a corrupt or fabricated aggregate, and neither can the recovery
command that maps a rejected reduction onto `corrupt` or `blocked`.

## Decision

1. **`commit` admits the envelope before it commits.** Every transition, not
   only the repair and review path, measures the candidate `nextState` and
   refuses `illegal_transition` with the reason `"transition exceeds the
   repository run envelope budget"`. A refused reduction persists nothing and
   executes no effect, so this is a refusal before the act; the aggregate the
   controller still holds is the admitted state that preceded it.
2. **Admission and the invariant measure the same bytes.** Both call
   `runEnvelopeByteLength`, the at-rest `{schema, version, payload}` encoding.
   They cannot disagree by a byte, which matters when the guaranteed
   configuration clears the limit by six. `commit` tells the invariant sweep
   that it has already admitted this exact state, so the measurement is taken
   once per transition and the guaranteed run is not slowed.
3. **The invariant keeps the bound for hydration.** `runInvariantErrors` still
   reports `"repository run envelope exceeds byte limit"` for a state read
   from the store. An oversized aggregate at rest *is* ambiguous machine
   state; an oversized transition is not.
4. **Refuse; do not park.** Parking is a controller disposition with its own
   intent, its own external act, and its own durable growth before the unit is
   released — the reducer cannot take it unilaterally, and a park committed at
   the boundary could itself fail to fit. The refusal names the budget and
   leaves the choice where it belongs: the controller drains or parks the
   current wave and proceeds, or it stops the run. The reducer never guesses
   through ambiguous capacity.
5. **The guarantee stays 61 units at full repair pressure.** No limit moves.
   `SCHEMA_VERSION`, the session lineage encoding, the replay windows, the
   closure ledger, and every other on-disk format are unchanged, so this
   record changes no stored run.
6. **It is pinned where the capacity is pinned.** `test/protocol/reducer.test.ts`
   drives 61 units to a drained end state and its exact 131,066-byte peak, and
   drives 62 units to the refusal, asserting the step, the code, the reason,
   and the 130,898-byte state the refusal left behind. Both share the
   `64 retained units …` name prefix that `test/fast.manifest.json` skips, so
   the fast tier stays lean and both run in the release tier.

## Rejected alternatives

- **A forward reserve at `repair_intent`**, refusing the attempt before it
  begins rather than at the first transition it cannot afford. This is the
  shape `materialisationFixedCompletionReserve` gives the gate path, and it is
  the better shape — but the guaranteed configuration peaks six bytes under
  the limit. Any reserve larger than six bytes refuses runs that fit, which
  would lower the guarantee to buy an earlier refusal. Measuring the candidate
  state is exact; a reserve at this margin is not.
- **`invalid_event`, the gate path's code.** There the event itself carries
  oversized evidence, so the event is the thing at fault. Here the event is
  well-formed, schema-valid, and legal for the unit's state; what is exhausted
  is the run. `illegal_transition` is the reducer's existing word for a
  transition this state does not admit, and it is what draining the wave may
  make admissible again.
- **Raising `envelopeBytes`.** It would move the boundary without stating it,
  and the bound is not arbitrary: the aggregate is one compare-and-set record
  that every transition rewrites and reads back.
- **Lowering `units` to 61.** `units` bounds the unit map; the envelope cost
  is a function of repair pressure, not of unit count alone. A 61-unit cap
  would refuse legal 64-unit runs that never repair, to describe a limit that
  is not theirs.
- **Taking a durable-format lever now to restore 64.** At the drained end of
  the 61-unit run the session lineage is 66,596 bytes, which is 88,796 base64
  characters of a 125,577-byte aggregate: the single largest tenant of the
  envelope, at `sessionFingerprintBytes` (32) per occupied slot. Halving the
  fingerprint to 16 bytes would return roughly 41,600 characters — arithmetic
  on the measured lineage, not a measured run — and 128 truncated SHA-256 bits
  over at most 2,176 slots is not a collision risk. Packing the two 256-entry
  replay windows into digest form instead of identifier strings is the same
  kind of lever, smaller. Both rewrite a durable format and so move
  `SCHEMA_VERSION`, and neither is needed to make a legal run behave
  correctly — which is what this bead is about. They are recorded here as the
  levers that exist, to be taken deliberately with a migration, not folded
  into a refusal fix.

## Consequences

- Behaviour is unchanged except for the code and reason of one rejection. The
  same transition is refused on the same step of the same run, measured the
  same way; the 61-unit guarantee, its 131,066-byte peak, and its
  66,596-byte lineage are byte-identical, and the scenario pins all three.
- A controller can now distinguish a spent envelope from a corrupt aggregate,
  and `test/protocol/schemas.test.ts` keeps pinning the hydration invariant
  separately.
- `test/protocol/fixtures.ts` gains `attemptTransition`, the effect-checked
  reduction that returns a refusal instead of throwing it, so a scenario can
  drive a run to the boundary of a bound and read the refusal's code.
  `transition` is now that function plus its throw.
- The release tier grows by the 62-unit run, about a minute on a development
  machine. The fast and integration tiers are unchanged.

## Follow-up

- The vendored bundle `skills/single-controller-engineer/scripts/sce.mjs` is
  rebuilt by the controller and still carries the previous reducer until then.
- If the full 64-unit configuration is ever needed at full repair pressure,
  take the 16-byte session fingerprint with a `SCHEMA_VERSION` change and a
  read migration, and re-measure the scenario rather than assuming the
  arithmetic above.
