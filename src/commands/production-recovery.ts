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
  acknowledgeVerificationTool,
  createHarnessRecoveryEffectAdapter,
  type HarnessPort,
  verificationToolRequest,
} from "../harness/index.js";
import {
  deriveCandidateDiffHash,
  rehydrateEffect,
  type ProtocolEffect,
} from "../protocol/reducer.js";
import type { FencingScope } from "../fencing/index.js";
import type {
  ProtocolEvent,
  RepositoryRun,
  SlotTransitionIntent,
} from "../protocol/schemas.js";
import {
  createRecoveryRunner,
  observationHash,
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
    eventId: `recover-${effect.effectId}`,
    expectedRevision: run.revision,
    observationHash: observationHash({
      effectId: effect.effectId,
      kind: effect.kind,
      paramsHash: effect.paramsHash,
    }),
    unitId: effect.unitId,
  };
}

function observed(
  effect: ProtocolEffect,
  run: RepositoryRun,
): Extract<ReconcileResult, { status: "observed" }> | undefined {
  const base = eventBase(effect, run);
  switch (effect.kind) {
    case "controller_acquire":
      return {
        observation: {
          ...base,
          controllerFencingToken: effect.params.controllerFencingToken,
          holder: effect.params.holder,
          type: "controller_acquired",
        } as ProtocolEvent,
        status: "observed",
      };
    case "controller_release":
      return {
        observation: { ...base, type: "controller_released" } as ProtocolEvent,
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
  | Readonly<{ status: "tool_request"; toolRequest: unknown }>
> {
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
  return requested.status === "tool_request" ? requested : ambiguous();
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
  const harness =
    options.harness === undefined
      ? undefined
      : createHarnessRecoveryEffectAdapter(
          options.harness.support,
          options.harness.port,
        );

  async function discover(
    effect: ProtocolEffect,
    run: RepositoryRun,
  ): Promise<ReconcileResult> {
    if (effect.kind === "verify") {
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
    if (effect.kind === "verify") {
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
      effect.kind === "verify" || (harness?.canExecute?.(effect) ?? false),
    canReconcile: (effect) =>
      effect.kind === "verify" || (harness?.canReconcile?.(effect) ?? false),
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
  const { git, topology, harness, ...recovery } = options;
  return createRecoveryRunner({
    ...recovery,
    adapter: createProductionRecoveryEffectAdapter({
      git,
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
    validateLoadedRun: ({ proof, run }) =>
      run.repositoryIdentity === git.repository.identity &&
      run.gitObjectFormat === git.repository.objectFormat &&
      run.storeIdentity === proof.scope.beadsStoreIdentity &&
      run.repositoryIdentity === proof.scope.gitRepositoryIdentity &&
      run.integrationBranch === proof.scope.integrationBranch &&
      run.controller.holder === proof.holder
        ? { status: "ok" }
        : { status: "unavailable" },
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
            proof.scope.integrationBranch)
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
