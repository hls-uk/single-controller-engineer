/** Versioned, fail-closed adapter for the protocol reducer's harness effects. */
import { isAbsolute, normalize, resolve } from "node:path";

import { Type, type Static, type TProperties } from "@sinclair/typebox";

import type {
  ExecuteResult,
  ReconcileResult,
  RecoveryEffectAdapter,
} from "../commands/recovery.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical.js";
import { sha256 } from "../protocol/evidence.js";
import { rehydrateEffect, type ProtocolEffect } from "../protocol/reducer.js";
import {
  ProtocolEventSchema,
  HARNESS_PACKET_BYTES,
  HarnessPacketInputSchema,
  HarnessPacketSchema,
  HarnessPacketBindingSchema,
  ReviewerJudgmentSchema,
  WorkerResultSchema,
  validate,
  type ProtocolEvent,
  type HarnessPacketBinding,
  type HarnessPacketInput,
  type RepositoryRun,
  type RuntimeEffect,
} from "../protocol/schemas.js";

const VERIFY_TOOL_REQUEST_BYTES = 12_288;
const verifyCommand = () =>
  Type.String({ minLength: 1, maxLength: 1_024, maxUtf8Bytes: 1_024 });

export const HARNESS_VERSION = 1 as const;
export const PACKET_BYTES = HARNESS_PACKET_BYTES;
const TOOL_REQUEST_BYTES = PACKET_BYTES + 4_096;
const strictObject = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const identifier = () =>
  Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  });
const model = () => Type.String({ minLength: 1, maxLength: 256 });
const hash = () =>
  Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" });
const absolutePath = () =>
  Type.String({ minLength: 2, maxLength: 8_192, pattern: "^/[^\\u0000]*$" });

export const HarnessCapabilitiesSchema = strictObject({
  adapterVersion: Type.Literal(HARNESS_VERSION),
  family: identifier(),
  harnessVersion: Type.Literal(HARNESS_VERSION),
  operations: strictObject({
    cancel: Type.Boolean(),
    collect: Type.Boolean(),
    controllerIdentity: Type.Boolean(),
    inspect: Type.Boolean(),
    launch: Type.Boolean(),
    lookupByClientKey: Type.Boolean(),
    poll: Type.Boolean(),
    returnedModelIdentity: Type.Boolean(),
  }),
  schema: Type.Literal("sce.harness-capabilities"),
  version: Type.Literal(HARNESS_VERSION),
});
export type HarnessCapabilities = Static<typeof HarnessCapabilitiesSchema>;
export const HarnessControllerIdentitySchema = strictObject({
  harnessFamily: identifier(),
  harnessVersion: Type.Literal(HARNESS_VERSION),
  requestedModel: model(),
  returnedModel: model(),
  sessionId: identifier(),
});
export type HarnessControllerIdentity = Static<
  typeof HarnessControllerIdentitySchema
>;
const ModelRouteSchema = strictObject({
  acceptedReturnedModels: Type.Array(model(), {
    minItems: 1,
    maxItems: 16,
    uniqueItems: true,
  }),
  requestedModel: model(),
});
export const HarnessSupportSchema = strictObject({
  capabilities: HarnessCapabilitiesSchema,
  controller: ModelRouteSchema,
  frontier: ModelRouteSchema,
  schema: Type.Literal("sce.harness-support"),
  version: Type.Literal(HARNESS_VERSION),
  workhorse: ModelRouteSchema,
});
export type HarnessSupport = Static<typeof HarnessSupportSchema>;

export const HarnessLaunchRequestSchema = strictObject({
  clientKey: identifier(),
  packet: HarnessPacketBindingSchema,
  promptHash: hash(),
  readOnly: Type.Boolean(),
  requestedModel: model(),
  role: Type.Union([Type.Literal("reviewer"), Type.Literal("worker")]),
  unitId: identifier(),
  worktreePath: absolutePath(),
});
export type HarnessLaunchRequest = Static<typeof HarnessLaunchRequestSchema>;
export const HarnessSessionSchema = strictObject({
  clientKey: identifier(),
  fresh: Type.Literal(true),
  harnessFamily: identifier(),
  harnessVersion: Type.Literal(HARNESS_VERSION),
  promptHash: hash(),
  readOnly: Type.Boolean(),
  requestedModel: model(),
  returnedModel: model(),
  role: Type.Union([Type.Literal("reviewer"), Type.Literal("worker")]),
  sessionId: identifier(),
  worktreePath: absolutePath(),
});
export type HarnessSession = Static<typeof HarnessSessionSchema>;

/**
 * Narrow host-tool wire protocol. Hosts receive only a persisted effect
 * binding and can return an acknowledgement, never an arbitrary reducer
 * event. The runtime constructs the authoritative ProtocolEvent itself.
 */
