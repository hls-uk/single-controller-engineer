/**
 * Production composition for the recoverable Git effects.  The recovery
 * coordinator owns persistence and retry authority; this adapter only turns
 * exact, durable effect parameters into one Git operation or a read-only
 * discovery fact.
 */
import {
  discoverBranch,
  discoverIntegration,
  discoverPublication,
  discoverRemoteIntegration,
  discoverWorktree,
  ensureBranch,
  ensureWorktree,
  integrateLocalFastForward,
  integrateRemoteFastForward,
  publishCandidate,
  observeCandidate,
  verifyCandidateWorktree,
  verifyRepository,
  type GitEffect,
  type GitRepository,
  type GitRunner,
} from "../adapters/git/index.js";
import {
  createMaterialisationAdapter,
  type MaterialisationAdapter,
} from "../adapters/materialise/index.js";
import {
  createProvenanceAdapter,
  type AggregateVerifyEffect,
  type ProvenanceAdapter,
  type ProvenanceCommitEffect,
  type ProvenanceCommitResult,
} from "../adapters/git/provenance.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical.js";
import { sha256 } from "../protocol/evidence.js";
import {
  acknowledgeVerificationTool,
  createHarnessRecoveryEffectAdapter,
  type HarnessPort,
  verificationToolRequest,
} from "../harness/index.js";
import {
  deriveCandidateDiffHash,
  canFreezeKnowledgeContractAtFirstWave,
  deriveProvenanceCarryClaimKey,
  deriveProvenanceCarryExportId,
  projectionInputIsValid,
  rehydrateEffect,
  type ProtocolEffect,
} from "../protocol/reducer.js";
import type { FencingScope, RootProjection } from "../fencing/index.js";
import type {
  ProtocolEvent,
  KnowledgeContract,
  RepositoryRun,
  SlotTransitionIntent,
} from "../protocol/schemas.js";
import {
  LIMITS,
  ProvenanceInputSchema,
  validate,
  type ProvenanceCarry,
  type ProvenanceInput,
} from "../protocol/schemas.js";
import {
  provenanceCarryAncestorDigest,
  provenanceCarryLineageCommitment,
  provenanceCarrySnapshotCommitment,
} from "../protocol/reducer.js";
import {
  createRecoveryRunner,
  observationHash,
  recoveryEventId,
  type ExecuteResult,
  type ControllerTransitionPlanResult,
  type ReconcileResult,
  type RecoveryEffectAdapter,
  type RecoveryRunnerOptions,
} from "./recovery.js";

/**
 * Topology-specific controller authority.  Both Beads topologies can expose
 * this narrow port without letting Git recovery select, substitute, or mutate
 * a topology.  Reconciliation must be read-only; execution is called only
 * after the coordinator has persisted an exact controller transition.
 */
export interface ControllerTransitionRecoveryPort {
  prepareControllerTransition?(
    input: Readonly<{
      holder: string;
      kind: "acquire" | "release";
      scope: FencingScope;
    }>,
  ): Promise<ControllerTransitionPlanResult>;
  reconcileControllerTransition(
    transition: SlotTransitionIntent,
  ): Promise<ControllerTransitionRecoveryResult>;
  executeControllerTransition?(
    transition: SlotTransitionIntent,
  ): Promise<ControllerTransitionRecoveryResult>;
}

export type ControllerTransitionRecoveryResult = Readonly<{
  status: "observed" | "absent" | "blocked" | "ambiguous" | "unavailable";
}>;

export interface ProductionRecoveryEffectAdapterOptions {
  readonly git: Readonly<{
    repository: GitRepository;
    runner: GitRunner;
    /** Explicit configured remote name; no default remote is guessed. */
    remote?: string;
  }>;
  /** Required for controller acquire/release recovery; never inferred. */
  readonly topology?: ControllerTransitionRecoveryPort;
  /** Explicit versioned harness support; absent harness effects fail closed. */
  readonly harness?: Readonly<{ port?: HarnessPort; support: unknown }>;
  /** Injectable only for deterministic adapter fixtures. */
  readonly materialisation?: MaterialisationAdapter;
  /** Injectable only for deterministic provenance fixtures. */
  readonly provenance?: ProvenanceAdapter;
  /** Sole configured authority for knowledge-profile events and recovery. */
  readonly knowledgeContract?: KnowledgeContract;
  /** Authoritative Beads-root carry read/CAS/readback surface. */
  readonly carry?: ProvenanceCarryClaimRecoveryPort;
}

export type ProvenanceCarryClaimPlan = Readonly<{
  exportId: string;
  predecessorFinalRevision: number;
  predecessorJournalCheckpointCommitment: string;
  predecessorRootAggregateCommitment: string;
  predecessorRunId: string;
  predecessorWaveId: string;
  snapshotCommitment: string;
}>;

export type ProvenanceCarryProjectionPlan = Readonly<{
  carry: Omit<ProvenanceCarry, "claimRecordDigest" | "claimRevision">;
  plan: ProvenanceCarryClaimPlan;
}>;

