/**
 * Controller-configuration onboarding.  `composeControllerConfig` is a pure
 * function from an explicit repository observation to a candidate
 * `sce.controller-config` document; `observeRepository` is the only part that
 * touches the host (read-only preflight, Git remote inspection, executable
 * lookup, manifest read).  The composed document is self-validated through the
 * same strict parser the CLI uses before it is written, so a caller never
 * receives a configuration the engine would later refuse.
 */
import { randomUUID } from "node:crypto";
import { access, constants, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, isAbsolute, join, resolve } from "node:path";

import {
  HARNESS_VERSION,
  harnessSupportCommitment,
  parseHarnessSupport,
  type HarnessSupport,
  type HarnessTrustClassification,
} from "../harness/index.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical.js";
import {
  canonicalTaskMetadata,
  deriveIdempotencyKey,
  runInvariantErrors,
} from "../protocol/reducer.js";
import {
  ChildTaskRecordSchema,
  type ChildTaskRecord,
  LIMITS,
  RepositoryRunSchema,
  type Unit,
  validate,
  type AuthorityProfile,
  type CompletionBoundary,
  type IntegrationProfile,
  type RepositoryRun,
} from "../protocol/schemas.js";
import {
  canonicalLocalBareRepository,
  containsSecretShape,
  inspectPreflight,
  normalizeGitRemote,
  parseGitRemoteConfigOutput,
  type PreflightEnvelope,
} from "../preflight/index.js";
import { validateControllerConfigDocument } from "../controller-config.js";
import {
  DoltProjectionPersistence,
  PINNED_BD_VERSION,
  PINNED_DOLT_VERSION,
  PinnedBdEmbeddedProcess,
  SLOT_INITIALIZATION_AUTHORITY,
} from "../adapters/beads-embedded/index.js";
import {
  MERGE_SLOT_LABEL,
  MERGE_SLOT_TITLE,
  deriveScopeCommitment,
  type FencingScope,
} from "../fencing/index.js";

export const COMPOSE_SCHEMA = "sce.compose-config" as const;
export const KNOWLEDGE_MANIFEST_FILE = "knowledge-manifest.json";
export const harnessFamilies = ["claude", "codex"] as const;
export type HarnessFamily = (typeof harnessFamilies)[number];
export type BeadsMode = "local-only" | "git-sync";

