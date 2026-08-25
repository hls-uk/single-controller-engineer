import {
  LIMITS,
  SCHEMA_VERSION,
  ClosureEvidenceSchema,
  type EffectJournalEntry,
  type EffectKind,
  type ProtocolEvent,
  ProtocolEventSchema,
  type RepositoryRun,
  RepositoryRunSchema,
  type RuntimeEffect,
  RuntimeEffectSchema,
  type ClosureEvidence,
  type Unit,
  UnitSchema,
  type UnitState,
  type HarnessConfiguration,
  type HarnessPacket,
  HarnessPacketSchema,
  type HarnessPacketBinding,
  type WaveTaskMetadata,
  validate,
} from "./schemas.js";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { canonicalJson, type JsonValue } from "./canonical.js";
import { sha256 } from "./evidence.js";
import { canEnterTerminalIntent } from "./guards.js";

const utf8 = new TextEncoder();

export type ProtocolEffect = RuntimeEffect;
export type Reduction =
  | {
      readonly ok: true;
      readonly nextState: RepositoryRun;
      readonly effects: readonly ProtocolEffect[];
    }
  | {
      readonly ok: false;
      readonly code:
        | "invalid_state"
        | "invalid_event"
        | "stale_revision"
        | "duplicate_event"
        | "illegal_transition"
        | "invariant";
      readonly reason: string;
    };

/**
 * Pure CAS reducer. Persistence of nextState (including every intended journal
 * entry) precedes execution of the returned runtime effects.
 */
export function reduce(
  stateInput: RepositoryRun,
  eventInput: ProtocolEvent,
): Reduction {
  return reduceInternal(stateInput, eventInput);
}

/** Pins one tested harness family/mapping before any session effect is durable. */
function reduceHarnessConfiguration(
  state: RepositoryRun,
  event: Extract<ProtocolEvent, { type: "harness_configured" }>,
): Reduction {
  if (state.state !== "active" || state.controller.state !== "acquired")
    return reject(
      "illegal_transition",
      "controller ownership has not been acquired",
    );
  if (
    state.harness !== undefined ||
    state.activeModifyingUnitIds.length !== 0 ||
    state.currentReviewerUnitId !== undefined ||
    state.effectJournal.some(
      (entry) =>
        entry.status !== "observed" &&
        ["dispatch", "repair", "review_dispatch"].includes(entry.kind),
    )
  )
    return reject(
      "illegal_transition",
      "harness configuration is immutable once session work begins",
    );
  return commit({ ...state, harness: event.configuration }, event, []);
}
function hasHarnessConfiguration(
  state: RepositoryRun,
): state is RepositoryRun & { readonly harness: HarnessConfiguration } {
  return state.harness !== undefined;
}

/**
 * Commits the exact UTF-8 diff bytes observed for a candidate. This is
 * deliberately distinct from packet and observation hashes: a reviewer must
 * see precisely the candidate diff that the controller collected.
 */
export function deriveCandidateDiffHash(diff: string): string {
  return sha256(`sce.protocol.candidate-diff/v1\n${diff}`);
}

function committedTaskMetadataError(unit: Unit): string | undefined {
  if (unit.taskMetadata === undefined)
    return "lacks committed wave task metadata";
  if (unit.taskMetadata.unitId !== unit.id)
    return "has committed wave task metadata for a different unit";
  return undefined;
}

function committedVerificationError(unit: Unit): string | undefined {
  const metadataError = committedTaskMetadataError(unit);
  if (metadataError !== undefined) return metadataError;
  if (
    unit.verificationCommands === undefined ||
    unit.verificationCommands.length === 0
  )
    return "lacks committed mandatory verification commands";
  if (
    !sameStringArray(
      unit.verificationCommands,
      unit.taskMetadata!.mandatoryVerification,
    )
  )
    return "verification commands do not match committed wave task metadata";
  return undefined;
}

/** Packet bytes are a launch input, not controller-authored narrative. */
function launchPacketError(
  packet: HarnessPacketBinding,
  unit: Unit,
  role: "reviewer" | "worker",
): string | undefined {
  try {
    const decoded = JSON.parse(packet.payload) as unknown;
    const parsed = validate<HarnessPacket>(HarnessPacketSchema, decoded);
    if (!parsed.ok || parsed.value === undefined)
      return "launch packet has invalid schema";
    if (
      canonicalJson(parsed.value as JsonValue) !== packet.payload ||
      sha256(`sce.harness-packet/v1\n${packet.payload}`) !== packet.hash
    )
      return "launch packet payload/hash mismatch";
    const value = parsed.value;
    if (
      value.role !== role ||
      value.unitId !== unit.id ||
      value.baseOid !== unit.baseOid
    )
      return "launch packet is not bound to the exact unit/base/role";
    const metadataError = committedTaskMetadataError(unit);
    if (metadataError !== undefined) return `launch packet ${metadataError}`;
    const taskMetadata = unit.taskMetadata;
    if (taskMetadata === undefined)
      return "launch packet lacks committed wave task metadata";
    if (
      taskMetadata.unitId !== unit.id ||
      !sameStringArray(value.acceptance, taskMetadata.acceptanceIds) ||
      !sameStringArray(value.ownedPaths, taskMetadata.ownedPaths) ||
      !sameStringArray(
        value.mandatoryVerification,
        taskMetadata.mandatoryVerification,
      )
    )
      return "launch packet does not bind committed wave task metadata";
    if (role === "reviewer") {
      if (
        value.role !== "reviewer" ||
        value.headOid !== unit.candidateHead ||
        unit.candidateHead === undefined ||
        unit.candidateTree === undefined ||
        unit.candidateDiffHash === undefined ||
        deriveCandidateDiffHash(value.diff) !== unit.candidateDiffHash
      )
        return "review packet is not bound to the exact candidate diff";
    }
    return undefined;
  } catch {
    return "launch packet cannot be parsed";
  }
}

/**
 * Wave membership is durable aggregate state, while task metadata is an
 * exact controller input from Beads. The planner is conservative by design:
 * any unclear independence produces the first deterministic singleton.
 */
function reduceWavePlan(
  state: RepositoryRun,
  event: Extract<ProtocolEvent, { type: "wave_planned" }>,
): Reduction {
  if (state.state !== "active" || state.controller.state !== "acquired")
    return reject(
      "illegal_transition",
      "controller ownership has not been acquired",
    );
  if (
    state.wave.unitIds.length !== 0 ||
    state.activeModifyingUnitIds.length !== 0 ||
    state.qualificationOwnerUnitId !== undefined ||
    state.integrationOwnerUnitId !== undefined ||
    state.currentReviewerUnitId !== undefined ||
    state.qualificationQueue.length !== 0 ||
    state.integrationQueue.length !== 0 ||
    state.effectJournal.some(
      (entry) => entry.status === "intended" || entry.status === "ambiguous",
    )
  )
    return reject("illegal_transition", "prior wave has not drained");
  if (Object.values(state.units).some((unit) => unit.state !== "planned"))
    return reject(
      "illegal_transition",
      "only planned units may form a new wave",
    );
  const selected = selectWaveUnits(state, event.tasks);
  if (!selected.ok) return reject("invalid_event", selected.reason);
  const metadata = event.tasks.map(canonicalTaskMetadata);
  if (!metadataFitsEnvelope(metadata))
    return reject(
      "invalid_event",
      "wave task metadata exceeds durable envelope",
    );
  const byUnitId = new Map(metadata.map((task) => [task.unitId, task]));
  return commit(
    {
      ...state,
      units: Object.fromEntries(
        Object.entries(state.units).map(([unitId, unit]) => [
          unitId,
          { ...unit, taskMetadata: byUnitId.get(unitId)! },
        ]),
      ),
      wave: { id: event.waveId, unitIds: [...selected.value] },
    },
    event,
    [],
  );
}

function canonicalTaskMetadata(task: WaveTaskMetadata): WaveTaskMetadata {
  return {
    ...task,
    acceptanceIds: sortedStrings(task.acceptanceIds),
    conflictDomains: sortedStrings(task.conflictDomains),
    dependencies: sortedStrings(task.dependencies),
    mandatoryVerification: sortedStrings(task.mandatoryVerification),
    ownedPaths: sortedStrings(task.ownedPaths),
    reservations: sortedStrings(task.reservations),
  };
}

function metadataFitsEnvelope(metadata: readonly WaveTaskMetadata[]): boolean {
  try {
    // Leave half of the aggregate envelope for durable lifecycle evidence,
    // journal records, and future task waves; the full aggregate invariant
    // remains the final guard.
    return (
      utf8.encode(canonicalJson(metadata as unknown as JsonValue)).byteLength <=
      LIMITS.envelopeBytes / 2
    );
  } catch {
    return false;
  }
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function selectWaveUnits(
  state: RepositoryRun,
  metadata: readonly WaveTaskMetadata[],
):
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly reason: string } {
  if (
    metadata.length !== Object.keys(state.units).length ||
    new Set(metadata.map((task) => task.unitId)).size !== metadata.length ||
    metadata.some((task) => state.units[task.unitId] === undefined)
  )
    return {
      ok: false,
      reason: "wave metadata must cover every remaining unit exactly once",
    };
  const byId = new Map(metadata.map((task) => [task.unitId, task]));
  if (
    metadata.some(
      (task) =>
        task.dependencies.some(
          (dependency) => byId.get(dependency) === undefined,
        ) ||
        task.dependencies.includes(task.unitId) ||
        task.ownedPaths.some((path) => !validOwnedPath(path)),
    )
  )
    return {
      ok: false,
      reason: "wave metadata has unknown dependency or invalid owned path",
    };
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number | undefined => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return undefined;
    visiting.add(id);
    const task = byId.get(id)!;
    let current = 0;
    for (const dependency of task.dependencies) {
      const found = visit(dependency);
      if (found === undefined) {
        visiting.delete(id);
        return undefined;
      }
      current = Math.max(current, found + 1);
    }
    visiting.delete(id);
    depth.set(id, current);
    return current;
  };
  if (metadata.some((task) => visit(task.unitId) === undefined))
    return { ok: false, reason: "wave dependency graph contains a cycle" };
  const ordered = metadata
    .filter((task) => task.dependencies.length === 0)
    .sort(
      (left, right) =>
        depth.get(left.unitId)! - depth.get(right.unitId)! ||
        riskOrder(left.risk) - riskOrder(right.risk) ||
        left.priority - right.priority ||
        left.unitId.localeCompare(right.unitId),
    );
  const first = ordered[0];
  if (first === undefined)
    return { ok: false, reason: "wave has no dependency-ready unit" };
  // Unknown independence is not silently skipped in favour of a larger
  // fanout. The next deterministic wave is a singleton until its metadata
  // can be made explicit.
  if (ordered.some((task) => task.independence !== "proven"))
    return { ok: true, value: [first.unitId] };
  const selected = [first];
  for (const candidate of ordered.slice(1)) {
    if (
      candidate.independence !== "proven" ||
      selected.some((other) => taskConflict(other, candidate))
    )
      continue;
    selected.push(candidate);
    if (selected.length === 3) break;
  }
  return { ok: true, value: selected.map((task) => task.unitId) };
}
function validOwnedPath(path: string): boolean {
  return (
    path.length > 0 &&
    path !== "." &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    !path.includes("//") &&
    !path.includes("\\") &&
    !/^[A-Za-z]:/u.test(path) &&
    path.split("/").every((part) => part !== "." && part !== "..")
  );
}
function riskOrder(value: WaveTaskMetadata["risk"]): number {
  return { critical: 0, high: 1, low: 3, medium: 2 }[value];
}
function taskConflict(
  left: WaveTaskMetadata,
  right: WaveTaskMetadata,
): boolean {
  return (
    left.acceptanceIds.some((acceptance) =>
      right.acceptanceIds.includes(acceptance),
    ) ||
    left.conflictDomains.some((domain) =>
      right.conflictDomains.includes(domain),
    ) ||
    left.reservations.some((reservation) =>
      right.reservations.includes(reservation),
    ) ||
    left.ownedPaths.some((path) =>
      right.ownedPaths.some(
        (other) =>
          path === other ||
          path.startsWith(`${other}/`) ||
          other.startsWith(`${path}/`),
      ),
    )
  );
}

/**
 * `reconcilingBlockedObservation` is only used after the outer reduction has
 * validated a durable blocked aggregate and prepared one exact observation.
 * That preparation is deliberately transient: it restores the affected
 * unit's intent state so the ordinary observation transition remains the one
 * place that advances lifecycle facts.
 */