export function planProvenanceCarryFromProjection(
  predecessorRootIssueId: string,
  currentRootIssueId: string,
  currentRun: RepositoryRun,
  predecessor: RootProjection,
):
  | Readonly<{ status: "planned"; value: ProvenanceCarryProjectionPlan }>
  | Readonly<{
      status: "refused";
      evidenceDigest: string;
      reason: Extract<
        ProtocolEvent,
        { type: "provenance_carry_claim_observed" }
      >["result"] extends infer Result
        ? Result extends { status: "predecessor_refused"; reason: infer Reason }
          ? Reason
          : never
        : never;
    }> {
  const refuse = (
    reason: Extract<
      ProtocolEvent,
      { type: "provenance_carry_claim_observed" }
    >["result"] extends infer Result
      ? Result extends { status: "predecessor_refused"; reason: infer Reason }
        ? Reason
        : never
      : never,
  ) => ({
    evidenceDigest: sha256(
      canonicalJson({
        domain: "sce.provenance-carry-predecessor-refusal.v1",
        predecessorRootIssueId,
        reason,
      }),
    ),
    reason,
    status: "refused" as const,
  });
  if (predecessorRootIssueId === currentRootIssueId)
    return refuse("lineage_invalid");
  const run = predecessor.run;
  if (
    run.storeIdentity !== currentRun.storeIdentity ||
    run.repositoryIdentity !== currentRun.repositoryIdentity ||
    run.integrationBranch !== currentRun.integrationBranch ||
    run.gitObjectFormat !== currentRun.gitObjectFormat
  )
    return refuse("scope_mismatch");
  if (run.state !== "released" || run.controller.state !== "released")
    return refuse("not_released");
  if (run.effectJournal.some((entry) => entry.status !== "observed"))
    return refuse("effects_unsettled");
  const provenance = run.gate?.provenance;
  if (
    provenance?.status !== "voided" ||
    provenance.disposition !== "deferred_by_controller"
  )
    return refuse("provenance_not_deferred");
  const snapshot = validate<ProvenanceInput>(
    ProvenanceInputSchema,
    provenance.projectionInputSnapshot,
  );
  if (
    !snapshot.ok ||
    snapshot.value === undefined ||
    snapshot.value.unitIds.length === 0 ||
    !projectionInputIsValid(snapshot.value) ||
    Buffer.byteLength(
      canonicalJson(snapshot.value as unknown as JsonValue),
      "utf8",
    ) > 65_536 ||
    snapshot.value.targetEvidence.reduce(
      (total, target) => total + target.materialisations.length,
      0,
    ) > LIMITS.materialisationOutputs
  )
    return refuse("snapshot_invalid");
  const ancestors = run.gate?.lineageAncestorDigests ?? [];
  if (
    new Set(ancestors).size !== ancestors.length ||
    run.gate?.lineageCommitment !== provenanceCarryLineageCommitment(ancestors)
  )
    return refuse("lineage_invalid");
  if (ancestors.length >= 128) return refuse("lineage_limit_exceeded");
  const currentAncestor = provenanceCarryAncestorDigest(
    currentRootIssueId,
    currentRun.controller.runId,
  );
  const predecessorAncestor = provenanceCarryAncestorDigest(
    predecessorRootIssueId,
    run.controller.runId,
  );
  if (
    ancestors.includes(currentAncestor) ||
    ancestors.includes(predecessorAncestor) ||
    run.controller.runId === currentRun.controller.runId
  )
    return refuse("lineage_invalid");
  const lineageAncestorDigests = [...ancestors, predecessorAncestor];
  const snapshotCommitment = provenanceCarrySnapshotCommitment(snapshot.value);
  const integrationOid =
    provenance.advancedBaseOid ??
    provenance.baseOid ??
    run.gate?.currentIntegrationOid;
  if (integrationOid === undefined) return refuse("projection_invalid");
  const exportId = deriveProvenanceCarryExportId({
    finalRevision: run.revision,
    integrationBranch: run.integrationBranch,
    predecessorRootAggregateCommitment: predecessor.aggregateCommitment,
    predecessorRunId: run.controller.runId,
    predecessorWaveId: run.gate!.waveId,
    repositoryIdentity: run.repositoryIdentity,
    snapshotCommitment,
    storeIdentity: run.storeIdentity,
  });
  const plan: ProvenanceCarryClaimPlan = {
    exportId,
    predecessorFinalRevision: run.revision,
    predecessorJournalCheckpointCommitment: run.journalCheckpoint.commitment,
    predecessorRootAggregateCommitment: predecessor.aggregateCommitment,
    predecessorRunId: run.controller.runId,
    predecessorWaveId: run.gate!.waveId,
    snapshotCommitment,
  };
  return {
    status: "planned",
    value: {
      plan,
      carry: {
        exportId,
        integrationOid,
        lineageAncestorDigests,
        lineageCommitment: provenanceCarryLineageCommitment(
          lineageAncestorDigests,
        ),
        predecessorFinalRevision: run.revision,
        predecessorJournalCheckpointCommitment:
          run.journalCheckpoint.commitment,
        predecessorRootAggregateCommitment: predecessor.aggregateCommitment,
        predecessorRootBeadId: predecessorRootIssueId,
        predecessorRunId: run.controller.runId,
        predecessorWaveId: run.gate!.waveId,
        projectionInputSnapshot: snapshot.value,
        snapshotCommitment,
      },
    },
  };
}

export interface ProvenanceCarryClaimRecoveryPort {
  prepareProvenanceCarryClaim(
    predecessorRootIssueId: string,
    currentRun: RepositoryRun,
  ): Promise<
    | Readonly<{ status: "planned"; plan: ProvenanceCarryClaimPlan }>
    | Readonly<{ status: "blocked" | "ambiguous" | "unavailable" }>
  >;
  executeProvenanceCarryClaim(
    effect: Extract<ProtocolEffect, { kind: "provenance_carry_claim" }>,
    run: RepositoryRun,
  ): Promise<
    | Readonly<{
        status: "observed";
        result: Extract<
          ProtocolEvent,
          { type: "provenance_carry_claim_observed" }
        >["result"];
      }>
    | Readonly<{ status: "ambiguous" | "unavailable" }>
  >;
  reconcileProvenanceCarryClaim(
    effect: Extract<ProtocolEffect, { kind: "provenance_carry_claim" }>,
    run: RepositoryRun,
  ): Promise<
    | Readonly<{
        status: "observed";
        result: Extract<
          ProtocolEvent,
          { type: "provenance_carry_claim_observed" }
        >["result"];
      }>
    | Readonly<{ status: "absent" | "ambiguous" | "unavailable" }>
  >;
}

