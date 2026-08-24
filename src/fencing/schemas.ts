import { Type, type Static } from "@sinclair/typebox";

import {
  RepositoryRunSchema,
  UnitSchema,
  strictObject,
} from "../protocol/schemas.js";

export const FENCING_SCHEMA_VERSION = 1 as const;
/** Exact facts exposed by the built-in Beads merge-slot. */
export const MERGE_SLOT_LABEL = "gt:slot" as const;
export const MERGE_SLOT_TITLE = "Merge Slot" as const;
export const FENCING_LIMITS = {
  batchBytes: 262_144,
  childProjectionBytes: 65_536,
  changedRows: 64,
  projectionBytes: 196_608,
} as const;

const identifier = () =>
  Type.String({
    minLength: 1,
    maxLength: 160,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
  });
const holder = () =>
  Type.String({
    minLength: 3,
    maxLength: 321,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$",
  });
const hash = () =>
  Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" });
const revision = () =>
  Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

/** Immutable identity for every persistent fencing operation. */
export const FencingScopeSchema = strictObject({
  beadsStoreIdentity: identifier(),
  gitRepositoryIdentity: identifier(),
  integrationBranch: identifier(),
});
export type FencingScope = Static<typeof FencingScopeSchema>;

export const ChildRowReferenceSchema = strictObject({
  commitment: hash(),
  revision: revision(),
  unitId: identifier(),
});
export type ChildRowReference = Static<typeof ChildRowReferenceSchema>;

export const CheckpointObservationSchema = strictObject({
  aggregateRevision: revision(),
  changedRowsCommitment: hash(),
  rootCommitment: hash(),
});
export type CheckpointObservation = Static<typeof CheckpointObservationSchema>;

/** Canonical persisted root state. It retains the exact validated reducer run. */
export const RootProjectionSchema = strictObject({
  aggregateCommitment: hash(),
  aggregateRevision: revision(),
  checkpoint: CheckpointObservationSchema,
  childRows: Type.Array(ChildRowReferenceSchema, {
    maxItems: FENCING_LIMITS.changedRows,
  }),
  holder: holder(),
  run: RepositoryRunSchema,
  schema: Type.Literal("sce.fencing.root"),
  scope: FencingScopeSchema,
  version: Type.Literal(FENCING_SCHEMA_VERSION),
});
export type RootProjection = Static<typeof RootProjectionSchema>;

/** Canonical affected-child row. Root child references must agree exactly. */
export const ChildProjectionSchema = strictObject({
  commitment: hash(),
  holder: holder(),
  revision: revision(),
  schema: Type.Literal("sce.fencing.child"),
  scope: FencingScopeSchema,
  unit: UnitSchema,
  unitId: identifier(),
  version: Type.Literal(FENCING_SCHEMA_VERSION),
});
export type ChildProjection = Static<typeof ChildProjectionSchema>;

export const ExpectedChildRowSchema = strictObject({
  expectedCommitment: hash(),
  expectedRevision: revision(),
  unitId: identifier(),
});
export type ExpectedChildRow = Static<typeof ExpectedChildRowSchema>;

/** Exact before/after row contract supplied to one transactional CAS call. */
export const ChangedRowSchema = strictObject({
  expectedCommitment: hash(),
  expectedRevision: revision(),
  nextCommitment: hash(),
  nextRevision: revision(),
  unitId: identifier(),
});
export type ChangedRow = Static<typeof ChangedRowSchema>;

export const ContinuationEvidenceSchema = strictObject({
  nextHolder: holder(),
  observationHash: hash(),
  previousHolder: holder(),
  scopeCommitment: hash(),
});
export type ContinuationEvidence = Static<typeof ContinuationEvidenceSchema>;

export const ReleaseEvidenceSchema = strictObject({
  available: Type.Literal(true),
  holder: holder(),
  observationHash: hash(),
  scopeCommitment: hash(),
});
export type ReleaseEvidence = Static<typeof ReleaseEvidenceSchema>;

