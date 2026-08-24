import { createHash } from "node:crypto";
import {
  canonicalJson,
  preserveStrings,
  type CanonicalStringPolicy,
  type JsonValue,
} from "./canonical.js";

export const EVIDENCE_SCHEMA_VERSION = 1;
const EVIDENCE_HASH_DOMAIN = "sce.evidence";

/** A privacy-safe reference to evidence. It intentionally omits payload bytes. */
export interface Evidence {
  readonly kind: string;
  readonly schemaVersion: number;
  readonly hash: string;
}

/** Every evidence hash needs an explicit payload string policy. */
export interface EvidenceOptions {
  readonly schemaVersion: number;
  readonly stringPolicy: CanonicalStringPolicy;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function evidence(
  kind: string,
  value: JsonValue,
  options: EvidenceOptions,
): Evidence {
  const schemaVersion = validSchemaVersion(options.schemaVersion);
  const hash = sha256(
    hashInput(kind, schemaVersion, value, options.stringPolicy),
  );
  return { kind, schemaVersion, hash };
}

export function evidenceMatches(
  record: Evidence,
  kind: string,
  value: JsonValue,
  options: EvidenceOptions,
): boolean {
  const schemaVersion = validSchemaVersion(options.schemaVersion);
  return (
    record.kind === kind &&
    record.schemaVersion === schemaVersion &&
    record.hash === evidence(kind, value, options).hash
  );
}

function hashInput(
  kind: string,
  schemaVersion: number,
  value: JsonValue,
  payloadStringPolicy: CanonicalStringPolicy,
): string {
  return canonicalJson(
    {
      domain: EVIDENCE_HASH_DOMAIN,
      kind,
      payload: value,
      schema_version: schemaVersion,
    },
    (path, target) =>
      path[0] === "payload"
        ? payloadStringPolicy(path.slice(1), target)
        : preserveStrings(path, target),
  );
}

function validSchemaVersion(schemaVersion: number): number {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
    throw new TypeError(
      "evidence schema version must be a positive safe integer",
    );
  return schemaVersion;
}