/** Exact composition input; callers must supply topology proof and stores. */
export type ProductionRecoveryRunnerOptions = Omit<
  RecoveryRunnerOptions,
  "adapter" | "prepareControllerTransition"
> &
  ProductionRecoveryEffectAdapterOptions;

function ambiguous(): Readonly<{ status: "ambiguous" }> {
  return { status: "ambiguous" };
}

function unavailable(): Readonly<{ status: "unavailable" }> {
  return { status: "unavailable" };
}

/** Deliberately collapses adapter details so a CLI cannot disclose paths/URLs. */
function classifyDiscovery(
  result: GitEffect,
): "observed" | "absent" | "ambiguous" {
  if (result.state === "observed") return "observed";
  if (result.state === "refused" && result.code === "GIT_ABSENT")
    return "absent";
  return "ambiguous";
}

function eventBase(effect: ProtocolEffect, run: RepositoryRun) {
  return {
    effectId: effect.effectId,
    effectKind: effect.kind,
    eventId: recoveryEventId(effect.effectId),
    expectedRevision: run.revision,
    observationHash: observationHash({
      effectId: effect.effectId,
      kind: effect.kind,
      paramsHash: effect.paramsHash,
    }),
    unitId: effect.unitId,
    ...(effect.gateEntryId === undefined
      ? {}
      : { gateEntryId: effect.gateEntryId }),
  };
}

function observed(
  effect: ProtocolEffect,
  run: RepositoryRun,
): Extract<ReconcileResult, { status: "observed" }> | undefined {
  const base = eventBase(effect, run);
  const { unitId: omittedControllerUnitId, ...controllerBase } = base;
  void omittedControllerUnitId;
  switch (effect.kind) {
    case "controller_acquire":
      return {
        observation: {
          ...controllerBase,
          controllerFencingToken: effect.params.controllerFencingToken,
          holder: effect.params.holder,
          type: "controller_acquired",
        } as ProtocolEvent,
        status: "observed",
      };
    case "controller_release":
      return {
        observation: {
          ...controllerBase,
          type: "controller_released",
        } as ProtocolEvent,
        status: "observed",
      };
    case "branch_create":
      return {
        observation: {
          ...base,
          branchRef: effect.params.branchRef,
          type: "branch_observed",
        } as ProtocolEvent,
        status: "observed",
      };
    case "worktree_create":
      return {
        observation: {
          ...base,
          type: "worktree_observed",
          worktreePath: effect.params.worktreePath,
        } as ProtocolEvent,
        status: "observed",
      };
    case "publish":
      return {
        observation: {
          ...base,
          publication: {
            kind: "push_branch",
            remoteHeadOid: effect.params.candidate.headOid,
          },
          type: "publish_observed",
        } as ProtocolEvent,
        status: "observed",
      };
    case "integrate":
      return {
        observation: {
          ...base,
          baseOid: effect.params.candidate.baseOid,
          controllerFencingToken: effect.params.controllerFencingToken,
          headOid: effect.params.candidate.headOid,
          integrationOid: effect.params.candidate.headOid,
          treeOid: effect.params.candidate.treeOid,
          type: "integrate_observed",
        } as ProtocolEvent,
        status: "observed",
      };
    default:
      return undefined;
  }
}

function carryObservation(
  effect: Extract<ProtocolEffect, { kind: "provenance_carry_claim" }>,
  run: RepositoryRun,
  result: Extract<
    ProtocolEvent,
    { type: "provenance_carry_claim_observed" }
  >["result"],
): Extract<ExecuteResult, { status: "observed" }> {
  const { unitId: omittedUnitId, ...base } = eventBase(effect, run);
  void omittedUnitId;
  return {
    observation: {
      ...base,
      observationHash: observationHash(result as unknown as JsonValue),
      result,
      type: "provenance_carry_claim_observed",
    } as ProtocolEvent,
    status: "observed",
  };
}

async function materialisationResult(
  effect: Extract<
    ProtocolEffect,
    {
      kind: "materialisation_resolve" | "destination_probe" | "materialise";
    }
  >,
  run: RepositoryRun,
  adapter: MaterialisationAdapter,
): Promise<ExecuteResult> {
  const result =
    effect.kind === "materialisation_resolve"
      ? await adapter.resolve(effect)
      : effect.kind === "destination_probe"
        ? await adapter.probe(effect)
        : await adapter.materialise(effect);
  if (result.status === "ambiguous")
    return {
      status: "ambiguous",
      ...(result.observationHash === undefined
        ? {}
        : { observationHash: result.observationHash }),
    };
  const base = {
    ...eventBase(effect, run),
    observationHash: observationHash(result as unknown as JsonValue),
  };
  return {
    observation:
      effect.kind === "materialisation_resolve"
        ? ({
            ...base,
            result,
            type: "materialisation_sources_observed",
          } as ProtocolEvent)
        : effect.kind === "destination_probe"
          ? ({
              ...base,
              result,
              type: "destination_probe_observed",
            } as ProtocolEvent)
          : ({
              ...base,
              result,
              type: "materialise_observed",
            } as ProtocolEvent),
    status: "observed",
  };
}