function reduceInternal(
  stateInput: RepositoryRun,
  eventInput: ProtocolEvent,
  reconcilingBlockedObservation = false,
): Reduction {
  const parsedState = validate<RepositoryRun>(RepositoryRunSchema, stateInput);
  if (!parsedState.ok || parsedState.value === undefined)
    return reject("invalid_state", parsedState.errors.join("; "));
  const parsedEvent = validate<ProtocolEvent>(ProtocolEventSchema, eventInput);
  if (!parsedEvent.ok || parsedEvent.value === undefined)
    return reject("invalid_event", parsedEvent.errors.join("; "));
  const state = parsedState.value;
  const event = parsedEvent.value;
  if (!reconcilingBlockedObservation) {
    const errors = runInvariantErrors(state);
    if (errors.length) return reject("invariant", errors.join("; "));
  }
  if (event.expectedRevision !== state.revision)
    return reject(
      "stale_revision",
      "expected aggregate revision does not match",
    );
  if (state.processedEventIds.includes(event.eventId))
    return reject("duplicate_event", "event id has already been applied");
  if (
    "idempotencyKey" in event &&
    state.processedIdempotencyKeys.includes(event.idempotencyKey)
  )
    return reject(
      "duplicate_event",
      "idempotency key has already been applied",
    );
  const declaredIntentKind = effectKindForIntent(event.type);
  if (
    declaredIntentKind !== undefined &&
    "idempotencyKey" in event &&
    event.idempotencyKey !==
      deriveIdempotencyKey(
        state,
        event.expectedRevision,
        "unitId" in event ? event.unitId : null,
        declaredIntentKind,
      )
  )
    return reject(
      "invalid_event",
      "idempotency key is not deterministic for this run, revision, unit, and effect",
    );
  if (event.type === "wave_planned") return reduceWavePlan(state, event);
  if (event.type === "harness_configured")
    return reduceHarnessConfiguration(state, event);

  if (
    event.type === "controller_acquire_intent" ||
    event.type === "controller_acquired" ||
    event.type === "controller_release_intent" ||
    event.type === "controller_released"
  )
    return reduceController(state, event);
  if (state.state === "released")
    return reject("illegal_transition", `aggregate is ${state.state}`);
  if (event.type === "effect_ambiguous") {
    const blocked = markEffectAmbiguous(state, event);
    return blocked === undefined
      ? badObservation()
      : commit(blocked, event, []);
  }
  if (state.state === "blocked" && !reconcilingBlockedObservation) {
    const recovered = prepareBlockedUnitObservation(state, event);
    if (recovered === undefined)
      return reject("illegal_transition", "aggregate is blocked");
    return reduceInternal(recovered, event, true);
  }
  if (state.controller.state !== "acquired")
    return reject(
      "illegal_transition",
      "controller ownership has not been acquired",
    );
  if (event.unitId === null)
    return reject("illegal_transition", "unit event requires a unit id");
  const unit = state.units[event.unitId];
  if (unit === undefined) return reject("illegal_transition", "unknown unit");
  if (!state.wave.unitIds.includes(unit.id))
    return reject("illegal_transition", "unit is not in the current wave");
  const emittedKind = effectKindForIntent(event.type);
  if (emittedKind !== undefined && hasUnresolvedUnitEffect(state, unit.id))
    return reject(
      "illegal_transition",
      "unit already has an unresolved intended or ambiguous effect",
    );
  if (emittedKind !== undefined && !effectAllowed(state, emittedKind))
    return reject(
      "illegal_transition",
      `authority profile forbids ${emittedKind}`,
    );

  let result: Step | undefined;
  switch (event.type) {
    case "reservation_intent":
      if (unit.state !== "planned") return illegal(unit, event.type);
      if (
        event.reservations.some((r) => state.reservations[r.id] !== undefined)
      )
        return reject("invariant", "reservation id is already owned");
      if (
        new Set(event.reservations.map((r) => `${r.namespace}/${r.resource}`))
          .size !== event.reservations.length
      )
        return reject("invariant", "reservation request collides with itself");
      if (
        Object.values(state.reservations).some(
          (r) =>
            r.state !== "released" &&
            event.reservations.some(
              (next) =>
                next.namespace === r.namespace && next.resource === r.resource,
            ),
        )
      )
        return reject("invariant", "reservation resource is already occupied");
      result = intent(
        state,
        unit,
        "reservation_intent",
        event,
        "reservation_acquire",
        {
          reservations: {
            ...state.reservations,
            ...Object.fromEntries(
              event.reservations.map((r) => [
                r.id,
                { ...r, unitId: unit.id, state: "intended" as const },
              ]),
            ),
          },
          units: replaceUnit(state, {
            ...unit,
            reservationIds: event.reservations.map((r) => r.id),
          }),
        },
      );
      break;
    case "reservation_observed":
      if (unit.state !== "reservation_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "reservation_acquire"))
        return badObservation();
      result = observe(
        state,
        unit,
        "resources_reserved",
        event,
        {},
        {
          reservations: updateReservations(
            state,
            unit.id,
            "reserved",
            event.effectId,
          ),
        },
      );
      break;
    case "branch_intent":
      if (unit.state !== "resources_reserved") return illegal(unit, event.type);
      result = intent(state, unit, "branch_intent", event, "branch_create", {
        units: replaceUnit(state, { ...unit, branchRef: event.branchRef }),
      });
      break;
    case "branch_observed":
      if (unit.state !== "branch_intent" || unit.branchRef !== event.branchRef)
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "branch_create"))
        return badObservation();
      result = observe(state, unit, "branch_observed", event);
      break;
    case "worktree_intent":
      if (unit.state !== "branch_observed") return illegal(unit, event.type);
      result = intent(
        state,
        unit,
        "worktree_intent",
        event,
        "worktree_create",
        {
          units: replaceUnit(state, {
            ...unit,
            worktreePath: event.worktreePath,
          }),
        },
      );
      break;
    case "worktree_observed":
      if (
        unit.state !== "worktree_intent" ||
        unit.worktreePath !== event.worktreePath
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "worktree_create"))
        return badObservation();
      result = observe(state, unit, "worktree_observed", event);
      break;
    case "dispatch_intent":
      if (unit.state !== "worktree_observed") return illegal(unit, event.type);
      if (!hasHarnessConfiguration(state))
        return reject(
          "illegal_transition",
          "harness must be configured before dispatch",
        );
      const dispatchPacketError = launchPacketError(
        event.packet,
        unit,
        "worker",
      );
      if (dispatchPacketError !== undefined)
        return reject("invalid_event", dispatchPacketError);
      if (event.promptHash !== event.packet.hash)
        return reject(
          "invalid_event",
          "launch prompt hash must equal packet hash",
        );
      if (state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      result = modifyingIntent(
        state,
        unit,
        "dispatch_intent",
        event,
        "dispatch",
        {
          workerRequestedModel: event.requestedModel,
          workerPromptHash: event.promptHash,
          workerPacket: event.packet,
        },
      );
      break;
    case "dispatch_observed":
      const dispatchedSession = freshSessionUpdate(
        state,
        event.sessionId,
        unit,
        "worker",
      );
      if (
        unit.state !== "dispatch_intent" ||
        event.requestedModel !== unit.workerRequestedModel ||
        event.promptHash !== unit.workerPromptHash ||
        dispatchedSession === undefined
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "dispatch"))
        return badObservation();
      result = observe(
        state,
        unit,
        "dispatched",
        event,
        workerSession(event),
        dispatchedSession,
      );
      break;
    case "collect_intent":
      if (unit.state !== "dispatched") return illegal(unit, event.type);
      if (!hasHarnessConfiguration(state))
        return reject(
          "illegal_transition",
          "harness must be configured before collection",
        );
      result = intent(state, unit, "collect_intent", event, "worker_collect");
      break;
    case "worker_collected":
      if (unit.state !== "collect_intent") return illegal(unit, event.type);
      if (
        event.sessionId !== unit.workerSessionId ||
        event.requestedModel !== unit.workerRequestedModel ||
        event.returnedModel !== unit.workerReturnedModel ||
        event.promptHash !== unit.workerPromptHash
      )
        return reject(
          "illegal_transition",
          "worker collection is not bound to the dispatched session identity",
        );
      if (!matchesIntended(state, event, unit.id, "worker_collect"))
        return badObservation();
      result =
        event.workerResult.status === "failed"
          ? observe(
              state,
              unit,
              "failed",
              event,
              {
                workerResult: event.workerResult,
                repairContext: {
                  baseOid: unit.baseOid,
                  responseHash: event.observationHash,
                  rationale: event.workerResult.summary,
                  findings: [
                    {
                      id: "worker-failed",
                      severity: "blocking",
                      detail: event.workerResult.summary,
                    },
                  ],
                },
              },
              clearUnitOwners(state, unit.id),
            )
          : event.workerResult.status === "needs_repair"
            ? observe(
                state,
                unit,
                "repair_required",
                event,
                {
                  workerResult: event.workerResult,
                  repairContext: {
                    baseOid: unit.baseOid,
                    responseHash: event.observationHash,
                    rationale: event.workerResult.summary,
                    findings: [
                      {
                        id: "worker-needs-repair",
                        severity: "blocking",
                        detail: event.workerResult.summary,
                      },
                    ],
                  },
                },
                clearUnitOwners(state, unit.id),
              )
            : observe(
                state,
                unit,
                "collected",
                event,
                { workerResult: event.workerResult },
                {
                  activeModifyingUnitIds: state.activeModifyingUnitIds.filter(
                    (id) => id !== unit.id,
                  ),
                },
              );
      if (event.workerResult.status === "failed")
        result = persistTerminalClosureEvidence(result, unit.id);
      break;
    case "candidate_intent":
      if (unit.state !== "collected") return illegal(unit, event.type);
      result = intent(
        state,
        unit,
        "candidate_intent",
        event,
        "candidate_collect",
      );
      break;
    case "candidate_observed":
      if (unit.state !== "candidate_intent") return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "candidate_collect"))
        return badObservation();
      result = observe(
        state,
        unit,
        "candidate_committed",
        event,
        {
          candidateHead: event.headOid,
          candidateTree: event.treeOid,
          candidateDiffHash: event.candidateDiffHash,
        },
        { qualificationQueue: insertSorted(state.qualificationQueue, unit.id) },
      );
      break;
    case "verification_intent":
      if (unit.state !== "candidate_committed")
        return illegal(unit, event.type);
      if (unit.taskMetadata === undefined)
        return reject(
          "invalid_event",
          "verification lacks committed wave task metadata",
        );
      if (
        unit.taskMetadata.unitId !== unit.id ||
        !sameStringArray(
          event.commands,
          unit.taskMetadata.mandatoryVerification,
        )
      )
        return reject(
          "invalid_event",
          "verification commands do not bind committed wave task metadata",
        );
      if (
        state.qualificationOwnerUnitId !== undefined &&
        state.qualificationOwnerUnitId !== unit.id
      )
        return reject(
          "invariant",
          "final qualification is owned by another unit",
        );
      if (state.qualificationQueue[0] !== unit.id)
        return reject(
          "invariant",
          "unit is not first in deterministic qualification queue",
        );
      result = intent(state, unit, "verification_intent", event, "verify", {
        qualificationOwnerUnitId: unit.id,
        units: replaceUnit(state, {
          ...unit,
          verificationCommands: [...event.commands],
        }),
      });
      break;
    case "verification_observed":
      if (
        unit.state !== "verification_intent" ||
        state.qualificationOwnerUnitId !== unit.id ||
        unit.baseOid !== event.baseOid ||
        unit.candidateHead !== event.headOid ||
        unit.candidateTree !== event.treeOid
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "verify"))
        return badObservation();
      result = observe(state, unit, "qualified", event, {
        verificationBaseOid: unit.baseOid,
        verificationHeadOid: event.headOid,
        verificationTree: event.treeOid,
        verificationEvidenceHash: event.observationHash,
      });
      break;
    case "reviewer_dispatch_intent":
      if (
        unit.state !== "qualified" ||
        state.qualificationOwnerUnitId !== unit.id ||
        state.currentReviewerUnitId !== undefined
      )
        return illegal(unit, event.type);
      if (!hasHarnessConfiguration(state))
        return reject(
          "illegal_transition",
          "harness must be configured before review",
        );
      const reviewerPacketError = launchPacketError(
        event.packet,
        unit,
        "reviewer",
      );
      if (reviewerPacketError !== undefined)
        return reject("invalid_event", reviewerPacketError);
      if (event.promptHash !== event.packet.hash)
        return reject(
          "invalid_event",
          "launch prompt hash must equal packet hash",
        );
      result = intent(
        state,
        unit,
        "reviewer_dispatch_intent",
        event,
        "review_dispatch",
        {
          currentReviewerUnitId: unit.id,
          units: replaceUnit(state, {
            ...unit,
            reviewerRequestedModel: event.requestedModel,
            reviewPromptHash: event.promptHash,
            reviewerPacket: event.packet,
          }),
        },
      );
      break;
    case "reviewer_observed":
      const reviewerSessionUpdate = freshSessionUpdate(
        state,
        event.sessionId,
        unit,
        "reviewer",
      );
      if (
        unit.state !== "reviewer_dispatch_intent" ||
        state.currentReviewerUnitId !== unit.id ||
        event.requestedModel !== unit.reviewerRequestedModel ||
        event.promptHash !== unit.reviewPromptHash ||
        reviewerSessionUpdate === undefined
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "review_dispatch"))
        return badObservation();
      result = observe(
        state,
        unit,
        "reviewer_dispatched",
        event,
        reviewerSession(event),
        reviewerSessionUpdate,
      );
      break;
    case "review_collect_intent":
      if (
        unit.state !== "reviewer_dispatched" ||
        state.currentReviewerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      if (!hasHarnessConfiguration(state))
        return reject(
          "illegal_transition",
          "harness must be configured before review collection",
        );
      result = intent(
        state,
        unit,
        "review_collect_intent",
        event,
        "review_collect",
      );
      break;
    case "review_collected": {
      if (
        unit.state !== "review_collect_intent" ||
        state.currentReviewerUnitId !== unit.id
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "review_collect"))
        return badObservation();
      const judgmentError = reviewJudgmentError(
        unit,
        event.judgment,
        state.revision,
      );
      if (judgmentError !== undefined)
        return reject("illegal_transition", judgmentError);
      if (event.judgment.decision === "request_changes") {
        if (
          !event.judgment.findings.some(
            (finding) => finding.severity === "blocking",
          )
        )
          return reject(
            "illegal_transition",
            "request_changes requires a blocking finding",
          );
        result = observe(
          state,
          unit,
          "repair_required",
          event,
          {
            repairContext: {
              baseOid: event.judgment.baseOid,
              headOid: event.judgment.headOid,
              treeOid: event.judgment.treeOid,
              responseHash: event.judgment.responseHash,
              rationale: event.judgment.rationale,
              findings: event.judgment.findings,
            },
          },
          clearUnitOwners(state, unit.id),
        );
      } else {
        result = observe(
          state,
          unit,
          "approved",
          event,
          {
            reviewBaseOid: event.judgment.baseOid,
            reviewHeadOid: event.judgment.headOid,
            reviewTree: event.judgment.treeOid,
            approvalResponseHash: event.judgment.responseHash,
          },
          {
            currentReviewerUnitId: null,
            integrationQueue: insertSorted(state.integrationQueue, unit.id),
          },
        );
      }
      break;
    }
    case "publish_intent":
      if (
        !isCurrentApproval(unit) ||
        state.qualificationOwnerUnitId !== unit.id ||
        publicationKind(state) === undefined
      )
        return illegal(unit, event.type);
      result = intent(state, unit, "publish_intent", event, "publish");
      break;
    case "publish_observed":
      if (
        unit.state !== "publish_intent" ||
        (event.publication.kind === "push_branch"
          ? unit.candidateHead !== event.publication.remoteHeadOid
          : unit.candidateHead !== event.publication.pullRequest.remoteHeadOid)
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "publish"))
        return badObservation();
      if (publicationKind(state) === "open_pr") {
        if (
          event.publication.kind !== "open_pr" ||
          event.publication.pullRequest.baseRef !== state.integrationBranch ||
          event.publication.pullRequest.baseOid !== unit.reviewBaseOid
        )
          return reject(
            "illegal_transition",
            "open-pr publication lacks the reviewed open pull-request identity and base",
          );
      } else if (event.publication.kind !== "push_branch")
        return reject(
          "illegal_transition",
          "branch publication must record a push-branch readback",
        );
      const publishedHeadOid =
        event.publication.kind === "open_pr"
          ? event.publication.pullRequest.remoteHeadOid
          : event.publication.remoteHeadOid;
      result = observe(
        state,
        unit,
        isPublicationHandoff(state) ? "handoff" : "published",
        event,
        {
          publishedHeadOid,
          ...(event.publication.kind === "open_pr"
            ? { openPullRequest: event.publication.pullRequest }
            : {}),
        },
        isPublicationHandoff(state) ? clearUnitOwners(state, unit.id) : {},
      );
      if (isPublicationHandoff(state))
        result = persistTerminalClosureEvidence(result, unit.id);
      break;
    case "integrate_intent":
      if (
        !canIntegrateFrom(state, unit) ||
        !hasCurrentApproval(unit) ||
        state.qualificationOwnerUnitId !== unit.id ||
        (state.integrationOwnerUnitId !== undefined &&
          state.integrationOwnerUnitId !== unit.id)
      )
        return illegal(unit, event.type);
      if (state.integrationQueue[0] !== unit.id)
        return reject(
          "invariant",
          "unit is not first in deterministic integration queue",
        );
      result = intent(state, unit, "integrate_intent", event, "integrate", {
        integrationOwnerUnitId: unit.id,
      });
      break;
    case "integrate_observed":
      if (
        unit.state !== "integrate_intent" ||
        state.integrationOwnerUnitId !== unit.id ||
        event.controllerFencingToken !== state.controllerFencingToken ||
        event.baseOid !== unit.reviewBaseOid ||
        event.headOid !== unit.reviewHeadOid ||
        event.treeOid !== unit.reviewTree
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "integrate"))
        return badObservation();
      result = observe(
        state,
        unit,
        "landed",
        event,
        { landedOid: event.integrationOid },
        {
          qualificationOwnerUnitId: null,
          integrationOwnerUnitId: null,
          qualificationQueue: state.qualificationQueue.filter(
            (id) => id !== unit.id,
          ),
          integrationQueue: state.integrationQueue.filter(
            (id) => id !== unit.id,
          ),
        },
      );
      result = persistTerminalClosureEvidence(result, unit.id);
      break;
    case "reservation_release_intent":
      if (
        ![
          "landed",
          "handoff",
          "cancelled",
          "parked",
          "failed",
          "timed_out",
        ].includes(unit.state)
      )
        return illegal(unit, event.type);
      result = intent(
        state,
        unit,
        "reservation_release_intent",
        event,
        "reservation_release",
        { reservations: updateReservations(state, unit.id, "release_intent") },
      );
      result = {
        ...result,
        state: {
          ...result.state,
          closedUnitEvidence: updateClosureReleaseEvidence(
            result.state,
            unit.id,
          ),
        },
      };
      break;
    case "reservation_released":
      if (unit.state !== "reservation_release_intent")
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "reservation_release"))
        return badObservation();
      result = observe(
        state,
        unit,
        "closed",
        event,
        {},
        {
          reservations: updateReservations(
            state,
            unit.id,
            "released",
            event.effectId,
          ),
        },
      );
      result = {
        ...result,
        state: closeUnitAfterRelease(result.state, unit.id),
      };
      break;
    case "repair_intent":
      if (
        unit.state !== "repair_required" &&
        unit.state !== "failed" &&
        unit.state !== "timed_out"
      )
        return illegal(unit, event.type);
      if (!validRepairJudgment(state, unit, event.judgment, state.revision))
        return reject(
          "illegal_transition",
          "repair judgment is not bound to this unit and revision",
        );
      if (!hasHarnessConfiguration(state))
        return reject(
          "illegal_transition",
          "harness must be configured before repair",
        );
      const repairPacketError = launchPacketError(event.packet, unit, "worker");
      if (repairPacketError !== undefined)
        return reject("invalid_event", repairPacketError);
      if (event.promptHash !== event.packet.hash)
        return reject(
          "invalid_event",
          "launch prompt hash must equal packet hash",
        );
      if (unit.branchRef === undefined || unit.worktreePath === undefined)
        return reject(
          "illegal_transition",
          "repair requires the retained branch and worktree bindings",
        );
      if (unit.repairCount >= 16 || state.activeModifyingUnitIds.length >= 3)
        return reject("invariant", "all three modifying slots are occupied");
      result = modifyingIntent(state, unit, "repair_intent", event, "repair", {
        workerRequestedModel: event.requestedModel,
        workerPromptHash: event.promptHash,
        workerPacket: event.packet,
      });
      result = {
        ...result,
        state: removeClosureEvidence(result.state, unit.id),
      };
      break;
    case "repair_observed":
      const repairedSession = freshSessionUpdate(
        state,
        event.sessionId,
        unit,
        "worker",
      );
      if (
        unit.state !== "repair_intent" ||
        event.requestedModel !== unit.workerRequestedModel ||
        event.promptHash !== unit.workerPromptHash ||
        repairedSession === undefined
      )
        return illegal(unit, event.type);
      if (!matchesIntended(state, event, unit.id, "repair"))
        return badObservation();
      result = observe(
        state,
        unit,
        "dispatched",
        event,
        {
          ...workerSession(event),
          repairCount: unit.repairCount + 1,
        },
        repairedSession,
      );
      break;
    case "failure_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result = terminalIntent(state, unit, "failure_intent", event, "failure");
      break;
    case "failure_observed":
      if (
        unit.state !== "failure_intent" ||
        !matchesIntended(state, event, unit.id, "failure")
      )
        return illegal(unit, event.type);
      result = observe(
        state,
        unit,
        "failed",
        event,
        failureRepairContext(unit, event.observationHash, "failure observed"),
        clearUnitOwners(state, unit.id),
      );
      result = persistTerminalClosureEvidence(result, unit.id);
      break;
    case "timeout_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result = terminalIntent(state, unit, "timeout_intent", event, "timeout");
      break;
    case "timeout_observed":
      if (
        unit.state !== "timeout_intent" ||
        !matchesIntended(state, event, unit.id, "timeout")
      )
        return illegal(unit, event.type);
      result = observe(
        state,
        unit,
        "timed_out",
        event,
        failureRepairContext(unit, event.observationHash, "timeout observed"),
        clearUnitOwners(state, unit.id),
      );
      result = persistTerminalClosureEvidence(result, unit.id);
      break;
    case "park_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      result = terminalIntent(state, unit, "park_intent", event, "park");
      break;
    case "park_observed":
      if (
        unit.state !== "park_intent" ||
        !matchesIntended(state, event, unit.id, "park")
      )
        return illegal(unit, event.type);
      result = observe(
        state,
        unit,
        "parked",
        event,
        {},
        clearUnitOwners(state, unit.id),
      );
      result = persistTerminalClosureEvidence(result, unit.id);
      break;
    case "cancel_intent":
      if (!canEnterTerminalIntent(unit.state)) return illegal(unit, event.type);
      if (
        (state.activeModifyingUnitIds.includes(unit.id) ||
          state.currentReviewerUnitId === unit.id) &&
        !hasHarnessConfiguration(state)
      )
        return reject(
          "illegal_transition",
          "harness must be configured before session cancellation",
        );
      result = terminalIntent(state, unit, "cancel_intent", event, "cancel");
      break;
    case "cancel_observed":
      if (
        unit.state !== "cancel_intent" ||
        !matchesIntended(state, event, unit.id, "cancel")
      )
        return illegal(unit, event.type);
      if (!matchesTerminalSession(state, unit, event))
        return reject(
          "illegal_transition",
          "cancellation is not bound to the active session readback",
        );
      result = observe(
        state,
        unit,
        "cancelled",
        event,
        {},
        clearUnitOwners(state, unit.id),
      );
      result = persistTerminalClosureEvidence(result, unit.id);
      break;
    default:
      return exhaustive(event);
  }
  return result === undefined
    ? reject("illegal_transition", "event was not handled")
    : commit(result.state, event, result.effects);
}

