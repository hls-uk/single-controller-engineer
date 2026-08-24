import { canonicalJson, type JsonValue } from "../protocol/canonical.js";
import { sha256 } from "../protocol/evidence.js";
import { validate } from "../protocol/schemas.js";
import { deriveScopeCommitment, type ProjectionParse } from "./projections.js";
import {
  type FencingScope,
  type MergeSlotObservation,
  MergeSlotObservationSchema,
  type SlotContinuationEvidence,
  SlotContinuationEvidenceSchema,
  type SlotReleaseEvidence,
  SlotReleaseEvidenceSchema,
} from "./schemas.js";

export type SlotDecision =
  | { readonly kind: "acquire" }
  | { readonly kind: "resume" }
  | { readonly kind: "continue" }
  | { readonly kind: "blocked" }
  | { readonly kind: "quarantined" };

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function slotReadbackPayload(
  observation: Omit<MergeSlotObservation, "readbackHash">,
): JsonValue {
  return {
    actor: observation.actor,
    ...(observation.holder === undefined ? {} : { holder: observation.holder }),
    label: observation.label,
    scope: observation.scope,
    scopeCommitment: observation.scopeCommitment,
    slotId: observation.slotId,
    status: observation.status,
    title: observation.title,
    version: observation.version,
  };
}

export function deriveSlotReadbackHash(
  observation: Omit<MergeSlotObservation, "readbackHash">,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.fencing.merge-slot.v1",
      observation: slotReadbackPayload(observation),
    }),
  );
}

function slotId(prefix: string): string {
  return `${prefix}-merge-slot`;
}

function runId(holder: string): string {
  return holder.split("/", 1)[0] ?? "";
}

export function validateMergeSlotObservation(
  input: unknown,
  prefix: string,
  scope: FencingScope,
): ProjectionParse<MergeSlotObservation> {
  const parsed = validate<MergeSlotObservation>(
    MergeSlotObservationSchema,
    input,
  );
  if (!parsed.ok || parsed.value === undefined)
    return { ok: false, reason: parsed.errors.join("; ") };
  const observation = parsed.value;
  if (
    observation.slotId !== slotId(prefix) ||
    !same(observation.scope, scope) ||
    observation.scopeCommitment !== deriveScopeCommitment(scope) ||
    observation.readbackHash !== deriveSlotReadbackHash(observation)
  )
    return { ok: false, reason: "slot identity or readback is invalid" };
  if (
    (observation.status === "available" && observation.holder !== undefined) ||
    (observation.status === "acquired" &&
      (observation.holder === undefined ||
        observation.actor !== observation.holder))
  )
    return { ok: false, reason: "slot status and holder disagree" };
  return { ok: true, value: observation };
}

function continuationMatches(
  input: unknown,
  prefix: string,
  scope: FencingScope,
  holder: string,
  knownHolder: string | undefined,
  observation: MergeSlotObservation,
): boolean {
  const parsed = validate<SlotContinuationEvidence>(
    SlotContinuationEvidenceSchema,
    input,
  );
  if (!parsed.ok || parsed.value === undefined) return false;
  const evidence = parsed.value;
  if (
    evidence.nextHolder !== holder ||
    evidence.previousHolder === holder ||
    knownHolder !== evidence.previousHolder ||
    runId(evidence.previousHolder) !== runId(holder) ||
    !same(evidence.after, observation)
  )
    return false;
  const before = validateMergeSlotObservation(evidence.before, prefix, scope);
  const after = validateMergeSlotObservation(evidence.after, prefix, scope);
  return (
    before.ok &&
    after.ok &&
    before.value.status === "acquired" &&
    before.value.holder === evidence.previousHolder &&
    before.value.actor === evidence.previousHolder &&
    after.value.status === "acquired" &&
    after.value.holder === holder &&
    after.value.actor === holder
  );
}

/** Never emits create/takeover: adapters can only act on the built-in slot. */
export function decideControllerSlot(
  prefix: string,
  scope: FencingScope,
  holder: string,
  /** Holder from the already-authoritative controller projection, if any. */
  knownHolder: string | undefined,
  observationInput: unknown,
  continuationInput?: unknown,
): SlotDecision {
  const observation = validateMergeSlotObservation(
    observationInput,
    prefix,
    scope,
  );
  if (!observation.ok) return { kind: "quarantined" };
  if (observation.value.status === "available") return { kind: "acquire" };
  // A new incarnation must present its before/after positive readbacks before
  // the generic same-holder resume path can accept it.
  if (
    observation.value.holder !== undefined &&
    runId(observation.value.holder) === runId(holder) &&
    continuationMatches(
      continuationInput,
      prefix,
      scope,
      holder,
      knownHolder,
      observation.value,
    )
  )
    return { kind: "continue" };
  if (observation.value.holder === holder && knownHolder === holder)
    return { kind: "resume" };
  return { kind: "blocked" };
}

/** Positive available readback is mandatory before a holder considers release done. */
export function validateSlotRelease(
  prefix: string,
  scope: FencingScope,
  holder: string,
  evidenceInput: unknown,
): ProjectionParse<SlotReleaseEvidence> {
  const parsed = validate<SlotReleaseEvidence>(
    SlotReleaseEvidenceSchema,
    evidenceInput,
  );
  if (!parsed.ok || parsed.value === undefined)
    return { ok: false, reason: parsed.errors.join("; ") };
  if (parsed.value.holder !== holder)
    return { ok: false, reason: "release holder differs" };
  const readback = validateMergeSlotObservation(
    parsed.value.readback,
    prefix,
    scope,
  );
  if (
    !readback.ok ||
    readback.value.status !== "available" ||
    readback.value.holder !== undefined ||
    readback.value.actor !== holder
  )
    return { ok: false, reason: "release lacks positive available readback" };
  return { ok: true, value: parsed.value };
}
