import {
  Type,
  type Static,
  type TProperties,
  type TSchema,
} from "@sinclair/typebox";
import { Ajv, type ValidateFunction } from "ajv";

export const PREFLIGHT_SCHEMA = "sce.preflight";
export const PREFLIGHT_VERSION = 1 as const;
export const BD_VERSION = "1.1.0";
export const BD_CONTEXT_SCHEMA_VERSION = 1 as const;

const MAX_PATH_BYTES = 4_096;
const MAX_TEXT_BYTES = 8_192;
const utf8 = new TextEncoder();

export function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}

const text = (maxLength = MAX_TEXT_BYTES) =>
  Type.String({ minLength: 1, maxLength, maxUtf8Bytes: maxLength });
const optionalText = (maxLength = MAX_TEXT_BYTES) =>
  Type.Optional(text(maxLength));
const absolutePath = () =>
  Type.String({
    minLength: 1,
    maxLength: MAX_PATH_BYTES,
    maxUtf8Bytes: MAX_PATH_BYTES,
  });
const identifier = () =>
  Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  });

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true,
});
ajv.addKeyword({
  keyword: "maxUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (limit: number, value: string) =>
    utf8.encode(value).byteLength <= limit,
  errors: false,
});

export function isSchema<T>(schema: TSchema, value: unknown): value is T {
  return (ajv.compile(schema) as ValidateFunction<T>)(value);
}

/** The only commands accepted by the process boundary in this foundation. */
export const InspectionCommandSchema = Type.Union([
  strictObject({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([Type.Literal("--version")]),
  }),
  strictObject({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([
      Type.Literal("config"),
      Type.Literal("get"),
      Type.Literal("sync.remote"),
      Type.Literal("--json"),
    ]),
  }),
  strictObject({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([
      Type.Literal("config"),
      Type.Literal("get"),
      Type.Literal("issue_prefix"),
      Type.Literal("--json"),
    ]),
  }),
  strictObject({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([Type.Literal("context"), Type.Literal("--json")]),
  }),
  strictObject({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([
      Type.Literal("dolt"),
      Type.Literal("show"),
      Type.Literal("--json"),
    ]),
  }),
  strictObject({
    executable: Type.Literal("bd"),
    argv: Type.Tuple([
      Type.Literal("bootstrap"),
      Type.Literal("--dry-run"),
      Type.Literal("--json"),
    ]),
  }),
  strictObject({
    executable: Type.Literal("git"),
    argv: Type.Tuple([
      Type.Literal("rev-parse"),
      Type.Literal("--show-toplevel"),
    ]),
  }),
  strictObject({
    executable: Type.Literal("git"),
    argv: Type.Tuple([
      Type.Literal("rev-parse"),
      Type.Literal("--git-common-dir"),
    ]),
  }),
  strictObject({
    executable: Type.Literal("git"),
    argv: Type.Tuple([
      Type.Literal("rev-parse"),
      Type.Literal("--show-object-format"),
    ]),
  }),
  strictObject({
    executable: Type.Literal("git"),
    argv: Type.Tuple([
      Type.Literal("config"),
      Type.Literal("--null"),
      Type.Literal("--get-regexp"),
      Type.Literal("^remote\\..*\\.url$"),
    ]),
  }),
]);
export type InspectionCommand = Static<typeof InspectionCommandSchema>;

export const SanitizedSubprocessRequestSchema = strictObject({
  command: InspectionCommandSchema,
  cwd: absolutePath(),
  maxOutputBytes: Type.Integer({ minimum: 1, maximum: 65_536 }),
  timeoutMs: Type.Integer({ minimum: 1, maximum: 15_000 }),
});
export type SanitizedSubprocessRequest = Static<
  typeof SanitizedSubprocessRequestSchema
>;

export const SanitizedSubprocessObservationSchema = strictObject({
  command: Type.String({ minLength: 1, maxLength: 80 }),
  outcome: Type.Union([
    Type.Literal("ok"),
    Type.Literal("exit"),
    Type.Literal("signal"),
    Type.Literal("timeout"),
    Type.Literal("output_limit"),
    Type.Literal("unavailable"),
  ]),
  exitCode: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
  signal: Type.Optional(
    Type.Union([
      Type.Literal("SIGINT"),
      Type.Literal("SIGTERM"),
      Type.Literal("SIGKILL"),
      Type.Literal("other"),
    ]),
  ),
});
export type SanitizedSubprocessObservation = Static<
  typeof SanitizedSubprocessObservationSchema
