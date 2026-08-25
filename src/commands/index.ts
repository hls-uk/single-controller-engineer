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
  validate,
  ProtocolEventSchema,
  type ProtocolEvent,
  type RepositoryRun,
} from "../protocol/schemas.js";
import { ambiguityRecoveryActions, legalActions } from "../protocol/actions.js";
import { runInvariantErrors } from "../protocol/reducer.js";
import {
  createProductionRecoveryRunner,
  type ProductionRecoveryRunnerOptions,
} from "./production-recovery.js";
import type { RecoveryRequest } from "./recovery.js";

export * from "./recovery.js";
export * from "./production-recovery.js";

export const commandNames = [
  "inspect",
  "harness-packet",
  "acquire-controller",
  "next",
  "plan-wave",
  "configure-harness",
  "prepare-wave",
  "dispatch-request",
  "record-dispatch",
  "collect-candidate",
  "qualify",
  "review-prepare",
  "review-record",
  "publish",
  "integrate",
  "gate-wave",
  "resume",
  "status",
  "release-controller",
  "feedback",
] as const;

export type CommandName = (typeof commandNames)[number];

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
const MAX_TEXT = 8_192;

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
const RecoveryEventPayloadSchema = strictObject({
  event: Type.Optional(ProtocolEventSchema),
});
const RecoveryAcknowledgementPayloadSchema = strictObject({
  harnessAcknowledgement: JsonObjectSchema,
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
const FeedbackCommandSchema = strictObject({
  command: Type.Literal("feedback"),
  feedbackAction: FeedbackActionSchema,
  options: NoPayloadOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1),
});
const UnavailableCommandSchema = strictObject({
  command: Type.Union([
    Type.Literal("acquire-controller"),
    Type.Literal("plan-wave"),
    Type.Literal("configure-harness"),
    Type.Literal("prepare-wave"),
    Type.Literal("dispatch-request"),
    Type.Literal("record-dispatch"),
    Type.Literal("collect-candidate"),
    Type.Literal("qualify"),
    Type.Literal("review-prepare"),
    Type.Literal("review-record"),
    Type.Literal("publish"),
    Type.Literal("integrate"),
    Type.Literal("gate-wave"),
    Type.Literal("resume"),
    Type.Literal("release-controller"),
  ]),
  options: RecoveryOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1),
});

export const CommandRequestSchema = Type.Union([
  StateCommandSchema,
  HarnessPacketCommandSchema,
  FeedbackCommandSchema,
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
    status: Type.Literal("unavailable"),
    version: Type.Literal(1),
  }),
  strictObject({
    code: Type.Literal("SCE_RECOVERY_BLOCKED"),
    schema: Type.Literal("sce.command.result"),
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
      readonly status: "unavailable";
      readonly version: 1;
    }
  | {
      readonly code: "SCE_RECOVERY_BLOCKED";
      readonly schema: "sce.command.result";
      readonly status: "blocked";
      readonly version: 1;
    };

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
  return {
    schema: "sce.command.result",
    version: 1,
    status: "ok",
    result: {
      legalActions: legalActions(run).map((action) => ({
        ...action,
      })) as JsonValue,
      revision: run.revision,
    },
  };
};

const commandEvent: Readonly<
  Partial<Record<CommandName, readonly ProtocolEvent["type"][]>>
> = {
  "acquire-controller": ["controller_acquire_intent"],
  "plan-wave": ["wave_planned"],
  "configure-harness": ["harness_configured"],
  "prepare-wave": ["reservation_intent", "branch_intent", "worktree_intent"],
  "dispatch-request": ["dispatch_intent"],
  "record-dispatch": [
    "dispatch_observed",
    "repair_observed",
    "reviewer_observed",
  ],
  "collect-candidate": ["collect_intent", "candidate_intent"],
  qualify: ["verification_intent"],
  "review-prepare": ["reviewer_dispatch_intent", "review_collect_intent"],
  "review-record": ["review_collected"],
  publish: ["publish_intent"],
  integrate: ["integrate_intent"],
  "release-controller": ["controller_release_intent"],
};

/**
 * Binds the CLI's formerly-unavailable Phase-2 command surface to an injected
 * authoritative recovery runner. The executable's default remains fail
 * closed until a topology composition root supplies that runner.
 */
export function createRecoveryCommandRunner(
  runner: (request?: RecoveryRequest) => Promise<
    | { readonly status: string }
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
    if (isStateCommandRequest(request)) {
      const outcome = await runner();
      if (!("run" in outcome))
        return outcome.status === "unavailable"
          ? unavailable()
          : recoveryBlocked();
      return await stateResult(request.command, outcome.run);
    }
    if (request.command === "feedback") return unavailable();
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
    if (!("revision" in outcome) || outcome.revision < 0)
      return outcome.status === "unavailable"
        ? unavailable()
        : recoveryBlocked();
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

function recoveryBlocked(): CommandRunnerResult {
  return {
    code: "SCE_RECOVERY_BLOCKED",
    schema: "sce.command.result",
    status: "blocked",
    version: 1,
  };
}

async function stateResult(
  command: "inspect" | "next" | "status",
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
): request is Extract<
  CommandRequest,
  { readonly command: "inspect" | "next" | "status" }
> {
  return (
    request.command === "inspect" ||
    request.command === "next" ||
    request.command === "status"
  );
}

function isHarnessPacketCommandRequest(
  request: CommandRequest,
): request is Extract<CommandRequest, { readonly command: "harness-packet" }> {
  return request.command === "harness-packet";
}

function invalidStateRequest(): CommandRunnerResult {
  return {
    code: "SCE_INVALID_STATE_REQUEST",
    schema: "sce.command.result",
    status: "invalid",
    version: 1,
  };
}

function unavailable(): CommandRunnerResult {
  return { schema: "sce.command.result", status: "unavailable", version: 1 };
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
