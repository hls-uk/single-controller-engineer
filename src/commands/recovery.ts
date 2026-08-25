/**
 * Crash-safe command coordinator.
 *
 * This is intentionally a composition root rather than a second reducer.  A
 * topology supplies authoritative projection loading/CAS plus an effect
 * adapter; this coordinator supplies the ordering which is otherwise very
 * easy for a CLI command to get wrong:
 *
 *   topology proof -> local operation lock -> exact load -> reconcile all
 *   durable effects -> persist intent -> act once -> persist observation.
 *
 * In particular `persistControllerAcquireIntent` is a distinct, narrowly
 * typed pre-ownership path.  Normal RunStore CAS is never used to bootstrap
 * ownership: its adapter is entitled to require an acquired merge slot.
 */
import {
  OperationLock,
  deriveChangedRowsCommitment,
  makeChildProjection,
  makeRootProjection,
  ChildProjectionSchema,
  FencingScopeSchema,
  RootProjectionSchema,
  validateChildProjection,
  validateRootProjection,
  withBatchCheckpoint,
  type ChildProjection,
  type FencingScope,
  type MutationBatch,
  type RootProjection,
  type RunStorePort,
  type RunStoreResult,
  RunStoreResultSchema,
} from "../fencing/index.js";
import { Type } from "@sinclair/typebox";
import { ambiguityRecoveryActions, legalActions } from "../protocol/actions.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical.js";
import { sha256 } from "../protocol/evidence.js";
import {
  deriveParamsHash,
  rehydrateEffect,
  reduce,
  runInvariantErrors,
  type ProtocolEffect,
} from "../protocol/reducer.js";
import {
  ProtocolEventSchema,
  RepositoryRunSchema,
  RuntimeEffectSchema,
  strictObject,
  validate,
  type EffectJournalEntry,
  type ProtocolEvent,
  type RepositoryRun,
  type RuntimeEffect,
  type SlotTransitionIntent,
} from "../protocol/schemas.js";

export type RecoveryFaultPoint =
  | "before_intent_persist"
  | "during_intent_persist"
  | "after_intent_persist"
  | "before_act"
  | "during_act"
  | "after_act"
  | "before_observation_persist"
  | "during_observation_persist"
  | "after_observation_persist";

/** Test seam only. It receives no credentials, argv, or mutable state. */
export type RecoveryFaultHook = (point: RecoveryFaultPoint) => void;

export type AuthoritativeRunReadback = Readonly<{
  children: readonly ChildProjection[];
  root: RootProjection;
}>;

/** Absence is positive evidence; every other non-observed result fails closed. */
export type AuthoritativeLoadResult =
  | Readonly<{ status: "observed"; value: AuthoritativeRunReadback }>
  | Readonly<{
      status:
        "absent" | "unavailable" | "ambiguous" | "corrupt" | "quarantined";
    }>;

/** A topology must load root and affected children from its authority. */
export interface AuthoritativeRunStore extends RunStorePort {
  load(): Promise<AuthoritativeLoadResult>;
}

/**
 * The only CAS permitted before normal controller ownership.  Implementors
 * prove expected root absence/revision, scope and available built-in slot in
 * the same authoritative operation, then persist/read back precisely the
 * controller_acquire intent projection.  It cannot write an active run.
 */
export interface PreOwnershipRunStore {
  persistControllerAcquireIntent(batch: MutationBatch): Promise<RunStoreResult>;
  /**
   * Authorized bootstrap only. The topology checks root/child absence and the
   * built-in slot's exact available readback in one transaction/commit before
   * creating this already-intended projection. It is discoverable by `load`
   * after a crash and is never a fallback for a partial projection.
   */
  createControllerAcquireIntent?(
    input: InitialControllerAcquire,
  ): Promise<RunStoreResult>;
}

export type InitialControllerAcquire = Readonly<{
  expected: Readonly<{
    children: "absent";
    holder: string;
    root: "absent";
    scope: FencingScope;
  }>;
  next: Readonly<{
    children: readonly ChildProjection[];
    root: RootProjection;
  }>;
  schema: "sce.recovery.initial-controller-acquire";
  version: 1;
}>;

