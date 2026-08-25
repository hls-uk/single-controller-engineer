import {
  Type,
  type Static,
  type TProperties,
  type TSchema,
} from "@sinclair/typebox";
import { Ajv, type ValidateFunction } from "ajv";

const utf8 = new TextEncoder();
const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  useDefaults: false,
});
ajv.addKeyword({
  keyword: "maxUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (limit: number, value: string) =>
    utf8.encode(value).byteLength <= limit,
  errors: false,
});

export function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}

const text = (limit: number) =>
  Type.String({ minLength: 1, maxLength: limit, maxUtf8Bytes: limit });

export const SupportedToolchainSchema = Type.Literal("node-22");
export const SceCapabilitySchema = Type.Union([
  Type.Literal("feedback.outbox"),
  Type.Literal("feedback.recovery"),
  Type.Literal("feedback.submit"),
  Type.Literal("feedback.transport"),
]);

export const FeedbackTargetSchema = strictObject({
  host: Type.Literal("github.com"),
  repositoryId: Type.Literal("R_kgDOUCvUmw"),
  repository: Type.Literal("hls-uk/single-controller-engineer"),
});
export type FeedbackTargetWire = Static<typeof FeedbackTargetSchema>;

export const SafeTelemetryInputSchema = strictObject({
  kind: Type.Union([Type.Literal("bug"), Type.Literal("enhancement")]),
  component: Type.Union([
    Type.Literal("adapter"),
    Type.Literal("capability"),
    Type.Literal("protocol"),
    Type.Literal("runtime"),
    Type.Literal("topology"),
  ]),
  toolVersion: text(80),
  toolchain: SupportedToolchainSchema,
  requestedModelTier: Type.Union([
    Type.Literal("frontier"),
    Type.Literal("workhorse"),
  ]),
  protocolState: Type.Union([
    Type.Literal("blocked"),
    Type.Literal("failed"),
    Type.Literal("preflight"),
    Type.Literal("recovery"),
    Type.Literal("verification"),
  ]),
  stableErrorCode: Type.String({
    minLength: 5,
    maxLength: 80,
    maxUtf8Bytes: 80,
    pattern: "^SCE_[A-Z0-9_]{1,75}$",
  }),
  capabilityId: SceCapabilitySchema,
});
export type SafeTelemetryInputWire = Static<typeof SafeTelemetryInputSchema>;

export const ReviewedNarrativeInputSchema = strictObject({
  expected: Type.Optional(text(4096)),
  observed: Type.Optional(text(4096)),
  reproduction: Type.Optional(text(4096)),
  limitation: Type.Optional(text(4096)),
  desiredCapability: Type.Optional(text(4096)),
  value: Type.Optional(text(4096)),
  workaround: Type.Optional(text(4096)),
  completionExample: Type.Optional(text(4096)),
});
export type ReviewedNarrativeInputWire = Static<
  typeof ReviewedNarrativeInputSchema
>;

export const FeedbackAuthoritySchema = strictObject({
  schemaVersion: Type.Literal(1),
  operation: Type.Literal("create_issue"),
  source: Type.Union([
    Type.Literal("current_user"),
    Type.Literal("policy_safe_telemetry"),
  ]),
  targetRepositoryId: Type.Literal("R_kgDOUCvUmw"),
  fingerprint: Type.String({
    minLength: 64,
    maxLength: 64,
    pattern: "^[0-9a-f]{64}$",
  }),
  previewHash: Type.String({
    minLength: 64,
    maxLength: 64,
    pattern: "^[0-9a-f]{64}$",
  }),
  operationNonce: Type.String({
    minLength: 16,
    maxLength: 160,
    pattern: "^[A-Za-z0-9._:-]+$",
  }),
});
export type FeedbackAuthorityWire = Static<typeof FeedbackAuthoritySchema>;

export const GitHubIssueSchema = strictObject({
  repositoryId: Type.Literal("R_kgDOUCvUmw"),
  number: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  url: Type.String({ minLength: 1, maxLength: 1024, maxUtf8Bytes: 1024 }),
  body: Type.String({ minLength: 0, maxLength: 16_384, maxUtf8Bytes: 16_384 }),
  open: Type.Boolean(),
});
export const GitHubDiscoverySchema = strictObject({
  repositoryId: Type.Literal("R_kgDOUCvUmw"),
  paginationComplete: Type.Literal(true),
  issues: Type.Array(GitHubIssueSchema, { maxItems: 10_000 }),
});
export type GitHubIssueWire = Static<typeof GitHubIssueSchema>;
export type GitHubDiscoveryWire = Static<typeof GitHubDiscoverySchema>;

export const GitHubCreateRequestSchema = strictObject({
  target: FeedbackTargetSchema,
  title: text(512),
  body: Type.String({ minLength: 1, maxLength: 16_384, maxUtf8Bytes: 16_384 }),
});
export type GitHubCreateRequestWire = Static<typeof GitHubCreateRequestSchema>;

export function isFeedbackSchema<T>(
  schema: TSchema,
  value: unknown,
): value is T {
  return (ajv.compile(schema) as ValidateFunction<T>)(value);
}
