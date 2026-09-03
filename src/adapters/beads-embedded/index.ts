import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import {
  type FencingScope,
  type ChildProjection,
  type RootProjection,
  FencingScopeSchema,
  type MergeSlotObservation,
  type MutationBatch,
  type RunStorePort,
  type RunStoreResult,
  type SlotContinuationEvidence,
  type SlotReleaseEvidence,
  deriveSlotReadbackHash,
  decideControllerSlot,
  validateMergeSlotObservation,
  validateChildProjection,
  validateMutationBatch,
  validateRootProjection,
} from "../../fencing/index.js";
import {
  PreflightEnvelopeSchema,
  isSchema,
  type PreflightEnvelope,
} from "../../preflight/index.js";
import {
  InitialControllerAcquireSchema,
  type AuthoritativeLoadResult,
  type ControllerTransitionPlanResult,
  type InitialControllerAcquire,
} from "../../commands/recovery.js";
import {
  validate,
  ProvenanceCarryClaimRecordSchema,
  type ProvenanceCarryClaimRecord,
  type RepositoryRun,
  type RuntimeEffect,
  type SlotTransitionIntent as ProtocolSlotTransitionIntent,
} from "../../protocol/schemas.js";
import { sha256 } from "../../protocol/evidence.js";
import { deriveProvenanceCarryClaimKey } from "../../protocol/reducer.js";
import {
  planProvenanceCarryFromProjection,
  type ProvenanceCarryProjectionPlan,
} from "../../commands/production-recovery.js";

import {
  EMBEDDED_ADAPTER_VERSION,
  type CarryCheckpointIntent,
  type CrashDiscovery,
  type CrashPoint,
  type EmbeddedMode,
  type EmbeddedProcessIdentity,
  type EmbeddedProcessPort,
  type EmbeddedReadback,
  type EmbeddedResponse,
  type EmbeddedResult,
  type EmbeddedState,
  type RemoteSlotTransitionProof,
  type SlotTransitionIntent,
} from "./schemas.js";
import {
  makeSlotTransitionIntent,
  validateSlotTransitionIntent,
} from "./slot-transition.js";

export * from "./schemas.js";
export {
  deriveSlotTransitionId,
  makeSlotTransitionIntent,
  validateSlotTransitionIntent,
} from "./slot-transition.js";
export {
  PinnedBdEmbeddedProcess,
  isPinnedCloneMergeDelta,
  isPinnedSlotTransitionDelta,
  parsePinnedBdState,
  SLOT_INITIALIZATION_AUTHORITY,
} from "./pinned-bd-process.js";
export type {
  PinnedBdProcessOptions,
  ProjectionPersistencePort,
  SlotInitializationAuthority,
} from "./pinned-bd-process.js";
export {
  DoltProjectionPersistence,
  PROJECTION_INITIALIZATION_AUTHORITY,
} from "./dolt-projections.js";
export type {
  DoltProjectionOptions,
  ProjectionInitializationAuthority,
} from "./dolt-projections.js";

export type WorkerTrackerBaseline = Readonly<{
  head?: string;
  remoteHead?: string;
  slot: MergeSlotObservation;
  workingSet: "clean";
}>;
type CarryEffect = Extract<RuntimeEffect, { kind: "provenance_carry_claim" }>;
type CarryObservationResult = Extract<
  import("../../protocol/schemas.js").ProtocolEvent,
  { type: "provenance_carry_claim_observed" }
>["result"];
type CarryRefusalReason = Extract<
  CarryObservationResult,
  { status: "predecessor_refused" }
>["reason"];

/** Read-only durable-transition reconciliation for recovery effect adapters. */
export type EmbeddedTransitionReconcile =
  | Readonly<{ status: "observed" | "absent" | "blocked" }>
  | Readonly<{ status: "ambiguous" | "unavailable" }>;

/** Read-only controller authority used while preparing an acquire intent. */
export type EmbeddedAcquisitionPlanningAuthority = Readonly<{
  continuation?: SlotContinuationEvidence;
  knownHolder?: string;
  /** Positive release evidence for the projected holder, if it is now free. */
  release?: SlotReleaseEvidence;
}>;

/** Controller-journal authority for an acquire or same-run continuation. */
export type EmbeddedAcquisitionAuthority = Readonly<{
  continuation?: SlotContinuationEvidence;
  knownHolder?: string;
  /** Positive release evidence for the projected holder, if it is now free. */
  release?: SlotReleaseEvidence;
  /**
   * Exact intent returned by `prepareAcquireTransition`, persisted by the
   * controller journal, then read back into this mutating call.
   */
  transition?: SlotTransitionIntent;
}>;

/** Exact intent returned by `prepareReleaseTransition` and journalled first. */
export type EmbeddedReleaseAuthority = Readonly<{
  transition: SlotTransitionIntent;
}>;

export interface EmbeddedAdapterOptions {
  readonly holder: string;
  readonly mode: EmbeddedMode;
  readonly prefix: string;
  readonly preflight: PreflightEnvelope;
  readonly process: EmbeddedProcessPort;
  readonly rootIssueId?: string;
  readonly scope: FencingScope;
}

function result(code: EmbeddedResult["code"]): EmbeddedResult {
  return {
    code,
    schema: "sce.beads-embedded.result",
    version: EMBEDDED_ADAPTER_VERSION,
  };
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function head(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-z]{20,64}$/u.test(value);
}

function holder(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  );
}

function checkedPreflight(
  preflight: PreflightEnvelope,
  identity: EmbeddedProcessIdentity,
  mode: EmbeddedMode,
  prefix: string,
  scope: FencingScope,
): boolean {
  // The adapter is a public trust boundary.  Its nominal TypeScript input can
  // be forged by a caller, so accept only the complete, strict envelope and
  // scope schemas before reading selected topology fields.
  if (
    !isSchema(PreflightEnvelopeSchema, preflight) ||
    !isSchema(FencingScopeSchema, scope) ||
    preflight.payload.status !== "ready"
  )
    return false;
  const beads = preflight.payload.beads;
  const expectedDirectory = `${identity.storePath}/${identity.database}`;
  if (
    beads.mode !== "embedded" ||
    beads.provenance !== "embedded_config" ||
    beads.database !== identity.database ||
    beads.prefix !== prefix ||
    beads.projectId !== scope.beadsStoreIdentity ||
    identity.prefix !== prefix ||
    beads.storePath !== identity.storePath ||
    identity.databaseDirectory !== expectedDirectory ||
    preflight.payload.git.identity !== scope.gitRepositoryIdentity
  )
    return false;
  if (mode === "local-only")
    return (
      beads.syncRemote === undefined &&
      beads.syncRef === undefined &&
      identity.remote === undefined
    );
  return (
    identity.remote !== undefined &&
    beads.syncRemote === identity.remote.url &&
    beads.syncRef === identity.remote.ref
  );
}

/**
 * Strict embedded Beads adapter.  It never shells out itself; a composition
 * root supplies the pinned-bd process port and may only implement the semantic
 * operations represented by EmbeddedRequest.
 */
export class EmbeddedBeadsAdapter implements RunStorePort {
  private readonly holder: string;
  private readonly mode: EmbeddedMode;
  private readonly prefix: string;
  private readonly process: EmbeddedProcessPort;
  private readonly rootIssueId: string | undefined;
  private readonly scope: FencingScope;
  private readonly usable: boolean;

  public constructor(options: EmbeddedAdapterOptions) {
    this.holder = options.holder;
    this.mode = options.mode;
    this.prefix = options.prefix;
    this.process = options.process;
    this.rootIssueId = options.rootIssueId;
    this.scope = options.scope;
    this.usable = checkedPreflight(
      options.preflight,
      options.process.identity,
      options.mode,
      options.prefix,
      options.scope,
    );
  }

  /** Acquires only the pre-existing built-in merge slot, with exact readback. */
  public async acquire(
    authority?: EmbeddedAcquisitionAuthority,
  ): Promise<EmbeddedResult> {
    // A mutating acquire cannot manufacture its own recovery authority. The
    // caller must first journal the exact read-only plan returned below.
    if (
      !this.usable ||
      authority === undefined ||
      !this.validAcquisitionAuthority(authority) ||
      // A holder-less acquire is necessarily mutating, so it must carry a
      // persisted plan before even a state probe is permitted.
      (authority.knownHolder === undefined &&
        authority.transition === undefined)
    )
      return result("quarantined");
    // Never pull a locally committed / pending slot transition over its
    // journal authority. A stale local holder is not an applied remote lease.
    const initial = await this.state();
    if (initial === undefined || !initial.reachable)
      return result("unavailable");
    if (initial.workingSet === "unknown") return result("ambiguous");
    if (
      initial.workingSet !== "clean" ||
      (this.mode === "git-sync" && initial.head !== initial.remoteHead)
    ) {
      // A stale clone may still prove that a different remote holder blocks
      // it, but it may never turn a remote available row into a local acquire
      // without a matching journalled transition.
      if (this.mode === "git-sync" && authority.transition === undefined) {
        const remote = await this.slot("check", "remote");
        if (remote === undefined) return result("ambiguous");
        const decision = decideControllerSlot(
          this.prefix,
          this.scope,
          this.holder,
          authority.knownHolder,
          remote,
          authority.continuation,
          authority.release,
        );
        return decision.kind === "blocked"
          ? result("blocked")
          : result("ambiguous");
      }
      return this.recoverSlotTransition("acquire", authority?.transition);
    }
    const before = await this.state();
    if (
      before === undefined ||
      !before.reachable ||
      before.workingSet !== "clean" ||
      before.head === undefined ||
      (this.mode === "git-sync" &&
        (before.remoteHead === undefined || before.remoteHead !== before.head))
    )
      return result("ambiguous");
    const check = await this.slot("check");
    if (check === undefined) return result("quarantined");
    // A caller can lose the result after its exact journalled acquire was
    // pushed.  Do not fall through the generic same-holder resume path: that
    // path only proves a current lease, whereas lost-result recovery must also
    // bind it to the persisted built-in slot/audit-event delta.
    if (
      authority.transition !== undefined &&
      same(check, authority.transition.after)
    )
      return this.reconcileLostSlotTransition(
        "acquire",
        authority.transition,
        before,
        check,
      );
    const decision = decideControllerSlot(
      this.prefix,
      this.scope,
      this.holder,
      authority?.knownHolder,
      check,
      authority?.continuation,
      authority?.release,
    );
    if (decision.kind === "blocked") return result("blocked");
    if (decision.kind === "quarantined") return result("quarantined");
    if (decision.kind === "resume" || decision.kind === "continue")
      return this.confirmDurableSlot(check);
    const transition = authority.transition;
    if (transition === undefined) return result("quarantined");
    if (!this.matchesTransitionBefore(transition, "acquire", before, check))
      return result("quarantined");
    const acquired = await this.slot("acquire");
    if (acquired === undefined) return result("quarantined");
    if (!same(acquired, transition.after)) return result("blocked");
    return this.durableSlotTransition(transition);
  }