>;

/** Strict, allowlisted projection of bd context --json schema 1. */
export const BdContextObservationSchema = strictObject({
  backend: Type.Union([
    Type.Literal("dolt"),
    Type.Literal("none"),
    Type.Literal("uninitialized"),
  ]),
  bd_version: text(32),
  beads_dir: Type.Optional(absolutePath()),
  cwd_repo_root: absolutePath(),
  database: Type.Optional(identifier()),
  dolt_mode: Type.Optional(
    Type.Union([
      Type.Literal("embedded"),
      Type.Literal("shared-server"),
      Type.Literal("external"),
      Type.Literal("server"),
      Type.Literal("uninitialized"),
      Type.Literal("global"),
      Type.Literal("proxy"),
    ]),
  ),
  is_redirected: Type.Optional(Type.Boolean()),
  is_worktree: Type.Optional(Type.Boolean()),
  project_id: Type.Optional(identifier()),
  repo_root: Type.Optional(absolutePath()),
  role: optionalText(80),
  schema_version: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  server: optionalText(320),
  server_source: Type.Optional(
    Type.Union([
      Type.Literal("shared-server"),
      Type.Literal("server"),
      Type.Literal("external"),
      Type.Literal("global"),
      Type.Literal("proxy"),
    ]),
  ),
  prefix: Type.Optional(identifier()),
  rig: Type.Optional(identifier()),
  sync_ref: Type.Optional(identifier()),
  sync_remote: optionalText(1_024),
  global: Type.Optional(Type.Boolean()),
  proxied: Type.Optional(Type.Boolean()),
});
export type BdContextObservation = Static<typeof BdContextObservationSchema>;

/** Exact configuration-backed output of bd dolt show --json in bd 1.1.0. */
export const BdDoltShowObservationSchema = strictObject({
  backend: Type.Literal("dolt"),
  data_dir: absolutePath(),
  database: identifier(),
  embedded: Type.Boolean(),
  schema_version: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
});
export type BdDoltShowObservation = Static<typeof BdDoltShowObservationSchema>;

const BdConfigKeySchema = Type.Union([
  Type.Literal("sync.remote"),
  Type.Literal("issue_prefix"),
]);
const BdConfigLocationSchema = Type.Union([
  Type.Literal("config.yaml"),
  Type.Literal("database"),
]);

/** Strict value-only output of an exact bd config get <key> --json request. */
export const BdConfigValueObservationSchema = strictObject({
  key: BdConfigKeySchema,
  location: Type.Optional(BdConfigLocationSchema),
  schema_version: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  value: Type.String({
    minLength: 0,
    maxLength: 1_024,
    maxUtf8Bytes: 1_024,
  }),
});
export type BdConfigValueObservation = Static<
  typeof BdConfigValueObservationSchema
>;

const BootstrapActionSchema = Type.Union([
  Type.Literal("sync"),
  Type.Literal("create"),
  Type.Literal("clone"),
  Type.Literal("restore"),
  Type.Literal("import"),
  Type.Literal("validate"),
]);
const BdBootstrapRawSchema = strictObject({
  action: BootstrapActionSchema,
  beads_dir: Type.Optional(absolutePath()),
  database: Type.Optional(identifier()),
  has_existing: Type.Boolean(),
  reason: text(1_024),
  schema_version: Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  }),
  sync_remote: optionalText(1_024),
});

/** Safe plan: the free-text bootstrap reason is deliberately never exposed. */
export const BootstrapPlanSchema = strictObject({
  action: BootstrapActionSchema,
  beadsDir: Type.Optional(absolutePath()),
  database: Type.Optional(identifier()),
});
export type BootstrapPlan = Static<typeof BootstrapPlanSchema>;

/**
 * Operational Dolt facts are intentionally separate from topology identity.
 * A reachable endpoint cannot change the configuration-provenance classifier.
 */
