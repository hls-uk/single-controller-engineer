import { Type, type Static, type TProperties } from "@sinclair/typebox";
import { Ajv, type ValidateFunction } from "ajv";
import {
  createPacket,
  HarnessToolAcknowledgementSchema,
  type HarnessToolAcknowledgement,
} from "../harness/index.js";

import {
  RepositoryRunSchema,
  HarnessPacketInputSchema,
  PublicationRecoveryAcknowledgementSchema,
  validate,
  ProtocolEventSchema,
  type ProtocolEvent,
  type RepositoryRun,
} from "../protocol/schemas.js";
import {
  StoreFailureTailSchema,
  type StoreFailureTail,
} from "../fencing/index.js";
import {
  ambiguityRecoveryActions,
  legalActions,
  type ActionDescriptor,
} from "../protocol/actions.js";
import { sha256 } from "../protocol/evidence.js";
import {
  deriveCandidateDiffHash,
  deriveIdempotencyKey,
  runInvariantErrors,
} from "../protocol/reducer.js";
import {
  CANDIDATE_DIFF_DOMAIN,
  CandidateDigestCommandSchema,
} from "./candidate-digest.js";
import {
  createProductionRecoveryRunner,
  type ProductionRecoveryRunnerOptions,
} from "./production-recovery.js";
import type { RecoveryInvocation, RecoveryRequest } from "./recovery.js";

export * from "./candidate-digest.js";
export * from "./recovery.js";
export * from "./production-recovery.js";

export const commandNames = [
  "inspect",
  "harness-packet",
  "candidate-digest",
  "acquire-controller",
  "next",
  "plan-wave",
  "configure-harness",
  "prepare-wave",
  "dispatch-request",
  "repair-request",
  "record-dispatch",
  "collect-candidate",
  "recheck-candidate",
  "refresh-candidate",
  "qualify",
  "review-prepare",
  "review-record",
  "publish",
  "recover-publication-ref",
  "integrate",
  "close-unit",
  "gate-wave",
  "claim-provenance-carry",
  "resume",
  "status",
  "release-controller",
  "feedback",
] as const;

export type CommandName = (typeof commandNames)[number];

/** The commands whose request carries a repository run envelope. */
export const stateCommandNames = ["inspect", "next", "status"] as const;

export type StateCommandName = (typeof stateCommandNames)[number];

export function isStateCommandName(value: string): value is StateCommandName {
  return (stateCommandNames as readonly string[]).includes(value);
}

export const feedbackActions = [
  "prepare",
  "preview",
  "submit",
  "flush",
] as const;

export type FeedbackAction = (typeof feedbackActions)[number];

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface CommandOptions {
  readonly expectedRevision?: number;
  readonly idempotencyKey?: string;
  readonly json: boolean;
  readonly request?: JsonObject;
}

export const MAX_CLI_REQUEST_BYTES = 128 * 1024;
export const MAX_CLI_RESPONSE_BYTES = 128 * 1024;
const MAX_JSON_ITEMS = 256;
const MAX_TEXT = 16_384;
/** The protocol's shared identifier bound, which an event id also obeys. */
const MAX_IDENTIFIER_LENGTH = 160;

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}

export const JsonValueSchema = Type.Recursive((self) =>
  Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String({ maxLength: MAX_TEXT }),
    Type.Array(self, { maxItems: MAX_JSON_ITEMS }),
    Type.Record(Type.String({ maxLength: 160 }), self, {
      maxProperties: MAX_JSON_ITEMS,
    }),
  ]),
);
export const JsonObjectSchema = Type.Record(
  Type.String({ maxLength: 160 }),
  JsonValueSchema,
  { maxProperties: MAX_JSON_ITEMS },
);

const FeedbackActionSchema = Type.Union([
  Type.Literal("prepare"),
  Type.Literal("preview"),
  Type.Literal("submit"),
  Type.Literal("flush"),
]);

const RequestMetadataSchema = {
  expectedRevision: Type.Optional(
    Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  ),
  idempotencyKey: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
    }),
  ),
  json: Type.Boolean(),
};

export const StateRequestSchema = strictObject({ run: RepositoryRunSchema });
export type StateRequest = Static<typeof StateRequestSchema>;

