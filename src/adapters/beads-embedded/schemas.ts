import { Type, type Static } from "@sinclair/typebox";
import { Ajv, type ValidateFunction } from "ajv";

import {
  type ChildProjection,
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
  type RootProjection,
} from "../../fencing/index.js";
import type { DoltObservation } from "../../preflight/index.js";
import type { ProvenanceCarryClaimRecord } from "../../protocol/schemas.js";

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

/** Exact pinned bd 1.1.0 `issues` data-diff row envelope. */
const PINNED_BD_ISSUE_BASE_KEYS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "compaction_level",
  "content_hash",
  "created_at",
  "created_by",
  "description",
  "design",
  "ephemeral",
  "event_kind",
  "external_ref",
  "hook_bead",
  "id",
  "is_blocked",
  "is_template",
  "issue_type",
  "metadata",
  "mol_type",
  "no_history",
  "notes",
  "owner",
  "payload",
  "pinned",
  "priority",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "status",
  "target",
  "timeout_ns",
  "title",
  "updated_at",
  "waiters",
  "wisp_type",
  "work_type",
] as const;
const PINNED_BD_ISSUE_NUMERIC_KEYS = [
  "compaction_level",
  "ephemeral",
  "is_blocked",
  "is_template",
  "no_history",
  "pinned",
  "priority",
  "timeout_ns",
] as const;
const PINNED_BD_ISSUE_STRING_KEYS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "content_hash",
  "created_by",
  "description",
  "design",
  "event_kind",
  "external_ref",
  "hook_bead",
  "mol_type",
  "notes",
  "owner",
  "payload",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "target",
  "waiters",
  "wisp_type",
  "work_type",
] as const;

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function sqlTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
  );
}

/** Rejects unknown, missing, and incorrectly typed pinned bd issue columns. */
export function isPinnedBdIssueRow(value: Record<string, unknown>): boolean {
  const hasStartedAt = Object.prototype.hasOwnProperty.call(
    value,
    "started_at",
  );
  // `bd close` sets the nullable `closed_at`; a unit's child row is its bead,
  // and a landed unit's bead is closed before its reservation is released.
  const hasClosedAt = Object.prototype.hasOwnProperty.call(value, "closed_at");
  // Dolt omits nullable `external_ref` from JSON rows when it is NULL. These
  // two base forms (with/without it), plus optional `started_at` and
  // `closed_at`, are pinned.
  const hasExternalRef = Object.prototype.hasOwnProperty.call(
    value,
    "external_ref",
  );
  const baseKeys = hasExternalRef
    ? PINNED_BD_ISSUE_BASE_KEYS
    : PINNED_BD_ISSUE_BASE_KEYS.filter((key) => key !== "external_ref");
  const keys = [
    ...baseKeys,
    ...(hasStartedAt ? ["started_at"] : []),
    ...(hasClosedAt ? ["closed_at"] : []),
  ];
  return (
    exactKeys(value, keys) &&
    typeof value.id === "string" &&
    typeof value.issue_type === "string" &&
    typeof value.status === "string" &&
    typeof value.title === "string" &&
    value.metadata !== null &&
    typeof value.metadata === "object" &&
    !Array.isArray(value.metadata) &&
    PINNED_BD_ISSUE_STRING_KEYS.filter(
      (key) => hasExternalRef || key !== "external_ref",
    ).every((key) => typeof value[key] === "string") &&
    PINNED_BD_ISSUE_NUMERIC_KEYS.every(
      (key) =>
        typeof value[key] === "number" && Number.isSafeInteger(value[key]),
    ) &&
    sqlTimestamp(value.created_at) &&
    sqlTimestamp(value.updated_at) &&
    (!hasStartedAt || sqlTimestamp(value.started_at)) &&
    (!hasClosedAt || sqlTimestamp(value.closed_at))
  );
}

/**
 * A controller-journal record for one built-in merge-slot transition.  Unlike
 * a generic checkpoint, it says exactly which durable row is allowed to move
 * and which local / remote heads that movement started from.
 */
export type SlotTransitionKind = "acquire" | "release";

export type SlotTransitionIntent = Readonly<{
  after: MergeSlotObservation;
  before: Readonly<{
    head: string;
    remoteHead?: string;
    slot: MergeSlotObservation;
  }>;
  holder: string;
  /** SHA-256 over every other immutable field in this record. */
  idempotencyKey: string;
  kind: SlotTransitionKind;
  schema: "sce.beads-embedded.slot-transition";
  scope: FencingScope;
  version: 1;
}>;

