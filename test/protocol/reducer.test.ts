import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  deriveIdempotencyKey,
  reduce,
  runInvariantErrors,
} from "../../src/protocol/reducer.js";
import { canEnterTerminalIntent } from "../../src/protocol/guards.js";
import type {
  ProtocolEvent,
  RepositoryRun,
  UnitState,
} from "../../src/protocol/schemas.js";
import {
  LIMITS,
  RepositoryRunEnvelopeSchema,
  validate,
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
function stepUnit(
  state: RepositoryRun,
  unitId: string,
  type: ProtocolEvent["type"],
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return transition(state, event(state, type, fields, unitId), reduce);
}
function observeUnit(
  state: RepositoryRun,
  unitId: string,
  type: ProtocolEvent["type"],
  kind: string,
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return stepUnit(state, unitId, type, {
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
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "controller_release",
      ),
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
        branchRef: `sce/unit-${index + 1}`,
        worktreePath: `/tmp/unit-${index + 1}`,
        reservationIds: [`res-${index + 1}`],
      }));
      let state: RepositoryRun = {
        ...run(units),
        reservations: Object.fromEntries(
          units.map((item, index) => [
            `res-${index + 1}`,
            {
              id: `res-${index + 1}`,
              unitId: item.id,
              namespace: "port",
              resource: `${3000 + index}`,
              state: "reserved" as const,
              acquireEffectId: `reserve-${index + 1}`,
            },
          ]),
        ),
        effectJournal: units.map((item, index) => ({
          effectId: `reserve-${index + 1}`,
          unitId: item.id,
          idempotencyKey: `reserve-key-${index + 1}`,
          kind: "reservation_acquire" as const,
          paramsHash: HASH,
          status: "observed" as const,
          observationHash: HASH,
          schemaVersion: 1 as const,
        })),
      };
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
  assert.ok(
    runInvariantErrors({
      ...run(),
      activeModifyingUnitIds: ["missing-unit"],
    }).some((error) => error.includes("unknown")),
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
      idempotencyKey: deriveIdempotencyKey(
        run(),
        0,
        null,
        "controller_release",
      ),
      paramsHash: HASH,
    }).ok,
    false,
  );
});

test("repair is disposition-bound and bounded before any sixteenth retry emits", () => {
  const limited = run([
    {
      ...unit("unit-1", "repair_required"),
      candidateHead: OID_B,
      candidateTree: OID_C,
      repairCount: 16,
      repairContext: {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        responseHash: HASH,
        rationale: "blocking review",
        findings: [{ id: "finding-1", severity: "blocking", detail: "fix it" }],
      },
    },
  ]);
  const result = reduce(
    limited,
    event(limited, "repair_intent", {
      idempotencyKey: "repair-17",
      paramsHash: HASH,
      judgment: {
        schemaVersion: 1,
        role: "controller",
        kind: "repair_disposition",
        unitId: "unit-1",
        sessionId: "incarnation-1",
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        aggregateRevision: 0,
        promptHash: HASH,
        responseHash: HASH,
        rationale: "repair",
        factOid: OID_B,
        decision: "repair",
      },
    }),
  );
  assert.equal(result.ok, false);
});

test("repair disposition binds the immutable controller incarnation, model, and prompt", () => {
  const repairable = run([
    {
      ...unit("unit-1", "repair_required"),
      candidateHead: OID_B,
      candidateTree: OID_C,
      repairContext: {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        responseHash: HASH,
        rationale: "blocking review",
        findings: [{ id: "finding-1", severity: "blocking", detail: "fix it" }],
      },
    },
  ]);
  const result = reduce(
    repairable,
    event(repairable, "repair_intent", {
      idempotencyKey: "repair-1",
      paramsHash: HASH,
      judgment: {
        schemaVersion: 1,
        role: "controller",
        kind: "repair_disposition",
        unitId: "unit-1",
        sessionId: "wrong-incarnation",
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        aggregateRevision: 0,
        promptHash: HASH,
        responseHash: HASH,
        rationale: "repair",
        factOid: OID_B,
        decision: "repair",
      },
    }),
  );
  assert.equal(result.ok, false);
});