const StateOptionsSchema = strictObject({
  ...RequestMetadataSchema,
  request: StateRequestSchema,
});
const HarnessPacketOptionsSchema = strictObject({
  json: Type.Boolean(),
  request: HarnessPacketInputSchema,
});
const NoPayloadOptionsSchema = strictObject(RequestMetadataSchema);
const FeedbackPrepareOptionsSchema = strictObject({
  json: Type.Boolean(),
  request: strictObject({
    narrative: Type.Optional(Type.Unknown()),
    telemetry: Type.Unknown(),
  }),
});
const FeedbackPreviewOptionsSchema = strictObject({
  json: Type.Boolean(),
  request: strictObject({ packet: Type.Unknown() }),
});
const FeedbackSubmitOptionsSchema = strictObject({
  json: Type.Boolean(),
  request: strictObject({
    authority: Type.Optional(Type.Unknown()),
    packet: Type.Unknown(),
  }),
});
const FeedbackFlushOptionsSchema = strictObject({
  json: Type.Boolean(),
  request: strictObject({
    authority: Type.Optional(Type.Unknown()),
    fingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  }),
});
const RecoveryEventPayloadSchema = strictObject({
  event: Type.Optional(ProtocolEventSchema),
});
const RecoveryAcknowledgementPayloadSchema = strictObject({
  harnessAcknowledgement: JsonObjectSchema,
});
const PublicationRecoveryPayloadSchema = strictObject({
  publicationRecovery: PublicationRecoveryAcknowledgementSchema,
});
const ProvenanceCarryClaimOptionsSchema = strictObject({
  json: Type.Boolean(),
  request: strictObject({
    predecessorRootBeadId: Type.String({
      minLength: 1,
      maxLength: 160,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
    }),
  }),
});
const RecoveryOptionsSchema = strictObject({
  ...RequestMetadataSchema,
  request: Type.Optional(
    Type.Union([
      RecoveryEventPayloadSchema,
      RecoveryAcknowledgementPayloadSchema,
    ]),
  ),
});
const PublicationRecoveryOptionsSchema = strictObject({
  ...RequestMetadataSchema,
  request: PublicationRecoveryPayloadSchema,
});

const StateCommandSchema = strictObject({
  command: Type.Union([
    Type.Literal("inspect"),
    Type.Literal("next"),
    Type.Literal("status"),
  ]),
  options: Type.Union([StateOptionsSchema, NoPayloadOptionsSchema]),
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1),
});
const HarnessPacketCommandSchema = strictObject({
  command: Type.Literal("harness-packet"),
  options: HarnessPacketOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1),
});
const FeedbackCommandSchema = Type.Union([
  strictObject({
    command: Type.Literal("feedback"),
    feedbackAction: Type.Literal("prepare"),
    options: FeedbackPrepareOptionsSchema,
    schema: Type.Literal("sce.command.request"),
    version: Type.Literal(1),
  }),
  strictObject({
    command: Type.Literal("feedback"),
    feedbackAction: Type.Literal("preview"),
    options: FeedbackPreviewOptionsSchema,
    schema: Type.Literal("sce.command.request"),
    version: Type.Literal(1),
  }),
  strictObject({
    command: Type.Literal("feedback"),
    feedbackAction: Type.Literal("submit"),
    options: FeedbackSubmitOptionsSchema,
    schema: Type.Literal("sce.command.request"),
    version: Type.Literal(1),
  }),
  strictObject({
    command: Type.Literal("feedback"),
    feedbackAction: Type.Literal("flush"),
    options: FeedbackFlushOptionsSchema,
    schema: Type.Literal("sce.command.request"),
    version: Type.Literal(1),
  }),
]);
const UnavailableCommandSchema = strictObject({
  command: Type.Union([
    Type.Literal("acquire-controller"),
    Type.Literal("plan-wave"),
    Type.Literal("configure-harness"),
    Type.Literal("prepare-wave"),
    Type.Literal("dispatch-request"),
    Type.Literal("repair-request"),
    Type.Literal("record-dispatch"),
    Type.Literal("collect-candidate"),
    Type.Literal("recheck-candidate"),
    Type.Literal("refresh-candidate"),
    Type.Literal("qualify"),
    Type.Literal("review-prepare"),
    Type.Literal("review-record"),
    Type.Literal("publish"),
    Type.Literal("integrate"),
    Type.Literal("close-unit"),
    Type.Literal("gate-wave"),
    Type.Literal("resume"),
    Type.Literal("release-controller"),
  ]),
  options: RecoveryOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1),
});
const PublicationRecoveryCommandSchema = strictObject({
  command: Type.Literal("recover-publication-ref"),
  options: PublicationRecoveryOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1),
});
const ProvenanceCarryClaimCommandSchema = strictObject({
  command: Type.Literal("claim-provenance-carry"),
  options: ProvenanceCarryClaimOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1),
});

