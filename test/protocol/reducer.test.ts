import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import fc from "fast-check";
import { legalActions } from "../../src/protocol/actions.js";
import {
  deriveClosedUnitEvidenceCommitment,
  deriveIdempotencyKey,
  deriveIntentCommitment,
  deriveJournalCommitment,
  deriveParamsHash,
  deriveRepairJudgmentPromptHash,
  deriveRepairJudgmentResponseHash,
  deriveSessionFingerprint,
  deriveSessionLineageRoot,
  hasUsedSession,
  reduce,
  runInvariantErrors,
  sessionLineageCount,
} from "../../src/protocol/reducer.js";
import { canEnterTerminalIntent } from "../../src/protocol/guards.js";
import type {
  EffectJournalEntry,
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

test("hydration binds persisted packets, verification, and reviewer diff bytes", () => {
  const legacy = run();
  const legacyUnit = { ...legacy.units["unit-1"]! };
  delete legacyUnit.taskMetadata;
  const legacyPlanned = {
    ...legacy,
    units: { ...legacy.units, "unit-1": legacyUnit },
  };
  assert.equal(validate(RepositoryRunSchema, legacyPlanned).ok, true);
  assert.deepEqual(runInvariantErrors(legacyPlanned), []);

  const candidate = completeCandidate();
  assert.deepEqual(runInvariantErrors(candidate), []);
  const missingMetadataUnit = { ...candidate.units["unit-1"]! };
  delete missingMetadataUnit.taskMetadata;
  const missingMetadata = {
    ...candidate,
    units: { ...candidate.units, "unit-1": missingMetadataUnit },
  };
  assert.equal(validate(RepositoryRunSchema, missingMetadata).ok, true);
  assert.ok(
    runInvariantErrors(missingMetadata).some((error) =>
      error.includes(
        "worker packet unit-1 launch packet lacks committed wave task metadata",
      ),
    ),
  );
  const mismatchedPacketMetadata = {
    ...candidate,
    units: {
      ...candidate.units,
      "unit-1": {
        ...candidate.units["unit-1"]!,
        taskMetadata: {
          ...candidate.units["unit-1"]!.taskMetadata!,
          ownedPaths: ["totally-different"],
        },
      },
    },
  };
  assert.ok(
    runInvariantErrors(mismatchedPacketMetadata).some((error) =>
      error.includes(
        "worker packet unit-1 launch packet does not bind committed",
      ),
    ),
  );

  const verification = step(candidate, "verification_intent");
  const mismatchedVerification = {
    ...verification,
    units: {
      ...verification.units,
      "unit-1": {
        ...verification.units["unit-1"]!,
        verificationCommands: ["true"],
      },
    },
  };
  assert.ok(
    runInvariantErrors(mismatchedVerification).some((error) =>
      error.includes(
        "verification commands unit-1 verification commands do not match",
      ),
    ),
  );
  const qualified = observe(verification, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  const reviewIntent = step(qualified, "reviewer_dispatch_intent");
  assert.deepEqual(runInvariantErrors(reviewIntent), []);
  const substitutedDiff = {
    ...reviewIntent,
    units: {
      ...reviewIntent.units,
      "unit-1": {
        ...reviewIntent.units["unit-1"]!,
        candidateDiffHash: HASH,
      },
    },
  };
  assert.ok(
    runInvariantErrors(substitutedDiff).some((error) =>
      error.includes(
        "review packet unit-1 review packet is not bound to the exact candidate diff",
      ),
    ),
  );
});

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
  if (sessionIds.length === 0) return "";
  const bitmapBytes = Math.ceil(sessionIds.length / 8);
  const raw = Buffer.alloc(bitmapBytes + sessionIds.length * 32);
  for (const [index, sessionId] of sessionIds.entries()) {
    raw[Math.floor(index / 8)]! |= 1 << (index % 8);
    Buffer.from(deriveSessionFingerprint(sessionId), "hex").copy(
      raw,
      bitmapBytes + index * 32,
    );
  }
  return raw.toString("base64");
}

function journalEntry(
  entry: Omit<EffectJournalEntry, "intentRevision" | "intentCommitment">,
  intentRevision = 0,
): EffectJournalEntry {
  const withRevision = {
    ...entry,
    intentRevision,
    intentCommitment: "0".repeat(64),
  };
  return {
    ...withRevision,
    intentCommitment: deriveIntentCommitment(withRevision),
  };
}

function withJournalCommitment(
  state: RepositoryRun,
  effectJournal: readonly EffectJournalEntry[],
): RepositoryRun {
  return {
    ...state,
    effectJournal: [...effectJournal],
    journalCommitment: deriveJournalCommitment(
      state.journalCheckpoint.commitment,
      effectJournal,
    ),
  };
}

function mutateDenseClosedEvidence(
  state: RepositoryRun,
  mutate: (dense: { u: Record<string, unknown[]> }) => void,
): RepositoryRun {
  const dense = JSON.parse(
    inflateRawSync(Buffer.from(state.closedUnitEvidence, "base64")).toString(
      "utf8",
    ),
  ) as { u: Record<string, unknown[]> };
  mutate(dense);
  const closedUnitEvidence = deflateRawSync(
    Buffer.from(
      canonicalJson(
        dense as unknown as import("../../src/protocol/canonical.js").JsonValue,
      ),
      "utf8",
    ),
    { level: 9 },
  ).toString("base64");
  return {
    ...state,
    closedUnitEvidence,
    closedUnitEvidenceCommitment:
      deriveClosedUnitEvidenceCommitment(closedUnitEvidence),
  };
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
  assert.equal(state.units["unit-1"], undefined);
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
        effectJournal: units.map((item, index) =>
          journalEntry({
            effectId: `reserve-${index + 1}`,
            unitId: item.id,
            idempotencyKey: `reserve-key-${index + 1}`,
            kind: "reservation_acquire" as const,
            paramsHash: HASH,
            status: "observed" as const,
            observationHash: HASH,
            schemaVersion: 1 as const,
          }),
        ),
      };
      state = withJournalCommitment(state, state.effectJournal);
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
  const hydratedJournal = state.effectJournal.map((entry) =>
    entry.unitId === "unit-1" || entry.unitId === "unit-2"
      ? { ...entry, status: "ambiguous" as const, observationHash: HASH }
      : entry,
  );
  state = withJournalCommitment(
    {
      ...state,
      state: "blocked",
      units: {
        ...state.units,
        "unit-1": { ...state.units["unit-1"]!, state: "blocked" },
        "unit-2": { ...state.units["unit-2"]!, state: "blocked" },
      },
    },
    hydratedJournal,
  );
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

test("an ambiguous reservation release retains closure lineage and converges on its exact observation", () => {
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
  const releaseEffectId = effectId(state, "reservation_release");
  state = step(state, "effect_ambiguous", {
    effectId: releaseEffectId,
    effectKind: "reservation_release",
    observationHash: HASH,
  });
  assert.equal(state.state, "blocked");
  assert.equal(state.units["unit-1"]?.state, "blocked");
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(
    legalActions(state).some((action) => action.mode === "emit"),
    false,
  );
  const dense = JSON.parse(
    inflateRawSync(Buffer.from(state.closedUnitEvidence, "base64")).toString(
      "utf8",
    ),
  ) as { u: Record<string, unknown[]> };
  const release = ((
    dense.u["unit-1"]?.[9] as unknown[][] | undefined
  )?.[0]?.[4] ?? null) as unknown[] | null;
  assert.equal(release?.[7], "ambiguous");

  state = step(state, "reservation_released", {
    effectId: releaseEffectId,
    effectKind: "reservation_release",
    observationHash: HASH,
  });
  assert.equal(state.state, "active");
  assert.equal(state.units["unit-1"], undefined);
  assert.equal(state.reservations["res-1"], undefined);
  assert.deepEqual(runInvariantErrors(state), []);
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
    assert.equal(handoff.units["unit-1"], undefined);
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

  for (const integrationProfile of ["remote-ff"] as const) {
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

test("real old-to-repair-current lineage rejects same-count substitution and old replay", () => {
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
  const sameCountSubstitution = {
    ...state,
    // Same count, but old history is substituted for an unrelated digest
    // while the independently anchored lineage root remains untouched.
    sessionLineage: sessionLedger(
      "worker-repair-current",
      "unrelated-substitution",
    ),
  };
  assert.equal(sameCountSubstitution.usedSessionCount, 2);
  assert.equal(
    sameCountSubstitution.sessionLineageRoot,
    state.sessionLineageRoot,
  );
  assert.ok(
    runInvariantErrors(sameCountSubstitution).some((error) =>
      error.includes("session lineage root"),
    ),
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
  const validEvent = event(repairable, "repair_intent", { judgment });
  if (validEvent.type !== "repair_intent") throw new Error("missing repair");
  assert.equal(
    validEvent.judgment.promptHash,
    deriveRepairJudgmentPromptHash(
      repairable,
      repairable.units["unit-1"]!,
      validEvent.judgment,
    ),
  );
  assert.equal(
    validEvent.judgment.responseHash,
    deriveRepairJudgmentResponseHash(validEvent.judgment),
  );
  for (const output of [
    { ...validEvent.judgment, rationale: "different controller rationale" },
    { ...validEvent.judgment, decision: "cancel" },
  ] as const) {
    const outputJudgment = output as Extract<
      ProtocolEvent,
      { type: "repair_intent" }
    >["judgment"];
    assert.equal(
      deriveRepairJudgmentPromptHash(
        repairable,
        repairable.units["unit-1"]!,
        outputJudgment,
      ),
      validEvent.judgment.promptHash,
    );
    assert.notEqual(
      deriveRepairJudgmentResponseHash(outputJudgment),
      validEvent.judgment.responseHash,
    );
  }
  for (const input of [
    { ...validEvent.judgment, factOid: OID_A },
    { ...validEvent.judgment, currentEvidenceHash: "f".repeat(64) },
    { ...validEvent.judgment, findingsContextHash: "f".repeat(64) },
  ])
    assert.notEqual(
      deriveRepairJudgmentPromptHash(
        repairable,
        repairable.units["unit-1"]!,
        input,
      ),
      validEvent.judgment.promptHash,
    );
  assert.notEqual(validEvent.promptHash, validEvent.judgment.promptHash);
  assert.notEqual(
    deriveRepairJudgmentPromptHash(
      { ...repairable, integrationBranch: "different-branch" },
      repairable.units["unit-1"]!,
      validEvent.judgment,
    ),
    validEvent.judgment.promptHash,
  );
  assert.equal(
    reduce({ ...repairable, integrationBranch: "different-branch" }, validEvent)
      .ok,
    false,
  );
  assert.equal(
    reduce(repairable, {
      ...validEvent,
      promptHash: "c".repeat(64),
    }).ok,
    false,
  );
  for (const field of ["promptHash", "responseHash"] as const)
    assert.equal(
      reduce(repairable, {
        ...validEvent,
        judgment: { ...validEvent.judgment, [field]: "f".repeat(64) },
      }).ok,
      false,
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
  const completed = Array.from({ length: 256 }, (_, index) =>
    journalEntry({
      effectId: `effect-${index}`,
      unitId: "unit-1",
      idempotencyKey: `key-${index}`,
      kind: "candidate_collect" as const,
      paramsHash: HASH,
      status: "observed" as const,
      observationHash: HASH,
      schemaVersion: 1 as const,
    }),
  );
  const initial = withJournalCommitment(
    {
      ...run(),
      processedIdempotencyKeys: completed.map((entry) => entry.idempotencyKey),
    },
    completed,
  );
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

test("journal commitment rejects exact observed-field mutation before and after checkpointing", () => {
  const state = completeCandidate();
  const observedIndex = state.effectJournal.findIndex(
    (entry) => entry.status === "observed",
  );
  assert.notEqual(observedIndex, -1);
  const mutations: ReadonlyArray<
    (entry: EffectJournalEntry) => EffectJournalEntry
  > = [
    (entry) => ({ ...entry, paramsHash: "1".repeat(64) }),
    (entry) => ({ ...entry, idempotencyKey: "mutated-idempotency" }),
    (entry) => ({ ...entry, kind: "verify" }),
    ({ observationHash: _observationHash, ...entry }) => ({
      ...entry,
      status: "intended",
    }),
    (entry) => ({ ...entry, observationHash: "2".repeat(64) }),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const effectJournal = [...state.effectJournal];
    const entry = effectJournal[observedIndex];
    if (entry === undefined) throw new Error("missing observed journal entry");
    effectJournal[observedIndex] = mutate(entry);
    const errors = runInvariantErrors({ ...state, effectJournal });
    assert.ok(
      errors.some(
        (error) =>
          error.includes("journal commitment") ||
          error.includes("invalid intent commitment"),
      ),
      `mutation ${index}: ${errors.join("; ")}`,
    );
  }

  const checkpointed = step(state, "verification_intent", {});
  assert.ok(checkpointed.journalCheckpoint.compactedEffects > 0);
  assert.ok(
    runInvariantErrors({
      ...checkpointed,
      journalCheckpoint: {
        ...checkpointed.journalCheckpoint,
        commitment: "3".repeat(64),
      },
    }).some((error) => error.includes("journal commitment")),
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
      commitment: "0".repeat(64),
    },
    journalCommitment: "0".repeat(64),
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
      packet: (
        event(replay, "repair_intent") as Extract<
          ProtocolEvent,
          { type: "repair_intent" }
        >
      ).packet,
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
          .every((unitId) => state.units[unitId] === undefined),
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
  assert.equal(Object.keys(state.units).length === 0, true);
  assert.ok(state.journalCheckpoint.compactedEffects > 0);
  assert.ok(state.journalCheckpoint.compactedEvents > 0);
  assert.ok(state.journalCheckpoint.compactedIdempotencyKeys > 0);
  assert.equal(
    sessionLineageCount(state.sessionLineage),
    LIMITS.units * 16 * 2,
  );
  assert.equal(state.usedSessionCount, LIMITS.units * 16 * 2);
  assert.equal(Buffer.from(state.sessionLineage, "base64").length, 69_872);
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
  const corruptSessionLineage = {
    ...run(),
    sessionLineage: "AA==",
  };
  assert.ok(
    runInvariantErrors(corruptSessionLineage).some((error) =>
      error.includes("session lineage ledger"),
    ),
  );
  const nonCanonicalSessionLineage = {
    ...run(),
    sessionLineage: "AAAA",
  };
  assert.ok(
    runInvariantErrors(nonCanonicalSessionLineage).some((error) =>
      error.includes("session lineage ledger"),
    ),
  );
});

test("session fingerprint ledgers retain exact history and reject forged Bloom-era state", () => {
  const sessions = ["worker-old", "worker-new", "reviewer-old"] as const;
  const state = {
    ...run(),
    usedSessionCount: sessions.length,
    sessionLineage: sessionLedger(...sessions),
    sessionLineageRoot: deriveSessionLineageRoot(
      sessionLedger(...sessions),
      sessions.length,
    ),
  };
  assert.deepEqual(runInvariantErrors(state), []);
  assert.equal(sessionLineageCount(state.sessionLineage), sessions.length);
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
      sessionLineage: duplicated,
    }).some((error) => error.includes("session lineage ledger")),
  );
  assert.ok(
    runInvariantErrors({
      ...run(),
      usedSessionCount: sessions.length,
      sessionLineage: sessionLedger(...sessions)
        .split("")
        .reverse()
        .join(""),
    }).some((error) => error.includes("session lineage ledger")),
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
  assert.ok(state.closedUnitEvidence.length > 0);
  assert.ok(
    runInvariantErrors(
      mutateDenseClosedEvidence(state, (dense) => {
        // Slot 4 is deliberately absent until the live unit has released.
        dense.u["unit-1"]![4] = 0;
      }),
    ).some((error) => error.includes("duplicates authoritative repair count")),
  );
  state = step(state, "reservation_release_intent", {});
  const releaseIntentDense = JSON.parse(
    inflateRawSync(Buffer.from(state.closedUnitEvidence, "base64")).toString(
      "utf8",
    ),
  ) as { u: Record<string, unknown[]> };
  assert.equal(releaseIntentDense.u["unit-1"]?.[4], null);
  state = observe(state, "reservation_released", "reservation_release");
  assert.deepEqual(runInvariantErrors(state), []);
  assert.notEqual(state.closedUnitEvidence, "");

  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: state.closedUnitEvidence.slice(0, -1),
    }).some((error) => error.includes("closed unit evidence ledger")),
  );

  const decoded = inflateRawSync(
    Buffer.from(state.closedUnitEvidence, "base64"),
  ).toString("utf8");
  const missingReleasedReservation = JSON.parse(decoded) as {
    u: Record<string, unknown[]>;
  };
  const denseReservations = missingReleasedReservation.u["unit-1"]?.[9] as
    unknown[][] | undefined;
  if (denseReservations?.[0] === undefined)
    throw new Error("missing dense reservation");
  assert.ok(
    runInvariantErrors(
      mutateDenseClosedEvidence(state, (dense) => {
        // Fixed-width compact reservation tuple: acquire is slot 3.
        (dense.u["unit-1"]![9] as unknown[][])[0]![3] = null;
      }),
    ).some((error) => error.includes("closed unit evidence ledger")),
  );
  // Fixed-width compact reservation tuple: release is slot 4.
  denseReservations[0][4] = null;
  const missingReleasedReservationLedger = deflateRawSync(
    Buffer.from(
      canonicalJson(
        missingReleasedReservation as unknown as import("../../src/protocol/canonical.js").JsonValue,
      ),
      "utf8",
    ),
    { level: 9 },
  ).toString("base64");
  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: missingReleasedReservationLedger,
    }).some((error) => error.includes("reservation")),
  );
  const alternateCompression = deflateRawSync(Buffer.from(decoded, "utf8"), {
    level: 0,
  }).toString("base64");
  assert.notEqual(alternateCompression, state.closedUnitEvidence);
  assert.equal(
    deriveClosedUnitEvidenceCommitment(alternateCompression),
    state.closedUnitEvidenceCommitment,
  );
  assert.deepEqual(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: alternateCompression,
      closedUnitEvidenceCommitment:
        deriveClosedUnitEvidenceCommitment(alternateCompression),
    }),
    [],
  );

  // zlib level 0 golden vector for canonical `{"u":{},"v":1}`. This is
  // semantically the same empty ledger as the canonical empty-string form.
  const alternateEmptyGolden = "AQ4A8f97InUiOnt9LCJ2IjoxfQ==";
  assert.deepEqual(
    runInvariantErrors({
      ...run(),
      closedUnitEvidence: alternateEmptyGolden,
      closedUnitEvidenceCommitment:
        deriveClosedUnitEvidenceCommitment(alternateEmptyGolden),
    }),
    [],
  );
  const trailingCompressedInput = Buffer.concat([
    Buffer.from(state.closedUnitEvidence, "base64"),
    Buffer.from([0]),
  ]).toString("base64");
  assert.ok(
    runInvariantErrors({
      ...state,
      closedUnitEvidence: trailingCompressedInput,
    }).some((error) => error.includes("closed unit evidence ledger")),
  );

  const oversized = deflateRawSync(
    Buffer.alloc(LIMITS.envelopeBytes + 1, 0),
  ).toString("base64");
  assert.ok(
    runInvariantErrors({ ...state, closedUnitEvidence: oversized }).some(
      (error) => error.includes("closed unit evidence ledger"),
    ),
  );
  const unknownFacts = JSON.parse(decoded) as {
    u: Record<string, unknown[]>;
  };
  unknownFacts.u["unit-1"]?.push("secret-shaped-accidental-payload");
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