const HarnessToolRequestBase = {
  effectId: identifier(),
  effectKind: Type.Union([
    Type.Literal("dispatch"),
    Type.Literal("worker_collect"),
    Type.Literal("review_dispatch"),
    Type.Literal("review_collect"),
    Type.Literal("repair"),
    Type.Literal("cancel"),
    Type.Literal("verify"),
  ]),
  idempotencyKey: identifier(),
  schema: Type.Literal("sce.harness-tool-request"),
  version: Type.Literal(HARNESS_VERSION),
};
export const HarnessToolRequestSchema = Type.Union([
  strictObject({
    ...HarnessToolRequestBase,
    operation: Type.Literal("launch"),
    request: HarnessLaunchRequestSchema,
  }),
  strictObject({
    ...HarnessToolRequestBase,
    operation: Type.Literal("lookup_inspect"),
    request: HarnessLaunchRequestSchema,
  }),
  strictObject({
    ...HarnessToolRequestBase,
    operation: Type.Literal("collect"),
    session: HarnessSessionSchema,
  }),
  strictObject({
    ...HarnessToolRequestBase,
    operation: Type.Literal("cancel"),
    session: HarnessSessionSchema,
  }),
  strictObject({
    ...HarnessToolRequestBase,
    operation: Type.Literal("poll"),
    session: HarnessSessionSchema,
  }),
  strictObject({
    ...HarnessToolRequestBase,
    baseOid: Type.String({
      minLength: 40,
      maxLength: 64,
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    }),
    commands: Type.Array(verifyCommand(), { minItems: 1, maxItems: 32 }),
    headOid: Type.String({
      minLength: 40,
      maxLength: 64,
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    }),
    operation: Type.Literal("verify"),
    treeOid: Type.String({
      minLength: 40,
      maxLength: 64,
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    }),
    worktreePath: absolutePath(),
  }),
]);
export type HarnessToolRequest = Static<typeof HarnessToolRequestSchema>;

const ToolAcknowledgementBase = {
  effectId: identifier(),
  schema: Type.Literal("sce.harness-tool-acknowledgement"),
  version: Type.Literal(HARNESS_VERSION),
};
export const HarnessToolAcknowledgementSchema = Type.Union([
  strictObject({
    ...ToolAcknowledgementBase,
    kind: Type.Literal("launch"),
    session: HarnessSessionSchema,
  }),
  strictObject({
    ...ToolAcknowledgementBase,
    kind: Type.Literal("launch_inspected"),
    lookupSessionId: identifier(),
    session: HarnessSessionSchema,
  }),
  strictObject({
    ...ToolAcknowledgementBase,
    kind: Type.Literal("worker_collected"),
    sessionId: identifier(),
    workerResult: WorkerResultSchema,
  }),
  strictObject({
    ...ToolAcknowledgementBase,
    judgment: ReviewerJudgmentSchema,
    kind: Type.Literal("review_collected"),
    sessionId: identifier(),
  }),
  strictObject({
    ...ToolAcknowledgementBase,
    kind: Type.Literal("cancelled"),
    sessionId: identifier(),
  }),
  strictObject({
    ...ToolAcknowledgementBase,
    baseOid: Type.String({
      minLength: 40,
      maxLength: 64,
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    }),
    commands: Type.Array(verifyCommand(), { minItems: 1, maxItems: 32 }),
    evidenceDigest: hash(),
    headOid: Type.String({
      minLength: 40,
      maxLength: 64,
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    }),
    kind: Type.Literal("verified"),
    passed: Type.Literal(true),
    treeOid: Type.String({
      minLength: 40,
      maxLength: 64,
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    }),
    worktreePath: absolutePath(),
  }),
]);
export type HarnessToolAcknowledgement = Static<
  typeof HarnessToolAcknowledgementSchema
>;

/**
 * Verification is deliberately a manual-tool boundary: no harness port is
 * given shell authority. Both request and acknowledgement bind the persisted
 * command list and exact candidate objects, and the reducer event is made here.
 */
export function verificationToolRequest(
  effect: ProtocolEffect,
  run: RepositoryRun,
): ExecuteResult {
  if (effect.kind !== "verify" || effect.unitId === null)
    return { status: "ambiguous" };
  const unit = run.units[effect.unitId];
  const worktreePath = canonicalAbsolutePath(unit?.worktreePath);
  if (unit === undefined || worktreePath === undefined)
    return { status: "ambiguous" };
  const raw = {
    baseOid: effect.params.candidate.baseOid,
    commands: effect.params.commands,
    effectId: effect.effectId,
    effectKind: "verify" as const,
    headOid: effect.params.candidate.headOid,
    idempotencyKey: effect.idempotencyKey,
    operation: "verify" as const,
    schema: "sce.harness-tool-request" as const,
    treeOid: effect.params.candidate.treeOid,
    version: HARNESS_VERSION,
    worktreePath,
  };
  const parsed = validate<HarnessToolRequest>(HarnessToolRequestSchema, raw);
  if (!parsed.ok || parsed.value === undefined) return { status: "ambiguous" };
  try {
    return new TextEncoder().encode(
      canonicalJson(parsed.value as unknown as JsonValue),
    ).byteLength <= VERIFY_TOOL_REQUEST_BYTES
      ? { status: "tool_request", toolRequest: parsed.value }
      : { status: "ambiguous" };
  } catch {
    return { status: "ambiguous" };
  }
}