type Step = {
  readonly state: RepositoryRun;
  readonly effects: readonly ProtocolEffect[];
};
type IntentEvent = Extract<ProtocolEvent, { idempotencyKey: string }>;
type ObservedEvent = Extract<
  ProtocolEvent,
  { effectId: string; effectKind: EffectKind; observationHash: string }
>;
function effectKindForIntent(
  type: ProtocolEvent["type"],
): EffectKind | undefined {
  const kinds: Partial<Record<ProtocolEvent["type"], EffectKind>> = {
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
  return kinds[type];
}
export function deriveIdempotencyKey(
  state: Pick<RepositoryRun, "controller">,
  expectedRevision: number,
  unitId: string | null,
  kind: EffectKind,
): string {
  // The provider only sees a domain-separated digest: no repository identity,
  // prompt, or other raw aggregate payload is exposed. Canonical JSON binds
  // every identity component exactly, including null controller scope.
  return `sce:${sha256(
    canonicalJson({
      domain: "sce.protocol.idempotency.v1",
      effectKind: kind,
      expectedRevision,
      incarnationId: state.controller.incarnationId,
      runId: state.controller.runId,
      unitId,
    }),
  )}`;
}

/**
 * Audit-bind an executable effect's exact typed parameters. Intent callers do
 * not supply this value: it is derived only after the reducer has produced the
 * effect that an adapter may execute.
 */
export function deriveParamsHash(
  kind: EffectKind,
  params: RuntimeEffect["params"],
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.effect-params.v1",
      effectKind: kind,
      params,
      schemaVersion: SCHEMA_VERSION,
    }),
  );
}

/**
 * Reconstruct the exact executable request from an authoritative intended
 * journal entry and its same-revision aggregate.  This is used only during
 * recovery; the derived params hash must equal the durable journal binding.
 * It is deliberately not an adapter-facing escape hatch.
 */
export function rehydrateEffect(
  state: RepositoryRun,
  entry: EffectJournalEntry,
): ProtocolEffect | undefined {
  try {
    if (entry.intentCommitment !== deriveIntentCommitment(entry))
      return undefined;
    const params = runtimeEffectParams(
      state,
      entry.unitId,
      entry.kind,
      entry.slotTransition,
    ) as RuntimeEffect["params"];
    if (deriveParamsHash(entry.kind, params) !== entry.paramsHash)
      return undefined;
    const effect: ProtocolEffect = {
      effectId: entry.effectId,
      idempotencyKey: entry.idempotencyKey,
      kind: entry.kind,
      params,
      paramsHash: entry.paramsHash,
      schemaVersion: SCHEMA_VERSION,
      unitId: entry.unitId,
    } as ProtocolEffect;
    const checked = validate<RuntimeEffect>(RuntimeEffectSchema, effect);
    return checked.ok && checked.value !== undefined
      ? checked.value
      : undefined;
  } catch {
    return undefined;
  }
}

export function deriveIntentCommitment(
  entry: Pick<
    EffectJournalEntry,
    | "effectId"
    | "unitId"
    | "idempotencyKey"
    | "kind"
    | "intentRevision"
    | "paramsHash"
    | "slotTransition"
    | "schemaVersion"
  >,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.journal-intent.v1",
      effectId: entry.effectId,
      unitId: entry.unitId,
      idempotencyKey: entry.idempotencyKey,
      kind: entry.kind,
      intentRevision: entry.intentRevision,
      paramsHash: entry.paramsHash,
      ...(entry.slotTransition === undefined
        ? {}
        : { slotTransition: entry.slotTransition }),
      schemaVersion: entry.schemaVersion,
    }),
  );
}

function journalEntryCommitment(entry: EffectJournalEntry): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.journal-entry.v1",
      intentCommitment: entry.intentCommitment,
      status: entry.status,
      ...(entry.observationHash === undefined
        ? {}
        : { observationHash: entry.observationHash }),
    }),
  );
}

function foldJournalCommitment(
  previous: string,
  entry: EffectJournalEntry,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.journal-chain.v1",
      previous,
      entry: journalEntryCommitment(entry),
    }),
  );
}

export function deriveJournalCommitment(
  checkpointCommitment: string,
  entries: readonly EffectJournalEntry[],
): string {
  return entries.reduce(
    (commitment, entry) => foldJournalCommitment(commitment, entry),
    checkpointCommitment,
  );
}

export function deriveClosedUnitEvidenceCommitment(encoded: string): string {
  return (
    decodeClosedUnitEvidenceDetails(encoded)?.commitment ??
    invalidClosedUnitEvidenceCommitment()
  );
}

export function deriveRepairContextHash(
  context: NonNullable<Unit["repairContext"]>,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.repair-context.v1",
      baseOid: context.baseOid,
      ...(context.headOid === undefined ? {} : { headOid: context.headOid }),
      ...(context.treeOid === undefined ? {} : { treeOid: context.treeOid }),
      responseHash: context.responseHash,
      rationale: context.rationale,
      findings: context.findings.map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        detail: finding.detail,
      })),
    }),
  );
}

type RepairJudgment = NonNullable<
  Extract<ProtocolEvent, { type: "repair_intent" }>["judgment"]
>;

/** Exact exchange fields the controller knew before producing a disposition. */
function repairJudgmentPromptContent(judgment: RepairJudgment) {
  return {
    schemaVersion: judgment.schemaVersion,
    role: judgment.role,
    kind: judgment.kind,
    unitId: judgment.unitId,
    sessionId: judgment.sessionId,
    requestedModel: judgment.requestedModel,
    returnedModel: judgment.returnedModel,
    aggregateRevision: judgment.aggregateRevision,
    factOid: judgment.factOid,
    currentEvidenceHash: judgment.currentEvidenceHash,
    findingsContextHash: judgment.findingsContextHash,
  };
}

/**
 * The response closes over the exact generated prompt, then adds only the
 * controller's output. `responseHash` itself is intentionally excluded.
 */
function repairJudgmentResponseContent(judgment: RepairJudgment) {
  return {
    ...repairJudgmentPromptContent(judgment),
    promptHash: judgment.promptHash,
    rationale: judgment.rationale,
    decision: judgment.decision,
  };
}

/**
 * A judgment should bind the controller's whole current view, but never make
 * the compressed representation of closed evidence significant. Its semantic
 * commitment is already part of the aggregate and survives a valid alternate
 * deflate encoding.
 */
function repairJudgmentAggregatePacket(state: RepositoryRun) {
  const { closedUnitEvidence: _compressedClosedEvidence, ...aggregate } = state;
  return aggregate;
}

/** Exact controller response content, bound to its generated prompt hash. */
export function deriveRepairJudgmentResponseHash(
  judgment: RepairJudgment,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.repair-judgment-response.v1",
      judgment: repairJudgmentResponseContent(judgment),
    }),
  );
}

/**
 * Controller prompt packet for a repair disposition. It binds the current
 * aggregate, retained unit/context, controller identity, and both model pairs.
 */
export function deriveRepairJudgmentPromptHash(
  state: RepositoryRun,
  unit: Unit,
  judgment: RepairJudgment,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.protocol.repair-judgment-prompt.v1",
      aggregate: repairJudgmentAggregatePacket(state),
      controller: state.controller,
      unit: {
        id: unit.id,
        ordinal: unit.ordinal,
        revision: unit.revision,
        state: unit.state,
        baseOid: unit.baseOid,
        ...(unit.branchRef === undefined ? {} : { branchRef: unit.branchRef }),
        ...(unit.worktreePath === undefined
          ? {}
          : { worktreePath: unit.worktreePath }),
        ...(unit.candidateHead === undefined
          ? {}
          : { candidateHead: unit.candidateHead }),
        ...(unit.candidateTree === undefined
          ? {}
          : { candidateTree: unit.candidateTree }),
        repairCount: unit.repairCount,
        ...(unit.repairContext === undefined
          ? {}
          : { repairContext: unit.repairContext }),
      },
      judgment: repairJudgmentPromptContent(judgment),
    }),
  );
}
function effectAllowed(state: RepositoryRun, kind: EffectKind): boolean {
  if (kind === "publish")
    return (
      (state.completionBoundary === "branch-handoff" &&
        state.authorityProfile !== "local-change-only") ||
      (state.completionBoundary === "pr-handoff" &&
        ["open-pr", "integrate"].includes(state.authorityProfile)) ||
      (state.completionBoundary === "remote-integration" &&
        state.authorityProfile === "integrate")
    );
  if (kind !== "integrate") return true;
  return (
    state.completionBoundary === "local-integration" ||
    (state.completionBoundary === "remote-integration" &&
      state.authorityProfile === "integrate")
  );
}

function isPublicationHandoff(state: RepositoryRun): boolean {
  return (
    state.completionBoundary === "branch-handoff" ||
    state.completionBoundary === "pr-handoff"
  );
}
function canIntegrateFrom(state: RepositoryRun, unit: Unit): boolean {
  return (
    integrationIsRequested(state) &&
    (state.completionBoundary === "local-integration"
      ? unit.state === "approved"
      : unit.state === "published")
  );
}

function integrationIsRequested(state: RepositoryRun): boolean {
  return (
    state.completionBoundary === "local-integration" ||
    state.completionBoundary === "remote-integration"
  );
}

function completionConfigurationError(
  state: RepositoryRun,
): string | undefined {
  switch (state.completionBoundary) {
    case "local-integration":
      return state.integrationProfile === "local-ff"
        ? undefined
        : "local integration requires the local-ff integration profile";
    case "branch-handoff":
      return state.integrationProfile === "none" &&
        state.authorityProfile !== "local-change-only"
        ? undefined
        : "branch handoff requires push-capable authority and integration profile none";
    case "pr-handoff":
      return state.integrationProfile === "none" &&
        ["open-pr", "integrate"].includes(state.authorityProfile)
        ? undefined
        : "pr handoff requires open-pr-capable authority and integration profile none";
    case "remote-integration":
      return state.authorityProfile === "integrate" &&
        state.integrationProfile === "remote-ff"
        ? undefined
        : "remote integration requires integrate authority and a remote integration profile";
  }
}

function publicationKind(
  state: RepositoryRun,
): "push_branch" | "open_pr" | undefined {
  if (state.completionBoundary === "local-integration") return undefined;
  if (state.completionBoundary === "pr-handoff") return "open_pr";
  return "push_branch";
}

function freshSessionUpdate(
  state: RepositoryRun,
  sessionId: string,
  unit: Unit,
  role: "worker" | "reviewer",
):
  | Pick<
      RepositoryRun,
      "sessionLineage" | "sessionLineageRoot" | "usedSessionCount"
    >
  | undefined {
  if (
    state.usedSessionCount >= LIMITS.sessionHistory ||
    controllerIdentityMatches(state, sessionId) ||
    Object.values(state.units).some(
      (unit) =>
        unit.workerSessionId === sessionId ||
        unit.reviewerSessionId === sessionId,
    )
  )
    return undefined;
  const lineage = decodeSessionLineage(state.sessionLineage);
  if (lineage === undefined) return undefined;
  const fingerprint = sessionFingerprint(sessionId);
  if (lineage.slots.some((entry) => entry?.equals(fingerprint)))
    return undefined;
  const start = sessionRoleSlot(unit.ordinal, role);
  const slot = Array.from(
    { length: sessionsPerRole() },
    (_, offset) => start + offset,
  ).find((index) => lineage.slots[index] === undefined);
  if (slot === undefined) return undefined;
  const next = [...lineage.slots];
  next[slot] = fingerprint;
  const sessionLineage = encodeSessionLineage(next);
  return {
    sessionLineage,
    sessionLineageRoot: deriveSessionLineageRoot(
      sessionLineage,
      state.usedSessionCount + 1,
    ),
    usedSessionCount: state.usedSessionCount + 1,
  };
}

function controllerIdentityMatches(
  state: Pick<RepositoryRun, "controller">,
  sessionId: string,
): boolean {
  return [
    state.controller.runId,
    state.controller.incarnationId,
    state.controller.holder,
  ].includes(sessionId);
}

export function hasUsedSession(
  state: Pick<RepositoryRun, "sessionLineage">,
  sessionId: string,
): boolean {
  const lineage = decodeSessionLineage(state.sessionLineage);
  // A malformed persisted ledger must never create a false-negative reuse
  // path. Reducer hydration independently rejects it with an invariant error.
  if (lineage === undefined) return true;
  const fingerprint = sessionFingerprint(sessionId);
  return lineage.slots.some((entry) => entry?.equals(fingerprint));
}

function hasSessionLineageBinding(
  state: Pick<RepositoryRun, "sessionLineage">,
  sessionId: string,
  ordinal: number,
  role: "worker" | "reviewer",
): boolean {
  const lineage = decodeSessionLineage(state.sessionLineage);
  if (lineage === undefined) return false;
  const fingerprint = sessionFingerprint(sessionId);
  const start = sessionRoleSlot(ordinal, role);
  return lineage.slots
    .slice(start, start + sessionsPerRole())
    .some((entry) => entry?.equals(fingerprint));
}

export function sessionLineageCount(encoded: string): number {
  const lineage = decodeSessionLineage(encoded);
  return lineage === undefined ? Number.POSITIVE_INFINITY : lineage.count;
}

export function deriveSessionFingerprint(sessionId: string): string {
  return sha256(
    canonicalJson({ domain: "sce.protocol.session-lineage.v1", sessionId }),
  );
}

function sessionFingerprint(sessionId: string): Buffer {
  return Buffer.from(deriveSessionFingerprint(sessionId), "hex");
}

/**
 * Session slots are laid out by immutable `(unit ordinal, role, generation)`.
 * A compact occupancy bitmap carries the slot tag, while each populated slot
 * retains the complete digest. This avoids spending one redundant tag byte on
 * all 2,176 records and keeps the ledger canonical without losing membership.
 */
type SessionLineage = {
  readonly slots: readonly (Buffer | undefined)[];
  readonly count: number;
};

function sessionsPerRole(): number {
  // One initial worker/reviewer assignment plus each bounded repair.
  return 17;
}

function sessionRoleSlot(ordinal: number, role: "worker" | "reviewer"): number {
  return (ordinal * 2 + (role === "reviewer" ? 1 : 0)) * sessionsPerRole();
}

function sessionBitmapBytes(slotCount: number): number {
  return Math.ceil(slotCount / 8);
}

function sessionRawBytes(slotCount: number): number {
  return (
    sessionBitmapBytes(slotCount) + slotCount * LIMITS.sessionFingerprintBytes
  );
}

function sessionSlotsForRawLength(length: number): number | undefined {
  for (
    let bitmapBytes = 1;
    bitmapBytes <= sessionBitmapBytes(LIMITS.sessionHistory);
    bitmapBytes += 1
  ) {
    const slotCount = (length - bitmapBytes) / LIMITS.sessionFingerprintBytes;
    if (
      Number.isInteger(slotCount) &&
      slotCount > 0 &&
      slotCount <= LIMITS.sessionHistory &&
      sessionBitmapBytes(slotCount) === bitmapBytes
    )
      return slotCount;
  }
  return undefined;
}

function encodeSessionLineage(slots: readonly (Buffer | undefined)[]): string {
  let last = slots.length - 1;
  while (last >= 0 && slots[last] === undefined) last -= 1;
  if (last < 0) return "";
  const slotCount = last + 1;
  const bitmapBytes = sessionBitmapBytes(slotCount);
  const raw = Buffer.alloc(sessionRawBytes(slotCount));
  for (let index = 0; index < slotCount; index += 1) {
    const fingerprint = slots[index];
    if (fingerprint === undefined) continue;
    if (fingerprint.length !== LIMITS.sessionFingerprintBytes)
      throw new Error("invalid session fingerprint length");
    raw[Math.floor(index / 8)]! |= 1 << (index % 8);
    fingerprint.copy(raw, bitmapBytes + index * LIMITS.sessionFingerprintBytes);
  }
  return raw.toString("base64");
}