const ZERO_HASH = "0".repeat(64);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const HOLDER_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{0,159}$/u;
const DRIVE_ALIAS = /^[a-z][a-z0-9-]{0,62}$/u;
/** An artifact home on a drive: `<declared alias>:<canonical subpath>`. */
const DRIVE_HOME =
  /^([a-z][a-z0-9-]{0,62}):([A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)$/u;
/** A canonical contained subpath: no escape, no glob, no empty segment. */
const CANONICAL_SUBPATH =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u;
/** A bounded single-directory glob; `**` and dot segments stay refused. */
const CANONICAL_SOURCE_PATTERN =
  /^(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\\)(?!.*\*\*)[A-Za-z0-9][A-Za-z0-9._*?-]*(?:\/[A-Za-z0-9][A-Za-z0-9._*?-]*)*$/u;
/**
 * A drive marker is an exact safe basename: `DriveAliasSchema.markerFile`
 * without the dot segments its grammar would otherwise admit, so joining it
 * to a mount root can never name the mount itself or its parent.
 */
const SAFE_BASENAME = /^(?!\.\.?$)[A-Za-z0-9.][A-Za-z0-9._-]*$/u;
/** `DriveAliasSchema.markerFile` bound; the grammar is ASCII, so bytes match. */
const MARKER_FILE_BYTES = 255;
/** `KnowledgeContractSchema.aliases` bound. */
const DRIVE_ALIASES = 64;
const MAX_MANIFEST_BYTES = 256 * 1024;

/**
 * Default model routes per harness family.  They are starting points a caller
 * overrides explicitly; the engine records requested and returned identities
 * and never substitutes silently, so a wrong default fails at dispatch rather
 * than degrading.
 */
export const defaultModelRoutes: Readonly<
  Record<
    HarnessFamily,
    Readonly<{ controller: string; frontier: string; workhorse: string }>
  >
> = {
  claude: {
    controller: "claude-fable-5-1",
    frontier: "claude-fable-5-1",
    workhorse: "claude-opus-5",
  },
  codex: {
    controller: "gpt-5.6-sol",
    frontier: "gpt-5.6-sol",
    workhorse: "gpt-5.6-terra",
  },
};

/** Capability matrices as classified by DEC-20260901-008/009. */
const familyOperations: Readonly<
  Record<HarnessFamily, HarnessSupport["capabilities"]["operations"]>
> = {
  claude: {
    cancel: true,
    collect: true,
    controllerIdentity: false,
    inspect: true,
    launch: true,
    lookupByClientKey: false,
    poll: true,
    returnedModelIdentity: true,
  },
  codex: {
    cancel: true,
    collect: true,
    controllerIdentity: true,
    inspect: true,
    launch: true,
    lookupByClientKey: true,
    poll: true,
    returnedModelIdentity: true,
  },
};

const authorityShape: Readonly<
  Record<
    AuthorityProfile,
    Readonly<{
      completionBoundary: CompletionBoundary;
      integrationProfile: IntegrationProfile;
      needsRemote: boolean;
    }>
  >
> = {
  "local-change-only": {
    completionBoundary: "local-integration",
    integrationProfile: "local-ff",
    needsRemote: false,
  },
  "push-branch": {
    completionBoundary: "branch-handoff",
    integrationProfile: "none",
    needsRemote: true,
  },
  "open-pr": {
    completionBoundary: "pr-handoff",
    integrationProfile: "none",
    needsRemote: true,
  },
  integrate: {
    completionBoundary: "remote-integration",
    integrationProfile: "remote-ff",
    needsRemote: true,
  },
};

/**
 * A configured Git remote with the same normalized identity preflight derives
 * (local bare paths are realpath-proven by the observer, never by the pure
 * composer), so `bd`'s `sync.remote` can be matched by identity.
 */
export type GitRemoteObservation = Readonly<{
  name: string;
  normalized: string | undefined;
  url: string;
}>;

/** Everything the composer needs, observed once and passed in explicitly. */
/** One child bead of the root epic as `bd show --json` reports it. */
export type ChildBeadObservation = Readonly<{
  id: string;
  issueType: string;
  status: string;
  /** Raw `$.sce_task` metadata record, or undefined when the bead has none. */
  task: unknown;
}>;

export type RepositoryObservation = Readonly<{
  bdExecutable: string;
  /** Exact commit OIDs of the observed branches (current and requested). */
  branchHeads: Readonly<Record<string, string>>;
  /** Children of the requested root bead; empty when no root was requested. */
  children: readonly ChildBeadObservation[];
  currentBranch: string | undefined;
  doltExecutable: string;
  environment: (name: string) => string | undefined;
  /** Parsed `knowledge-manifest.json`, or undefined when the file is absent. */
  manifest: unknown;
  manifestPath: string | undefined;
  preflight: PreflightEnvelope;
  remotes: readonly GitRemoteObservation[];
}>;

export type ComposeOptions = Readonly<{
  authorityProfile?: AuthorityProfile;
  beadsMode?: BeadsMode;
  harnessFamily: HarnessFamily;
  /** Test seams; production callers leave them unset. */
  identities?: Readonly<{
    fencingToken?: string;
    incarnationId?: string;
    nonce?: string;
    runId?: string;
  }>;
  integrationBranch?: string;
  /** `true` requires a manifest, `false` ignores one, unset means "if present". */
  knowledge?: boolean;
  models?: Readonly<{
    controller?: string;
    frontier?: string;
    workhorse?: string;
  }>;
  rootBeadId: string;
}>;

export type ComposeFailureCode =
  | "SCE_COMPOSE_BRANCH_MISSING"
  | "SCE_COMPOSE_CONFIG_REJECTED"
  | "SCE_COMPOSE_ENVIRONMENT_MISSING"
  | "SCE_COMPOSE_HARNESS_INVALID"
  | "SCE_COMPOSE_MANIFEST_INVALID"
  | "SCE_COMPOSE_MANIFEST_MISSING"
  | "SCE_COMPOSE_OPTION_INVALID"
  | "SCE_COMPOSE_PREFLIGHT_REFUSED"
  | "SCE_COMPOSE_PREFLIGHT_UNINITIALIZED"
  | "SCE_COMPOSE_REMOTE_MISSING"
  | "SCE_COMPOSE_STORE_IDENTITY_MISSING"
  | "SCE_COMPOSE_SYNC_MODE_MISMATCH"
  | "SCE_COMPOSE_TOPOLOGY_UNSUPPORTED"
  | "SCE_COMPOSE_UNIT_INVALID";

/** The exact first command a fresh run accepts; the engine adds the slot plan. */
export type FirstAcquireRequest = Readonly<{
  command: "acquire-controller";
  request: Readonly<{
    event: Readonly<{
      eventId: string;
      expectedRevision: 0;
      idempotencyKey: string;
      type: "controller_acquire_intent";
    }>;
  }>;
}>;

export type ComposeSummary = Readonly<{
  authorityProfile: AuthorityProfile;
  beadsMode: BeadsMode;
  classification: HarnessTrustClassification;
  firstRequest: FirstAcquireRequest;
  harnessFamily: HarnessFamily;
  integrationBranch: string;
  knowledge: boolean;
  models: Readonly<{ controller: string; frontier: string; workhorse: string }>;
  /** Unit ids (child bead ids) planned into the initial run, in ordinal order. */
  plannedUnits: readonly string[];
  repositoryIdentity: string;
  rootBeadId: string;
  storeIdentity: string;
  warnings: readonly string[];
}>;

export type ComposeResult =
  | Readonly<{
      config: JsonValue;
      ok: true;
      summary: ComposeSummary;
    }>
  | Readonly<{ code: ComposeFailureCode; message: string; ok: false }>;

function fail(code: ComposeFailureCode, message: string): ComposeResult {
  return { code, message, ok: false };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && IDENTIFIER.test(value)
    ? value
    : undefined;
}

function shortRandom(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

/** Builds the harness support matrix for a family with explicit model routes. */
export function harnessSupportFor(
  family: HarnessFamily,
  models: Readonly<{ controller: string; frontier: string; workhorse: string }>,
): HarnessSupport {
  return {
    capabilities: {
      adapterVersion: HARNESS_VERSION,
      family,
      harnessVersion: HARNESS_VERSION,
      operations: familyOperations[family],
      schema: "sce.harness-capabilities",
      version: HARNESS_VERSION,
    },
    controller: {
      acceptedReturnedModels: [models.controller],
      requestedModel: models.controller,
    },
    frontier: {
      acceptedReturnedModels: [models.frontier],
      requestedModel: models.frontier,
    },
    schema: "sce.harness-support",
    version: HARNESS_VERSION,
    workhorse: {
      acceptedReturnedModels: [models.workhorse],
      requestedModel: models.workhorse,
    },
  };
}

/**
 * `KnowledgeContractSchema.humanDriver` is free text bounded in code units
 * and again in UTF-8 bytes, and the two differ outside ASCII, so the
 * projection measures both rather than trusting the shorter count.
 */
function boundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= LIMITS.text &&
    new TextEncoder().encode(value).length <= LIMITS.text
  );
}

/** These expressions are ASCII, so a code unit is exactly one UTF-8 byte. */
function bounded(value: unknown, expression: RegExp): string | undefined {
  return typeof value === "string" &&
    value.length <= LIMITS.materialisationPathBytes &&
    expression.test(value)
    ? value
    : undefined;
}