export const CommandRequestSchema = Type.Union([
  StateCommandSchema,
  HarnessPacketCommandSchema,
  CandidateDigestCommandSchema,
  FeedbackCommandSchema,
  ProvenanceCarryClaimCommandSchema,
  PublicationRecoveryCommandSchema,
  UnavailableCommandSchema,
]);
export type CommandRequest = Static<typeof CommandRequestSchema>;

export const CommandRunnerResultSchema = Type.Union([
  strictObject({
    result: JsonObjectSchema,
    schema: Type.Literal("sce.command.result"),
    status: Type.Literal("ok"),
    version: Type.Literal(1),
  }),
  strictObject({
    code: Type.Literal("SCE_INVALID_STATE_REQUEST"),
    status: Type.Literal("invalid"),
    schema: Type.Literal("sce.command.result"),
    version: Type.Literal(1),
  }),
  strictObject({
    schema: Type.Literal("sce.command.result"),
    /**
     * The redacted tail of the remote child whose failure made the command
     * unavailable, when the recovery coordinator attributed one. Diagnostic
     * text for the operator; nothing branches on it.
     */
    stderrTail: Type.Optional(StoreFailureTailSchema),
    status: Type.Literal("unavailable"),
    version: Type.Literal(1),
  }),
  strictObject({
    code: Type.Literal("SCE_RECOVERY_BLOCKED"),
    schema: Type.Literal("sce.command.result"),
    stderrTail: Type.Optional(StoreFailureTailSchema),
    status: Type.Literal("blocked"),
    version: Type.Literal(1),
  }),
]);
export type CommandRunnerResult =
  | {
      readonly result: JsonObject;
      readonly schema: "sce.command.result";
      readonly status: "ok";
      readonly version: 1;
    }
  | {
      readonly code: "SCE_INVALID_STATE_REQUEST";
      readonly schema: "sce.command.result";
      readonly status: "invalid";
      readonly version: 1;
    }
  | {
      readonly schema: "sce.command.result";
      readonly stderrTail?: StoreFailureTail;
      readonly status: "unavailable";
      readonly version: 1;
    }
  | {
      readonly code: "SCE_RECOVERY_BLOCKED";
      readonly schema: "sce.command.result";
      readonly stderrTail?: StoreFailureTail;
      readonly status: "blocked";
      readonly version: 1;
    };

/**
 * One legal action bound to the exact `--request` payload that performs it.
 * The event carries every field its schema requires: the values this run
 * determines are already filled, and the rest are `<field>` placeholders.
 */
export const RequestSkeletonSchema = strictObject({
  event: Type.Record(
    Type.String({ maxLength: MAX_IDENTIFIER_LENGTH }),
    // A skeleton field is a scalar either way: a bound protocol value or the
    // `<field>` marker standing in for one. Nothing nested belongs here.
    Type.Union([
      Type.Null(),
      Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      Type.String({ maxLength: MAX_TEXT }),
    ]),
    // Every variant names at least an id, a revision, and a type, so an
    // event type this build cannot resolve is refused, never half-drawn.
    { maxProperties: 32, minProperties: 3 },
  ),
});
export type RequestSkeleton = Static<typeof RequestSkeletonSchema>;

/** The exact `next` result. Bounded and closed, so no stray key escapes. */
export const NextResultSchema = strictObject({
  legalActions: Type.Array(
    Type.Record(
      Type.String({ maxLength: MAX_IDENTIFIER_LENGTH }),
      Type.String({ maxLength: MAX_IDENTIFIER_LENGTH }),
      { maxProperties: 16 },
    ),
    { maxItems: MAX_JSON_ITEMS },
  ),
  requests: Type.Array(RequestSkeletonSchema, { maxItems: MAX_JSON_ITEMS }),
  revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
});
export type NextResult = Static<typeof NextResultSchema>;

