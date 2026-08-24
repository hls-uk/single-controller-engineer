import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import {
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
  type RunStorePort,
  type RunStoreResult,
  type SlotContinuationEvidence,
  decideControllerSlot,
  validateMergeSlotObservation,
  validateMutationBatch,
} from "../../fencing/index.js";
import type { PreflightEnvelope } from "../../preflight/index.js";

import {
  EMBEDDED_ADAPTER_VERSION,
  type CrashPoint,
  type EmbeddedMode,
  type EmbeddedProcessIdentity,
  type EmbeddedProcessPort,
  type EmbeddedReadback,
  type EmbeddedResponse,
  type EmbeddedResult,
  type EmbeddedState,
} from "./schemas.js";

export * from "./schemas.js";
export {
  PinnedBdEmbeddedProcess,
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

/** Controller-journal authority for a resume or same-run continuation. */
export type EmbeddedAcquisitionAuthority = Readonly<{
  continuation?: SlotContinuationEvidence;
  knownHolder: string;
}>;

export interface EmbeddedAdapterOptions {
  readonly holder: string;
  readonly mode: EmbeddedMode;
  readonly prefix: string;
  readonly preflight: PreflightEnvelope;
  readonly process: EmbeddedProcessPort;
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
): boolean {
  if (preflight.payload.status !== "ready") return false;
  const beads = preflight.payload.beads;
  const expectedDirectory = `${identity.storePath}/${identity.database}`;
  if (
    beads.mode !== "embedded" ||
    beads.database !== identity.database ||
    beads.prefix !== prefix ||
    identity.prefix !== prefix ||
    beads.storePath !== identity.storePath ||
    identity.databaseDirectory !== expectedDirectory
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
  private readonly scope: FencingScope;
  private readonly usable: boolean;

  public constructor(options: EmbeddedAdapterOptions) {
    this.holder = options.holder;
    this.mode = options.mode;
    this.prefix = options.prefix;
    this.process = options.process;
    this.scope = options.scope;
    this.usable = checkedPreflight(
      options.preflight,
      options.process.identity,
      options.mode,
      options.prefix,
    );
  }

  /** Acquires only the pre-existing built-in merge slot, with exact readback. */
  public async acquire(
    authority?: EmbeddedAcquisitionAuthority,
  ): Promise<EmbeddedResult> {
    if (!this.usable || !this.validAcquisitionAuthority(authority))
      return result("quarantined");
    const prepared = await this.prepareSharedState();
    if (prepared.code !== "applied") return prepared;
    const check = await this.slot("check");
    if (check === undefined) return result("quarantined");
    const decision = decideControllerSlot(
      this.prefix,
      this.scope,
      this.holder,
      authority?.knownHolder,
      check,
      authority?.continuation,
    );
    if (decision.kind === "blocked") return result("blocked");
    if (decision.kind === "quarantined") return result("quarantined");
    if (decision.kind === "resume") return result("applied");
    if (decision.kind === "continue") return result("applied");
    const acquired = await this.slot("acquire");
    if (acquired === undefined) return result("quarantined");
    if (
      acquired.status !== "acquired" ||
      acquired.actor !== this.holder ||
      acquired.holder !== this.holder
    )
      return result("blocked");
    return this.durableCheckpoint();
  }

  /** Releases only after a positive available readback from the built-in slot. */
  public async release(): Promise<EmbeddedResult> {
    if (!this.usable) return result("quarantined");
    const before = await this.slot("check");
    if (
      before === undefined ||
      before.status !== "acquired" ||
      before.actor !== this.holder ||
      before.holder !== this.holder
    )
      return result("blocked");
    const released = await this.slot("release");
    if (released === undefined) return result("quarantined");
    if (
      released.status !== "available" ||
      released.actor !== this.holder ||
      released.holder !== undefined
    )
      return result("blocked");
    return this.durableCheckpoint();
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
      const durable = await this.durableCheckpoint(batch);
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
    const prepared = await this.prepareSharedState();
    if (prepared.code !== "applied") return this.storeFailure(prepared.code);
    const slot = await this.slot("check");
    if (
      slot === undefined ||
      slot.status !== "acquired" ||
      slot.actor !== this.holder ||
      slot.holder !== this.holder
    )
      return { status: "holder_mismatch" };
    const mutation = await this.call({ kind: "mutation", batch });
    if (mutation?.kind !== "mutation") return { status: "ambiguous" };
    if (mutation.value !== "applied") {
      if (mutation.value !== "stale") return { status: mutation.value };
      // A prior process can have completed the exact CAS before crashing. The
      // controller journal supplies the same batch to a new process, which
      // proves that state rather than relying on a remembered write.
      const discovered = await this.discover("before_commit", batch);
      if (discovered.status !== "observed")
        return {
          status: discovered.status === "absent" ? "stale" : "ambiguous",
        };
    }
    const durable = await this.durableCheckpoint(batch);
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

  private async prepareSharedState(): Promise<EmbeddedResult> {
    const before = await this.state();
    if (before === undefined || !before.reachable) return result("unavailable");
    if (before.workingSet !== "clean") return result("blocked");
    if (this.mode === "local-only") return result("applied");
    const pull = await this.call({ kind: "pull" });
    if (pull?.kind !== "pull") return result("ambiguous");
    if (pull.value === "conflict") return result("conflict");
    if (pull.value !== "applied") return result(pull.value);
    const after = await this.state();
    return after === undefined || !after.reachable
      ? result("unavailable")
      : after.workingSet === "clean"
        ? result("applied")
        : result("blocked");
  }

  /** Commit state and sync it without force; discovery brackets commit/push. */
  private async durableCheckpoint(
    batch?: MutationBatch,
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
      if (beforeCommit !== undefined && beforeCommit.status !== "observed")
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
        (afterCommit.status !== "observed" || afterCommit.head === undefined)
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
    if (beforePush !== undefined && beforePush.status !== "observed")
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
      (afterPush === undefined || afterPush.head === synced.head) &&
      (afterPush === undefined || afterPush.remoteHead === afterPush.head)
      ? result("applied")
      : result("ambiguous");
  }

  private async state(): Promise<EmbeddedState | undefined> {
    const response = await this.call({ kind: "state" });
    return response?.kind === "state" ? response.value : undefined;
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
        (key) => key !== "knownHolder" && key !== "continuation",
      ) ||
      !holder(input.knownHolder)
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

  private async slot(
    action: "acquire" | "check" | "release",
  ): Promise<MergeSlotObservation | undefined> {
    const response = await this.call({
      kind: "slot",
      action,
      actor: this.holder,
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