export const DoltObservationSchema = strictObject({
  autoCommit: Type.Union([
    Type.Literal("off"),
    Type.Literal("on"),
    Type.Literal("batch"),
  ]),
  database: identifier(),
  head: Type.Optional(
    Type.String({
      minLength: 40,
      maxLength: 64,
      pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    }),
  ),
  reachable: Type.Boolean(),
  workingSet: Type.Union([
    Type.Literal("clean"),
    Type.Literal("pending"),
    Type.Literal("unknown"),
  ]),
});
export type DoltObservation = Static<typeof DoltObservationSchema>;

export const GitInspectionSchema = strictObject({
  commonDir: absolutePath(),
  objectFormat: Type.Union([Type.Literal("sha1"), Type.Literal("sha256")]),
  providerId: Type.Optional(identifier()),
  remoteUrls: Type.Array(text(1_024), { minItems: 0, maxItems: 16 }),
  topLevel: absolutePath(),
});
export type GitInspection = Static<typeof GitInspectionSchema>;

export const BeadsIdentitySchema = strictObject({
  beadsDir: Type.Optional(absolutePath()),
  contextSchemaVersion: Type.Literal(BD_CONTEXT_SCHEMA_VERSION),
  database: Type.Optional(identifier()),
  mode: Type.Union([
    Type.Literal("embedded"),
    Type.Literal("managed_local_shared_server"),
    Type.Literal("external_server"),
  ]),
  prefix: Type.Optional(identifier()),
  projectId: Type.Optional(identifier()),
  provenance: Type.Union([
    Type.Literal("embedded_config"),
    Type.Literal("shared_server_flag"),
    Type.Literal("external_server_flag"),
  ]),
  rig: Type.Optional(identifier()),
  server: Type.Optional(text(320)),
  storePath: Type.Optional(absolutePath()),
  syncRef: Type.Optional(identifier()),
  syncRemote: optionalText(1_024),
  toolVersion: Type.Literal(BD_VERSION),
});
export type BeadsIdentity = Static<typeof BeadsIdentitySchema>;

export const GitIdentitySchema = strictObject({
  commonDir: absolutePath(),
  identity: text(1_024),
  objectFormat: Type.Union([Type.Literal("sha1"), Type.Literal("sha256")]),
  topLevel: absolutePath(),
});
export type GitIdentity = Static<typeof GitIdentitySchema>;

export const RefusalCodeSchema = Type.Union([
  Type.Literal("PF_BD_UNAVAILABLE"),
  Type.Literal("PF_BD_VERSION_UNSUPPORTED"),
  Type.Literal("PF_BD_CONTEXT_SCHEMA_UNSUPPORTED"),
  Type.Literal("PF_BD_CONTEXT_INVALID"),
  Type.Literal("PF_BD_CONFIG_INVALID"),
  Type.Literal("PF_TOPOLOGY_CONTRADICTORY"),
  Type.Literal("PF_TOPOLOGY_REFUSED"),
  Type.Literal("PF_BOOTSTRAP_PLAN_INVALID"),
  Type.Literal("PF_GIT_INSPECTION_INVALID"),
  Type.Literal("PF_GIT_IDENTITY_AMBIGUOUS"),
  Type.Literal("PF_SUBPROCESS_UNAVAILABLE"),
  Type.Literal("PF_SUBPROCESS_EXIT"),
  Type.Literal("PF_SUBPROCESS_SIGNAL"),
  Type.Literal("PF_SUBPROCESS_TIMEOUT"),
  Type.Literal("PF_SUBPROCESS_OUTPUT_LIMIT"),
]);
export type RefusalCode = Static<typeof RefusalCodeSchema>;

