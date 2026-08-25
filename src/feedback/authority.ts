import { canonicalJson } from "../protocol/canonical.js";
import { sha256 } from "../protocol/evidence.js";
import type { FeedbackPacket } from "./packet.js";
import { FeedbackAuthoritySchema, isFeedbackSchema } from "./schemas.js";

export const FEEDBACK_AUTHORITY_VERSION = 1 as const;
export type FeedbackOperation = "create_issue";
export type AuthoritySource = "current_user" | "policy_safe_telemetry";

export interface FeedbackAuthority {
  readonly schemaVersion: typeof FEEDBACK_AUTHORITY_VERSION;
  readonly operation: FeedbackOperation;
  readonly source: AuthoritySource;
  readonly targetRepositoryId: string;
  readonly fingerprint: string;
  /** Hash binds the exact preview bytes, including optional narrative. */
  readonly previewHash: string;
  /** A new nonce is required before retrying an absent submit intent. */
  readonly operationNonce: string;
}

export function packetPreviewHash(packet: FeedbackPacket): string {
  return sha256(
    canonicalJson({
      body: packet.body,
      target_repository_id: packet.target.repositoryId,
      title: packet.title,
    }),
  );
}

export function authorityFor(
  packet: FeedbackPacket,
  source: AuthoritySource,
  operationNonce: string,
): FeedbackAuthority {
  return {
    schemaVersion: FEEDBACK_AUTHORITY_VERSION,
    operation: "create_issue",
    source,
    targetRepositoryId: packet.target.repositoryId,
    fingerprint: packet.telemetry.fingerprint,
    previewHash: packetPreviewHash(packet),
    operationNonce,
  };
}

/** Policy authority can never authorize a reviewed narrative or warning. */
export function authorizes(
  packet: FeedbackPacket,
  authority: FeedbackAuthority | undefined,
): boolean {
  if (
    authority === undefined ||
    !isFeedbackSchema<FeedbackAuthority>(FeedbackAuthoritySchema, authority)
  )
    return false;
  if (
    authority.schemaVersion !== FEEDBACK_AUTHORITY_VERSION ||
    authority.operation !== "create_issue" ||
    authority.targetRepositoryId !== packet.target.repositoryId ||
    authority.fingerprint !== packet.telemetry.fingerprint ||
    authority.previewHash !== packetPreviewHash(packet)
  )
    return false;
  return (
    authority.source === "current_user" ||
    (authority.source === "policy_safe_telemetry" &&
      packet.narrative === undefined &&
      packet.narrativeFindings.length === 0)
  );
}