test("every closure outcome has exact discriminated facts and one final repair count", () => {
  const release = (state: RepositoryRun) =>
    observe(
      step(state, "reservation_release_intent", {}),
      "reservation_released",
      "reservation_release",
    );
  const successful = (boundary: "landed" | "branch_handoff" | "pr_handoff") => {
    if (boundary === "landed") {
      let state = approvedCandidate(
        "integrate",
        "remote-ff",
        "remote-integration",
      );
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
      return release(state);
    }
    let state = approvedCandidate(
      boundary === "pr_handoff" ? "open-pr" : "push-branch",
      "none",
      boundary === "pr_handoff" ? "pr-handoff" : "branch-handoff",
    );
    state = step(state, "publish_intent", {});
    state = observe(state, "publish_observed", "publish", {
      publication:
        boundary === "pr_handoff"
          ? {
              kind: "open_pr",
              pullRequest: {
                providerPrId: "pr-closure",
                state: "open",
                baseRef: "main",
                baseOid: OID_A,
                remoteHeadOid: OID_B,
              },
            }
          : { kind: "push_branch", remoteHeadOid: OID_B },
    });
    return release(state);
  };
  const negative = (
    outcome: "failed" | "timed_out" | "parked" | "cancelled",
  ) => {
    const intent = {
      failed: "failure_intent",
      timed_out: "timeout_intent",
      parked: "park_intent",
      cancelled: "cancel_intent",
    } as const;
    const observed = {
      failed: "failure_observed",
      timed_out: "timeout_observed",
      parked: "park_observed",
      cancelled: "cancel_observed",
    } as const;
    const kind = {
      failed: "failure",
      timed_out: "timeout",
      parked: "park",
      cancelled: "cancel",
    } as const;
    let state = completeCandidate();
    state = step(state, intent[outcome], {});
    state = observe(state, observed[outcome], kind[outcome]);
    return release(state);
  };
  const cases: ReadonlyArray<{
    readonly outcome: string;
    readonly state: RepositoryRun;
  }> = [
    ...(["landed", "branch_handoff", "pr_handoff"] as const).map((outcome) => ({
      outcome,
      state: successful(outcome),
    })),
    ...(["failed", "timed_out", "parked", "cancelled"] as const).map(
      (outcome) => ({ outcome, state: negative(outcome) }),
    ),
  ];
  for (const { outcome, state } of cases) {
    assert.deepEqual(runInvariantErrors(state), []);
    const dense = JSON.parse(
      inflateRawSync(Buffer.from(state.closedUnitEvidence, "base64")).toString(
        "utf8",
      ),
    ) as { u: Record<string, unknown[]> };
    const record = dense.u["unit-1"];
    if (record === undefined) throw new Error(`missing ${outcome} closure`);
    assert.equal(record[0], outcome);
    assert.equal(record[4], 0);

    // The terminal effect is mandatory for all variants.
    assert.ok(
      runInvariantErrors(
        mutateDenseClosedEvidence(state, (mutated) => {
          mutated.u["unit-1"]![10] = null;
        }),
      ).some((error) => error.includes("closed unit evidence ledger")),
    );
    // Cross-variant payloads cannot be reinterpreted by changing a tag.
    assert.ok(
      runInvariantErrors(
        mutateDenseClosedEvidence(state, (mutated) => {
          mutated.u["unit-1"]![0] = outcome === "failed" ? "landed" : "failed";
        }),
      ).some(
        (error) =>
          error.includes("closed unit evidence ledger") ||
          error.includes("terminal effect lineage"),
      ),
    );
    // Successful variants have an outcome-specific required landing/handoff fact.
    if (
      outcome === "landed" ||
      outcome === "branch_handoff" ||
      outcome === "pr_handoff"
    )
      assert.ok(
        runInvariantErrors(
          mutateDenseClosedEvidence(state, (mutated) => {
            const payload = mutated.u["unit-1"]![11] as unknown[];
            payload[0] = null;
          }),
        ).some((error) => error.includes("closed unit evidence ledger")),
      );
    assert.ok(
      runInvariantErrors(
        mutateDenseClosedEvidence(state, (mutated) => {
          mutated.u["unit-1"]![4] = null;
        }),
      ).some((error) => error.includes("authoritative repair count")),
    );
  }
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
