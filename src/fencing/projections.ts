import { canonicalJson, type JsonValue } from "../protocol/canonical.js";
import { sha256 } from "../protocol/evidence.js";
import { runInvariantErrors } from "../protocol/reducer.js";
import {
  type RepositoryRun,
  type Unit,
  validate,
} from "../protocol/schemas.js";
import {
  FENCING_LIMITS,
  FENCING_SCHEMA_VERSION,
  type CheckpointObservation,
  type ChildProjection,
  ChildProjectionSchema,
  type ChildRowReference,
  type ChangedRow,
  type FencingScope,
  FencingScopeSchema,
  type MutationBatch,
  MutationBatchSchema,
  type RootProjection,
  RootProjectionSchema,
} from "./schemas.js";

const utf8 = new TextEncoder();

export type ProjectionParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

function json(value: unknown): JsonValue {
  return value as JsonValue;
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(json(left)) === canonicalJson(json(right));
}

/** Deliberately locale-independent ordering for persistent bytes. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function holderRunId(holder: string): string {
  return holder.split("/", 1)[0] ?? "";
}

function scopeFor(run: RepositoryRun): FencingScope {
  return {
    beadsStoreIdentity: run.storeIdentity,
    gitRepositoryIdentity: run.repositoryIdentity,
    integrationBranch: run.integrationBranch,
  };
}

export function deriveScopeCommitment(scope: FencingScope): string {
  return sha256(
    canonicalJson({ domain: "sce.fencing.scope.v1", scope: json(scope) }),
  );
}

export function deriveAggregateCommitment(run: RepositoryRun): string {
  return sha256(
    canonicalJson({ domain: "sce.fencing.aggregate.v1", run: json(run) }),
  );
}

export function deriveChildCommitment(unit: Unit): string {
  return sha256(
    canonicalJson({ domain: "sce.fencing.child.v1", unit: json(unit) }),
  );
}

export function deriveChangedRowsCommitment(
  rows: readonly ChangedRow[],
): string {
  return sha256(
    canonicalJson({
      domain: "sce.fencing.changed-rows.v1",
      rows: json(
        [...rows].sort((left, right) =>
          compareCodeUnits(left.unitId, right.unitId),
        ),
      ),
    }),
  );
}

function childRows(run: RepositoryRun): readonly ChildRowReference[] {
  return Object.values(run.units)
    .map((unit) => ({
      commitment: deriveChildCommitment(unit),
      revision: unit.revision,
      unitId: unit.id,
    }))
    .sort((left, right) => compareCodeUnits(left.unitId, right.unitId));
}

function checkpoint(
  aggregateRevision: number,
  aggregateCommitment: string,
): CheckpointObservation {
  return {
    aggregateRevision,
    changedRowsCommitment: deriveChangedRowsCommitment([]),
    rootCommitment: aggregateCommitment,
  };
}

/** Bind the root's persisted checkpoint to this exact one-shot batch. */
export function checkpointForBatch(
  root: RootProjection,
  changedRows: readonly ChangedRow[],
): CheckpointObservation {
  return {
    aggregateRevision: root.aggregateRevision,
    changedRowsCommitment: deriveChangedRowsCommitment(changedRows),
    rootCommitment: root.aggregateCommitment,
  };
}

export function withBatchCheckpoint(
  root: RootProjection,
  changedRows: readonly ChangedRow[],
): RootProjection {
  return { ...root, checkpoint: checkpointForBatch(root, changedRows) };
}

export function makeRootProjection(run: RepositoryRun): RootProjection {
  const aggregateCommitment = deriveAggregateCommitment(run);
  return {
    aggregateCommitment,
    aggregateRevision: run.revision,
    checkpoint: checkpoint(run.revision, aggregateCommitment),
    childRows: [...childRows(run)],
    holder: run.controller.holder,
    run,
    schema: "sce.fencing.root",
    scope: scopeFor(run),
    version: FENCING_SCHEMA_VERSION,
  };
}

export function makeChildProjection(
  root: RootProjection,
  unitId: string,
): ChildProjection | undefined {
  const unit = root.run.units[unitId];
  if (unit === undefined) return undefined;
  return {
    commitment: deriveChildCommitment(unit),
    holder: root.holder,
    revision: unit.revision,
    schema: "sce.fencing.child",
    scope: root.scope,
    unit,
    unitId,
    version: FENCING_SCHEMA_VERSION,
  };
}