/** Strict wire boundary for the one authorized absent-root mutation. */
export const InitialControllerAcquireSchema = strictObject({
  expected: strictObject({
    children: Type.Literal("absent"),
    holder: Type.String({
      minLength: 3,
      maxLength: 321,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$",
    }),
    root: Type.Literal("absent"),
    scope: FencingScopeSchema,
  }),
  next: strictObject({
    children: Type.Array(ChildProjectionSchema, { maxItems: 64 }),
    root: RootProjectionSchema,
  }),
  schema: Type.Literal("sce.recovery.initial-controller-acquire"),
  version: Type.Literal(1),
});

export type ReconcileResult =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "ambiguous"; observationHash?: string }>
  | Readonly<{
      status: "tool_request";
      toolRequest: unknown;
      /** This request is exposed only after its durable effect is ambiguous. */
      delivery?: "mark_ambiguous";
    }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "observed"; observation: ProtocolEvent }>;

export type ExecuteResult =
  | Readonly<{ status: "ambiguous"; observationHash?: string }>
  | Readonly<{
      status: "tool_request";
      toolRequest: unknown;
      /** This request is exposed only after its durable effect is ambiguous. */
      delivery?: "mark_ambiguous";
    }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "observed"; observation: ProtocolEvent }>;

/** Each adapter result is converted back through the reducer's strict event schema. */
export interface RecoveryEffectAdapter {
  /** Explicitly admits a non-Git effect after its intent is durably persisted. */
  canExecute?(effect: ProtocolEffect): boolean;
  /** Explicitly admits reconciliation without granting a blind retry. */
  canReconcile?(effect: ProtocolEffect): boolean;
  /** Parses a narrow host acknowledgement and creates its ProtocolEvent. */
  acknowledge?(
    acknowledgement: unknown,
    run: RepositoryRun,
  ): Promise<ExecuteResult>;
  execute(effect: ProtocolEffect, run: RepositoryRun): Promise<ExecuteResult>;
  reconcile(
    effect: ProtocolEffect,
    run: RepositoryRun,
  ): Promise<ReconcileResult>;
}

export type RecoveryTopologyProof = Readonly<{
  commonDir: string;
  /** Immutable expected controller holder, supplied by the command request. */
  holder: string;
  scope: FencingScope;
}>;

/**
 * Binds an authoritative, already-read aggregate to the live topology proof
 * before recovery can write a reconciliation, intent, or ambiguity record.
 */
export type LoadedRunValidation =
  Readonly<{ status: "ok" }> | Readonly<{ status: "blocked" | "unavailable" }>;

export type ControllerTransitionPlanResult =
  | Readonly<{ status: "planned"; transition: SlotTransitionIntent }>
  | Readonly<{
      status: "blocked" | "ambiguous" | "unavailable" | "quarantined";
    }>;

export interface RecoveryRunnerOptions {
  readonly adapter: RecoveryEffectAdapter;
  readonly fault?: RecoveryFaultHook;
  readonly nonce: string;
  readonly preOwnership: PreOwnershipRunStore;
  /** Strict, authority-approved aggregate used only when both rows are absent. */
  readonly initialRun?: RepositoryRun;
  /** Read-only topology planner used when a controller event omits authority. */
  readonly prepareControllerTransition?: (
    input: Readonly<{
      kind: "acquire" | "release";
      holder: string;
      run: RepositoryRun;
      scope: FencingScope;
    }>,
  ) => Promise<ControllerTransitionPlanResult>;
  /** Injectable only for deterministic coordinator tests; production uses OperationLock. */
  readonly acquireOperationLock?: (
    input: Readonly<{
      commonDir: string;
      holder: string;
      nonce: string;
      scope: FencingScope;
    }>,
  ) => Promise<RecoveryOperationLockAcquire>;
  /** Must perform topology-specific preflight before returning a scope. */
  readonly proveTopology: () => Promise<RecoveryTopologyProof | undefined>;
  readonly store: AuthoritativeRunStore;
  /**
   * Production binds the loaded aggregate to its already-verified repository
   * and topology. A refusal must happen before any ordinary persistence.
   */
  readonly validateLoadedRun?: (
    input: Readonly<{ proof: RecoveryTopologyProof; run: RepositoryRun }>,
  ) => LoadedRunValidation;
}