/** Splits a drive home, refusing an alias this manifest never declared. */
function driveHome(
  value: unknown,
  aliases: ReadonlySet<string>,
): Readonly<{ alias: string; subpath: string }> | undefined {
  const home = bounded(value, DRIVE_HOME);
  if (home === undefined) return undefined;
  const separator = home.indexOf(":");
  const alias = home.slice(0, separator);
  return aliases.has(alias)
    ? { alias, subpath: home.slice(separator + 1) }
    : undefined;
}

/** Two homes on one alias may not nest: the namespace is exclusive. */
function overlapping(
  left: Readonly<{ alias: string; subpath: string }>,
  right: Readonly<{ alias: string; subpath: string }>,
): boolean {
  return (
    left.alias === right.alias &&
    (left.subpath === right.subpath ||
      left.subpath.startsWith(`${right.subpath}/`) ||
      right.subpath.startsWith(`${left.subpath}/`))
  );
}

type ManifestContract = Readonly<{
  contract: Record<string, unknown>;
  variables: readonly string[];
}>;

/**
 * Projects the repository manifest onto the unresolved knowledge-contract
 * shape the configuration parser accepts.  Environment variable names are
 * carried as names; the parser resolves them at load time.  The projection is
 * a containment gate as well as a shape gate: every materialisation source
 * pattern is a canonical bounded glob inside the repository, every
 * destination names a declared alias with a contained subpath, and the two
 * drive homes name declared aliases whose subpaths never overlap.  It is a
 * bounds gate too: the human driver, the alias count, every marker basename,
 * and every environment name carry exactly the bounds the contract schema
 * enforces, so the shipped manifest schema, this projection, and the
 * configuration parser accept and refuse the same manifests.
 */
export function knowledgeContractFromManifest(
  manifest: unknown,
): ManifestContract | undefined {
  const value = record(manifest);
  const provenance = record(value?.provenance);
  const verification = record(value?.verification);
  const artifactHomes = record(value?.artifactHomes);
  if (
    value === undefined ||
    value.schema !== "sce.knowledge-manifest" ||
    value.version !== 1 ||
    provenance === undefined ||
    verification === undefined ||
    artifactHomes === undefined ||
    typeof artifactHomes.generated !== "string" ||
    !boundedText(value.humanDriver) ||
    !Array.isArray(value.driveAliases) ||
    value.driveAliases.length > DRIVE_ALIASES ||
    !Array.isArray(value.materialisationTargets)
  )
    return undefined;
  const variables: string[] = [];
  const variableNames = new Set<string>();
  const aliases: Record<string, unknown>[] = [];
  const aliasNames = new Set<string>();
  for (const candidate of value.driveAliases) {
    const alias = record(candidate);
    if (
      alias === undefined ||
      typeof alias.mountPathVariable !== "string" ||
      !ENVIRONMENT_NAME.test(alias.mountPathVariable) ||
      variableNames.has(alias.mountPathVariable) ||
      typeof alias.alias !== "string" ||
      !DRIVE_ALIAS.test(alias.alias) ||
      aliasNames.has(alias.alias) ||
      typeof alias.markerFile !== "string" ||
      alias.markerFile.length > MARKER_FILE_BYTES ||
      !SAFE_BASENAME.test(alias.markerFile)
    )
      return undefined;
    aliasNames.add(alias.alias);
    variableNames.add(alias.mountPathVariable);
    variables.push(alias.mountPathVariable);
    aliases.push({
      alias: alias.alias,
      markerFile: alias.markerFile,
      mountPathVariable: alias.mountPathVariable,
      mountPolicy: alias.mountPolicy,
      namespaceControl: alias.namespaceControl,
    });
  }
  const incoming = driveHome(artifactHomes.driveIncoming, aliasNames);
  const rendered = driveHome(artifactHomes.driveRendered, aliasNames);
  if (
    incoming === undefined ||
    rendered === undefined ||
    overlapping(incoming, rendered)
  )
    return undefined;
  for (const candidate of value.materialisationTargets) {
    const target = record(candidate);
    if (
      target === undefined ||
      bounded(target.sourcePattern, CANONICAL_SOURCE_PATTERN) === undefined ||
      typeof target.destinationAlias !== "string" ||
      !aliasNames.has(target.destinationAlias) ||
      bounded(target.destinationSubpath, CANONICAL_SUBPATH) === undefined
    )
      return undefined;
  }
  if (
    typeof provenance.worktreeRootVariable !== "string" ||
    !ENVIRONMENT_NAME.test(provenance.worktreeRootVariable) ||
    variableNames.has(provenance.worktreeRootVariable)
  )
    return undefined;
  variables.push(provenance.worktreeRootVariable);
  return {
    contract: {
      aliases,
      audience: value.audience,
      domainScope: value.accessDomainId,
      gateTargets: value.materialisationTargets,
      humanDriver: value.humanDriver,
      projectId: value.projectId,
      provenance: {
        eventsDirectory: provenance.eventsDirectory,
        generatedDirectory: artifactHomes.generated,
        recordFormatVersion: provenance.recordFormatVersion,
        reproducibilityCommand: provenance.reproducibilityCommand,
        rollupGeneratorCommand: provenance.rollupGeneratorCommand,
        worktreeRootVariable: provenance.worktreeRootVariable,
      },
      verification: {
        fast: verification.fast,
        integration: verification.integration,
        release: verification.release,
      },
    },
    variables,
  };
}