/**
 * Remote-authoritative proof for a replay in a different embedded clone.
 * `effectHead` is the exact fetched remote commit whose sole parent is the
 * transition's remote before-head; `localHead` is the clean clone merge which
 * was separately restricted to bd's clone-local metadata update.
 */
export type RemoteSlotTransitionProof =
  | Readonly<{
      effectHead: string;
      localHead: string;
      remoteHead: string;
      schema: "sce.beads-embedded.remote-slot-transition-proof";
      status: "observed";
      version: 1;
    }>
  | Readonly<{
      schema: "sce.beads-embedded.remote-slot-transition-proof";
      status: "absent" | "ambiguous";
      version: 1;
    }>;

/**
 * The embedded adapter deliberately exposes semantic operations, not argv or
 * subprocess text.  The production process implementation is consequently
 * unable to widen the command allowlist without changing this contract.
 */
export const EMBEDDED_ADAPTER_VERSION = 1 as const;

export type EmbeddedMode = "local-only" | "git-sync";
export type CrashPoint =
  "before_commit" | "after_commit" | "before_push" | "after_push";

export type CarryCheckpointIntent = Readonly<{
  expectedAggregateCommitment: string;
  exportDigest: string;
  predecessorRootIssueId: string;
  record: ProvenanceCarryClaimRecord;
}>;

export type EmbeddedRequest =
  | Readonly<{ kind: "state" }>
  | Readonly<{ kind: "load" }>
  | Readonly<{
      kind: "carry_read";
      predecessorRootIssueId: string;
    }>
  | Readonly<{
      kind: "carry_claim";
      exportDigest: string;
      expectedAggregateCommitment: string;
      predecessorRootIssueId: string;
      record: ProvenanceCarryClaimRecord;
      slot: MergeSlotObservation;
    }>
  | Readonly<{
      intent: CarryCheckpointIntent;
      kind: "carry_discover";
      point: CrashPoint;
    }>
  | Readonly<{
      kind: "slot";
      action: "acquire" | "check" | "release";
      actor: string;
      /** Fetch and read the configured remote, never a stale tracking ref. */
      source?: "remote";
    }>
  | Readonly<{
      /**
       * Proves that the uncommitted or committed local delta is exactly the
       * controller-journalled built-in merge-slot transition, and nothing
       * else. It is deliberately a semantic operation: no argv leaks here.
       */
      intent: SlotTransitionIntent;
      kind: "slot_transition";
    }>
  | Readonly<{
      /**
       * Proves that `head` is the journalled before-head itself, or descends
       * from it through commits that never touched the built-in merge slot.
       * The controller journals its intent after planning, and under Dolt
       * auto-commit each such write is its own commit ahead of the plan.
       */
      head: string;
      intent: SlotTransitionIntent;
      kind: "slot_lineage";
    }>
  | Readonly<{
      /**
       * Proves a transition authored by another clone from the configured
       * remote's exact parent→effect commit, then admits only bd's pinned
       * clone-local merge metadata in this clone.
       */
      intent: SlotTransitionIntent;
      kind: "remote_slot_transition";
    }>
  | Readonly<{ kind: "mutation"; batch: MutationBatch }>
  | Readonly<{
      input: EmbeddedInitialProjection;
      /** Exact available built-in slot proved again inside the SQL predicate. */
      slot: MergeSlotObservation;
      kind: "initialize";
    }>
  | Readonly<{
      batch: MutationBatch;
      /** Exact available built-in slot rechecked in the mutation predicate. */
      slot: MergeSlotObservation;
      kind: "preownership_mutation";
    }>
  | Readonly<{ input: EmbeddedInitialProjection; kind: "initial_commit" }>
  | Readonly<{ input: EmbeddedInitialProjection; kind: "initial_push" }>
  | Readonly<{ kind: "commit" }>
  | Readonly<{ kind: "pull" }>
  | Readonly<{ kind: "push" }>
  | Readonly<{ kind: "readback"; batch: MutationBatch }>
  | Readonly<{
      kind: "discover";
      /**
       * Controller-journal authority for this recovery probe.  Discovery must
       * not infer a batch from process-local history: a replacement process
       * receives this exact, independently validated batch again.
       */
      batch: MutationBatch;
      point: CrashPoint;
    }>;

export type EmbeddedState = Readonly<{
  autoCommit: DoltObservation["autoCommit"];
  head?: string;
  reachable: boolean;
  /** A remote head is required after a remote-backed push. */
  remoteHead?: string;
  workingSet: DoltObservation["workingSet"];
}>;

