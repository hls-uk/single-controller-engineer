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
  verifyRepository,
  type GitEffect,
  type GitRepository,
  type GitRunner,
} from "../adapters/git/index.js";
import type { ProtocolEffect } from "../protocol/reducer.js";
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

  async function discover(
    effect: ProtocolEffect,
    run: RepositoryRun,
  ): Promise<ReconcileResult> {
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
        // The durable candidate intent has no exact candidate OID/tree/scope
        // binding.  Never infer those values from a worktree during recovery.
        case "candidate_collect":
          return ambiguous();
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
        case "candidate_collect":
        default:
          return ambiguous();
      }
    } catch {
      return ambiguous();
    }
  }

  return { execute, reconcile: discover };
}

/**
 * Compose the crash coordinator with the production Git/controller-effect
 * adapter. No store, topology, remote, holder, or initial aggregate is
 * discovered or defaulted at this boundary.
 */
export function createProductionRecoveryRunner(
  options: ProductionRecoveryRunnerOptions,
) {
  const { git, topology, ...recovery } = options;
  return createRecoveryRunner({
    ...recovery,
    adapter: createProductionRecoveryEffectAdapter({
      git,
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