/** The pristine run a first `acquire-controller` starts from. */
export function pristineInitialRun(
  input: Readonly<{
    authorityProfile: AuthorityProfile;
    fencingToken: string;
    gitObjectFormat: "sha1" | "sha256";
    harness: Readonly<{ family: string; supportCommitment: string }>;
    incarnationId: string;
    integrationBranch: string;
    repositoryIdentity: string;
    requestedModel: string;
    runId: string;
    storeIdentity: string;
    /** Planned units in ordinal order; absent means a unit-free run. */
    units?: readonly Unit[];
  }>,
): RepositoryRun {
  const shape = authorityShape[input.authorityProfile];
  return {
    revision: 0,
    state: "initializing",
    storeIdentity: input.storeIdentity,
    repositoryIdentity: input.repositoryIdentity,
    integrationBranch: input.integrationBranch,
    authorityProfile: input.authorityProfile,
    completionBoundary: shape.completionBoundary,
    integrationProfile: shape.integrationProfile,
    gitObjectFormat: input.gitObjectFormat,
    controllerFencingToken: input.fencingToken,
    controller: {
      runId: input.runId,
      incarnationId: input.incarnationId,
      holder: `${input.runId}/${input.incarnationId}`,
      requestedModel: input.requestedModel,
      returnedModel: input.requestedModel,
      promptHash: ZERO_HASH,
      state: "unacquired",
    },
    harness: {
      adapterVersion: HARNESS_VERSION,
      family: input.harness.family,
      harnessVersion: HARNESS_VERSION,
      supportCommitment: input.harness.supportCommitment,
    },
    units: Object.fromEntries(
      (input.units ?? []).map((unit) => [unit.id, unit]),
    ),
    reservations: {},
    activeModifyingUnitIds: [],
    wave: { id: `${input.runId}-wave-0`, unitIds: [] },
    qualificationQueue: [],
    integrationQueue: [],
    effectJournal: [],
    processedEventIds: [],
    processedIdempotencyKeys: [],
    usedSessionCount: 0,
    sessionLineage: "",
    sessionLineageRoot: ZERO_HASH,
    closedUnitEvidence: "",
    closedUnitEvidenceCommitment: ZERO_HASH,
    journalCheckpoint: {
      revision: 0,
      compactedEffects: 0,
      compactedEvents: 0,
      compactedIdempotencyKeys: 0,
      commitment: ZERO_HASH,
    },
    journalCommitment: ZERO_HASH,
  };
}

/**
 * Projects the root epic's open children into planned initial units. A child
 * is planned only from a strictly valid `$.sce_task` record: no prose is
 * parsed and nothing is inferred. Children without a record are reported and
 * left out; an invalid record or an unplanned dependency refuses the whole
 * composition, because a wave must later cover every unit exactly once.
 */
export function planInitialUnits(
  children: readonly ChildBeadObservation[],
  baseOid: string | undefined,
  warnings: string[],
):
  | Readonly<{ ok: true; units: readonly Unit[] }>
  | Readonly<{ ok: false; message: string }> {
  const candidates = [...children]
    .filter((child) => child.status === "open" && child.issueType !== "epic")
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  const records = new Map<string, ChildTaskRecord>();
  for (const child of candidates) {
    if (child.task === undefined) {
      warnings.push(
        `${child.id} carries no $.sce_task record and is not planned as a unit.`,
      );
      continue;
    }
    if (identifier(child.id) === undefined)
      return { ok: false, message: `${child.id} is not a valid unit id.` };
    const parsed = validate<ChildTaskRecord>(ChildTaskRecordSchema, child.task);
    if (!parsed.ok || parsed.value === undefined)
      return {
        ok: false,
        message: `${child.id} carries an invalid $.sce_task record.`,
      };
    records.set(child.id, parsed.value);
  }
  if (records.size === 0) return { ok: true, units: [] };
  if (records.size > LIMITS.units)
    return {
      ok: false,
      message: `${records.size} planned children exceed the ${LIMITS.units}-unit envelope.`,
    };
  if (baseOid === undefined)
    return {
      ok: false,
      message:
        "the integration branch head could not be observed, so planned units have no base.",
    };
  for (const [id, record] of records)
    for (const dependency of record.dependencies)
      if (dependency === id || !records.has(dependency))
        return {
          ok: false,
          message: `${id} depends on ${dependency}, which is not a planned open sibling.`,
        };
  return {
    ok: true,
    units: [...records.entries()].map(([id, record], ordinal) => ({
      id,
      ordinal,
      revision: 0,
      state: "planned" as const,
      baseOid,
      // Stored in the reducer's canonical form: a later wave plan must find
      // every unit already exact, because planning never bumps a unit's
      // revision and a rewritten child would fail the batch validator.
      taskMetadata: canonicalTaskMetadata({ ...record, unitId: id }),
      reservationIds: [],
      repairCount: 0,
    })),
  };
}