/** The only execution seam used by the CLI. */
export type CommandRunner = (
  request: CommandRequest,
) => CommandRunnerResult | Promise<CommandRunnerResult>;

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true,
});
const utf8 = new TextEncoder();
ajv.addKeyword({
  keyword: "maxUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (limit: number, value: string) =>
    utf8.encode(value).byteLength <= limit,
  errors: false,
});
const requestValidator = ajv.compile(
  CommandRequestSchema,
) as ValidateFunction<CommandRequest>;
const runnerResultValidator = ajv.compile(
  CommandRunnerResultSchema,
) as ValidateFunction<CommandRunnerResult>;
const nextResultValidator = ajv.compile(NextResultSchema);

/**
 * Re-reads the assembled `next` result against its own closed schema. It is
 * cheap, and it keeps a malformed or oversized summary from reaching a
 * controller as though it were an authoritative list of moves.
 */
function validateNextResult(input: unknown): boolean {
  return nextResultValidator(input) === true;
}

export function validateCommandRequest(
  input: unknown,
): input is CommandRequest {
  return requestValidator(input);
}

export function validateCommandRunnerResult(
  input: unknown,
): input is CommandRunnerResult {
  return runnerResultValidator(input);
}

/**
 * The safe production runner is deliberately state-only. All external or
 * mutating commands remain unavailable until their adapters are implemented.
 */

export function validateCommandPayload(input: unknown): input is JsonObject {
  return isJsonObject(input) && ajv.validate(JsonObjectSchema, input);
}
export const stateOnlyCommandRunner: CommandRunner = (request) => {
  if (!validateCommandRequest(request)) return invalidStateRequest();
  if (isHarnessPacketCommandRequest(request)) {
    const packet = createPacket(request.options.request);
    return packet.ok
      ? {
          result: {
            hash: packet.hash,
            payload: packet.payload,
            schema: packet.schema,
            version: packet.version,
          },
          schema: "sce.command.result",
          status: "ok",
          version: 1,
        }
      : invalidStateRequest();
  }
  if (isCandidateDigestCommandRequest(request)) {
    const { diff, raw } = request.options.request;
    return {
      result: {
        candidateDiffByteCount: utf8.encode(diff).byteLength,
        candidateDiffHash: deriveCandidateDiffHash(diff),
        domain: CANDIDATE_DIFF_DOMAIN,
        ...(raw === true ? { sha256: sha256(diff) } : {}),
      },
      schema: "sce.command.result",
      status: "ok",
      version: 1,
    };
  }
  if (!isStateCommandRequest(request)) return unavailable();
  if (!("request" in request.options)) return invalidStateRequest();
  const parsedRun = validate<RepositoryRun>(
    RepositoryRunSchema,
    request.options.request.run,
  );
  if (!parsedRun.ok || parsedRun.value === undefined)
    return invalidStateRequest();
  const run = parsedRun.value;
  if (runInvariantErrors(run).length > 0) return invalidStateRequest();
  const ambiguities = ambiguityRecoveryActions(run).flatMap((action) =>
    action.effectId === undefined || action.effectKind === undefined
      ? []
      : [
          {
            effectId: action.effectId,
            effectKind: action.effectKind,
            observationType: action.type,
            unitId: action.unitId ?? null,
          },
        ],
  );
  if (request.command === "inspect") {
    return {
      schema: "sce.command.result",
      version: 1,
      status: "ok",
      result: {
        ambiguities,
        integrationBranch: run.integrationBranch,
        repositoryIdentity: run.repositoryIdentity,
        revision: run.revision,
        state: run.state,
        unitCount: Object.keys(run.units).length,
      },
    };
  }
  if (request.command === "status") {
    return {
      schema: "sce.command.result",
      version: 1,
      status: "ok",
      result: {
        activeModifyingUnitIds: [...run.activeModifyingUnitIds].sort(),
        ambiguities,
        effectCount: run.effectJournal.length,
        revision: run.revision,
        state: run.state,
      },
    };
  }
  const actions = legalActions(run);
  const result = {
    legalActions: actions.map((action) => ({ ...action })) as JsonValue,
    requests: actions
      .slice(0, MAX_JSON_ITEMS)
      .map((action) => requestSkeleton(run, action)) as JsonValue,
    revision: run.revision,
  };
  return validateNextResult(result)
    ? { schema: "sce.command.result", version: 1, status: "ok", result }
    : invalidStateRequest();
};

/**
 * The protocol event union read as data. Required-field lists come from the
 * schemas themselves, so a renamed or newly required field reaches the
 * skeletons without a second table to keep in step.
 */
