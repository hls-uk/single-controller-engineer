/**
 * Production composition for the recoverable Git effects.  The recovery
 * coordinator owns persistence and retry authority; this adapter only turns
 * exact, durable effect parameters into one Git operation or a read-only
 * discovery fact.
 */
import {
  type GitEffect,
  type GitRepository,
  type GitResult,
  type GitRunner,
  type RefreshObservation,
  discoverBranch,
  discoverIntegration,
  discoverPublication,
  discoverRefresh,
  discoverRemoteIntegration,
  discoverWorktree,
  ensureBranch,
  ensureWorktree,
  integrateLocalFastForward,
  integrateRemoteFastForward,
  integrationRefHead,
  observeCandidate,
  publishCandidate,
  refreshCandidate,
  verifyCandidateWorktree,
  verifyRepository,
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
  knowledgeContractAwaitsFirstWave,
  deriveProvenanceCarryClaimKey,
  deriveProvenanceCarryExportId,
  projectionInputIsValid,
  refreshIsFastForward,
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
  CANDIDATE_DIFF_MAX_BYTES,
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
  // The predecessor's snapshot crosses into the claim exactly as it was
  // frozen, in whichever encoding that was. A version-3 snapshot retired the
  // resolution's live budget at freeze time rather than parking it beside the
  // snapshot, so nothing has to travel with it and nothing is re-attached
  // here: it hydrates on its own bytes and commits to its own hydrated view.
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
    case "reservation_acquire":
      return {
        observation: { ...base, type: "reservation_observed" } as ProtocolEvent,
        status: "observed",
      };
    case "reservation_release":
      return {
        observation: { ...base, type: "reservation_released" } as ProtocolEvent,
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

/**
 * A refresh observation binds the new base and the rebased head. A refusal
 * carrying the unchanged head is a conflict on the act, routed to repair, or
 * plain absence on the read-only probe.
 */
function refreshResult(
  effect: Extract<ProtocolEffect, { kind: "candidate_refresh" }>,
  run: RepositoryRun,
  result: RefreshObservation,
  refusal: "absent" | "failed",
):
  | Extract<ReconcileResult, { status: "observed" }>
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "ambiguous" }> {
  if (
    result.state === "observed" &&
    result.head !== undefined &&
    result.tree !== undefined
  )
    return {
      observation: {
        ...eventBase(effect, run),
        baseOid: effect.params.baseOid,
        headOid: result.head,
        treeOid: result.tree,
        type: "refresh_observed",
      } as ProtocolEvent,
      status: "observed",
    };
  if (
    result.state === "refused" &&
    result.head !== undefined &&
    result.tree !== undefined
  ) {
    if (refusal === "absent") return { status: "absent" };
    return {
      observation: {
        ...eventBase(effect, run),
        baseOid: effect.params.previousBaseOid,
        headOid: result.head,
        treeOid: result.tree,
        type: "refresh_failed",
      } as ProtocolEvent,
      status: "observed",
    };
  }
  return ambiguous();
}

const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function exactOid(format: GitRepository["objectFormat"], value: string) {
  return (
    OID_PATTERN.test(value) && value.length === (format === "sha1" ? 40 : 64)
  );
}

function oneOid(result: GitResult, format: GitRepository["objectFormat"]) {
  if (
    result.exitCode !== 0 ||
    result.signal !== null ||
    result.timedOut === true ||
    result.unavailable === true ||
    result.invalidUtf8 === true
  )
    return undefined;
  const value = result.stdout.trimEnd();
  return exactOid(format, value) ? value : undefined;
}

/** The exact commit and tree the unit worktree rests on, or nothing. */
async function worktreePair(
  git: ProductionRecoveryEffectAdapterOptions["git"],
  worktreePath: string,
): Promise<Readonly<{ head: string; tree: string }> | undefined> {
  const [head, tree] = await Promise.all([
    git.runner({
      argv: ["rev-parse", "--verify", "HEAD^{commit}"],
      cwd: worktreePath,
    }),
    git.runner({
      argv: ["rev-parse", "--verify", "HEAD^{tree}"],
      cwd: worktreePath,
    }),
  ]);
  const format = git.repository.objectFormat;
  const headOid = oneOid(head, format);
  const treeOid = oneOid(tree, format);
  return headOid === undefined || treeOid === undefined
    ? undefined
    : { head: headOid, tree: treeOid };
}

/**
 * Refreshing a unit that was never launched. Its branch carries no commits,
 * so the act is a pure fast-forward of `refs/heads/<branch>` and its worktree
 * onto the moved integration head; a branch that already carries commits, or
 * a dirty or foreign worktree, is refused with the exact pair it still rests
 * on and is never rebased. A worktree already on the new base is observed as
 * is, so the act and the read-only probe agree (sce-296.18).
 */
async function preparedRefresh(
  git: ProductionRecoveryEffectAdapterOptions["git"],
  input: Readonly<{
    base: string;
    branch: string;
    previousBase: string;
    worktreePath: string;
  }>,
  act: boolean,
): Promise<RefreshObservation> {
  const settled = async (
    pair: Readonly<{ head: string; tree: string }>,
  ): Promise<boolean> =>
    (
      await verifyCandidateWorktree(git.runner, git.repository, {
        branch: input.branch,
        head: pair.head,
        path: input.worktreePath,
        tree: pair.tree,
      })
    ).state === "observed";
  const before = await worktreePair(git, input.worktreePath);
  if (before === undefined)
    return { code: "GIT_UNRESOLVED_EFFECT", state: "ambiguous" };
  if (!(await settled(before)))
    return { ...before, code: "GIT_REFUSED", state: "refused" };
  if (before.head === input.base)
    return { ...before, code: "GIT_OK", state: "observed" };
  if (before.head !== input.previousBase)
    return { ...before, code: "GIT_FOREIGN_BRANCH", state: "refused" };
  if (!act) return { ...before, code: "GIT_ABSENT", state: "refused" };
  const merged = await git.runner({
    argv: ["merge", "--ff-only", input.base],
    cwd: input.worktreePath,
  });
  const after = await worktreePair(git, input.worktreePath);
  if (after === undefined || !(await settled(after)))
    return { code: "GIT_UNRESOLVED_EFFECT", state: "ambiguous" };
  if (after.head === input.base)
    return { ...after, code: "GIT_OK", state: "observed" };
  return merged.exitCode !== 0 &&
    merged.signal === null &&
    merged.timedOut !== true &&
    after.head === input.previousBase
    ? { ...after, code: "GIT_NOT_FAST_FORWARD", state: "refused" }
    : { code: "GIT_UNRESOLVED_EFFECT", state: "ambiguous" };
}

/** The pre-dispatch refresh input, or nothing when the unit was launched. */
function preparedRefreshInput(
  effect: Extract<ProtocolEffect, { kind: "candidate_refresh" }>,
  run: RepositoryRun,
):
  | Readonly<{
      base: string;
      branch: string;
      previousBase: string;
      worktreePath: string;
    }>
  | undefined {
  const unit = run.units[effect.unitId];
  if (
    unit === undefined ||
    !refreshIsFastForward(unit) ||
    unit.branchRef !== effect.params.branchRef ||
    unit.worktreePath !== effect.params.worktreePath
  )
    return undefined;
  return {
    base: effect.params.baseOid,
    branch: effect.params.branchRef,
    previousBase: effect.params.previousBaseOid,
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
  // A measured oversize diff is the one refusal the collect act can name
  // exactly. The measurement has to land inside the event's own bounds to be
  // an observation at all; anything else stays ambiguous, as before.
  if (
    result.state === "refused" &&
    result.code === "GIT_DIFF_OVERSIZE" &&
    result.oversize !== undefined &&
    result.oversize.byteCount > CANDIDATE_DIFF_MAX_BYTES &&
    result.oversize.byteCount <= CANDIDATE_DIFF_MAX_BYTES * 2
  )
    return {
      observation: {
        ...eventBase(effect, run),
        headOid: result.oversize.head,
        maximumByteCount: CANDIDATE_DIFF_MAX_BYTES,
        measuredByteCount: result.oversize.byteCount,
        reason: "diff_oversize",
        treeOid: result.oversize.tree,
        type: "candidate_refused",
      } as ProtocolEvent,
      status: "observed",
    };
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
/**
 * A reservation is durable run state, not an external act: the reducer
 * records it in the aggregate and the checkpoint commits it. Executing one
 * is exactly its observation, and an intended one on resume is simply absent.
 */
function isReservationEffect(effect: ProtocolEffect): boolean {
  return (
    effect.kind === "reservation_acquire" ||
    effect.kind === "reservation_release"
  );
}

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
    if (isReservationEffect(effect)) return { status: "absent" };
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
    if (effect.kind === "candidate_refresh") {
      if (!gitMatchesRun(git.repository, run)) return ambiguous();
      const prepared = preparedRefreshInput(effect, run);
      try {
        return refreshResult(
          effect,
          run,
          prepared === undefined
            ? await discoverRefresh(git.runner, git.repository, {
                base: effect.params.baseOid,
                branch: effect.params.branchRef,
                previousBase: effect.params.previousBaseOid,
                worktreePath: effect.params.worktreePath,
              })
            : await preparedRefresh(git, prepared, false),
          "absent",
        );
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
          if (effect.params.integrationProfile === "local-ff") {
            const probe = await discoverIntegration(
              git.runner,
              git.repository,
              {
                base: effect.params.candidate.baseOid,
                candidate: effect.params.candidate.headOid,
                integrationRef: localIntegrationRef(
                  effect.params.integrationBranch,
                ),
              },
            );
            return (
              (await integrationRefused(effect, run, probe, git)) ??
              integrationCheckoutRefused(effect, run, probe) ??
              discovered(done, probe)
            );
          }
          const configuredRemote = remote(options);
          if (
            effect.params.integrationProfile !== "remote-ff" ||
            configuredRemote === undefined
          )
            return ambiguous();
          const remoteProbe = await discoverRemoteIntegration(
            git.runner,
            git.repository,
            {
              base: effect.params.candidate.baseOid,
              candidate: effect.params.candidate.headOid,
              integrationBranch: effect.params.integrationBranch,
              remote: configuredRemote,
            },
          );
          return (
            integrationCheckoutRefused(effect, run, remoteProbe) ??
            discovered(done, remoteProbe)
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
    if (isReservationEffect(effect))
      return observed(effect, run) ?? ambiguous();
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
    if (effect.kind === "candidate_refresh") {
      if (!gitMatchesRun(git.repository, run)) return ambiguous();
      const prepared = preparedRefreshInput(effect, run);
      try {
        const refreshed = refreshResult(
          effect,
          run,
          prepared === undefined
            ? await refreshCandidate(git.runner, git.repository, {
                base: effect.params.baseOid,
                branch: effect.params.branchRef,
                previousBase: effect.params.previousBaseOid,
                worktreePath: effect.params.worktreePath,
              })
            : await preparedRefresh(git, prepared, true),
          "failed",
        );
        return refreshed.status === "absent" ? ambiguous() : refreshed;
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
          const topology = options.topology;
          // Call the method on its topology: a class-based adapter relies on
          // `this`, and an unbound call throws before any slot command runs.
          if (
            transition === undefined ||
            topology?.executeControllerTransition === undefined
          )
            return ambiguous();
          const result = await topology.executeControllerTransition(transition);
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
          if (effect.params.integrationProfile === "local-ff") {
            const landed = await integrateLocalFastForward(
              git.runner,
              git.repository,
              {
                base: effect.params.candidate.baseOid,
                candidate: effect.params.candidate.headOid,
                integrationRef: localIntegrationRef(
                  effect.params.integrationBranch,
                ),
              },
            );
            return (
              (await integrationRefused(effect, run, landed, git)) ??
              integrationCheckoutRefused(effect, run, landed) ??
              executed(done, landed)
            );
          }
          const configuredRemote = remote(options);
          if (
            effect.params.integrationProfile !== "remote-ff" ||
            configuredRemote === undefined
          )
            return ambiguous();
          const pushed = await integrateRemoteFastForward(
            git.runner,
            git.repository,
            {
              base: effect.params.candidate.baseOid,
              candidate: effect.params.candidate.headOid,
              integrationBranch: effect.params.integrationBranch,
              remote: configuredRemote,
            },
          );
          return (
            integrationCheckoutRefused(effect, run, pushed) ??
            executed(done, pushed)
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
      isReservationEffect(effect) ||
      effect.kind === "verify" ||
      effect.kind === "materialisation_resolve" ||
      effect.kind === "destination_probe" ||
      effect.kind === "materialise" ||
      effect.kind === "provenance_commit" ||
      (effect.kind === "provenance_carry_claim" &&
        options.carry !== undefined) ||
      (harness?.canExecute?.(effect) ?? false),
    canReconcile: (effect) =>
      isReservationEffect(effect) ||
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
      (canFreezeKnowledgeContractAtFirstWave(run) ||
        knowledgeContractAwaitsFirstWave(run))
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
          !(
            contractMatches(recovery.initialRun.knowledgeContract) ||
            contractMayBeFrozenByFirstWave(recovery.initialRun)
          ))
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

/**
 * A fast-forward refused because the integration ref moved past the base,
 * with the candidate provably not beneath it, is an exact fact: nothing
 * landed. It is observed as `integrate_refused` bound to the current ref
 * head, so the unit returns to approved for a refresh.
 */
async function integrationRefused(
  effect: Extract<ProtocolEffect, { kind: "integrate" }>,
  run: RepositoryRun,
  result: GitEffect,
  git: ProductionRecoveryEffectAdapterOptions["git"],
): Promise<Extract<ReconcileResult, { status: "observed" }> | undefined> {
  if (result.state !== "refused" || result.code !== "GIT_MOVED_BASE")
    return undefined;
  const integrationOid = await integrationRefHead(
    git.runner,
    git.repository,
    localIntegrationRef(effect.params.integrationBranch),
  );
  if (
    integrationOid === undefined ||
    integrationOid === effect.params.candidate.baseOid ||
    integrationOid === effect.params.candidate.headOid
  )
    return undefined;
  return {
    observation: {
      ...eventBase(effect, run),
      baseOid: effect.params.candidate.baseOid,
      integrationOid,
      reason: "integration_ref_moved",
      type: "integrate_refused",
    } as ProtocolEvent,
    status: "observed",
  };
}

/**
 * `GIT_DIRTY` from an integration attempt is a precondition the integration
 * checkout failed, not an unresolved act: every dirty site reads the tree
 * before it writes anything, and the local profile has already proved the
 * integration ref sits exactly on the unit base by then. Left to
 * `executed`/`discovered` it collapses to ambiguous, blocks the unit, and
 * the following `next` reports the run corrupt. Named here it settles the
 * effect as `integrate_refused` and returns the unit to approved, so the
 * controller cleans the checkout and re-issues the same integrate intent
 * (or refreshes, if the ref moved meanwhile). It is profile-independent by
 * construction — it reads nothing — so `local-ff` and `remote-ff` route a
 * dirty checkout identically.
 */
function integrationCheckoutRefused(
  effect: Extract<ProtocolEffect, { kind: "integrate" }>,
  run: RepositoryRun,
  result: GitEffect,
): Extract<ReconcileResult, { status: "observed" }> | undefined {
  if (result.state !== "refused" || result.code !== "GIT_DIRTY")
    return undefined;
  return {
    observation: {
      ...eventBase(effect, run),
      baseOid: effect.params.candidate.baseOid,
      reason: "integration_checkout_dirty",
      type: "integrate_refused",
    } as ProtocolEvent,
    status: "observed",
  };
}

function executed(
  observedResult: Extract<ExecuteResult, { status: "observed" }>,
  result: GitEffect,
): ExecuteResult {
  return result.state === "observed" ? observedResult : ambiguous();
}