  /**
   * Read-only planning half of acquire. Persist its returned intent in the
   * controller journal before calling `acquire`; it is the sole authority for
   * any pending or pre-push recovery in a replacement process.
   */
  public async prepareAcquireTransition(
    authority?: EmbeddedAcquisitionPlanningAuthority,
  ): Promise<SlotTransitionIntent | EmbeddedResult> {
    if (!this.usable || !this.validAcquisitionPlanningAuthority(authority))
      return result("quarantined");
    const state = await this.state();
    if (state === undefined || !state.reachable) return result("unavailable");
    if (
      state.workingSet !== "clean" ||
      state.head === undefined ||
      (this.mode === "git-sync" &&
        (state.remoteHead === undefined || state.remoteHead !== state.head))
    )
      return result("ambiguous");
    const before = await this.slot("check");
    if (before === undefined) return result("quarantined");
    if (this.mode === "git-sync") {
      const remote = await this.slot("check", "remote");
      if (remote === undefined || !same(remote, before))
        return result("ambiguous");
    }
    const decision = decideControllerSlot(
      this.prefix,
      this.scope,
      this.holder,
      authority?.knownHolder,
      before,
      authority?.continuation,
      authority?.release,
    );
    if (decision.kind === "blocked") return result("blocked");
    if (decision.kind === "quarantined") return result("quarantined");
    if (decision.kind === "resume" || decision.kind === "continue")
      return this.confirmDurableSlot(before);
    return makeSlotTransitionIntent(
      "acquire",
      this.holder,
      this.scope,
      {
        head: state.head,
        ...(state.remoteHead === undefined
          ? {}
          : { remoteHead: state.remoteHead }),
        slot: before,
      },
      this.expectedSlot("acquire", before),
    );
  }

  /** Releases only after a positive available readback from the built-in slot. */
  public async release(
    authority?: EmbeddedReleaseAuthority,
  ): Promise<EmbeddedResult> {
    if (
      !this.usable ||
      authority === undefined ||
      !this.validReleaseAuthority(authority)
    )
      return result("quarantined");
    const initial = await this.state();
    if (initial === undefined || !initial.reachable)
      return result("unavailable");
    if (initial.workingSet === "unknown") return result("ambiguous");
    if (
      initial.workingSet !== "clean" ||
      (this.mode === "git-sync" && initial.head !== initial.remoteHead)
    )
      return this.recoverSlotTransition("release", authority?.transition);
    const before = await this.slot("check");
    // A pushed release can be observed by a fresh adapter after the caller
    // died before persisting its result. Reconcile that durable result before
    // rejecting the now-available row as a non-holder, and never issue a new
    // release command on this path.
    if (before !== undefined && same(before, authority.transition.after))
      return this.reconcileLostSlotTransition(
        "release",
        authority.transition,
        initial,
        before,
      );
    if (
      before === undefined ||
      before.status !== "acquired" ||
      before.actor !== this.holder ||
      before.holder !== this.holder
    )
      return result("blocked");
    const state = await this.state();
    if (
      state === undefined ||
      !state.reachable ||
      state.workingSet !== "clean" ||
      state.head === undefined ||
      (this.mode === "git-sync" &&
        (state.remoteHead === undefined || state.remoteHead !== state.head))
    )
      return result("ambiguous");
    const transition = authority.transition;
    if (!this.matchesTransitionBefore(transition, "release", state, before))
      return result("quarantined");
    const released = await this.slot("release");
    if (released === undefined) return result("quarantined");
    if (!same(released, transition.after)) return result("blocked");
    return this.durableSlotTransition(transition);
  }

  /** Read-only planning half of release; see `prepareAcquireTransition`. */
  public async prepareReleaseTransition(): Promise<
    SlotTransitionIntent | EmbeddedResult
  > {
    if (!this.usable) return result("quarantined");
    const state = await this.state();
    if (state === undefined || !state.reachable) return result("unavailable");
    if (
      state.workingSet !== "clean" ||
      state.head === undefined ||
      (this.mode === "git-sync" &&
        (state.remoteHead === undefined || state.remoteHead !== state.head))
    )
      return result("ambiguous");
    const before = await this.slot("check");
    if (
      before === undefined ||
      before.status !== "acquired" ||
      before.actor !== this.holder ||
      before.holder !== this.holder
    )
      return result("blocked");
    if (this.mode === "git-sync") {
      const remote = await this.slot("check", "remote");
      if (remote === undefined || !same(remote, before))
        return result("ambiguous");
    }
    return makeSlotTransitionIntent(
      "release",
      this.holder,
      this.scope,
      {
        head: state.head,
        ...(state.remoteHead === undefined
          ? {}
          : { remoteHead: state.remoteHead }),
        slot: before,
      },
      this.expectedSlot("release", before),
    );
  }

  /** Generic read-only planning port used by production CLI composition. */
  public async prepareControllerTransition(
    input: Readonly<{
      holder: string;
      kind: "acquire" | "release";
      scope: FencingScope;
    }>,
  ): Promise<ControllerTransitionPlanResult> {
    if (input.holder !== this.holder || !same(input.scope, this.scope))
      return { status: "quarantined" };
    const planned =
      input.kind === "acquire"
        ? await this.prepareAcquireTransition()
        : await this.prepareReleaseTransition();
    if (!("code" in planned)) return { status: "planned", transition: planned };
    if (planned.code === "blocked" || planned.code === "holder_mismatch")
      return { status: "blocked" };
    if (planned.code === "unavailable") return { status: "unavailable" };
    return planned.code === "quarantined"
      ? { status: "quarantined" }
      : { status: "ambiguous" };
  }

  /**
   * Reconciles an already-journalled slot transition without invoking acquire,
   * release, commit, pull, or push. Positive observation requires both the
   * exact local transition-history proof and current after-slot readback.
   */
  public async reconcileControllerTransition(
    transition: ProtocolSlotTransitionIntent,
  ): Promise<EmbeddedTransitionReconcile> {
    if (
      !this.usable ||
      !validateSlotTransitionIntent(
        transition,
        this.prefix,
        this.scope,
        this.mode,
        this.holder,
      )
    )
      return { status: "ambiguous" };
    const state = await this.state();
    const current = await this.slot("check");
    if (state === undefined || current === undefined)
      return { status: "unavailable" };
    if (
      !state.reachable ||
      state.workingSet !== "clean" ||
      state.head === undefined ||
      (this.mode === "git-sync" && state.remoteHead === undefined)
    )
      return { status: "ambiguous" };
    if (same(current, transition.after)) {
      const proof = await this.call({
        kind: "slot_transition",
        intent: transition,
      });
      if (proof?.kind !== "slot_transition" || proof.value !== "observed")
        return { status: "ambiguous" };
      if (this.mode === "git-sync") {
        const remote = await this.slot("check", "remote");
        if (remote === undefined || !same(remote, transition.after))
          return { status: "ambiguous" };
      }
      return { status: "observed" };
    }
    if (current.status === "acquired" && current.holder !== this.holder)
      return { status: "blocked" };
    if (
      same(current, transition.before.slot) &&
      state.head === transition.before.head &&
      (this.mode === "local-only" ||
        state.remoteHead === transition.before.remoteHead)
    )
      return { status: "absent" };
    return { status: "ambiguous" };
  }

  /** Execute only a validated transition recovered from the durable journal. */
  public async executeControllerTransition(
    transition: ProtocolSlotTransitionIntent,
  ): Promise<EmbeddedTransitionReconcile> {
    if (
      !this.usable ||
      !validateSlotTransitionIntent(
        transition,
        this.prefix,
        this.scope,
        this.mode,
        this.holder,
      )
    )
      return { status: "ambiguous" };
    const outcome =
      transition.kind === "acquire"
        ? await this.acquire({ transition })
        : await this.release({ transition });
    if (outcome.code === "applied") return { status: "observed" };
    if (outcome.code === "blocked" || outcome.code === "holder_mismatch")
      return { status: "blocked" };
    return outcome.code === "unavailable"
      ? { status: "unavailable" }
      : { status: "ambiguous" };
  }

