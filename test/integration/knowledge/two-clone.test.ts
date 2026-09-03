import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { nodeGitRunner } from "../../../src/adapters/git/index.js";
import {
  createProductionRecoveryEffectAdapter,
  createProductionRecoveryRunner,
} from "../../../src/commands/production-recovery.js";
import type { AuthoritativeRunReadback } from "../../../src/commands/recovery.js";
import {
  makeChildProjection,
  makeRootProjection,
  type MutationBatch,
  type RunStoreResult,
} from "../../../src/fencing/index.js";
import {
  deriveIdempotencyKey,
  reduce,
  rehydrateEffect,
} from "../../../src/protocol/reducer.js";
import type {
  KnowledgeContract,
  ProtocolEvent,
  RepositoryRun,
  WaveTaskMetadata,
} from "../../../src/protocol/schemas.js";
import { HASH, event, run, transition, unit } from "../../protocol/fixtures.js";
import {
  adapterFor as materialiseAdapterFor,
  materialisationFixture,
} from "../materialise/fixture.js";
import {
  CHECKS,
  git,
  twoCloneFixture,
  type TwoCloneFixture,
} from "./fixture.js";

type ProvenanceEffect = Extract<
  NonNullable<ReturnType<typeof rehydrateEffect>>,
  { kind: "provenance_commit" }
>;

function readback(state: RepositoryRun): AuthoritativeRunReadback {
  const root = makeRootProjection(state);
  return {
    children: Object.keys(state.units)
      .sort()
      .map((id) => makeChildProjection(root, id)!),
    root,
  };
}

/** One embedded Beads store shared by two clones of the same domain repository. */
class SharedStore {
  public current: AuthoritativeRunReadback | undefined;
  public casCalls = 0;
  async load() {
    return this.current === undefined
      ? ({ status: "absent" } as const)
      : ({ status: "observed", value: this.current } as const);
  }
  async persistControllerAcquireIntent(batch: MutationBatch) {
    return await this.compareAndSet(batch);
  }
  async compareAndSet(batch: MutationBatch): Promise<RunStoreResult> {
    this.casCalls += 1;
    if (this.current === undefined) return { status: "stale" };
    if (this.current.root.holder !== batch.expectedHolder)
      return { status: "holder_mismatch" };
    if (
      this.current.root.aggregateRevision !== batch.expectedAggregateRevision ||
      this.current.root.aggregateCommitment !==
        batch.expectedAggregateCommitment
    )
      return { status: "stale" };
    this.current = { children: batch.next.children, root: batch.next.root };
    return {
      affectedRowCount: batch.changedRows.length + 1,
      checkpoint: batch.checkpoint,
      children: batch.next.children,
      root: batch.next.root,
      status: "applied",
    };
  }
}

function knowledgeTask(
  unitId: string,
  ownedPaths: readonly string[],
  independence: "proven" | "ambiguous" = "proven",
): WaveTaskMetadata {
  return {
    ...unit(unitId).taskMetadata!,
    acceptanceIds: [`${unitId}-ac`],
    independence,
    ownedPaths: [...ownedPaths],
    unitId,
  };
}