/** Pure composition: observation plus options to a self-validated document. */
export function composeControllerConfig(
  observation: RepositoryObservation,
  options: ComposeOptions,
): ComposeResult {
  const warnings: string[] = [];
  const preflight = observation.preflight.payload;
  if (preflight.status === "refused")
    return fail(
      "SCE_COMPOSE_PREFLIGHT_REFUSED",
      `Preflight refused the repository (${preflight.code}).`,
    );
  if (preflight.status === "uninitialized")
    return fail(
      "SCE_COMPOSE_PREFLIGHT_UNINITIALIZED",
      "Beads is not initialized here; run bd init and bd merge-slot create first.",
    );
  const beads = preflight.beads;
  if (beads.mode !== "embedded")
    return fail(
      "SCE_COMPOSE_TOPOLOGY_UNSUPPORTED",
      `compose-config supports the embedded Beads topology only (observed ${beads.mode}); compose a shared-server configuration by hand.`,
    );
  if (
    beads.projectId === undefined ||
    beads.storePath === undefined ||
    beads.database === undefined ||
    beads.prefix === undefined
  )
    return fail(
      "SCE_COMPOSE_STORE_IDENTITY_MISSING",
      "bd context did not report a project id, store path, database and prefix.",
    );
  const rootBeadId = identifier(options.rootBeadId);
  if (rootBeadId === undefined || !rootBeadId.startsWith(`${beads.prefix}-`))
    return fail(
      "SCE_COMPOSE_OPTION_INVALID",
      `--root-bead must be an issue id with the ${beads.prefix} prefix.`,
    );
  const integrationBranch =
    options.integrationBranch ?? observation.currentBranch;
  if (
    integrationBranch === undefined ||
    identifier(integrationBranch) === undefined
  )
    return fail(
      "SCE_COMPOSE_BRANCH_MISSING",
      "The integration branch could not be observed; pass --branch.",
    );
  const authorityProfile = options.authorityProfile ?? "local-change-only";
  const syncConfigured = beads.syncRemote !== undefined;
  const beadsMode: BeadsMode =
    options.beadsMode ?? (syncConfigured ? "git-sync" : "local-only");
  if (beadsMode === "git-sync" && !syncConfigured)
    return fail(
      "SCE_COMPOSE_SYNC_MODE_MISMATCH",
      "git-sync mode needs bd config sync.remote; none is configured, use --beads-mode local-only.",
    );
  if (beadsMode === "local-only" && syncConfigured)
    return fail(
      "SCE_COMPOSE_SYNC_MODE_MISMATCH",
      "bd config sync.remote is set, so the embedded adapter requires git-sync mode; omit --beads-mode or pass git-sync.",
    );
  const syncRemote =
    beads.syncRemote === undefined
      ? undefined
      : observation.remotes.find(
          (remote) => remote.normalized === beads.syncRemote,
        );
  if (beadsMode === "git-sync" && syncRemote === undefined)
    return fail(
      "SCE_COMPOSE_REMOTE_MISSING",
      "No Git remote matches bd's configured sync.remote.",
    );
  const remoteName =
    syncRemote?.name ??
    observation.remotes.find((remote) => remote.name === "origin")?.name ??
    observation.remotes[0]?.name;
  if (authorityShape[authorityProfile].needsRemote && remoteName === undefined)
    return fail(
      "SCE_COMPOSE_REMOTE_MISSING",
      `The ${authorityProfile} authority profile needs a Git remote; none is configured.`,
    );

  const models = {
    controller:
      options.models?.controller ??
      defaultModelRoutes[options.harnessFamily].controller,
    frontier:
      options.models?.frontier ??
      defaultModelRoutes[options.harnessFamily].frontier,
    workhorse:
      options.models?.workhorse ??
      defaultModelRoutes[options.harnessFamily].workhorse,
  };
  const harnessSupport = harnessSupportFor(options.harnessFamily, models);
  const parsedHarness = parseHarnessSupport(harnessSupport);
  const commitment = harnessSupportCommitment(harnessSupport);
  if (!parsedHarness.ok || !commitment.ok)
    return fail(
      "SCE_COMPOSE_HARNESS_INVALID",
      parsedHarness.ok
        ? "harness support cannot be committed"
        : parsedHarness.reason,
    );
  if (parsedHarness.classification.dispatchRecovery === "at-most-once-manual")
    warnings.push(
      "The harness family is classified at-most-once-manual: an ambiguous author launch blocks for a human observation.",
    );
  if (parsedHarness.classification.tierEnforcement === "unavailable")
    warnings.push(
      "Tier enforcement is unavailable for this harness family: paths that need a proven controller tier fail explicitly.",
    );

  let knowledgeContract: Record<string, unknown> | undefined;
  const wantsKnowledge =
    options.knowledge ?? observation.manifest !== undefined;
  if (wantsKnowledge) {
    if (observation.manifest === undefined)
      return fail(
        "SCE_COMPOSE_MANIFEST_MISSING",
        `--knowledge was requested but ${KNOWLEDGE_MANIFEST_FILE} is absent.`,
      );
    const projected = knowledgeContractFromManifest(observation.manifest);
    if (projected === undefined)
      return fail(
        "SCE_COMPOSE_MANIFEST_INVALID",
        `${KNOWLEDGE_MANIFEST_FILE} is not a version 1 sce.knowledge-manifest the composer can project.`,
      );
    const missing = projected.variables.filter((name) => {
      const value = observation.environment(name);
      return (
        value === undefined ||
        !isAbsolute(value) ||
        resolve(value) !== value ||
        containsSecretShape(value)
      );
    });
    if (missing.length > 0)
      return fail(
        "SCE_COMPOSE_ENVIRONMENT_MISSING",
        `Set these variables to canonical absolute paths before composing: ${missing.join(", ")}.`,
      );
    knowledgeContract = projected.contract;
  } else if (observation.manifest !== undefined)
    warnings.push(
      `${KNOWLEDGE_MANIFEST_FILE} is present but ignored (--no-knowledge); the run will be a software run.`,
    );

  const runId =
    options.identities?.runId ?? `run-${dateStamp()}-${shortRandom()}`;
  const incarnationId =
    options.identities?.incarnationId ?? `inc-${shortRandom()}`;
  const fencingToken =
    options.identities?.fencingToken ?? `fence-${shortRandom()}`;
  const nonce = options.identities?.nonce ?? `nonce-${shortRandom()}`;
  for (const [name, value] of [
    ["runId", runId],
    ["incarnationId", incarnationId],
  ] as const)
    if (!HOLDER_PART.test(value))
      return fail(
        "SCE_COMPOSE_OPTION_INVALID",
        `${name} is not a valid holder part.`,
      );
  if (identifier(fencingToken) === undefined || identifier(nonce) === undefined)
    return fail(
      "SCE_COMPOSE_OPTION_INVALID",
      "identities must be identifiers.",
    );

  const planned = planInitialUnits(
    observation.children,
    observation.branchHeads[integrationBranch],
    warnings,
  );
  if (!planned.ok) return fail("SCE_COMPOSE_UNIT_INVALID", planned.message);
  const initialRun = pristineInitialRun({
    authorityProfile,
    fencingToken,
    gitObjectFormat: preflight.git.objectFormat,
    harness: {
      family: options.harnessFamily,
      supportCommitment: commitment.value,
    },
    incarnationId,
    integrationBranch,
    repositoryIdentity: preflight.git.identity,
    requestedModel: models.controller,
    runId,
    storeIdentity: beads.projectId,
    units: planned.units,
  });
  const runValidation = validate<RepositoryRun>(
    RepositoryRunSchema,
    initialRun,
  );
  const invariantErrors = runValidation.ok
    ? runInvariantErrors(initialRun)
    : ["schema"];
  if (!runValidation.ok || invariantErrors.length > 0)
    return fail(
      "SCE_COMPOSE_CONFIG_REJECTED",
      `The pristine run failed its own invariants: ${invariantErrors.join("; ")}.`,
    );

  const config: Record<string, unknown> = {
    schema: "sce.controller-config",
    version: 1,
    nonce,
    git: {
      ...(authorityShape[authorityProfile].needsRemote &&
      remoteName !== undefined
        ? { remote: remoteName }
        : {}),
      repository: {
        commonDir: preflight.git.commonDir,
        cwd: preflight.git.topLevel,
        identity: preflight.git.identity,
        objectFormat: preflight.git.objectFormat,
        remoteUrls: observation.remotes.map((remote) => remote.url),
      },
    },
    scope: {
      beadsStoreIdentity: beads.projectId,
      gitRepositoryIdentity: preflight.git.identity,
      integrationBranch,
    },
    harnessSupport,
    initialRun,
    ...(knowledgeContract === undefined ? {} : { knowledgeContract }),
    topology: {
      kind: "embedded",
      mode: beadsMode,
      bdExecutable: observation.bdExecutable,
      doltExecutable: observation.doltExecutable,
      databaseDirectory: join(beads.storePath, beads.database),
      prefix: beads.prefix,
      rootBeadId,
      // A planned unit is its own child bead: the engine writes the unit's
      // projection to that bead's `$.sce` beside the `$.sce_task` record.
      childBeadIds: Object.fromEntries(
        planned.units.map((unit) => [unit.id, unit.id]),
      ),
      ...(beadsMode === "git-sync" &&
      syncRemote !== undefined &&
      beads.syncRemote !== undefined
        ? {
            remote: {
              name: syncRemote.name,
              ref: "refs/dolt/data",
              url: beads.syncRemote,
            },
          }
        : {}),
      preflight: observation.preflight,
    },
  };
  if (
    !validateControllerConfigDocument(
      JSON.parse(canonicalJson(config as JsonValue)) as unknown,
      observation.environment,
    )
  )
    return fail(
      "SCE_COMPOSE_CONFIG_REJECTED",
      "The composed document was refused by the strict controller-config parser.",
    );
  return {
    config: config as JsonValue,
    ok: true,
    summary: {
      authorityProfile,
      beadsMode,
      classification: parsedHarness.classification,
      firstRequest: {
        command: "acquire-controller",
        request: {
          event: {
            eventId: `${runId}-acquire-1`,
            expectedRevision: 0,
            idempotencyKey: deriveIdempotencyKey(
              initialRun,
              0,
              null,
              "controller_acquire",
            ),
            type: "controller_acquire_intent",
          },
        },
      },
      harnessFamily: options.harnessFamily,
      integrationBranch,
      knowledge: knowledgeContract !== undefined,
      models,
      plannedUnits: planned.units.map((unit) => unit.id),
      repositoryIdentity: preflight.git.identity,
      rootBeadId,
      storeIdentity: beads.projectId,
      warnings,
    },
  };
}