  /** One validated aggregate/child mutation batch, followed by exact readback. */
  public async compareAndSet(batch: MutationBatch): Promise<RunStoreResult> {
    if (
      !this.usable ||
      !validateMutationBatch(batch).ok ||
      !same(batch.scope, this.scope) ||
      batch.holder !== this.holder
    )
      return { status: "quarantined" };
    const recovery = await this.state();
    if (recovery === undefined || !recovery.reachable)
      return { status: "unavailable" };
    if (recovery.workingSet === "pending") {
      const discovered = await this.discover("before_commit", batch);
      if (discovered.status !== "observed") return { status: "ambiguous" };
      const baseline = this.checkpointBaseline(recovery);
      if (
        baseline === undefined ||
        !this.matchesCheckpointBaseline(discovered, baseline)
      )
        return { status: "ambiguous" };
      // A replacement process must not commit/push a previously written batch
      // after its controller lost or released the built-in slot. This check is
      // deliberately before `durableCheckpoint`, which otherwise can commit.
      const slot = await this.slot("check");
      if (
        slot === undefined ||
        slot.status !== "acquired" ||
        slot.actor !== this.holder ||
        slot.holder !== this.holder
      )
        return { status: "holder_mismatch" };
      const durable = await this.durableCheckpoint(batch, baseline);
      if (durable.code !== "applied") return this.storeFailure(durable.code);
      const readback = await this.readback(batch);
      return readback === undefined ||
        !same(readback.root, batch.next.root) ||
        !same(readback.children, batch.next.children)
        ? { status: "quarantined" }
        : {
            affectedRowCount: 1 + batch.changedRows.length,
            checkpoint: batch.checkpoint,
            children: [...readback.children],
            root: readback.root,
            status: "applied",
          };
    }
    if (recovery.workingSet !== "clean") return { status: "ambiguous" };
    // A replacement process may hold the exact one-parent checkpoint commit
    // while the remote remains at its proved parent. Reconcile and push that
    // commit; do not feed it through pull, which must reject local-ahead work.
    if (
      this.mode === "git-sync" &&
      recovery.head !== undefined &&
      recovery.remoteHead !== undefined &&
      recovery.head !== recovery.remoteHead
    ) {
      const discovered = await this.discover("before_push", batch);
      if (
        discovered.status === "observed" &&
        discovered.head === recovery.head &&
        discovered.baseHead !== undefined &&
        discovered.remoteHead === recovery.remoteHead
      ) {
        const slot = await this.slot("check");
        if (
          slot === undefined ||
          slot.status !== "acquired" ||
          slot.actor !== this.holder ||
          slot.holder !== this.holder
        )
          return { status: "holder_mismatch" };
        const durable = await this.durableCheckpoint(batch, {
          head: discovered.baseHead,
          remoteHead: discovered.remoteHead,
        });
        if (durable.code !== "applied") return this.storeFailure(durable.code);
        const readback = await this.readback(batch);
        return readback === undefined ||
          !same(readback.root, batch.next.root) ||
          !same(readback.children, batch.next.children)
          ? { status: "quarantined" }
          : {
              affectedRowCount: 1 + batch.changedRows.length,
              checkpoint: batch.checkpoint,
              children: [...readback.children],
              root: readback.root,
              status: "applied",
            };
      }
    }
    const prepared = await this.prepareSharedState();
    if (prepared.result.code !== "applied")
      return this.storeFailure(prepared.result.code);
    const slot = await this.slot("check");
    if (
      slot === undefined ||
      slot.status !== "acquired" ||
      slot.actor !== this.holder ||
      slot.holder !== this.holder
    )
      return { status: "holder_mismatch" };
    const baseline = this.checkpointBaseline(prepared.state);
    if (baseline === undefined) return { status: "ambiguous" };
    const mutation = await this.call({ kind: "mutation", batch });
    if (mutation?.kind !== "mutation") return { status: "ambiguous" };
    if (mutation.value !== "applied") {
      if (mutation.value !== "stale") return { status: mutation.value };
      // A prior process can have completed the exact CAS before crashing. The
      // controller journal supplies the same batch to a new process, which
      // proves that state rather than relying on a remembered write.
      const discovered = await this.discover(
        this.mode === "git-sync" ? "after_push" : "after_commit",
        batch,
      );
      if (
        discovered.status !== "observed" ||
        discovered.head !== baseline.head ||
        (this.mode === "git-sync" &&
          discovered.remoteHead !== baseline.remoteHead)
      )
        return {
          status: discovered.status === "absent" ? "stale" : "ambiguous",
        };
      const readback = await this.readback(batch);
      return readback === undefined ||
        !same(readback.root, batch.next.root) ||
        !same(readback.children, batch.next.children)
        ? { status: "quarantined" }
        : {
            affectedRowCount: 1 + batch.changedRows.length,
            checkpoint: batch.checkpoint,
            children: [...readback.children],
            root: readback.root,
            status: "applied",
          };
    }
    const durable = await this.durableCheckpoint(batch, baseline);
    if (durable.code !== "applied") return this.storeFailure(durable.code);
    const readback = await this.readback(batch);
    if (
      readback === undefined ||
      !same(readback.root, batch.next.root) ||
      !same(readback.children, batch.next.children)
    )
      return { status: "quarantined" };
    return {
      affectedRowCount: 1 + batch.changedRows.length,
      checkpoint: batch.checkpoint,
      children: [...readback.children],
      root: readback.root,
      status: "applied",
    };
  }

  /**
   * Authoritative projection load. Only the process's positive `absent` is
   * passed through; malformed, partial, and transport failures remain tagged
   * failures and can never drive bootstrap.
   */
  public async prepareProvenanceCarryClaim(
    predecessorRootIssueId: string,
    currentRun: RepositoryRun,
  ) {
    const inspected = await this.inspectCarryPredecessor(
      predecessorRootIssueId,
      currentRun,
    );
    return inspected.status === "planned"
      ? { plan: inspected.value.plan, status: "planned" as const }
      : { status: inspected.status as "blocked" | "unavailable" };
  }

  public async reconcileProvenanceCarryClaim(
    effect: CarryEffect,
    run: RepositoryRun,
  ) {
    const inspected = await this.inspectCarryPredecessor(
      effect.params.predecessorRootBeadId,
      run,
    );
    if (inspected.status !== "planned")
      return inspected.status === "unavailable"
        ? { status: "unavailable" as const }
        : {
            result: this.predecessorRefusal(
              effect.params.predecessorRootBeadId,
              inspected.reason,
            ),
            status: "observed" as const,
          };
    if (!this.carryPlanMatchesEffect(inspected.value, effect, run))
      return { status: "ambiguous" as const };
    const classified = this.classifyCarryClaims(
      inspected.claims,
      inspected.value,
      effect,
      false,
    );
    if (
      classified.status === "observed" &&
      classified.result.status === "already_claimed"
    )
      return (await this.competitorCarryIsDurable(inspected.claims, effect))
        ? classified
        : { status: "ambiguous" as const };
    if (
      classified.status !== "observed" ||
      classified.result.status !== "imported"
    )
      return classified;
    const durable = await this.reconcileDurableCarryCheckpoint(
      this.carryCheckpointIntent(effect),
    );
    if (durable.code !== "applied")
      return {
        status:
          durable.code === "unavailable"
            ? ("unavailable" as const)
            : ("ambiguous" as const),
      };
    const reread = await this.inspectCarryPredecessor(
      effect.params.predecessorRootBeadId,
      run,
    );
    if (
      reread.status !== "planned" ||
      !this.carryPlanMatchesEffect(reread.value, effect, run)
    )
      return { status: "ambiguous" as const };
    const readback = this.classifyCarryClaims(
      reread.claims,
      reread.value,
      effect,
      true,
    );
    return readback.status === "absent"
      ? { status: "ambiguous" as const }
      : readback;
  }

  public async executeProvenanceCarryClaim(
    effect: CarryEffect,
    run: RepositoryRun,
  ) {
    const inspected = await this.inspectCarryPredecessor(
      effect.params.predecessorRootBeadId,
      run,
    );
    if (inspected.status !== "planned")
      return inspected.status === "unavailable"
        ? { status: "unavailable" as const }
        : {
            result: this.predecessorRefusal(
              effect.params.predecessorRootBeadId,
              inspected.reason,
            ),
            status: "observed" as const,
          };
    if (!this.carryPlanMatchesEffect(inspected.value, effect, run))
      return { status: "ambiguous" as const };
    const existing = this.classifyCarryClaims(
      inspected.claims,
      inspected.value,
      effect,
      false,
    );
    if (existing.status === "observed")
      return existing.result.status === "already_claimed" &&
        !(await this.competitorCarryIsDurable(inspected.claims, effect))
        ? { status: "ambiguous" as const }
        : existing;
    if (existing.status !== "absent") return { status: "ambiguous" as const };
    const baseline = this.checkpointBaseline(await this.state());
    const slot = await this.slot("check");
    if (
      baseline === undefined ||
      slot?.status !== "acquired" ||
      slot.holder !== this.holder
    )
      return { status: "ambiguous" as const };
    const record = this.carryClaimRecord(effect);
    const checkpointIntent = this.carryCheckpointIntent(effect);
    const response = await this.call({
      exportDigest: checkpointIntent.exportDigest,
      expectedAggregateCommitment:
        effect.params.predecessorRootAggregateCommitment,
      kind: "carry_claim",
      predecessorRootIssueId: effect.params.predecessorRootBeadId,
      record,
      slot,
    });
    if (response?.kind !== "carry_claim")
      return { status: "unavailable" as const };
    if (response.value.status === "unavailable")
      return { status: "unavailable" as const };
    if (response.value.status === "stale") {
      const raced = await this.inspectCarryPredecessor(
        effect.params.predecessorRootBeadId,
        run,
      );
      if (
        raced.status !== "planned" ||
        !this.carryPlanMatchesEffect(raced.value, effect, run)
      )
        return { status: "ambiguous" as const };
      const classified = this.classifyCarryClaims(
        raced.claims,
        raced.value,
        effect,
        true,
      );
      if (
        classified.status === "observed" &&
        classified.result.status === "already_claimed" &&
        !(await this.competitorCarryIsDurable(raced.claims, effect))
      )
        return { status: "ambiguous" as const };
      return classified.status === "absent"
        ? { status: "ambiguous" as const }
        : classified;
    }
    const durable = await this.durableCarryCheckpoint(
      checkpointIntent,
      baseline,
    );
    if (durable.code !== "applied") return { status: "ambiguous" as const };
    const reread = await this.inspectCarryPredecessor(
      effect.params.predecessorRootBeadId,
      run,
    );
    if (reread.status !== "planned") return { status: "ambiguous" as const };
    const readback = this.classifyCarryClaims(
      reread.claims,
      reread.value,
      effect,
      true,
    );
    return readback.status === "absent"
      ? { status: "ambiguous" as const }
      : readback;
  }

