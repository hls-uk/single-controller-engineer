import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { reduce, runInvariantErrors } from "../../src/protocol/reducer.js";
import type {
  ProtocolEvent,
  RepositoryRun,
} from "../../src/protocol/schemas.js";
import {
  HASH,
  OID_A,
  OID_B,
  OID_C,
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
  return transition(state, event(state, type, fields), reduce);
}
function effectId(state: RepositoryRun, kind: string): string {
  return `event-${state.revision}:${kind}`;
}
function observe(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  kind: string,
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return step(state, type, {
    effectId: effectId(state, kind),
    effectKind: kind,
    observationHash: HASH,
    ...fields,
  });
}
function completeCandidate(): RepositoryRun {
  let state = run();
  state = step(state, "reservation_intent", {
    idempotencyKey: "reserve-1",
    paramsHash: HASH,
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  state = observe(state, "reservation_observed", "reservation_acquire");
  state = step(state, "branch_intent", {
    idempotencyKey: "branch-1",
    paramsHash: HASH,
    branchRef: "sce/unit-1",
  });
  state = observe(state, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  state = step(state, "worktree_intent", {
    idempotencyKey: "worktree-1",
    paramsHash: HASH,
    worktreePath: "/tmp/unit-1",
  });
  state = observe(state, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  state = step(state, "dispatch_intent", {
    idempotencyKey: "dispatch-1",
    paramsHash: HASH,
  });
  state = observe(state, "dispatch_observed", "dispatch", {
    sessionId: "worker-1",
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  state = step(state, "collect_intent", {
    idempotencyKey: "collect-1",
    paramsHash: HASH,
  });
  state = observe(state, "worker_collected", "worker_collect", {
    workerResult: { status: "completed", summary: "done", residualRisks: [] },
  });
  state = step(state, "candidate_intent", {
    idempotencyKey: "candidate-1",
    paramsHash: HASH,
  });
  state = observe(state, "candidate_observed", "candidate_collect", {
    headOid: OID_B,
    treeOid: OID_C,
  });
  return state;
}

test("crash-safe happy path journals each effect before observing exact facts", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {
    idempotencyKey: "verify-1",
    paramsHash: HASH,
  });
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {
    idempotencyKey: "reviewer-1",
    paramsHash: HASH,
  });
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {
    idempotencyKey: "review-collect-1",
    paramsHash: HASH,
  });
  state = observe(state, "review_collected", "review_collect", {
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "reviewer-1",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "approved exact pair",
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
      decision: "approve",
      findings: [],
    },
  });
  state = step(state, "publish_intent", {
    idempotencyKey: "publish-1",
    paramsHash: HASH,
  });
  state = observe(state, "publish_observed", "publish", {
    remoteHeadOid: OID_B,
  });
  state = step(state, "integrate_intent", {
    idempotencyKey: "integrate-1",
    paramsHash: HASH,
  });
  state = observe(state, "integrate_observed", "integrate", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
    integrationOid: OID_C,
    controllerFencingToken: "fence-1",
  });
  state = step(state, "reservation_release_intent", {
    idempotencyKey: "release-reservation-1",
    paramsHash: HASH,
  });
  state = observe(state, "reservation_released", "reservation_release");
  assert.equal(state.units["unit-1"]?.state, "closed");
  assert.equal(
    state.effectJournal.every((entry) => entry.status === "observed"),
    true,
  );
  assert.deepEqual(runInvariantErrors(state), []);
  state = transition(
    state,
    {
      eventId: "controller-release",
      expectedRevision: state.revision,
      type: "controller_release_intent",
      idempotencyKey: "controller-release-1",
      paramsHash: HASH,
    },
    reduce,
  );
  state = transition(
    state,
    {
      eventId: "controller-released",
      expectedRevision: state.revision,
      type: "controller_released",
      effectId: "controller-release:controller_release",
      effectKind: "controller_release",
      observationHash: HASH,
    },
    reduce,
  );
  assert.equal(state.state, "released");
});

