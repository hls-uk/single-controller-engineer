import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { canonicalJson, type JsonValue } from "../../src/protocol/canonical.js";
import {
  decodeClosedUnitEvidence,
  deriveIdempotencyKey,
  reduce,
  rehydrateEffect,
} from "../../src/protocol/reducer.js";
import {
  deriveProvenanceRecordId,
  projectProvenanceRecords,
  provenanceCommitDate,
  provenanceCommitSubject,
  provenanceCommitTrailer,
  type ProvenanceCommitParams,
} from "../../src/protocol/provenance.js";
import type {
  KnowledgeContract,
  ProtocolEvent,
  RepositoryRun,
} from "../../src/protocol/schemas.js";
import {
  HASH,
  OID_A,
  OID_B,
  OID_C,
  event,
  run,
  transition,
} from "./fixtures.js";

const CHECKS = resolve(
  import.meta.dirname,
  "../../skills/single-controller-knowledge/references/manifest",
);

type KnowledgeChecks = Readonly<{
  assertSchema(
    schema: unknown,
    value: unknown,
    at: string,
    rootSchema: unknown,
  ): void;
  parseFrontmatter(path: string): Readonly<{
    data: Record<string, unknown>;
    body: string;
  }>;
  readJson(path: string): unknown;
}>;

async function knowledgeChecks(): Promise<KnowledgeChecks> {
  return (await import(
    pathToFileURL(join(CHECKS, "checks", "lib.mjs")).href
  )) as KnowledgeChecks;
}

function knowledgeContract(): KnowledgeContract {
  return {
    aliases: [
      {
        alias: "drive",
        canonicalRoot: "/mnt/knowledge-drive",
        markerFile: ".sce-drive",
        mountPolicy: "required",
        namespaceControl: "exclusive",
      },
    ],
    audience: "knowledge-audience",
    combinedVerificationCommands: [["npm", "test"]],
    domainScope: "knowledge.internal",
    gateTargets: [],
    humanDriver: "Knowledge Owner",
    projectId: "knowledge-project",
    provenance: {
      eventsDirectory: "knowledge/events",
      generatedDirectory: "knowledge/generated",
      recordFormatVersion: 1,
      reproducibilityCommand: ["npm", "run", "reproduce"],
      rollupGeneratorCommand: ["npm", "run", "rollup"],
    },
    provenanceWorktreeRoot: "/tmp/sce-provenance",
  };
}

/** The ordinary software landing trace, reused for knowledge and software runs. */
function landUnit(initial: RepositoryRun): RepositoryRun {
  let state = initial;
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
    headOid: OID_B,
    treeOid: OID_C,
  });
  step("verification_intent");
  observe("verification_observed", "verify", {
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
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
      baseOid: OID_A,
      decision: "approve",
      findings: [],
      headOid: OID_B,
      kind: "review_verdict",
      promptHash: HASH,
      rationale: "approved exact pair",
      requestedModel: "frontier",
      responseHash: HASH,
      returnedModel: "frontier-1",
      role: "reviewer",
      schemaVersion: 1,
      sessionId: "reviewer-approved",
      treeOid: OID_C,
      unitId: "unit-1",
    },
  });
  step("publish_intent");
  observe("publish_observed", "publish", {
    publication: { kind: "push_branch", remoteHeadOid: OID_B },
  });
  step("integrate_intent");
  observe("integrate_observed", "integrate", {
    baseOid: OID_A,
    controllerFencingToken: "fence-1",
    headOid: OID_B,
    integrationOid: OID_C,
    treeOid: OID_C,
  });
  step("reservation_release_intent");
  observe("reservation_released", "reservation_release");
  return state;
}

/** A knowledge wave whose one unit target is refused and deferred before resolution. */
function provenanceIntent(contract: KnowledgeContract): Readonly<{
  params: ProvenanceCommitParams;
  state: RepositoryRun;
}> {
  const initial = run();
  const task = {
    ...initial.units["unit-1"]!.taskMetadata!,
    materialisationTargets: [
      {
        destinationAlias: "drive",
        destinationSubpath: "published",
        namingPolicy: "source-basename" as const,
        sidecarRequired: true as const,
        sourcePattern: "docs/file*.md",
      },
    ],
    supersedes: ["earlier-record"],
  };
  let state = transition(
    { ...initial, wave: { id: "wave-0", unitIds: [] } },
    {
      eventId: "knowledge-wave",
      expectedRevision: 0,
      knowledgeContract: contract,
      tasks: [task],
      type: "wave_planned",
      waveId: "knowledge-1",
    },
    reduce,
  );
  state = landUnit(state);
  const resolution = state.gate!.targets[0]!.resolution!;
  const intent = (
    type: "materialisation_resolve_intent" | "provenance_commit_intent",
    kind: "materialisation_resolve" | "provenance_commit",
    gateEntryId: string,
  ) =>
    transition(
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
        type,
        unitId: null,
      } as ProtocolEvent,
      reduce,
    );
  state = intent(
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
  state = intent(
    "provenance_commit_intent",
    "provenance_commit",
    provenance.gateEntryId,
  );
  const effect = rehydrateEffect(state, state.effectJournal.at(-1)!);
  assert.ok(effect !== undefined && effect.kind === "provenance_commit");
  return { params: effect.params, state };
}

