import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import fc from "fast-check";
import { legalActions } from "../../src/protocol/actions.js";
import {
  deriveIdempotencyKey,
  deriveParamsHash,
  deriveSessionFingerprint,
  hasUsedSession,
  reduce,
  runInvariantErrors,
  sessionFingerprintCount,
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
  RepositoryRunSchema,
  RepositoryRunEnvelopeSchema,
  validate,
} from "../../src/protocol/schemas.js";
import { canonicalJson } from "../../src/protocol/canonical.js";
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
  integrationProfile: RepositoryRun["integrationProfile"] = "remote-ff",
  completionBoundary: RepositoryRun["completionBoundary"] = integrationProfile ===
  "local-ff"
    ? "local-integration"
    : integrationProfile === "none"
      ? authorityProfile === "open-pr"
        ? "pr-handoff"
        : "branch-handoff"
      : "remote-integration",
): RepositoryRun {
  let state = {
    ...completeCandidate(),
    authorityProfile,
    completionBoundary,
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

function sessionLedger(...sessionIds: readonly string[]): string {
  return Buffer.concat(
    sessionIds
      .map((sessionId) =>
        Buffer.from(deriveSessionFingerprint(sessionId), "hex"),
      )
      .sort(Buffer.compare),
  ).toString("base64");
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

test("verification observations preserve the original base binding", () => {
  let state = completeCandidate();
  const originalBaseOid = state.units["unit-1"]?.baseOid;
  state = step(state, "verification_intent", {});
  const verificationEffect = state.effectJournal.at(-1);
  assert.deepEqual(verificationEffect?.kind, "verify");
  assert.deepEqual(
    reduce(
      state,
      event(state, "verification_observed", {
        effectId: effectId(state, "verify"),
        effectKind: "verify",
        observationHash: HASH,
        baseOid: OID_C,
        headOid: OID_B,
        treeOid: OID_C,
      }),
    ).ok,
    false,
  );
  assert.equal(state.units["unit-1"]?.baseOid, originalBaseOid);

  const exact = reduce(
    state,
    event(state, "verification_observed", {
      effectId: effectId(state, "verify"),
      effectKind: "verify",
      observationHash: HASH,
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
    }),
  );
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  assert.equal(exact.nextState.units["unit-1"]?.baseOid, originalBaseOid);
  assert.equal(
    exact.nextState.units["unit-1"]?.verificationBaseOid,
    originalBaseOid,
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

test("hydrated multi-unit ambiguity converges through exact observations", () => {
  const unitIds = ["unit-1", "unit-2", "unit-3"] as const;
  let state = run(unitIds.map((id) => unit(id)));
  const effectIds = new Map<string, string>();
  for (const [index, unitId] of unitIds.entries()) {
    state = stepUnit(state, unitId, "reservation_intent", {
      reservations: [
        {
          id: `res-${index + 1}`,
          namespace: "port",
          resource: `${3001 + index}`,
        },
      ],
    });
    effectIds.set(
      unitId,
      state.effectJournal.at(-1)?.effectId ?? "missing-effect-id",
    );
  }
  state = {
    ...state,
    state: "blocked",
    units: {
      ...state.units,
      "unit-1": { ...state.units["unit-1"]!, state: "blocked" },
      "unit-2": { ...state.units["unit-2"]!, state: "blocked" },
    },
    effectJournal: state.effectJournal.map((entry) =>
      entry.unitId === "unit-1" || entry.unitId === "unit-2"
        ? { ...entry, status: "ambiguous" as const, observationHash: HASH }
        : entry,
    ),
  };
  assert.deepEqual(runInvariantErrors(state), []);

  const observeReservation = (unitId: (typeof unitIds)[number]) => {
    state = stepUnit(state, unitId, "reservation_observed", {
      effectId: effectIds.get(unitId),
      effectKind: "reservation_acquire",
      observationHash: HASH,
    });
  };
  // An already-intended sibling may report before either ambiguous effect,
  // then each recovery is applied independently without hiding the other.
  observeReservation("unit-3");
  assert.equal(state.state, "blocked");
  observeReservation("unit-2");
  assert.equal(state.state, "blocked");
  observeReservation("unit-1");
  assert.equal(state.state, "active");
  assert.equal(
    state.effectJournal.every((entry) => entry.status === "observed"),
    true,
  );
  assert.deepEqual(runInvariantErrors(state), []);
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

test("completion boundaries are monotone under broader authority grants", () => {
  const localProfiles: readonly RepositoryRun["authorityProfile"][] = [
    "local-change-only",
    "push-branch",
    "open-pr",
    "integrate",
  ];
  for (const authorityProfile of localProfiles) {
    const state = approvedCandidate(
      authorityProfile,
      "local-ff",
      "local-integration",
    );
    assert.equal(
      legalActions(state).some((action) => action.type === "integrate_intent"),
      true,
    );
  }

  const branchProfiles: readonly RepositoryRun["authorityProfile"][] = [
    "push-branch",
    "open-pr",
    "integrate",
  ];
  for (const authorityProfile of branchProfiles) {
    let state = approvedCandidate(authorityProfile, "none", "branch-handoff");
    assert.equal(
      legalActions(state).some((action) => action.type === "publish_intent"),
      true,
    );
    state = step(state, "publish_intent", {});
    state = observe(state, "publish_observed", "publish", {
      publication: { kind: "push_branch", remoteHeadOid: OID_B },
    });
    assert.equal(state.units["unit-1"]?.state, "handoff");
    assert.equal(
      legalActions(state).some((action) => action.type === "integrate_intent"),
      false,
    );
  }

  for (const authorityProfile of ["open-pr", "integrate"] as const) {
    let state = approvedCandidate(authorityProfile, "none", "pr-handoff");
    assert.equal(
      legalActions(state).some((action) => action.type === "publish_intent"),
      true,
    );
    state = step(state, "publish_intent", {});
    state = observe(state, "publish_observed", "publish", {
      publication: {
        kind: "open_pr",
        pullRequest: {
          providerPrId: "pr-1",
          state: "open",
          baseRef: "main",
          baseOid: OID_A,
          remoteHeadOid: OID_B,
        },
      },
    });
    assert.equal(state.units["unit-1"]?.state, "handoff");
  }

  for (const integrationProfile of [
    "remote-ff",
    "github-merge-group",
  ] as const) {
    let state = approvedCandidate(
      "integrate",
      integrationProfile,
      "remote-integration",
    );
    assert.equal(
      legalActions(state).some((action) => action.type === "publish_intent"),
      true,
    );
    state = step(state, "publish_intent", {});
    state = observe(state, "publish_observed", "publish", {
      publication: { kind: "push_branch", remoteHeadOid: OID_B },
    });
    assert.equal(
      legalActions(state).some((action) => action.type === "integrate_intent"),
      true,
    );
  }

  for (const invalid of [
    {
      authorityProfile: "local-change-only",
      completionBoundary: "branch-handoff",
      integrationProfile: "none",
    },
    {
      authorityProfile: "push-branch",
      completionBoundary: "pr-handoff",
      integrationProfile: "none",
    },
    {
      authorityProfile: "integrate",
      completionBoundary: "remote-integration",
      integrationProfile: "none",
    },
    {
      authorityProfile: "open-pr",
      completionBoundary: "remote-integration",
      integrationProfile: "remote-ff",
    },
  ] as const) {
    const state = { ...run(), ...invalid };
    assert.ok(runInvariantErrors(state).length > 0);
    assert.deepEqual(legalActions(state), []);
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

  // This is the real overwrite path: the old worker session leaves the live
  // unit when a repair worker takes over, but must remain retained exactly.
  state = observe(state, "repair_observed", "repair", {
    sessionId: "worker-repair-current",
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    promptHash: HASH,
  });
  assert.equal(state.units["unit-1"]?.workerSessionId, "worker-repair-current");
  assert.equal(state.usedSessionCount, 2);
  assert.ok(
    runInvariantErrors({
      ...state,
      usedSessionFingerprints: sessionLedger("worker-repair-current"),
    }).some((error) => error.includes("used session fingerprint count")),
  );

  state = step(state, "collect_intent", {});
  state = observe(state, "worker_collected", "worker_collect", {
    workerResult: {
      status: "completed",
      summary: "repaired",
      residualRisks: [],
    },
  });
  state = step(state, "candidate_intent", {});
  state = observe(state, "candidate_observed", "candidate_collect", {
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "verification_intent", {});
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  state = step(state, "reviewer_dispatch_intent", {});
  state = observe(state, "reviewer_observed", "review_dispatch", {
    sessionId: "reviewer-after-repair",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    promptHash: HASH,
  });
  state = step(state, "review_collect_intent", {});
  state = observe(state, "review_collected", "review_collect", {
    judgment: {
      schemaVersion: 1,
      role: "reviewer",
      kind: "review_verdict",
      unitId: "unit-1",
      sessionId: "reviewer-after-repair",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      aggregateRevision: state.revision,
      promptHash: HASH,
      responseHash: HASH,
      rationale: "one more repair",
      baseOid: OID_A,
      headOid: OID_B,
      treeOid: OID_C,
      decision: "request_changes",
      findings: [{ id: "finding-1", severity: "blocking", detail: "fix" }],
    },
  });
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
      rationale: "repair again",
      factOid: OID_B,
      decision: "repair",
      ...repairEvidence(state),
    },
  });
  assert.equal(state.units["unit-1"]?.workerSessionId, "worker-repair-current");
  assert.equal(state.usedSessionCount, 3);
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
  assert.equal(
    sessionFingerprintCount(state.usedSessionFingerprints),
    LIMITS.units * 16 * 2,
  );
  assert.equal(state.usedSessionCount, LIMITS.units * 16 * 2);
  assert.equal(
    Buffer.from(state.usedSessionFingerprints, "base64").length,
    LIMITS.units * 16 * 2 * LIMITS.sessionFingerprintBytes,
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
  const corruptSessionFingerprints = {
    ...run(),
    usedSessionFingerprints: "AA==",
  };
  assert.ok(
    runInvariantErrors(corruptSessionFingerprints).some((error) =>
      error.includes("used session fingerprint ledger"),
    ),
  );
  const nonCanonicalSessionFingerprints = {
    ...run(),
    usedSessionFingerprints: "AAAA",
  };
  assert.ok(
    runInvariantErrors(nonCanonicalSessionFingerprints).some((error) =>
      error.includes("used session fingerprint ledger"),
    ),
  );
});

test("session fingerprint ledgers retain exact history and reject forged Bloom-era state", () => {
  const sessions = ["worker-old", "worker-new", "reviewer-old"] as const;
  const state = {
    ...run(),
    usedSessionCount: sessions.length,
    usedSessionFingerprints: sessionLedger(...sessions),
  };
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(
    sessionFingerprintCount(state.usedSessionFingerprints),
    sessions.length,
  );
  for (const sessionId of sessions)
    assert.equal(hasUsedSession(state, sessionId), true);
  assert.equal(hasUsedSession(state, "fresh-session"), false);

  const duplicated = Buffer.concat([
    Buffer.from(deriveSessionFingerprint("worker-old"), "hex"),
    Buffer.from(deriveSessionFingerprint("worker-old"), "hex"),
  ]).toString("base64");
  assert.ok(
    runInvariantErrors({
      ...run(),
      usedSessionCount: 2,
      usedSessionFingerprints: duplicated,
    }).some((error) => error.includes("used session fingerprint ledger")),
  );
  assert.ok(
    runInvariantErrors({
      ...run(),
      usedSessionCount: sessions.length,
      usedSessionFingerprints: sessionLedger(...sessions)
        .split("")
        .reverse()
        .join(""),
    }).some((error) => error.includes("used session fingerprint ledger")),
  );

  // The former independently forgeable count/filter/hash triplet is not part
  // of the schema, so this exact historical-reuse counterexample now fails
  // before a reducer can treat its nonzero count as meaningful history.
  const bloomEraForgery = {
    ...run(),
    usedSessionFilter: Buffer.alloc(8_192, 1).toString("base64"),
    usedSessionFilterHash: HASH,
  };
  assert.equal(validate(RepositoryRunSchema, bloomEraForgery).ok, false);
});

test("closed evidence is canonical, bounded, and retains released reservation lineage", () => {
  let state = approvedCandidate("integrate", "remote-ff", "remote-integration");
  state = step(state, "publish_intent", {});
  state = observe(state, "publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  state = step(state, "integrate_intent", {});
  state = observe(state, "integrate_observed", "integrate", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
    integrationOid: OID_C,
    controllerFencingToken: "fence-1",
  });
  state = step(state, "reservation_release_intent", {});
  state = observe(state, "reservation_released", "reservation_release");
  assert.deepEqual(runInvariantErrors(state), []);
  assert.notEqual(state.closedUnitEvidence, "");

  const missingReleasedReservation = { ...state, reservations: {} };
  assert.ok(
    runInvariantErrors(missingReleasedReservation).some((error) =>
      error.includes("released reservation lineage"),
    ),
  );
  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: state.closedUnitEvidence.slice(0, -1),
    }).some((error) => error.includes("closed unit evidence ledger")),
  );

  const decoded = inflateRawSync(
    Buffer.from(state.closedUnitEvidence, "base64"),
  ).toString("utf8");
  const nonCanonical = deflateRawSync(Buffer.from(decoded, "utf8"), {
    level: 0,
  }).toString("base64");
  assert.notEqual(nonCanonical, state.closedUnitEvidence);
  assert.ok(
    runInvariantErrors({ ...state, closedUnitEvidence: nonCanonical }).some(
      (error) => error.includes("closed unit evidence ledger"),
    ),
  );

  const oversized = deflateRawSync(
    Buffer.alloc(LIMITS.envelopeBytes + 1, 0),
  ).toString("base64");
  assert.ok(
    runInvariantErrors({ ...state, closedUnitEvidence: oversized }).some(
      (error) => error.includes("closed unit evidence ledger"),
    ),
  );
  const unknownFacts = JSON.parse(decoded) as Record<
    string,
    Record<string, unknown>
  >;
  unknownFacts["unit-1"] = { ...unknownFacts["unit-1"], secret: "nope" };
  const unknownFactLedger = deflateRawSync(
    Buffer.from(
      canonicalJson(
        unknownFacts as unknown as import("../../src/protocol/canonical.js").JsonValue,
      ),
      "utf8",
    ),
    { level: 9 },
  ).toString("base64");
  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: unknownFactLedger,
    }).some((error) => error.includes("closed unit evidence ledger")),
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