function decodeSessionLineage(encoded: string): SessionLineage | undefined {
  if (encoded === "") return { slots: [], count: 0 };
  let raw: Buffer;
  try {
    raw = Buffer.from(encoded, "base64");
  } catch {
    return undefined;
  }
  const slotCount = sessionSlotsForRawLength(raw.length);
  if (raw.toString("base64") !== encoded || slotCount === undefined)
    return undefined;
  const bitmapBytes = sessionBitmapBytes(slotCount);
  const slots: (Buffer | undefined)[] = Array.from(
    { length: slotCount },
    () => undefined,
  );
  const seen = new Set<string>();
  let count = 0;
  for (let index = 0; index < slotCount; index += 1) {
    const occupied = (raw[Math.floor(index / 8)]! & (1 << (index % 8))) !== 0;
    const fingerprint = raw.subarray(
      bitmapBytes + index * LIMITS.sessionFingerprintBytes,
      bitmapBytes + (index + 1) * LIMITS.sessionFingerprintBytes,
    );
    if (!occupied) {
      if (!fingerprint.every((byte) => byte === 0)) return undefined;
      continue;
    }
    const key = fingerprint.toString("hex");
    if (seen.has(key)) return undefined;
    seen.add(key);
    slots[index] = fingerprint;
    count += 1;
  }
  const unusedBitmapBits = slotCount % 8;
  if (
    unusedBitmapBits !== 0 &&
    (raw[bitmapBytes - 1]! & ~((1 << unusedBitmapBits) - 1)) !== 0
  )
    return undefined;
  if (slots.at(-1) === undefined) return undefined;
  return { slots, count };
}

export function deriveSessionLineageRoot(
  sessionLineage: string,
  usedSessionCount: number,
): string {
  if (sessionLineage === "" && usedSessionCount === 0) return "0".repeat(64);
  return sha256(
    canonicalJson({
      domain: "sce.protocol.session-lineage-root.v1",
      sessionLineage,
      usedSessionCount,
    }),
  );
}
function hasUnresolvedUnitEffect(
  state: RepositoryRun,
  unitId: string,
): boolean {
  return state.effectJournal.some(
    (effect) =>
      effect.unitId === unitId &&
      (effect.status === "intended" || effect.status === "ambiguous"),
  );
}
function intentStateForEffect(kind: EffectKind): UnitState | undefined {
  const states: Partial<Record<EffectKind, UnitState>> = {
    reservation_acquire: "reservation_intent",
    branch_create: "branch_intent",
    worktree_create: "worktree_intent",
    dispatch: "dispatch_intent",
    worker_collect: "collect_intent",
    candidate_collect: "candidate_intent",
    verify: "verification_intent",
    review_dispatch: "reviewer_dispatch_intent",
    review_collect: "review_collect_intent",
    publish: "publish_intent",
    integrate: "integrate_intent",
    reservation_release: "reservation_release_intent",
    repair: "repair_intent",
    failure: "failure_intent",
    timeout: "timeout_intent",
    park: "park_intent",
    cancel: "cancel_intent",
  };
  return states[kind];
}
function effectMatchesObservation(
  type: ProtocolEvent["type"],
  kind: EffectKind,
): boolean {
  const observations: Partial<Record<EffectKind, ProtocolEvent["type"]>> = {
    reservation_acquire: "reservation_observed",
    branch_create: "branch_observed",
    worktree_create: "worktree_observed",
    dispatch: "dispatch_observed",
    worker_collect: "worker_collected",
    candidate_collect: "candidate_observed",
    verify: "verification_observed",
    review_dispatch: "reviewer_observed",
    review_collect: "review_collected",
    publish: "publish_observed",
    integrate: "integrate_observed",
    reservation_release: "reservation_released",
    repair: "repair_observed",
    failure: "failure_observed",
    timeout: "timeout_observed",
    park: "park_observed",
    cancel: "cancel_observed",
  };
  return observations[kind] === type;
}
/**
 * An ambiguity blocks *new* effects, not facts already bound to a durable
 * intent. Restore only the exact ambiguous entry's lifecycle shape, then let
 * the ordinary observation case verify and commit the fact. Other ambiguous
 * effects remain untouched, so the aggregate cannot accidentally resume.
 */
function prepareBlockedUnitObservation(
  state: RepositoryRun,
  event: ProtocolEvent,
): RepositoryRun | undefined {
  if (
    !("unitId" in event) ||
    event.unitId === null ||
    event.type === "effect_ambiguous" ||
    !("effectId" in event) ||
    !("effectKind" in event)
  )
    return undefined;
  const unit = state.units[event.unitId];
  const entry = state.effectJournal.find(
    (effect) =>
      effect.effectId === event.effectId &&
      effect.unitId === event.unitId &&
      effect.kind === event.effectKind &&
      (effect.status === "intended" || effect.status === "ambiguous"),
  );
  const recoveredState = intentStateForEffect(event.effectKind);
  if (
    unit === undefined ||
    entry === undefined ||
    recoveredState === undefined ||
    !effectMatchesObservation(event.type, event.effectKind)
  )
    return undefined;
  if (entry.status === "intended")
    return unit.state === recoveredState ? state : undefined;
  if (unit.state !== "blocked") return undefined;
  return {
    ...state,
    units: replaceUnit(state, { ...unit, state: recoveredState }),
    effectJournal: state.effectJournal.map((effect) =>
      effect.effectId === entry.effectId ? restoreIntended(effect) : effect,
    ),
  };
}

function restoreIntended(entry: EffectJournalEntry): EffectJournalEntry {
  const { observationHash: _ambiguousObservation, ...intended } = entry;
  return { ...intended, status: "intended" };
}

/** Mark exactly one already-intended effect ambiguous without emitting work. */
function markEffectAmbiguous(
  state: RepositoryRun,
  event: Extract<ProtocolEvent, { type: "effect_ambiguous" }>,
): RepositoryRun | undefined {
  const entry = state.effectJournal.find(
    (candidate) =>
      candidate.effectId === event.effectId &&
      candidate.unitId === event.unitId &&
      candidate.kind === event.effectKind &&
      candidate.status === "intended",
  );
  if (entry === undefined) return undefined;
  if (entry.unitId === null) {
    const expectedControllerState =
      entry.kind === "controller_acquire"
        ? "acquire_intent"
        : entry.kind === "controller_release"
          ? "release_intent"
          : undefined;
    if (expectedControllerState !== state.controller.state) return undefined;
  } else {
    const unit = state.units[entry.unitId];
    const expectedUnitState = intentStateForEffect(entry.kind);
    if (unit === undefined || unit.state !== expectedUnitState)
      return undefined;
  }
  const blocked: RepositoryRun = {
    ...state,
    state: "blocked",
    effectJournal: state.effectJournal.map((candidate) =>
      candidate.effectId === entry.effectId
        ? {
            ...candidate,
            status: "ambiguous" as const,
            ...(event.observationHash === undefined
              ? {}
              : { observationHash: event.observationHash }),
          }
        : candidate,
    ),
    ...(entry.unitId === null
      ? {}
      : {
          units: replaceUnit(state, {
            ...state.units[entry.unitId]!,
            state: "blocked",
          }),
        }),
  };
  if (entry.unitId === null || entry.kind !== "reservation_release")
    return blocked;
  return {
    ...blocked,
    closedUnitEvidence: updateClosureReleaseEvidence(blocked, entry.unitId),
  };
}

function reduceController(
  state: RepositoryRun,
  event: Extract<ProtocolEvent, { type: `controller_${string}` }>,
): Reduction {
  let result: Step | undefined;
  switch (event.type) {
    case "controller_acquire_intent":
      if (
        state.state !== "initializing" ||
        state.controller.state !== "unacquired"
      )
        return reject(
          "illegal_transition",
          "controller acquisition is not legal",
        );
      result = controllerIntent(
        state,
        event,
        "controller_acquire",
        "initializing",
        "acquire_intent",
      );
      break;
    case "controller_acquired":
      if (
        (state.state !== "initializing" && state.state !== "blocked") ||
        state.controller.state !== "acquire_intent" ||
        event.holder !== state.controller.holder ||
        event.controllerFencingToken !== state.controllerFencingToken ||
        !matchesRecoverableEffect(state, event, null, "controller_acquire")
      )
        return badObservation();
      result = {
        state: settleAmbiguityState(
          markObserved(state, event.effectId, event.observationHash, {
            state: "active",
            controller: { ...state.controller, state: "acquired" },
          }),
        ),
        effects: [],
      };
      break;
    case "controller_release_intent":
      if (!canReleaseController(state))
        return reject(
          "illegal_transition",
          "controller release requires closed units and released reservations",
        );
      result = controllerIntent(
        state,
        event,
        "controller_release",
        "release_intent",
        "release_intent",
      );
      break;
    case "controller_released":
      if (
        (state.state !== "release_intent" && state.state !== "blocked") ||
        state.controller.state !== "release_intent" ||
        !matchesRecoverableEffect(state, event, null, "controller_release")
      )
        return badObservation();
      result = {
        state: settleAmbiguityState(
          markObserved(state, event.effectId, event.observationHash, {
            state: "released",
            controller: { ...state.controller, state: "released" },
          }),
        ),
        effects: [],
      };
      break;
    default:
      return exhaustive(event);
  }
  return commit(result.state, event, result.effects);
}

function controllerIntent(
  state: RepositoryRun,
  event: IntentEvent,
  kind: Extract<EffectKind, "controller_acquire" | "controller_release">,
  aggregateState: RepositoryRun["state"],
  controllerState: RepositoryRun["controller"]["state"],
): Step {
  return appendIntent(
    {
      ...state,
      state: aggregateState,
      controller: { ...state.controller, state: controllerState },
    },
    null,
    event,
    kind,
    "slotTransition" in event ? event.slotTransition : undefined,
  );
}
function modifyingIntent(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: IntentEvent,
  kind: Extract<EffectKind, "dispatch" | "repair">,
  unitChanges: Partial<Unit> = {},
): Step {
  return intent(state, unit, next, event, kind, {
    activeModifyingUnitIds: [...state.activeModifyingUnitIds, unit.id],
    ...(Object.keys(unitChanges).length === 0
      ? {}
      : { units: replaceUnit(state, { ...unit, ...unitChanges }) }),
  });
}
function terminalIntent(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: IntentEvent,
  kind: Extract<EffectKind, "failure" | "timeout" | "park" | "cancel">,
): Step {
  const retainsQualification =
    state.qualificationOwnerUnitId === unit.id ||
    state.currentReviewerUnitId === unit.id;
  return intent(state, unit, next, event, kind, {
    // An active worker or reviewer remains owned until the exact terminal
    // observation confirms that its role/session target was handled.
    activeModifyingUnitIds: state.activeModifyingUnitIds,
    qualificationQueue: retainsQualification
      ? state.qualificationQueue
      : state.qualificationQueue.filter((id) => id !== unit.id),
    integrationQueue: state.integrationQueue.filter((id) => id !== unit.id),
  });
}
function intent(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: IntentEvent,
  kind: EffectKind,
  changes: AggregateChanges = {},
): Step {
  const changedUnit = changes.units?.[unit.id] ?? unit;
  const base = {
    ...state,
    ...changes,
    units: {
      ...(changes.units ?? state.units),
      [unit.id]: { ...changedUnit, state: next, revision: unit.revision + 1 },
    },
  };
  return appendIntent(
    normalizeOwners(base as RepositoryRun, changes),
    unit.id,
    event,
    kind,
  );
}
function appendIntent(
  state: RepositoryRun,
  unitId: string | null,
  event: IntentEvent,
  kind: EffectKind,
  slotTransition?: import("./schemas.js").SlotTransitionIntent,
): Step {
  const compacted = compactJournal(state);
  const effectId = `${event.eventId}:${kind}`;
  const params = runtimeEffectParams(
    compacted,
    unitId,
    kind,
    slotTransition,
  ) as RuntimeEffect["params"];
  const paramsHash = deriveParamsHash(kind, params);
  const effect: ProtocolEffect = {
    kind,
    effectId,
    unitId,
    idempotencyKey: event.idempotencyKey,
    paramsHash,
    schemaVersion: SCHEMA_VERSION,
    params,
  } as ProtocolEffect;
  const entry: EffectJournalEntry = {
    effectId,
    unitId,
    idempotencyKey: event.idempotencyKey,
    kind,
    intentRevision: state.revision,
    intentCommitment: "0".repeat(64),
    paramsHash,
    status: "intended",
    ...(slotTransition === undefined ? {} : { slotTransition }),
    schemaVersion: SCHEMA_VERSION,
  };
  entry.intentCommitment = deriveIntentCommitment(entry);
  const validEffect = validate<RuntimeEffect>(RuntimeEffectSchema, effect);
  if (!validEffect.ok)
    throw new Error(
      `runtime effect construction failed: ${validEffect.errors.join("; ")}`,
    );
  return {
    state: { ...compacted, effectJournal: [...compacted.effectJournal, entry] },
    effects: [effect],
  };
}
function runtimeEffectParams(
  state: RepositoryRun,
  unitId: string | null,
  kind: EffectKind,
  slotTransition?: import("./schemas.js").SlotTransitionIntent,
): unknown {
  if (kind === "controller_acquire")
    return {
      holder: state.controller.holder,
      controllerFencingToken: state.controllerFencingToken,
      requestedModel: state.controller.requestedModel,
      returnedModel: state.controller.returnedModel,
      promptHash: state.controller.promptHash,
      ...(slotTransition === undefined ? {} : { slotTransition }),
    };
  if (kind === "controller_release")
    return {
      holder: state.controller.holder,
      controllerFencingToken: state.controllerFencingToken,
      ...(slotTransition === undefined ? {} : { slotTransition }),
    };
  if (unitId === null) throw new Error(`${kind} requires a unit`);
  const unit = state.units[unitId];
  if (unit === undefined) throw new Error(`${kind} has an unknown unit`);
  const worker = () => ({
    branchRef: required(unit.branchRef, "branch ref", kind),
    packet: required(unit.workerPacket, "worker packet", kind),
    worktreePath: required(unit.worktreePath, "worktree path", kind),
    requestedModel: required(unit.workerRequestedModel, "worker model", kind),
    promptHash: required(unit.workerPromptHash, "worker prompt", kind),
  });
  const candidate = () => ({
    baseOid: required(
      unit.verificationBaseOid ?? unit.baseOid,
      "candidate base",
      kind,
    ),
    headOid: required(unit.candidateHead, "candidate head", kind),
    treeOid: required(unit.candidateTree, "candidate tree", kind),
  });
  switch (kind) {
    case "reservation_acquire":
      return {
        reservations: unit.reservationIds.map((id) => {
          const reservation = state.reservations[id];
          if (reservation === undefined)
            throw new Error(
              `reservation acquire has unknown reservation ${id}`,
            );
          return {
            id: reservation.id,
            namespace: reservation.namespace,
            resource: reservation.resource,
          };
        }),
      };
    case "branch_create":
      return {
        baseOid: unit.baseOid,
        branchRef: required(unit.branchRef, "branch ref", kind),
      };
    case "worktree_create":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        worktreePath: required(unit.worktreePath, "worktree path", kind),
      };
    case "dispatch":
      return worker();
    case "worker_collect":
      return {
        sessionId: required(unit.workerSessionId, "worker session", kind),
      };
    case "candidate_collect":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        worktreePath: required(unit.worktreePath, "worktree path", kind),
      };
    case "verify":
      return {
        candidate: {
          baseOid: unit.baseOid,
          headOid: required(unit.candidateHead, "candidate head", kind),
          treeOid: required(unit.candidateTree, "candidate tree", kind),
        },
        commands: required(
          unit.verificationCommands,
          "verification commands",
          kind,
        ),
      };
    case "review_dispatch":
      return {
        candidate: candidate(),
        packet: required(unit.reviewerPacket, "reviewer packet", kind),
        requestedModel: required(
          unit.reviewerRequestedModel,
          "reviewer model",
          kind,
        ),
        promptHash: required(unit.reviewPromptHash, "reviewer prompt", kind),
      };
    case "review_collect":
      return {
        sessionId: required(unit.reviewerSessionId, "reviewer session", kind),
        candidate: candidate(),
      };
    case "publish":
      return {
        branchRef: required(unit.branchRef, "branch ref", kind),
        candidate: candidate(),
        authorityProfile: state.authorityProfile,
        completionBoundary: state.completionBoundary,
      };
    case "integrate":
      return {
        integrationBranch: state.integrationBranch,
        integrationProfile: state.integrationProfile,
        completionBoundary: state.completionBoundary,
        controllerFencingToken: state.controllerFencingToken,
        candidate: candidate(),
      };
    case "reservation_release":
      return { reservationIds: [...unit.reservationIds] };
    case "repair": {
      const context = required(unit.repairContext, "repair context", kind);
      return {
        ...worker(),
        repairBaseOid: context.baseOid,
        ...(context.headOid === undefined
          ? {}
          : { repairHeadOid: context.headOid }),
        ...(context.treeOid === undefined
          ? {}
          : { repairTreeOid: context.treeOid }),
      };
    }
    case "failure":
    case "timeout":
    case "park":
    case "cancel":
      return terminalEffectParams(state, unit, kind);
    default:
      return exhaustive(kind);
  }
}