test("journal checkpoint compacts completed entries while retained idempotency evidence rejects replay", () => {
  const completed = Array.from({ length: 256 }, (_, index) => ({
    effectId: `effect-${index}`,
    unitId: "unit-1",
    idempotencyKey: `key-${index}`,
    kind: "candidate_collect" as const,
    paramsHash: HASH,
    status: "observed" as const,
    observationHash: HASH,
    schemaVersion: 1 as const,
  }));
  const initial = {
    ...run(),
    effectJournal: completed,
    processedIdempotencyKeys: completed.map((entry) => entry.idempotencyKey),
  };
  const next = reduce(
    initial,
    event(initial, "reservation_intent", {
      idempotencyKey: "reserve-after-checkpoint",
      paramsHash: HASH,
      reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
    }),
  );
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.nextState.journalCheckpoint.compactedEffects, 256);
  assert.equal(
    reduce(
      next.nextState,
      event(next.nextState, "reservation_intent", {
        idempotencyKey: "key-1",
        paramsHash: HASH,
        reservations: [{ id: "res-2", namespace: "port", resource: "3002" }],
      }),
    ).ok,
    false,
  );
});

test("event and idempotency history checkpoints stay bounded past 512 events while old replay is stale", () => {
  const history = Array.from(
    { length: 256 },
    (_, index) => `old-event-${index}`,
  );
  const keys = Array.from({ length: 256 }, (_, index) => `old-key-${index}`);
  const checkpointed = {
    ...run(),
    revision: 512,
    processedEventIds: history,
    processedIdempotencyKeys: keys,
  };
  const next = reduce(
    checkpointed,
    event(checkpointed, "reservation_intent", {
      idempotencyKey: "new-key",
      paramsHash: HASH,
      reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
    }),
  );
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.nextState.processedEventIds.length, 256);
  assert.equal(next.nextState.processedIdempotencyKeys.length, 256);
  assert.equal(next.nextState.journalCheckpoint.compactedEvents, 1);
  assert.equal(next.nextState.journalCheckpoint.compactedIdempotencyKeys, 1);
  assert.equal(
    reduce(next.nextState, {
      eventId: "old-event-0",
      expectedRevision: 512,
      unitId: "unit-1",
      type: "reservation_intent",
      idempotencyKey: "old-key-0",
      paramsHash: HASH,
      reservations: [{ id: "res-2", namespace: "port", resource: "3002" }],
    }).ok,
    false,
  );
});

test("an evicted effect key cannot be replayed for another unit at the current revision", () => {
  const replay = {
    ...run([
      {
        ...unit("unit-1", "repair_required"),
        candidateHead: OID_B,
        candidateTree: OID_C,
        repairCount: 1,
        repairContext: {
          baseOid: OID_A,
          headOid: OID_B,
          treeOid: OID_C,
          responseHash: HASH,
          rationale: "prior repair",
          findings: [
            { id: "finding-1", severity: "blocking", detail: "repair" },
          ],
        },
      },
    ]),
    revision: 600,
    processedEventIds: Array.from(
      { length: 256 },
      (_, index) => `event-${index + 344}`,
    ),
    processedIdempotencyKeys: Array.from(
      { length: 256 },
      (_, index) => `key-${index + 344}`,
    ),
    journalCheckpoint: {
      revision: 600,
      compactedEffects: 256,
      compactedEvents: 344,
      compactedIdempotencyKeys: 344,
    },
  };
  assert.equal(
    reduce(replay, {
      eventId: "event-new-unit",
      expectedRevision: 600,
      unitId: "unit-1",
      type: "repair_intent",
      // This key was emitted at revision 344, then checkpointed. It cannot
      // be used by any current-revision effect, even on a different unit.
      idempotencyKey: deriveIdempotencyKey(replay, 344, "unit-2", "repair"),
      paramsHash: HASH,
      judgment: {
        schemaVersion: 1,
        role: "controller",
        kind: "repair_disposition",
        unitId: "unit-1",
        sessionId: "incarnation-1",
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        aggregateRevision: 600,
        promptHash: HASH,
        responseHash: HASH,
        rationale: "replay",
        factOid: OID_B,
        decision: "repair",
      },
    }).ok,
    false,
  );
});