test("knowledge closure retains task facts while software closure bytes stay unchanged", () => {
  const knowledge = provenanceIntent(knowledgeContract());
  const closure = decodeClosedUnitEvidence(knowledge.state.closedUnitEvidence)![
    "unit-1"
  ]!;
  assert.deepEqual(closure.ownedPaths, ["src"]);
  assert.deepEqual(closure.acceptanceIds, ["acceptance-1"]);
  assert.deepEqual(closure.supersedes, ["earlier-record"]);
  assert.equal(closure.tombstones, undefined);
  const software = landUnit(run());
  assert.equal(software.gate, undefined);
  assert.equal(software.knowledgeContract, undefined);
  const softwareClosure = decodeClosedUnitEvidence(
    software.closedUnitEvidence,
  )!["unit-1"]!;
  assert.equal(softwareClosure.ownedPaths, undefined);
  assert.equal(softwareClosure.acceptanceIds, undefined);
  assert.equal("supersedes" in softwareClosure, false);
});

test("provenance projection is pure, byte-stable, and validates against the record schema", async () => {
  const { params } = provenanceIntent(knowledgeContract());
  const first = projectProvenanceRecords(params, "codex");
  assert.ok(first.ok, first.ok ? "" : first.reason);
  const replayed = projectProvenanceRecords(
    JSON.parse(canonicalJson(params as unknown as JsonValue)),
    "codex",
  );
  assert.ok(replayed.ok);
  assert.deepEqual(replayed.records, first.records);
  assert.equal(replayed.recordsCommitment, first.recordsCommitment);
  assert.equal(first.records.length, 1);
  const record = first.records[0]!;
  assert.equal(record.id, deriveProvenanceRecordId("unit-1", OID_C));
  assert.equal(record.path, `knowledge/events/${record.id}.md`);
  assert.equal(record.bytes.endsWith("\n"), true);
  assert.equal(record.bytes.endsWith("\n\n"), false);
  assert.doesNotMatch(record.bytes, /[ \t]\n|\t/u);

  const checks = await knowledgeChecks();
  const directory = await mkdtemp(join(tmpdir(), "sce-provenance-record-"));
  try {
    const path = join(directory, `${record.id}.md`);
    await writeFile(path, record.bytes, "utf8");
    const parsed = checks.parseFrontmatter(path);
    const schema = checks.readJson(
      join(CHECKS, "provenance-record.schema.json"),
    );
    checks.assertSchema(schema, parsed.data, record.id, schema);
    assert.equal(parsed.body.startsWith("\n# Provenance record\n"), true);
    assert.equal(parsed.data.projectId, "knowledge-project");
    assert.equal(parsed.data.accessDomainId, "knowledge.internal");
    assert.equal(parsed.data.audience, "knowledge-audience");
    assert.equal(parsed.data.humanDriver, "Knowledge Owner");
    assert.equal(parsed.data.executorTool, "codex");
    assert.equal(parsed.data.executorSessionId, "worker-1");
    assert.equal(parsed.data.timestampUtc, "2026-09-03T12:00:01Z");
    assert.equal(parsed.data.baseOid, OID_A);
    assert.equal(parsed.data.landedOid, OID_C);
    assert.deepEqual(parsed.data.ownedPaths, ["src"]);
    assert.deepEqual(parsed.data.acceptanceIds, ["acceptance-1"]);
    assert.deepEqual(parsed.data.verificationCommands, ["npm test"]);
    assert.deepEqual(parsed.data.verificationResults, ["passed"]);
    assert.equal(parsed.data.reviewDecision, "approve");
    assert.equal(parsed.data.reviewHeadOid, OID_B);
    assert.equal(parsed.data.reviewTreeOid, OID_C);
    assert.deepEqual(parsed.data.materialisationDestinations, [
      "drive:published",
    ]);
    assert.deepEqual(parsed.data.materialisationDigests, [null]);
    assert.deepEqual(parsed.data.materialisationStatuses, ["deferred"]);
    assert.deepEqual(parsed.data.supersedes, ["earlier-record"]);
    assert.deepEqual(parsed.data.tombstones, []);
    assert.match(record.bytes, /refused:zero_matches/u);
    assert.match(record.bytes, /follow-up:sce-follow-up/u);
    assert.doesNotMatch(record.bytes, /docs\/file\.md|--20260903/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }

  const missing = projectProvenanceRecords(
    {
      ...params,
      projectionInputSnapshot: {
        ...params.projectionInputSnapshot,
        unitIds: ["unit-9"],
      },
    },
    "codex",
  );
  assert.equal(missing.ok, false);
  const longDriver = projectProvenanceRecords(
    {
      ...params,
      knowledgeContract: {
        ...params.knowledgeContract,
        humanDriver: "x".repeat(257),
      },
    },
    "codex",
  );
  assert.equal(longDriver.ok, false);
});

test("provenance commit facts derive only from journaled values", () => {
  assert.equal(
    deriveProvenanceRecordId("sce:unit/1", OID_B),
    "sce-unit-1--bbbbbbbbbbbb",
  );
  assert.equal(deriveProvenanceRecordId("a".repeat(160), OID_B).length, 154);
  assert.equal(
    provenanceCommitDate("2026-09-03T12:00:01Z"),
    `${Date.UTC(2026, 8, 3, 12, 0, 1) / 1_000} +0000`,
  );
  assert.equal(provenanceCommitDate("2026-02-30T00:00:00Z"), undefined);
  assert.equal(provenanceCommitDate("2026-09-03T12:00:01"), undefined);
  assert.equal(
    provenanceCommitSubject("knowledge-1"),
    "sce: provenance for wave knowledge-1",
  );
  assert.equal(provenanceCommitTrailer("key-1"), "SCE-Provenance-Key: key-1");
});
