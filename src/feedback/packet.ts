import { canonicalJson } from "../protocol/canonical.js";
import { sha256 } from "../protocol/evidence.js";
import {
  FeedbackTargetSchema,
  isFeedbackSchema,
  ReviewedNarrativeInputSchema,
  SafeTelemetryInputSchema,
} from "./schemas.js";
import {
  MAX_NARRATIVE_BYTES,
  inspectNarrative,
  normalizedText,
  safeTelemetryText,
  type NarrativeFinding,
} from "./normalize.js";

export const FEEDBACK_SCHEMA_VERSION = 1 as const;
export const FIXED_TARGET_NAME = "hls-uk/single-controller-engineer";
export const FIXED_TARGET_HOST = "github.com";
export const FIXED_TARGET_REPOSITORY_ID = "R_kgDOUCvUmw";

export type FeedbackKind = "bug" | "enhancement";
export type FeedbackComponent =
  "adapter" | "capability" | "protocol" | "runtime" | "topology";
export type ModelTier = "frontier" | "workhorse";
export type FeedbackProtocolState =
  "blocked" | "failed" | "preflight" | "recovery" | "verification";

export interface FeedbackTarget {
  readonly host: "github.com";
  /** GitHub immutable node ID, supplied from the pinned release manifest. */
  readonly repositoryId: typeof FIXED_TARGET_REPOSITORY_ID;
  readonly repository: "hls-uk/single-controller-engineer";
}

/** Versioned release-manifest contract; callers cannot select a destination. */
export const FEEDBACK_RELEASE_MANIFEST = {
  schemaVersion: FEEDBACK_SCHEMA_VERSION,
  target: {
    host: FIXED_TARGET_HOST,
    repositoryId: FIXED_TARGET_REPOSITORY_ID,
    repository: FIXED_TARGET_NAME,
  },
} as const satisfies Readonly<{
  schemaVersion: number;
  target: FeedbackTarget;
}>;
export const FIXED_FEEDBACK_TARGET: FeedbackTarget =
  FEEDBACK_RELEASE_MANIFEST.target;

export interface SafeTelemetryInput {
  readonly kind: FeedbackKind;
  readonly component: FeedbackComponent;
  readonly toolVersion: string;
  readonly toolchain: string;
  readonly requestedModelTier: ModelTier;
  readonly protocolState: FeedbackProtocolState;
  readonly stableErrorCode: string;
  readonly capabilityId: string;
}

export interface ReviewedNarrativeInput {
  readonly expected?: string;
  readonly observed?: string;
  readonly reproduction?: string;
  readonly limitation?: string;
  readonly desiredCapability?: string;
  readonly value?: string;
  readonly workaround?: string;
  readonly completionExample?: string;
}

export interface SafeTelemetry extends SafeTelemetryInput {
  readonly schemaVersion: typeof FEEDBACK_SCHEMA_VERSION;
  readonly destinationRepositoryId: string;
  readonly toolMajorMinor: string;
  readonly fingerprint: string;
}

export interface FeedbackPacket {
  readonly schemaVersion: typeof FEEDBACK_SCHEMA_VERSION;
  readonly target: FeedbackTarget;
  readonly telemetry: SafeTelemetry;
  readonly narrative?: ReviewedNarrativeInput;
  readonly title: string;
  readonly body: string;
  readonly marker: string;
  readonly narrativeFindings: readonly NarrativeFinding[];
}

export interface FeedbackPreview {
  readonly targetUrl: "https://github.com/hls-uk/single-controller-engineer";
  readonly repositoryId: string;
  readonly title: string;
  readonly body: string;
  readonly marker: string;
  readonly requiresCurrentUserAuthority: boolean;
  readonly narrativeFindings: readonly NarrativeFinding[];
}

