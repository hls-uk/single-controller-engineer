/**
 * The provenance projection codec.
 *
 * `LIMITS.projectionSnapshotBytes` is measured on the bytes actually stored,
 * and the live gate record repeats, once per output, everything the target
 * definition and the resolution already fix. The compact encoding
 * (`version: 2`) stores each of those exactly once. `version: 3` additionally
 * retires the resolution's live budget, which `frozenTargetEvidence` drops
 * when the live target is frozen. Two rules keep all of it invisible:
 * hydration is total and exact, so `hydrate(compact(x))` is canonically
 * byte-identical to `x`; and every commitment and derived identifier binds the
 * hydrated view rather than the stored bytes, so a run still holding a
 * version-free or version-2 snapshot keeps the identifiers it was issued.
 * Pure: no clock, environment, subprocess, or randomness.
 */
import { canonicalJson, type JsonValue } from "./canonical.js";
import { HydratedProvenanceInputSchema, validate } from "./schemas.js";
import type {
  CompactGateMaterialisation,
  CompactGateResolution,
  CompactGateResolutionV3,
  CompactGateTargetState,
  CompactGateTargetStateV3,
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
): CompactGateTargetState | CompactGateTargetStateV3 {
  const { materialisations, resolution, ...rest } = target;
  const entries = materialisations.map(compactMaterialisationShape);
  // The version is decided by what there is to drop, never by the producer, so
  // re-encoding a projection frozen before version 3 reproduces its own bytes
  // and the canonicality rule stays a single deterministic form per view.
  if (resolution !== undefined && resolution.capacities === undefined)
    return {
      ...rest,
      materialisations: entries,
      resolution: retiredResolutionShape(resolution),
      version: 3,
    };
  return {
    ...rest,
    materialisations: entries,
    ...(resolution === undefined
      ? {}
      : { resolution: compactResolutionShape(resolution) }),
    version: 2,
  };
}

/**
 * The live target as the frozen projection keeps it: the resolution without
 * the controller's remaining live budget, which the live gate record still
 * holds and no provenance reader can act on. Freezing is the only place the
 * budget is dropped, so a projection frozen before version 3 keeps the exact
 * view its commitments were taken over.
 */
export function frozenTargetEvidence(target: GateTargetState): GateTargetState {
  const resolution = target.resolution;
  if (resolution?.capacities === undefined) return target;
  const { capacities: _capacities, ...retired } = resolution;
  return { ...target, resolution: retired };
}

function compactResolutionShape(
  resolution: GateResolution,
): CompactGateResolution {
  const { sources: _sources, targetId: _targetId, ...rest } = resolution;
  return rest;
}

/** Only reachable for a resolution whose budget is already retired. */
function retiredResolutionShape(
  resolution: GateResolution,
): CompactGateResolutionV3 {
  const {
    capacities: _capacities,
    sources: _sources,
    targetId: _targetId,
    ...rest
  } = resolution;
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

/**
 * The pure downcaster onto the one semantic view. Total, and checked against
 * the schema of that view rather than against an erased type: a compact arm
 * drops fields the version-free arm constrains, so it is legal in places the
 * view it rebuilds is not. An observed resolution with no outputs is the
 * witness — it is a legal compact entry and rebuilds the empty `sources` the
 * version-free arm forbids — so a stored encoding could otherwise smuggle a
 * view past the one schema every consumer and commitment reads.
 */
export function hydrateProvenanceInput(
  input: ProvenanceInput,
): HydratedProvenanceInput | undefined {
  const targetEvidence: GateTargetState[] = [];
  for (const target of input.targetEvidence) {
    const hydrated = hydrateTargetEvidence(target);
    if (hydrated === undefined) return undefined;
    targetEvidence.push(hydrated);
  }
  const view = { ...input, targetEvidence };
  return validate(HydratedProvenanceInputSchema, view).ok ? view : undefined;
}

/**
 * A stored projection must be exactly the version-free encoding of its own
 * hydrated view or the single compact encoding of it; anything else, a
 * half-compacted projection included, is ambiguous machine state.
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