export type EmbeddedReadback = Readonly<{
  children: readonly ChildProjection[];
  root: RootProjection;
}>;

export type EmbeddedInitialProjection = Readonly<{
  children: readonly ChildProjection[];
  root: RootProjection;
}>;

/** Only a positive `absent` result may authorize bootstrap. */
export type EmbeddedLoad =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "observed"; value: EmbeddedReadback }>
  | Readonly<{ status: "ambiguous" | "unavailable" }>;

/**
 * Immutable, non-secret composition identity. This is supplied once by the
 * concrete process so the adapter can bind preflight provenance before it
 * permits any semantic operation.
 */
export type EmbeddedProcessIdentity = Readonly<{
  database: string;
  databaseDirectory: string;
  prefix: string;
  remote?: Readonly<{
    name: string;
    ref: string;
    url: string;
  }>;
  storePath: string;
}>;

export type CrashDiscovery = Readonly<{
  /** Exact parent/baseline whose projection was proved before this batch. */
  baseHead?: string;
  /** Exact local Dolt head, and remote head after a push, never a boolean. */
  head?: string;
  remoteHead?: string;
  /** Exact affected SCE projection commitments when this brackets a batch. */
  childCommitments?: readonly string[];
  rootCommitment?: string;
  status: "absent" | "observed" | "ambiguous";
}>;

/**
 * A failed remote Dolt child is the only witness to why it failed: a refused
 * ssh key, an unreachable host, and a genuinely diverged remote all leave the
 * same non-zero exit. The process therefore keeps a bounded, redacted tail of
 * that child's stderr so a refusal can name its cause. It is diagnostic text
 * only; no classification ever reads it.
 */
export const REMOTE_FAILURE_TAIL_BYTES = 2_048;
/**
 * Redaction runs over a larger rolling window than it publishes, so a secret
 * shape which the published cut would have split is still matched whole. Both
 * numbers are memory bounds: neither the child's whole stderr nor an unbounded
 * window is ever held.
 */
export const REMOTE_FAILURE_WINDOW_CHARS = 8_192;

export const RemoteFailureTailSchema = Type.Object(
  {
    schema: Type.Literal("sce.beads-embedded.remote-failure-tail"),
    /**
     * Printable ASCII and newline only. Every other byte is replaced before
     * validation, so one character is exactly one byte and the character
     * bound is the byte bound.
     */
    text: Type.String({
      maxLength: REMOTE_FAILURE_TAIL_BYTES,
      maxUtf8Bytes: REMOTE_FAILURE_TAIL_BYTES,
      minLength: 1,
      pattern: "^[\\n\\x20-\\x7E]+$",
    }),
    /** Earlier stderr was dropped to hold the bound; this is a tail. */
    truncated: Type.Boolean(),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);
export type RemoteFailureTail = Static<typeof RemoteFailureTailSchema>;

const validateRemoteFailureTail = ajv.compile(
  RemoteFailureTailSchema,
) as ValidateFunction<RemoteFailureTail>;

const ANSI_ESCAPE = /\u001B\[[0-9;?]{0,16}[A-Za-z]/gu;
const UNPRINTABLE = /[^\n\x20-\x7E]/gu;

/**
 * Obvious secret shapes, each bounded and each replaced in place so the
 * surrounding words survive: a reader still learns which credential the
 * child rejected, never the credential itself.
 */
const SECRET_SHAPES: readonly (readonly [RegExp, string])[] = [
  // A complete private key block, then one whose end the window dropped.
  [
    /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]{0,8192}?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/gu,
    "[redacted key]",
  ],
  [
    /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]{0,8192}/gu,
    "[redacted key]",
  ],
  // An ssh key blob, and any line that is nothing but base64 (the body of a
  // key block whose header the window dropped).
  [
    /(ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-[a-z0-9-]{1,32})[ \t]+[A-Za-z0-9+/=]{16,}/gu,
    "$1 [redacted]",
  ],
  [/^[A-Za-z0-9+/]{40,}={0,2}$/gmu, "[redacted]"],
  // Published token shapes.
  [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}/gu, "[redacted]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{8,}/gu, "[redacted]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{8,}/gu, "[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/gu, "[redacted]"],
  [
    /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
    "[redacted]",
  ],
  // Userinfo in a URL, so a remote keeps only its scheme, host, and path.
  [/([a-z][a-z0-9+.-]{0,15}:\/\/)[^\s/@]{1,256}@/giu, "$1[redacted]@"],
  // `Authorization: ...`, `token=...`, and every other named secret, redacted
  // to the end of its line because the value may itself contain separators.
  [
    /\b(api[_-]?key|authorization|bearer|cookie|credentials?|passphrase|passwd|password|private[_-]?key|secret|session[_-]?token|token)([ \t]*[:=][ \t]*)[^\n]+/giu,
    "$1$2[redacted]",
  ],
];