/** Land the fixture unit on a remote-ff knowledge run and intend provenance. */
function provenanceIntent(
  fixture: TwoCloneFixture,
  contract: KnowledgeContract,
): Readonly<{ state: RepositoryRun; effect: ProvenanceEffect }> {
  const planned = unit("unit-1");
  const initial: RepositoryRun = {
    ...run([{ ...planned, baseOid: fixture.baseOid }]),
    repositoryIdentity: fixture.gitRepository.identity,
  };
  let state = transition(
    { ...initial, wave: { id: "wave-0", unitIds: [] } },
    {
      eventId: "knowledge-wave",
      expectedRevision: 0,
      knowledgeContract: contract,
      tasks: [initial.units["unit-1"]!.taskMetadata!],
      type: "wave_planned",
      waveId: "knowledge-1",
    },
    reduce,
  );
  const step = (type: ProtocolEvent["type"], fields = {}) => {
    state = transition(state, event(state, type, fields), reduce);
  };
  const observe = (
    type: ProtocolEvent["type"],
    kind: string,
    fields: Record<string, unknown> = {},
  ) =>
    step(type, {
      effectId: `event-${state.revision}:${kind}`,
      effectKind: kind,
      observationHash: HASH,
      ...fields,
    });
  const { baseOid, landedOid, landedTreeOid } = fixture;
  step("reservation_intent", {
    reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
  });
  observe("reservation_observed", "reservation_acquire");
  step("branch_intent", { branchRef: "sce/unit-1" });
  observe("branch_observed", "branch_create", { branchRef: "sce/unit-1" });
  step("worktree_intent", { worktreePath: "/tmp/unit-1" });
  observe("worktree_observed", "worktree_create", {
    worktreePath: "/tmp/unit-1",
  });
  step("dispatch_intent");
  observe("dispatch_observed", "dispatch", {
    promptHash: HASH,
    requestedModel: "workhorse",
    returnedModel: "workhorse-1",
    sessionId: "worker-1",
  });
  step("collect_intent");
  observe("worker_collected", "worker_collect", {
    workerResult: { residualRisks: [], status: "completed", summary: "done" },
  });
  step("candidate_intent");
  observe("candidate_observed", "candidate_collect", {
    headOid: landedOid,
    treeOid: landedTreeOid,
  });
  step("verification_intent");
  observe("verification_observed", "verify", {
    baseOid,
    headOid: landedOid,
    treeOid: landedTreeOid,
  });
  step("reviewer_dispatch_intent");
  observe("reviewer_observed", "review_dispatch", {
    promptHash: HASH,
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    sessionId: "reviewer-approved",
  });
  step("review_collect_intent");
  observe("review_collected", "review_collect", {
    judgment: {
      aggregateRevision: state.revision,
      baseOid,
      decision: "approve",
      findings: [],
      headOid: landedOid,
      kind: "review_verdict",
      promptHash: HASH,
      rationale: "approved exact pair",
      requestedModel: "frontier",
      responseHash: HASH,
      returnedModel: "frontier-1",
      role: "reviewer",
      schemaVersion: 1,
      sessionId: "reviewer-approved",
      treeOid: landedTreeOid,
      unitId: "unit-1",
    },
  });
  step("publish_intent");
  observe("publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: landedOid },
  });
  step("integrate_intent");
  observe("integrate_observed", "integrate", {
    baseOid,
    controllerFencingToken: "fence-1",
    headOid: landedOid,
    integrationOid: landedOid,
    treeOid: landedTreeOid,
  });
  step("reservation_release_intent");
  observe("reservation_released", "reservation_release");
  const provenance = state.gate!.provenance!;
  state = transition(
    state,
    {
      eventId: "provenance-clock",
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      timestamp: "2026-09-03T12:00:01Z",
      type: "gate_clock_observed",
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
  state = transition(
    state,
    {
      eventId: `provenance-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId: provenance.gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        "provenance_commit",
        provenance.gateEntryId,
      ),
      type: "provenance_commit_intent",
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
  const effect = rehydrateEffect(state, state.effectJournal.at(-1)!);
  assert.ok(effect !== undefined && effect.kind === "provenance_commit");
  return { effect: effect as ProvenanceEffect, state };
}

function cloneAdapter(fixture: TwoCloneFixture, clone: "a" | "b") {
  return createProductionRecoveryEffectAdapter({
    git: {
      remote: "origin",
      repository:
        clone === "a" ? fixture.gitRepository : fixture.cloneB.gitRepository,
      runner: nodeGitRunner,
    },
  });
}

function check(name: string, root: string, ...args: string[]) {
  return spawnSync("node", [join(CHECKS, name), "--root", root, ...args], {
    encoding: "utf8",
  });
}

test("two clones of one domain share one run store: a foreign holder is refused before any mutation and a duplicate process is held", async () => {
  const fixture = await twoCloneFixture();
  try {
    const state = {
      ...run(),
      repositoryIdentity: fixture.gitRepository.identity,
    };
    const store = new SharedStore();
    store.current = readback(state);
    const scope = {
      beadsStoreIdentity: state.storeIdentity,
      gitRepositoryIdentity: fixture.gitRepository.identity,
      integrationBranch: state.integrationBranch,
    };
    const runnerFor = (
      clone: "a" | "b",
      holder: string,
      lock: "acquired" | "held" = "acquired",
    ) =>
      createProductionRecoveryRunner({
        acquireOperationLock: async () =>
          lock === "held"
            ? { status: "held" as const }
            : {
                lock: {
                  release: async () => ({ status: "released" as const }),
                },
                status: "acquired" as const,
              },
        git: {
          remote: "origin",
          repository:
            clone === "a"
              ? fixture.gitRepository
              : fixture.cloneB.gitRepository,
          runner: nodeGitRunner,
        },
        nonce: `contention-${clone}-${holder}`,
        preOwnership: store,
        proveTopology: async () => ({
          commonDir:
            clone === "a"
              ? fixture.gitRepository.commonDir
              : fixture.cloneB.gitRepository.commonDir,
          holder,
          scope,
        }),
        store,
      });
    const owner = await runnerFor("a", state.controller.holder)(undefined);
    assert.ok(
      owner.status === "idle" || owner.status === "reconciled",
      owner.status,
    );
    // Production composition fails closed on a foreign holder before any
    // store mutation; the run store belongs to the holder that acquired it.
    const foreign = await runnerFor("b", "run-2/incarnation-1")(undefined);
    assert.equal(foreign.status, "unavailable");
    assert.equal(store.casCalls, 0);
    assert.equal(store.current?.root.holder, state.controller.holder);
    const duplicate = await runnerFor(
      "b",
      state.controller.holder,
      "held",
    )(undefined);
    assert.equal(duplicate.status, "held");
    assert.equal(store.casCalls, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("task-card packing excludes overlapping owned paths and unproven independence deterministically", () => {
  const cards = [
    knowledgeTask("card-a", ["knowledge/current/access-guide.md"]),
    knowledgeTask("card-b", ["knowledge/current"]),
    knowledgeTask("card-c", ["knowledge/archive/access-guide-v0.md"]),
  ];
  const initial = {
    ...run(cards.map((card) => ({ ...unit(card.unitId), taskMetadata: card }))),
    wave: { id: "wave-0", unitIds: [] as string[] },
  };
  const packed = reduce(initial, {
    eventId: "packing",
    expectedRevision: 0,
    tasks: cards,
    type: "wave_planned",
    waveId: "wave-1",
  });
  assert.ok(packed.ok, packed.ok ? "" : packed.reason);
  assert.deepEqual(packed.nextState.wave.unitIds, ["card-a", "card-c"]);
  const unproven = [
    cards[0]!,
    knowledgeTask("card-c", ["knowledge/archive"], "ambiguous"),
  ];
  const singleton = reduce(
    {
      ...run(
        unproven.map((card) => ({ ...unit(card.unitId), taskMetadata: card })),
      ),
      wave: { id: "wave-0", unitIds: [] as string[] },
    },
    {
      eventId: "packing-ambiguous",
      expectedRevision: 0,
      tasks: unproven,
      type: "wave_planned",
      waveId: "wave-1",
    },
  );
  assert.ok(singleton.ok, singleton.ok ? "" : singleton.reason);
  assert.deepEqual(singleton.nextState.wave.unitIds, ["card-a"]);
});

test("boundary policy refuses a changed path outside the allowed roots and a forbidden marker", async () => {
  const fixture = await twoCloneFixture();
  try {
    const clean = check(
      "check-boundary.mjs",
      fixture.repository,
      "--changed-path",
      "knowledge/current/access-guide.md",
    );
    assert.equal(clean.status, 0, clean.stderr);
    const outside = check(
      "check-boundary.mjs",
      fixture.repository,
      "--changed-path",
      "events/forged.md",
    );
    assert.notEqual(outside.status, 0);
    assert.match(outside.stderr, /forbidden|outside allowed write roots/u);
    await writeFile(
      join(fixture.cloneB.repository, "knowledge", "current", "leak.md"),
      "---\ntitle: Leak\n---\n\n# Leak\n\nAUDIENCE: PRIVATE\n",
      "utf8",
    );
    const marker = check("check-boundary.mjs", fixture.cloneB.repository);
    assert.notEqual(marker.status, 0);
    assert.match(marker.stderr, /forbidden marker/u);
  } finally {
    await fixture.cleanup();
  }
});

test("a reproducibility failure on one clone lands nothing on the shared remote", async () => {
  const fixture = await twoCloneFixture();
  try {
    const { state, effect } = provenanceIntent(
      fixture,
      fixture.contract({
        provenance: {
          ...fixture.contract().provenance,
          reproducibilityCommand: ["node", "-e", "process.exit(2)"],
        },
      }),
    );
    const outcome = await cloneAdapter(fixture, "a").execute(effect, state);
    assert.equal(outcome.status, "observed");
    if (outcome.status !== "observed") throw new Error("unreachable");
    assert.equal(outcome.observation.type, "provenance_commit_observed");
    if (outcome.observation.type !== "provenance_commit_observed")
      throw new Error("unreachable");
    assert.equal(outcome.observation.result.status, "reproducibility_failed");
    assert.equal(git(fixture.remote, "rev-parse", "main"), fixture.landedOid);
    assert.equal(
      git(fixture.cloneB.repository, "rev-parse", "main"),
      fixture.landedOid,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("materialisation into a destination holding different bytes is ambiguous and overwrites nothing", async () => {
  const fixture = await materialisationFixture();
  try {
    const sidecarPath = join(
      fixture.destinationDirectory,
      fixture.effect.params.sidecarName,
    );
    await mkdir(fixture.destinationDirectory, { recursive: true });
    await writeFile(sidecarPath, "someone else's sidecar\n", "utf8");
    const result = await materialiseAdapterFor(fixture).materialise(
      fixture.effect,
    );
    assert.equal(result.status, "ambiguous");
    assert.equal(
      await readFile(sidecarPath, "utf8"),
      "someone else's sidecar\n",
    );
    await assert.rejects(
      readFile(
        join(fixture.destinationDirectory, fixture.effect.params.artifactName),
      ),
      { code: "ENOENT" },
    );
  } finally {
    await fixture.cleanup();
  }
});

test("a provenance commit landed from one clone is read back by key from the other clone without a second act", async () => {
  const fixture = await twoCloneFixture();
  try {
    const { state, effect } = provenanceIntent(fixture, fixture.contract());
    const landed = await cloneAdapter(fixture, "a").execute(effect, state);
    assert.equal(landed.status, "observed");
    if (landed.status !== "observed") throw new Error("unreachable");
    assert.equal(landed.observation.type, "provenance_commit_observed");
    if (landed.observation.type !== "provenance_commit_observed")
      throw new Error("unreachable");
    assert.equal(landed.observation.result.status, "committed");
    if (landed.observation.result.status !== "committed")
      throw new Error("unreachable");
    const commitOid = landed.observation.result.commitOid;
    assert.equal(git(fixture.remote, "rev-parse", "main"), commitOid);

    const discovered = await cloneAdapter(fixture, "b").reconcile(
      effect,
      state,
    );
    assert.equal(discovered.status, "observed", JSON.stringify(discovered));
    if (discovered.status !== "observed") throw new Error("unreachable");
    assert.equal(discovered.observation.type, "provenance_commit_observed");
    if (discovered.observation.type !== "provenance_commit_observed")
      throw new Error("unreachable");
    assert.deepEqual(discovered.observation.result, landed.observation.result);
    assert.equal(
      git(fixture.cloneB.repository, "rev-parse", "refs/remotes/origin/main"),
      commitOid,
    );
    assert.equal(
      git(fixture.cloneB.repository, "rev-parse", "main"),
      fixture.landedOid,
    );
    assert.equal(
      spawnSync("/usr/bin/git", ["worktree", "list", "--porcelain"], {
        cwd: fixture.cloneB.repository,
        encoding: "utf8",
      })
        .stdout.split("\n")
        .filter((line) => line.startsWith("worktree ")).length,
      1,
    );
    const applied = transition(state, discovered.observation, reduce);
    assert.equal(applied.gate!.provenance!.status, "observed");
    assert.equal(applied.gate!.provenance!.commitOid, commitOid);
  } finally {
    await fixture.cleanup();
  }
});
