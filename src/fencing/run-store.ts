import { canonicalJson, type JsonValue } from "../protocol/canonical.js";
import type { ProtocolEffect, Reduction } from "../protocol/reducer.js";
import { validate } from "../protocol/schemas.js";
import {
  type MutationBatch,
  type RunStoreOutcome,
  type RunStoreResult,
  RunStoreResultSchema,
} from "./schemas.js";
import { validateMutationBatch } from "./projections.js";

/**
 * Topology adapters get exactly one atomic operation. They must validate
 * expected root/child revisions, holder, count, and readback commitments
 * inside this transaction before reporting `applied`.
 */
export interface RunStorePort {
  compareAndSet(batch: MutationBatch): Promise<RunStoreResult>;
}

export type PersistedReduction = Readonly<{
  effects: readonly ProtocolEffect[];
  outcome: RunStoreOutcome;
}>;

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

/**
 * An applied response must be an exact typed echo of the requested next
 * projection. The topology adapter cannot turn a read-then-update race into
 * effects by returning a plausible status string.
 */
function appliedReadbackMatches(
  result: Extract<RunStoreResult, { readonly status: "applied" }>,
  batch: MutationBatch,
): boolean {
  return (
    result.affectedRowCount === 1 + batch.changedRows.length &&
    result.children.length === batch.next.children.length &&
    same(result.root, batch.next.root) &&
    same(result.children, batch.next.children) &&
    same(result.checkpoint, batch.checkpoint)
  );
}

/**
 * Persists an already-reduced state in one CAS. Effects are exposed only once
 * the adapter has durably applied the intended journal state and read it back.
 */
export async function persistReducerIntent(
  store: RunStorePort,
  batchInput: unknown,
  reduction: Reduction,
): Promise<PersistedReduction> {
  const batch = validateMutationBatch(batchInput);
  if (!batch.ok || !reduction.ok)
    return { effects: [], outcome: "quarantined" };
  if (!same(batch.value.next.root.run, reduction.nextState))
    return { effects: [], outcome: "quarantined" };
  const result = await store.compareAndSet(batch.value);
  const parsed = validate<RunStoreResult>(RunStoreResultSchema, result);
  if (!parsed.ok || parsed.value === undefined)
    return { effects: [], outcome: "quarantined" };
  if (parsed.value.status !== "applied")
    return { effects: [], outcome: parsed.value.status };
  return appliedReadbackMatches(parsed.value, batch.value)
    ? { effects: reduction.effects, outcome: "applied" }
    : { effects: [], outcome: "quarantined" };
}
