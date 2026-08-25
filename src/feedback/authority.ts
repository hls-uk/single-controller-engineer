import { canonicalJson } from "../protocol/canonical.js";
import { sha256 } from "../protocol/evidence.js";
import { type FeedbackPacket, validateFeedbackPacket } from "./packet.js";
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

function packetPreviewHashUnchecked(packet: FeedbackPacket): string {
  return sha256(
    canonicalJson({
      body: packet.body,
      target_repository_id: packet.target.repositoryId,
      title: packet.title,
    }),
  );
}

export function packetPreviewHash(packet: unknown): string | undefined {
  const valid = validateFeedbackPacket(packet);
  return valid === undefined ? undefined : packetPreviewHashUnchecked(valid);
}

export function authorityFor(
  packet: unknown,
  source: AuthoritySource,
  operationNonce: string,
): FeedbackAuthority | undefined {
  const valid = validateFeedbackPacket(packet);
  if (valid === undefined) return undefined;
  const authority: FeedbackAuthority = {
    schemaVersion: FEEDBACK_AUTHORITY_VERSION,
    operation: "create_issue",
    source,
    targetRepositoryId: valid.target.repositoryId,
    fingerprint: valid.telemetry.fingerprint,
    previewHash: packetPreviewHashUnchecked(valid),
    operationNonce,
  };
  return isFeedbackSchema<FeedbackAuthority>(FeedbackAuthoritySchema, authority)
    ? authority
    : undefined;
}

/** Policy authority can never authorize a reviewed narrative or warning. */
export function authorizes(packet: unknown, authority: unknown): boolean {
  const valid = validateFeedbackPacket(packet);
  if (
    valid === undefined ||
    authority === undefined ||
    !isFeedbackSchema<FeedbackAuthority>(FeedbackAuthoritySchema, authority)
  )
    return false;
  if (
    authority.schemaVersion !== FEEDBACK_AUTHORITY_VERSION ||
    authority.operation !== "create_issue" ||
    authority.targetRepositoryId !== valid.target.repositoryId ||
    authority.fingerprint !== valid.telemetry.fingerprint ||
    authority.previewHash !== packetPreviewHashUnchecked(valid)
  )
    return false;
  return (
    authority.source === "current_user" ||
    (authority.source === "policy_safe_telemetry" &&
      valid.narrative === undefined &&
      valid.narrativeFindings.length === 0)
  );
}