async function discoveredMaterialisationResult(
  effect: Extract<ProtocolEffect, { kind: "materialise" }>,
  run: RepositoryRun,
  adapter: MaterialisationAdapter,
): Promise<ReconcileResult> {
  const result = await adapter.discoverMaterialise(effect);
  if (result.status === "absent") return { status: "absent" };
  if (result.status === "ambiguous")
    return {
      status: "ambiguous",
      ...(result.observationHash === undefined
        ? {}
        : { observationHash: result.observationHash }),
    };
  return {
    observation: {
      ...eventBase(effect, run),
      observationHash: observationHash(result as unknown as JsonValue),
      result,
      type: "materialise_observed",
    } as ProtocolEvent,
    status: "observed",
  };
}

function controllerTransition(
  effect: ProtocolEffect,
): SlotTransitionIntent | undefined {
  return effect.kind === "controller_acquire" ||
    effect.kind === "controller_release"
    ? effect.params.slotTransition
    : undefined;
}

function worktreeBase(
  effect: ProtocolEffect,
  run: RepositoryRun,
): string | undefined {
  return effect.kind === "worktree_create" && effect.unitId !== null
    ? run.units[effect.unitId]?.baseOid
    : undefined;
}

function candidateInput(
  effect: Extract<ProtocolEffect, { kind: "candidate_collect" }>,
  run: RepositoryRun,
):
  | Readonly<{
      allowedPaths: readonly string[];
      base: string;
      branch: string;
      worktreePath: string;
    }>
  | undefined {
  const unit = run.units[effect.unitId];
  if (
    unit === undefined ||
    unit.branchRef !== effect.params.branchRef ||
    unit.worktreePath !== effect.params.worktreePath ||
    unit.taskMetadata === undefined ||
    unit.taskMetadata.unitId !== unit.id
  )
    return undefined;
  return {
    allowedPaths: unit.taskMetadata.ownedPaths,
    base: unit.baseOid,
    branch: effect.params.branchRef,
    worktreePath: effect.params.worktreePath,
  };
}

async function candidateObserved(
  effect: Extract<ProtocolEffect, { kind: "candidate_collect" }>,
  run: RepositoryRun,
  git: ProductionRecoveryEffectAdapterOptions["git"],
): Promise<
  | Extract<ReconcileResult, { status: "observed" }>
  | Readonly<{ status: "ambiguous" }>
> {
  const input = candidateInput(effect, run);
  if (input === undefined) return ambiguous();
  const result = await observeCandidate(git.runner, git.repository, input);
  if (result.state !== "observed" || result.snapshot === undefined)
    return ambiguous();
  return {
    observation: {
      ...eventBase(effect, run),
      candidateDiffHash: deriveCandidateDiffHash(result.snapshot.diff),
      headOid: result.snapshot.head,
      treeOid: result.snapshot.tree,
      type: "candidate_observed",
    } as ProtocolEvent,
    status: "observed",
  };
}

async function verificationRequest(
  effect: Extract<ProtocolEffect, { kind: "verify" }>,
  run: RepositoryRun,
  git: ProductionRecoveryEffectAdapterOptions["git"],
): Promise<
  | Readonly<{ status: "ambiguous" }>
  | Readonly<{
      status: "tool_request";
      toolRequest: unknown;
      delivery: "mark_ambiguous";
    }>
> {
  if (effect.unitId === null) return ambiguous();
  const unit = run.units[effect.unitId];
  if (
    unit === undefined ||
    unit.branchRef === undefined ||
    unit.worktreePath !== effect.params.worktreePath ||
    unit.candidateHead !== effect.params.candidate.headOid ||
    unit.candidateTree !== effect.params.candidate.treeOid ||
    unit.baseOid !== effect.params.candidate.baseOid
  )
    return ambiguous();
  const entry = run.effectJournal.find(
    (candidate) =>
      candidate.effectId === effect.effectId &&
      candidate.unitId === effect.unitId &&
      candidate.kind === "verify",
  );
  if (entry?.status !== "intended") return ambiguous();
  const binding = await verifyCandidateWorktree(git.runner, git.repository, {
    branch: unit.branchRef,
    head: effect.params.candidate.headOid,
    path: effect.params.worktreePath,
    tree: effect.params.candidate.treeOid,
  });
  const requested =
    binding.state === "observed"
      ? verificationToolRequest(effect, run)
      : ambiguous();
  return requested.status === "tool_request"
    ? { ...requested, delivery: "mark_ambiguous" }
    : ambiguous();
}

function canPublish(
  effect: Extract<ProtocolEffect, { kind: "publish" }>,
): boolean {
  return (
    effect.params.completionBoundary !== "pr-handoff" &&
    effect.params.authorityProfile !== "local-change-only"
  );
}

function remote(
  options: ProductionRecoveryEffectAdapterOptions,
): string | undefined {
  return options.git.remote;
}

/**
 * A durable run, not caller-selected adapter configuration, authorizes Git
 * recovery.  The Git adapter repeats its own live identity verification for
 * each operation; this binds that verified repository to the loaded run.
 */
function gitMatchesRun(repository: GitRepository, run: RepositoryRun): boolean {
  return (
    repository.identity === run.repositoryIdentity &&
    repository.objectFormat === run.gitObjectFormat
  );
}

function transitionMatchesRun(
  effect: ProtocolEffect,
  run: RepositoryRun,
): boolean {
  const transition = controllerTransition(effect);
  if (
    transition === undefined ||
    transition === null ||
    typeof transition !== "object" ||
    !("scope" in transition) ||
    !("holder" in transition)
  )
    return false;
  const scope = transition.scope;
  if (
    scope.beadsStoreIdentity !== run.storeIdentity ||
    scope.gitRepositoryIdentity !== run.repositoryIdentity ||
    scope.integrationBranch !== run.integrationBranch ||
    transition.holder !== run.controller.holder
  )
    return false;
  return effect.kind === "controller_acquire" ||
    effect.kind === "controller_release"
    ? effect.params.controllerFencingToken === run.controllerFencingToken &&
        effect.params.holder === run.controller.holder
    : false;
}