export function acknowledgeVerificationTool(
  raw: unknown,
  run: RepositoryRun,
): ExecuteResult | undefined {
  let parsed: ReturnType<typeof validate<HarnessToolAcknowledgement>>;
  try {
    parsed = validate<HarnessToolAcknowledgement>(
      HarnessToolAcknowledgementSchema,
      raw,
    );
  } catch {
    return undefined;
  }
  if (
    !parsed.ok ||
    parsed.value === undefined ||
    parsed.value.kind !== "verified"
  )
    return undefined;
  const acknowledgement = parsed.value;
  const entry = run.effectJournal.find(
    (candidate) =>
      candidate.effectId === acknowledgement.effectId &&
      candidate.kind === "verify" &&
      (candidate.status === "intended" || candidate.status === "ambiguous"),
  );
  const effect = entry === undefined ? undefined : rehydrateEffect(run, entry);
  if (
    effect === undefined ||
    effect.kind !== "verify" ||
    effect.unitId === null ||
    acknowledgement.baseOid !== effect.params.candidate.baseOid ||
    acknowledgement.headOid !== effect.params.candidate.headOid ||
    acknowledgement.treeOid !== effect.params.candidate.treeOid ||
    acknowledgement.worktreePath !==
      canonicalAbsolutePath(run.units[effect.unitId]?.worktreePath) ||
    acknowledgement.commands.length !== effect.params.commands.length ||
    acknowledgement.commands.some(
      (command, index) => command !== effect.params.commands[index],
    )
  )
    return { status: "ambiguous" };
  return parsedEvent({
    baseOid: effect.params.candidate.baseOid,
    effectId: effect.effectId,
    effectKind: effect.kind,
    eventId: `harness-${effect.effectId}`,
    expectedRevision: run.revision,
    headOid: effect.params.candidate.headOid,
    observationHash: sha256(
      canonicalJson({
        domain: "sce.harness.verify-evidence/v1",
        effectId: effect.effectId,
        evidenceDigest: acknowledgement.evidenceDigest,
        paramsHash: effect.paramsHash,
      }),
    ),
    treeOid: effect.params.candidate.treeOid,
    type: "verification_observed",
    unitId: effect.unitId,
  });
}

/** The only host boundary. It receives persisted effects, never invented work. */
export interface HarnessPort {
  capabilities(): Promise<unknown>;
  cancel(effect: RuntimeEffect, session: HarnessSession): Promise<unknown>;
  collect(effect: RuntimeEffect, session: HarnessSession): Promise<unknown>;
  controllerIdentity(): Promise<unknown>;
  inspect(sessionId: string): Promise<unknown | undefined>;
  launch(request: HarnessLaunchRequest): Promise<unknown>;
  lookupByClientKey(clientKey: string): Promise<unknown | undefined>;
  poll(sessionId: string): Promise<unknown | undefined>;
}

export type PacketInput = HarnessPacketInput;
export type PacketResult =
  | Readonly<{
      hash: string;
      ok: true;
      payload: string;
      schema: "sce.harness-packet";
      version: 1;
    }>
  | Readonly<{ ok: false; reason: string }>;

/** Public parsing is total: malformed host/config values only return a refusal. */
export function parseHarnessSupport(
  input: unknown,
):
  | Readonly<{ ok: true; value: HarnessSupport }>
  | Readonly<{ ok: false; reason: string }> {
  let parsed: ReturnType<typeof validate<HarnessSupport>>;
  try {
    parsed = validate<HarnessSupport>(HarnessSupportSchema, input);
  } catch {
    return { ok: false, reason: "invalid harness support matrix" };
  }
  if (!parsed.ok || parsed.value === undefined)
    return { ok: false, reason: "invalid harness support matrix" };
  const support = parsed.value;
  if (
    !support.capabilities.operations.launch ||
    !support.capabilities.operations.inspect ||
    !support.capabilities.operations.lookupByClientKey ||
    !support.capabilities.operations.controllerIdentity ||
    !support.capabilities.operations.poll ||
    !support.capabilities.operations.collect ||
    !support.capabilities.operations.cancel ||
    !support.capabilities.operations.returnedModelIdentity
  )
    return {
      ok: false,
      reason: "harness lacks a complete trusted lifecycle capability",
    };
  const workhorseIdentities = [
    support.workhorse.requestedModel,
    ...support.workhorse.acceptedReturnedModels,
  ];
  const frontierTierIdentities = [
    support.frontier.requestedModel,
    ...support.frontier.acceptedReturnedModels,
    support.controller.requestedModel,
    ...support.controller.acceptedReturnedModels,
  ];
  if (intersects(workhorseIdentities, frontierTierIdentities))
    return { ok: false, reason: "model identities alias capability tiers" };
  return { ok: true, value: support };
}

