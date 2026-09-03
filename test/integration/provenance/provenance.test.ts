import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  discoverDetachedWorktree,
  nodeGitRunner,
} from "../../../src/adapters/git/index.js";
import { createProductionRecoveryEffectAdapter } from "../../../src/commands/production-recovery.js";
import {
  deriveIdempotencyKey,
  reduce,
  rehydrateEffect,
} from "../../../src/protocol/reducer.js";
import { projectProvenanceRecords } from "../../../src/protocol/provenance.js";
import type {
  KnowledgeContract,
  ProtocolEvent,
  RepositoryRun,
} from "../../../src/protocol/schemas.js";
import { HASH, event, run, transition, unit } from "../../protocol/fixtures.js";
import { git, provenanceFixture, type ProvenanceFixture } from "./fixture.js";

type Profile = "local-ff" | "remote-ff";

function adapterFor(fixture: ProvenanceFixture) {
  return createProductionRecoveryEffectAdapter({
    git: {
      repository: fixture.gitRepository,
      runner: nodeGitRunner,
      ...(fixture.remote === undefined ? {} : { remote: "origin" }),
    },
  });
}

/** Drive one knowledge unit to landed closure with the fixture's real OIDs. */
function landedKnowledgeRun(
  fixture: ProvenanceFixture,
  profile: Profile,
  contract: KnowledgeContract,
): RepositoryRun {
  const planned = unit("unit-1");
  const initial: RepositoryRun = {
    ...run([
      {
        ...planned,
        baseOid: fixture.baseOid,
        taskMetadata: {
          ...planned.taskMetadata!,
          materialisationTargets: [
            {
              destinationAlias: "partner-drive",
              destinationSubpath: "rendered/guidance",
              namingPolicy: "source-basename",
              sidecarRequired: true,
              sourcePattern: "knowledge/current/access-*.md",
            },
          ],
        },
      },
    ]),
    completionBoundary:
      profile === "local-ff" ? "local-integration" : "remote-integration",
    integrationProfile: profile,
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
  if (profile === "remote-ff") {
    step("publish_intent");
    observe("publish_observed", "publish", {
      publication: { kind: "push_branch", remoteHeadOid: landedOid },
    });
  }
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
  return state;
}

function gateIntent(
  state: RepositoryRun,
  type:
    | "materialisation_resolve_intent"
    | "provenance_commit_intent"
    | "verification_intent",
  kind: "materialisation_resolve" | "provenance_commit" | "verify",
  gateEntryId: string,
  fields: Record<string, unknown> = {},
): RepositoryRun {
  return transition(
    state,
    {
      eventId: `${kind}-${state.revision}`,
      expectedRevision: state.revision,
      gateEntryId,
      idempotencyKey: deriveIdempotencyKey(
        state,
        state.revision,
        null,
        kind,
        gateEntryId,
      ),
      ...fields,
      type,
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
}

/** Refuse and defer the unit target before resolution, then intend provenance. */
function provenanceIntent(
  fixture: ProvenanceFixture,
  profile: Profile,
  contract: KnowledgeContract,
): Readonly<{ state: RepositoryRun; effect: ProvenanceEffect }> {
  let state = landedKnowledgeRun(fixture, profile, contract);
  const resolution = state.gate!.targets[0]!.resolution!;
  state = gateIntent(
    state,
    "materialisation_resolve_intent",
    "materialisation_resolve",
    resolution.gateEntryId,
  );
  state = transition(
    state,
    {
      effectId: state.effectJournal.at(-1)!.effectId,
      effectKind: "materialisation_resolve",
      eventId: "resolve-refused",
      expectedRevision: state.revision,
      gateEntryId: resolution.gateEntryId,
      observationHash: HASH,
      result: {
        refusal: { code: "zero_matches", detailHash: HASH },
        status: "refused",
      },
      type: "materialisation_sources_observed",
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
  state = transition(
    state,
    {
      eventId: "resolve-deferred",
      expectedRevision: state.revision,
      followUpBeadId: "sce-follow-up",
      gateEntryId: resolution.gateEntryId,
      type: "gate_entry_deferred",
      unitId: null,
    } as ProtocolEvent,
    reduce,
  );
  return intendProvenance(state, "2026-09-03T12:00:01Z");
}

type ProvenanceEffect = Extract<
  NonNullable<ReturnType<typeof rehydrateEffect>>,
  { kind: "provenance_commit" }
>;
type VerifyEffect = Extract<
  NonNullable<ReturnType<typeof rehydrateEffect>>,
  { kind: "verify"; unitId: null }
>;

function intendProvenance(
  initial: RepositoryRun,
  timestamp: string,
): Readonly<{ state: RepositoryRun; effect: ProvenanceEffect }> {
  let state = initial;
  const provenance = state.gate!.provenance!;
  if (provenance.timestamp === undefined)
    state = transition(
      state,
      {
        eventId: `provenance-clock-${state.revision}`,
        expectedRevision: state.revision,
        gateEntryId: provenance.gateEntryId,
        timestamp,
        type: "gate_clock_observed",
        unitId: null,
      } as ProtocolEvent,
      reduce,
    );
  state = gateIntent(
    state,
    "provenance_commit_intent",
    "provenance_commit",
    provenance.gateEntryId,
  );
  const effect = rehydrateEffect(state, state.effectJournal.at(-1)!);
  assert.ok(effect !== undefined && effect.kind === "provenance_commit");
  return { effect: effect as ProvenanceEffect, state };
}

function observed(state: RepositoryRun, observation: ProtocolEvent) {
  return transition(state, observation, reduce);
}

async function executeProvenance(
  fixture: ProvenanceFixture,
  effect: ProvenanceEffect,
  state: RepositoryRun,
  operation: "execute" | "reconcile" = "execute",
) {
  const outcome = await adapterFor(fixture)[operation](effect, state);
  assert.equal(outcome.status, "observed", JSON.stringify(outcome));
  if (outcome.status !== "observed") throw new Error("unreachable");
  const observation = outcome.observation;
  assert.equal(observation.type, "provenance_commit_observed");
  if (observation.type !== "provenance_commit_observed")
    throw new Error("unreachable");
  return { observation, result: observation.result };
}

test("provenance commit lands deterministically, is discovered by key, and its records validate", async () => {
  const fixture = await provenanceFixture();
  try {
    const contract = fixture.contract();
    const { state, effect } = provenanceIntent(fixture, "local-ff", contract);
    const worktreePath = effect.params.worktreePath;
    assert.equal(
      worktreePath.startsWith(`${fixture.worktreeRoot}/sce-provenance-`),
      true,
    );

    const first = await executeProvenance(fixture, effect, state);
    assert.equal(first.result.status, "committed");
    if (first.result.status !== "committed") throw new Error("unreachable");
    const commitOid = first.result.commitOid;
    assert.equal(first.result.attemptedBaseOid, fixture.landedOid);
    assert.equal(git(fixture.repository, "rev-parse", "main"), commitOid);
    assert.equal(
      git(fixture.repository, "rev-parse", `${commitOid}^1`),
      fixture.landedOid,
    );
    assert.equal(
      git(fixture.repository, "rev-parse", `${commitOid}^{tree}`),
      first.result.treeOid,
    );
    const [author, email, date, committer] = git(
      fixture.repository,
      "log",
      "-1",
      "--format=%an%n%ae%n%ad%n%cn",
      "--date=raw",
      commitOid,
    ).split("\n");
    assert.equal(author, state.controller.holder);
    assert.equal(committer, state.controller.holder);
    assert.equal(email, "sce@noreply.invalid");
    assert.equal(date, `${Date.UTC(2026, 8, 3, 12, 0, 1) / 1_000} +0000`);
    assert.match(
      git(fixture.repository, "log", "-1", "--format=%B", commitOid),
      new RegExp(`SCE-Provenance-Key: ${effect.idempotencyKey}`, "u"),
    );
    const projection = projectProvenanceRecords(effect.params, "codex");
    assert.ok(projection.ok);
    for (const record of projection.records)
      assert.equal(
        git(fixture.repository, "show", `${commitOid}:${record.path}`) + "\n",
        record.bytes,
      );
    assert.match(
      git(fixture.repository, "show", `${commitOid}:generated/timeline.md`),
      /unit-1--/u,
    );
    const landed = observed(state, first.observation);
    assert.equal(landed.gate!.provenance!.status, "observed");
    assert.equal(landed.gate!.aggregateVerify?.status, "pending");

    // Re-execution from an absent worktree at the same journaled base and key
    // rebuilds the identical commit object.
    git(fixture.repository, "worktree", "remove", "--force", worktreePath);
    git(fixture.repository, "reset", "-q", "--hard", fixture.landedOid);
    const second = await executeProvenance(fixture, effect, state);
    assert.equal(second.result.status, "committed");
    if (second.result.status !== "committed") throw new Error("unreachable");
    assert.equal(second.result.commitOid, commitOid);
    assert.equal(git(fixture.repository, "rev-parse", "main"), commitOid);

    // Discovery by key observes the landed commit without any act.
    git(fixture.repository, "worktree", "remove", "--force", worktreePath);
    const discovered = await executeProvenance(
      fixture,
      effect,
      state,
      "reconcile",
    );
    assert.equal(discovered.result.status, "committed");
    if (discovered.result.status !== "committed")
      throw new Error("unreachable");
    assert.equal(discovered.result.commitOid, commitOid);
    assert.deepEqual(
      await discoverDetachedWorktree(nodeGitRunner, fixture.gitRepository, {
        path: worktreePath,
      }),
      { state: "absent" },
    );
    const again = await executeProvenance(fixture, effect, state);
    assert.equal(again.result.status, "committed");
  } finally {
    await fixture.cleanup();
  }
});

test("resume admits only a clean base or keyed worktree and refuses other states", async () => {
  const fixture = await provenanceFixture();
  try {
    const { state, effect } = provenanceIntent(
      fixture,
      "local-ff",
      fixture.contract(),
    );
    const worktreePath = effect.params.worktreePath;
    git(
      fixture.repository,
      "worktree",
      "add",
      "-q",
      "--detach",
      worktreePath,
      fixture.landedOid,
    );
    await writeFile(join(worktreePath, "stray.txt"), "dirty\n", "utf8");
    const dirty = await executeProvenance(fixture, effect, state);
    assert.deepEqual(dirty.result, {
      condition: "dirty_worktree",
      expectedBaseOid: fixture.landedOid,
      observedHeadOid: fixture.landedOid,
      reasonDigest: (dirty.result as { reasonDigest: string }).reasonDigest,
      status: "worktree_refused",
    });
    assert.equal(
      git(fixture.repository, "rev-parse", "main"),
      fixture.landedOid,
    );
    assert.equal(
      observed(state, dirty.observation).gate!.provenance!.status,
      "pending",
    );
    git(fixture.repository, "worktree", "remove", "--force", worktreePath);

    git(
      fixture.repository,
      "worktree",
      "add",
      "-q",
      "--detach",
      worktreePath,
      fixture.baseOid,
    );
    const foreign = await executeProvenance(fixture, effect, state);
    assert.equal(foreign.result.status, "worktree_refused");
    if (foreign.result.status !== "worktree_refused")
      throw new Error("unreachable");
    assert.equal(foreign.result.condition, "unexpected_head");
    assert.equal(foreign.result.observedHeadOid, fixture.baseOid);
    git(fixture.repository, "worktree", "remove", "--force", worktreePath);

    git(
      fixture.repository,
      "worktree",
      "add",
      "-q",
      "--detach",
      worktreePath,
      fixture.landedOid,
    );
    const clean = await executeProvenance(fixture, effect, state);
    assert.equal(clean.result.status, "committed");
    if (clean.result.status !== "committed") throw new Error("unreachable");
    const commitOid = clean.result.commitOid;

    // A preserved keyed worktree whose landing never happened resumes at the
    // reproducibility check and lands the same commit.
    git(fixture.repository, "reset", "-q", "--hard", fixture.landedOid);
    const resumed = await executeProvenance(fixture, effect, state);
    assert.equal(resumed.result.status, "committed");
    if (resumed.result.status !== "committed") throw new Error("unreachable");
    assert.equal(resumed.result.commitOid, commitOid);
    assert.equal(git(fixture.repository, "rev-parse", "main"), commitOid);
  } finally {
    await fixture.cleanup();
  }
});

test("base advance observes the new base and a rebound intent lands on it with a new key and path", async () => {
  const fixture = await provenanceFixture();
  try {
    const { state, effect } = provenanceIntent(
      fixture,
      "local-ff",
      fixture.contract(),
    );
    await writeFile(
      join(fixture.repository, "knowledge", "current", "note.md"),
      "---\ntitle: Note\n---\n\n# Note\n",
      "utf8",
    );
    git(fixture.repository, "add", "-A");
    git(fixture.repository, "commit", "-q", "-m", "someone else landed");
    const advanced = git(fixture.repository, "rev-parse", "main");
    const first = await executeProvenance(fixture, effect, state);
    assert.equal(first.result.status, "base_advanced");
    if (first.result.status !== "base_advanced") throw new Error("unreachable");
    assert.equal(first.result.advancedBaseOid, advanced);
    assert.equal(git(fixture.repository, "rev-parse", "main"), advanced);
    const attempted = first.result.attemptedCommitOid;

    const rebound = observed(state, first.observation);
    assert.equal(
      rebound.gate!.provenance!.lastRefusal?.code,
      "provenance_base_advanced",
    );
    const next = intendProvenance(rebound, "2026-09-03T12:00:01Z");
    assert.equal(next.effect.params.baseOid, advanced);
    assert.equal(next.effect.gateEntryId, effect.gateEntryId);
    assert.notEqual(next.effect.idempotencyKey, effect.idempotencyKey);
    assert.notEqual(
      next.effect.params.worktreePath,
      effect.params.worktreePath,
    );
    const second = await executeProvenance(fixture, next.effect, next.state);
    assert.equal(second.result.status, "committed");
    if (second.result.status !== "committed") throw new Error("unreachable");
    assert.notEqual(second.result.commitOid, attempted);
    assert.equal(
      git(fixture.repository, "rev-parse", `${second.result.commitOid}^1`),
      advanced,
    );
    assert.equal(
      git(fixture.repository, "rev-parse", "main"),
      second.result.commitOid,
    );
    assert.equal(
      observed(next.state, second.observation).gate!.provenance!.status,
      "observed",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("a failed reproducibility check refuses without moving a ref, preserves the worktree, and qualifies for deferral", async () => {
  const fixture = await provenanceFixture();
  try {
    const { state, effect } = provenanceIntent(
      fixture,
      "local-ff",
      fixture.contract({
        provenance: {
          ...fixture.contract().provenance,
          reproducibilityCommand: ["node", "-e", "process.exit(1)"],
        },
      }),
    );
    const refused = await executeProvenance(fixture, effect, state);
    assert.equal(refused.result.status, "reproducibility_failed");
    if (refused.result.status !== "reproducibility_failed")
      throw new Error("unreachable");
    assert.equal(
      git(fixture.repository, "rev-parse", "main"),
      fixture.landedOid,
    );
    assert.deepEqual(
      await discoverDetachedWorktree(nodeGitRunner, fixture.gitRepository, {
        path: effect.params.worktreePath,
      }),
      {
        clean: true,
        head: refused.result.attemptedCommitOid,
        state: "present",
      },
    );
    const pending = observed(state, refused.observation);
    assert.equal(pending.gate!.provenance!.status, "pending");
    const deferred = transition(
      pending,
      {
        eventId: "provenance-deferred",
        expectedRevision: pending.revision,
        followUpBeadId: "sce-repair",
        gateEntryId: effect.gateEntryId,
        type: "gate_entry_deferred",
        unitId: null,
      } as ProtocolEvent,
      reduce,
    );
    assert.equal(deferred.gate!.provenance!.status, "voided");
    assert.equal(
      deferred.gate!.provenance!.disposition,
      "deferred_by_controller",
    );
    assert.equal(deferred.gate!.aggregateVerifyPromise?.status, "voided");
  } finally {
    await fixture.cleanup();
  }
});

test("aggregate verify recreates the preserved worktree, runs the recorded argv vectors, and a failure qualifies for deferral", async () => {
  const fixture = await provenanceFixture();
  try {
    const contract = fixture.contract();
    const { state, effect } = provenanceIntent(fixture, "local-ff", contract);
    const committed = await executeProvenance(fixture, effect, state);
    assert.equal(committed.result.status, "committed");
    if (committed.result.status !== "committed") throw new Error("unreachable");
    let current = observed(state, committed.observation);
    const aggregate = current.gate!.aggregateVerify!;
    current = gateIntent(
      current,
      "verification_intent",
      "verify",
      aggregate.gateEntryId,
      {
        commands: contract.combinedVerificationCommands,
      },
    );
    const verify = rehydrateEffect(
      current,
      current.effectJournal.at(-1)!,
    ) as VerifyEffect;
    assert.equal(verify.kind, "verify");
    assert.equal(verify.unitId, null);
    assert.equal(verify.params.provenanceOid, committed.result.commitOid);
    assert.equal(verify.params.worktreePath, effect.params.worktreePath);
    git(
      fixture.repository,
      "worktree",
      "remove",
      "--force",
      effect.params.worktreePath,
    );
    const adapter = adapterFor(fixture);
    assert.deepEqual(await adapter.reconcile(verify, current), {
      status: "absent",
    });
    const outcome = await adapter.execute(verify, current);
    assert.equal(outcome.status, "observed", JSON.stringify(outcome));
    if (outcome.status !== "observed") throw new Error("unreachable");
    assert.equal(outcome.observation.type, "verification_observed");
    assert.deepEqual(
      await discoverDetachedWorktree(nodeGitRunner, fixture.gitRepository, {
        path: effect.params.worktreePath,
      }),
      { clean: true, head: committed.result.commitOid, state: "present" },
    );
    const green = observed(current, outcome.observation);
    assert.equal(green.gate!.aggregateVerify!.status, "observed");
    assert.equal(
      await readFile(
        join(effect.params.worktreePath, "generated", "timeline.md"),
        "utf8",
      ),
      git(
        fixture.repository,
        "show",
        `${committed.result.commitOid}:generated/timeline.md`,
      ) + "\n",
    );
  } finally {
    await fixture.cleanup();
  }

  const failing = await provenanceFixture();
  try {
    const contract = failing.contract({
      combinedVerificationCommands: [["node", "-e", "process.exit(3)"]],
    });
    const { state, effect } = provenanceIntent(failing, "local-ff", contract);
    const committed = await executeProvenance(failing, effect, state);
    assert.equal(committed.result.status, "committed");
    let current = observed(state, committed.observation);
    const aggregate = current.gate!.aggregateVerify!;
    current = gateIntent(
      current,
      "verification_intent",
      "verify",
      aggregate.gateEntryId,
      {
        commands: contract.combinedVerificationCommands,
      },
    );
    const verify = rehydrateEffect(
      current,
      current.effectJournal.at(-1)!,
    ) as VerifyEffect;
    const outcome = await adapterFor(failing).execute(verify, current);
    assert.equal(outcome.status, "observed");
    if (outcome.status !== "observed") throw new Error("unreachable");
    assert.equal(outcome.observation.type, "verification_failed");
    const red = observed(current, outcome.observation);
    assert.equal(
      red.gate!.aggregateVerify!.lastRefusal?.code,
      "verification_failed",
    );
    const deferred = transition(
      red,
      {
        eventId: "verify-deferred",
        expectedRevision: red.revision,
        followUpBeadId: "sce-repair",
        gateEntryId: aggregate.gateEntryId,
        type: "gate_entry_deferred",
        unitId: null,
      } as ProtocolEvent,
      reduce,
    );
    assert.equal(deferred.gate!.aggregateVerify!.status, "voided");
  } finally {
    await failing.cleanup();
  }
});

test("remote-ff lands through a non-force push and a rejected push observes the advanced base", async () => {
  const fixture = await provenanceFixture({ remote: true });
  try {
    const { state, effect } = provenanceIntent(
      fixture,
      "remote-ff",
      fixture.contract(),
    );
    const first = await executeProvenance(fixture, effect, state);
    assert.equal(first.result.status, "committed");
    if (first.result.status !== "committed") throw new Error("unreachable");
    assert.equal(
      git(fixture.remote!, "rev-parse", "main"),
      first.result.commitOid,
    );
    const discovered = await executeProvenance(
      fixture,
      effect,
      state,
      "reconcile",
    );
    assert.equal(discovered.result.status, "committed");

    // Someone else advances the remote base before a retry from scratch.
    git(
      fixture.repository,
      "worktree",
      "remove",
      "--force",
      effect.params.worktreePath,
    );
    git(fixture.repository, "reset", "-q", "--hard", fixture.landedOid);
    git(fixture.remote!, "update-ref", "refs/heads/main", fixture.landedOid);
    await writeFile(
      join(fixture.repository, "knowledge", "current", "note.md"),
      "---\ntitle: Note\n---\n\n# Note\n",
      "utf8",
    );
    git(fixture.repository, "add", "-A");
    git(fixture.repository, "commit", "-q", "-m", "someone else landed");
    const advanced = git(fixture.repository, "rev-parse", "main");
    git(fixture.repository, "push", "-q", "origin", "main");
    git(fixture.repository, "reset", "-q", "--hard", fixture.landedOid);
    const rejected = await executeProvenance(fixture, effect, state);
    assert.equal(rejected.result.status, "base_advanced");
    if (rejected.result.status !== "base_advanced")
      throw new Error("unreachable");
    assert.equal(rejected.result.advancedBaseOid, advanced);
    assert.equal(git(fixture.remote!, "rev-parse", "main"), advanced);
  } finally {
    await fixture.cleanup();
  }
});