function canonical<T>(
  source: string,
  limit: number,
  parser: (input: unknown) => ProjectionParse<T>,
): ProjectionParse<T> {
  if (utf8.encode(source).byteLength > limit)
    return { ok: false, reason: "projection exceeds byte limit" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return { ok: false, reason: "projection is not JSON" };
  }
  const result = parser(parsed);
  if (!result.ok) return result;
  try {
    if (canonicalJson(json(result.value)) !== source)
      return { ok: false, reason: "projection is not canonical JSON" };
  } catch {
    return { ok: false, reason: "projection cannot be canonicalized" };
  }
  return result;
}

function parseSchema<T>(
  schema: Parameters<typeof validate<T>>[0],
  input: unknown,
) {
  const parsed = validate<T>(schema, input);
  return parsed.ok && parsed.value !== undefined
    ? ({ ok: true, value: parsed.value } as const)
    : ({ ok: false, reason: parsed.errors.join("; ") } as const);
}

export function validateRootProjection(
  input: unknown,
): ProjectionParse<RootProjection> {
  const parsed = parseSchema<RootProjection>(RootProjectionSchema, input);
  if (!parsed.ok) return parsed;
  const root = parsed.value;
  if (runInvariantErrors(root.run).length > 0)
    return { ok: false, reason: "root run invariants fail" };
  if (!equal(root.scope, scopeFor(root.run)))
    return { ok: false, reason: "root scope disagrees with run" };
  if (root.holder !== root.run.controller.holder)
    return { ok: false, reason: "root holder disagrees with run" };
  if (root.aggregateRevision !== root.run.revision)
    return { ok: false, reason: "root revision disagrees with run" };
  if (root.aggregateCommitment !== deriveAggregateCommitment(root.run))
    return { ok: false, reason: "root aggregate commitment is invalid" };
  if (!equal(root.childRows, childRows(root.run)))
    return { ok: false, reason: "root child rows disagree with run" };
  if (
    root.checkpoint.aggregateRevision !== root.aggregateRevision ||
    root.checkpoint.rootCommitment !== root.aggregateCommitment
  )
    return { ok: false, reason: "root checkpoint is invalid" };
  return parsed;
}

export function validateChildProjection(
  input: unknown,
): ProjectionParse<ChildProjection> {
  const parsed = parseSchema<ChildProjection>(ChildProjectionSchema, input);
  if (!parsed.ok) return parsed;
  const child = parsed.value;
  if (
    child.unit.id !== child.unitId ||
    child.unit.revision !== child.revision ||
    child.commitment !== deriveChildCommitment(child.unit)
  )
    return { ok: false, reason: "child facts disagree with projection" };
  return parsed;
}