  public async load(): Promise<AuthoritativeLoadResult> {
    if (!this.usable) return { status: "quarantined" };
    const response = await this.call({ kind: "load" });
    if (response?.kind !== "load") return { status: "unavailable" };
    if (response.value.status !== "observed") return response.value;
    const root = validateRootProjection(response.value.value.root);
    if (!root.ok || !same(root.value.scope, this.scope))
      return { status: "corrupt" };
    const expected = root.value.childRows;
    const children = response.value.value.children;
    if (children.length !== expected.length) return { status: "corrupt" };
    const seen = new Set<string>();
    for (const child of children) {
      const parsed = validateChildProjection(child);
      const reference = parsed.ok
        ? expected.find((row) => row.unitId === parsed.value.unitId)
        : undefined;
      if (
        !parsed.ok ||
        reference === undefined ||
        seen.has(parsed.value.unitId) ||
        parsed.value.revision !== reference.revision ||
        parsed.value.commitment !== reference.commitment ||
        !same(parsed.value.scope, root.value.scope) ||
        parsed.value.holder !== root.value.holder
      )
        return { status: "corrupt" };
      seen.add(parsed.value.unitId);
    }
    return seen.size !== expected.length
      ? { status: "corrupt" }
      : { status: "observed", value: response.value.value };
  }

  /**
   * The sole existing-root write permitted before controller ownership. It is
   * intentionally narrower than compareAndSet: it writes only a validated
   * unacquired -> acquire_intent journal transition, never an active run.
   */
  public async persistControllerAcquireIntent(
    batch: MutationBatch,
  ): Promise<RunStoreResult> {
    if (!this.validPreOwnershipBatch(batch)) return { status: "quarantined" };
    const loaded = await this.load();
    if (loaded.status !== "observed") return this.loadFailure(loaded.status);
    const current = loaded.value.root;
    if (this.isExactIntentReadback(loaded.value, batch))
      return this.durablePreOwnershipIntent(batch);
    if (
      current.aggregateRevision !== batch.expectedAggregateRevision ||
      current.aggregateCommitment !== batch.expectedAggregateCommitment ||
      current.holder !== batch.expectedHolder ||
      !this.isPreOwnershipTransition(current, batch.next.root)
    )
      return { status: "stale" };
    const slot = await this.availablePreOwnershipSlot();
    if (slot === undefined) return { status: "ambiguous" };
    const state = await this.state();
    if (
      state === undefined ||
      !state.reachable ||
      state.workingSet !== "clean" ||
      (this.mode === "git-sync" &&
        (state.head === undefined || state.remoteHead !== state.head))
    )
      return { status: "ambiguous" };
    const mutation = await this.call({
      kind: "preownership_mutation",
      batch,
      slot,
    });
    if (mutation?.kind !== "mutation") return { status: "unavailable" };
    if (mutation.value === "applied")
      return this.durablePreOwnershipIntent(batch);
    if (mutation.value !== "stale") return { status: mutation.value };
    const after = await this.load();
    if (after.status !== "observed") return this.loadFailure(after.status);
    return this.isExactIntentReadback(after.value, batch)
      ? this.durablePreOwnershipIntent(batch)
      : { status: "stale" };
  }

  /** Atomic absent-root bootstrap; active runs and ordinary CAS are refused. */
  public async createControllerAcquireIntent(
    request: InitialControllerAcquire,
  ): Promise<RunStoreResult> {
    const parsed = validate<InitialControllerAcquire>(
      InitialControllerAcquireSchema,
      request,
    );
    if (
      !this.usable ||
      !parsed.ok ||
      parsed.value === undefined ||
      !same(parsed.value.expected.scope, this.scope) ||
      parsed.value.expected.holder !== this.holder
    )
      return { status: "quarantined" };
    const projection = parsed.value.next;
    if (!this.validInitialProjection(projection))
      return { status: "quarantined" };
    const existing = await this.load();
    if (existing.status === "observed")
      return this.isExactInitialReadback(existing.value, projection)
        ? this.durableInitialIntent(projection)
        : { status: "stale" };
    if (existing.status !== "absent") return this.loadFailure(existing.status);
    const slot = await this.availablePreOwnershipSlot();
    if (slot === undefined) return { status: "ambiguous" };
    const state = await this.state();
    if (
      state === undefined ||
      !state.reachable ||
      state.workingSet !== "clean" ||
      (this.mode === "git-sync" &&
        (state.head === undefined || state.remoteHead !== state.head))
    )
      return { status: "ambiguous" };
    const initialized = await this.call({
      kind: "initialize",
      input: projection,
      slot,
    });
    if (initialized?.kind !== "mutation") return { status: "unavailable" };
    if (initialized.value === "applied")
      return this.durableInitialIntent(projection);
    if (initialized.value !== "stale") return { status: initialized.value };
    const after = await this.load();
    if (after.status !== "observed") return this.loadFailure(after.status);
    return this.isExactInitialReadback(after.value, projection)
      ? this.durableInitialIntent(projection)
      : { status: "stale" };
  }

  private validInitialProjection(
    input: InitialControllerAcquire["next"],
  ): boolean {
    const root = validateRootProjection(input.root);
    if (!root.ok || !same(root.value.scope, this.scope)) return false;
    if (root.value.aggregateRevision !== 1) return false;
    const values: ChildProjection[] = [];
    for (const inputChild of input.children) {
      const child = validateChildProjection(inputChild);
      if (!child.ok) return false;
      values.push(child.value);
    }
    values.sort((a, b) =>
      a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0,
    );
    if (
      !same(values, input.children) ||
      values.length !== root.value.childRows.length ||
      values.some(
        (child, index) =>
          root.value.childRows[index]?.unitId !== child.unitId ||
          root.value.childRows[index]?.revision !== child.revision ||
          root.value.childRows[index]?.commitment !== child.commitment,
      )
    )
      return false;
    return (
      root.value.run.revision === 1 &&
      root.value.run.effectJournal.length === 1 &&
      this.isPreOwnershipTransition(undefined, root.value)
    );
  }

  private validPreOwnershipBatch(batch: MutationBatch): boolean {
    return (
      this.usable &&
      validateMutationBatch(batch).ok &&
      same(batch.scope, this.scope) &&
      batch.holder === this.holder &&
      this.isPreOwnershipTransition(undefined, batch.next.root)
    );
  }

  private isPreOwnershipTransition(
    before: RootProjection | undefined,
    next: RootProjection,
  ): boolean {
    const prior = before?.run;
    const run = next.run;
    const entry = run.effectJournal.at(-1);
    return (
      next.holder === this.holder &&
      same(next.scope, this.scope) &&
      run.state === "initializing" &&
      run.controller.holder === this.holder &&
      run.controller.state === "acquire_intent" &&
      run.effectJournal.length === (prior?.effectJournal.length ?? 0) + 1 &&
      entry?.kind === "controller_acquire" &&
      entry.status === "intended" &&
      entry.slotTransition !== undefined &&
      validateSlotTransitionIntent(
        entry.slotTransition,
        this.prefix,
        this.scope,
        this.mode,
        this.holder,
      ) &&
      (prior === undefined ||
        (prior.state === "initializing" &&
          prior.controller.holder === this.holder &&
          prior.controller.state === "unacquired" &&
          prior.effectJournal.length === 0 &&
          run.effectJournal.length === prior.effectJournal.length + 1))
    );
  }

  private isExactIntentReadback(
    readback: Readonly<{
      children: readonly ChildProjection[];
      root: RootProjection;
    }>,
    batch: MutationBatch,
  ): boolean {
    if (!same(readback.root, batch.next.root)) return false;
    return batch.next.children.every((expected) =>
      readback.children.some((actual) => same(actual, expected)),
    );
  }

  private isExactInitialReadback(
    readback: Readonly<{
      children: readonly ChildProjection[];
      root: RootProjection;
    }>,
    input: InitialControllerAcquire["next"],
  ): boolean {
    return (
      same(readback.root, input.root) && same(readback.children, input.children)
    );
  }

  private async availablePreOwnershipSlot(): Promise<
    MergeSlotObservation | undefined
  > {
    const prepared = await this.prepareSharedState();
    if (prepared.result.code !== "applied") return undefined;
    const local = await this.slot("check");
    if (
      local === undefined ||
      local.status !== "available" ||
      local.holder !== undefined
    )
      return undefined;
    if (this.mode === "local-only") return local;
    const remote = await this.slot("check", "remote");
    return remote !== undefined && same(remote, local) ? local : undefined;
  }

  private async durablePreOwnershipIntent(
    batch: MutationBatch,
  ): Promise<RunStoreResult> {
    const durable = await this.durableCheckpoint(batch);
    if (durable.code !== "applied") return this.storeFailure(durable.code);
    const readback = await this.readback(batch);
    return readback === undefined ||
      !this.isExactIntentReadback(readback, batch)
      ? { status: "quarantined" }
      : {
          affectedRowCount: 1 + batch.changedRows.length,
          checkpoint: batch.checkpoint,
          children: [...batch.next.children],
          root: batch.next.root,
          status: "applied",
        };
  }

