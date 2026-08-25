import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import { sha256 } from "../../protocol/evidence.js";
import {
  type FencingScope,
  type MergeSlotObservation,
  validateMergeSlotObservation,
} from "../../fencing/index.js";

import type { SlotTransitionIntent, SlotTransitionKind } from "./schemas.js";

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function head(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-z]{20,64}$/u.test(value);
}

function holder(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  );
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function transitionPayload(
  input: Omit<SlotTransitionIntent, "idempotencyKey">,
) {
  return {
    after: input.after,
    before: input.before,
    holder: input.holder,
    kind: input.kind,
    schema: input.schema,
    scope: input.scope,
    version: input.version,
  } as const;
}

export function deriveSlotTransitionId(
  input: Omit<SlotTransitionIntent, "idempotencyKey">,
): string {
  return sha256(
    canonicalJson({
      domain: "sce.beads-embedded.slot-transition.v1",
      transition: transitionPayload(input),
    }),
  );
}

export function makeSlotTransitionIntent(
  kind: SlotTransitionKind,
  holderValue: string,
  scope: FencingScope,
  before: Readonly<{
    head: string;
    remoteHead?: string;
    slot: MergeSlotObservation;
  }>,
  after: MergeSlotObservation,
): SlotTransitionIntent {
  const unsigned = {
    after,
    before,
    holder: holderValue,
    kind,
    schema: "sce.beads-embedded.slot-transition" as const,
    scope,
    version: 1 as const,
  };
  return { ...unsigned, idempotencyKey: deriveSlotTransitionId(unsigned) };
}

/** Runtime-strict validation before an intent can cause commit or push. */
export function validateSlotTransitionIntent(
  input: unknown,
  prefix: string,
  scope: FencingScope,
  mode: "local-only" | "git-sync",
  expectedHolder?: string,
): input is SlotTransitionIntent {
  const value = object(input);
  if (
    value === undefined ||
    Object.keys(value).some(
      (key) =>
        ![
          "after",
          "before",
          "holder",
          "idempotencyKey",
          "kind",
          "schema",
          "scope",
          "version",
        ].includes(key),
    ) ||
    value.schema !== "sce.beads-embedded.slot-transition" ||
    value.version !== 1 ||
    (value.kind !== "acquire" && value.kind !== "release") ||
    !holder(value.holder) ||
    (expectedHolder !== undefined && value.holder !== expectedHolder) ||
    !same(value.scope, scope) ||
    typeof value.idempotencyKey !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.idempotencyKey)
  )
    return false;
  const before = object(value.before);
  if (
    before === undefined ||
    Object.keys(before).some(
      (key) => key !== "head" && key !== "remoteHead" && key !== "slot",
    ) ||
    !head(before.head) ||
    (before.remoteHead !== undefined && !head(before.remoteHead)) ||
    (mode === "git-sync" && before.remoteHead === undefined)
  )
    return false;
  const beforeSlot = validateMergeSlotObservation(before.slot, prefix, scope);
  const afterSlot = validateMergeSlotObservation(value.after, prefix, scope);
  if (!beforeSlot.ok || !afterSlot.ok) return false;
  const intended =
    value.kind === "acquire"
      ? beforeSlot.value.status === "available" &&
        afterSlot.value.status === "acquired" &&
        afterSlot.value.actor === value.holder &&
        afterSlot.value.holder === value.holder
      : beforeSlot.value.status === "acquired" &&
        beforeSlot.value.actor === value.holder &&
        beforeSlot.value.holder === value.holder &&
        afterSlot.value.status === "available" &&
        afterSlot.value.actor === value.holder;
  if (!intended) return false;
  const unsigned = {
    after: afterSlot.value,
    before: {
      head: before.head,
      ...(before.remoteHead === undefined
        ? {}
        : { remoteHead: before.remoteHead }),
      slot: beforeSlot.value,
    },
    holder: value.holder,
    kind: value.kind,
    schema: value.schema,
    scope,
    version: value.version,
  } satisfies Omit<SlotTransitionIntent, "idempotencyKey">;
  return value.idempotencyKey === deriveSlotTransitionId(unsigned);
}