const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.[0-9]+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const TOOLCHAIN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/u;
const ERROR = /^[A-Z][A-Z0-9_]{0,79}$/u;
const CAPABILITY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const REPOSITORY_ID = /^[A-Za-z0-9_:-]{8,256}$/u;
const KINDS = new Set<FeedbackKind>(["bug", "enhancement"]);
const COMPONENTS = new Set<FeedbackComponent>([
  "adapter",
  "capability",
  "protocol",
  "runtime",
  "topology",
]);
const TIERS = new Set<ModelTier>(["frontier", "workhorse"]);
const STATES = new Set<FeedbackProtocolState>([
  "blocked",
  "failed",
  "preflight",
  "recovery",
  "verification",
]);
const NARRATIVE_KEYS = [
  "expected",
  "observed",
  "reproduction",
  "limitation",
  "desiredCapability",
  "value",
  "workaround",
  "completionExample",
] as const;

function majorMinor(version: string): string | undefined {
  const match = SEMVER.exec(version);
  return match === null ? undefined : `${match[1]}.${match[2]}`;
}

export function validTarget(target: FeedbackTarget): boolean {
  return (
    isFeedbackSchema<FeedbackTarget>(FeedbackTargetSchema, target) &&
    target.host === FIXED_TARGET_HOST &&
    target.repository === FIXED_TARGET_NAME &&
    target.repositoryId === FIXED_TARGET_REPOSITORY_ID &&
    REPOSITORY_ID.test(target.repositoryId)
  );
}

/** RFC 8785 input is deliberately exactly the documented eight fields. */
export function fingerprintInput(
  telemetry: Omit<SafeTelemetry, "fingerprint">,
) {
  return {
    capability_id: telemetry.capabilityId,
    component: telemetry.component,
    destination_repository_id: telemetry.destinationRepositoryId,
    kind: telemetry.kind,
    protocol_state: telemetry.protocolState,
    schema_version: telemetry.schemaVersion,
    stable_error_code: telemetry.stableErrorCode,
    tool_major_minor: telemetry.toolMajorMinor,
  } as const;
}

export function feedbackFingerprint(
  telemetry: Omit<SafeTelemetry, "fingerprint">,
): string {
  return sha256(canonicalJson(fingerprintInput(telemetry)));
}

export function feedbackMarker(telemetry: SafeTelemetry): string {
  return `<!-- sce-feedback:v${telemetry.schemaVersion};kind=${telemetry.kind};component=${telemetry.component};tool=${telemetry.toolMajorMinor};fingerprint=${telemetry.fingerprint} -->`;
}

/** Local-only preview. The immutable ID remains visible beside the fixed URL. */
export function previewFeedback(packet: unknown): FeedbackPreview | undefined {
  const valid = validateFeedbackPacket(packet);
  if (valid === undefined) return undefined;
  return {
    targetUrl: "https://github.com/hls-uk/single-controller-engineer",
    repositoryId: valid.target.repositoryId,
    title: valid.title,
    body: valid.body,
    marker: valid.marker,
    requiresCurrentUserAuthority:
      valid.narrative !== undefined || valid.narrativeFindings.length > 0,
    narrativeFindings: valid.narrativeFindings,
  };
}

function normalizeNarrative(
  input: ReviewedNarrativeInput | undefined,
): ReviewedNarrativeInput | undefined {
  if (input === undefined) return undefined;
  if (
    !isFeedbackSchema<ReviewedNarrativeInput>(
      ReviewedNarrativeInputSchema,
      input,
    )
  )
    return undefined;
  const source = input as ReviewedNarrativeInput;
  const normalized: Record<string, string> = {};
  for (const key of NARRATIVE_KEYS) {
    const value = source[key];
    if (value === undefined) continue;
    const result = normalizedText(value, MAX_NARRATIVE_BYTES);
    if (result === undefined || result.length === 0) return undefined;
    normalized[key] = result;
  }
  if (Object.keys(normalized).length === 0) return undefined;
  const bytes = new TextEncoder().encode(
    Object.values(normalized).join("\n"),
  ).byteLength;
  return bytes <= MAX_NARRATIVE_BYTES ? normalized : undefined;
}

function narrativeBody(narrative: ReviewedNarrativeInput): string {
  return NARRATIVE_KEYS.flatMap((key) => {
    const value = narrative[key];
    return value === undefined ? [] : [`## ${key}\n${value}`];
  }).join("\n\n");
}