  /** Commit/push and exact load after the separate absent-row SQL mutation. */
  private async durableInitialIntent(
    input: InitialControllerAcquire["next"],
  ): Promise<RunStoreResult> {
    let state = await this.state();
    if (
      state === undefined ||
      !state.reachable ||
      state.workingSet === "unknown"
    )
      return { status: "unavailable" };
    if (state.workingSet === "pending" || state.workingSet === "clean") {
      const committed = await this.call({ kind: "initial_commit", input });
      if (committed?.kind !== "commit" || committed.value !== "applied")
        return {
          status:
            committed?.kind === "commit" && committed.value === "unavailable"
              ? "unavailable"
              : "ambiguous",
        };
      state = await this.state();
    }
    if (
      state === undefined ||
      !state.reachable ||
      state.workingSet !== "clean" ||
      state.head === undefined
    )
      return { status: "ambiguous" };
    if (this.mode === "git-sync") {
      if (state.remoteHead === state.head) {
        // Already pushed by the process that crashed before readback.
      } else {
        const pushed = await this.call({ kind: "initial_push", input });
        if (pushed?.kind !== "push" || pushed.value !== "applied")
          return {
            status:
              pushed?.kind === "push" && pushed.value === "unavailable"
                ? "unavailable"
                : "ambiguous",
          };
        state = await this.state();
        if (
          state === undefined ||
          !state.reachable ||
          state.workingSet !== "clean" ||
          state.head === undefined ||
          state.remoteHead !== state.head
        )
          return { status: "ambiguous" };
      }
    }
    const loaded = await this.load();
    if (loaded.status !== "observed") return this.loadFailure(loaded.status);
    return !this.isExactInitialReadback(loaded.value, input)
      ? { status: "stale" }
      : {
          affectedRowCount: 1 + input.children.length,
          checkpoint: input.root.checkpoint,
          children: [...input.children],
          root: input.root,
          status: "applied",
        };
  }

  private loadFailure(
    status: Exclude<AuthoritativeLoadResult["status"], "observed">,
  ): RunStoreResult {
    switch (status) {
      case "absent":
        return { status: "stale" };
      case "corrupt":
        return { status: "quarantined" };
      default:
        return { status };
    }
  }

  /** Records a clean baseline before a cooperative worker/reviewer session. */
  public async workerBaseline(): Promise<WorkerTrackerBaseline | undefined> {
    if (!this.usable) return undefined;
    const state = await this.state();
    if (
      state === undefined ||
      state.workingSet !== "clean" ||
      (this.mode === "git-sync" &&
        (state.head === undefined ||
          state.remoteHead === undefined ||
          state.head !== state.remoteHead))
    )
      return undefined;
    const slot = await this.slot("check");
    if (
      slot === undefined ||
      slot.status !== "acquired" ||
      slot.actor !== this.holder ||
      slot.holder !== this.holder
    )
      return undefined;
    return {
      ...(state.head === undefined ? {} : { head: state.head }),
      ...(this.mode === "git-sync" ? { remoteHead: state.remoteHead } : {}),
      slot,
      workingSet: "clean",
    };
  }

  /** Detects tracker mutation by a worker; it intentionally does not repair it. */
  public async verifyWorkerBaseline(
    baseline: WorkerTrackerBaseline,
  ): Promise<EmbeddedResult> {
    if (!this.usable) return result("quarantined");
    if (!this.validWorkerBaseline(baseline)) return result("quarantined");
    const state = await this.state();
    const slot = await this.slot("check");
    if (state === undefined || slot === undefined) return result("ambiguous");
    return state.workingSet === "clean" &&
      state.head === baseline.head &&
      state.remoteHead === baseline.remoteHead &&
      slot.status === "acquired" &&
      slot.actor === this.holder &&
      slot.holder === this.holder &&
      same(slot, baseline.slot)
      ? result("applied")
      : result("worker_mutation");
  }

  private async prepareSharedState(): Promise<
    Readonly<{
      result: EmbeddedResult;
      state?: EmbeddedState;
    }>
  > {
    const before = await this.state();
    if (before === undefined || !before.reachable)
      return { result: result("unavailable") };
    if (before.workingSet !== "clean") return { result: result("blocked") };
    if (this.mode === "local-only")
      return { result: result("applied"), state: before };
    const pull = await this.call({ kind: "pull" });
    if (pull?.kind !== "pull") return { result: result("ambiguous") };
    if (pull.value === "conflict") return { result: result("conflict") };
    if (pull.value !== "applied") return { result: result(pull.value) };
    const after = await this.state();
    return after === undefined || !after.reachable
      ? { result: result("unavailable") }
      : after.workingSet === "clean"
        ? { result: result("applied"), state: after }
        : { result: result("blocked") };
  }

  private expectedSlot(
    kind: "acquire" | "release",
    before: MergeSlotObservation,
  ): MergeSlotObservation {
    const value = {
      ...before,
      actor: this.holder,
      ...(kind === "acquire" ? { holder: this.holder } : {}),
      ...(kind === "acquire"
        ? { status: "acquired" as const }
        : { status: "available" as const }),
    };
    if (kind === "release") delete (value as { holder?: string }).holder;
    const { readbackHash: _ignored, ...withoutHash } = value;
    return {
      ...withoutHash,
      readbackHash: deriveSlotReadbackHash(withoutHash),
    };
  }

  private matchesTransitionBefore(
    transition: SlotTransitionIntent,
    kind: "acquire" | "release",
    state: EmbeddedState,
    slot: MergeSlotObservation,
  ): boolean {
    return (
      validateSlotTransitionIntent(
        transition,
        this.prefix,
        this.scope,
        this.mode,
        this.holder,
      ) &&
      transition.kind === kind &&
      state.head !== undefined &&
      transition.before.head === state.head &&
      transition.before.remoteHead === state.remoteHead &&
      same(transition.before.slot, slot) &&
      same(transition.after, this.expectedSlot(kind, slot))
    );
  }

  /**
   * Resumes only a controller-journalled built-in transition. The process
   * proves the entire local delta before this method can commit or push it.
   */
  private async recoverSlotTransition(
    kind: "acquire" | "release",
    transition: SlotTransitionIntent | undefined,
  ): Promise<EmbeddedResult> {
    if (
      transition === undefined ||
      !validateSlotTransitionIntent(
        transition,
        this.prefix,
        this.scope,
        this.mode,
        this.holder,
      ) ||
      transition.kind !== kind
    )
      return result("ambiguous");
    const state = await this.state();
    const local = await this.slot("check");
    if (
      state === undefined ||
      !state.reachable ||
      state.workingSet === "unknown" ||
      local === undefined ||
      !same(local, transition.after) ||
      state.head === undefined ||
      // A pending change retains the before head; an auto-committed change
      // must have created a new head. Either other shape is unrelated state.
      (state.workingSet === "pending" &&
        state.head !== transition.before.head) ||
      (state.workingSet === "clean" && state.head === transition.before.head)
    )
      return result("ambiguous");
    if (this.mode === "git-sync") {
      if (state.remoteHead === transition.before.remoteHead) {
        const remote = await this.slot("check", "remote");
        if (remote === undefined || !same(remote, transition.before.slot))
          return result("ambiguous");
      } else if (state.workingSet === "clean") {
        return this.reconcileRemoteSlotTransition(
          kind,
          transition,
          state,
          local,
        );
      } else return result("ambiguous");
    }
    return this.durableSlotTransition(transition);
  }

  /** Runtime-checks the semantic cross-clone proof returned by the process. */
  private remoteTransitionProofMatches(
    value: RemoteSlotTransitionProof,
    state: EmbeddedState,
  ): boolean {
    const proof = object(value);
    return (
      proof !== undefined &&
      Object.keys(proof).length === 6 &&
      proof.schema === "sce.beads-embedded.remote-slot-transition-proof" &&
      proof.status === "observed" &&
      proof.version === 1 &&
      head(proof.effectHead) &&
      head(proof.localHead) &&
      head(proof.remoteHead) &&
      proof.effectHead === proof.remoteHead &&
      proof.localHead === state.head &&
      proof.remoteHead === state.remoteHead
    );
  }

  /**
   * Replays an already-pushed transition from another clone only after its
   * remote parent→effect proof and this clone's pinned merge proof agree.
   */
  private async reconcileRemoteSlotTransition(
    kind: "acquire" | "release",
    transition: SlotTransitionIntent,
    state: EmbeddedState,
    local: MergeSlotObservation,
  ): Promise<EmbeddedResult> {
    if (
      !validateSlotTransitionIntent(
        transition,
        this.prefix,
        this.scope,
        "git-sync",
        this.holder,
      ) ||
      transition.kind !== kind ||
      !state.reachable ||
      state.workingSet !== "clean" ||
      state.head === undefined ||
      state.remoteHead === undefined ||
      state.head === transition.before.head ||
      state.remoteHead === transition.before.remoteHead ||
      !same(local, transition.after)
    )
      return result("ambiguous");
    const proof = await this.call({
      kind: "remote_slot_transition",
      intent: transition,
    });
    if (
      proof?.kind !== "remote_slot_transition" ||
      !this.remoteTransitionProofMatches(proof.value, state)
    )
      return result("ambiguous");
    // This remote check fetches again. Its following state reread binds the
    // remote slot observation to the same effect head and proves the replay
    // itself made no local merge, commit, or working-set change.
    const remote = await this.slot("check", "remote");
    const final = await this.state();
    return remote !== undefined &&
      same(remote, transition.after) &&
      final !== undefined &&
      final.reachable &&
      final.workingSet === "clean" &&
      final.head === state.head &&
      final.remoteHead === state.remoteHead
      ? result("applied")
      : result("ambiguous");
  }