function terminalEffectParams(
  state: RepositoryRun,
  unit: Unit,
  kind: Extract<EffectKind, "failure" | "timeout" | "park" | "cancel">,
): RuntimeEffect["params"] {
  if (state.currentReviewerUnitId === unit.id)
    return {
      role: "reviewer",
      sessionId: required(unit.reviewerSessionId, "reviewer session", kind),
    };
  if (state.activeModifyingUnitIds.includes(unit.id))
    return {
      role: "worker",
      sessionId: required(unit.workerSessionId, "worker session", kind),
    };
  return { role: "none" };
}
function matchesTerminalSession(
  state: RepositoryRun,
  unit: Unit,
  event: Extract<ProtocolEvent, { type: "cancel_observed" }>,
): boolean {
  if (state.currentReviewerUnitId === unit.id)
    return (
      event.role === "reviewer" &&
      event.sessionId === unit.reviewerSessionId &&
      event.requestedModel === unit.reviewerRequestedModel &&
      event.returnedModel === unit.reviewerReturnedModel &&
      event.promptHash === unit.reviewPromptHash
    );
  if (state.activeModifyingUnitIds.includes(unit.id))
    return (
      event.role === "worker" &&
      event.sessionId === unit.workerSessionId &&
      event.requestedModel === unit.workerRequestedModel &&
      event.returnedModel === unit.workerReturnedModel &&
      event.promptHash === unit.workerPromptHash
    );
  return event.role === "none";
}
function required<T>(value: T | undefined, name: string, kind: EffectKind): T {
  if (value === undefined) throw new Error(`${kind} lacks ${name}`);
  return value;
}

function observedEffect(
  state: RepositoryRun,
  unitId: string,
  kind: EffectKind,
): Extract<EffectJournalEntry, { status: "observed" }> {
  const entry = [...state.effectJournal]
    .reverse()
    .find(
      (candidate) =>
        candidate.unitId === unitId &&
        candidate.kind === kind &&
        candidate.status === "observed",
    );
  if (entry === undefined || entry.observationHash === undefined)
    throw new Error(`missing observed ${kind} lineage for ${unitId}`);
  return entry as Extract<EffectJournalEntry, { status: "observed" }>;
}

function closureReservations(
  state: RepositoryRun,
  unit: Unit,
): ClosureEvidence["reservations"] {
  return unit.reservationIds.map((reservationId) => {
    const reservation = state.reservations[reservationId];
    if (reservation === undefined)
      throw new Error(`missing reservation ${reservationId}`);
    return {
      id: reservation.id,
      namespace: reservation.namespace,
      resource: reservation.resource,
      acquire: observedEffect(state, unit.id, "reservation_acquire"),
    };
  });
}

function sessionClosureBindings(
  unit: Unit,
): Pick<ClosureEvidence, "worker" | "reviewer"> {
  return {
    ...(unit.workerSessionId === undefined
      ? {}
      : {
          worker: {
            sessionId: unit.workerSessionId,
            requestedModel: required(
              unit.workerRequestedModel,
              "worker model",
              "dispatch",
            ),
            returnedModel: required(
              unit.workerReturnedModel,
              "worker returned model",
              "dispatch",
            ),
            promptHash: required(
              unit.workerPromptHash,
              "worker prompt",
              "dispatch",
            ),
          },
        }),
    ...(unit.reviewerSessionId === undefined
      ? {}
      : {
          reviewer: {
            sessionId: unit.reviewerSessionId,
            requestedModel: required(
              unit.reviewerRequestedModel,
              "reviewer model",
              "review_dispatch",
            ),
            returnedModel: required(
              unit.reviewerReturnedModel,
              "reviewer returned model",
              "review_dispatch",
            ),
            promptHash: required(
              unit.reviewPromptHash,
              "review prompt",
              "review_dispatch",
            ),
          },
        }),
  };
}

function successfulClosureFacts(unit: Unit) {
  return {
    candidate: {
      headOid: required(unit.candidateHead, "candidate head", "integrate"),
      treeOid: required(unit.candidateTree, "candidate tree", "integrate"),
    },
    verification: {
      baseOid: required(
        unit.verificationBaseOid,
        "verification base",
        "integrate",
      ),
      headOid: required(
        unit.verificationHeadOid,
        "verification head",
        "integrate",
      ),
      treeOid: required(
        unit.verificationTree,
        "verification tree",
        "integrate",
      ),
      evidenceHash: required(
        unit.verificationEvidenceHash,
        "verification evidence",
        "integrate",
      ),
      commands: required(
        unit.verificationCommands,
        "verification commands",
        "integrate",
      ),
    },
    review: {
      baseOid: required(unit.reviewBaseOid, "review base", "integrate"),
      headOid: required(unit.reviewHeadOid, "review head", "integrate"),
      treeOid: required(unit.reviewTree, "review tree", "integrate"),
      responseHash: required(
        unit.approvalResponseHash,
        "approval response",
        "integrate",
      ),
    },
  };
}

function closureEvidenceFor(state: RepositoryRun, unit: Unit): ClosureEvidence {
  const base = {
    unitId: unit.id,
    unitOrdinal: unit.ordinal,
    baseOid: unit.baseOid,
    ...(unit.branchRef === undefined ? {} : { branchRef: unit.branchRef }),
    ...(unit.worktreePath === undefined
      ? {}
      : { worktreePath: unit.worktreePath }),
    ...sessionClosureBindings(unit),
    reservations: closureReservations(state, unit),
  };
  switch (unit.state) {
    case "landed":
      return {
        ...base,
        ...successfulClosureFacts(unit),
        outcome: "landed",
        landedOid: required(unit.landedOid, "landed OID", "integrate"),
        terminalEffect: observedEffect(state, unit.id, "integrate"),
      };
    case "handoff": {
      const success = successfulClosureFacts(unit);
      if (unit.openPullRequest !== undefined)
        return {
          ...base,
          ...success,
          outcome: "pr_handoff",
          publishedHeadOid: required(
            unit.publishedHeadOid,
            "published head",
            "publish",
          ),
          pullRequest: unit.openPullRequest,
          terminalEffect: observedEffect(state, unit.id, "publish"),
        };
      return {
        ...base,
        ...success,
        outcome: "branch_handoff",
        publishedHeadOid: required(
          unit.publishedHeadOid,
          "published head",
          "publish",
        ),
        terminalEffect: observedEffect(state, unit.id, "publish"),
      };
    }
    case "failed":
    case "timed_out":
    case "parked":
    case "cancelled": {
      const terminalKind: Record<
        Extract<Unit["state"], "failed" | "timed_out" | "parked" | "cancelled">,
        Extract<EffectKind, "failure" | "timeout" | "park" | "cancel">
      > = {
        failed: "failure",
        timed_out: "timeout",
        parked: "park",
        cancelled: "cancel",
      };
      return {
        ...base,
        outcome: unit.state,
        terminalEffect:
          unit.state === "failed" &&
          !state.effectJournal.some(
            (entry) =>
              entry.unitId === unit.id &&
              entry.kind === "failure" &&
              entry.status === "observed",
          )
            ? observedEffect(state, unit.id, "worker_collect")
            : observedEffect(state, unit.id, terminalKind[unit.state]),
        ...(unit.workerResult === undefined
          ? {}
          : { workerResult: unit.workerResult }),
        ...(unit.repairContext === undefined
          ? {}
          : { repairContext: unit.repairContext }),
        ...(unit.candidateHead === undefined || unit.candidateTree === undefined
          ? {}
          : {
              candidate: {
                headOid: unit.candidateHead,
                treeOid: unit.candidateTree,
              },
            }),
      };
    }
    default:
      throw new Error(
        `cannot close non-terminal unit ${unit.id}/${unit.state}`,
      );
  }
}

function recordClosureEvidence(state: RepositoryRun, unit: Unit): string {
  const evidence = decodeClosedUnitEvidence(state.closedUnitEvidence);
  if (evidence === undefined)
    throw new Error("closed unit evidence ledger is malformed");
  return encodeClosedUnitEvidence({
    ...evidence,
    [unit.id]: closureEvidenceFor(state, unit),
  });
}

function removeClosureEvidence(
  state: RepositoryRun,
  unitId: string,
): RepositoryRun {
  const evidence = decodeClosedUnitEvidence(state.closedUnitEvidence);
  if (evidence === undefined)
    throw new Error("closed unit evidence ledger is malformed");
  const next = { ...evidence };
  delete next[unitId];
  return { ...state, closedUnitEvidence: encodeClosedUnitEvidence(next) };
}

/**
 * Closed facts have to remain exact, but the 64x16 envelope cannot afford a
 * second spelling of every journal field name.  This is a wire-only tuple
 * form: it is expanded back into the strict public ClosureEvidence union
 * before it is ever used.  The explicit version and fixed tuple arities make
 * the compact form closed too (there is no permissive "facts" bag).
 */
type DenseClosureLedger = {
  readonly v: 1;
  readonly u: Record<string, unknown>;
};

type ClosedUnitEvidenceDetails = {
  readonly dense: DenseClosureLedger;
  readonly evidence: Readonly<Record<string, ClosureEvidence>>;
  readonly commitment: string;
};

function invalidClosedUnitEvidenceCommitment(): string {
  return sha256(
    canonicalJson({ domain: "sce.protocol.closed-evidence.invalid.v1" }),
  );
}

function closedUnitEvidenceCommitment(dense: DenseClosureLedger): string {
  if (Object.keys(dense.u).length === 0) return "0".repeat(64);
  return sha256(
    canonicalJson({
      domain: "sce.protocol.closed-evidence.v1",
      evidence: dense,
    } as unknown as JsonValue),
  );
}

function denseJournal(entry: EffectJournalEntry): readonly unknown[] {
  return [
    entry.effectId,
    entry.unitId,
    entry.idempotencyKey,
    entry.kind,
    entry.intentRevision,
    entry.intentCommitment,
    entry.paramsHash,
    entry.status,
    entry.observationHash ?? null,
    entry.schemaVersion,
  ];
}

function denseBinding(
  binding: ClosureEvidence["worker"] | undefined,
): readonly unknown[] | null {
  return binding === undefined
    ? null
    : [
        binding.sessionId,
        binding.requestedModel,
        binding.returnedModel,
        binding.promptHash,
      ];
}

function denseClosureRecord(closure: ClosureEvidence): readonly unknown[] {
  const common: unknown[] = [
    closure.outcome,
    closure.unitId,
    closure.unitOrdinal,
    closure.baseOid,
    closure.repairCount ?? null,
    closure.branchRef ?? null,
    closure.worktreePath ?? null,
    denseBinding(closure.worker),
    denseBinding(closure.reviewer),
    closure.reservations.map((reservation) => [
      reservation.id,
      reservation.namespace,
      reservation.resource,
      denseJournal(reservation.acquire),
      reservation.release === undefined
        ? null
        : denseJournal(reservation.release),
    ]),
    denseJournal(closure.terminalEffect),
  ];
  if (
    closure.outcome === "landed" ||
    closure.outcome === "branch_handoff" ||
    closure.outcome === "pr_handoff"
  ) {
    const success = [
      [closure.candidate.headOid, closure.candidate.treeOid],
      [
        closure.verification.baseOid,
        closure.verification.headOid,
        closure.verification.treeOid,
        closure.verification.evidenceHash,
        closure.verification.commands,
      ],
      [
        closure.review.baseOid,
        closure.review.headOid,
        closure.review.treeOid,
        closure.review.responseHash,
      ],
    ];
    if (closure.outcome === "landed")
      return [...common, [closure.landedOid, ...success]];
    if (closure.outcome === "branch_handoff")
      return [...common, [closure.publishedHeadOid, ...success]];
    return [
      ...common,
      [
        closure.publishedHeadOid,
        [
          closure.pullRequest.providerPrId,
          closure.pullRequest.url ?? null,
          closure.pullRequest.state,
          closure.pullRequest.baseRef,
          closure.pullRequest.baseOid,
          closure.pullRequest.remoteHeadOid,
        ],
        ...success,
      ],
    ];
  }
  return [
    ...common,
    [
      closure.workerResult === undefined
        ? null
        : [
            closure.workerResult.status,
            closure.workerResult.summary,
            closure.workerResult.residualRisks,
            closure.workerResult.suggestedFollowUps,
          ],
      closure.repairContext === undefined
        ? null
        : [
            closure.repairContext.baseOid,
            closure.repairContext.headOid ?? null,
            closure.repairContext.treeOid ?? null,
            closure.repairContext.responseHash,
            closure.repairContext.rationale,
            closure.repairContext.findings.map((finding) => [
              finding.id,
              finding.severity,
              finding.detail,
            ]),
          ],
      closure.candidate === undefined
        ? null
        : [closure.candidate.headOid, closure.candidate.treeOid],
    ],
  ];
}

function denseClosureLedger(
  evidence: Readonly<Record<string, ClosureEvidence>>,
): DenseClosureLedger {
  return {
    v: 1,
    u: Object.fromEntries(
      Object.entries(evidence).map(([id, closure]) => [
        id,
        denseClosureRecord(closure),
      ]),
    ),
  };
}

function tuple(value: unknown, length: number): readonly unknown[] | undefined {
  return Array.isArray(value) && value.length === length ? value : undefined;
}

function denseJournalEntry(value: unknown): EffectJournalEntry | undefined {
  const values = tuple(value, 10);
  if (values === undefined) return undefined;
  const [
    effectId,
    unitId,
    idempotencyKey,
    kind,
    intentRevision,
    intentCommitment,
    paramsHash,
    status,
    observationHash,
    schemaVersion,
  ] = values;
  if (observationHash !== null && typeof observationHash !== "string")
    return undefined;
  return {
    effectId,
    unitId,
    idempotencyKey,
    kind,
    intentRevision,
    intentCommitment,
    paramsHash,
    status,
    ...(observationHash === null ? {} : { observationHash }),
    schemaVersion,
  } as EffectJournalEntry;
}

function denseBindingRecord(
  value: unknown,
): ClosureEvidence["worker"] | undefined | null {
  if (value === null) return undefined;
  const values = tuple(value, 4);
  if (values === undefined) return null;
  const [sessionId, requestedModel, returnedModel, promptHash] = values;
  return {
    sessionId,
    requestedModel,
    returnedModel,
    promptHash,
  } as ClosureEvidence["worker"];
}

function denseReservations(
  value: unknown,
): ClosureEvidence["reservations"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const reservations = [] as ClosureEvidence["reservations"];
  for (const encoded of value) {
    const values = tuple(encoded, 5);
    if (values === undefined) return undefined;
    const [id, namespace, resource, acquireEncoded, releaseEncoded] = values;
    const acquire = denseJournalEntry(acquireEncoded);
    const release =
      releaseEncoded === null ? undefined : denseJournalEntry(releaseEncoded);
    if (
      acquire === undefined ||
      (releaseEncoded !== null && release === undefined)
    )
      return undefined;
    reservations.push({
      id,
      namespace,
      resource,
      acquire: acquire as Extract<EffectJournalEntry, { status: "observed" }>,
      ...(release === undefined ? {} : { release }),
    } as ClosureEvidence["reservations"][number]);
  }
  return reservations;
}

function denseSuccess(value: unknown):
  | {
      readonly publishedOrLandedOid: unknown;
      readonly pullRequest?: unknown;
      readonly candidate: unknown;
      readonly verification: unknown;
      readonly review: unknown;
    }
  | undefined {
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== 5))
    return undefined;
  const [publishedOrLandedOid, second, third, fourth, fifth] = value;
  const hasPullRequest = value.length === 5;
  return {
    publishedOrLandedOid,
    ...(hasPullRequest ? { pullRequest: second } : {}),
    candidate: hasPullRequest ? third : second,
    verification: hasPullRequest ? fourth : third,
    review: hasPullRequest ? fifth : fourth,
  };
}

