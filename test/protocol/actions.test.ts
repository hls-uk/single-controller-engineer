import assert from "node:assert/strict";
import test from "node:test";
import { legalActions } from "../../src/protocol/actions.js";
import { deriveIdempotencyKey, reduce } from "../../src/protocol/reducer.js";
import { HASH, run } from "./fixtures.js";

test("legal actions are pure, ownership-aware, and acquisition emits once", () => {
  assert.deepEqual(legalActions(run())[0], {
    type: "reservation_intent",
    mode: "emit",
    unitId: "unit-1",
    effectKind: "reservation_acquire",
  });
  const initializing = {
    ...run(),
    state: "initializing" as const,
    controller: {
      runId: "run-1",
      incarnationId: "incarnation-1",
      holder: "run-1/incarnation-1",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      promptHash: HASH,
      state: "unacquired" as const,
    },
  };
  const first = reduce(initializing, {
    eventId: "acquire-1",
    expectedRevision: 0,
    type: "controller_acquire_intent",
    idempotencyKey: deriveIdempotencyKey(
      initializing,
      0,
      null,
      "controller_acquire",
    ),
    paramsHash: HASH,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.effects[0]?.kind, "controller_acquire");
  assert.deepEqual(legalActions(first.nextState), [
    {
      type: "controller_acquired",
      mode: "record",
      effectKind: "controller_acquire",
    },
  ]);
  assert.equal(
    reduce(first.nextState, {
      eventId: "acquire-2",
      expectedRevision: 1,
      type: "controller_acquire_intent",
      idempotencyKey: deriveIdempotencyKey(
        first.nextState,
        1,
        null,
        "controller_acquire",
      ),
      paramsHash: HASH,
    }).ok,
    false,
  );
  const ambiguous = reduce(first.nextState, {
    eventId: "ambiguous-1",
    expectedRevision: 1,
    unitId: null,
    type: "effect_ambiguous",
    effectId: "acquire-1:controller_acquire",
    effectKind: "controller_acquire",
  });
  assert.equal(ambiguous.ok, true);
  if (!ambiguous.ok) return;
  const reconciled = reduce(ambiguous.nextState, {
    eventId: "acquire-observed",
    expectedRevision: 2,
    type: "controller_acquired",
    effectId: "acquire-1:controller_acquire",
    effectKind: "controller_acquire",
    observationHash: HASH,
  });
  assert.equal(reconciled.ok, true);
  if (reconciled.ok) assert.equal(reconciled.nextState.state, "active");
});

test("record actions are withheld until their exact intended effect is durable", () => {
  const unresolved = {
    ...run(),
    units: {
      "unit-1": {
        ...run().units["unit-1"]!,
        state: "reservation_intent" as const,
      },
    },
  };
  assert.deepEqual(legalActions(unresolved), []);
});
