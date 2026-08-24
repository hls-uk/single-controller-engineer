import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { reduce } from "../../src/protocol/reducer.js";
import type {
  ProtocolEvent,
  RepositoryRun,
} from "../../src/protocol/schemas.js";
import {
  HASH,
  OID_A,
  OID_B,
  event,
  run,
  transition,
  unit,
} from "./fixtures.js";

function step(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return transition(state, event(state, type, fields as never), reduce);
}

test("reducer is deterministic, revision-CAS guarded, and rejects duplicate events", () => {
  const initial = run();
  const intent = event(initial, "dispatch_intent", {
    idempotencyKey: "dispatch-1",
    paramsHash: HASH,
  });
  assert.deepEqual(reduce(initial, intent), reduce(initial, intent));
  const dispatched = transition(initial, intent, reduce);
  assert.equal(reduce(dispatched, intent).ok, false);
  assert.equal(
    reduce(dispatched, { ...intent, eventId: "new-event", expectedRevision: 0 })
      .ok,
    false,
  );
});

test("dispatch consumes at most three modifying slots at intent time", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 8 }), (count) => {
      const units = Array.from({ length: count }, (_, index) =>
        unit(`unit-${index + 1}`),
      );
      let state = run(units);
      for (const current of units) {
        const currentEvent = {
          eventId: `dispatch-${current.id}`,
          expectedRevision: state.revision,
          unitId: current.id,
          type: "dispatch_intent" as const,
          idempotencyKey: `key-${current.id}`,
          paramsHash: HASH,
        };
        const result = reduce(state, currentEvent);
        if (state.activeModifyingUnitIds.length < 3) {
          assert.equal(result.ok, true);
          if (result.ok) state = result.nextState;
        } else {
          assert.equal(result.ok, false);
        }
      }
      assert.ok(state.activeModifyingUnitIds.length <= 3);
    }),
  );
});

test("only one unit owns final qualification and integration", () => {
  const state = run([
    unit("unit-1", "verification_intent"),
    unit("unit-2", "verification_intent"),
  ]);
  const withCandidate = {
    ...state,
    units: {
      "unit-1": { ...state.units["unit-1"]!, candidateHead: OID_B },
      "unit-2": { ...state.units["unit-2"]!, candidateHead: OID_B },
    },
    effectJournal: [
      {
        effectId: "verify-1",
        unitId: "unit-1",
        idempotencyKey: "key-1",
        kind: "verify" as const,
        paramsHash: HASH,
        status: "intended" as const,
        schemaVersion: 1 as const,
      },
      {
        effectId: "verify-2",
        unitId: "unit-2",
        idempotencyKey: "key-2",
        kind: "verify" as const,
        paramsHash: HASH,
        status: "intended" as const,
        schemaVersion: 1 as const,
      },
    ],
  };
  const first = reduce(withCandidate, {
    eventId: "observe-1",
    expectedRevision: 0,
    unitId: "unit-1",
    type: "verification_observed",
    effectId: "verify-1",
    baseOid: OID_A,
    observationHash: HASH,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = reduce(first.nextState, {
    eventId: "observe-2",
    expectedRevision: 1,
    unitId: "unit-2",
    type: "verification_observed",
    effectId: "verify-2",
    baseOid: OID_A,
    observationHash: HASH,
  });
  assert.equal(second.ok, false);
});

test("moved reviewed pairs and ambiguous effects close the gate", () => {
  let state = run();
  state = step(state, "dispatch_intent", {
    idempotencyKey: "dispatch-1",
    paramsHash: HASH,
  });
  state = step(state, "effect_ambiguous", {
    effectId: "event-1:dispatch",
    observationHash: HASH,
  });
  assert.equal(state.state, "blocked");
  assert.equal(
    reduce(
      state,
      event(state, "dispatch_observed", {
        effectId: "event-1:dispatch",
        sessionId: "worker-1",
        observationHash: HASH,
      }),
    ).ok,
    false,
  );

  const approved = {
    ...run([unit("unit-1", "approved")]),
    qualificationOwnerUnitId: "unit-1",
    units: {
      "unit-1": {
        ...unit("unit-1", "approved"),
        candidateHead: OID_B,
        reviewBaseOid: OID_A,
        reviewHeadOid: OID_A,
        approvalHash: HASH,
      },
    },
  };
  assert.equal(
    reduce(approved, {
      eventId: "publish",
      expectedRevision: 0,
      unitId: "unit-1",
      type: "publish_intent",
      idempotencyKey: "publish-1",
      paramsHash: HASH,
    }).ok,
    false,
  );
});
