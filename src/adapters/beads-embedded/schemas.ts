import { Type, type Static } from "@sinclair/typebox";

import {
  type ChildProjection,
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
  type RootProjection,
} from "../../fencing/index.js";
import type { DoltObservation } from "../../preflight/index.js";

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
 * The embedded adapter deliberately exposes semantic operations, not argv or
 * subprocess text.  The production process implementation is consequently
 * unable to widen the command allowlist without changing this contract.
 */
export const EMBEDDED_ADAPTER_VERSION = 1 as const;

export type EmbeddedMode = "local-only" | "git-sync";
export type CrashPoint =
  "before_commit" | "after_commit" | "before_push" | "after_push";

export type EmbeddedRequest =
  | Readonly<{ kind: "state" }>
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
  | Readonly<{ kind: "mutation"; batch: MutationBatch }>
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
  | Readonly<{ kind: "slot"; value: MergeSlotObservation }>
  | Readonly<{
      kind: "slot_transition";
      value: "observed" | "absent" | "ambiguous";
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