/** Stable commitment carried by the durable `harness_configured` transition. */
export function harnessSupportCommitment(
  input: unknown,
):
  | Readonly<{ ok: true; value: string }>
  | Readonly<{ ok: false; reason: string }> {
  const parsed = parseHarnessSupport(input);
  if (!parsed.ok) return parsed;
  try {
    return ok(sha256(canonicalJson(parsed.value as unknown as JsonValue)));
  } catch {
    return fail("support matrix cannot be canonicalized");
  }
}

export function createPacket(input: unknown): PacketResult {
  try {
    const parsed = validate<HarnessPacketInput>(
      HarnessPacketInputSchema,
      input,
    );
    if (!parsed.ok || parsed.value === undefined)
      return { ok: false, reason: "invalid harness packet" };
    const packet = parsed.value;
    const value = {
      acceptance: sortedStrings(packet.acceptance),
      baseOid: packet.baseOid,
      ...(packet.role === "reviewer" ? { diff: packet.diff } : {}),
      ...(packet.role === "reviewer" ? { headOid: packet.headOid } : {}),
      mandatoryVerification: sortedStrings(packet.mandatoryVerification),
      ownedPaths: sortedStrings(packet.ownedPaths),
      role: packet.role,
      schema: "sce.harness-packet" as const,
      unitId: packet.unitId,
      version: HARNESS_VERSION,
    };
    const checked = validate(HarnessPacketSchema, value);
    if (!checked.ok || checked.value === undefined)
      return { ok: false, reason: "invalid harness packet" };
    const canonical = checked.value;
    const payload = canonicalJson(canonical as unknown as JsonValue);
    if (new TextEncoder().encode(payload).byteLength > PACKET_BYTES)
      return { ok: false, reason: "packet exceeds bounded launch size" };
    return {
      hash: sha256(`sce.harness-packet/v1\n${payload}`),
      ok: true,
      payload,
      schema: "sce.harness-packet",
      version: HARNESS_VERSION,
    };
  } catch {
    return { ok: false, reason: "packet cannot be canonicalized" };
  }
}

/**
 * Converts only persisted harness effects into exact existing ProtocolEvents.
 * There is no harness run, store, journal, or independent slot accounting.
 */
export function createHarnessRecoveryEffectAdapter(
  supportInput: unknown,
  port?: HarnessPort,
): RecoveryEffectAdapter {
  const parsedSupport = parseHarnessSupport(supportInput);
  const support = parsedSupport.ok ? parsedSupport.value : undefined;
  return {
    canExecute: (effect) => support !== undefined && harnessEffect(effect),
    canReconcile: (effect) => support !== undefined && harnessEffect(effect),
    execute: async (effect, run) => await execute(effect, run, support, port),
    reconcile: async (effect, run) =>
      await reconcile(effect, run, support, port),
    acknowledge: async (acknowledgement, run) =>
      acknowledgeHarnessTool(acknowledgement, run, support),
  };
}

function harnessEffect(effect: ProtocolEffect): boolean {
  return (
    [
      "dispatch",
      "worker_collect",
      "review_dispatch",
      "review_collect",
      "repair",
    ].includes(effect.kind) ||
    (effect.kind === "cancel" && effect.params.role !== "none")
  );
}

async function execute(
  effect: ProtocolEffect,
  run: RepositoryRun,
  support: HarnessSupport | undefined,
  port: HarnessPort | undefined,
): Promise<ExecuteResult> {
  if (!harnessEffect(effect)) return { status: "unavailable" };
  if (support === undefined) return { status: "unavailable" };
  if (port === undefined) return toolRequest(effect, run, support);
  const checked = await supportMatches(support, port);
  if (!checked.ok) return { status: "ambiguous" };
  if (
    !matchesConfiguration(run, checked.value) ||
    !controllerMatches(run, checked.value)
  )
    return { status: "ambiguous" };
  if (!(await trustedController(run, checked.value, port)))
    return { status: "ambiguous" };
  if (
    effect.kind === "dispatch" ||
    effect.kind === "repair" ||
    effect.kind === "review_dispatch"
  ) {
    if (!checked.value.capabilities.operations.launch)
      return { status: "ambiguous" };
    const request = launchRequest(effect, run, checked.value);
    if (!request.ok) return { status: "ambiguous" };
    try {
      const acknowledgement = await port.launch(request.value);
      const launched = exactSession(
        checked.value,
        request.value,
        acknowledgement,
      );
      if (!launched.ok) return { status: "ambiguous" };
      const inspected = await port.inspect(launched.value.sessionId);
      if (inspected === undefined) return { status: "ambiguous" };
      return observationForLaunch(
        effect,
        run,
        checked.value,
        request.value,
        inspected,
      );
    } catch {
      return { status: "ambiguous" };
    }
  }
  const session = sessionForEffect(effect, run, checked.value);
  if (!session.ok) return { status: "ambiguous" };
  if (
    ((effect.kind === "worker_collect" || effect.kind === "review_collect") &&
      !checked.value.capabilities.operations.collect) ||
    (effect.kind === "cancel" && !checked.value.capabilities.operations.cancel)
  )
    return { status: "ambiguous" };
  try {
    const raw =
      effect.kind === "worker_collect" || effect.kind === "review_collect"
        ? await port.collect(effect as RuntimeEffect, session.value)
        : await port.cancel(effect as RuntimeEffect, session.value);
    return acknowledgeHarnessTool(raw, run, checked.value, effect.effectId);
  } catch {
    return { status: "ambiguous" };
  }
}