function localIntegrationRef(branch: string): string {
  return `refs/heads/${branch}`;
}

/**
 * Builds the production recovery adapter.  Every discovery branch below is
 * read-only; `execute` contains the only calls to Git mutators.
 */
export function createProductionRecoveryEffectAdapter(
  options: ProductionRecoveryEffectAdapterOptions,
): RecoveryEffectAdapter {
  const git = options.git;
  const materialisation =
    options.materialisation ??
    createMaterialisationAdapter(
      git.repository.cwd,
      git.repository.objectFormat,
    );
  const provenance =
    options.provenance ??
    createProvenanceAdapter({
      git: {
        repository: git.repository,
        runner: git.runner,
        ...(git.remote === undefined ? {} : { remote: git.remote }),
      },
    });
  const harness =
    options.harness === undefined
      ? undefined
      : createHarnessRecoveryEffectAdapter(
          options.harness.support,
          options.harness.port,
        );

  function provenanceObservation(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
    result: ProvenanceCommitResult,
  ): Extract<ExecuteResult, { status: "observed" }> {
    return {
      observation: {
        ...eventBase(effect, run),
        observationHash: observationHash(result as unknown as JsonValue),
        result,
        type: "provenance_commit_observed",
      } as ProtocolEvent,
      status: "observed",
    };
  }

  function aggregateVerification(
    effect: AggregateVerifyEffect,
    run: RepositoryRun,
    passed: boolean,
    evidenceDigest: string,
  ): Extract<ExecuteResult, { status: "observed" }> {
    return {
      observation: {
        ...eventBase(effect, run),
        baseOid: effect.params.candidate.baseOid,
        headOid: effect.params.candidate.headOid,
        observationHash: observationHash({
          domain: "sce.provenance.aggregate-verify-observation.v1",
          effectId: effect.effectId,
          evidenceDigest,
          paramsHash: effect.paramsHash,
          passed,
        }),
        treeOid: effect.params.candidate.treeOid,
        type: passed ? "verification_observed" : "verification_failed",
      } as ProtocolEvent,
      status: "observed",
    };
  }

  async function provenanceDiscovery(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
  ): Promise<ReconcileResult> {
    if (!gitMatchesRun(git.repository, run)) return ambiguous();
    try {
      const outcome = await provenance.reconcileProvenanceCommit(effect, run);
      return outcome.status === "observed"
        ? provenanceObservation(effect, run, outcome.result)
        : outcome;
    } catch {
      return ambiguous();
    }
  }

  async function provenanceExecution(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
  ): Promise<ExecuteResult> {
    if (!gitMatchesRun(git.repository, run)) return ambiguous();
    try {
      const outcome = await provenance.executeProvenanceCommit(effect, run);
      return outcome.status === "observed"
        ? provenanceObservation(effect, run, outcome.result)
        : outcome;
    } catch {
      return ambiguous();
    }
  }

  async function aggregateVerifyExecution(
    effect: AggregateVerifyEffect,
    run: RepositoryRun,
  ): Promise<ExecuteResult> {
    if (!gitMatchesRun(git.repository, run)) return ambiguous();
    const entry = run.effectJournal.find(
      (candidate) =>
        candidate.effectId === effect.effectId &&
        candidate.unitId === null &&
        candidate.kind === "verify",
    );
    if (entry?.status !== "intended") return ambiguous();
    try {
      const outcome = await provenance.executeAggregateVerify(effect, run);
      return outcome.status === "observed"
        ? aggregateVerification(
            effect,
            run,
            outcome.passed,
            outcome.evidenceDigest,
          )
        : outcome;
    } catch {
      return ambiguous();
    }
  }

  async function discover(
    effect: ProtocolEffect,
    run: RepositoryRun,
  ): Promise<ReconcileResult> {
    if (effect.kind === "provenance_carry_claim") {
      if (options.carry === undefined) return unavailable();
      try {
        const result = await options.carry.reconcileProvenanceCarryClaim(
          effect,
          run,
        );
        return result.status === "observed"
          ? carryObservation(effect, run, result.result)
          : result;
      } catch {
        return ambiguous();
      }
    }
    if (
      effect.kind === "materialisation_resolve" ||
      effect.kind === "destination_probe" ||
      effect.kind === "materialise"
    ) {
      if (
        !gitMatchesRun(git.repository, run) ||
        effect.params.repositoryIdentity !== git.repository.identity ||
        (await verifyRepository(git.runner, git.repository)).state !==
          "observed"
      )
        return ambiguous();
      try {
        return effect.kind === "materialise"
          ? await discoveredMaterialisationResult(effect, run, materialisation)
          : await materialisationResult(effect, run, materialisation);
      } catch {
        return ambiguous();
      }
    }
    if (effect.kind === "provenance_commit")
      return await provenanceDiscovery(effect, run);
    if (effect.kind === "verify") {
      if (effect.unitId === null) {
        if (!gitMatchesRun(git.repository, run)) return ambiguous();
        try {
          const outcome = await provenance.reconcileAggregateVerify(
            effect,
            run,
          );
          return outcome.status === "observed"
            ? aggregateVerification(
                effect,
                run,
                outcome.passed,
                outcome.evidenceDigest,
              )
            : outcome;
        } catch {
          return ambiguous();
        }
      }
      if (!gitMatchesRun(git.repository, run)) return ambiguous();
      try {
        return await verificationRequest(effect, run, git);
      } catch {
        return ambiguous();
      }
    }
    if (harness?.canReconcile?.(effect))
      return await harness.reconcile(effect, run);
    if (effect.kind === "candidate_collect") {
      if (!gitMatchesRun(git.repository, run)) return ambiguous();
      try {
        return await candidateObserved(effect, run, git);
      } catch {
        return ambiguous();
      }
    }
    const done = observed(effect, run);
    if (done === undefined) return ambiguous();
    if (
      (effect.kind !== "controller_acquire" &&
        effect.kind !== "controller_release" &&
        !gitMatchesRun(git.repository, run)) ||
      ((effect.kind === "controller_acquire" ||
        effect.kind === "controller_release") &&
        !transitionMatchesRun(effect, run))
    )
      return ambiguous();
    try {
      switch (effect.kind) {
        case "controller_acquire":
        case "controller_release": {
          const transition = controllerTransition(effect);
          if (transition === undefined || options.topology === undefined)
            return ambiguous();
          const result =
            await options.topology.reconcileControllerTransition(transition);
          if (result.status === "observed") return done;
          if (result.status === "absent") return { status: "absent" };
          return result.status === "unavailable" ? unavailable() : ambiguous();
        }
        case "branch_create":
          return discovered(
            done,
            await discoverBranch(git.runner, git.repository, {
              base: effect.params.baseOid,
              branch: effect.params.branchRef,
            }),
          );
        case "worktree_create": {
          const base = worktreeBase(effect, run);
          if (base === undefined) return ambiguous();
          return discovered(
            done,
            await discoverWorktree(git.runner, git.repository, {
              branch: effect.params.branchRef,
              head: base,
              path: effect.params.worktreePath,
            }),
          );
        }
        case "publish": {
          const configuredRemote = remote(options);
          if (configuredRemote === undefined || !canPublish(effect))
            return ambiguous();
          return discovered(
            done,
            await discoverPublication(git.runner, git.repository, {
              candidate: effect.params.candidate.headOid,
              remote: configuredRemote,
              remoteBranch: effect.params.branchRef,
            }),
          );
        }
        case "integrate": {
          if (effect.params.integrationProfile === "local-ff")
            return discovered(
              done,
              await discoverIntegration(git.runner, git.repository, {
                base: effect.params.candidate.baseOid,
                candidate: effect.params.candidate.headOid,
                integrationRef: localIntegrationRef(
                  effect.params.integrationBranch,
                ),
              }),
            );
          const configuredRemote = remote(options);
          if (
            effect.params.integrationProfile !== "remote-ff" ||
            configuredRemote === undefined
          )
            return ambiguous();
          return discovered(
            done,
            await discoverRemoteIntegration(git.runner, git.repository, {
              base: effect.params.candidate.baseOid,
              candidate: effect.params.candidate.headOid,
              integrationBranch: effect.params.integrationBranch,
              remote: configuredRemote,
            }),
          );
        }
        default:
          return ambiguous();
      }
    } catch {
      return ambiguous();
    }
  }

  async function execute(
    effect: ProtocolEffect,
    run: RepositoryRun,
  ): Promise<ExecuteResult> {
    if (effect.kind === "provenance_carry_claim") {
      if (options.carry === undefined) return unavailable();
      try {
        const result = await options.carry.executeProvenanceCarryClaim(
          effect,
          run,
        );
        return result.status === "observed"
          ? carryObservation(effect, run, result.result)
          : result;
      } catch {
        return ambiguous();
      }
    }
    if (
      effect.kind === "materialisation_resolve" ||
      effect.kind === "destination_probe" ||
      effect.kind === "materialise"
    ) {
      if (
        !gitMatchesRun(git.repository, run) ||
        effect.params.repositoryIdentity !== git.repository.identity ||
        (await verifyRepository(git.runner, git.repository)).state !==
          "observed"
      )
        return ambiguous();
      try {
        return await materialisationResult(effect, run, materialisation);
      } catch {
        return ambiguous();
      }
    }
    if (effect.kind === "provenance_commit")
      return await provenanceExecution(effect, run);
    if (effect.kind === "verify") {
      if (effect.unitId === null)
        return await aggregateVerifyExecution(effect, run);
      if (!gitMatchesRun(git.repository, run)) return ambiguous();
      try {
        return await verificationRequest(effect, run, git);
      } catch {
        return ambiguous();
      }
    }
    if (harness?.canExecute?.(effect))
      return await harness.execute(effect, run);
    if (effect.kind === "candidate_collect") {
      if (!gitMatchesRun(git.repository, run)) return ambiguous();
      try {
        return await candidateObserved(effect, run, git);
      } catch {
        return ambiguous();
      }
    }
    const done = observed(effect, run);
    if (done === undefined) return ambiguous();
    if (
      (effect.kind !== "controller_acquire" &&
        effect.kind !== "controller_release" &&
        !gitMatchesRun(git.repository, run)) ||
      ((effect.kind === "controller_acquire" ||
        effect.kind === "controller_release") &&
        !transitionMatchesRun(effect, run))
    )
      return ambiguous();
    try {
      switch (effect.kind) {
        case "controller_acquire":
        case "controller_release": {
          const transition = controllerTransition(effect);
          const executor = options.topology?.executeControllerTransition;
          if (transition === undefined || executor === undefined)
            return ambiguous();
          const result = await executor(transition);
          return result.status === "observed"
            ? done
            : result.status === "unavailable"
              ? unavailable()
              : ambiguous();
        }
        case "branch_create":
          return executed(
            done,
            await ensureBranch(git.runner, git.repository, {
              base: effect.params.baseOid,
              branch: effect.params.branchRef,
            }),
          );
        case "worktree_create": {
          const base = worktreeBase(effect, run);
          if (base === undefined) return ambiguous();
          return executed(
            done,
            await ensureWorktree(git.runner, git.repository, {
              branch: effect.params.branchRef,
              head: base,
              path: effect.params.worktreePath,
            }),
          );
        }
        case "publish": {
          const configuredRemote = remote(options);
          if (configuredRemote === undefined || !canPublish(effect))
            return ambiguous();
          return executed(
            done,
            await publishCandidate(git.runner, git.repository, {
              candidate: effect.params.candidate.headOid,
              remote: configuredRemote,
              remoteBranch: effect.params.branchRef,
            }),
          );
        }
        case "integrate": {
          if (effect.params.integrationProfile === "local-ff")
            return executed(
              done,
              await integrateLocalFastForward(git.runner, git.repository, {
                base: effect.params.candidate.baseOid,
                candidate: effect.params.candidate.headOid,
                integrationRef: localIntegrationRef(
                  effect.params.integrationBranch,
                ),
              }),
            );
          const configuredRemote = remote(options);
          if (
            effect.params.integrationProfile !== "remote-ff" ||
            configuredRemote === undefined
          )
            return ambiguous();
          return executed(
            done,
            await integrateRemoteFastForward(git.runner, git.repository, {
              base: effect.params.candidate.baseOid,
              candidate: effect.params.candidate.headOid,
              integrationBranch: effect.params.integrationBranch,
              remote: configuredRemote,
            }),
          );
        }
        default:
          return ambiguous();
      }
    } catch {
      return ambiguous();
    }
  }

  return {
    canExecute: (effect) =>
      effect.kind === "verify" ||
      effect.kind === "materialisation_resolve" ||
      effect.kind === "destination_probe" ||
      effect.kind === "materialise" ||
      effect.kind === "provenance_commit" ||
      (effect.kind === "provenance_carry_claim" &&
        options.carry !== undefined) ||
      (harness?.canExecute?.(effect) ?? false),
    canReconcile: (effect) =>
      effect.kind === "verify" ||
      effect.kind === "materialisation_resolve" ||
      effect.kind === "destination_probe" ||
      effect.kind === "materialise" ||
      effect.kind === "provenance_commit" ||
      (effect.kind === "provenance_carry_claim" &&
        options.carry !== undefined) ||
      (harness?.canReconcile?.(effect) ?? false),
    acknowledge: async (acknowledgement, run) => {
      const verified = acknowledgeVerificationTool(acknowledgement, run);
      if (verified !== undefined) {
        if (verified.status !== "observed") return verified;
        const observation = verified.observation;
        if (!("effectId" in observation)) return ambiguous();
        const entry = run.effectJournal.find(
          (candidate) => candidate.effectId === observation.effectId,
        );
        const effect =
          entry === undefined ? undefined : rehydrateEffect(run, entry);
        if (effect?.kind !== "verify" || !gitMatchesRun(git.repository, run))
          return ambiguous();
        try {
          if (effect.unitId === null) return ambiguous();
          const binding = await verifyCandidateWorktree(
            git.runner,
            git.repository,
            {
              branch: run.units[effect.unitId]?.branchRef ?? "",
              head: effect.params.candidate.headOid,
              path: effect.params.worktreePath,
              tree: effect.params.candidate.treeOid,
            },
          );
          return binding.state === "observed" ? verified : ambiguous();
        } catch {
          return ambiguous();
        }
      }
      return harness?.acknowledge === undefined
        ? ambiguous()
        : await harness.acknowledge(acknowledgement, run);
    },
    execute,
    reconcile: discover,
  };
}

