import { Type, type Static, type TProperties } from "@sinclair/typebox";
import { Ajv, type ValidateFunction } from "ajv";

import {
  RepositoryRunSchema,
  validate,
  type RepositoryRun,
} from "../protocol/schemas.js";
import { ambiguityRecoveryActions, legalActions } from "../protocol/actions.js";
import { runInvariantErrors } from "../protocol/reducer.js";

export const commandNames = [
  "inspect",
  "acquire-controller",
  "next",
  "plan-wave",
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
const NoPayloadOptionsSchema = strictObject(RequestMetadataSchema);

const StateCommandSchema = strictObject({
  command: Type.Union([
    Type.Literal("inspect"),
    Type.Literal("next"),
    Type.Literal("status"),
  ]),
  options: StateOptionsSchema,
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
  options: NoPayloadOptionsSchema,
  schema: Type.Literal("sce.command.request"),
  version: Type.Literal(1),
});

export const CommandRequestSchema = Type.Union([
  StateCommandSchema,
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
  if (!isStateCommandRequest(request)) return unavailable();
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