export const MergeSlotObservationSchema = strictObject({
  actor: holder(),
  holder: Type.Optional(holder()),
  label: Type.Literal(MERGE_SLOT_LABEL),
  readbackHash: hash(),
  scope: FencingScopeSchema,
  scopeCommitment: hash(),
  slotId: identifier(),
  status: Type.Union([Type.Literal("available"), Type.Literal("acquired")]),
  title: Type.Literal(MERGE_SLOT_TITLE),
  version: Type.Literal(FENCING_SCHEMA_VERSION),
});
export type MergeSlotObservation = Static<typeof MergeSlotObservationSchema>;

export const SlotContinuationEvidenceSchema = strictObject({
  after: MergeSlotObservationSchema,
  before: MergeSlotObservationSchema,
  nextHolder: holder(),
  previousHolder: holder(),
});
export type SlotContinuationEvidence = Static<
  typeof SlotContinuationEvidenceSchema
>;

export const SlotReleaseEvidenceSchema = strictObject({
  holder: holder(),
  readback: MergeSlotObservationSchema,
});
export type SlotReleaseEvidence = Static<typeof SlotReleaseEvidenceSchema>;

export const MutationBatchSchema = strictObject({
  changedRows: Type.Array(ChangedRowSchema, {
    maxItems: FENCING_LIMITS.changedRows,
  }),
  checkpoint: CheckpointObservationSchema,
  continuation: Type.Optional(ContinuationEvidenceSchema),
  expectedAggregateCommitment: hash(),
  expectedAggregateRevision: revision(),
  /** Exact holder predicate checked inside the topology transaction. */
  expectedHolder: holder(),
  expectedChildren: Type.Array(ExpectedChildRowSchema, {
    maxItems: FENCING_LIMITS.changedRows,
  }),
  holder: holder(),
  next: strictObject({
    children: Type.Array(ChildProjectionSchema, {
      maxItems: FENCING_LIMITS.changedRows,
    }),
    root: RootProjectionSchema,
  }),
  release: Type.Optional(ReleaseEvidenceSchema),
  schema: Type.Literal("sce.fencing.batch"),
  scope: FencingScopeSchema,
  version: Type.Literal(FENCING_SCHEMA_VERSION),
});
export type MutationBatch = Static<typeof MutationBatchSchema>;

export const RunStoreNonAppliedResultSchema = Type.Union([
  strictObject({ status: Type.Literal("stale") }),
  strictObject({ status: Type.Literal("holder_mismatch") }),
  strictObject({ status: Type.Literal("ambiguous") }),
  strictObject({ status: Type.Literal("unavailable") }),
  strictObject({ status: Type.Literal("quarantined") }),
]);

/**
 * An adapter may report applied only with authoritative, typed readback. This
 * makes a lying read-then-update adapter fail closed in the coordinator.
 */
export const RunStoreAppliedResultSchema = strictObject({
  /** Root is always an affected row, followed by every affected child. */
  affectedRowCount: Type.Integer({
    minimum: 1,
    maximum: FENCING_LIMITS.changedRows + 1,
  }),
  checkpoint: CheckpointObservationSchema,
  children: Type.Array(ChildProjectionSchema, {
    maxItems: FENCING_LIMITS.changedRows,
  }),
  root: RootProjectionSchema,
  status: Type.Literal("applied"),
});
export type RunStoreAppliedResult = Static<typeof RunStoreAppliedResultSchema>;

export const RunStoreResultSchema = Type.Union([
  RunStoreAppliedResultSchema,
  RunStoreNonAppliedResultSchema,
]);
export type RunStoreResult = Static<typeof RunStoreResultSchema>;
export type RunStoreOutcome = RunStoreResult["status"];

export const OperationLockStateSchema = strictObject({
  holder: holder(),
  nonce: identifier(),
  scopeCommitment: hash(),
  version: Type.Literal(FENCING_SCHEMA_VERSION),
});
export type OperationLockState = Static<typeof OperationLockStateSchema>;