type Captured = Readonly<{ ok: boolean; stdout: string }>;

/** Child ids from `bd list --parent <root> --json`; malformed output is empty. */
function childIds(source: string): readonly string[] {
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const row =
        item !== null && typeof item === "object"
          ? (item as Record<string, unknown>)
          : undefined;
      const id = row?.id;
      return typeof id === "string" && identifier(id) !== undefined ? [id] : [];
    });
  } catch {
    return [];
  }
}

/** One child from `bd show <id> --json`; the `$.sce_task` record stays raw. */
function childObservation(
  id: string,
  source: string,
): ChildBeadObservation | undefined {
  try {
    const parsed = JSON.parse(source) as unknown;
    const row = (Array.isArray(parsed) ? parsed[0] : parsed) as unknown;
    if (row === null || typeof row !== "object") return undefined;
    const record = row as Record<string, unknown>;
    if (record.id !== id) return undefined;
    const metadata =
      record.metadata !== null && typeof record.metadata === "object"
        ? (record.metadata as Record<string, unknown>)
        : undefined;
    return {
      id,
      issueType: typeof record.issue_type === "string" ? record.issue_type : "",
      status: typeof record.status === "string" ? record.status : "",
      task: metadata?.sce_task,
    };
  } catch {
    return undefined;
  }
}

function capture(
  cwd: string,
  executable: string,
  argv: readonly string[],
): Promise<Captured> {
  return new Promise((resolveCapture) => {
    const child = spawn(executable, argv, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolveCapture({ ok: false, stdout: "" }));
    child.on("close", (code) =>
      resolveCapture({
        ok: code === 0,
        stdout: Buffer.concat(chunks).toString("utf8"),
      }),
    );
  });
}