  /**
   * Reconciles a clean, already-durable slot transition after its caller lost
   * the result.  Unlike the ordinary current-slot decision, this path must
   * prove the exact persisted transition delta before it can publish applied.
   */
  private async reconcileLostSlotTransition(
    kind: "acquire" | "release",
    transition: SlotTransitionIntent,
    state: EmbeddedState,
    local: MergeSlotObservation,
  ): Promise<EmbeddedResult> {
    if (
      !validateSlotTransitionIntent(
        transition,
        this.prefix,
        this.scope,
        this.mode,
        this.holder,
      ) ||
      transition.kind !== kind ||
      !state.reachable ||
      state.workingSet !== "clean" ||
      state.head === undefined ||
      state.head === transition.before.head ||
      !same(local, transition.after) ||
      (this.mode === "git-sync" &&
        (state.remoteHead === undefined || state.remoteHead !== state.head))
    )
      return result("ambiguous");
    const prove = await this.call({
      kind: "slot_transition",
      intent: transition,
    });
    if (prove?.kind !== "slot_transition" || prove.value !== "observed")
      return result("ambiguous");
    if (this.mode === "local-only") {
      const final = await this.state();
      return final !== undefined &&
        final.reachable &&
        final.workingSet === "clean" &&
        final.head === state.head
        ? result("applied")
        : result("ambiguous");
    }
    // The remote read performs its own bounded fetch. Re-read state after it,
    // so an unrelated remote commit which preserves the available/held row
    // cannot turn a lost-result reconciliation into an inferred success.
    const remote = await this.slot("check", "remote");
    const final = await this.state();
    return remote !== undefined &&
      same(remote, transition.after) &&
      final !== undefined &&
      final.reachable &&
      final.workingSet === "clean" &&
      final.head === state.head &&
      final.remoteHead === state.head
      ? result("applied")
      : result("ambiguous");
  }

  /**
   * Applies a transition only after a semantic process proof that its delta
   * contains the built-in slot issue and its unavoidable audit event, with no
   * other table, issue, or label movement.
   */
  private async durableSlotTransition(
    transition: SlotTransitionIntent,
  ): Promise<EmbeddedResult> {
    const prove = await this.call({
      kind: "slot_transition",
      intent: transition,
    });
    if (prove?.kind !== "slot_transition" || prove.value !== "observed")
      return result("ambiguous");
    let state = await this.state();
    if (
      state === undefined ||
      !state.reachable ||
      state.workingSet === "unknown"
    )
      return result("ambiguous");
    if (state.workingSet === "pending") {
      const commit = await this.call({ kind: "commit" });
      if (commit?.kind !== "commit" || commit.value !== "applied")
        return result(
          commit?.kind === "commit" && commit.value === "unavailable"
            ? "unavailable"
            : "ambiguous",
        );
      const afterCommit = await this.call({
        kind: "slot_transition",
        intent: transition,
      });
      if (
        afterCommit?.kind !== "slot_transition" ||
        afterCommit.value !== "observed"
      )
        return result("ambiguous");
      state = await this.state();
    }
    if (
      state === undefined ||
      !state.reachable ||
      state.workingSet !== "clean" ||
      state.head === undefined
    )
      return result("ambiguous");
    const local = await this.slot("check");
    if (local === undefined || !same(local, transition.after))
      return result("ambiguous");
    if (this.mode === "local-only") return result("applied");
    if (
      state.remoteHead !== transition.before.remoteHead ||
      state.head === transition.before.remoteHead
    )
      return result("ambiguous");
    const remoteBefore = await this.slot("check", "remote");
    if (
      remoteBefore === undefined ||
      !same(remoteBefore, transition.before.slot)
    )
      return result("ambiguous");
    const push = await this.call({ kind: "push" });
    if (push?.kind !== "push") return result("ambiguous");
    if (push.value === "conflict") return result("conflict");
    if (push.value !== "applied") return result("ambiguous");
    const synced = await this.state();
    const remoteAfter = await this.slot("check", "remote");
    // `slot(check, remote)` performs a bounded fetch itself. Re-read state
    // after that fetch (and therefore fetch once more) before publishing
    // applied, so a remote-only commit which preserves the slot row cannot be
    // hidden behind the earlier post-push head observation.
    const final = await this.state();
    return synced !== undefined &&
      synced.reachable &&
      synced.workingSet === "clean" &&
      synced.head !== undefined &&
      synced.remoteHead === synced.head &&
      same(synced.head, state.head) &&
      remoteAfter !== undefined &&
      same(remoteAfter, transition.after) &&
      final !== undefined &&
      final.reachable &&
      final.workingSet === "clean" &&
      final.head === state.head &&
      final.remoteHead === state.head
      ? result("applied")
      : result("ambiguous");
  }

  private async confirmDurableSlot(
    local: MergeSlotObservation,
  ): Promise<EmbeddedResult> {
    if (this.mode === "local-only") return result("applied");
    const state = await this.state();
    const remote = await this.slot("check", "remote");
    const final = await this.state();
    return state !== undefined &&
      state.reachable &&
      state.workingSet === "clean" &&
      state.head !== undefined &&
      state.remoteHead === state.head &&
      remote !== undefined &&
      same(remote, local) &&
      final !== undefined &&
      final.reachable &&
      final.workingSet === "clean" &&
      final.head === state.head &&
      final.remoteHead === state.head
      ? result("applied")
      : result("ambiguous");
  }

  /** Commit state and sync it without force; discovery brackets commit/push. */
  private async durableCarryCheckpoint(
    intent: CarryCheckpointIntent,
    baseline: Readonly<{ head: string; remoteHead?: string }>,
  ): Promise<EmbeddedResult> {
    const discover = async (point: CrashPoint) => {
      const response = await this.call({
        kind: "carry_discover",
        point,
        intent,
      });
      return response?.kind === "carry_discover"
        ? response.value
        : { status: "ambiguous" as const };
    };
    let current = await this.state();
    if (
      current === undefined ||
      !current.reachable ||
      current.workingSet === "unknown"
    )
      return result("ambiguous");
    if (current.workingSet === "pending") {
      const beforeCommit = await discover("before_commit");
      if (
        beforeCommit.status !== "observed" ||
        !this.matchesCheckpointBaseline(beforeCommit, baseline)
      )
        return result("ambiguous");
      const commit = await this.call({ kind: "commit" });
      if (commit?.kind !== "commit" || commit.value !== "applied")
        return result(
          commit?.kind === "commit" && commit.value === "unavailable"
            ? "unavailable"
            : "ambiguous",
        );
      const afterCommit = await discover("after_commit");
      if (
        afterCommit.status !== "observed" ||
        !this.matchesCheckpointBaseline(afterCommit, baseline)
      )
        return result("ambiguous");
      current = await this.state();
    }
    if (
      current === undefined ||
      !current.reachable ||
      current.workingSet !== "clean" ||
      !head(current.head)
    )
      return result("ambiguous");
    if (this.mode === "local-only") return result("applied");
    const beforePush = await discover("before_push");
    if (
      beforePush.status !== "observed" ||
      !this.matchesCheckpointBaseline(beforePush, baseline)
    )
      return result("ambiguous");
    const push = await this.call({ kind: "push" });
    if (push?.kind !== "push") return result("ambiguous");
    if (push.value === "conflict") return result("conflict");
    if (push.value !== "applied") return result(push.value);
    const afterPush = await discover("after_push");
    const final = await this.state();
    return afterPush.status === "observed" &&
      afterPush.baseHead === baseline.head &&
      final !== undefined &&
      final.reachable &&
      final.workingSet === "clean" &&
      head(final.head) &&
      final.remoteHead === final.head &&
      afterPush.head === final.head &&
      afterPush.remoteHead === final.head
      ? result("applied")
      : result("ambiguous");
  }

  /** Commit state and sync it without force; discovery brackets commit/push. */
  private async durableCheckpoint(
    batch?: MutationBatch,
    baseline?: Readonly<{ head: string; remoteHead?: string }>,
  ): Promise<EmbeddedResult> {
    const initial = await this.state();
    if (initial === undefined || !initial.reachable)
      return result("unavailable");
    if (initial.workingSet === "unknown") return result("ambiguous");
    let committedHead: string | undefined;
    if (initial.workingSet === "pending") {
      const beforeCommit =
        batch === undefined
          ? undefined
          : await this.discover("before_commit", batch);
      if (
        beforeCommit !== undefined &&
        (beforeCommit.status !== "observed" ||
          (baseline !== undefined &&
            !this.matchesCheckpointBaseline(beforeCommit, baseline)))
      )
        return result(
          beforeCommit.status === "ambiguous" ? "ambiguous" : "blocked",
        );
      const commit = await this.call({ kind: "commit" });
      if (commit?.kind !== "commit") return result("ambiguous");
      if (commit.value !== "applied")
        return result(
          commit.value === "unavailable" ? "ambiguous" : commit.value,
        );
      const afterCommit =
        batch === undefined
          ? undefined
          : await this.discover("after_commit", batch);
      if (
        afterCommit !== undefined &&
        (afterCommit.status !== "observed" ||
          afterCommit.head === undefined ||
          (baseline !== undefined &&
            !this.matchesCheckpointBaseline(afterCommit, baseline)))
      )
        return result("ambiguous");
      committedHead = afterCommit?.head;
    }
    const clean = await this.state();
    if (clean === undefined || !clean.reachable) return result("unavailable");
    if (
      clean.workingSet !== "clean" ||
      clean.head === undefined ||
      (committedHead !== undefined && clean.head !== committedHead)
    )
      return result("blocked");
    if (this.mode === "local-only") return result("applied");
    const beforePush =
      batch === undefined
        ? undefined
        : await this.discover("before_push", batch);
    if (
      beforePush !== undefined &&
      (beforePush.status !== "observed" ||
        (baseline !== undefined &&
          !this.matchesCheckpointBaseline(beforePush, baseline)))
    )
      return result("ambiguous");
    const push = await this.call({ kind: "push" });
    if (push?.kind !== "push") return result("ambiguous");
    if (push.value === "conflict") return result("conflict");
    if (push.value !== "applied") return result(push.value);
    const afterPush =
      batch === undefined
        ? undefined
        : await this.discover("after_push", batch);
    if (
      afterPush !== undefined &&
      (afterPush.status !== "observed" ||
        afterPush.head === undefined ||
        afterPush.remoteHead === undefined)
    )
      return result("ambiguous");
    const synced = await this.state();
    if (batch === undefined)
      return synced !== undefined &&
        synced.reachable &&
        synced.workingSet === "clean" &&
        synced.head !== undefined &&
        synced.remoteHead === synced.head
        ? result("applied")
        : result("ambiguous");
    return synced !== undefined &&
      synced.reachable &&
      synced.workingSet === "clean" &&
      synced.head !== undefined &&
      synced.remoteHead !== undefined &&
      synced.remoteHead === synced.head &&
      (afterPush === undefined ||
        (afterPush.head === synced.head &&
          afterPush.remoteHead === synced.head))
      ? result("applied")
      : result("ambiguous");
  }