async function reconcile(
  effect: ProtocolEffect,
  run: RepositoryRun,
  support: HarnessSupport | undefined,
  port: HarnessPort | undefined,
): Promise<ReconcileResult> {
  if (!harnessEffect(effect)) return { status: "unavailable" };
  if (support === undefined) return { status: "unavailable" };
  if (port === undefined) return recoveryToolRequest(effect, run, support);
  const checked = await supportMatches(support, port);
  if (!checked.ok) return { status: "ambiguous" };
  if (
    !matchesConfiguration(run, checked.value) ||
    !controllerMatches(run, checked.value)
  )
    return { status: "ambiguous" };
  if (!(await trustedController(run, checked.value, port)))
    return { status: "ambiguous" };
  if (
    effect.kind === "dispatch" ||
    effect.kind === "repair" ||
    effect.kind === "review_dispatch"
  ) {
    if (!checked.value.capabilities.operations.lookupByClientKey)
      return { status: "ambiguous" };
    try {
      const found = await port.lookupByClientKey(effect.idempotencyKey);
      if (found === undefined) return { status: "ambiguous" };
      const request = launchRequest(effect, run, checked.value);
      if (!request.ok) return { status: "ambiguous" };
      const launched = exactSession(checked.value, request.value, found);
      if (!launched.ok) return { status: "ambiguous" };
      const inspected = await port.inspect(launched.value.sessionId);
      return inspected === undefined
        ? { status: "ambiguous" }
        : asReconcile(
            observationForLaunch(
              effect,
              run,
              checked.value,
              request.value,
              inspected,
            ),
          );
    } catch {
      return { status: "ambiguous" };
    }
  }
  if (!checked.value.capabilities.operations.poll)
    return { status: "ambiguous" };
  const session = sessionForEffect(effect, run, checked.value);
  if (!session.ok) return { status: "ambiguous" };
  try {
    const terminal = await port.poll(session.value.sessionId);
    if (terminal === undefined) return { status: "ambiguous" };
    return asReconcile(
      acknowledgeHarnessTool(terminal, run, checked.value, effect.effectId),
    );
  } catch {
    return { status: "ambiguous" };
  }
}

function launchRequest(
  effect: ProtocolEffect,
  run: RepositoryRun,
  support: HarnessSupport,
): Result<HarnessLaunchRequest> {
  if (effect.unitId === null) return fail("harness effect lacks unit");
  const unit = run.units[effect.unitId];
  if (unit === undefined) return fail("harness unit is absent");
  const reviewer = effect.kind === "review_dispatch";
  const worker = effect.kind === "dispatch" || effect.kind === "repair";
  if (!reviewer && !worker) return fail("effect does not launch a session");
  const params = effect.params as Extract<
    RuntimeEffect,
    { kind: "dispatch" | "repair" | "review_dispatch" }
  >["params"];
  const worktreePath = canonicalAbsolutePath(unit.worktreePath);
  if (worktreePath === undefined)
    return fail("unit worktree is not canonical absolute");
  if (
    !matchesConfiguration(run, support) ||
    !controllerMatches(run, support) ||
    params.requestedModel !==
      (reviewer ? support.frontier : support.workhorse).requestedModel
  )
    return fail("model route does not match trusted support matrix");
  if (params.promptHash !== params.packet.hash)
    return fail("launch prompt hash is not bound to the exact packet");
  return ok({
    clientKey: effect.idempotencyKey,
    packet: params.packet,
    promptHash: params.packet.hash,
    readOnly: reviewer,
    requestedModel: params.requestedModel,
    role: reviewer ? "reviewer" : "worker",
    unitId: unit.id,
    worktreePath,
  });
}

function observationForLaunch(
  effect: ProtocolEffect,
  run: RepositoryRun,
  support: HarnessSupport,
  request: HarnessLaunchRequest,
  raw: unknown,
): ExecuteResult {
  const session = exactSession(support, request, raw);
  if (!session.ok) return { status: "ambiguous" };
  const type =
    request.role === "reviewer"
      ? "reviewer_observed"
      : effect.kind === "repair"
        ? "repair_observed"
        : "dispatch_observed";
  const event = {
    effectId: effect.effectId,
    effectKind: effect.kind,
    eventId: `harness-${effect.effectId}`,
    expectedRevision: run.revision,
    observationHash: observationHash(effect, session.value),
    promptHash: session.value.promptHash,
    requestedModel: session.value.requestedModel,
    returnedModel: session.value.returnedModel,
    sessionId: session.value.sessionId,
    type,
    unitId: effect.unitId,
  };
  return parsedEvent(event);
}