/** Resolves an executable on PATH to an absolute path, or undefined. */
export async function findExecutable(
  name: string,
  environmentPath: string | undefined = process.env.PATH,
): Promise<string | undefined> {
  if (isAbsolute(name)) return (await executable(name)) ? name : undefined;
  for (const directory of (environmentPath ?? "").split(delimiter)) {
    if (directory.length === 0 || !isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    if (await executable(candidate)) return candidate;
  }
  return undefined;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export type ObserveOptions = Readonly<{
  bdExecutable?: string;
  doltExecutable?: string;
  environment?: (name: string) => string | undefined;
  /** Requested integration branch; its head is observed beside the current one. */
  integrationBranch?: string;
  /** Root epic whose open children are observed as planning input. */
  rootBeadId?: string;
}>;

export type ObserveResult =
  | Readonly<{ observation: RepositoryObservation; ok: true }>
  | Readonly<{
      code:
        | "SCE_COMPOSE_EXECUTABLE_MISSING"
        | "SCE_COMPOSE_EXECUTABLE_VERSION"
        | "SCE_COMPOSE_MANIFEST_INVALID";
      message: string;
      ok: false;
    }>;

/**
 * The engine's Beads adapter pins exact tool versions and refuses silently at
 * run time; onboarding names the mismatch instead so it is fixed up front.
 */
export function executableVersionProblem(
  bdVersionOutput: string,
  doltVersionOutput: string,
): string | undefined {
  const bdOk = new RegExp(
    `^bd version ${PINNED_BD_VERSION.replaceAll(".", "\\.")}(?: \\(Homebrew\\))?\\n?$`,
    "u",
  ).test(bdVersionOutput);
  const doltLine = doltVersionOutput.split("\n", 1)[0];
  const doltOk = doltLine === `dolt version ${PINNED_DOLT_VERSION}`;
  if (bdOk && doltOk) return undefined;
  const problems = [
    ...(bdOk
      ? []
      : [
          `bd reports "${bdVersionOutput.trim().split("\n", 1)[0]}" but the engine pins ${PINNED_BD_VERSION}`,
        ]),
    ...(doltOk
      ? []
      : [
          `dolt reports "${doltLine ?? ""}" but the engine pins ${PINNED_DOLT_VERSION} (install that release and pass --dolt-executable)`,
        ]),
  ];
  return problems.join("; ");
}

/** Read-only host observation; every fact the composer uses enters here. */
export async function observeRepository(
  cwd: string,
  options: ObserveOptions = {},
): Promise<ObserveResult> {
  const bdExecutable = await findExecutable(options.bdExecutable ?? "bd");
  const doltExecutable = await findExecutable(options.doltExecutable ?? "dolt");
  if (bdExecutable === undefined || doltExecutable === undefined)
    return {
      code: "SCE_COMPOSE_EXECUTABLE_MISSING",
      message: `bd and dolt must be on PATH or passed explicitly (bd: ${bdExecutable ?? "missing"}, dolt: ${doltExecutable ?? "missing"}).`,
      ok: false,
    };
  const bdVersion = await capture(cwd, bdExecutable, ["--version"]);
  const doltVersion = await capture(cwd, doltExecutable, ["version"]);
  const versionProblem = executableVersionProblem(
    bdVersion.ok ? bdVersion.stdout : "",
    doltVersion.ok ? doltVersion.stdout : "",
  );
  if (versionProblem !== undefined)
    return {
      code: "SCE_COMPOSE_EXECUTABLE_VERSION",
      message: `Pinned tool versions do not match: ${versionProblem}.`,
      ok: false,
    };
  const preflight = await inspectPreflight(cwd);
  const remotes: GitRemoteObservation[] = [];
  const remoteOutput = await capture(cwd, "git", [
    "config",
    "--null",
    "--get-regexp",
    "^remote\\..*\\.url$",
  ]);
  if (remoteOutput.ok) {
    const urls = parseGitRemoteConfigOutput(remoteOutput.stdout) ?? [];
    const names = remoteOutput.stdout
      .slice(0, -1)
      .split("\u0000")
      .map((entry) =>
        entry
          .slice("remote.".length, entry.indexOf("\n"))
          .replace(/\.url$/u, ""),
      );
    urls.forEach((url, index) => {
      const name = names[index];
      if (name !== undefined && name.length > 0)
        remotes.push({
          name,
          normalized: normalizeGitRemote(url, canonicalLocalBareRepository),
          url,
        });
    });
  }
  const branchOutput = await capture(cwd, "git", ["branch", "--show-current"]);
  const currentBranch =
    branchOutput.ok && branchOutput.stdout.trim().length > 0
      ? branchOutput.stdout.trim()
      : undefined;
  const branchHeads: Record<string, string> = {};
  for (const branch of new Set(
    [currentBranch, options.integrationBranch].filter(
      (value): value is string => value !== undefined && value.length > 0,
    ),
  )) {
    const head = await capture(cwd, "git", [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `refs/heads/${branch}^{commit}`,
    ]);
    const oid = head.ok ? head.stdout.trim() : "";
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)) branchHeads[branch] = oid;
  }
  const children: ChildBeadObservation[] = [];
  if (options.rootBeadId !== undefined) {
    const listed = await capture(cwd, bdExecutable, [
      "list",
      "--parent",
      options.rootBeadId,
      "--json",
    ]);
    const ids = listed.ok ? childIds(listed.stdout) : [];
    for (const id of ids) {
      const shown = await capture(cwd, bdExecutable, ["show", id, "--json"]);
      const child = shown.ok ? childObservation(id, shown.stdout) : undefined;
      if (child !== undefined) children.push(child);
    }
  }
  const topLevel =
    preflight.payload.status === "ready" ? preflight.payload.git.topLevel : cwd;
  const manifestPath = join(topLevel, KNOWLEDGE_MANIFEST_FILE);
  let manifest: unknown;
  let manifestPresent = false;
  try {
    const source = await readFile(manifestPath, "utf8");
    manifestPresent = true;
    if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES)
      throw new Error("too large");
    manifest = JSON.parse(source) as unknown;
  } catch (error) {
    if (manifestPresent)
      return {
        code: "SCE_COMPOSE_MANIFEST_INVALID",
        message: `${KNOWLEDGE_MANIFEST_FILE} could not be read as JSON (${error instanceof Error ? error.message : "unknown"}).`,
        ok: false,
      };
  }
  return {
    observation: {
      bdExecutable,
      branchHeads,
      children,
      currentBranch,
      doltExecutable,
      environment: options.environment ?? ((name) => process.env[name]),
      manifest,
      manifestPath: manifestPresent ? manifestPath : undefined,
      preflight,
      remotes,
    },
    ok: true,
  };
}