export type RecoveryOperationLockAcquire =
  | Readonly<{
      status: "acquired";
      lock: Readonly<{
        release(): Promise<{
          status:
            "released" | "holder_mismatch" | "quarantined" | "unavailable";
        }>;
      }>;
    }>
  | Readonly<{ status: "held" | "quarantined" | "unavailable" }>;

export type RecoveryOutcome =
  | Readonly<{
      status: "tool_request";
      revision: number;
      run: RepositoryRun;
      toolRequest: unknown;
    }>
  | Readonly<{
      status: "applied" | "reconciled" | "idle";
      revision: number;
      run: RepositoryRun;
    }>
  | Readonly<{
      status:
        | "blocked"
        | "ambiguous"
        | "corrupt"
        | "held"
        | "uninitialized"
        | "stale"
        | "unavailable"
        | "quarantined";
    }>;

/** A command may submit either a reducer event or a narrow host acknowledgement. */
export type RecoveryRequest =
  ProtocolEvent | Readonly<{ harnessAcknowledgement: unknown }>;

/**
 * Positive absence permits replay only for Phase-2 effects with adapter-level
 * idempotency/discovery. Everything else (reservations, verification,
 * terminal cleanup, and all harness work) remains a no-act blocked fact.
 */
const RECOVERABLE_EFFECT_KINDS = new Set([
  "controller_acquire",
  "controller_release",
  "branch_create",
  "worktree_create",
  "candidate_collect",
  "publish",
  "integrate",
] as const);