/**
 * Compose the crash coordinator with the production Git/controller-effect
 * adapter. No store, topology, remote, holder, or initial aggregate is
 * discovered or defaulted at this boundary.
 */
export function createProductionRecoveryRunner(
  options: ProductionRecoveryRunnerOptions,
) {
  const { git, topology, harness, knowledgeContract, carry, ...recovery } =
    options;
  const authoritativeIntegrationOid = async (
    run: RepositoryRun,
  ): Promise<string | undefined> => {
    const verified = await verifyRepository(git.runner, git.repository);
    if (verified.state !== "observed") return undefined;
    const argv =
      run.integrationProfile === "local-ff"
        ? [
            "for-each-ref",
            "--format=%(objectname)",
            `refs/heads/${run.integrationBranch}`,
          ]
        : git.remote === undefined
          ? undefined
          : [
              "ls-remote",
              "--refs",
              "--exit-code",
              git.remote,
              `refs/heads/${run.integrationBranch}`,
            ];
    if (argv === undefined) return undefined;
    let result;
    try {
      result = await git.runner({ argv, cwd: git.repository.cwd });
    } catch {
      return undefined;
    }
    if (result.exitCode !== 0 || result.signal !== null) return undefined;
    const match =
      run.integrationProfile === "local-ff"
        ? /^([0-9a-f]+)\n$/u.exec(result.stdout)
        : new RegExp(
            `^([0-9a-f]+)\\t${`refs/heads/${run.integrationBranch}`.replace(
              /[.*+?^${}()|[\]\\]/gu,
              "\\$&",
            )}\\n$`,
            "u",
          ).exec(result.stdout);
    const oid = match?.[1];
    return oid?.length === (run.gitObjectFormat === "sha1" ? 40 : 64)
      ? oid
      : undefined;
  };
  const carryWithGit: ProvenanceCarryClaimRecoveryPort | undefined =
    carry === undefined
      ? undefined
      : {
          prepareProvenanceCarryClaim: async (predecessorRootIssueId, run) =>
            await carry.prepareProvenanceCarryClaim(
              predecessorRootIssueId,
              run,
            ),
          executeProvenanceCarryClaim: async (effect, run) => {
            const result = await carry.executeProvenanceCarryClaim(effect, run);
            if (
              result.status !== "observed" ||
              result.result.status !== "imported"
            )
              return result;
            const integrationOid = await authoritativeIntegrationOid(run);
            return integrationOid === undefined
              ? { status: "unavailable" as const }
              : {
                  result: {
                    ...result.result,
                    carry: { ...result.result.carry, integrationOid },
                  },
                  status: "observed" as const,
                };
          },
          reconcileProvenanceCarryClaim: async (effect, run) => {
            const result = await carry.reconcileProvenanceCarryClaim(
              effect,
              run,
            );
            if (
              result.status !== "observed" ||
              result.result.status !== "imported"
            )
              return result;
            const integrationOid = await authoritativeIntegrationOid(run);
            return integrationOid === undefined
              ? { status: "unavailable" as const }
              : {
                  result: {
                    ...result.result,
                    carry: { ...result.result.carry, integrationOid },
                  },
                  status: "observed" as const,
                };
          },
        };
  const contractMatches = (value: KnowledgeContract | undefined) =>
    (knowledgeContract === undefined) === (value === undefined) &&
    (knowledgeContract === undefined ||
      value === undefined ||
      canonicalJson(knowledgeContract as unknown as JsonValue) ===
        canonicalJson(value as unknown as JsonValue));
  const contractMayBeFrozenByFirstWave = (run: RepositoryRun) => {
    return (
      knowledgeContract !== undefined &&
      canFreezeKnowledgeContractAtFirstWave(run)
    );
  };
  return createRecoveryRunner({
    ...recovery,
    adapter: createProductionRecoveryEffectAdapter({
      git,
      ...(carryWithGit === undefined ? {} : { carry: carryWithGit }),
      ...(harness === undefined ? {} : { harness }),
      ...(topology === undefined ? {} : { topology }),
    }),
    ...(topology?.prepareControllerTransition === undefined
      ? {}
      : {
          prepareControllerTransition: async (input) =>
            await topology.prepareControllerTransition!({
              holder: input.holder,
              kind: input.kind,
              scope: input.scope,
            }),
        }),
    ...(carry === undefined
      ? {}
      : {
          prepareProvenanceCarryClaim: async ({
            predecessorRootBeadId,
            run,
          }) => {
            const planned = await carry.prepareProvenanceCarryClaim(
              predecessorRootBeadId,
              run,
            );
            if (planned.status !== "planned") return planned;
            const idempotencyKey = deriveProvenanceCarryClaimKey(
              run.controller.runId,
              planned.plan.exportId,
              predecessorRootBeadId,
            );
            const keyDigest = idempotencyKey.slice("carry-claim:".length);
            return {
              event: {
                claimToken: idempotencyKey,
                eventId: `carry-claim-${keyDigest}`,
                expectedRevision: run.revision,
                exportId: planned.plan.exportId,
                idempotencyKey,
                predecessorFinalRevision: planned.plan.predecessorFinalRevision,
                predecessorJournalCheckpointCommitment:
                  planned.plan.predecessorJournalCheckpointCommitment,
                predecessorRootAggregateCommitment:
                  planned.plan.predecessorRootAggregateCommitment,
                predecessorRootBeadId,
                predecessorRunId: planned.plan.predecessorRunId,
                predecessorWaveId: planned.plan.predecessorWaveId,
                snapshotCommitment: planned.plan.snapshotCommitment,
                type: "provenance_carry_claim_intent",
              } as ProtocolEvent,
              status: "planned" as const,
            };
          },
        }),
    validateLoadedRun: ({ proof, run }) =>
      run.repositoryIdentity === git.repository.identity &&
      run.gitObjectFormat === git.repository.objectFormat &&
      run.storeIdentity === proof.scope.beadsStoreIdentity &&
      run.repositoryIdentity === proof.scope.gitRepositoryIdentity &&
      run.integrationBranch === proof.scope.integrationBranch &&
      run.controller.holder === proof.holder &&
      (contractMatches(run.knowledgeContract) ||
        contractMayBeFrozenByFirstWave(run))
        ? { status: "ok" }
        : { status: "unavailable" },
    validateEvent: (event) =>
      event.type !== "wave_planned" || contractMatches(event.knowledgeContract),
    proveTopology: async () => {
      let proof;
      try {
        proof = await recovery.proveTopology();
      } catch {
        return undefined;
      }
      if (
        proof === undefined ||
        proof.commonDir !== git.repository.commonDir ||
        proof.scope.gitRepositoryIdentity !== git.repository.identity
      )
        return undefined;
      if (
        recovery.initialRun !== undefined &&
        (recovery.initialRun.controller.holder !== proof.holder ||
          recovery.initialRun.repositoryIdentity !==
            proof.scope.gitRepositoryIdentity ||
          recovery.initialRun.gitObjectFormat !== git.repository.objectFormat ||
          recovery.initialRun.storeIdentity !==
            proof.scope.beadsStoreIdentity ||
          recovery.initialRun.integrationBranch !==
            proof.scope.integrationBranch ||
          !contractMatches(recovery.initialRun.knowledgeContract))
      )
        return undefined;
      const verified = await verifyRepository(git.runner, git.repository);
      return verified.state === "observed" ? proof : undefined;
    },
  });
}

function discovered(
  observedResult: Extract<ReconcileResult, { status: "observed" }>,
  result: GitEffect,
): ReconcileResult {
  const classification = classifyDiscovery(result);
  return classification === "observed"
    ? observedResult
    : classification === "absent"
      ? { status: "absent" }
      : ambiguous();
}

function executed(
  observedResult: Extract<ExecuteResult, { status: "observed" }>,
  result: GitEffect,
): ExecuteResult {
  return result.state === "observed" ? observedResult : ambiguous();
}
