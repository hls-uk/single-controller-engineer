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

const oid = () =>
  Type.String({
    minLength: 40,
    maxLength: 64,
    pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
  });
const path = () =>
  Type.String({ minLength: 1, maxLength: 4096, maxUtf8Bytes: 4096 });

export const GitObjectFormatSchema = Type.Union([
  Type.Literal("sha1"),
  Type.Literal("sha256"),
]);
export type GitObjectFormatWire = Static<typeof GitObjectFormatSchema>;

/**
 * Signal names vary by platform. Any bounded POSIX-shaped signal is treated
 * as an ambiguous subprocess termination; accepting an unfamiliar name is
 * safer than misclassifying a possibly-applied mutation as a refusal.
 */
const ProcessSignalSchema = Type.Union([
  Type.String({ minLength: 4, maxLength: 19, pattern: "^SIG[A-Z0-9]{1,16}$" }),
  Type.Null(),
]);

/** The only subprocess observation accepted from an injected Git runner. */
export const GitResultSchema = strictObject({
  exitCode: Type.Union([
    Type.Integer({ minimum: 0, maximum: 255 }),
    Type.Null(),
  ]),
  signal: ProcessSignalSchema,
  stdout: Type.String({ minLength: 0, maxLength: 65536, maxUtf8Bytes: 65536 }),
  timedOut: Type.Optional(Type.Boolean()),
  unavailable: Type.Optional(Type.Boolean()),
});
export type GitResultWire = Static<typeof GitResultSchema>;

export const GitRepositorySchema = strictObject({
  commonDir: path(),
  cwd: path(),
  identity: Type.String({ minLength: 1, maxLength: 1024, maxUtf8Bytes: 1024 }),
  objectFormat: GitObjectFormatSchema,
  remoteUrls: Type.Array(
    Type.String({ minLength: 1, maxLength: 1024, maxUtf8Bytes: 1024 }),
    { maxItems: 16 },
  ),
});
export const GitSnapshotSchema = strictObject({
  changedPaths: Type.Array(path(), { maxItems: 4096 }),
  clean: Type.Boolean(),
  head: oid(),
  tree: oid(),
});
export const GitEffectSchema = strictObject({
  code: Type.Union([
    Type.Literal("GIT_OK"),
    Type.Literal("GIT_BAD_INPUT"),
    Type.Literal("GIT_COMMAND_FAILED"),
    Type.Literal("GIT_DIRTY"),
    Type.Literal("GIT_ABSENT"),
    Type.Literal("GIT_FOREIGN_BRANCH"),
    Type.Literal("GIT_FOREIGN_PUBLICATION"),
    Type.Literal("GIT_FOREIGN_WORKTREE"),
    Type.Literal("GIT_IDENTITY_MISMATCH"),
    Type.Literal("GIT_MOVED_BASE"),
    Type.Literal("GIT_NOT_FAST_FORWARD"),
    Type.Literal("GIT_REFUSED"),
    Type.Literal("GIT_REMOTE_AMBIGUOUS"),
    Type.Literal("GIT_REMOTE_MISSING"),
    Type.Literal("GIT_UNSUPPORTED_OBJECT_FORMAT"),
    Type.Literal("GIT_UNRESOLVED_EFFECT"),
  ]),
  state: Type.Union([
    Type.Literal("observed"),
    Type.Literal("refused"),
    Type.Literal("ambiguous"),
  ]),
});

export function isSchema<T>(schema: TSchema, value: unknown): value is T {
  return (ajv.compile(schema) as ValidateFunction<T>)(value);
}

export function parseGitResult(value: unknown): GitResultWire | undefined {
  return isSchema(GitResultSchema, value)
    ? (value as GitResultWire)
    : undefined;
}