function sessionForEffect(
  effect: ProtocolEffect,
  run: RepositoryRun,
  support: HarnessSupport,
): Result<HarnessSession> {
  if (effect.unitId === null) return fail("harness effect lacks unit");
  const unit = run.units[effect.unitId];
  if (unit === undefined) return fail("harness unit is absent");
  const reviewer =
    effect.kind === "review_collect" ||
    (effect.kind === "cancel" && effect.params.role === "reviewer");
  const sessionId = reviewer ? unit.reviewerSessionId : unit.workerSessionId;
  const requestedModel = reviewer
    ? unit.reviewerRequestedModel
    : unit.workerRequestedModel;
  const returnedModel = reviewer
    ? unit.reviewerReturnedModel
    : unit.workerReturnedModel;
  const packet = reviewer ? unit.reviewerPacket : unit.workerPacket;
  const promptHash = reviewer ? unit.reviewPromptHash : unit.workerPromptHash;
  const worktreePath = canonicalAbsolutePath(unit.worktreePath);
  if (
    sessionId === undefined ||
    requestedModel === undefined ||
    returnedModel === undefined ||
    packet === undefined ||
    promptHash === undefined ||
    worktreePath === undefined
  )
    return fail("durable session binding is incomplete");
  if (promptHash !== packet.hash)
    return fail("durable prompt hash is not bound to the exact packet");
  const request: HarnessLaunchRequest = {
    clientKey: launchClientKey(run, unit.id, reviewer ? "reviewer" : "worker"),
    packet,
    promptHash: packet.hash,
    readOnly: reviewer,
    requestedModel,
    role: reviewer ? "reviewer" : "worker",
    unitId: unit.id,
    worktreePath,
  };
  return exactSession(support, request, {
    clientKey: request.clientKey,
    fresh: true,
    harnessFamily: support.capabilities.family,
    harnessVersion: support.capabilities.harnessVersion,
    promptHash: request.promptHash,
    readOnly: request.readOnly,
    requestedModel: request.requestedModel,
    returnedModel,
    role: request.role,
    sessionId,
    worktreePath: request.worktreePath,
  });
}

/**
 * Accepts the narrow tool acknowledgement only after locating the exact
 * persisted effect. It cannot smuggle a ProtocolEvent wrapper across the
 * host boundary; effect kind, revision, bindings and observation digest all
 * come from authoritative runtime state.
 */
function acknowledgeHarnessTool(
  raw: unknown,
  run: RepositoryRun,
  support: HarnessSupport | undefined,
  expectedEffectId?: string,
): ExecuteResult {
  if (support === undefined) return { status: "unavailable" };
  let parsed: ReturnType<typeof validate<HarnessToolAcknowledgement>>;
  try {
    parsed = validate<HarnessToolAcknowledgement>(
      HarnessToolAcknowledgementSchema,
      raw,
    );
  } catch {
    return { status: "ambiguous" };
  }
  if (!parsed.ok || parsed.value === undefined) return { status: "ambiguous" };
  const acknowledgement = parsed.value;
  if (
    (expectedEffectId !== undefined &&
      acknowledgement.effectId !== expectedEffectId) ||
    !matchesConfiguration(run, support) ||
    !controllerMatches(run, support)
  )
    return { status: "ambiguous" };
  const entry = run.effectJournal.find(
    (candidate) =>
      candidate.effectId === acknowledgement.effectId &&
      (candidate.status === "intended" || candidate.status === "ambiguous"),
  );
  if (entry === undefined) return { status: "ambiguous" };
  const effect = rehydrateEffect(run, entry);
  if (effect === undefined || effect.unitId === null)
    return { status: "ambiguous" };
  if (acknowledgement.kind === "launch") {
    if (!["dispatch", "repair", "review_dispatch"].includes(effect.kind))
      return { status: "ambiguous" };
    const request = launchRequest(effect, run, support);
    if (!request.ok) return { status: "ambiguous" };
    const launched = exactSession(
      support,
      request.value,
      acknowledgement.session,
    );
    return launched.ok
      ? recoveryToolRequest(effect, run, support)
      : { status: "ambiguous" };
  }
  if (acknowledgement.kind === "launch_inspected") {
    if (!["dispatch", "repair", "review_dispatch"].includes(effect.kind))
      return { status: "ambiguous" };
    if (acknowledgement.lookupSessionId !== acknowledgement.session.sessionId)
      return { status: "ambiguous" };
    const request = launchRequest(effect, run, support);
    return request.ok
      ? observationForLaunch(
          effect,
          run,
          support,
          request.value,
          acknowledgement.session,
        )
      : { status: "ambiguous" };
  }
  if (acknowledgement.kind === "verified") return { status: "ambiguous" };
  const session = sessionForEffect(effect, run, support);
  if (!session.ok || acknowledgement.sessionId !== session.value.sessionId)
    return { status: "ambiguous" };
  if (acknowledgement.kind === "worker_collected") {
    if (effect.kind !== "worker_collect") return { status: "ambiguous" };
    return parsedEvent({
      effectId: effect.effectId,
      effectKind: effect.kind,
      eventId: `harness-${effect.effectId}`,
      expectedRevision: run.revision,
      observationHash: observationHash(effect, session.value),
      promptHash: session.value.promptHash,
      requestedModel: session.value.requestedModel,
      returnedModel: session.value.returnedModel,
      sessionId: session.value.sessionId,
      type: "worker_collected",
      unitId: effect.unitId,
      workerResult: acknowledgement.workerResult,
    });
  }
  if (acknowledgement.kind === "review_collected") {
    if (
      effect.kind !== "review_collect" ||
      acknowledgement.judgment.sessionId !== session.value.sessionId ||
      acknowledgement.judgment.requestedModel !==
        session.value.requestedModel ||
      acknowledgement.judgment.returnedModel !== session.value.returnedModel ||
      acknowledgement.judgment.promptHash !== session.value.promptHash
    )
      return { status: "ambiguous" };
    return parsedEvent({
      effectId: effect.effectId,
      effectKind: effect.kind,
      eventId: `harness-${effect.effectId}`,
      expectedRevision: run.revision,
      judgment: acknowledgement.judgment,
      observationHash: observationHash(effect, session.value),
      type: "review_collected",
      unitId: effect.unitId,
    });
  }
  if (acknowledgement.kind === "cancelled") {
    if (effect.kind !== "cancel") return { status: "ambiguous" };
    return parsedEvent({
      effectId: effect.effectId,
      effectKind: effect.kind,
      eventId: `harness-${effect.effectId}`,
      expectedRevision: run.revision,
      observationHash: observationHash(effect, session.value),
      promptHash: session.value.promptHash,
      requestedModel: session.value.requestedModel,
      returnedModel: session.value.returnedModel,
      role: session.value.role,
      sessionId: session.value.sessionId,
      type: "cancel_observed",
      unitId: effect.unitId,
    });
  }
  return { status: "ambiguous" };
}