const protocolEventVariants = (
  ProtocolEventSchema as unknown as {
    readonly anyOf: readonly {
      readonly properties?: { readonly type?: { readonly const?: unknown } };
      readonly required?: readonly string[];
    }[];
  }
).anyOf;

/**
 * The narrowest variant of `type` at the action's scope. Several event types
 * exist in both a unit-scoped and a gate-scoped form, and the gate-scoped one
 * is exactly the variant that requires `gateEntryId`.
 */
function requiredEventFields(
  type: string,
  gateScoped: boolean,
): readonly string[] {
  const variants = protocolEventVariants.filter(
    (variant) => variant.properties?.type?.const === type,
  );
  const scoped = variants.filter(
    (variant) =>
      (variant.required ?? []).includes("gateEntryId") === gateScoped,
  );
  return (
    (scoped.length === 0 ? variants : scoped)
      .map((variant) => variant.required ?? [])
      .sort((left, right) => left.length - right.length)[0] ?? []
  );
}

/**
 * The durable effect a record-mode action settles. Descriptors name it only
 * for ambiguity recovery; along the ordinary lifecycle it is the one journal
 * entry still outstanding for that unit, kind, and gate entry.
 */
function outstandingEffectId(
  run: RepositoryRun,
  action: ActionDescriptor,
): string | undefined {
  if (action.effectId !== undefined) return action.effectId;
  if (action.effectKind === undefined) return undefined;
  return run.effectJournal.find(
    (entry) =>
      (entry.status === "intended" || entry.status === "ambiguous") &&
      entry.kind === action.effectKind &&
      (entry.unitId ?? undefined) === action.unitId &&
      entry.gateEntryId === action.gateEntryId,
  )?.effectId;
}

/**
 * The controller's event id convention, kept inside the protocol identifier
 * bound. A run id long enough to overflow it leaves the controller to name the
 * event itself rather than offering an identifier the reducer would refuse.
 */
function skeletonEventId(run: RepositoryRun, type: string): string {
  const eventId = `${run.controller.runId}-${type}-${run.revision + 1}`;
  return eventId.length <= MAX_IDENTIFIER_LENGTH ? eventId : "<eventId>";
}

/**
 * A ready-to-send `--request` payload for one legal action: every field its
 * event schema requires, with the ones this run determines already bound and
 * the rest marked `<field>` for the controller to supply. Deriving the
 * idempotency key here is what spares a controller a bespoke helper per intent.
 */
function requestSkeleton(
  run: RepositoryRun,
  action: ActionDescriptor,
): JsonObject {
  const unitId = action.unitId ?? null;
  const unit =
    action.unitId === undefined ? undefined : run.units[action.unitId];
  const bound: Readonly<Record<string, JsonValue | undefined>> = {
    baseOid:
      action.type === "candidate_recheck_intent" ? unit?.baseOid : undefined,
    branchRef: unit?.branchRef,
    effectId: outstandingEffectId(run, action),
    effectKind: action.effectKind,
    eventId: skeletonEventId(run, action.type),
    expectedRevision: run.revision,
    gateEntryId: action.gateEntryId,
    headOid: unit?.candidateHead,
    idempotencyKey:
      action.mode === "emit" && action.effectKind !== undefined
        ? deriveIdempotencyKey(
            run,
            run.revision,
            unitId,
            action.effectKind,
            action.gateEntryId,
          )
        : undefined,
    type: action.type,
    treeOid: unit?.candidateTree,
    unitId,
    worktreePath: unit?.worktreePath,
  };
  return {
    event: Object.fromEntries(
      requiredEventFields(action.type, action.gateEntryId !== undefined).map(
        (field) => {
          const value = bound[field];
          return [field, value === undefined ? `<${field}>` : value];
        },
      ),
    ),
  };
}

const commandEvent: Readonly<
  Partial<Record<CommandName, readonly ProtocolEvent["type"][]>>