function expandDenseClosure(value: unknown): ClosureEvidence | undefined {
  const values = tuple(value, 12);
  if (values === undefined) return undefined;
  const [
    outcome,
    unitId,
    unitOrdinal,
    baseOid,
    repairCount,
    branchRef,
    worktreePath,
    workerEncoded,
    reviewerEncoded,
    reservationsEncoded,
    terminalEncoded,
    payload,
  ] = values;
  if (
    (repairCount !== null && typeof repairCount !== "number") ||
    (branchRef !== null && typeof branchRef !== "string") ||
    (worktreePath !== null && typeof worktreePath !== "string")
  )
    return undefined;
  const worker = denseBindingRecord(workerEncoded);
  const reviewer = denseBindingRecord(reviewerEncoded);
  const reservations = denseReservations(reservationsEncoded);
  const terminalEffect = denseJournalEntry(terminalEncoded);
  if (
    worker === null ||
    reviewer === null ||
    reservations === undefined ||
    terminalEffect === undefined
  )
    return undefined;
  const base = {
    unitId,
    unitOrdinal,
    baseOid,
    ...(repairCount === null ? {} : { repairCount }),
    ...(branchRef === null ? {} : { branchRef }),
    ...(worktreePath === null ? {} : { worktreePath }),
    ...(worker === undefined ? {} : { worker }),
    ...(reviewer === undefined ? {} : { reviewer }),
    reservations,
    terminalEffect,
  };
  if (
    outcome === "landed" ||
    outcome === "branch_handoff" ||
    outcome === "pr_handoff"
  ) {
    const success = denseSuccess(payload);
    const candidate =
      success === undefined ? undefined : tuple(success.candidate, 2);
    const verification =
      success === undefined ? undefined : tuple(success.verification, 5);
    const review = success === undefined ? undefined : tuple(success.review, 4);
    if (
      success === undefined ||
      candidate === undefined ||
      verification === undefined ||
      review === undefined
    )
      return undefined;
    const successFacts = {
      candidate: { headOid: candidate[0], treeOid: candidate[1] },
      verification: {
        baseOid: verification[0],
        headOid: verification[1],
        treeOid: verification[2],
        evidenceHash: verification[3],
        commands: verification[4],
      },
      review: {
        baseOid: review[0],
        headOid: review[1],
        treeOid: review[2],
        responseHash: review[3],
      },
    };
    if (outcome === "landed")
      return {
        ...base,
        ...successFacts,
        outcome,
        landedOid: success.publishedOrLandedOid,
      } as ClosureEvidence;
    if (outcome === "branch_handoff")
      return {
        ...base,
        ...successFacts,
        outcome,
        publishedHeadOid: success.publishedOrLandedOid,
      } as ClosureEvidence;
    const pullRequest = tuple(success.pullRequest, 6);
    if (
      pullRequest === undefined ||
      (pullRequest[1] !== null && typeof pullRequest[1] !== "string")
    )
      return undefined;
    return {
      ...base,
      ...successFacts,
      outcome,
      publishedHeadOid: success.publishedOrLandedOid,
      pullRequest: {
        providerPrId: pullRequest[0],
        ...(pullRequest[1] === null ? {} : { url: pullRequest[1] }),
        state: pullRequest[2],
        baseRef: pullRequest[3],
        baseOid: pullRequest[4],
        remoteHeadOid: pullRequest[5],
      },
    } as ClosureEvidence;
  }
  if (
    outcome !== "failed" &&
    outcome !== "timed_out" &&
    outcome !== "parked" &&
    outcome !== "cancelled"
  )
    return undefined;
  const negative = tuple(payload, 3);
  if (negative === undefined) return undefined;
  const [workerResultEncoded, repairContextEncoded, candidateEncoded] =
    negative;
  const workerResult =
    workerResultEncoded === null ? undefined : tuple(workerResultEncoded, 4);
  const repairContext =
    repairContextEncoded === null ? undefined : tuple(repairContextEncoded, 6);
  const candidate =
    candidateEncoded === null ? undefined : tuple(candidateEncoded, 2);
  if (
    (workerResult === undefined && workerResultEncoded !== null) ||
    (repairContext === undefined && repairContextEncoded !== null) ||
    (candidate === undefined && candidateEncoded !== null)
  )
    return undefined;
  if (
    repairContext !== undefined &&
    ((repairContext[1] !== null && typeof repairContext[1] !== "string") ||
      (repairContext[2] !== null && typeof repairContext[2] !== "string") ||
      !Array.isArray(repairContext[5]) ||
      !repairContext[5].every((finding) => tuple(finding, 3) !== undefined))
  )
    return undefined;
  return {
    ...base,
    outcome,
    ...(workerResult === undefined
      ? {}
      : {
          workerResult: {
            status: workerResult[0],
            summary: workerResult[1],
            residualRisks: workerResult[2],
            suggestedFollowUps: workerResult[3],
          },
        }),
    ...(repairContext === undefined
      ? {}
      : {
          repairContext: {
            baseOid: repairContext[0],
            ...(repairContext[1] === null ? {} : { headOid: repairContext[1] }),
            ...(repairContext[2] === null ? {} : { treeOid: repairContext[2] }),
            responseHash: repairContext[3],
            rationale: repairContext[4],
            findings: (repairContext[5] as readonly unknown[]).map(
              (finding) => {
                const [id, severity, detail] = tuple(finding, 3)!;
                return { id, severity, detail };
              },
            ),
          },
        }),
    ...(candidate === undefined
      ? {}
      : { candidate: { headOid: candidate[0], treeOid: candidate[1] } }),
  } as ClosureEvidence;
}

function encodeClosedUnitEvidence(
  evidence: Readonly<Record<string, ClosureEvidence>>,
): string {
  if (Object.keys(evidence).length === 0) return "";
  const dense = denseClosureLedger(evidence);
  return deflateRawSync(
    Buffer.from(canonicalJson(dense as unknown as JsonValue), "utf8"),
    {
      level: 9,
    },
  ).toString("base64");
}

function decodeClosedUnitEvidenceDetails(
  encoded: string,
): ClosedUnitEvidenceDetails | undefined {
  if (encoded === "") {
    const dense: DenseClosureLedger = { v: 1, u: {} };
    return {
      dense,
      evidence: {},
      commitment: closedUnitEvidenceCommitment(dense),
    };
  }
  let compressed: Buffer;
  let decoded: Buffer;
  try {
    compressed = Buffer.from(encoded, "base64");
    if (compressed.toString("base64") !== encoded) return undefined;
    const inflated = inflateRawSync(compressed, {
      info: true,
      maxOutputLength: LIMITS.envelopeBytes,
    }) as unknown as {
      readonly buffer: Buffer;
      readonly engine: { readonly bytesWritten: number };
    };
    if (inflated.engine.bytesWritten !== compressed.length) return undefined;
    decoded = inflated.buffer;
  } catch {
    return undefined;
  }
  if (decoded.length > LIMITS.envelopeBytes) return undefined;
  const text = decoded.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(decoded)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (
    parsed === null ||
    Array.isArray(parsed) ||
    typeof parsed !== "object" ||
    canonicalJson(parsed as JsonValue) !== text
  )
    return undefined;
  const parsedDense = parsed as Partial<DenseClosureLedger>;
  if (
    Object.keys(parsedDense).length !== 2 ||
    parsedDense.v !== 1 ||
    parsedDense.u === null ||
    Array.isArray(parsedDense.u) ||
    typeof parsedDense.u !== "object"
  )
    return undefined;
  const dense: DenseClosureLedger = { v: 1, u: parsedDense.u };
  const evidence: Record<string, ClosureEvidence> = {};
  for (const [id, compact] of Object.entries(dense.u)) {
    const facts = expandDenseClosure(compact);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(id) ||
      facts === undefined ||
      !validate<ClosureEvidence>(ClosureEvidenceSchema, facts).ok
    )
      return undefined;
    evidence[id] = facts;
  }
  return {
    dense,
    evidence,
    commitment: closedUnitEvidenceCommitment(dense),
  };
}

function decodeClosedUnitEvidence(
  encoded: string,
): Readonly<Record<string, ClosureEvidence>> | undefined {
  return decodeClosedUnitEvidenceDetails(encoded)?.evidence;
}

function updateClosureReleaseEvidence(
  state: RepositoryRun,
  unitId: string,
): string {
  const evidence = decodeClosedUnitEvidence(state.closedUnitEvidence);
  const record = evidence?.[unitId];
  const release = [...state.effectJournal]
    .reverse()
    .find(
      (entry) =>
        entry.unitId === unitId && entry.kind === "reservation_release",
    );
  if (evidence === undefined || record === undefined || release === undefined)
    throw new Error(`missing closure release lineage for ${unitId}`);
  return encodeClosedUnitEvidence({
    ...evidence,
    [unitId]: {
      ...record,
      reservations: record.reservations.map((reservation) => ({
        ...reservation,
        release,
      })),
    } as ClosureEvidence,
  });
}

function closeUnitAfterRelease(
  state: RepositoryRun,
  unitId: string,
): RepositoryRun {
  const closedUnit = state.units[unitId];
  if (closedUnit === undefined)
    throw new Error(`missing released unit ${unitId}`);
  const releasedEvidence = updateClosureReleaseEvidence(state, unitId);
  const evidence = decodeClosedUnitEvidence(releasedEvidence);
  const record = evidence?.[unitId];
  if (evidence === undefined || record === undefined)
    throw new Error(`missing final closure evidence for ${unitId}`);
  const closedUnitEvidence = encodeClosedUnitEvidence({
    ...evidence,
    [unitId]: {
      ...record,
      repairCount: closedUnit.repairCount,
    } as ClosureEvidence,
  });
  const units = { ...state.units };
  delete units[unitId];
  const reservations = Object.fromEntries(
    Object.entries(state.reservations).filter(
      ([, reservation]) => reservation.unitId !== unitId,
    ),
  );
  return {
    ...state,
    units,
    reservations,
    wave: {
      ...state.wave,
      unitIds: state.wave.unitIds.filter((id) => id !== unitId),
    },
    closedUnitEvidence,
  };
}

function persistTerminalClosureEvidence(step: Step, unitId: string): Step {
  const unit = step.state.units[unitId];
  if (unit === undefined) throw new Error(`missing terminal unit ${unitId}`);
  return {
    ...step,
    state: {
      ...step.state,
      closedUnitEvidence: recordClosureEvidence(step.state, unit),
    },
  };
}

function compactJournal(state: RepositoryRun): RepositoryRun {
  const anchored = new Set(
    Object.values(state.reservations)
      .flatMap((reservation) => [
        reservation.state === "released"
          ? undefined
          : reservation.acquireEffectId,
        reservation.state === "released"
          ? reservation.releaseEffectId
          : undefined,
      ])
      .filter((effectId): effectId is string => effectId !== undefined),
  );
  const retained = state.effectJournal.filter(
    (entry) => entry.status !== "observed" || anchored.has(entry.effectId),
  );
  const compactedEntries = state.effectJournal.filter(
    (entry) => entry.status === "observed" && !anchored.has(entry.effectId),
  );
  const compacted = state.effectJournal.length - retained.length;
  return compacted === 0
    ? state
    : {
        ...state,
        effectJournal: retained,
        journalCheckpoint: {
          revision: state.revision,
          commitment: deriveJournalCommitment(
            state.journalCheckpoint.commitment,
            compactedEntries,
          ),
          compactedEffects:
            state.journalCheckpoint.compactedEffects + compacted,
          compactedEvents: state.journalCheckpoint.compactedEvents,
          compactedIdempotencyKeys:
            state.journalCheckpoint.compactedIdempotencyKeys,
        },
      };
}
type AggregateChanges = Omit<
  Partial<RepositoryRun>,
  | "qualificationOwnerUnitId"
  | "integrationOwnerUnitId"
  | "currentReviewerUnitId"
> & {
  qualificationOwnerUnitId?: string | null;
  integrationOwnerUnitId?: string | null;
  currentReviewerUnitId?: string | null;
};
function observe(
  state: RepositoryRun,
  unit: Unit,
  next: UnitState,
  event: ObservedEvent,
  unitChanges: Partial<Unit> = {},
  aggregateChanges: AggregateChanges = {},
  replacementUnit?: Unit,
): Step {
  const nextUnit = {
    ...(replacementUnit ?? { ...unit, ...unitChanges }),
    state: next,
    revision: unit.revision + 1,
  };
  const nextState = markObserved(
    {
      ...state,
      ...(aggregateChanges as Partial<RepositoryRun>),
      units: replaceUnit(state, nextUnit),
    },
    event.effectId,
    event.observationHash,
  );
  return {
    state: settleAmbiguityState(normalizeOwners(nextState, aggregateChanges)),
    effects: [],
  };
}
function markObserved(
  state: RepositoryRun,
  effectId: string,
  observationHash: string,
  changes: Partial<RepositoryRun> = {},
): RepositoryRun {
  return {
    ...state,
    ...changes,
    effectJournal: state.effectJournal.map((entry) =>
      entry.effectId === effectId
        ? { ...entry, status: "observed" as const, observationHash }
        : entry,
    ),
  };
}
function normalizeOwners(
  state: RepositoryRun,
  changes: AggregateChanges,
): RepositoryRun {
  const next = { ...state };
  if (changes.qualificationOwnerUnitId === null)
    delete next.qualificationOwnerUnitId;
  if (changes.integrationOwnerUnitId === null)
    delete next.integrationOwnerUnitId;
  if (changes.currentReviewerUnitId === null) delete next.currentReviewerUnitId;
  return next;
}

/**
 * The aggregate resumes only once every ambiguous journal entry has an exact
 * observation. Any remaining ambiguity keeps normal emit actions suspended.
 */
function settleAmbiguityState(state: RepositoryRun): RepositoryRun {
  const hasAmbiguity = state.effectJournal.some(
    (entry) => entry.status === "ambiguous",
  );
  if (hasAmbiguity && state.state !== "blocked")
    return { ...state, state: "blocked" };
  if (!hasAmbiguity && state.state === "blocked")
    return { ...state, state: "active" };
  return state;
}
function replaceUnit(state: RepositoryRun, unit: Unit): RepositoryRun["units"] {
  return { ...state.units, [unit.id]: unit };
}
function matchesIntended(
  state: RepositoryRun,
  event: ObservedEvent,
  unitId: string | null,
  kind: EffectKind,
): boolean {
  return state.effectJournal.some(
    (entry) =>
      entry.effectId === event.effectId &&
      entry.unitId === unitId &&
      entry.kind === kind &&
      entry.kind === event.effectKind &&
      entry.status === "intended",
  );
}
function matchesRecoverableEffect(
  state: RepositoryRun,
  event: ObservedEvent,
  unitId: string | null,
  kind: EffectKind,
): boolean {
  return state.effectJournal.some(
    (entry) =>
      entry.effectId === event.effectId &&
      entry.unitId === unitId &&
      entry.kind === kind &&
      entry.kind === event.effectKind &&
      (entry.status === "intended" || entry.status === "ambiguous"),
  );
}
function badObservation(): Reduction {
  return reject(
    "illegal_transition",
    "observation does not match an intended effect id, unit, kind, and status",
  );
}
function workerSession(
  event: Extract<
    ProtocolEvent,
    { type: "dispatch_observed" | "repair_observed" }
  >,
): Partial<Unit> {
  return {
    workerSessionId: event.sessionId,
    workerRequestedModel: event.requestedModel,
    workerReturnedModel: event.returnedModel,
    workerPromptHash: event.promptHash,
  };
}
function reviewerSession(
  event: Extract<ProtocolEvent, { type: "reviewer_observed" }>,
): Partial<Unit> {
  return {
    reviewerSessionId: event.sessionId,
    reviewerRequestedModel: event.requestedModel,
    reviewerReturnedModel: event.returnedModel,
    reviewPromptHash: event.promptHash,
  };
}
function reviewJudgmentError(
  unit: Unit,
  judgment: Extract<ProtocolEvent, { type: "review_collected" }>["judgment"],
  revision: number,
): string | undefined {
  if (
    judgment.role !== "reviewer" ||
    judgment.kind !== "review_verdict" ||
    judgment.unitId !== unit.id
  )
    return "review judgment has wrong role, kind, or unit";
  if (
    judgment.aggregateRevision !== revision ||
    judgment.sessionId !== unit.reviewerSessionId ||
    judgment.requestedModel !== unit.reviewerRequestedModel ||
    judgment.returnedModel !== unit.reviewerReturnedModel ||
    judgment.promptHash !== unit.reviewPromptHash
  )
    return "review judgment is not bound to the dispatched reviewer session, model, prompt, and revision";
  if (
    judgment.baseOid !== unit.verificationBaseOid ||
    judgment.headOid !== unit.candidateHead ||
    judgment.treeOid !== unit.candidateTree
  )
    return "review judgment is not bound to the verified base, head, and tree";
  if (
    judgment.decision === "approve" &&
    judgment.findings.some((finding) => finding.severity === "blocking")
  )
    return "approval cannot contain blocking findings";
  return undefined;
}
function validRepairJudgment(
  state: RepositoryRun,
  unit: Unit,
  judgment: NonNullable<
    Extract<ProtocolEvent, { type: "repair_intent" }>["judgment"]
  >,
  revision: number,
): boolean {
  const context = unit.repairContext;
  return (
    context !== undefined &&
    judgment.role === "controller" &&
    judgment.kind === "repair_disposition" &&
    judgment.unitId === unit.id &&
    judgment.aggregateRevision === revision &&
    judgment.sessionId === state.controller.incarnationId &&
    judgment.requestedModel === state.controller.requestedModel &&
    judgment.returnedModel === state.controller.returnedModel &&
    judgment.factOid === (context.headOid ?? context.baseOid) &&
    judgment.currentEvidenceHash === context.responseHash &&
    judgment.findingsContextHash === deriveRepairContextHash(context) &&
    judgment.promptHash ===
      deriveRepairJudgmentPromptHash(state, unit, judgment) &&
    judgment.responseHash === deriveRepairJudgmentResponseHash(judgment) &&
    (context.headOid === undefined || context.headOid === unit.candidateHead) &&
    judgment.decision === "repair"
  );
}
function failureRepairContext(
  unit: Unit,
  responseHash: string,
  rationale: string,
): Partial<Unit> {
  if (unit.candidateHead === undefined || unit.candidateTree === undefined)
    return {};
  return {
    repairContext: {
      baseOid: unit.verificationBaseOid ?? unit.baseOid,
      headOid: unit.candidateHead,
      treeOid: unit.candidateTree,
      responseHash,
      rationale,
      findings: [
        { id: "runtime-failure", severity: "blocking", detail: rationale },
      ],
    },
  };
}
function isCurrentApproval(unit: Unit): boolean {
  return (
    unit.state === "approved" &&
    unit.reviewBaseOid === unit.baseOid &&
    unit.reviewHeadOid === unit.candidateHead &&
    unit.reviewTree === unit.candidateTree &&
    unit.approvalResponseHash !== undefined
  );
}
function hasCurrentApproval(unit: Unit): boolean {
  return (
    unit.reviewBaseOid === unit.baseOid &&
    unit.reviewHeadOid === unit.candidateHead &&
    unit.reviewTree === unit.candidateTree &&
    unit.approvalResponseHash !== undefined
  );
}
function insertSorted(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value].sort();
}
function updateReservations(
  state: RepositoryRun,
  unitId: string,
  next: "reserved" | "release_intent" | "released",
  effectId?: string,
): RepositoryRun["reservations"] {
  return Object.fromEntries(
    Object.entries(state.reservations).map(([id, reservation]) => [
      id,
      reservation.unitId !== unitId
        ? reservation
        : {
            ...reservation,
            state: next,
            ...(next === "reserved" && effectId !== undefined
              ? { acquireEffectId: effectId }
              : {}),
            ...(next === "released" && effectId !== undefined
              ? { releaseEffectId: effectId }
              : {}),
          },
    ]),
  );
}
function clearUnitOwners(
  state: RepositoryRun,
  unitId: string,
): AggregateChanges {
  return {
    activeModifyingUnitIds: state.activeModifyingUnitIds.filter(
      (id) => id !== unitId,
    ),
    qualificationQueue: state.qualificationQueue.filter((id) => id !== unitId),
    integrationQueue: state.integrationQueue.filter((id) => id !== unitId),
    ...(state.qualificationOwnerUnitId === unitId
      ? { qualificationOwnerUnitId: null }
      : {}),
    ...(state.integrationOwnerUnitId === unitId
      ? { integrationOwnerUnitId: null }
      : {}),
    ...(state.currentReviewerUnitId === unitId
      ? { currentReviewerUnitId: null }
      : {}),
  };
}
function canReleaseController(state: RepositoryRun): boolean {
  return (
    state.controller.state === "acquired" &&
    state.activeModifyingUnitIds.length === 0 &&
    state.qualificationOwnerUnitId === undefined &&
    state.integrationOwnerUnitId === undefined &&
    state.currentReviewerUnitId === undefined &&
    Object.keys(state.units).length === 0 &&
    Object.keys(state.reservations).length === 0
  );
}