/** Builds output only from allowlisted fields; no logs, sources, or environment enter. */
export function prepareFeedback(
  input: SafeTelemetryInput,
  narrativeInput?: ReviewedNarrativeInput,
): FeedbackPacket | undefined {
  if (!isFeedbackSchema<SafeTelemetryInput>(SafeTelemetryInputSchema, input))
    return undefined;
  const toolVersion = safeTelemetryText(input.toolVersion, 80);
  const toolchain = safeTelemetryText(input.toolchain, 80);
  const stableErrorCode = safeTelemetryText(input.stableErrorCode, 80);
  const capabilityId = safeTelemetryText(input.capabilityId, 160);
  if (
    toolVersion === undefined ||
    toolchain === undefined ||
    stableErrorCode === undefined ||
    capabilityId === undefined ||
    !SEMVER.test(toolVersion) ||
    !TOOLCHAIN.test(toolchain) ||
    !ERROR.test(stableErrorCode) ||
    !CAPABILITY.test(capabilityId) ||
    !KINDS.has(input.kind) ||
    !COMPONENTS.has(input.component) ||
    !TIERS.has(input.requestedModelTier) ||
    !STATES.has(input.protocolState)
  )
    return undefined;
  const toolMajorMinor = majorMinor(toolVersion);
  if (toolMajorMinor === undefined) return undefined;
  const unsigned = {
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    destinationRepositoryId: FIXED_TARGET_REPOSITORY_ID,
    kind: input.kind,
    component: input.component,
    toolVersion,
    toolchain,
    requestedModelTier: input.requestedModelTier,
    protocolState: input.protocolState,
    stableErrorCode,
    capabilityId,
    toolMajorMinor,
  } as const;
  const telemetry: SafeTelemetry = {
    ...unsigned,
    fingerprint: feedbackFingerprint(unsigned),
  };
  const narrative = normalizeNarrative(narrativeInput);
  if (narrativeInput !== undefined && narrative === undefined) return undefined;
  const marker = feedbackMarker(telemetry);
  const title = `[SCE ${telemetry.kind}] ${telemetry.component}: ${telemetry.stableErrorCode}`;
  const body = [
    "<!-- Generated controlled telemetry. -->",
    `- Component: ${telemetry.component}`,
    `- Tool version: ${telemetry.toolVersion}`,
    `- Toolchain: ${telemetry.toolchain}`,
    `- Requested model tier: ${telemetry.requestedModelTier}`,
    `- Protocol state: ${telemetry.protocolState}`,
    `- Stable error code: ${telemetry.stableErrorCode}`,
    `- Capability: ${telemetry.capabilityId}`,
    ...(narrative === undefined
      ? []
      : ["", "# Reviewed narrative", narrativeBody(narrative)]),
    "",
    marker,
  ].join("\n");
  const narrativeFindings =
    narrative === undefined ? [] : inspectNarrative(narrativeBody(narrative));
  return {
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    target: FIXED_FEEDBACK_TARGET,
    telemetry,
    ...(narrative === undefined ? {} : { narrative }),
    title,
    body,
    marker,
    narrativeFindings,
  };
}

/**
 * One boundary for persisted, CLI, authority, and provider-facing packets.
 * It rebuilds every generated byte from allowlisted fields; callers receive no
 * packet when a target, fingerprint, title, marker, or narrative was forged.
 */
export function validateFeedbackPacket(
  value: unknown,
): FeedbackPacket | undefined {
  try {
    if (!isRecord(value) || !isRecord(value.telemetry)) return undefined;
    const source = value.telemetry;
    const candidate = prepareFeedback(
      {
        kind: source.kind,
        component: source.component,
        toolVersion: source.toolVersion,
        toolchain: source.toolchain,
        requestedModelTier: source.requestedModelTier,
        protocolState: source.protocolState,
        stableErrorCode: source.stableErrorCode,
        capabilityId: source.capabilityId,
      } as SafeTelemetryInput,
      value.narrative as ReviewedNarrativeInput | undefined,
    );
    return candidate !== undefined &&
      JSON.stringify(candidate) === JSON.stringify(value)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