function redactStderr(value: string): string {
  let text = value.replace(/\r\n?/gu, "\n").replace(ANSI_ESCAPE, "");
  for (const [shape, replacement] of SECRET_SHAPES)
    text = text.replace(shape, replacement);
  return text.replace(UNPRINTABLE, " ");
}

/**
 * Publishes a bounded stderr window: redact, restrict to printable ASCII, cut
 * to the byte bound, and validate. Anything that fails validation is dropped
 * rather than published unbounded.
 */
export function redactedStderrTail(
  window: string,
  dropped: boolean,
): RemoteFailureTail | undefined {
  const redacted = redactStderr(window).trim();
  const text = redacted.slice(
    Math.max(0, redacted.length - REMOTE_FAILURE_TAIL_BYTES),
  );
  if (text === "") return undefined;
  const value = {
    schema: "sce.beads-embedded.remote-failure-tail",
    text,
    truncated: dropped || text.length < redacted.length,
    version: 1,
  } as const;
  return validateRemoteFailureTail(value) ? value : undefined;
}

export type EmbeddedResponse =
  | Readonly<{ kind: "state"; value: EmbeddedState }>
  | Readonly<{ kind: "load"; value: EmbeddedLoad }>
  | Readonly<{
      kind: "carry_read";
      value:
        | Readonly<{ status: "not_found" | "unavailable" }>
        | Readonly<{ status: "observed"; claims: unknown; root: unknown }>;
    }>
  | Readonly<{
      kind: "carry_claim";
      value:
        | Readonly<{ status: "applied" | "stale" | "unavailable" }>
        | Readonly<{ status: "observed"; claims: unknown; root: unknown }>;
    }>
  | Readonly<{ kind: "carry_discover"; value: CrashDiscovery }>
  | Readonly<{ kind: "slot"; value: MergeSlotObservation }>
  | Readonly<{
      kind: "slot_transition";
      value: "observed" | "absent" | "ambiguous";
    }>
  | Readonly<{
      kind: "slot_lineage";
      value: "observed" | "absent" | "ambiguous";
    }>
  | Readonly<{
      kind: "remote_slot_transition";
      value: RemoteSlotTransitionProof;
    }>
  | Readonly<{
      kind: "mutation";
      value:
        | "applied"
        | "stale"
        | "holder_mismatch"
        | "ambiguous"
        | "unavailable"
        | "quarantined";
    }>
  | Readonly<{ kind: "commit"; value: "applied" | "ambiguous" | "unavailable" }>
  | Readonly<{
      kind: "pull";
      /** A failed child's redacted tail; diagnostic, never classified on. */
      stderrTail?: RemoteFailureTail;
      value: "applied" | "conflict" | "ambiguous" | "unavailable";
    }>
  | Readonly<{
      kind: "push";
      /** A failed child's redacted tail; diagnostic, never classified on. */
      stderrTail?: RemoteFailureTail;
      value: "applied" | "conflict" | "ambiguous" | "unavailable";
    }>
  | Readonly<{ kind: "readback"; value: EmbeddedReadback }>
  | Readonly<{ kind: "discover"; value: CrashDiscovery }>;

export interface EmbeddedProcessPort {
  readonly identity: EmbeddedProcessIdentity;
  execute(request: EmbeddedRequest): Promise<EmbeddedResponse>;
}

/** Stable, bounded, command-free public result. */
export const EmbeddedResultSchema = Type.Object(
  {
    code: Type.Union([
      Type.Literal("applied"),
      Type.Literal("blocked"),
      Type.Literal("stale"),
      Type.Literal("holder_mismatch"),
      Type.Literal("conflict"),
      Type.Literal("ambiguous"),
      Type.Literal("unavailable"),
      Type.Literal("quarantined"),
      Type.Literal("worker_mutation"),
    ]),
    schema: Type.Literal("sce.beads-embedded.result"),
    version: Type.Literal(EMBEDDED_ADAPTER_VERSION),
  },
  { additionalProperties: false },
);
export type EmbeddedResult = Static<typeof EmbeddedResultSchema>;
