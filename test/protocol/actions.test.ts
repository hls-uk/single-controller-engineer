import assert from "node:assert/strict";
import test from "node:test";
import { legalActions } from "../../src/protocol/actions.js";
import { deriveIdempotencyKey, reduce } from "../../src/protocol/reducer.js";
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
  unitId = "unit-1",
): RepositoryRun {
  return transition(state, event(state, type, fields, unitId), reduce);
}

function observe(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  kind: string,
  fields: Record<string, unknown> = {},
  unitId = "unit-1",
): RepositoryRun {
  return step(
    state,
    type,
    {
      effectId: `event-${state.revision}:${kind}`,
      effectKind: kind,
      observationHash: HASH,
      ...fields,
    },
    unitId,
  );
}

function actionTypes(state: RepositoryRun, unitId?: string): readonly string[] {
  return legalActions(state)
    .filter((action) => unitId === undefined || action.unitId === unitId)
    .map((action) => action.type);
}

test("legal actions are pure, ownership-aware, and acquisition emits once", () => {
  assert.deepEqual(
    legalActions(run()).find((action) => action.type === "reservation_intent"),
    {
      type: "reservation_intent",
      mode: "emit",
      unitId: "unit-1",
      effectKind: "reservation_acquire",
    },
  );
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
  assert.deepEqual(legalActions(ambiguous.nextState), [
    {
      effectKind: "controller_acquire",
      mode: "record",
      type: "controller_acquired",
    },
  ]);
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

  const intended = step(run(), "reservation_intent", {
    paramsHash: HASH,
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  const ambiguous = reduce(intended, {
    effectId: "event-1:reservation_acquire",
    effectKind: "reservation_acquire",
    eventId: "ambiguous-unit-1",
    expectedRevision: intended.revision,
    type: "effect_ambiguous",
    unitId: "unit-1",
  });
  assert.equal(ambiguous.ok, true);
  if (ambiguous.ok) assert.deepEqual(legalActions(ambiguous.nextState), []);
});

test("every normal lifecycle state exposes its reducer-legal progress descriptor", () => {
  let state = run();
  const expectProgress = (type: string) =>
    assert.ok(
      actionTypes(state).includes(type),
      `${state.units["unit-1"]?.state}: ${type}`,
    );

  expectProgress("reservation_intent");
  state = step(state, "reservation_intent", {
    paramsHash: HASH,
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  expectProgress("reservation_observed");
  state = observe(state, "reservation_observed", "reservation_acquire");
  expectProgress("branch_intent");
  state = step(state, "branch_intent", {
    branchRef: "sce/unit-1",
    paramsHash: HASH,
  });
  expectProgress("branch_observed");
  state = observe(state, "branch_observed", "branch_create", {
    branchRef: "sce/unit-1",
  });
  expectProgress("worktree_intent");
  state = step(state, "worktree_intent", {
    paramsHash: HASH,
    worktreePath: "/tmp/unit-1",
  });
  expectProgress("worktree_observed");
  state = observe(state, "worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  expectProgress("dispatch_intent");
  state = step(state, "dispatch_intent", { paramsHash: HASH });
  expectProgress("dispatch_observed");
  state = observe(state, "dispatch_observed", "dispatch", {
    promptHash: HASH,
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    sessionId: "worker-1",
  });
  expectProgress("collect_intent");
  state = step(state, "collect_intent", { paramsHash: HASH });
  expectProgress("worker_collected");
  state = observe(state, "worker_collected", "worker_collect", {
    workerResult: { residualRisks: [], status: "completed", summary: "done" },
  });
  expectProgress("candidate_intent");
  state = step(state, "candidate_intent", { paramsHash: HASH });
  expectProgress("candidate_observed");
  state = observe(state, "candidate_observed", "candidate_collect", {
    headOid: OID_B,
    treeOid: OID_C,
  });
  expectProgress("verification_intent");
  state = step(state, "verification_intent", { paramsHash: HASH });
  expectProgress("verification_observed");
  state = observe(state, "verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
  });
  expectProgress("reviewer_dispatch_intent");
  state = step(state, "reviewer_dispatch_intent", { paramsHash: HASH });
  expectProgress("reviewer_observed");
  state = observe(state, "reviewer_observed", "review_dispatch", {
    promptHash: HASH,
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    sessionId: "reviewer-1",
  });
  expectProgress("review_collect_intent");
  state = step(state, "review_collect_intent", { paramsHash: HASH });
  expectProgress("review_collected");
  state = observe(state, "review_collected", "review_collect", {
    judgment: {
      aggregateRevision: state.revision,
      baseOid: OID_A,
      decision: "approve",
      findings: [],
      headOid: OID_B,
      kind: "review_verdict",
      promptHash: HASH,
      rationale: "approved exact pair",
      requestedModel: "frontier",
      responseHash: HASH,
      returnedModel: "frontier-1",
      role: "reviewer",
      schemaVersion: 1,
      sessionId: "reviewer-1",
      treeOid: OID_C,
      unitId: "unit-1",
    },
  });
  expectProgress("publish_intent");
  state = step(state, "publish_intent", { paramsHash: HASH });
  expectProgress("publish_observed");
  state = observe(state, "publish_observed", "publish", {
    remoteHeadOid: OID_B,
  });
  expectProgress("integrate_intent");
  state = step(state, "integrate_intent", { paramsHash: HASH });
  expectProgress("integrate_observed");
  state = observe(state, "integrate_observed", "integrate", {
    baseOid: OID_A,
    controllerFencingToken: "fence-1",
    headOid: OID_B,
    integrationOid: OID_C,
    treeOid: OID_C,
  });
  expectProgress("reservation_release_intent");
  state = step(state, "reservation_release_intent", { paramsHash: HASH });
  expectProgress("reservation_released");
  state = observe(state, "reservation_released", "reservation_release");
  assert.deepEqual(legalActions(state), [
    {
      effectKind: "controller_release",
      mode: "emit",
      type: "controller_release_intent",
    },
  ]);
});

test("terminal, repair, cap, ownership, and order guards are represented", () => {
  const initial = run([unit("unit-2"), unit("unit-1")]);
  const reversed = run([unit("unit-1"), unit("unit-2")]);
  assert.deepEqual(legalActions(initial), legalActions(reversed));
  assert.deepEqual(
    actionTypes(run()).filter((type) => type.endsWith("_intent")),
    [
      "cancel_intent",
      "failure_intent",
      "park_intent",
      "reservation_intent",
      "timeout_intent",
    ],
  );

  const failing = step(run(), "failure_intent", { paramsHash: HASH });
  assert.ok(actionTypes(failing).includes("failure_observed"));
  const failed: RepositoryRun = {
    ...run(),
    units: {
      "unit-1": {
        ...run().units["unit-1"]!,
        candidateHead: OID_B,
        candidateTree: OID_C,
        repairContext: {
          baseOid: OID_A,
          findings: [
            {
              detail: "repair required",
              id: "finding-1",
              severity: "blocking",
            },
          ],
          headOid: OID_B,
          rationale: "repair required",
          responseHash: HASH,
          treeOid: OID_C,
        },
        state: "failed",
      },
    },
  };
  assert.ok(actionTypes(failed).includes("repair_intent"));
  assert.ok(actionTypes(failed).includes("reservation_release_intent"));
  const unboundRepair = {
    ...failed,
    units: {
      "unit-1": {
        ...failed.units["unit-1"]!,
        repairContext: {
          ...failed.units["unit-1"]!.repairContext!,
          headOid: OID_A,
        },
      },
    },
  };
  assert.equal(actionTypes(unboundRepair).includes("repair_intent"), false);
  const repairing = step(failed, "repair_intent", {
    judgment: {
      aggregateRevision: failed.revision,
      factOid: OID_B,
      kind: "repair_disposition",
      promptHash: HASH,
      rationale: "repair",
      requestedModel: "frontier",
      responseHash: HASH,
      returnedModel: "frontier-1",
      role: "controller",
      schemaVersion: 1,
      sessionId: "incarnation-1",
      unitId: "unit-1",
      decision: "repair",
    },
    paramsHash: HASH,
  });
  assert.deepEqual(
    legalActions(repairing).find((action) => action.type === "repair_observed"),
    {
      effectKind: "repair",
      mode: "record",
      type: "repair_observed",
      unitId: "unit-1",
    },
  );

  let capped = run([
    unit("unit-1"),
    unit("unit-2"),
    unit("unit-3"),
    unit("unit-4"),
  ]);
  for (const [index, id] of [
    "unit-1",
    "unit-2",
    "unit-3",
    "unit-4",
  ].entries()) {
    capped = toWorktree(capped, id, index);
  }
  for (const id of ["unit-1", "unit-2", "unit-3"]) {
    capped = step(capped, "dispatch_intent", { paramsHash: HASH }, id);
  }
  assert.equal(
    actionTypes(capped, "unit-4").includes("dispatch_intent"),
    false,
  );
});

function toWorktree(
  state: RepositoryRun,
  unitId: string,
  index: number,
): RepositoryRun {
  let next = step(
    state,
    "reservation_intent",
    {
      paramsHash: HASH,
      reservations: [
        {
          id: `res-${index}`,
          namespace: "port",
          resource: String(3001 + index),
        },
      ],
    },
    unitId,
  );
  next = observe(
    next,
    "reservation_observed",
    "reservation_acquire",
    {},
    unitId,
  );
  next = step(
    next,
    "branch_intent",
    { branchRef: `sce/${unitId}`, paramsHash: HASH },
    unitId,
  );
  next = observe(
    next,
    "branch_observed",
    "branch_create",
    { branchRef: `sce/${unitId}` },
    unitId,
  );
  next = step(
    next,
    "worktree_intent",
    { paramsHash: HASH, worktreePath: `/tmp/${unitId}` },
    unitId,
  );
  return observe(
    next,
    "worktree_observed",
    "worktree_create",
    { worktreePath: `/tmp/${unitId}` },
    unitId,
  );
}