  private async state(): Promise<EmbeddedState | undefined> {
    const response = await this.call({ kind: "state" });
    return response?.kind === "state" ? response.value : undefined;
  }

  private checkpointBaseline(
    state: EmbeddedState | undefined,
  ): Readonly<{ head: string; remoteHead?: string }> | undefined {
    if (state === undefined || !state.reachable || !head(state.head))
      return undefined;
    if (this.mode === "local-only") return { head: state.head };
    return head(state.remoteHead)
      ? { head: state.head, remoteHead: state.remoteHead }
      : undefined;
  }

  private matchesCheckpointBaseline(
    discovery: CrashDiscovery,
    baseline: Readonly<{ head: string; remoteHead?: string }>,
  ): boolean {
    return (
      discovery.baseHead === baseline.head &&
      (this.mode === "local-only"
        ? baseline.remoteHead === undefined
        : baseline.remoteHead !== undefined &&
          discovery.remoteHead === baseline.remoteHead)
    );
  }

  private validWorkerBaseline(input: unknown): input is WorkerTrackerBaseline {
    const baseline = object(input);
    if (
      baseline === undefined ||
      Object.keys(baseline).some(
        (key) => !["head", "remoteHead", "slot", "workingSet"].includes(key),
      ) ||
      baseline.workingSet !== "clean" ||
      (baseline.head !== undefined && !head(baseline.head)) ||
      (baseline.remoteHead !== undefined && !head(baseline.remoteHead))
    )
      return false;
    const slot = validateMergeSlotObservation(
      baseline.slot,
      this.prefix,
      this.scope,
    );
    if (
      !slot.ok ||
      slot.value.status !== "acquired" ||
      slot.value.actor !== this.holder ||
      slot.value.holder !== this.holder
    )
      return false;
    return this.mode === "git-sync"
      ? baseline.head !== undefined &&
          baseline.remoteHead !== undefined &&
          baseline.head === baseline.remoteHead
      : baseline.remoteHead === undefined;
  }

  private validAcquisitionAuthority(
    authority: unknown,
  ): authority is EmbeddedAcquisitionAuthority | undefined {
    if (authority === undefined) return true;
    const input = object(authority);
    if (
      input === undefined ||
      Object.keys(input).some(
        (key) =>
          key !== "knownHolder" &&
          key !== "continuation" &&
          key !== "release" &&
          key !== "transition",
      ) ||
      (input.knownHolder !== undefined && !holder(input.knownHolder))
    )
      return false;
    if (input.release !== undefined) {
      // The generic decision will consume this exact readback only while the
      // slot is available; accepting a malformed one would permit a takeover.
      const release = object(input.release);
      if (
        release === undefined ||
        Object.keys(release).some(
          (key) => key !== "holder" && key !== "readback",
        ) ||
        input.knownHolder === undefined ||
        release.holder !== input.knownHolder ||
        !validateMergeSlotObservation(release.readback, this.prefix, this.scope)
          .ok ||
        release.readback === undefined
      )
        return false;
    }
    if (
      input.transition !== undefined &&
      !validateSlotTransitionIntent(
        input.transition,
        this.prefix,
        this.scope,
        this.mode,
        this.holder,
      )
    )
      return false;
    if (input.continuation === undefined) return true;
    const continuation = object(input.continuation);
    if (
      continuation === undefined ||
      Object.keys(continuation).some(
        (key) =>
          key !== "after" &&
          key !== "before" &&
          key !== "nextHolder" &&
          key !== "previousHolder",
      ) ||
      !holder(continuation.nextHolder) ||
      !holder(continuation.previousHolder) ||
      input.knownHolder !== continuation.previousHolder
    )
      return false;
    const before = validateMergeSlotObservation(
      continuation.before,
      this.prefix,
      this.scope,
    );
    const after = validateMergeSlotObservation(
      continuation.after,
      this.prefix,
      this.scope,
    );
    return (
      before.ok &&
      after.ok &&
      before.value.status === "acquired" &&
      before.value.holder === continuation.previousHolder &&
      before.value.actor === continuation.previousHolder &&
      after.value.status === "acquired" &&
      after.value.holder === continuation.nextHolder &&
      after.value.actor === continuation.nextHolder
    );
  }

  private validAcquisitionPlanningAuthority(
    authority: unknown,
  ): authority is EmbeddedAcquisitionPlanningAuthority | undefined {
    if (authority === undefined) return true;
    const input = object(authority);
    if (
      input === undefined ||
      Object.keys(input).some(
        (key) =>
          key !== "knownHolder" && key !== "continuation" && key !== "release",
      )
    )
      return false;
    return this.validAcquisitionAuthority(input);
  }

  private validReleaseAuthority(
    authority: unknown,
  ): authority is EmbeddedReleaseAuthority | undefined {
    if (authority === undefined) return true;
    const input = object(authority);
    return (
      input !== undefined &&
      Object.keys(input).length === 1 &&
      Object.keys(input)[0] === "transition" &&
      input.transition !== undefined &&
      validateSlotTransitionIntent(
        input.transition,
        this.prefix,
        this.scope,
        this.mode,
        this.holder,
      )
    );
  }

  private async inspectCarryPredecessor(
    predecessorRootIssueId: string,
    currentRun: RepositoryRun,
  ): Promise<
    | Readonly<{
        status: "planned";
        value: ProvenanceCarryProjectionPlan;
        claims: unknown;
      }>
    | Readonly<{
        status: "blocked";
        reason: CarryRefusalReason;
      }>
    | Readonly<{ status: "unavailable" }>
  > {
    if (
      !this.usable ||
      this.rootIssueId === undefined ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(predecessorRootIssueId)
    )
      return { status: "unavailable" };
    const response = await this.call({
      kind: "carry_read",
      predecessorRootIssueId,
    });
    if (response?.kind !== "carry_read") return { status: "unavailable" };
    if (response.value.status !== "observed")
      return response.value.status === "not_found"
        ? { reason: "not_found", status: "blocked" }
        : { status: "unavailable" };
    const root = validateRootProjection(response.value.root);
    if (!root.ok) return { reason: "projection_invalid", status: "blocked" };
    const planned = planProvenanceCarryFromProjection(
      predecessorRootIssueId,
      this.rootIssueId,
      currentRun,
      root.value,
    );
    if (planned.status !== "planned")
      return { reason: planned.reason, status: "blocked" };
    if (!this.validCarryClaimsBoundary(response.value.claims))
      return { reason: "projection_invalid", status: "blocked" };
    return {
      claims: response.value.claims,
      status: "planned",
      value: planned.value,
    };
  }

  private validCarryClaimsBoundary(value: unknown): boolean {
    const claims = object(value);
    if (claims === undefined || Object.keys(claims).length > 1) return false;
    const entry = Object.entries(claims)[0];
    if (entry === undefined) return true;
    const [digest, record] = entry;
    const parsed = validate<ProvenanceCarryClaimRecord>(
      ProvenanceCarryClaimRecordSchema,
      record,
    );
    return (
      /^[0-9a-f]{64}$/u.test(digest) &&
      parsed.ok &&
      parsed.value !== undefined &&
      parsed.value.exportId === `sce:carry:${digest}` &&
      Buffer.byteLength(canonicalJson(parsed.value as unknown as JsonValue)) <=
        4_096
    );
  }

  private carryPlanMatchesEffect(
    value: ProvenanceCarryProjectionPlan,
    effect: CarryEffect,
    run: RepositoryRun,
  ): boolean {
    const plan = value.plan;
    return (
      plan.exportId === effect.params.exportId &&
      plan.predecessorFinalRevision ===
        effect.params.predecessorFinalRevision &&
      plan.predecessorJournalCheckpointCommitment ===
        effect.params.predecessorJournalCheckpointCommitment &&
      plan.predecessorRootAggregateCommitment ===
        effect.params.predecessorRootAggregateCommitment &&
      plan.predecessorRunId === effect.params.predecessorRunId &&
      plan.predecessorWaveId === effect.params.predecessorWaveId &&
      plan.snapshotCommitment === effect.params.snapshotCommitment &&
      effect.params.claimToken === effect.idempotencyKey &&
      effect.params.currentRunId === run.controller.runId &&
      run.controller.state === "acquired" &&
      run.controller.holder === this.holder &&
      this.holder ===
        `${run.controller.runId}/${run.controller.incarnationId}` &&
      effect.params.storeIdentity === run.storeIdentity &&
      effect.params.storeIdentity === this.scope.beadsStoreIdentity &&
      effect.params.repositoryIdentity === run.repositoryIdentity &&
      effect.params.repositoryIdentity === this.scope.gitRepositoryIdentity &&
      effect.params.integrationBranch === run.integrationBranch &&
      effect.params.integrationBranch === this.scope.integrationBranch
    );
  }

