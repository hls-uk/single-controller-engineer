/**
 * The provenance projection codec.
 *
 * `LIMITS.projectionSnapshotBytes` is measured on the bytes actually stored,
 * and the live gate record repeats, once per output, everything the target
 * definition and the resolution already fix. The compact encoding
 * (`version: 2`) stores each of those exactly once. Two rules keep that
 * invisible: hydration is total and exact, so `hydrate(compact(x))` is
 * canonically byte-identical to `x`; and every commitment and derived
 * identifier binds the hydrated view rather than the stored bytes, so a run
 * still holding a version-free snapshot keeps the identifiers it was issued.
 * Pure: no clock, environment, subprocess, or randomness.
 */
import { canonicalJson, type JsonValue } from "./canonical.js";
import type {
  CompactGateMaterialisation,
  CompactGateResolution,
  CompactGateTargetState,
  GateMaterialisation,
  GateResolution,
  GateTargetDefinition,
  GateTargetState,
  HydratedProvenanceInput,
  ProvenanceInput,
  ProvenanceTargetEvidence,
} from "./schemas.js";

const utf8 = new TextEncoder();

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

/**
 * Drop every field hydration re-derives. The byte shape alone, asking nothing
 * of the record, so the reducer can measure the exact legal reserve of a
 * hypothetical target with it; `compactProvenanceInput` is the guarded entry
 * point that proves a real record reconstructible before applying it.
 */
export function compactTargetEvidenceShape(
  target: GateTargetState,
): CompactGateTargetState {
  const { materialisations, resolution, ...rest } = target;
  return {
    ...rest,
    materialisations: materialisations.map(compactMaterialisationShape),
    ...(resolution === undefined
      ? {}
      : { resolution: compactResolutionShape(resolution) }),
    version: 2,
  };
}

function compactResolutionShape(
  resolution: GateResolution,
): CompactGateResolution {
  const { sources: _sources, targetId: _targetId, ...rest } = resolution;
  return rest;
}

function compactMaterialisationShape(
  item: GateMaterialisation,
): CompactGateMaterialisation {
  const {
    observation,
    originUnitId: _originUnitId,
    sourceOid: _sourceOid,
    target: _target,
    targetId: _targetId,
    ...rest
  } = item;
  return {
    ...rest,
    ...(observation === undefined
      ? {}
      : {
          observation: {
            artifactStatus: observation.artifactStatus,
            sidecarStatus: observation.sidecarStatus,
          },
        }),
  };
}

/** Exactly the facts hydration re-derives, checked before they are dropped. */
function materialisationIsCompactable(
  item: GateMaterialisation,
  definition: GateTargetDefinition,
  sourceOid: string,
): boolean {
  if (
    item.targetId !== definition.targetId ||
    item.originUnitId !== definition.originUnitId ||
    item.sourceOid !== sourceOid ||
    !same(item.target, definition.target)
  )
    return false;
  if (item.observation === undefined) return true;
  return (
    item.sidecarByteCount !== undefined &&
    item.sidecarSha256 !== undefined &&
    item.observation.artifactByteCount === item.source.byteCount &&
    item.observation.artifactSha256 === item.source.sha256 &&
    item.observation.sidecarByteCount === item.sidecarByteCount &&
    item.observation.sidecarSha256 === item.sidecarSha256
  );
}

function targetEvidenceIsCompactable(target: GateTargetState): boolean {
  const resolution = target.resolution;
  if (resolution === undefined) return target.materialisations.length === 0;
  if ((resolution.sources !== undefined) !== (resolution.status === "observed"))
    return false;
  if (resolution.targetId !== target.definition.targetId) return false;
  if (
    resolution.sources !== undefined &&
    (resolution.sources.length !== target.materialisations.length ||
      resolution.sources.some(
        (source, index) =>
          !same(source, target.materialisations[index]?.source),
      ))
  )
    return false;
  return target.materialisations.every((item) =>
    materialisationIsCompactable(item, target.definition, resolution.sourceOid),
  );
}