> = {
  "acquire-controller": ["controller_acquire_intent"],
  "plan-wave": ["wave_planned"],
  "configure-harness": ["harness_configured"],
  "prepare-wave": ["reservation_intent", "branch_intent", "worktree_intent"],
  "dispatch-request": ["dispatch_intent"],
  "repair-request": ["repair_intent"],
  "record-dispatch": [
    "dispatch_observed",
    "repair_observed",
    "reviewer_observed",
  ],
  "collect-candidate": ["collect_intent", "candidate_intent"],
  "recheck-candidate": ["candidate_recheck_intent"],
  "refresh-candidate": ["refresh_intent"],
  qualify: ["verification_intent"],
  "review-prepare": ["reviewer_dispatch_intent", "review_collect_intent"],
  "review-record": ["review_collected"],
  publish: ["publish_intent"],
  integrate: ["integrate_intent"],
  "close-unit": ["reservation_release_intent"],
  "gate-wave": [
    "materialisation_resolve_intent",
    "destination_probe_intent",
    "gate_clock_observed",
    "materialise_intent",
    "provenance_commit_intent",
    "gate_entry_deferred",
    "verification_intent",
  ],
  "release-controller": ["controller_release_intent"],
};

/**
 * Binds the CLI's formerly-unavailable Phase-2 command surface to an injected
 * authoritative recovery runner. The executable's default remains fail
 * closed until a topology composition root supplies that runner.
 */
export function createRecoveryCommandRunner(
  runner: (
    request?: RecoveryRequest,
    invocation?: RecoveryInvocation,
  ) => Promise<
    /**
     * A refusal may carry the diagnostic tail of the remote child that caused
     * it. It is deliberately `unknown` here: this seam is structural, so the
     * value is re-validated at `storeFailureTail` before it reaches a message.
     */
    | { readonly status: string; readonly stderrTail?: unknown }
    | {
        readonly status: string;
        readonly revision: number;
        readonly run: RepositoryRun;
      }
  >,
): CommandRunner {
  return async (request) => {
    if (!validateCommandRequest(request)) return invalidStateRequest();
    if (isHarnessPacketCommandRequest(request))
      return stateOnlyCommandRunner(request);
    if (isCandidateDigestCommandRequest(request))
      return stateOnlyCommandRunner(request);
    if (isStateCommandRequest(request)) {
      // A state query reconciles but never acts on its own behalf, so an
      // outstanding manual launch must survive it as an intent.
      const outcome = await runner(undefined, { stateQuery: true });
      if (!("run" in outcome)) {
        const tail = storeFailureTail(outcome);
        return outcome.status === "unavailable"
          ? unavailable(tail)
          : recoveryBlocked(tail);
      }
      return await stateResult(request.command, outcome.run);
    }
    if (request.command === "feedback") return unavailable();
    if (request.command === "claim-provenance-carry") {
      const outcome = await runner({
        provenanceCarryClaim: {
          predecessorRootBeadId: request.options.request.predecessorRootBeadId,
        },
      });
      if (!("revision" in outcome) || outcome.revision < 0) {
        const tail = storeFailureTail(outcome);
        return outcome.status === "unavailable"
          ? unavailable(tail)
          : recoveryBlocked(tail);
      }
      return {
        result: { revision: outcome.revision, state: outcome.run.state },
        schema: "sce.command.result",
        status: "ok",
        version: 1,
      };
    }
    if (request.command === "recover-publication-ref") {
      const outcome = await runner({
        publicationRecovery: request.options.request.publicationRecovery,
      });
      if (!("revision" in outcome) || outcome.revision < 0) {
        const tail = storeFailureTail(outcome);
        return outcome.status === "unavailable"
          ? unavailable(tail)
          : recoveryBlocked(tail);
      }
      return {
        result: { revision: outcome.revision, state: outcome.run.state },
        schema: "sce.command.result",
        status: "ok",
        version: 1,
      };
    }
    const payload = request.options.request;
    const event =
      payload !== undefined && "event" in payload ? payload.event : undefined;
    const acknowledgement =
      payload !== undefined && "harnessAcknowledgement" in payload
        ? payload.harnessAcknowledgement
        : undefined;
    const expected = commandEvent[request.command];
    if (
      acknowledgement !== undefined &&
      !allowsAcknowledgement(request.command, acknowledgement)
    )
      return invalidStateRequest();
    if (
      expected !== undefined &&
      acknowledgement === undefined &&
      (event === undefined || !expected.includes(event.type))
    )
      return invalidStateRequest();
    if (
      expected === undefined &&
      (event !== undefined || acknowledgement !== undefined)
    )
      return invalidStateRequest();
    if (
      event !== undefined &&
      ((request.options.expectedRevision !== undefined &&
        request.options.expectedRevision !== event.expectedRevision) ||
        (request.options.idempotencyKey !== undefined &&
          (!("idempotencyKey" in event) ||
            request.options.idempotencyKey !== event.idempotencyKey)))
    )
      return invalidStateRequest();
    const outcome = await runner(
      acknowledgement === undefined
        ? event
        : { harnessAcknowledgement: acknowledgement },
    );
    if (!("revision" in outcome) || outcome.revision < 0) {
      const tail = storeFailureTail(outcome);
      return outcome.status === "unavailable"
        ? unavailable(tail)
        : recoveryBlocked(tail);
    }
    return {
      result: {
        revision: outcome.revision,
        status: outcome.status,
        ...("toolRequest" in outcome && isJsonObject(outcome.toolRequest)
          ? { toolRequest: outcome.toolRequest }
          : {}),
      },
      schema: "sce.command.result",
      status: "ok",
      version: 1,
    };
  };
}

