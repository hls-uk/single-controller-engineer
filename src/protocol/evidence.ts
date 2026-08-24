import { createHash } from "node:crypto";
import { canonicalJson, type JsonValue, normalizeNfc } from "./canonical.js";

export interface Evidence {
  readonly kind: string;
  readonly hash: string;
  readonly canonical: string;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function evidence(
  kind: string,
  value: JsonValue,
  normalize = normalizeNfc,
): Evidence {
  const canonical = canonicalJson(value, normalize);
  return { kind, canonical, hash: sha256(canonical) };
}

export function evidenceMatches(
  record: Evidence,
  value: JsonValue,
  normalize = normalizeNfc,
): boolean {
  return record.hash === evidence(record.kind, value, normalize).hash;
}
