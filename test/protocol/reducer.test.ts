import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  deriveIdempotencyKey,
  deriveParamsHash,
  deriveSessionFilterHash,
  hasUsedSession,
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
  ProtocolEventSchema,
  RepositoryRunEnvelopeSchema,
  validate,
} from "../../src/protocol/schemas.js";
import {
  HASH,
  OID_A,
  OID_B,
  OID_C,
  event,
  repairEvidence,
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
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  state = observe(state, "reservation_observed", "reservation_acquire");
  state = step(state, "branch_intent", {
    idempotencyKey: "branch-1",
    branchRef: "sce/unit-1",
  });
  state = observe(state, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  state = step(state, "worktree_intent", {
    idempotencyKey: "worktree-1",
    worktreePath: "/tmp/unit-1",
  });
  state = observe(state, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  state = step(state, "dispatch_intent", {
    idempotencyKey: "dispatch-1",
  });
  state = observe(state, "dispatch_observed", "dispatch", {
    sessionId: "worker-1",
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  state = step(state, "collect_intent", {
    idempotencyKey: "collect-1",
  });
  state = observe(state, "worker_collected", "worker_collect", {
    workerResult: { status: "completed", summary: "done", residualRisks: [] },
  });
  state = step(state, "candidate_intent", {
    idempotencyKey: "candidate-1",
  });
  state = observe(state, "candidate_observed", "candidate_collect", {
    headOid: OID_B,
    treeOid: OID_C,
  });
  return state;
}

function approvedCandidate(
  authorityProfile: RepositoryRun["authorityProfile"] = "integrate",
  integrationProfile: RepositoryRun["integrationProfile"] = "local-ff",
): RepositoryRun {
  let state = {
    ...completeCandidate(),
    authorityProfile,
    integrationProfile,
  };
  state = step(state, "verification_intent", {});
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {});
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-approved",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {});
  return observe(state, "review_collected", "review_collect", {
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "reviewer-approved",
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
}

test("crash-safe happy path journals each effect before observing exact facts", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {
    idempotencyKey: "verify-1",
  });
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {
    idempotencyKey: "reviewer-1",
  });
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {
    idempotencyKey: "review-collect-1",
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
  });
  state = observe(state, "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = step(state, "integrate_intent", {
    idempotencyKey: "integrate-1",
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

test("reducer derives executable parameter hashes and rejects forged intent hashes", () => {
  const state = run();
  const input = event(state, "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  assert.equal(
    validate(ProtocolEventSchema, { ...input, paramsHash: HASH }).ok,
    false,
  );
  const result = reduce(state, input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const effect = result.effects[0];
  assert.ok(effect !== undefined);
  assert.equal(effect.paramsHash, deriveParamsHash(effect.kind, effect.params));
  assert.equal(
    result.nextState.effectJournal.at(-1)?.paramsHash,
    effect.paramsHash,
  );
  const tampered = {
    ...result.nextState,
    effectJournal: result.nextState.effectJournal.map((entry) =>
      entry.effectId === effect.effectId
        ? { ...entry, paramsHash: HASH }
        : entry,
    ),
  };
  assert.ok(
    runInvariantErrors(tampered).some((error) =>
      error.includes("invalid params hash"),
    ),
  );
});

test("observations reject wrong kind, stale revision, duplicate IDs, and moved pairs", () => {
  const initial = run();
  const intent = event(initial, "reservation_intent", {
    idempotencyKey: "reserve-1",
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
      }),
    ).ok,
    true,
  );
});

test("review approval binds role, session, exact model, revision, prompt, and Git facts", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {
    idempotencyKey: "verify-1",
  });
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {
    idempotencyKey: "reviewer-1",
  });
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {
    idempotencyKey: "review-collect-1",
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
            { idempotencyKey: `dispatch-${current.id}` },
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
    }).ok,
    false,
  );
});