export type WriteResult =
  | Readonly<{ ok: true; path: string }>
  | Readonly<{
      code: "SCE_COMPOSE_OUTPUT_EXISTS" | "SCE_COMPOSE_OUTPUT_FAILED";
      message: string;
      ok: false;
    }>;

/** Writes the document with no-clobber semantics unless overwrite is explicit. */
export async function writeComposedConfig(
  path: string,
  config: JsonValue,
  overwrite: boolean,
): Promise<WriteResult> {
  try {
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: overwrite ? "w" : "wx",
    });
    return { ok: true, path };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "EEXIST"
      ? {
          code: "SCE_COMPOSE_OUTPUT_EXISTS",
          message: `${path} exists; pass --overwrite to replace it.`,
          ok: false,
        }
      : {
          code: "SCE_COMPOSE_OUTPUT_FAILED",
          message: `${path} could not be written.`,
          ok: false,
        };
  }
}

/**
 * The merge-slot bead that `bd merge-slot create` makes is unbound: it carries
 * no scope. The engine's normal acquire, check and release paths refuse an
 * unbound slot, and only an explicitly authorized bootstrap binds it, so
 * onboarding inspects the slot and, on request, performs that one bootstrap.
 */
export type SlotScopeState = "bound" | "foreign" | "unbound" | "unreadable";

export function classifySlotDocument(
  source: string,
  prefix: string,
  scope: FencingScope,
): SlotScopeState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return "unreadable";
  }
  const issue =
    Array.isArray(parsed) && parsed.length === 1
      ? record(parsed[0])
      : undefined;
  if (
    issue === undefined ||
    issue.id !== `${prefix}-merge-slot` ||
    issue.title !== MERGE_SLOT_TITLE ||
    !Array.isArray(issue.labels) ||
    issue.labels.length !== 1 ||
    issue.labels[0] !== MERGE_SLOT_LABEL
  )
    return "unreadable";
  const empty = (value: unknown) =>
    value === undefined || value === null || value === "";
  if (empty(issue.external_ref) && empty(issue.design)) return "unbound";
  return issue.external_ref ===
    `sce-scope:v1:${deriveScopeCommitment(scope)}` &&
    issue.design === canonicalJson(scope as unknown as JsonValue)
    ? "bound"
    : "foreign";
}

export async function inspectSlotScope(
  cwd: string,
  bdExecutable: string,
  prefix: string,
  scope: FencingScope,
): Promise<SlotScopeState> {
  const shown = await capture(cwd, bdExecutable, [
    "show",
    `${prefix}-merge-slot`,
    "--long",
    "--json",
  ]);
  return shown.ok
    ? classifySlotDocument(shown.stdout, prefix, scope)
    : "unreadable";
}

export type ComposedTopology = Readonly<{
  bdExecutable: string;
  databaseDirectory: string;
  doltExecutable: string;
  prefix: string;
  remote?: Readonly<{ name: string; ref: string; url: string }>;
  rootBeadId: string;
}>;

/** The one authorized bootstrap: binds an unbound slot to this run's scope. */
export async function bindSlotScope(
  cwd: string,
  topology: ComposedTopology,
  scope: FencingScope,
): Promise<"applied" | "ambiguous" | "quarantined" | "unavailable"> {
  const result = await pinnedProcess(cwd, topology, scope).initializeSlotScope(
    SLOT_INITIALIZATION_AUTHORITY,
  );
  return result.code === "applied" ||
    result.code === "ambiguous" ||
    result.code === "quarantined"
    ? result.code
    : "unavailable";
}

export type DoltSyncState =
  "in-sync" | "local-ahead" | "remote-missing" | "local-only" | "unreachable";

function pinnedProcess(
  cwd: string,
  topology: ComposedTopology,
  scope: FencingScope,
): PinnedBdEmbeddedProcess {
  const projections = new DoltProjectionPersistence({
    childIssueId: () => undefined,
    databaseDirectory: topology.databaseDirectory,
    doltExecutable: topology.doltExecutable,
    rootIssueId: topology.rootBeadId,
  });
  return new PinnedBdEmbeddedProcess({
    bdExecutable: topology.bdExecutable,
    cwd,
    databaseDirectory: topology.databaseDirectory,
    doltExecutable: topology.doltExecutable,
    prefix: topology.prefix,
    projections,
    scope,
    ...(topology.remote === undefined ? {} : { remote: topology.remote }),
  });
}

/**
 * Whether the embedded store the run will drive is reachable through the
 * pinned process and, in git-sync mode, whether its Dolt head is already on
 * the remote: the first acquire refuses anything else as ambiguous.
 */
export async function inspectDoltSync(
  cwd: string,
  topology: ComposedTopology,
  scope: FencingScope,
): Promise<DoltSyncState> {
  const state = await pinnedProcess(cwd, topology, scope).execute({
    kind: "state",
  });
  if (state.kind !== "state" || !state.value.reachable) return "unreachable";
  if (topology.remote === undefined) return "local-only";
  if (state.value.remoteHead === undefined) return "remote-missing";
  return state.value.remoteHead === state.value.head
    ? "in-sync"
    : "local-ahead";
}

/** Pushes Dolt data after an onboarding write and reads the remote head back. */
export async function pushDoltData(
  cwd: string,
  topology: ComposedTopology,
  scope: FencingScope,
): Promise<DoltSyncState> {
  const pushed = await capture(cwd, topology.bdExecutable, ["dolt", "push"]);
  if (!pushed.ok) return "local-ahead";
  return inspectDoltSync(cwd, topology, scope);
}