function isRecoverableEffect(effect: ProtocolEffect): boolean {
  if (
    !RECOVERABLE_EFFECT_KINDS.has(
      effect.kind as typeof RECOVERABLE_EFFECT_KINDS extends Set<infer T>
        ? T
        : never,
    )
  )
    return false;
  // Controller acts have no safe default: each topology must bind exact
  // before/after slot evidence into the durable effect parameters. This
  // catches legacy optional wire fields before either reconciliation or act.
  if (
    effect.kind === "controller_acquire" ||
    effect.kind === "controller_release"
  )
    return (
      "slotTransition" in effect.params &&
      effect.params.slotTransition !== undefined
    );
  return true;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function isRun(value: RepositoryRun | RecoveryOutcome): value is RepositoryRun {
  return "effectJournal" in value;
}

function effectFor(
  entry: EffectJournalEntry,
  run: RepositoryRun,
): ProtocolEffect | undefined {
  return rehydrateEffect(run, entry);
}

function validReadback(
  readback: AuthoritativeRunReadback | undefined,
  scope: FencingScope,
): RepositoryRun | undefined {
  if (readback === undefined) return undefined;
  const root = validateRootProjection(readback.root);
  if (!root.ok || !same(root.value.scope, scope)) return undefined;
  const expected = root.value.childRows;
  if (readback.children.length !== expected.length) return undefined;
  for (const row of expected) {
    const child = readback.children.find(
      (candidate) => candidate.unitId === row.unitId,
    );
    const parsed =
      child === undefined ? undefined : validateChildProjection(child);
    if (
      parsed === undefined ||
      !parsed.ok ||
      parsed.value.commitment !== row.commitment ||
      parsed.value.revision !== row.revision ||
      !same(parsed.value.unit, root.value.run.units[row.unitId]) ||
      parsed.value.holder !== root.value.holder ||
      !same(parsed.value.scope, scope)
    )
      return undefined;
  }
  return root.value.run;
}

function loadOutcome(
  status: Exclude<AuthoritativeLoadResult["status"], "observed">,
): RecoveryOutcome {
  return { status: status === "absent" ? "uninitialized" : status };
}

function batchFor(
  before: RootProjection,
  nextRun: RepositoryRun,
): MutationBatch | undefined {
  const nextBase = makeRootProjection(nextRun);
  const changedIds = Object.keys(nextRun.units)
    .filter((unitId) => !same(before.run.units[unitId], nextRun.units[unitId]))
    .sort();
  // Deletion is never silently represented as a normal transition batch.
  if (
    Object.keys(before.run.units).some(
      (unitId) => nextRun.units[unitId] === undefined,
    )
  )
    return undefined;
  const changedRows = changedIds.map((unitId) => {
    const prior = before.childRows.find((row) => row.unitId === unitId);
    const child = makeChildProjection(nextBase, unitId);
    if (prior === undefined || child === undefined) return undefined;
    return {
      expectedCommitment: prior.commitment,
      expectedRevision: prior.revision,
      nextCommitment: child.commitment,
      nextRevision: child.revision,
      unitId,
    };
  });
  if (changedRows.some((row) => row === undefined)) return undefined;
  const rows = changedRows as NonNullable<(typeof changedRows)[number]>[];
  const next = withBatchCheckpoint(nextBase, rows);
  const candidate = {
    changedRows: rows,
    checkpoint: {
      aggregateRevision: next.aggregateRevision,
      changedRowsCommitment: deriveChangedRowsCommitment(rows),
      rootCommitment: next.aggregateCommitment,
    },
    expectedAggregateCommitment: before.aggregateCommitment,
    expectedAggregateRevision: before.aggregateRevision,
    expectedChildren: rows.map((row) => ({
      expectedCommitment: row.expectedCommitment,
      expectedRevision: row.expectedRevision,
      unitId: row.unitId,
    })),
    expectedHolder: before.holder,
    holder: next.holder,
    next: {
      children: rows.map((row) => makeChildProjection(next, row.unitId)!),
      root: next,
    },
    schema: "sce.fencing.batch",
    scope: next.scope,
    version: 1,
  };
  return candidate as MutationBatch;
}

function isPreOwnershipAcquire(
  before: RepositoryRun,
  next: RepositoryRun,
): boolean {
  return (
    before.state === "initializing" &&
    before.controller.state === "unacquired" &&
    next.state === "initializing" &&
    next.controller.state === "acquire_intent" &&
    next.effectJournal.length === before.effectJournal.length + 1 &&
    next.effectJournal.at(-1)?.kind === "controller_acquire" &&
    next.effectJournal.at(-1)?.slotTransition !== undefined
  );
}

function isInitialAcquire(
  next: RootProjection,
  holder: string,
  scope: FencingScope,
): boolean {
  const run = next.run;
  return (
    next.holder === holder &&
    same(next.scope, scope) &&
    run.revision === 1 &&
    run.state === "initializing" &&
    run.controller.state === "acquire_intent" &&
    next.childRows.length === Object.keys(run.units).length &&
    run.effectJournal.length === 1 &&
    run.effectJournal[0]?.kind === "controller_acquire" &&
    run.effectJournal[0]?.status === "intended" &&
    run.effectJournal[0]?.slotTransition !== undefined
  );
}

function initialRequest(
  run: RepositoryRun,
  holder: string,
  scope: FencingScope,
): InitialControllerAcquire | undefined {
  const root = makeRootProjection(run);
  if (!isInitialAcquire(root, holder, scope)) return undefined;
  const candidate = {
    expected: { children: "absent", holder, root: "absent", scope },
    next: {
      children: Object.keys(run.units)
        .sort()
        .map((unitId) => makeChildProjection(root, unitId)!),
      root,
    },
    schema: "sce.recovery.initial-controller-acquire",
    version: 1,
  };
  const parsed = validate<InitialControllerAcquire>(
    InitialControllerAcquireSchema,
    candidate,
  );
  return parsed.ok && parsed.value !== undefined ? parsed.value : undefined;
}

function ambiguousEvent(
  run: RepositoryRun,
  entry: EffectJournalEntry,
  observationHash?: string,
): ProtocolEvent {
  return {
    effectId: entry.effectId,
    effectKind: entry.kind,
    eventId: `recover-${entry.effectId}`,
    expectedRevision: run.revision,
    ...(observationHash === undefined ? {} : { observationHash }),
    type: "effect_ambiguous",
    unitId: entry.unitId,
  };
}

function observationFor(
  run: RepositoryRun,
  entry: EffectJournalEntry,
  event: ProtocolEvent,
): ProtocolEvent | undefined {
  const parsed = validate<ProtocolEvent>(ProtocolEventSchema, event);
  if (!parsed.ok || parsed.value === undefined) return undefined;
  if (
    !("effectId" in parsed.value) ||
    parsed.value.effectId !== entry.effectId ||
    parsed.value.effectKind !== entry.kind
  )
    return undefined;
  return { ...parsed.value, expectedRevision: run.revision } as ProtocolEvent;
}

/** Build a coordinator which is usable by the CLI composition root and E2E fixtures. */
export function createRecoveryRunner(options: RecoveryRunnerOptions) {
  const fault = (point: RecoveryFaultPoint) => options.fault?.(point);

  async function preparedControllerEvent(
    event: ProtocolEvent,
    run: RepositoryRun,
    proof: RecoveryTopologyProof,
  ): Promise<
    | Readonly<{ ok: true; event: ProtocolEvent }>
    | Readonly<{ ok: false; outcome: RecoveryOutcome }>
  > {
    if (
      (event.type !== "controller_acquire_intent" &&
        event.type !== "controller_release_intent") ||
      event.slotTransition !== undefined
    )
      return { ok: true, event };
    if (options.prepareControllerTransition === undefined)
      return { ok: false, outcome: { status: "blocked" } };
    let result: ControllerTransitionPlanResult;
    try {
      result = await options.prepareControllerTransition({
        holder: proof.holder,
        kind:
          event.type === "controller_acquire_intent" ? "acquire" : "release",
        run,
        scope: proof.scope,
      });
    } catch {
      return { ok: false, outcome: { status: "ambiguous" } };
    }
    if (result.status !== "planned")
      return { ok: false, outcome: { status: result.status } };
    const candidate = { ...event, slotTransition: result.transition };
    const parsed = validate<ProtocolEvent>(ProtocolEventSchema, candidate);
    return parsed.ok && parsed.value !== undefined
      ? { ok: true, event: parsed.value }
      : { ok: false, outcome: { status: "corrupt" } };
  }

  async function persist(
    before: RootProjection,
    reduction: ReturnType<typeof reduce>,
    preOwnership = false,
  ): Promise<RepositoryRun | RecoveryOutcome> {
    if (!reduction.ok) return { status: "corrupt" };
    const batch = batchFor(before, reduction.nextState);
    if (batch === undefined) return { status: "quarantined" };
    fault("before_intent_persist");
    fault("during_intent_persist");
    const result = preOwnership
      ? await options.preOwnership.persistControllerAcquireIntent(batch)
      : await options.store.compareAndSet(batch);
    fault("after_intent_persist");
    const parsed = validate<RunStoreResult>(RunStoreResultSchema, result);
    if (!parsed.ok || parsed.value === undefined)
      return { status: "quarantined" };
    if (parsed.value.status !== "applied")
      return {
        status:
          parsed.value.status === "holder_mismatch"
            ? "blocked"
            : parsed.value.status,
      };
    if (
      parsed.value.affectedRowCount !== batch.changedRows.length + 1 ||
      !same(parsed.value.root, batch.next.root) ||
      !same(parsed.value.children, batch.next.children) ||
      !same(parsed.value.checkpoint, batch.checkpoint)
    )
      return { status: "quarantined" };
    const read = validReadback(
      { children: parsed.value.children, root: parsed.value.root },
      before.scope,
    );
    return read === undefined || !same(read, reduction.nextState)
      ? { status: "quarantined" }
      : read;
  }

  async function persistEvent(
    beforeRoot: RootProjection,
    run: RepositoryRun,
    event: ProtocolEvent,
    preOwnership = false,
  ): Promise<RepositoryRun | RecoveryOutcome> {
    return persist(beforeRoot, reduce(run, event), preOwnership);
  }

  async function reconcile(
    root: RootProjection,
    run: RepositoryRun,
  ): Promise<RepositoryRun | RecoveryOutcome> {
    let currentRoot = root;
    let current = run;
    for (const entry of current.effectJournal.filter(
      (value) => value.status === "intended" || value.status === "ambiguous",
    )) {
      const effect = effectFor(entry, current);
      if (effect === undefined) return { status: "blocked" };
      if (
        !isRecoverableEffect(effect) &&
        !options.adapter.canReconcile?.(effect)
      )
        return { status: "blocked" };
      const answer = await options.adapter.reconcile(effect, current);
      if (answer.status === "unavailable") return { status: "unavailable" };
      if (answer.status === "tool_request") {
        if (answer.delivery === "mark_ambiguous") {
          const delivered = await persistEvent(
            currentRoot,
            current,
            ambiguousEvent(current, entry),
          );
          if (!isRun(delivered)) return delivered;
          return {
            revision: delivered.revision,
            run: delivered,
            status: "tool_request",
            toolRequest: answer.toolRequest,
          };
        }
        return {
          revision: current.revision,
          run: current,
          status: "tool_request",
          toolRequest: answer.toolRequest,
        };
      }
      // A durable manual delivery is intentionally not reissued on resume.
      // Only an exact acknowledgement can settle its already-ambiguous entry.
      if (entry.status === "ambiguous" && answer.status === "ambiguous")
        return { status: "ambiguous" };
      let settledAnswer:
        | Exclude<
            ExecuteResult,
            { readonly status: "unavailable" | "tool_request" }
          >
        | ReconcileResult = answer;
      // Positive absence is the sole retry authority. The executable request
      // comes from the durable entry via rehydrateEffect, never fresh command
      // input. Ambiguous discovery is deliberately not retried.
      if (answer.status === "absent") {
        try {
          fault("before_act");
          fault("during_act");
          const acted = await options.adapter.execute(effect, current);
          settledAnswer =
            acted.status === "tool_request" ? { status: "ambiguous" } : acted;
          fault("after_act");
        } catch {
          settledAnswer = { status: "ambiguous" };
        }
        if (settledAnswer.status === "unavailable")
          return { status: "unavailable" };
      }
      const event =
        settledAnswer.status === "observed"
          ? observationFor(current, entry, settledAnswer.observation)
          : ambiguousEvent(
              current,
              entry,
              settledAnswer.status === "ambiguous"
                ? settledAnswer.observationHash
                : undefined,
            );
      if (event === undefined) return { status: "corrupt" };
      const persisted = await persistEvent(currentRoot, current, event);
      if (!isRun(persisted)) return persisted;
      current = persisted;
      currentRoot = makeRootProjection(current);
      if (settledAnswer.status !== "observed") return { status: "ambiguous" };
    }
    return current;
  }

  return async function recoverAndRun(
    requested?: RecoveryRequest,
  ): Promise<RecoveryOutcome> {
    const proof = await options.proveTopology();
    if (proof === undefined) return { status: "unavailable" };
    const lockResult = await (
      options.acquireOperationLock ?? OperationLock.acquire
    )({
      commonDir: proof.commonDir,
      holder: proof.holder,
      nonce: options.nonce,
      scope: proof.scope,
    });
    if (lockResult.status !== "acquired")
      return {
        status: lockResult.status === "held" ? "held" : lockResult.status,
      };
    try {
      let initialized = false;
      const loadedResult = await options.store.load();
      let loaded =
        loadedResult.status === "observed" ? loadedResult.value : undefined;
      if (
        loadedResult.status !== "observed" &&
        loadedResult.status !== "absent"
      )
        return loadOutcome(loadedResult.status);
      if (loadedResult.status === "absent") {
        // There is no ordinary CAS fallback for absent rows. Bootstrap uses a
        // separately-authorized atomic absence predicate and writes only the
        // first controller_acquire intent. A partial/unknown read never gets
        // here because `load` must distinguish it from positive absence.
        if (
          requested === undefined ||
          isHarnessAcknowledgementRequest(requested) ||
          options.initialRun === undefined ||
          options.preOwnership.createControllerAcquireIntent === undefined
        )
          return { status: "uninitialized" };
        const initial = validate<RepositoryRun>(
          RepositoryRunSchema,
          options.initialRun,
        );
        const first = validate<ProtocolEvent>(ProtocolEventSchema, requested);
        if (
          !initial.ok ||
          initial.value === undefined ||
          !first.ok ||
          first.value === undefined ||
          initial.value.controller.holder !== proof.holder ||
          initial.value.state !== "initializing" ||
          initial.value.controller.state !== "unacquired" ||
          !same(
            {
              beadsStoreIdentity: initial.value.storeIdentity,
              gitRepositoryIdentity: initial.value.repositoryIdentity,
              integrationBranch: initial.value.integrationBranch,
            },
            proof.scope,
          ) ||
          first.value.type !== "controller_acquire_intent" ||
          first.value.expectedRevision !== initial.value.revision
        )
          return { status: "corrupt" };
        const prepared = await preparedControllerEvent(
          first.value,
          initial.value,
          proof,
        );
        if (!prepared.ok) return prepared.outcome;
        const created = reduce(initial.value, prepared.event);
        if (
          !created.ok ||
          !isPreOwnershipAcquire(initial.value, created.nextState)
        )
          return { status: "corrupt" };
        const creation = initialRequest(
          created.nextState,
          proof.holder,
          proof.scope,
        );
        if (creation === undefined) return { status: "corrupt" };
        fault("before_intent_persist");
        fault("during_intent_persist");
        const result =
          await options.preOwnership.createControllerAcquireIntent(creation);
        fault("after_intent_persist");
        const parsedResult = validate<RunStoreResult>(
          RunStoreResultSchema,
          result,
        );
        if (!parsedResult.ok || parsedResult.value === undefined)
          return { status: "quarantined" };
        if (parsedResult.value.status !== "applied")
          return {
            status:
              parsedResult.value.status === "holder_mismatch"
                ? "blocked"
                : parsedResult.value.status,
          };
        if (
          parsedResult.value.affectedRowCount !==
            creation.next.children.length + 1 ||
          !same(parsedResult.value.root, creation.next.root) ||
          !same(parsedResult.value.children, creation.next.children) ||
          !same(parsedResult.value.checkpoint, creation.next.root.checkpoint)
        )
          return { status: "quarantined" };
        const createdRun = validReadback(
          {
            children: parsedResult.value.children,
            root: parsedResult.value.root,
          },
          proof.scope,
        );
        if (createdRun === undefined || !same(createdRun, created.nextState))
          return { status: "quarantined" };
        loaded = {
          children: parsedResult.value.children,
          root: parsedResult.value.root,
        };
        initialized = true;
        // The persisted intent is now reconciled/executed below. Do not issue
        // a second acquire-intent transition from the same CLI call.
        requested = undefined;
      }
      if (loaded === undefined) return { status: "corrupt" };
      // Parse the authoritative root before comparing it to the supplied
      // proof. This exposes no unvalidated data to the hook, while allowing a
      // production repository/scope mismatch to fail unavailable rather than
      // being mistaken for generic projection corruption.
      const loadedRoot = validateRootProjection(loaded.root);
      if (!loadedRoot.ok || loadedRoot.value === undefined)
        return { status: "corrupt" };
      let loadedRunValidation: LoadedRunValidation;
      try {
        loadedRunValidation = options.validateLoadedRun?.({
          proof,
          run: loadedRoot.value.run,
        }) ?? {
          status: "ok",
        };
      } catch {
        return { status: "unavailable" };
      }
      if (loadedRunValidation.status !== "ok")
        return {
          status:
            loadedRunValidation.status === "blocked"
              ? "blocked"
              : "unavailable",
        };
      const run = validReadback(loaded, proof.scope);
      if (run === undefined) return { status: "corrupt" };
      if (
        runInvariantErrors(run).length > 0 ||
        loaded.root.holder !== proof.holder ||
        run.controller.holder !== proof.holder
      )
        return { status: "corrupt" };
      const root = loaded!.root;
      // A host acknowledgement is already an exact readback for one durable
      // intent. Reconciliation must not first mark that same intent ambiguous
      // and thereby discard a valid manual-tool completion.
      const reconciled =
        requested !== undefined && isHarnessAcknowledgementRequest(requested)
          ? run
          : await reconcile(root, run);
      if (!isRun(reconciled)) return reconciled;
      if (requested === undefined)
        return {
          status: initialized ? "reconciled" : "idle",
          revision: reconciled.revision,
          run: reconciled,
        };
      if (isHarnessAcknowledgementRequest(requested)) {
        if (options.adapter.acknowledge === undefined)
          return { status: "blocked" };
        let acknowledged: ExecuteResult;
        try {
          acknowledged = await options.adapter.acknowledge(
            requested.harnessAcknowledgement,
            reconciled,
          );
        } catch {
          return { status: "ambiguous" };
        }
        if (acknowledged.status === "unavailable")
          return { status: "unavailable" };
        if (acknowledged.status === "tool_request")
          return {
            revision: reconciled.revision,
            run: reconciled,
            status: "tool_request",
            toolRequest: acknowledged.toolRequest,
          };
        if (acknowledged.status !== "observed") return { status: "blocked" };
        const acknowledgementObservation = acknowledged.observation;
        if (!("effectId" in acknowledgementObservation))
          return { status: "blocked" };
        const entry = reconciled.effectJournal.find(
          (candidate) =>
            candidate.effectId === acknowledgementObservation.effectId,
        );
        if (entry === undefined) return { status: "blocked" };
        const observed = observationFor(
          reconciled,
          entry,
          acknowledgementObservation,
        );
        if (observed === undefined) return { status: "corrupt" };
        const settled = await persistEvent(
          makeRootProjection(reconciled),
          reconciled,
          observed,
        );
        return isRun(settled)
          ? { status: "applied", revision: settled.revision, run: settled }
          : settled;
      }
      const event = validate<ProtocolEvent>(ProtocolEventSchema, requested);
      if (!event.ok || event.value === undefined) return { status: "corrupt" };
      if (event.value.expectedRevision !== reconciled.revision)
        return { status: "stale" };
      const prepared = await preparedControllerEvent(
        event.value,
        reconciled,
        proof,
      );
      if (!prepared.ok) return prepared.outcome;
      const reduction = reduce(reconciled, prepared.event);
      if (!reduction.ok) return { status: "blocked" };
      const emitted = reduction.effects[0];
      if (
        emitted !== undefined &&
        !isRecoverableEffect(emitted) &&
        !options.adapter.canExecute?.(emitted)
      )
        return { status: "blocked" };
      const preOwnership = isPreOwnershipAcquire(
        reconciled,
        reduction.nextState,
      );
      const intent = await persist(
        makeRootProjection(reconciled),
        reduction,
        preOwnership,
      );
      if (!isRun(intent)) return intent;
      const effect = emitted;
      if (effect === undefined) {
        return { status: "applied", revision: intent.revision, run: intent };
      }
      fault("before_act");
      let acted: ExecuteResult;
      try {
        fault("during_act");
        acted = await options.adapter.execute(effect, intent);
        fault("after_act");
      } catch {
        acted = { status: "ambiguous" };
      }
      const entry = intent.effectJournal.find(
        (candidate) => candidate.effectId === effect.effectId,
      );
      if (entry === undefined) return { status: "corrupt" };
      if (acted.status === "unavailable") return { status: "unavailable" };
      if (acted.status === "tool_request") {
        if (acted.delivery === "mark_ambiguous") {
          const deliveredEvent = ambiguousEvent(intent, entry);
          fault("before_observation_persist");
          fault("during_observation_persist");
          const delivered = await persistEvent(
            makeRootProjection(intent),
            intent,
            deliveredEvent,
          );
          fault("after_observation_persist");
          if (!isRun(delivered)) return delivered;
          return {
            revision: delivered.revision,
            run: delivered,
            status: "tool_request",
            toolRequest: acted.toolRequest,
          };
        }
        return {
          revision: intent.revision,
          run: intent,
          status: "tool_request",
          toolRequest: acted.toolRequest,
        };
      }
      const observed =
        acted.status === "observed"
          ? observationFor(intent, entry, acted.observation)
          : ambiguousEvent(intent, entry, acted.observationHash);
      if (observed === undefined) return { status: "corrupt" };
      fault("before_observation_persist");
      fault("during_observation_persist");
      const settled = await persistEvent(
        makeRootProjection(intent),
        intent,
        observed,
      );
      fault("after_observation_persist");
      if (!isRun(settled)) return settled;
      return acted.status === "observed"
        ? { status: "applied", revision: settled.revision, run: settled }
        : { status: "ambiguous" };
    } finally {
      const released = await lockResult.lock.release();
      // A mismatched local lease is evidence of a concurrent process. The
      // durable operation remains safe, but callers must not claim success.
      if (released.status !== "released")
        return {
          status:
            released.status === "holder_mismatch" ? "blocked" : released.status,
        };
    }
  };
}

function isHarnessAcknowledgementRequest(
  value: RecoveryRequest,
): value is Readonly<{ harnessAcknowledgement: unknown }> {
  return (
    value !== null &&
    typeof value === "object" &&
    "harnessAcknowledgement" in value &&
    Object.keys(value).length === 1
  );
}

/** Small, privacy-safe state view used by CLI composition. */
export function recoveryStatus(run: RepositoryRun) {
  return {
    ambiguities: ambiguityRecoveryActions(run),
    legalActions: legalActions(run),
    revision: run.revision,
    state: run.state,
  };
}

export function observationHash(value: JsonValue): string {
  return sha256(
    canonicalJson({ domain: "sce.recovery.observation.v1", value }),
  );
}