test("an ambiguous active terminal effect blocks durably and only its exact observation reconciles", () => {
  let state = run();
  state = step(state, "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  state = observe(state, "reservation_observed", "reservation_acquire");
  state = step(state, "branch_intent", {
    branchRef: "sce/unit-1",
  });
  state = observe(state, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  state = step(state, "worktree_intent", {
    worktreePath: "/tmp/unit-1",
  });
  state = observe(state, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  state = step(state, "dispatch_intent", {});
  state = observe(state, "dispatch_observed", "dispatch", {
    sessionId: "worker-ambiguous",
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  const terminal = reduce(state, event(state, "failure_intent", {}));
  assert.equal(terminal.ok, true);
  if (!terminal.ok) return;
  assert.deepEqual(terminal.effects[0]?.params, {
    role: "worker",
    sessionId: "worker-ambiguous",
  });
  state = terminal.nextState;
  assert.deepEqual(state.activeModifyingUnitIds, ["unit-1"]);
  const failureEffectId = effectId(state, "failure");
  state = step(state, "effect_ambiguous", {
    effectId: failureEffectId,
    effectKind: "failure",
    observationHash: HASH,
  });
  assert.equal(state.state, "blocked");
  assert.equal(state.units["unit-1"]?.state, "blocked");
  assert.deepEqual(state.activeModifyingUnitIds, ["unit-1"]);
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(
    reduce(
      state,
      event(state, "failure_observed", {
        effectId: effectId(state, "timeout"),
        effectKind: "timeout",
        observationHash: HASH,
      }),
    ).ok,
    false,
  );
  state = step(state, "failure_observed", {
    effectId: failureEffectId,
    effectKind: "failure",
    observationHash: HASH,
  });
  assert.equal(state.state, "active");
  assert.equal(state.units["unit-1"]?.state, "failed");
  assert.deepEqual(state.activeModifyingUnitIds, []);
});

test("reviewer terminal intents retain ownership until their exact result", () => {
  let state = completeCandidate();
  state = step(state, "verification_intent", {});
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {});
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-terminal",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  const terminal = reduce(state, event(state, "timeout_intent", {}));
  assert.equal(terminal.ok, true);
  if (!terminal.ok) return;
  assert.deepEqual(terminal.effects[0]?.params, {
    role: "reviewer",
    sessionId: "reviewer-terminal",
  });
  state = terminal.nextState;
  assert.equal(state.currentReviewerUnitId, "unit-1");
  assert.equal(state.qualificationOwnerUnitId, "unit-1");
  state = observe(state, "timeout_observed", "timeout");
  assert.equal(state.currentReviewerUnitId, undefined);
  assert.equal(state.qualificationOwnerUnitId, undefined);
});

test("authority profiles finish honestly at local integration or published handoff", () => {
  let local = approvedCandidate("local-change-only", "local-ff");
  assert.deepEqual(
    local.effectJournal.filter((entry) => entry.kind === "publish"),
    [],
  );
  local = step(local, "integrate_intent", {});
  assert.equal(local.effectJournal.at(-1)?.kind, "integrate");
  local = observe(local, "integrate_observed", "integrate", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
    integrationOid: OID_C,
    controllerFencingToken: "fence-1",
  });
  assert.equal(local.units["unit-1"]?.state, "landed");

  let openPrIntent = approvedCandidate("open-pr", "none");
  openPrIntent = step(openPrIntent, "publish_intent", {});
  assert.equal(
    reduce(
      openPrIntent,
      event(openPrIntent, "publish_observed", {
        effectId: effectId(openPrIntent, "publish"),
        effectKind: "publish",
        observationHash: HASH,
        publication: { kind: "push_branch", remoteHeadOid: OID_B },
      }),
    ).ok,
    false,
  );

  for (const profile of ["push-branch", "open-pr"] as const) {
    let handoff = approvedCandidate(profile, "none");
    handoff = step(handoff, "publish_intent", {});
    handoff = observe(handoff, "publish_observed", "publish", {
      publication:
        profile === "open-pr"
          ? {
              kind: "open_pr",
              pullRequest: {
                providerPrId: "pr-1",
                state: "open",
                baseRef: "main",
                baseOid: OID_A,
                remoteHeadOid: OID_B,
              },
            }
          : { kind: "push_branch", remoteHeadOid: OID_B },
    });
    assert.equal(handoff.units["unit-1"]?.state, "handoff");
    if (profile === "open-pr")
      assert.deepEqual(handoff.units["unit-1"]?.openPullRequest, {
        providerPrId: "pr-1",
        state: "open",
        baseRef: "main",
        baseOid: OID_A,
        remoteHeadOid: OID_B,
      });
    assert.equal(handoff.units["unit-1"]?.landedOid, undefined);
    assert.equal(handoff.integrationQueue.length, 0);
    assert.equal(
      reduce(handoff, event(handoff, "integrate_intent", {})).ok,
      false,
    );
    handoff = step(handoff, "reservation_release_intent", {});
    handoff = observe(handoff, "reservation_released", "reservation_release");
    assert.equal(handoff.units["unit-1"]?.state, "closed");
  }
});

test("worker repair outcomes persist follow-ups and do not advance to candidate success", () => {
  let state = run();
  state = step(state, "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  state = observe(state, "reservation_observed", "reservation_acquire");
  state = step(state, "branch_intent", {
    branchRef: "sce/unit-1",
  });
  state = observe(state, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  state = step(state, "worktree_intent", {
    worktreePath: "/tmp/unit-1",
  });
  state = observe(state, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  state = step(state, "dispatch_intent", {});
  state = observe(state, "dispatch_observed", "dispatch", {
    sessionId: "worker-repair-result",
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  state = step(state, "collect_intent", {});
  const collecting = state;
  state = observe(state, "worker_collected", "worker_collect", {
    workerResult: {
      status: "needs_repair",
      summary: "test failure needs repair",
      residualRisks: ["fixture remains stale"],
      suggestedFollowUps: ["split fixture cleanup into a separate Bead"],
    },
  });
  assert.equal(state.units["unit-1"]?.state, "repair_required");
  assert.deepEqual(state.units["unit-1"]?.workerResult?.suggestedFollowUps, [
    "split fixture cleanup into a separate Bead",
  ]);
  assert.equal(state.qualificationQueue.length, 0);
  const failed = observe(collecting, "worker_collected", "worker_collect", {
    workerResult: {
      status: "failed",
      summary: "worker process exited without a candidate",
      residualRisks: ["candidate state is unknown"],
      suggestedFollowUps: ["inspect the preserved worktree"],
    },
  });
  assert.equal(failed.units["unit-1"]?.state, "failed");
  assert.equal(failed.units["unit-1"]?.workerResult?.status, "failed");
  assert.equal(
    failed.units["unit-1"]?.repairContext?.rationale,
    "worker process exited without a candidate",
  );
  assert.deepEqual(failed.activeModifyingUnitIds, []);
  assert.deepEqual(runInvariantErrors(failed), []);
  state = step(state, "repair_intent", {
    judgment: {
      schemaVersion: 1,
      role: "controller",
      kind: "repair_disposition",
      unitId: "unit-1",
      sessionId: "incarnation-1",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "repair the returned failure",
      factOid: OID_A,
      decision: "repair",
      ...repairEvidence(state),
    },
  });
  assert.equal(hasUsedSession(state, "worker-repair-result"), true);
  assert.equal(hasUsedSession(state, "never-dispatched-session"), false);
  assert.equal(
    reduce(
      state,
      event(state, "repair_observed", {
        effectId: effectId(state, "repair"),
        effectKind: "repair",
        observationHash: HASH,
        sessionId: "worker-repair-result",
        requestedModel: "workhorse",
        returnedModel: "workhorse-1",
        promptHash: HASH,
      }),
    ).ok,
    false,
  );
});

test("repair is disposition-bound and bounded before any sixteenth retry emits", () => {
  const limited = run([
    {
      ...unit("unit-1", "repair_required"),
      branchRef: "sce/unit-1",
      worktreePath: "/tmp/unit-1",
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
      requestedModel: "workhorse",
      promptHash: HASH,
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
        ...repairEvidence(limited),
      },
    }),
  );
  assert.equal(result.ok, false);
});

test("repair disposition binds the controller incarnation, model, and current evidence", () => {
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
        ...repairEvidence(repairable),
      },
    }),
  );
  assert.equal(result.ok, false);
});

test("repair disposition binds current context without reusing the initial prompt", () => {
  const repairable = run([
    {
      ...unit("unit-1", "repair_required"),
      branchRef: "sce/unit-1",
      worktreePath: "/tmp/unit-1",
      candidateHead: OID_B,
      candidateTree: OID_C,
      repairContext: {
        baseOid: OID_A,
        headOid: OID_B,
        treeOid: OID_C,
        responseHash: HASH,
        rationale: "fresh review evidence",
        findings: [{ id: "finding-1", severity: "blocking", detail: "fix it" }],
      },
    },
  ]);
  const judgment = {
    schemaVersion: 1,
    role: "controller" as const,
    kind: "repair_disposition" as const,
    unitId: "unit-1",
    sessionId: "incarnation-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    aggregateRevision: repairable.revision,
    // A repair packet has its own prompt; it is deliberately not compared to
    // the immutable controller-acquisition prompt.
    promptHash: "e".repeat(64),
    responseHash: HASH,
    rationale: "repair current evidence",
    factOid: OID_B,
    decision: "repair" as const,
    ...repairEvidence(repairable),
  };
  assert.equal(
    reduce(repairable, event(repairable, "repair_intent", { judgment })).ok,
    true,
  );
  assert.equal(
    reduce(
      repairable,
      event(repairable, "repair_intent", {
        judgment: { ...judgment, currentEvidenceHash: "f".repeat(64) },
      }),
    ).ok,
    false,
  );
  assert.equal(
    reduce(
      repairable,
      event(repairable, "repair_intent", {
        judgment: { ...judgment, findingsContextHash: "f".repeat(64) },
      }),
    ).ok,
    false,
  );
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
      requestedModel: "workhorse",
      promptHash: HASH,
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
        ...repairEvidence(replay),
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
      reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_event");
  }
});

test("64 retained units complete 16 repairs in waves of at most three within the envelope", () => {
  let state = run(
    Array.from({ length: LIMITS.units }, (_, index) => ({
      ...unit(`unit-${index + 1}`, "repair_required"),
      branchRef: `sce/unit-${index + 1}`,
      worktreePath: `/tmp/unit-${index + 1}`,
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

  const unitIds = Object.keys(state.units).sort();
  for (let waveStart = 0; waveStart < unitIds.length; waveStart += 3) {
    const currentWave = unitIds.slice(waveStart, waveStart + 3);
    if (waveStart > 0) {
      assert.equal(
        unitIds
          .slice(waveStart - 3, waveStart)
          .every((unitId) => state.units[unitId]?.state === "closed"),
        true,
      );
      // Phase 1 deliberately has no wave-planning command. This is the
      // controller-authored snapshot that Phase 3 will persist through its
      // planning act, after the prior wave has drained and closed.
      state = {
        ...state,
        wave: { id: `wave-${waveStart / 3 + 1}`, unitIds: currentWave },
      };
      assert.deepEqual(runInvariantErrors(state), []);
    }
    for (const unitId of currentWave) {
      for (let attempt = 1; attempt <= 16; attempt += 1) {
        state = stepUnit(state, unitId, "repair_intent", {
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
            ...repairEvidence(state, unitId),
          },
        });
        state = observeUnit(state, unitId, "repair_observed", "repair", {
          sessionId: `worker-${unitId}-${attempt}`,
          requestedModel: "workhorse",
          returnedModel: "workhorse-1",
          promptHash: HASH,
        });
        state = stepUnit(state, unitId, "collect_intent", {});
        state = observeUnit(
          state,
          unitId,
          "worker_collected",
          "worker_collect",
          {
            workerResult: {
              status: "completed",
              summary: "done",
              residualRisks: [],
            },
          },
        );
        state = stepUnit(state, unitId, "candidate_intent", {});
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
        state = stepUnit(state, unitId, "verification_intent", {});
        state = observeUnit(state, unitId, "verification_observed", "verify", {
          baseOid: OID_A,
          headOid: OID_B,
          treeOid: OID_C,
        });
        state = stepUnit(state, unitId, "reviewer_dispatch_intent", {});
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
        state = stepUnit(state, unitId, "review_collect_intent", {});
        state = observeUnit(
          state,
          unitId,
          "review_collected",
          "review_collect",
          {
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
              findings: [
                { id: "finding-1", severity: "blocking", detail: "fix" },
              ],
            },
          },
        );
      }
      assert.equal(state.units[unitId]?.repairCount, 16);
      assert.equal(
        reduce(
          state,
          event(
            state,
            "repair_intent",
            {
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
                ...repairEvidence(state, unitId),
              },
            },
            unitId,
          ),
        ).ok,
        false,
      );
      state = stepUnit(state, unitId, "park_intent", {});
      state = observeUnit(state, unitId, "park_observed", "park");
      state = stepUnit(state, unitId, "reservation_release_intent", {});
      state = observeUnit(
        state,
        unitId,
        "reservation_released",
        "reservation_release",
      );
    }
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
  assert.equal(state.usedSessionCount, LIMITS.units * 16 * 2);
  assert.equal(
    Buffer.from(state.usedSessionFilter, "base64").length,
    LIMITS.sessionFilterBytes,
  );
  for (const unitId of unitIds)
    for (let attempt = 1; attempt <= 16; attempt += 1) {
      assert.equal(hasUsedSession(state, `worker-${unitId}-${attempt}`), true);
      assert.equal(
        hasUsedSession(state, `reviewer-${unitId}-${attempt}`),
        true,
      );
    }
  assert.equal(hasUsedSession(state, "fresh-after-bounded-trace"), false);
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
  assert.ok(
    runInvariantErrors(parked).some((error) =>
      error.includes("one exact unresolved effect"),
    ),
  );
  const corruptSessionFilter = {
    ...run(),
    usedSessionCount: 1,
    usedSessionFilter: "AA==",
  };
  assert.ok(
    runInvariantErrors(corruptSessionFilter).some((error) =>
      error.includes("used session identity history"),
    ),
  );
  const zeroSessionBitmap = Buffer.alloc(LIMITS.sessionFilterBytes).toString(
    "base64",
  );
  const countWithoutBits = {
    ...run(),
    usedSessionCount: 1,
    usedSessionFilter: zeroSessionBitmap,
    usedSessionFilterHash: deriveSessionFilterHash(zeroSessionBitmap, 1),
  };
  assert.ok(
    runInvariantErrors(countWithoutBits).some((error) =>
      error.includes("no set bits"),
    ),
  );
});

test("hydration preserves owner converses and only keeps unresolved effects in the wave", () => {
  let reviewer = completeCandidate();
  reviewer = step(reviewer, "verification_intent", {});
  reviewer = observe(reviewer, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  reviewer = step(reviewer, "reviewer_dispatch_intent", {});
  const missingReviewer = { ...reviewer };
  delete missingReviewer.currentReviewerUnitId;
  assert.ok(
    runInvariantErrors(missingReviewer).some((error) =>
      error.includes("current reviewer converse"),
    ),
  );

  const integrating = step(
    approvedCandidate("local-change-only", "local-ff"),
    "integrate_intent",
    {},
  );
  const missingIntegrationOwner = { ...integrating };
  delete missingIntegrationOwner.integrationOwnerUnitId;
  assert.ok(
    runInvariantErrors(missingIntegrationOwner).some((error) =>
      error.includes("integration owner converse"),
    ),
  );

  const intended = step(run(), "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  const unresolvedOutsideWave = {
    ...intended,
    wave: { ...intended.wave, unitIds: [] },
  };
  assert.ok(
    runInvariantErrors(unresolvedOutsideWave).some((error) =>
      error.includes("outside the current wave"),
    ),
  );
});

test("worker and reviewer sessions cannot alias controller or another role", () => {
  let worker = run();
  worker = step(worker, "reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  worker = observe(worker, "reservation_observed", "reservation_acquire");
  worker = step(worker, "branch_intent", { branchRef: "sce/unit-1" });
  worker = observe(worker, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  worker = step(worker, "worktree_intent", { worktreePath: "/tmp/unit-1" });
  worker = observe(worker, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  worker = step(worker, "dispatch_intent", {});
  assert.equal(
    reduce(
      worker,
      event(worker, "dispatch_observed", {
        effectId: effectId(worker, "dispatch"),
        effectKind: "dispatch",
        observationHash: HASH,
        sessionId: "incarnation-1",
        requestedModel: "workhorse",
        returnedModel: "workhorse-1",
        promptHash: HASH,
      }),
    ).ok,
    false,
  );

  let reviewer = completeCandidate();
  reviewer = step(reviewer, "verification_intent", {});
  reviewer = observe(reviewer, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  reviewer = step(reviewer, "reviewer_dispatch_intent", {});
  assert.equal(
    reduce(
      reviewer,
      event(reviewer, "reviewer_observed", {
        effectId: effectId(reviewer, "review_dispatch"),
        effectKind: "review_dispatch",
        observationHash: HASH,
        sessionId: "worker-1",
        requestedModel: "frontier",
        returnedModel: "frontier-1",
        promptHash: HASH,
      }),
    ).ok,
    false,
  );
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
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  const stackedCancellation = reduce(
    reserving,
    event(reserving, "cancel_intent", {}),
  );
  assert.equal(stackedCancellation.ok, false);
  if (!stackedCancellation.ok)
    assert.equal(stackedCancellation.code, "illegal_transition");

  const failing = step(run(), "failure_intent", {});
  const stackedTimeout = reduce(failing, event(failing, "timeout_intent", {}));
  assert.equal(stackedTimeout.ok, false);
  if (!stackedTimeout.ok)
    assert.equal(stackedTimeout.code, "illegal_transition");
});