function commit(
  state: RepositoryRun,
  event: ProtocolEvent,
  effects: readonly ProtocolEffect[],
): Reduction {
  const eventIds = [...state.processedEventIds, event.eventId];
  const idempotencyKeys =
    "idempotencyKey" in event
      ? [...state.processedIdempotencyKeys, event.idempotencyKey]
      : state.processedIdempotencyKeys;
  const compactedEvents = Math.max(0, eventIds.length - 256);
  const compactedIdempotencyKeys = Math.max(0, idempotencyKeys.length - 256);
  const uncommittedState = {
    ...state,
    revision: state.revision + 1,
    processedEventIds: eventIds.slice(-256),
    processedIdempotencyKeys: idempotencyKeys.slice(-256),
    journalCheckpoint: {
      ...state.journalCheckpoint,
      revision:
        compactedEvents > 0 || compactedIdempotencyKeys > 0
          ? state.revision + 1
          : state.journalCheckpoint.revision,
      compactedEvents:
        state.journalCheckpoint.compactedEvents + compactedEvents,
      compactedIdempotencyKeys:
        state.journalCheckpoint.compactedIdempotencyKeys +
        compactedIdempotencyKeys,
    },
  };
  const closedEvidenceDetails = decodeClosedUnitEvidenceDetails(
    uncommittedState.closedUnitEvidence,
  );
  const nextState = {
    ...uncommittedState,
    closedUnitEvidenceCommitment:
      closedEvidenceDetails?.commitment ??
      invalidClosedUnitEvidenceCommitment(),
    journalCommitment: deriveJournalCommitment(
      uncommittedState.journalCheckpoint.commitment,
      uncommittedState.effectJournal,
    ),
  };
  const schema = validate<RepositoryRun>(RepositoryRunSchema, nextState);
  if (!schema.ok) return reject("invariant", schema.errors.join("; "));
  const errors = runInvariantErrorsWithClosedEvidence(
    nextState,
    closedEvidenceDetails,
  );
  return errors.length
    ? reject("invariant", errors.join("; "))
    : { ok: true, nextState, effects };
}

export function runInvariantErrors(state: RepositoryRun): readonly string[] {
  return runInvariantErrorsWithClosedEvidence(
    state,
    decodeClosedUnitEvidenceDetails(state.closedUnitEvidence),
  );
}