/** Deterministic request for hosts that expose a tool instead of a direct port. */
function toolRequest(
  effect: ProtocolEffect,
  run: RepositoryRun,
  support: HarnessSupport,
  recovery = false,
): ExecuteResult {
  if (!matchesConfiguration(run, support) || !controllerMatches(run, support))
    return { status: "ambiguous" };
  const launch = ["dispatch", "repair", "review_dispatch"].includes(
    effect.kind,
  );
  const request = launch ? launchRequest(effect, run, support) : undefined;
  if (launch && !request?.ok) return { status: "ambiguous" };
  const session = launch ? undefined : sessionForEffect(effect, run, support);
  if (!launch && !session?.ok) return { status: "ambiguous" };
  const raw = {
    effectId: effect.effectId,
    effectKind: effect.kind,
    idempotencyKey: effect.idempotencyKey,
    operation: launch
      ? recovery
        ? "lookup_inspect"
        : "launch"
      : recovery
        ? "poll"
        : effect.kind === "cancel"
          ? "cancel"
          : "collect",
    ...(request?.ok ? { request: request.value } : {}),
    schema: "sce.harness-tool-request" as const,
    ...(session?.ok ? { session: session.value } : {}),
    version: HARNESS_VERSION,
  };
  const parsed = validate<HarnessToolRequest>(HarnessToolRequestSchema, raw);
  if (!parsed.ok || parsed.value === undefined) return { status: "ambiguous" };
  try {
    if (
      new TextEncoder().encode(
        canonicalJson(parsed.value as unknown as JsonValue),
      ).byteLength > TOOL_REQUEST_BYTES
    )
      return { status: "ambiguous" };
  } catch {
    return { status: "ambiguous" };
  }
  return { status: "tool_request", toolRequest: parsed.value };
}

/**
 * Manual recovery is read-only: launch effects lookup by their persisted key
 * and inspect the returned session; collection/cancellation poll the durable
 * session. Neither path is an authorization to relaunch.
 */
function recoveryToolRequest(
  effect: ProtocolEffect,
  run: RepositoryRun,
  support: HarnessSupport,
):
  | Readonly<{ status: "ambiguous" }>
  | Readonly<{ status: "tool_request"; toolRequest: unknown }>
  | Readonly<{ status: "unavailable" }> {
  const result = toolRequest(effect, run, support, true);
  return result.status === "tool_request" || result.status === "unavailable"
    ? result
    : { status: "ambiguous" };
}

async function supportMatches(
  support: HarnessSupport | undefined,
  port: HarnessPort,
): Promise<Result<HarnessSupport>> {
  if (support === undefined) return fail("support matrix is invalid");
  try {
    const live = validate<HarnessCapabilities>(
      HarnessCapabilitiesSchema,
      await port.capabilities(),
    );
    if (
      !live.ok ||
      live.value === undefined ||
      canonicalJson(live.value as unknown as JsonValue) !==
        canonicalJson(support.capabilities as unknown as JsonValue)
    )
      return fail("live harness capabilities do not match support matrix");
    return ok(support);
  } catch {
    return fail("harness capabilities are unavailable");
  }
}

