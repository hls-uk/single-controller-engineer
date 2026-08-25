import type {
  ProtocolEvent,
  RepositoryRun,
  Unit,
} from "../../src/protocol/schemas.js";
import {
  deriveIdempotencyKey,
  deriveCandidateDiffHash,
  deriveParamsHash,
  deriveRepairContextHash,
  deriveRepairJudgmentPromptHash,
  deriveRepairJudgmentResponseHash,
} from "../../src/protocol/reducer.js";
import { canonicalJson } from "../../src/protocol/canonical.js";
import { sha256 } from "../../src/protocol/evidence.js";

export const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const OID_C = "cccccccccccccccccccccccccccccccccccccccc";
export const HASH = "d".repeat(64);
export const CANDIDATE_DIFF = "diff";

function launchPacket(
  state: RepositoryRun,
  unitId: string,
  role: "reviewer" | "worker",
) {
  const current = state.units[unitId];
  const value = {
    acceptance: ["acceptance-1"],
    baseOid: current?.baseOid ?? OID_A,
    ...(role === "reviewer"
      ? { diff: CANDIDATE_DIFF, headOid: current?.candidateHead ?? OID_B }
      : {}),
    mandatoryVerification: ["npm test"],
    ownedPaths: ["src"],
    role,
    schema: "sce.harness-packet" as const,
    unitId,
    version: 1 as const,
  };
  const payload = canonicalJson(value);
  return {
    hash: sha256(`sce.harness-packet/v1\n${payload}`),
    payload,
    schema: "sce.harness-packet" as const,
    version: 1 as const,
  };
}