function allowsAcknowledgement(command: CommandName, value: unknown): boolean {
  const parsed = validate<HarnessToolAcknowledgement>(
    HarnessToolAcknowledgementSchema,
    value,
  );
  if (!parsed.ok || parsed.value === undefined) return false;
  const kind = parsed.value.kind;
  const allowed: Partial<Record<CommandName, readonly string[]>> = {
    "collect-candidate": ["worker_collected"],
    qualify: ["verified"],
    "record-dispatch": ["launch", "launch_inspected", "cancelled"],
    "review-record": ["review_collected"],
  };
  return allowed[command]?.includes(kind ?? "") ?? false;
}

/** Exact production composition used by hosts after their topology preflight. */
export function createProductionRecoveryCommandRunner(
  options: ProductionRecoveryRunnerOptions,
): CommandRunner {
  return createRecoveryCommandRunner(createProductionRecoveryRunner(options));
}

function recoveryBlocked(
  tail: Readonly<{ stderrTail?: StoreFailureTail }> = {},
): CommandRunnerResult {
  return {
    code: "SCE_RECOVERY_BLOCKED",
    schema: "sce.command.result",
    ...tail,
    status: "blocked",
    version: 1,
  };
}

/**
 * Re-validates the coordinator's diagnostic tail at this boundary. The runner
 * seam is structurally typed, so an unbounded or malformed value is dropped
 * here rather than carried into a CLI message.
 */
function storeFailureTail(
  outcome: Readonly<{ status: string; stderrTail?: unknown }>,
): Readonly<{ stderrTail?: StoreFailureTail }> {
  if (outcome.stderrTail === undefined) return {};
  const parsed = validate<StoreFailureTail>(
    StoreFailureTailSchema,
    outcome.stderrTail,
  );
  return parsed.ok && parsed.value !== undefined
    ? { stderrTail: parsed.value }
    : {};
}

async function stateResult(
  command: StateCommandName,
  run: RepositoryRun,
): Promise<CommandRunnerResult> {
  const request = {
    command,
    options: { json: true, request: { run } },
    schema: "sce.command.request" as const,
    version: 1 as const,
  };
  return await stateOnlyCommandRunner(request as CommandRequest);
}

function isStateCommandRequest(
  request: CommandRequest,
): request is Extract<CommandRequest, { readonly command: StateCommandName }> {
  return isStateCommandName(request.command);
}

function isHarnessPacketCommandRequest(
  request: CommandRequest,
): request is Extract<CommandRequest, { readonly command: "harness-packet" }> {
  return request.command === "harness-packet";
}

function isCandidateDigestCommandRequest(
  request: CommandRequest,
): request is Extract<
  CommandRequest,
  { readonly command: "candidate-digest" }
> {
  return request.command === "candidate-digest";
}

function invalidStateRequest(): CommandRunnerResult {
  return {
    code: "SCE_INVALID_STATE_REQUEST",
    schema: "sce.command.result",
    status: "invalid",
    version: 1,
  };
}

function unavailable(
  tail: Readonly<{ stderrTail?: StoreFailureTail }> = {},
): CommandRunnerResult {
  return {
    schema: "sce.command.result",
    ...tail,
    status: "unavailable",
    version: 1,
  };
}

export function isCommandName(value: string): value is CommandName {
  return (commandNames as readonly string[]).includes(value);
}

export function isFeedbackAction(value: string): value is FeedbackAction {
  return (feedbackActions as readonly string[]).includes(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}