export function validateMutationBatch(
  input: unknown,
): ProjectionParse<MutationBatch> {
  const parsed = parseSchema<MutationBatch>(MutationBatchSchema, input);
  if (!parsed.ok) return parsed;
  const batch = parsed.value;
  const root = validateRootProjection(batch.next.root);
  if (!root.ok) return { ok: false, reason: root.reason };
  if (
    !equal(batch.scope, root.value.scope) ||
    batch.holder !== root.value.holder
  )
    return { ok: false, reason: "batch scope or holder disagrees with root" };
  if (!equal(batch.checkpoint, root.value.checkpoint))
    return { ok: false, reason: "batch checkpoint disagrees with root" };
  if (batch.continuation === undefined && batch.expectedHolder !== batch.holder)
    return { ok: false, reason: "expected holder disagrees with next holder" };
  if (root.value.aggregateRevision !== batch.expectedAggregateRevision + 1)
    return { ok: false, reason: "next aggregate revision is not exact" };
  if (batch.expectedAggregateCommitment === root.value.aggregateCommitment)
    return { ok: false, reason: "aggregate commitment did not change" };
  const changedIds = batch.changedRows.map((row) => row.unitId);
  if (
    new Set(changedIds).size !== changedIds.length ||
    [...changedIds].sort().some((id, index) => id !== changedIds[index])
  )
    return { ok: false, reason: "changed rows are not sorted and unique" };
  if (
    batch.expectedChildren.length !== batch.changedRows.length ||
    batch.next.children.length !== batch.changedRows.length
  )
    return { ok: false, reason: "affected child row count is not exact" };
  if (
    !equal(
      batch.expectedChildren.map((child) => child.unitId),
      changedIds,
    ) ||
    !equal(
      batch.next.children.map((child) => child.unitId),
      changedIds,
    )
  )
    return { ok: false, reason: "affected child rows are not ordered exactly" };
  for (const row of batch.changedRows) {
    const expected = batch.expectedChildren.find(
      (item) => item.unitId === row.unitId,
    );
    const child = batch.next.children.find(
      (item) => item.unitId === row.unitId,
    );
    const rootRow = root.value.childRows.find(
      (item) => item.unitId === row.unitId,
    );
    if (expected === undefined || child === undefined || rootRow === undefined)
      return { ok: false, reason: "affected child row is missing" };
    const validatedChild = validateChildProjection(child);
    if (!validatedChild.ok) return { ok: false, reason: validatedChild.reason };
    if (
      expected.expectedRevision !== row.expectedRevision ||
      expected.expectedCommitment !== row.expectedCommitment ||
      row.nextRevision !== row.expectedRevision + 1 ||
      child.revision !== row.nextRevision ||
      child.commitment !== row.nextCommitment ||
      rootRow.revision !== row.nextRevision ||
      rootRow.commitment !== row.nextCommitment ||
      !equal(child.scope, batch.scope) ||
      child.holder !== batch.holder ||
      !equal(child.unit, root.value.run.units[row.unitId])
    )
      return { ok: false, reason: "affected child row disagrees with batch" };
  }
  if (
    batch.checkpoint.aggregateRevision !== root.value.aggregateRevision ||
    batch.checkpoint.rootCommitment !== root.value.aggregateCommitment ||
    batch.checkpoint.changedRowsCommitment !==
      deriveChangedRowsCommitment(batch.changedRows)
  )
    return { ok: false, reason: "batch checkpoint is invalid" };
  const scopeCommitment = deriveScopeCommitment(batch.scope);
  if (
    batch.continuation !== undefined &&
    (batch.continuation.scopeCommitment !== scopeCommitment ||
      batch.continuation.nextHolder !== batch.holder ||
      batch.continuation.previousHolder !== batch.expectedHolder ||
      batch.continuation.previousHolder === batch.holder ||
      holderRunId(batch.continuation.previousHolder) !==
        holderRunId(batch.holder))
  )
    return { ok: false, reason: "continuation evidence is invalid" };
  if (
    batch.release !== undefined &&
    (batch.release.scopeCommitment !== scopeCommitment ||
      batch.release.holder !== batch.holder)
  )
    return { ok: false, reason: "release evidence is invalid" };
  return parsed;
}

export function encodeRootProjection(
  root: RootProjection,
): ProjectionParse<string> {
  const valid = validateRootProjection(root);
  if (!valid.ok) return valid;
  const source = canonicalJson(json(valid.value));
  return utf8.encode(source).byteLength <= FENCING_LIMITS.projectionBytes
    ? { ok: true, value: source }
    : { ok: false, reason: "root projection exceeds byte limit" };
}

export function decodeRootProjection(
  source: string,
): ProjectionParse<RootProjection> {
  return canonical(
    source,
    FENCING_LIMITS.projectionBytes,
    validateRootProjection,
  );
}

export function encodeChildProjection(
  child: ChildProjection,
): ProjectionParse<string> {
  const valid = validateChildProjection(child);
  if (!valid.ok) return valid;
  const source = canonicalJson(json(valid.value));
  return utf8.encode(source).byteLength <= FENCING_LIMITS.childProjectionBytes
    ? { ok: true, value: source }
    : { ok: false, reason: "child projection exceeds byte limit" };
}

export function decodeChildProjection(
  source: string,
): ProjectionParse<ChildProjection> {
  return canonical(
    source,
    FENCING_LIMITS.childProjectionBytes,
    validateChildProjection,
  );
}

export function encodeMutationBatch(
  batch: MutationBatch,
): ProjectionParse<string> {
  const valid = validateMutationBatch(batch);
  if (!valid.ok) return valid;
  const source = canonicalJson(json(valid.value));
  return utf8.encode(source).byteLength <= FENCING_LIMITS.batchBytes
    ? { ok: true, value: source }
    : { ok: false, reason: "mutation batch exceeds byte limit" };
}

export function decodeMutationBatch(
  source: string,
): ProjectionParse<MutationBatch> {
  return canonical(source, FENCING_LIMITS.batchBytes, validateMutationBatch);
}