function runInvariantErrorsWithClosedEvidence(
  state: RepositoryRun,
  closedEvidenceDetails: ClosedUnitEvidenceDetails | undefined,
): readonly string[] {
  const errors: string[] = [];
  const effectIds = new Set<string>();
  const idempotency = new Set<string>();
  const waveIds = new Set(state.wave.unitIds);
  const unresolvedByUnit = new Map<string, EffectJournalEntry[]>();
  const addUnresolved = (entry: EffectJournalEntry) => {
    if (entry.unitId === null) return;
    const entries = unresolvedByUnit.get(entry.unitId) ?? [];
    entries.push(entry);
    unresolvedByUnit.set(entry.unitId, entries);
  };
  if (
    utf8.encode(
      JSON.stringify({
        schema: "sce.repository-run",
        version: SCHEMA_VERSION,
        payload: state,
      }),
    ).byteLength > LIMITS.envelopeBytes
  )
    errors.push("repository run envelope exceeds byte limit");
  if (
    state.controller.holder !==
    `${state.controller.runId}/${state.controller.incarnationId}`
  )
    errors.push("controller holder does not bind immutable run incarnation");
  const completionError = completionConfigurationError(state);
  if (completionError !== undefined) errors.push(completionError);
  if (state.wave.unitIds.length > 3)
    errors.push("wave exceeds the three-unit implementation cap");
  for (const queue of [
    state.wave.unitIds,
    state.qualificationQueue,
    state.integrationQueue,
    state.activeModifyingUnitIds,
  ])
    if (
      new Set(queue).size !== queue.length ||
      queue.some((id) => state.units[id] === undefined)
    )
      errors.push("queue contains duplicate or unknown unit");
  for (const queue of [state.qualificationQueue, state.integrationQueue]) {
    if (queue.join("\u0000") !== [...queue].sort().join("\u0000"))
      errors.push("queue order is not deterministic");
    if (queue.some((id) => !waveIds.has(id)))
      errors.push("queue contains a unit outside the current wave");
  }
  const oidLength = state.gitObjectFormat === "sha1" ? 40 : 64;
  const checkOid = (unit: Unit, value: string | undefined) => {
    if (value !== undefined && value.length !== oidLength)
      errors.push(
        `unit ${unit.id} has an OID incompatible with repository object format`,
      );
  };
  for (const unit of Object.values(state.units)) {
    for (const value of [
      unit.baseOid,
      unit.candidateHead,
      unit.candidateTree,
      unit.publishedHeadOid,
      unit.verificationBaseOid,
      unit.verificationHeadOid,
      unit.verificationTree,
      unit.reviewBaseOid,
      unit.reviewHeadOid,
      unit.reviewTree,
      unit.landedOid,
      unit.openPullRequest?.baseOid,
      unit.openPullRequest?.remoteHeadOid,
      unit.repairContext?.baseOid,
      unit.repairContext?.headOid,
      unit.repairContext?.treeOid,
    ])
      checkOid(unit, value);
    if (
      unit.repairContext?.headOid === undefined &&
      unit.repairContext?.treeOid !== undefined
    )
      errors.push(`repair context ${unit.id} has a tree without a head`);
  }
  const sessionLineage = decodeSessionLineage(state.sessionLineage);
  const hasCurrentSessionLineage = (
    sessionId: string,
    ordinal: number,
    role: "worker" | "reviewer",
  ) => {
    if (sessionLineage === undefined) return false;
    const fingerprint = sessionFingerprint(sessionId);
    const start = sessionRoleSlot(ordinal, role);
    return sessionLineage.slots
      .slice(start, start + sessionsPerRole())
      .some((entry) => entry?.equals(fingerprint));
  };
  if (sessionLineage === undefined)
    errors.push("session lineage ledger is invalid");
  else if (sessionLineage.count !== state.usedSessionCount)
    errors.push("session lineage count does not match ledger");
  else if (
    state.sessionLineageRoot !==
    deriveSessionLineageRoot(state.sessionLineage, state.usedSessionCount)
  )
    errors.push("session lineage root does not match ledger");
  const closedEvidence = closedEvidenceDetails?.evidence;
  if (closedEvidenceDetails === undefined)
    errors.push("closed unit evidence ledger is invalid");
  else if (
    state.closedUnitEvidenceCommitment !== closedEvidenceDetails.commitment
  )
    errors.push("closed unit evidence commitment does not match ledger");
  const liveTerminalStates = new Set<UnitState>([
    "landed",
    "handoff",
    "failed",
    "timed_out",
    "parked",
    "cancelled",
    "reservation_release_intent",
  ]);
  const liveOrdinals = new Set<number>();
  for (const unit of Object.values(state.units)) {
    if (liveOrdinals.has(unit.ordinal))
      errors.push(`unit ${unit.id} duplicates a stable ordinal`);
    liveOrdinals.add(unit.ordinal);
    const closure = closedEvidence?.[unit.id];
    const ambiguousRelease = state.effectJournal.some(
      (effect) =>
        effect.unitId === unit.id &&
        effect.kind === "reservation_release" &&
        effect.status === "ambiguous",
    );
    const blockedReleaseRecovery = unit.state === "blocked" && ambiguousRelease;
    if (liveTerminalStates.has(unit.state) && closure === undefined)
      errors.push(`terminal unit ${unit.id} lacks persisted closure evidence`);
    if (
      closure !== undefined &&
      (closure.unitId !== unit.id ||
        closure.unitOrdinal !== unit.ordinal ||
        closure.baseOid !== unit.baseOid ||
        closure.repairCount !== undefined)
    )
      errors.push(
        `closure evidence ${unit.id} disagrees with live terminal unit`,
      );
    if (
      !liveTerminalStates.has(unit.state) &&
      !blockedReleaseRecovery &&
      closure !== undefined
    )
      errors.push(`non-terminal unit ${unit.id} has closure evidence`);
    if (unit.state === "reservation_release_intent") {
      if (
        closure === undefined ||
        !closure.reservations.every(
          (reservation) =>
            reservation.release?.status === "intended" &&
            reservation.release.observationHash === undefined,
        )
      )
        errors.push(
          `release intent ${unit.id} lacks exact closure release lineage`,
        );
    }
  }
  const closureOrdinals = new Set<number>();
  for (const [id, closure] of Object.entries(closedEvidence ?? {})) {
    if (id !== closure.unitId)
      errors.push(`closure evidence key ${id} does not match unit id`);
    if (closureOrdinals.has(closure.unitOrdinal))
      errors.push(`closure evidence ${id} duplicates a stable ordinal`);
    closureOrdinals.add(closure.unitOrdinal);
    if (liveOrdinals.has(closure.unitOrdinal) && state.units[id] === undefined)
      errors.push(`closure evidence ${id} aliases a live unit ordinal`);
    if (state.units[id] === undefined && closure.repairCount === undefined)
      errors.push(`closed evidence ${id} lacks authoritative repair count`);
    if (state.units[id] !== undefined && closure.repairCount !== undefined)
      errors.push(`live terminal ${id} duplicates authoritative repair count`);
    for (const value of [
      closure.baseOid,
      ...("candidate" in closure && closure.candidate !== undefined
        ? [closure.candidate.headOid, closure.candidate.treeOid]
        : []),
      ...("verification" in closure
        ? [
            closure.verification.baseOid,
            closure.verification.headOid,
            closure.verification.treeOid,
          ]
        : []),
      ...("review" in closure
        ? [
            closure.review.baseOid,
            closure.review.headOid,
            closure.review.treeOid,
          ]
        : []),
      ...(closure.outcome === "landed" ? [closure.landedOid] : []),
      ...(closure.outcome === "branch_handoff" ||
      closure.outcome === "pr_handoff"
        ? [closure.publishedHeadOid]
        : []),
    ])
      if (value.length !== oidLength)
        errors.push(`closure evidence ${id} has an incompatible OID`);
    for (const reservation of closure.reservations) {
      const unit = state.units[id];
      const expectedReleaseStatus =
        unit === undefined
          ? "observed"
          : unit.state === "reservation_release_intent"
            ? "intended"
            : unit.state === "blocked" &&
                state.effectJournal.some(
                  (effect) =>
                    effect.unitId === id &&
                    effect.kind === "reservation_release" &&
                    effect.status === "ambiguous",
                )
              ? "ambiguous"
              : undefined;
      if (
        reservation.acquire.intentCommitment !==
        deriveIntentCommitment(reservation.acquire)
      )
        errors.push(
          `closure evidence ${id} has an invalid reservation acquire intent`,
        );
      if (
        reservation.acquire.unitId !== id ||
        reservation.acquire.kind !== "reservation_acquire" ||
        reservation.acquire.status !== "observed"
      )
        errors.push(
          `closure evidence ${id} lacks exact reservation acquisition lineage`,
        );
      else if (
        (expectedReleaseStatus !== undefined &&
          reservation.release === undefined) ||
        (reservation.release !== undefined &&
          (reservation.release.unitId !== id ||
            reservation.release.kind !== "reservation_release" ||
            reservation.release.intentCommitment !==
              deriveIntentCommitment(reservation.release) ||
            (expectedReleaseStatus !== undefined &&
              reservation.release.status !== expectedReleaseStatus)))
      )
        errors.push(
          `closure evidence ${id} has invalid reservation release lineage`,
        );
    }
    for (const [role, binding] of [
      ["worker", closure.worker],
      ["reviewer", closure.reviewer],
    ] as const)
      if (
        binding !== undefined &&
        !hasCurrentSessionLineage(binding.sessionId, closure.unitOrdinal, role)
      )
        errors.push(`closure ${id} lacks ${role} session lineage`);
    const failedWorker =
      "workerResult" in closure && closure.workerResult?.status === "failed";
    const expectedTerminalKinds: Readonly<
      Record<ClosureEvidence["outcome"], readonly EffectKind[]>
    > = {
      landed: ["integrate"],
      branch_handoff: ["publish"],
      pr_handoff: ["publish"],
      failed: failedWorker ? ["failure", "worker_collect"] : ["failure"],
      timed_out: ["timeout"],
      parked: ["park"],
      cancelled: ["cancel"],
    };
    if (
      closure.terminalEffect.unitId !== id ||
      closure.terminalEffect.status !== "observed" ||
      !expectedTerminalKinds[closure.outcome].includes(
        closure.terminalEffect.kind,
      ) ||
      closure.terminalEffect.intentCommitment !==
        deriveIntentCommitment(closure.terminalEffect)
    )
      errors.push(`closure evidence ${id} has invalid terminal effect lineage`);
    if (
      closure.outcome === "failed" &&
      closure.terminalEffect.kind === "worker_collect" &&
      closure.workerResult?.status !== "failed"
    )
      errors.push(`closure evidence ${id} lacks failed worker terminal facts`);
    if (
      closure.outcome === "landed" ||
      closure.outcome === "branch_handoff" ||
      closure.outcome === "pr_handoff"
    ) {
      if (
        closure.verification.baseOid !== closure.baseOid ||
        closure.candidate.headOid !== closure.verification.headOid ||
        closure.candidate.treeOid !== closure.verification.treeOid ||
        closure.review.baseOid !== closure.baseOid ||
        closure.review.headOid !== closure.candidate.headOid ||
        closure.review.treeOid !== closure.candidate.treeOid
      )
        errors.push(`closure evidence ${id} has mismatched successful facts`);
    }
  }
  if (
    state.journalCommitment !==
    deriveJournalCommitment(
      state.journalCheckpoint.commitment,
      state.effectJournal,
    )
  )
    errors.push("journal commitment does not match exact entries");
  const hasAmbiguousEffect = state.effectJournal.some(
    (effect) => effect.status === "ambiguous",
  );
  if (hasAmbiguousEffect && state.state !== "blocked")
    errors.push("ambiguous effects require a blocked aggregate");
  if (!hasAmbiguousEffect && state.state === "blocked")
    errors.push("blocked aggregate lacks an ambiguous effect");
  for (const effect of state.effectJournal) {
    if (effectIds.has(effect.effectId))
      errors.push(`duplicate effect id ${effect.effectId}`);
    effectIds.add(effect.effectId);
    if (idempotency.has(effect.idempotencyKey))
      errors.push(`duplicate idempotency key ${effect.idempotencyKey}`);
    idempotency.add(effect.idempotencyKey);
    if (
      effect.unitId !== null &&
      state.units[effect.unitId] === undefined &&
      (closedEvidence?.[effect.unitId] === undefined ||
        effect.status !== "observed")
    )
      errors.push(`effect ${effect.effectId} has unknown unit`);
    if (effect.intentCommitment !== deriveIntentCommitment(effect))
      errors.push(`effect ${effect.effectId} has an invalid intent commitment`);
    if (effect.status === "intended" && effect.observationHash !== undefined)
      errors.push(`intended effect ${effect.effectId} has an observation`);
    if (effect.status === "observed" && effect.observationHash === undefined)
      errors.push(`observed effect ${effect.effectId} has no observation`);
    if (effect.status === "intended" || effect.status === "ambiguous")
      addUnresolved(effect);
    if (
      effect.unitId !== null &&
      (effect.status === "intended" || effect.status === "ambiguous") &&
      !waveIds.has(effect.unitId)
    )
      errors.push(
        `unresolved effect ${effect.effectId} is outside the current wave`,
      );
    if (effect.status === "intended" || effect.status === "ambiguous") {
      try {
        const expectedParams = runtimeEffectParams(
          state,
          effect.unitId,
          effect.kind,
          effect.slotTransition,
        ) as RuntimeEffect["params"];
        if (effect.paramsHash !== deriveParamsHash(effect.kind, expectedParams))
          errors.push(`effect ${effect.effectId} has an invalid params hash`);
      } catch {
        errors.push(
          `effect ${effect.effectId} lacks reconstructable parameters`,
        );
      }
    }
  }
  if (
    state.harness === undefined &&
    state.effectJournal.some(
      (effect) =>
        (effect.status === "intended" || effect.status === "ambiguous") &&
        [
          "dispatch",
          "worker_collect",
          "review_dispatch",
          "review_collect",
          "repair",
        ].includes(effect.kind),
    )
  )
    errors.push("unresolved harness effects require harness configuration");
  // The map is filled explicitly because a unit's durable phase determines
  // exactly one unresolved external act; this rejects both orphaned and
  // stacked intents on hydration.
  const intentByState: Partial<Record<UnitState, EffectKind>> = {
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
  const requiredActiveStates = new Set<UnitState>([
    "dispatch_intent",
    "dispatched",
    "collect_intent",
    "repair_intent",
  ]);
  const optionallyActiveStates = new Set<UnitState>([
    ...requiredActiveStates,
    "failure_intent",
    "timeout_intent",
    "cancel_intent",
    "park_intent",
  ]);
  for (const id of state.activeModifyingUnitIds) {
    if (state.units[id] === undefined)
      errors.push(`active modifying unit ${id} is unknown`);
    else if (!waveIds.has(id))
      errors.push(`active modifying unit ${id} is outside the current wave`);
  }
  const assignedSessions = new Map<string, string>();
  for (const [id, unit] of Object.entries(state.units)) {
    if (id !== unit.id)
      errors.push(`unit map key ${id} does not match unit id ${unit.id}`);
    if (
      unit.reservationIds.some(
        (reservationId) =>
          state.reservations[reservationId]?.unitId !== unit.id,
      )
    )
      errors.push(`unit ${id} claims an invalid reservation`);
    const unresolved = unresolvedByUnit.get(id) ?? [];
    if (unresolved.length > 0 && !waveIds.has(id))
      errors.push(
        `unit ${id} has unresolved evidence outside the current wave`,
      );
    const expectedKind = intentByState[unit.state];
    if (unit.state === "blocked") {
      if (
        unresolved.length !== 1 ||
        unresolved[0]?.status !== "ambiguous" ||
        intentStateForEffect(unresolved[0]?.kind ?? "dispatch") === undefined
      )
        errors.push(`blocked unit ${id} lacks one exact ambiguous effect`);
    } else if (expectedKind !== undefined) {
      if (
        unresolved.length !== 1 ||
        unresolved[0]?.kind !== expectedKind ||
        unresolved[0]?.status !== "intended"
      )
        errors.push(`intent state ${id} lacks one exact unresolved effect`);
    } else if (unresolved.length !== 0)
      errors.push(`stable unit ${id} has an orphan unresolved effect`);
    if (
      unit.reservationIds.length > 0 &&
      unit.state !== "reservation_intent" &&
      unit.state !== "reservation_release_intent" &&
      unit.state !== "blocked" &&
      unit.state !== "closed" &&
      !unit.reservationIds.every(
        (reservationId) =>
          state.reservations[reservationId]?.state === "reserved",
      )
    )
      errors.push(`reserved lifecycle ${id} lacks acquired reservations`);
    if (
      unit.state === "reservation_release_intent" &&
      !unit.reservationIds.every(
        (reservationId) =>
          state.reservations[reservationId]?.state === "release_intent",
      )
    )
      errors.push(`reservation cleanup ${id} lacks release intent`);
    if (
      [
        "branch_intent",
        "branch_observed",
        "worktree_intent",
        "worktree_observed",
      ].includes(unit.state) &&
      unit.branchRef === undefined
    )
      errors.push(`branch lifecycle ${id} lacks branch ref`);
    if (
      ["worktree_intent", "worktree_observed"].includes(unit.state) &&
      unit.worktreePath === undefined
    )
      errors.push(`worktree lifecycle ${id} lacks worktree path`);
    if (
      [
        "dispatch_intent",
        "dispatched",
        "collect_intent",
        "collected",
        "candidate_intent",
        "repair_intent",
      ].includes(unit.state) &&
      unit.workerPacket === undefined
    )
      errors.push(`worker lifecycle ${id} lacks exact launch packet`);
    if (unit.workerPacket !== undefined) {
      const packetError = launchPacketError(unit.workerPacket, unit, "worker");
      if (packetError !== undefined)
        errors.push(`worker packet ${id} ${packetError}`);
    }
    if (
      [
        "dispatched",
        "collect_intent",
        "collected",
        "candidate_intent",
      ].includes(unit.state) &&
      (unit.workerSessionId === undefined ||
        unit.workerPromptHash === undefined ||
        unit.workerRequestedModel === undefined ||
        unit.workerReturnedModel === undefined)
    )
      errors.push(`worker lifecycle ${id} lacks bound session`);
    if (
      [
        "candidate_committed",
        "verification_intent",
        "qualified",
        "reviewer_dispatch_intent",
        "reviewer_dispatched",
        "review_collect_intent",
        "approved",
        "publish_intent",
        "published",
        "integrate_intent",
        "landed",
        "handoff",
      ].includes(unit.state) &&
      (unit.candidateHead === undefined ||
        unit.candidateTree === undefined ||
        unit.candidateDiffHash === undefined)
    )
      errors.push(`candidate lifecycle ${id} lacks exact objects`);
    if (
      [
        "qualified",
        "reviewer_dispatch_intent",
        "reviewer_dispatched",
        "review_collect_intent",
        "approved",
        "publish_intent",
        "published",
        "integrate_intent",
        "landed",
        "handoff",
      ].includes(unit.state) &&
      (unit.verificationBaseOid === undefined ||
        unit.verificationHeadOid === undefined ||
        unit.verificationTree === undefined ||
        unit.verificationEvidenceHash === undefined)
    )
      errors.push(`qualification lifecycle ${id} lacks verification evidence`);
    if (unit.verificationCommands !== undefined) {
      const verificationError = committedVerificationError(unit);
      if (verificationError !== undefined)
        errors.push(`verification commands ${id} ${verificationError}`);
    }
    if (
      [
        "verification_intent",
        "qualified",
        "reviewer_dispatch_intent",
        "reviewer_dispatched",
        "review_collect_intent",
        "approved",
        "publish_intent",
        "published",
        "integrate_intent",
        "landed",
        "handoff",
      ].includes(unit.state)
    ) {
      const verificationError = committedVerificationError(unit);
      if (verificationError !== undefined)
        errors.push(`qualification ${id} ${verificationError}`);
    }
    if (
      [
        "reviewer_dispatch_intent",
        "reviewer_dispatched",
        "review_collect_intent",
      ].includes(unit.state) &&
      unit.reviewerPacket === undefined
    )
      errors.push(`review lifecycle ${id} lacks exact launch packet`);
    if (unit.reviewerPacket !== undefined) {
      const packetError = launchPacketError(
        unit.reviewerPacket,
        unit,
        "reviewer",
      );
      if (packetError !== undefined)
        errors.push(`review packet ${id} ${packetError}`);
    }
    if (
      ["reviewer_dispatched", "review_collect_intent"].includes(unit.state) &&
      (unit.reviewerSessionId === undefined ||
        unit.reviewPromptHash === undefined ||
        unit.reviewerRequestedModel === undefined ||
        unit.reviewerReturnedModel === undefined)
    )
      errors.push(`review lifecycle ${id} lacks bound session`);
    if (
      [
        "approved",
        "publish_intent",
        "published",
        "integrate_intent",
        "landed",
        "handoff",
      ].includes(unit.state) &&
      (unit.reviewBaseOid === undefined ||
        unit.reviewHeadOid === undefined ||
        unit.reviewTree === undefined ||
        unit.approvalResponseHash === undefined)
    )
      errors.push(`approval lifecycle ${id} lacks exact verdict`);
    if (
      ["published", "handoff"].includes(unit.state) &&
      unit.publishedHeadOid === undefined
    )
      errors.push(`published unit ${id} lacks remote-head readback`);
    if (
      state.completionBoundary === "pr-handoff" &&
      unit.state === "handoff" &&
      (unit.openPullRequest === undefined ||
        unit.openPullRequest.baseRef !== state.integrationBranch ||
        unit.openPullRequest.baseOid !== unit.reviewBaseOid ||
        unit.openPullRequest.remoteHeadOid !== unit.publishedHeadOid ||
        unit.openPullRequest.remoteHeadOid !== unit.candidateHead)
    )
      errors.push(
        `open-pr handoff ${id} lacks exact open pull-request evidence`,
      );
    if (
      unit.openPullRequest !== undefined &&
      state.completionBoundary !== "pr-handoff"
    )
      errors.push(
        `unit ${id} retains pull-request evidence outside open-pr authority`,
      );
    if (unit.state === "landed" && unit.landedOid === undefined)
      errors.push(`landed ${id} lacks integration readback`);
    if (unit.state === "repair_required" && unit.repairContext === undefined)
      errors.push(`repair-required ${id} lacks retained repair context`);
    if (
      unit.workerSessionId !== undefined &&
      unit.workerSessionId === unit.reviewerSessionId
    )
      errors.push(`unit ${id} reuses one session for worker and reviewer`);
    for (const [role, session] of [
      ["worker", unit.workerSessionId],
      ["reviewer", unit.reviewerSessionId],
    ] as const) {
      if (session === undefined) continue;
      if (!hasCurrentSessionLineage(session, unit.ordinal, role))
        errors.push(`session ${session} lacks exact durable lineage`);
      if (controllerIdentityMatches(state, session))
        errors.push(`session ${session} aliases controller identity`);
      const prior = assignedSessions.get(session);
      if (prior !== undefined)
        errors.push(
          `session ${session} is shared by ${prior} and ${id}/${role}`,
        );
      else assignedSessions.set(session, `${id}/${role}`);
    }
    const isActive = state.activeModifyingUnitIds.includes(id);
    const ambiguousKind =
      unresolved[0]?.status === "ambiguous" ? unresolved[0].kind : undefined;
    const allowedActive =
      optionallyActiveStates.has(unit.state) ||
      (unit.state === "blocked" &&
        ambiguousKind !== undefined &&
        [
          "dispatch",
          "repair",
          "worker_collect",
          "failure",
          "timeout",
          "park",
          "cancel",
        ].includes(ambiguousKind));
    if (
      (requiredActiveStates.has(unit.state) && !isActive) ||
      (isActive && !allowedActive)
    )
      errors.push(`active-session set disagrees with ${id}`);
  }
  for (const [id, reservation] of Object.entries(state.reservations)) {
    if (id !== reservation.id)
      errors.push(`reservation map key ${id} does not match reservation id`);
    if (state.units[reservation.unitId] === undefined)
      errors.push(`reservation ${id} has unknown owner`);
    const effectId =
      reservation.state === "released"
        ? reservation.releaseEffectId
        : reservation.acquireEffectId;
    const kind =
      reservation.state === "released"
        ? "reservation_release"
        : "reservation_acquire";
    if (
      ["reserved", "released"].includes(reservation.state) &&
      (effectId === undefined ||
        !state.effectJournal.some(
          (effect) =>
            effect.effectId === effectId &&
            effect.unitId === reservation.unitId &&
            effect.kind === kind &&
            effect.status === "observed",
        ))
    )
      errors.push(`reserved ${id} has no exact acquisition journal lineage`);
  }
  const controllerUnresolved = state.effectJournal.filter(
    (effect) =>
      effect.unitId === null &&
      (effect.status === "intended" || effect.status === "ambiguous"),
  );
  const expectedControllerKind =
    state.controller.state === "acquire_intent"
      ? "controller_acquire"
      : state.controller.state === "release_intent"
        ? "controller_release"
        : undefined;
  if (
    (expectedControllerKind === undefined &&
      controllerUnresolved.length !== 0) ||
    (expectedControllerKind !== undefined &&
      (controllerUnresolved.length !== 1 ||
        controllerUnresolved[0]?.kind !== expectedControllerKind))
  )
    errors.push("controller has an orphan or multiple unresolved effects");
  const qualificationQueueStates = new Set<UnitState>([
    "candidate_committed",
    "verification_intent",
    "qualified",
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
    "approved",
    "publish_intent",
    "published",
    "integrate_intent",
  ]);
  const integrationQueueStates = new Set<UnitState>([
    "approved",
    "publish_intent",
    "published",
    "integrate_intent",
  ]);
  const expectedQualificationQueue = Object.values(state.units)
    .filter(
      (unit) =>
        qualificationQueueStates.has(unit.state) ||
        (state.qualificationOwnerUnitId === unit.id &&
          [
            "failure_intent",
            "timeout_intent",
            "park_intent",
            "cancel_intent",
          ].includes(unit.state)),
    )
    .map((unit) => unit.id)
    .sort();
  const expectedIntegrationQueue = Object.values(state.units)
    .filter((unit) => integrationQueueStates.has(unit.state))
    .map((unit) => unit.id)
    .sort();
  if (
    state.qualificationQueue.join("\u0000") !==
    expectedQualificationQueue.join("\u0000")
  )
    errors.push("qualification queue disagrees with unit state");
  if (
    state.integrationQueue.join("\u0000") !==
    expectedIntegrationQueue.join("\u0000")
  )
    errors.push("integration queue disagrees with unit state");
  const qualificationOwnerStates = new Set<UnitState>([
    "verification_intent",
    "qualified",
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
    "approved",
    "publish_intent",
    "published",
    "integrate_intent",
  ]);
  const qualificationOwnerAllowedStates = new Set<UnitState>([
    ...qualificationOwnerStates,
    // A terminal act begun while qualification/review owns the unit retains
    // that owner until its exact observation is recorded.
    "failure_intent",
    "timeout_intent",
    "park_intent",
    "cancel_intent",
  ]);
  if (
    state.qualificationOwnerUnitId !== undefined &&
    !qualificationOwnerAllowedStates.has(
      state.units[state.qualificationOwnerUnitId]?.state ?? "planned",
    )
  )
    errors.push("qualification owner is not qualifying");
  for (const unit of Object.values(state.units))
    if (
      qualificationOwnerStates.has(unit.state) &&
      state.qualificationOwnerUnitId !== unit.id
    )
      errors.push(`qualifying unit ${unit.id} lacks owner converse`);
  if (
    state.qualificationOwnerUnitId !== undefined &&
    state.qualificationQueue[0] !== state.qualificationOwnerUnitId
  )
    errors.push("qualification owner is not queue head");
  if (
    state.integrationOwnerUnitId !== undefined &&
    state.units[state.integrationOwnerUnitId]?.state !== "integrate_intent"
  )
    errors.push("integration owner is not integrating");
  for (const unit of Object.values(state.units))
    if (
      unit.state === "integrate_intent" &&
      state.integrationOwnerUnitId !== unit.id
    )
      errors.push(
        `integrating unit ${unit.id} lacks integration owner converse`,
      );
  if (
    state.integrationOwnerUnitId !== undefined &&
    state.integrationQueue[0] !== state.integrationOwnerUnitId
  )
    errors.push("integration owner is not queue head");
  const reviewerStates = new Set<UnitState>([
    "reviewer_dispatch_intent",
    "reviewer_dispatched",
    "review_collect_intent",
  ]);
  const reviewerOwnerStates = new Set<UnitState>([
    ...reviewerStates,
    "failure_intent",
    "timeout_intent",
    "park_intent",
    "cancel_intent",
  ]);
  if (
    state.currentReviewerUnitId !== undefined &&
    !reviewerOwnerStates.has(
      state.units[state.currentReviewerUnitId]?.state ?? "planned",
    )
  )
    errors.push("current reviewer is not active");
  for (const unit of Object.values(state.units))
    if (
      reviewerStates.has(unit.state) &&
      state.currentReviewerUnitId !== unit.id
    )
      errors.push(`reviewer unit ${unit.id} lacks current reviewer converse`);
  if (
    state.currentReviewerUnitId !== undefined &&
    state.qualificationOwnerUnitId !== state.currentReviewerUnitId
  )
    errors.push("reviewer is not owned by qualification");
  if (
    state.state === "blocked" &&
    controllerUnresolved.every((entry) => entry.status !== "ambiguous") &&
    !Object.values(state.units).some((unit) => unit.state === "blocked")
  )
    errors.push("blocked aggregate lacks ambiguous durable evidence");
  if (state.state === "active" && state.controller.state !== "acquired")
    errors.push("active aggregate lacks controller ownership");
  if (state.state === "released" && state.controller.state !== "released")
    errors.push("released aggregate lacks controller release readback");
  if (state.controller.state === "released" && state.state !== "released")
    errors.push("released controller has non-released aggregate");
  return errors;
}
function illegal(unit: Unit, eventType: ProtocolEvent["type"]): Reduction {
  return reject(
    "illegal_transition",
    `${eventType} is not legal while ${unit.id} is ${unit.state}`,
  );
}
function reject(
  code: Extract<Reduction, { ok: false }>["code"],
  reason: string,
): Reduction {
  return { ok: false, code, reason };
}
function exhaustive(value: never): never {
  throw new Error(`Unhandled protocol event: ${JSON.stringify(value)}`);
}