test("observations reject wrong kind, stale revision, duplicate IDs, and moved pairs", () => {
  const initial = run();
  const intent = event(initial, "reservation_intent", {
    idempotencyKey: "reserve-1",
    paramsHash: HASH,
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  const after = transition(initial, intent, reduce);
  assert.equal(after.effectJournal[0]?.status, "intended");
  const firstReduction = reduce(initial, intent);
  assert.equal(firstReduction.ok, true);
  if (firstReduction.ok) assert.equal(firstReduction.effects.length, 1);
  assert.equal(
    reduce(after, {
      ...intent,
      expectedRevision: initial.revision,
      eventId: "stale",
    }).ok,
    false,
  );
  assert.equal(
    reduce(after, { ...intent, expectedRevision: after.revision }).ok,
    false,
  );
  assert.equal(
    reduce(
      after,
      event(after, "reservation_observed", {
        effectId: "event-1:reservation_acquire",
        effectKind: "branch_create",
        observationHash: HASH,
      }),
    ).ok,
    false,
  );

  const candidate = completeCandidate();
  const moved = {
    ...candidate,
    units: {
      "unit-1": { ...candidate.units["unit-1"]!, candidateHead: OID_C },
    },
  };
  assert.equal(
    reduce(
      moved,
      event(moved, "verification_intent", {
        idempotencyKey: "verify-1",
        paramsHash: HASH,
      }),
    ).ok,
    true,
  );
});

test("review approval binds role, session, exact model, revision, prompt, and Git facts", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {
    idempotencyKey: "verify-1",
    paramsHash: HASH,
  });
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {
    idempotencyKey: "reviewer-1",
    paramsHash: HASH,
  });
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {
    idempotencyKey: "review-collect-1",
    paramsHash: HASH,
  });
  const invalid = event(state, "review_collected", {
    effectId: effectId(state, "review_collect"),
    effectKind: "review_collect",
    observationHash: HASH,
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "reviewer-1",
      requestedModel: "frontier",
      returnedModel: "wrong-model",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "wrong identity",
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
      decision: "approve",
      findings: [],
    },
  });
  assert.equal(reduce(state, invalid).ok, false);
  const movedPair = event(state, "review_collected", {
    effectId: effectId(state, "review_collect"),
    effectKind: "review_collect",
    observationHash: HASH,
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "wrong-session",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "moved pair",
      baseOid: OID_A,
      headOid: OID_C,
      treeOid: OID_C,
      decision: "approve",
      findings: [],
    },
  });
  assert.equal(reduce(state, movedPair).ok, false);
  const reviewEvent = invalid as Extract<
    ProtocolEvent,
    { type: "review_collected" }
  >;
  const wrongRole = {
    ...reviewEvent,
    judgment: { ...reviewEvent.judgment, role: "controller" },
  } as unknown as ProtocolEvent;
  assert.equal(reduce(state, wrongRole).ok, false);
});

test("session capacity and persisted aggregate invariants cannot lie", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 7 }), (count) => {
      const units = Array.from({ length: count }, (_, index) => ({
        ...unit(`unit-${index + 1}`, "worktree_observed"),
        worktreePath: `/tmp/unit-${index + 1}`,
      }));
      let state = run(units);
      for (const current of units) {
        const result = reduce(
          state,
          event(
            state,
            "dispatch_intent",
            { idempotencyKey: `dispatch-${current.id}`, paramsHash: HASH },
            current.id,
          ),
        );
        if (state.activeModifyingUnitIds.length < 3) {
          assert.equal(result.ok, true);
          if (result.ok) state = result.nextState;
        } else assert.equal(result.ok, false);
      }
      assert.ok(state.activeModifyingUnitIds.length <= 3);
      assert.deepEqual(runInvariantErrors(state), []);
    }),
  );
  const lying = { ...run(), activeModifyingUnitIds: ["unit-1"] };
  assert.ok(
    runInvariantErrors(lying).some((error) => error.includes("active-session")),
  );
});

test("ambiguous effect blocks instead of retrying and controller release needs legal cleanup", () => {
  let state = run();
  state = step(state, "reservation_intent", {
    idempotencyKey: "reserve-1",
    paramsHash: HASH,
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  state = step(state, "effect_ambiguous", {
    effectId: "event-1:reservation_acquire",
    effectKind: "reservation_acquire",
    observationHash: HASH,
  });
  assert.equal(state.state, "blocked");
  assert.equal(
    reduce(run(), {
      eventId: "release",
      expectedRevision: 0,
      type: "controller_release_intent",
      idempotencyKey: "controller-release",
      paramsHash: HASH,
    }).ok,
    false,
  );
});