export function unit(id: string, state: Unit["state"] = "planned"): Unit {
  return {
    id,
    ordinal: 0,
    revision: 0,
    state,
    baseOid: OID_A,
    taskMetadata: {
      acceptanceIds: ["acceptance-1"],
      conflictDomains: [],
      dependencies: [],
      independence: "proven",
      mandatoryVerification: ["npm test"],
      ownedPaths: ["src"],
      priority: 0,
      reservations: [],
      risk: "medium",
      unitId: id,
    },
    reservationIds: [],
    repairCount: 0,
  };
}
export function run(units: readonly Unit[] = [unit("unit-1")]): RepositoryRun {
  return {
    revision: 0,
    state: "active",
    storeIdentity: "store-1",
    repositoryIdentity: "repo-1",
    integrationBranch: "main",
    authorityProfile: "integrate",
    completionBoundary: "remote-integration",
    integrationProfile: "remote-ff",
    gitObjectFormat: "sha1",
    controllerFencingToken: "fence-1",
    controller: {
      runId: "run-1",
      incarnationId: "incarnation-1",
      holder: "run-1/incarnation-1",
      requestedModel: "frontier",
      returnedModel: "frontier-1",
      promptHash: HASH,
      state: "acquired",
    },
    harness: {
      adapterVersion: 1,
      family: "codex",
      harnessVersion: 1,
      supportCommitment: HASH,
    },
    units: Object.fromEntries(
      units.map((item, ordinal) => [item.id, { ...item, ordinal }]),
    ),
    reservations: {},
    activeModifyingUnitIds: [],
    wave: {
      id: "wave-1",
      unitIds: units
        .map((item) => item.id)
        .sort()
        .slice(0, 3),
    },
    qualificationQueue: [],
    integrationQueue: [],
    effectJournal: [],
    processedEventIds: [],
    processedIdempotencyKeys: [],
    usedSessionCount: 0,
    sessionLineage: "",
    sessionLineageRoot: "0".repeat(64),
    closedUnitEvidence: "",
    closedUnitEvidenceCommitment: "0".repeat(64),
    journalCheckpoint: {
      revision: 0,
      compactedEffects: 0,
      compactedEvents: 0,
      compactedIdempotencyKeys: 0,
      commitment: "0".repeat(64),
    },
    journalCommitment: "0".repeat(64),
  };
}
export function event(
  state: RepositoryRun,
  type: ProtocolEvent["type"],
  fields: Record<string, unknown> = {},
  unitId = "unit-1",
): ProtocolEvent {
  const kinds: Partial<
    Record<ProtocolEvent["type"], Parameters<typeof deriveIdempotencyKey>[3]>
  > = {
    controller_acquire_intent: "controller_acquire",
    controller_release_intent: "controller_release",
    reservation_intent: "reservation_acquire",
    branch_intent: "branch_create",
    worktree_intent: "worktree_create",
    dispatch_intent: "dispatch",
    collect_intent: "worker_collect",
    candidate_intent: "candidate_collect",
    verification_intent: "verify",
    reviewer_dispatch_intent: "review_dispatch",
    review_collect_intent: "review_collect",
    publish_intent: "publish",
    integrate_intent: "integrate",
    reservation_release_intent: "reservation_release",
    repair_intent: "repair",
    failure_intent: "failure",
    timeout_intent: "timeout",
    park_intent: "park",
    cancel_intent: "cancel",
  };
  const kind = kinds[type];
  const effectUnitId = type.startsWith("controller_") ? null : unitId;
  const normalizedFields =
    type === "worker_collected" &&
    typeof fields.workerResult === "object" &&
    fields.workerResult !== null
      ? {
          ...(state.units[unitId]?.workerSessionId === undefined
            ? {}
            : {
                promptHash: state.units[unitId]!.workerPromptHash,
                requestedModel: state.units[unitId]!.workerRequestedModel,
                returnedModel: state.units[unitId]!.workerReturnedModel,
                sessionId: state.units[unitId]!.workerSessionId,
              }),
          ...fields,
          workerResult: {
            ...(fields.workerResult as Record<string, unknown>),
            suggestedFollowUps:
              (fields.workerResult as Record<string, unknown>)
                .suggestedFollowUps ?? [],
          },
        }
      : fields;
  const unit = state.units[unitId];
  const sessionBoundFields =
    (type === "dispatch_observed" || type === "repair_observed") &&
    unit?.workerPromptHash !== undefined &&
    unit.workerRequestedModel !== undefined
      ? {
          ...normalizedFields,
          promptHash: unit.workerPromptHash,
          requestedModel: unit.workerRequestedModel,
        }
      : type === "reviewer_observed" &&
          unit?.reviewPromptHash !== undefined &&
          unit.reviewerRequestedModel !== undefined
        ? {
            ...normalizedFields,
            promptHash: unit.reviewPromptHash,
            requestedModel: unit.reviewerRequestedModel,
          }
        : type === "worker_collected" &&
            unit?.workerPromptHash !== undefined &&
            unit.workerRequestedModel !== undefined
          ? {
              ...normalizedFields,
              promptHash: unit.workerPromptHash,
              requestedModel: unit.workerRequestedModel,
            }
          : type === "review_collected" &&
              unit?.reviewPromptHash !== undefined &&
              typeof normalizedFields.judgment === "object" &&
              normalizedFields.judgment !== null
            ? {
                ...normalizedFields,
                judgment: {
                  ...(normalizedFields.judgment as Record<string, unknown>),
                  promptHash: unit.reviewPromptHash,
                },
              }
            : normalizedFields;
  const terminalFields =
    type === "cancel_observed"
      ? (() => {
          if (unit === undefined) return sessionBoundFields;
          if (state.currentReviewerUnitId === unitId)
            return {
              role: "reviewer",
              sessionId: unit.reviewerSessionId,
              returnedModel: unit.reviewerReturnedModel,
              ...sessionBoundFields,
              promptHash: unit.reviewPromptHash,
              requestedModel: unit.reviewerRequestedModel,
            };
          if (state.activeModifyingUnitIds.includes(unitId))
            return {
              role: "worker",
              sessionId: unit.workerSessionId,
              returnedModel: unit.workerReturnedModel,
              ...sessionBoundFields,
              promptHash: unit.workerPromptHash,
              requestedModel: unit.workerRequestedModel,
            };
          return { role: "none", ...sessionBoundFields };
        })()
      : sessionBoundFields;
  const repairJudgment =
    type === "repair_intent" &&
    typeof terminalFields.judgment === "object" &&
    terminalFields.judgment !== null &&
    state.units[unitId] !== undefined
      ? (() => {
          const judgment = terminalFields.judgment as Extract<
            ProtocolEvent,
            { type: "repair_intent" }
          >["judgment"];
          const promptHash = deriveRepairJudgmentPromptHash(
            state,
            state.units[unitId]!,
            judgment,
          );
          const promptBoundJudgment = { ...judgment, promptHash };
          return {
            ...terminalFields,
            judgment: {
              ...promptBoundJudgment,
              responseHash:
                deriveRepairJudgmentResponseHash(promptBoundJudgment),
            },
          };
        })()
      : terminalFields;
  const candidateDiffBoundFields =
    type === "candidate_observed"
      ? {
          candidateDiffHash: deriveCandidateDiffHash(CANDIDATE_DIFF),
          ...repairJudgment,
        }
      : repairJudgment;
  const packet =
    type === "dispatch_intent" || type === "repair_intent"
      ? launchPacket(state, unitId, "worker")
      : type === "reviewer_dispatch_intent"
        ? launchPacket(state, unitId, "reviewer")
        : undefined;
  return {
    eventId: `event-${state.revision + 1}`,
    expectedRevision: state.revision,
    unitId,
    type,
    ...(type === "dispatch_intent"
      ? { requestedModel: "workhorse", promptHash: packet?.hash ?? HASH }
      : {}),
    ...(type === "verification_intent" ? { commands: ["npm test"] } : {}),
    ...(type === "reviewer_dispatch_intent"
      ? { requestedModel: "frontier", promptHash: packet?.hash ?? HASH }
      : {}),
    ...(type === "repair_intent"
      ? { requestedModel: "workhorse", promptHash: packet?.hash ?? HASH }
      : {}),
    ...candidateDiffBoundFields,
    // Packet bytes are the launch prompt. Keep ordinary lifecycle fixtures
    // bound to that packet even when their generic fields use HASH elsewhere.
    ...(packet === undefined ? {} : { packet, promptHash: packet.hash }),
    ...(kind === undefined
      ? {}
      : {
          idempotencyKey: deriveIdempotencyKey(
            state,
            state.revision,
            effectUnitId,
            kind,
          ),
        }),
  } as ProtocolEvent;
}
export function transition(
  state: RepositoryRun,
  input: ProtocolEvent,
  reduce: (
    current: RepositoryRun,
    next: ProtocolEvent,
  ) => import("../../src/protocol/reducer.js").Reduction,
): RepositoryRun {
  const result = reduce(state, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);
  for (const effect of result.effects) {
    if (effect.paramsHash !== deriveParamsHash(effect.kind, effect.params))
      throw new Error(`effect ${effect.effectId} has an unbound params hash`);
    if (
      result.nextState.effectJournal.find(
        (entry) => entry.effectId === effect.effectId,
      )?.paramsHash !== effect.paramsHash
    )
      throw new Error(
        `journal ${effect.effectId} disagrees with effect params`,
      );
  }
  return result.nextState;
}

export function repairEvidence(
  state: RepositoryRun,
  unitId = "unit-1",
): Pick<
  Extract<ProtocolEvent, { type: "repair_intent" }>["judgment"],
  "currentEvidenceHash" | "findingsContextHash"
> {
  const context = state.units[unitId]?.repairContext;
  if (context === undefined)
    throw new Error(`missing repair context for ${unitId}`);
  return {
    currentEvidenceHash: context.responseHash,
    findingsContextHash: deriveRepairContextHash(context),
  };
}
