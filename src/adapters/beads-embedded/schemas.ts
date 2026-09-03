import { Type, type Static } from "@sinclair/typebox";

import {
  type ChildProjection,
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
  type RootProjection,
} from "../../fencing/index.js";
import type { DoltObservation } from "../../preflight/index.js";
import type { ProvenanceCarryClaimRecord } from "../../protocol/schemas.js";

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
  // Dolt omits nullable `external_ref` from JSON rows when it is NULL. These
  // two base forms (with/without it), plus optional `started_at`, are pinned.
  const hasExternalRef = Object.prototype.hasOwnProperty.call(
    value,
    "external_ref",
  );
  const baseKeys = hasExternalRef
    ? PINNED_BD_ISSUE_BASE_KEYS
    : PINNED_BD_ISSUE_BASE_KEYS.filter((key) => key !== "external_ref");
  const keys = hasStartedAt ? [...baseKeys, "started_at"] : baseKeys;
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
    (!hasStartedAt || sqlTimestamp(value.started_at))
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
      value: "applied" | "conflict" | "ambiguous" | "unavailable";
    }>
  | Readonly<{
      kind: "push";
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