const ReadyPreflightSchema = strictObject({
  beads: BeadsIdentitySchema,
  git: GitIdentitySchema,
  status: Type.Literal("ready"),
});
const UninitializedPreflightSchema = strictObject({
  bootstrap: BootstrapPlanSchema,
  status: Type.Literal("uninitialized"),
});
const RefusedPreflightSchema = strictObject({
  code: RefusalCodeSchema,
  status: Type.Literal("refused"),
});
export const PreflightEnvelopeSchema = strictObject({
  payload: Type.Union([
    ReadyPreflightSchema,
    UninitializedPreflightSchema,
    RefusedPreflightSchema,
  ]),
  schema: Type.Literal(PREFLIGHT_SCHEMA),
  version: Type.Literal(PREFLIGHT_VERSION),
});
export type PreflightEnvelope = Static<typeof PreflightEnvelopeSchema>;

export type SafeParse<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

const secretKeyShape =
  /(?:^|[_.-])(?:api[_-]?(?:key|token)|authorization|bearer|cookie|credentials?|passwd|password|private[_-]?key|secret|session(?:[_-]?token)?|token)(?:$|[_.-])/iu;
const secretCanaryShape =
  /(?:^|[\s_-])(?:api[_-]?(?:key|token)|authorization|bearer|cookie|credentials?|passwd|password|private[_-]?key|secret|session(?:[_-]?token)?|token)[_-]?canary(?:$|[\s_-])/iu;
const secretAssignmentShape =
  /(?:^|[\s,{])(?:api[_-]?(?:key|token)|authorization|bearer|cookie|credentials?|passwd|password|private[_-]?key|secret|session(?:[_-]?token)?|token)\s*[:=]\s*[^\s,}]+/iu;
const credentialUrlShape = /https?:\/\/[^/?#\s@]+@/iu;

export function containsSecretShape(value: unknown): boolean {
  if (typeof value === "string")
    return (
      secretCanaryShape.test(value) ||
      secretAssignmentShape.test(value) ||
      credentialUrlShape.test(value)
    );
  if (Array.isArray(value)) return value.some(containsSecretShape);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => secretKeyShape.test(key) || containsSecretShape(nested),
  );
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function parseBdContextJson(
  source: string,
): SafeParse<BdContextObservation> {
  const parsed = parseJson(source);
  if (
    parsed === undefined ||
    containsSecretShape(parsed) ||
    !isSchema(BdContextObservationSchema, parsed)
  )
    return { ok: false };
  return { ok: true, value: parsed as BdContextObservation };
}

export function parseBdDoltShowJson(
  source: string,
): SafeParse<BdDoltShowObservation> {
  const parsed = parseJson(source);
  if (
    parsed === undefined ||
    containsSecretShape(parsed) ||
    !isSchema(BdDoltShowObservationSchema, parsed)
  )
    return { ok: false };
  return { ok: true, value: parsed as BdDoltShowObservation };
}

export function parseBdConfigValueJson(
  source: string,
  expectedKey: "sync.remote" | "issue_prefix",
): SafeParse<BdConfigValueObservation> {
  const parsed = parseJson(source);
  if (
    parsed === undefined ||
    containsSecretShape(parsed) ||
    !isSchema(BdConfigValueObservationSchema, parsed)
  )
    return { ok: false };
  const observation = parsed as BdConfigValueObservation;
  if (
    observation.key !== expectedKey ||
    observation.schema_version !== BD_CONTEXT_SCHEMA_VERSION
  )
    return { ok: false };
  return { ok: true, value: observation };
}

export function parseBootstrapPlanJson(
  source: string,
): SafeParse<BootstrapPlan> {
  const parsed = parseJson(source);
  if (
    parsed === undefined ||
    containsSecretShape(parsed) ||
    !isSchema(BdBootstrapRawSchema, parsed)
  )
    return { ok: false };
  const raw = parsed as Static<typeof BdBootstrapRawSchema>;
  if (raw.schema_version !== BD_CONTEXT_SCHEMA_VERSION) return { ok: false };
  const plan: BootstrapPlan = {
    action: raw.action,
    ...(raw.beads_dir === undefined ? {} : { beadsDir: raw.beads_dir }),
    ...(raw.database === undefined ? {} : { database: raw.database }),
  };
  return { ok: true, value: plan };
}

export function parseGitInspection(value: unknown): SafeParse<GitInspection> {
  if (containsSecretShape(value) || !isSchema(GitInspectionSchema, value))
    return { ok: false };
  return { ok: true, value: value as GitInspection };
}