test("intent idempotency digest rejects domain, revision, unit, and kind substitutions", () => {
  const state = run();
  const substitutions = [
    deriveIdempotencyKey(
      { controller: { ...state.controller, runId: "other-run" } },
      0,
      "unit-1",
      "reservation_acquire",
    ),
    deriveIdempotencyKey(state, 1, "unit-1", "reservation_acquire"),
    deriveIdempotencyKey(state, 0, "unit-2", "reservation_acquire"),
    deriveIdempotencyKey(state, 0, "unit-1", "branch_create"),
  ];
  for (const [index, idempotencyKey] of substitutions.entries()) {
    const result = reduce(state, {
      eventId: `substitution-${index}`,
      expectedRevision: 0,
      unitId: "unit-1",
      type: "reservation_intent",
      idempotencyKey,
      paramsHash: HASH,
      reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_event");
  }
});

test("64 units each complete the 16-repair bounded trace without history or envelope exhaustion", () => {
  let state = run(
    Array.from({ length: LIMITS.units }, (_, index) => ({
      ...unit(`unit-${index + 1}`, "repair_required"),
      candidateHead: OID_B,
      candidateTree: OID_C,
      repairContext: {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        responseHash: HASH,
        rationale: "initial blocking finding",
        findings: [
          { id: "finding-1", severity: "blocking" as const, detail: "fix" },
        ],
      },
    })),
  );

  for (const unitId of Object.keys(state.units).sort()) {
    for (let attempt = 1; attempt <= 16; attempt += 1) {
      state = stepUnit(state, unitId, "repair_intent", {
        paramsHash: HASH,
        judgment: {
          schemaVersion: 1,
          role: "controller",
          kind: "repair_disposition",
          unitId,
          sessionId: "incarnation-1",
          requestedModel: "frontier",
          returnedModel: "frontier-1",
          aggregateRevision: state.revision,
          promptHash: HASH,
          responseHash: HASH,
          rationale: `repair ${attempt}`,
          factOid: OID_B,
          decision: "repair",
        },
      });
      state = observeUnit(state, unitId, "repair_observed", "repair", {
        sessionId: `worker-${unitId}-${attempt}`,
        requestedModel: "workhorse",
        returnedModel: "workhorse-1",
        promptHash: HASH,
      });
      state = stepUnit(state, unitId, "collect_intent", { paramsHash: HASH });
      state = observeUnit(state, unitId, "worker_collected", "worker_collect", {
        workerResult: {
          status: "completed",
          summary: "done",
          residualRisks: [],
        },
      });
      state = stepUnit(state, unitId, "candidate_intent", {
        paramsHash: HASH,
      });
      state = observeUnit(
        state,
        unitId,
        "candidate_observed",
        "candidate_collect",
        {
          headOid: OID_B,
          treeOid: OID_C,
        },
      );
      state = stepUnit(state, unitId, "verification_intent", {
        paramsHash: HASH,
      });
      state = observeUnit(state, unitId, "verification_observed", "verify", {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
      });
      state = stepUnit(state, unitId, "reviewer_dispatch_intent", {
        paramsHash: HASH,
      });
      state = observeUnit(
        state,
        unitId,
        "reviewer_observed",
        "review_dispatch",
        {
          sessionId: `reviewer-${unitId}-${attempt}`,
          requestedModel: "frontier",
          returnedModel: "frontier-1",
          promptHash: HASH,
        },
      );
      state = stepUnit(state, unitId, "review_collect_intent", {
        paramsHash: HASH,
      });
      state = observeUnit(state, unitId, "review_collected", "review_collect", {
        judgment: {
          schemaVersion: 1,
          role: "reviewer",
          kind: "review_verdict",
          unitId,
          sessionId: `reviewer-${unitId}-${attempt}`,
          requestedModel: "frontier",
          returnedModel: "frontier-1",
          aggregateRevision: state.revision,
          promptHash: HASH,
          responseHash: HASH,
          rationale: `changes ${attempt}`,
          baseOid: OID_A,
          headOid: OID_B,
          treeOid: OID_C,
          decision: "request_changes",
          findings: [{ id: "finding-1", severity: "blocking", detail: "fix" }],
        },
      });
    }
    assert.equal(state.units[unitId]?.repairCount, 16);
    assert.equal(
      reduce(
        state,
        event(
          state,
          "repair_intent",
          {
            paramsHash: HASH,
            judgment: {
              schemaVersion: 1,
              role: "controller",
              kind: "repair_disposition",
              unitId,
              sessionId: "incarnation-1",
              requestedModel: "frontier",
              returnedModel: "frontier-1",
              aggregateRevision: state.revision,
              promptHash: HASH,
              responseHash: HASH,
              rationale: "seventeenth repair",
              factOid: OID_B,
              decision: "repair",
            },
          },
          unitId,
        ),
      ).ok,
      false,
    );
    state = stepUnit(state, unitId, "park_intent", { paramsHash: HASH });
    state = observeUnit(state, unitId, "park_observed", "park");
    state = stepUnit(state, unitId, "reservation_release_intent", {
      paramsHash: HASH,
    });
    state = observeUnit(
      state,
      unitId,
      "reservation_released",
      "reservation_release",
    );
  }

  const envelope = {
    schema: "sce.repository-run" as const,
    version: 1 as const,
    payload: state,
  };
  assert.equal(validate(RepositoryRunEnvelopeSchema, envelope).ok, true);
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(
    Object.values(state.units).every((item) => item.state === "closed"),
    true,
  );
  assert.ok(state.journalCheckpoint.compactedEffects > 0);
  assert.ok(state.journalCheckpoint.compactedEvents > 0);
  assert.ok(state.journalCheckpoint.compactedIdempotencyKeys > 0);
  const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  assert.ok(
    envelopeBytes <= LIMITS.envelopeBytes,
    `envelope is ${envelopeBytes} bytes; limit is ${LIMITS.envelopeBytes}`,
  );
});

test("hydration rejects fabricated reservation lineage and active parking remains slot-consistent", () => {
  const fabricated = {
    ...run([
      { ...unit("unit-1", "resources_reserved"), reservationIds: ["res-1"] },
    ]),
    reservations: {
      "res-1": {
        id: "res-1",
        unitId: "unit-1",
        namespace: "port",
        resource: "3001",
        state: "reserved" as const,
        acquireEffectId: "invented",
      },
    },
  };
  assert.ok(
    runInvariantErrors(fabricated).some((error) =>
      error.includes("exact acquisition"),
    ),
  );
  const parked = {
    ...run([{ ...unit("unit-1", "park_intent"), reservationIds: [] }]),
    activeModifyingUnitIds: ["unit-1"],
  };
  assert.deepEqual(runInvariantErrors(parked), []);
});

test("terminal intents start only from stable observed lifecycle states", () => {
  const allowed: readonly UnitState[] = [
    "planned",
    "resources_reserved",
    "branch_observed",
    "worktree_observed",
    "dispatched",
    "collected",
    "candidate_committed",
    "qualified",
    "reviewer_dispatched",
    "approved",
    "published",
    "repair_required",
  ];
  const forbidden: readonly UnitState[] = [
    "reservation_intent",
    "branch_intent",
    "worktree_intent",
    "dispatch_intent",
    "collect_intent",
    "candidate_intent",
    "verification_intent",
    "reviewer_dispatch_intent",
    "review_collect_intent",
    "publish_intent",
    "integrate_intent",
    "landed",
    "reservation_release_intent",
    "repair_intent",
    "failure_intent",
    "failed",
    "timeout_intent",
    "timed_out",
    "park_intent",
    "parked",
    "cancel_intent",
    "cancelled",
    "blocked",
    "closed",
  ];

  assert.equal(new Set([...allowed, ...forbidden]).size, 36);
  for (const state of allowed)
    assert.equal(canEnterTerminalIntent(state), true);
  for (const state of forbidden)
    assert.equal(canEnterTerminalIntent(state), false);

  const reserving = step(run(), "reservation_intent", {
    paramsHash: HASH,
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  const stackedCancellation = reduce(
    reserving,
    event(reserving, "cancel_intent", { paramsHash: HASH }),
  );
  assert.equal(stackedCancellation.ok, false);
  if (!stackedCancellation.ok)
    assert.equal(stackedCancellation.code, "illegal_transition");

  const failing = step(run(), "failure_intent", { paramsHash: HASH });
  const stackedTimeout = reduce(
    failing,
    event(failing, "timeout_intent", { paramsHash: HASH }),
  );
  assert.equal(stackedTimeout.ok, false);
  if (!stackedTimeout.ok)
    assert.equal(stackedTimeout.code, "illegal_transition");
});