/**
 * The pure upcaster. Total: `undefined` when a dropped field would not be
 * reconstructed exactly, and idempotent, so stored bytes stay canonical.
 */
export function compactProvenanceInput(
  input: ProvenanceInput,
): ProvenanceInput | undefined {
  const targetEvidence: ProvenanceTargetEvidence[] = [];
  for (const target of input.targetEvidence) {
    if ("version" in target) {
      targetEvidence.push(target);
      continue;
    }
    if (!targetEvidenceIsCompactable(target)) return undefined;
    targetEvidence.push(compactTargetEvidenceShape(target));
  }
  return { ...input, targetEvidence };
}

function hydrateMaterialisation(
  item: CompactGateMaterialisation,
  definition: GateTargetDefinition,
  sourceOid: string,
): GateMaterialisation | undefined {
  const { observation, sidecarByteCount, sidecarSha256, ...rest } = item;
  const derived =
    observation === undefined
      ? undefined
      : sidecarByteCount === undefined || sidecarSha256 === undefined
        ? "unreconstructible"
        : {
            artifactByteCount: item.source.byteCount,
            artifactSha256: item.source.sha256,
            artifactStatus: observation.artifactStatus,
            sidecarByteCount,
            sidecarSha256,
            sidecarStatus: observation.sidecarStatus,
          };
  if (derived === "unreconstructible") return undefined;
  return {
    ...rest,
    ...(sidecarByteCount === undefined ? {} : { sidecarByteCount }),
    ...(sidecarSha256 === undefined ? {} : { sidecarSha256 }),
    originUnitId: definition.originUnitId,
    sourceOid,
    target: definition.target,
    targetId: definition.targetId,
    ...(derived === undefined ? {} : { observation: derived }),
  };
}

function hydrateTargetEvidence(
  target: ProvenanceTargetEvidence,
): GateTargetState | undefined {
  if (!("version" in target)) return target;
  const { materialisations, resolution, version: _version, ...rest } = target;
  if (resolution === undefined)
    return materialisations.length === 0
      ? { ...rest, materialisations: [] }
      : undefined;
  const hydrated: GateMaterialisation[] = [];
  for (const item of materialisations) {
    const entry = hydrateMaterialisation(
      item,
      target.definition,
      resolution.sourceOid,
    );
    if (entry === undefined) return undefined;
    hydrated.push(entry);
  }
  return {
    ...rest,
    materialisations: hydrated,
    resolution: {
      ...resolution,
      targetId: target.definition.targetId,
      ...(resolution.status === "observed"
        ? { sources: hydrated.map((item) => item.source) }
        : {}),
    },
  };
}

/** The pure downcaster onto the one semantic view. Total. */
export function hydrateProvenanceInput(
  input: ProvenanceInput,
): HydratedProvenanceInput | undefined {
  const targetEvidence: GateTargetState[] = [];
  for (const target of input.targetEvidence) {
    const hydrated = hydrateTargetEvidence(target);
    if (hydrated === undefined) return undefined;
    targetEvidence.push(hydrated);
  }
  return { ...input, targetEvidence };
}

/**
 * A stored projection must be exactly one of the two canonical encodings of
 * its own hydrated view; anything else is ambiguous machine state.
 */
export function projectionEncodingIsCanonical(
  input: ProvenanceInput,
  hydrated: HydratedProvenanceInput,
): boolean {
  const stored = canonicalJson(input as unknown as JsonValue);
  if (stored === canonicalJson(hydrated as unknown as JsonValue)) return true;
  const compact = compactProvenanceInput(hydrated);
  return (
    compact !== undefined &&
    stored === canonicalJson(compact as unknown as JsonValue)
  );
}

/** Canonical bytes of the encoding this projection is stored in. */
export function projectionStorageByteLength(input: ProvenanceInput): number {
  const compact = compactProvenanceInput(input) ?? input;
  return utf8.encode(canonicalJson(compact as unknown as JsonValue)).byteLength;
}