  private carryClaimRecord(effect: CarryEffect): ProvenanceCarryClaimRecord {
    return {
      claimRevision: 1,
      claimantRunId: effect.params.currentRunId,
      claimToken: effect.params.claimToken,
      exportId: effect.params.exportId,
      predecessorRootBeadId: effect.params.predecessorRootBeadId,
      predecessorRunId: effect.params.predecessorRunId,
      predecessorWaveId: effect.params.predecessorWaveId,
      schema: "sce.provenance-carry-claim",
      snapshotCommitment: effect.params.snapshotCommitment,
      version: 1,
    };
  }

  private carryCheckpointIntent(effect: CarryEffect): CarryCheckpointIntent {
    return {
      expectedAggregateCommitment:
        effect.params.predecessorRootAggregateCommitment,
      exportDigest: effect.params.exportId.slice("sce:carry:".length),
      predecessorRootIssueId: effect.params.predecessorRootBeadId,
      record: this.carryClaimRecord(effect),
    };
  }

  /**
   * Proves and finishes only this journaled carry claim after a lost process
   * result. A local singleton is not durable evidence: it may still be an
   * uncommitted Dolt working-set change or a commit that has not reached the
   * configured git-sync remote.
   */
  private async reconcileDurableCarryCheckpoint(
    intent: CarryCheckpointIntent,
  ): Promise<EmbeddedResult> {
    const slot = await this.slot("check");
    if (
      slot?.status !== "acquired" ||
      slot.actor !== this.holder ||
      slot.holder !== this.holder
    )
      return result("ambiguous");
    const current = await this.state();
    if (
      current === undefined ||
      !current.reachable ||
      current.workingSet === "unknown" ||
      !head(current.head)
    )
      return result("ambiguous");
    if (current.workingSet === "pending") {
      const baseline = this.checkpointBaseline(current);
      return baseline === undefined
        ? result("ambiguous")
        : this.durableCarryCheckpoint(intent, baseline);
    }
    if (current.workingSet !== "clean") return result("ambiguous");
    const discover = async (point: CrashPoint) => {
      const response = await this.call({
        kind: "carry_discover",
        point,
        intent,
      });
      return response?.kind === "carry_discover"
        ? response.value
        : { status: "ambiguous" as const };
    };
    if (this.mode === "local-only") {
      const committed = await discover("after_commit");
      const final = await this.state();
      return committed.status === "observed" &&
        head(committed.baseHead) &&
        committed.head === current.head &&
        final !== undefined &&
        final.reachable &&
        final.workingSet === "clean" &&
        final.head === current.head
        ? result("applied")
        : result("ambiguous");
    }
    if (!head(current.remoteHead)) return result("ambiguous");
    if (current.head !== current.remoteHead) {
      const local = await discover("before_push");
      if (
        local.status !== "observed" ||
        !head(local.baseHead) ||
        local.head !== current.head ||
        local.remoteHead !== current.remoteHead
      )
        return result("ambiguous");
      return this.durableCarryCheckpoint(intent, {
        head: local.baseHead,
        remoteHead: current.remoteHead,
      });
    }
    const pushed = await discover("after_push");
    const final = await this.state();
    return pushed.status === "observed" &&
      head(pushed.baseHead) &&
      pushed.head === current.head &&
      pushed.remoteHead === current.head &&
      final !== undefined &&
      final.reachable &&
      final.workingSet === "clean" &&
      final.head === current.head &&
      final.remoteHead === current.head
      ? result("applied")
      : result("ambiguous");
  }

  /** A competing claim is evidence only after its exact sibling-only delta is durable. */
  private async competitorCarryIsDurable(
    claimsValue: unknown,
    effect: CarryEffect,
  ): Promise<boolean> {
    const claims = object(claimsValue);
    const candidate =
      claims === undefined ? undefined : Object.values(claims)[0];
    const parsed = validate<ProvenanceCarryClaimRecord>(
      ProvenanceCarryClaimRecordSchema,
      candidate,
    );
    if (!parsed.ok || parsed.value === undefined) return false;
    const current = await this.state();
    if (
      current === undefined ||
      !current.reachable ||
      current.workingSet !== "clean" ||
      !head(current.head) ||
      (this.mode === "git-sync" && current.remoteHead !== current.head)
    )
      return false;
    const intent: CarryCheckpointIntent = {
      ...this.carryCheckpointIntent(effect),
      record: parsed.value,
    };
    const point: CrashPoint =
      this.mode === "local-only" ? "after_commit" : "after_push";
    const response = await this.call({ kind: "carry_discover", point, intent });
    const discovery =
      response?.kind === "carry_discover" ? response.value : undefined;
    return (
      discovery?.status === "observed" &&
      head(discovery.baseHead) &&
      discovery.baseHead !== current.head &&
      discovery.head === current.head &&
      (this.mode === "local-only" || discovery.remoteHead === current.head)
    );
  }

  private carryClaimRecordDigest(record: ProvenanceCarryClaimRecord): string {
    return sha256(
      canonicalJson({
        claimRecord: record,
        domain: "sce.provenance-carry-claim-record.v1",
      }),
    );
  }

  private predecessorRefusal(
    predecessorRootBeadId: string,
    reason: CarryRefusalReason,
  ): Extract<CarryObservationResult, { status: "predecessor_refused" }> {
    return {
      evidenceDigest: sha256(
        canonicalJson({
          domain: "sce.provenance-carry-predecessor-refusal.v1",
          predecessorRootBeadId,
          reason,
        }),
      ),
      predecessorRootBeadId,
      reason,
      status: "predecessor_refused",
    };
  }

  private classifyCarryClaims(
    value: unknown,
    planned: ProvenanceCarryProjectionPlan,
    effect: CarryEffect,
    requireClaim: boolean,
  ):
    | Readonly<{ status: "absent" }>
    | Readonly<{ status: "ambiguous" }>
    | Readonly<{ status: "observed"; result: CarryObservationResult }> {
    const claims = object(value);
    if (claims === undefined || Object.keys(claims).length > 1)
      return {
        result: this.predecessorRefusal(
          effect.params.predecessorRootBeadId,
          "projection_invalid",
        ),
        status: "observed",
      };
    const entry = Object.entries(claims)[0];
    if (entry === undefined)
      return { status: requireClaim ? "ambiguous" : "absent" };
    const [digest, candidate] = entry;
    const parsed = validate<ProvenanceCarryClaimRecord>(
      ProvenanceCarryClaimRecordSchema,
      candidate,
    );
    if (
      digest !== effect.params.exportId.slice("sce:carry:".length) ||
      !parsed.ok ||
      parsed.value === undefined ||
      parsed.value.exportId !== effect.params.exportId ||
      Buffer.byteLength(canonicalJson(parsed.value as unknown as JsonValue)) >
        4_096
    )
      return {
        result: this.predecessorRefusal(
          effect.params.predecessorRootBeadId,
          "projection_invalid",
        ),
        status: "observed",
      };
    const expected = this.carryClaimRecord(effect);
    const claimRecordDigest = this.carryClaimRecordDigest(parsed.value);
    const candidateClaimToken = deriveProvenanceCarryClaimKey(
      parsed.value.claimantRunId,
      effect.params.exportId,
      effect.params.predecessorRootBeadId,
    );
    if (
      parsed.value.exportId !== effect.params.exportId ||
      parsed.value.predecessorRootBeadId !==
        effect.params.predecessorRootBeadId ||
      parsed.value.predecessorRunId !== effect.params.predecessorRunId ||
      parsed.value.predecessorWaveId !== effect.params.predecessorWaveId ||
      parsed.value.snapshotCommitment !== effect.params.snapshotCommitment ||
      parsed.value.claimToken !== candidateClaimToken
    )
      return {
        result: this.predecessorRefusal(
          effect.params.predecessorRootBeadId,
          "projection_invalid",
        ),
        status: "observed",
      };
    if (!same(parsed.value, expected))
      return {
        result: {
          claimRecordDigest,
          claimRevision: 1,
          claimantRunId: parsed.value.claimantRunId,
          exportId: parsed.value.exportId,
          status: "already_claimed",
        },
        status: "observed",
      };
    return {
      result: {
        carry: {
          ...planned.carry,
          claimRecordDigest,
          claimRevision: 1,
        },
        status: "imported",
      },
      status: "observed",
    };
  }

  private async slot(
    action: "acquire" | "check" | "release",
    source?: "remote",
  ): Promise<MergeSlotObservation | undefined> {
    const response = await this.call({
      kind: "slot",
      action,
      actor: this.holder,
      ...(source === undefined ? {} : { source }),
    });
    if (response?.kind !== "slot") return undefined;
    const validated = validateMergeSlotObservation(
      response.value,
      this.prefix,
      this.scope,
    );
    return validated.ok ? validated.value : undefined;
  }

  private async readback(
    batch: MutationBatch,
  ): Promise<EmbeddedReadback | undefined> {
    const response = await this.call({ kind: "readback", batch });
    return response?.kind === "readback" ? response.value : undefined;
  }

  private async discover(point: CrashPoint, batch: MutationBatch) {
    const response = await this.call({
      kind: "discover",
      point,
      batch,
    });
    return response?.kind === "discover"
      ? response.value
      : { status: "ambiguous" as const };
  }

  private async call(
    request: Parameters<EmbeddedProcessPort["execute"]>[0],
  ): Promise<EmbeddedResponse | undefined> {
    try {
      return await this.process.execute(request);
    } catch {
      // Never carry subprocess exceptions (which can contain command text or
      // credentials) across the adapter boundary.
      return undefined;
    }
  }

  private storeFailure(code: EmbeddedResult["code"]) {
    switch (code) {
      case "stale":
      case "holder_mismatch":
      case "ambiguous":
      case "unavailable":
      case "quarantined":
        return { status: code } as const;
      default:
        return { status: "ambiguous" } as const;
    }
  }
}