async function trustedController(
  run: RepositoryRun,
  support: HarnessSupport,
  port: HarnessPort,
): Promise<boolean> {
  try {
    const parsed = validate<HarnessControllerIdentity>(
      HarnessControllerIdentitySchema,
      await port.controllerIdentity(),
    );
    if (!parsed.ok || parsed.value === undefined) return false;
    const identity = parsed.value;
    return (
      identity.harnessFamily === support.capabilities.family &&
      identity.harnessVersion === support.capabilities.harnessVersion &&
      identity.sessionId === run.controller.incarnationId &&
      identity.requestedModel === run.controller.requestedModel &&
      identity.returnedModel === run.controller.returnedModel &&
      support.controller.requestedModel === identity.requestedModel &&
      support.controller.acceptedReturnedModels.includes(identity.returnedModel)
    );
  } catch {
    return false;
  }
}

function exactSession(
  support: HarnessSupport,
  request: HarnessLaunchRequest,
  raw: unknown,
): Result<HarnessSession> {
  const parsed = parseSession(raw);
  if (!parsed.ok) return parsed;
  const session = parsed.value;
  const route =
    request.role === "reviewer" ? support.frontier : support.workhorse;
  if (
    session.harnessFamily !== support.capabilities.family ||
    session.harnessVersion !== support.capabilities.harnessVersion ||
    session.clientKey !== request.clientKey ||
    session.promptHash !== request.promptHash ||
    session.readOnly !== request.readOnly ||
    session.requestedModel !== request.requestedModel ||
    session.role !== request.role ||
    session.worktreePath !== request.worktreePath ||
    route.requestedModel !== session.requestedModel ||
    !route.acceptedReturnedModels.includes(session.returnedModel)
  )
    return fail(
      "session acknowledgement does not bind trusted launch identity",
    );
  return ok(session);
}
function parseSession(input: unknown): Result<HarnessSession> {
  try {
    const parsed = validate<HarnessSession>(HarnessSessionSchema, input);
    return parsed.ok && parsed.value !== undefined
      ? ok(parsed.value)
      : fail("invalid harness session observation");
  } catch {
    return fail("invalid harness session observation");
  }
}
function controllerMatches(
  run: RepositoryRun,
  support: HarnessSupport,
): boolean {
  return (
    run.controller.requestedModel === support.controller.requestedModel &&
    support.controller.acceptedReturnedModels.includes(
      run.controller.returnedModel,
    )
  );
}
function matchesConfiguration(
  run: RepositoryRun,
  support: HarnessSupport,
): boolean {
  const commitment = harnessSupportCommitment(support);
  return (
    commitment.ok &&
    run.harness !== undefined &&
    run.harness.family === support.capabilities.family &&
    run.harness.adapterVersion === support.capabilities.adapterVersion &&
    run.harness.harnessVersion === support.capabilities.harnessVersion &&
    run.harness.supportCommitment === commitment.value
  );
}
function launchClientKey(
  run: RepositoryRun,
  unitId: string,
  role: "reviewer" | "worker",
): string {
  // The initial launch key is the durable dispatch effect idempotency key.
  // After observation, recoverable collection uses this stable bound identity.
  const entry = [...run.effectJournal]
    .reverse()
    .find(
      (candidate) =>
        candidate.unitId === unitId &&
        (role === "reviewer"
          ? candidate.kind === "review_dispatch"
          : candidate.kind === "dispatch" || candidate.kind === "repair"),
    );
  return entry?.idempotencyKey ?? "missing-client-key";
}
function asReconcile(result: ExecuteResult): ReconcileResult {
  return result.status === "observed"
    ? { status: "observed", observation: result.observation }
    : { status: "ambiguous" };
}
function parsedEvent(input: unknown): ExecuteResult {
  const parsed = validate<ProtocolEvent>(ProtocolEventSchema, input);
  return parsed.ok && parsed.value !== undefined
    ? { status: "observed", observation: parsed.value }
    : { status: "ambiguous" };
}
function observationHash(
  effect: ProtocolEffect,
  session: HarnessSession,
): string {
  return sha256(
    canonicalJson({
      effectId: effect.effectId,
      paramsHash: effect.paramsHash,
      returnedModel: session.returnedModel,
      sessionId: session.sessionId,
    }),
  );
}
function canonicalAbsolutePath(value: string | undefined): string | undefined {
  if (value === undefined || !isAbsolute(value) || value.includes("\u0000"))
    return undefined;
  const canonical = normalize(resolve(value));
  return canonical === "/" || canonical !== value ? undefined : canonical;
}
function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function intersects(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.some((value) => right.includes(value));
}
type Result<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: string }>;
function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail(reason: string): Result<never> {
  return { ok: false, reason };
}
