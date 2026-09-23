import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { canonicalJson, type JsonValue } from "../../src/protocol/canonical.js";
import {
  decodeClosedUnitEvidence,
  deriveIdempotencyKey,
  materialisationAggregateExpansionCost,
  materialisationExpansionCost,
  materialisationProjectionExpansionCost,
  projectionInputIsValid,
  provenanceCarrySnapshotCommitment,
  reduce,
  rehydrateEffect,
} from "../../src/protocol/reducer.js";
import {
  compactProvenanceInput,
  hydrateProvenanceInput,
  projectionStorageByteLength,
} from "../../src/protocol/projection.js";
import {
  deriveProvenanceRecordId,
  projectProvenanceRecords,
  provenanceCommitDate,
  provenanceCommitSubject,
  provenanceCommitTrailer,
  type ProvenanceCommitParams,
} from "../../src/protocol/provenance.js";
import type { MaterialisationExpansionBinding } from "../../src/protocol/reducer.js";
import type {
  CompactGateTargetState,
  GateTargetState,
  HydratedProvenanceInput,
  KnowledgeContract,
  ProtocolEvent,
  RepositoryRun,
} from "../../src/protocol/schemas.js";
import {
  LIMITS,
  ProvenanceInputSchema,
  validate,
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
/** The frozen knowledge example: the templates must keep accepting it. */
const EXAMPLE_MANIFEST = resolve(
  import.meta.dirname,
  "../../examples/knowledge-repository/knowledge-manifest.json",
);

type KnowledgeChecks = Readonly<{
  SCHEMA_SUBSET_VERSION: number;
  assertCanonicalSourcePattern(
    pattern: unknown,
    root: string,
    label: string,
  ): void;
  assertDriveHome(
    value: unknown,
    aliases: readonly string[],
    label: string,
  ): Readonly<{ alias: string; subpath: string }>;
  assertSchema(
    schema: unknown,
    value: unknown,
    at?: string,
    rootSchema?: unknown,
  ): void;
  assertSchemaSubset(schema: unknown, at?: string): void;
  readSchema(path: string): unknown;
  validateManifest(
    options: Readonly<{ manifest: string; root: string }>,
  ): unknown;
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

test("the knowledge schema validator enforces its versioned keyword subset", async () => {
  const checks = await knowledgeChecks();
  assert.equal(checks.SCHEMA_SUBSET_VERSION, 1);
  for (const name of [
    "knowledge-manifest.schema.json",
    "provenance-record.schema.json",
  ])
    assert.equal(typeof checks.readSchema(join(CHECKS, name)), "object");
  const refused: readonly [string, unknown, RegExp][] = [
    ["format", { type: "string", format: "uri" }, /keyword format/u],
    ["oneOf", { oneOf: [{ type: "string" }] }, /keyword oneOf/u],
    ["allOf", { allOf: [{ type: "string" }] }, /keyword allOf/u],
    ["not", { not: { type: "string" } }, /keyword not/u],
    [
      "patternProperties",
      { type: "object", patternProperties: {} },
      /keyword patternProperties/u,
    ],
    [
      "keyword below an absent property",
      {
        type: "object",
        additionalProperties: false,
        properties: { page: { type: "string", format: "uri" } },
      },
      /\$\.page: unsupported schema keyword format/u,
    ],
    [
      "keyword below an unreferenced definition",
      { type: "string", $defs: { spare: { type: "string", format: "uri" } } },
      /\$\.\$defs\.spare: unsupported schema keyword format/u,
    ],
    [
      "tuple items",
      { type: "array", items: [{ type: "string" }] },
      /schema node must be an object/u,
    ],
    ["integer type", { type: "integer" }, /unsupported schema type integer/u],
    ["type union", { type: ["string", "null"] }, /unsupported schema type/u],
    [
      "unconstrained object",
      { type: "object", properties: { page: { type: "string" } } },
      /properties require additionalProperties: false/u,
    ],
    [
      "permissive additionalProperties",
      { type: "object", additionalProperties: true },
      /additionalProperties must be false/u,
    ],
    [
      "remote reference",
      { $ref: "https://example.invalid/schema.json" },
      /unsupported schema reference/u,
    ],
    [
      "reference with siblings",
      { $ref: "#/$defs/hash", minLength: 1 },
      /\$ref is evaluated alone/u,
    ],
    [
      "branch with siblings",
      { anyOf: [{ type: "string" }], maxLength: 4 },
      /anyOf is evaluated alone/u,
    ],
    [
      "negative bound",
      { type: "string", maxLength: -1 },
      /maxLength must be a non-negative integer/u,
    ],
    [
      "non-boolean flag",
      { type: "array", uniqueItems: "yes" },
      /uniqueItems must be a boolean/u,
    ],
    ["empty enum", { enum: [] }, /enum must be a non-empty array/u],
    [
      "unusable pattern",
      { type: "string", pattern: "[" },
      /Invalid regular expression/u,
    ],
  ];
  for (const [label, schema, expected] of refused)
    assert.throws(() => checks.assertSchemaSubset(schema), expected, label);
  // The same refusal reaches every value: an unimplemented keyword can never
  // validate anything, whether or not a value happens to visit its node.
  assert.throws(
    () => checks.assertSchema({ type: "string", format: "uri" }, "page"),
    /unsupported schema keyword format/u,
  );
});

test("knowledge manifest semantics contain every declared target and drive home", async () => {
  const checks = await knowledgeChecks();
  const aliases = ["partner-drive"];
  assert.deepEqual(
    checks.assertDriveHome("partner-drive:incoming", aliases, "driveIncoming"),
    { alias: "partner-drive", subpath: "incoming" },
  );
  const refusedHomes: readonly [string, unknown, RegExp][] = [
    ["unqualified", "incoming", /must be <alias>:<subpath>/u],
    ["undeclared alias", "other-drive:incoming", /undeclared drive alias/u],
    ["two aliases", "a:b:c", /must be <alias>:<subpath>/u],
    ["absent", undefined, /must be <alias>:<subpath>/u],
    ["empty subpath", "partner-drive:", /canonical contained subpath/u],
    ["escape", "partner-drive:../escape", /canonical contained subpath/u],
    ["dot segment", "partner-drive:./incoming", /canonical contained subpath/u],
    ["absolute", "partner-drive:/incoming", /canonical contained subpath/u],
    ["glob", "partner-drive:incoming/*", /canonical contained subpath/u],
    [
      "oversize",
      `partner-drive:${"a".repeat(200)}`,
      /must be <alias>:<subpath>/u,
    ],
  ];
  for (const [label, value, expected] of refusedHomes)
    assert.throws(
      () => checks.assertDriveHome(value, aliases, "driveIncoming"),
      expected,
      label,
    );
  const root = "/knowledge-repository";
  checks.assertCanonicalSourcePattern(
    "knowledge/current/access-*.md",
    root,
    "source pattern",
  );
  const refusedPatterns: readonly [string, unknown][] = [
    ["escape", "../outside/*.md"],
    ["absolute", "/etc/*.md"],
    ["recursive glob", "knowledge/**/page.md"],
    ["dot segment", "knowledge/./page.md"],
    ["empty segment", "knowledge//page.md"],
    ["backslash", "knowledge\\page.md"],
    ["glob-leading segment", "knowledge/*.md"],
    ["trailing separator", "knowledge/current/"],
    ["oversize", `knowledge/${"a".repeat(200)}.md`],
    ["absent", undefined],
  ];
  for (const [label, pattern] of refusedPatterns)
    assert.throws(
      () =>
        checks.assertCanonicalSourcePattern(pattern, root, "source pattern"),
      /canonical bounded glob/u,
      label,
    );

  const directory = await mkdtemp(join(tmpdir(), "sce-knowledge-manifest-"));
  try {
    const example = checks.readJson(EXAMPLE_MANIFEST) as Record<string, any>;
    await mkdir(dirname(join(directory, example.frontmatterSchemaPath)), {
      recursive: true,
    });
    await writeFile(
      join(directory, example.frontmatterSchemaPath),
      "{}\n",
      "utf8",
    );
    const write = async (name: string, value: unknown): Promise<string> => {
      const path = join(directory, `${name.replaceAll(" ", "-")}.json`);
      await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
      return path;
    };
    assert.equal(
      typeof checks.validateManifest({
        manifest: await write("accepted", example),
        root: directory,
      }),
      "object",
      "the frozen knowledge example stays accepted",
    );
    const homes = (overrides: Record<string, string>): unknown => ({
      ...example,
      artifactHomes: { ...example.artifactHomes, ...overrides },
    });
    const target = (overrides: Record<string, unknown>): unknown => ({
      ...example,
      materialisationTargets: [
        { ...example.materialisationTargets[0], ...overrides },
      ],
    });
    const refusedManifests: readonly [string, unknown, RegExp][] = [
      [
        "unqualified drive home",
        homes({ driveIncoming: "incoming" }),
        /driveIncoming: string does not match/u,
      ],
      [
        "escaping drive home",
        homes({ driveIncoming: "partner-drive:../escape" }),
        /driveIncoming: string does not match/u,
      ],
      [
        "undeclared drive alias",
        homes({ driveIncoming: "other-drive:incoming" }),
        /undeclared drive alias/u,
      ],
      [
        "identical drive homes",
        homes({ driveRendered: "partner-drive:incoming" }),
        /must not overlap/u,
      ],
      [
        "nested drive homes",
        homes({ driveRendered: "partner-drive:incoming/rendered" }),
        /must not overlap/u,
      ],
      [
        "escaping source pattern",
        target({ sourcePattern: "../outside/*.md" }),
        /sourcePattern: string does not match/u,
      ],
      [
        "undeclared destination alias",
        target({ destinationAlias: "other-drive" }),
        /unknown destination alias/u,
      ],
    ];
    for (const [label, candidate, expected] of refusedManifests) {
      const manifest = await write(label, candidate);
      assert.throws(
        () => checks.validateManifest({ manifest, root: directory }),
        expected,
        label,
      );
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
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

const utf8 = new TextEncoder();
const canonicalBytes = (value: unknown): number =>
  utf8.encode(canonicalJson(value as JsonValue)).byteLength;

/** One schema-legal output at its minimum size, with exact derived id widths. */
const LEGAL = {
  digest: "a".repeat(64),
  oid: "b".repeat(40),
  targetId: `sce:tgt:${"c".repeat(64)}`,
  probeId: `sce:gate:${"d".repeat(64)}`,
  resolutionId: `sce:gate:${"e".repeat(64)}`,
  target: {
    destinationAlias: "d",
    destinationSubpath: "s",
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: "p",
  },
} as const;
const FULL_CAPACITIES = {
  remainingAggregateEnvelopeByteCapacity: LIMITS.envelopeBytes,
  remainingItemCapacity: LIMITS.materialisationOutputs,
  remainingProjectionSnapshotByteCapacity: LIMITS.projectionSnapshotBytes,
  remainingSourceByteCapacity: LIMITS.materialisationWaveBytes,
} as const;

function minimalLegalTarget(ordinal: number, outputs: number): GateTargetState {
  const sources = Array.from({ length: outputs }, (_, index) => ({
    blobOid: LEGAL.oid,
    byteCount: 0,
    path: `p${index}`,
    sha256: LEGAL.digest,
  }));
  const definition = {
    originUnitId: "u",
    scope: "unit" as const,
    target: LEGAL.target,
    targetId: LEGAL.targetId,
    targetOrdinal: ordinal,
  };
  return {
    definition,
    materialisations: sources.map((source, index) => ({
      artifactName: "a",
      destinationProbeGateEntryId: LEGAL.probeId,
      gateEntryId: `sce:gate:${index.toString().padStart(64, "0")}`,
      observation: {
        artifactByteCount: source.byteCount,
        artifactSha256: source.sha256,
        artifactStatus: "already_present" as const,
        sidecarByteCount: 1,
        sidecarSha256: LEGAL.digest,
        sidecarStatus: "already_present" as const,
      },
      originUnitId: definition.originUnitId,
      sidecarByteCount: 1,
      sidecarName: "a",
      sidecarSha256: LEGAL.digest,
      source,
      sourceOid: LEGAL.oid,
      status: "observed" as const,
      target: definition.target,
      targetId: definition.targetId,
      timestamp: "2026-09-03T12:00:00Z",
    })),
    resolution: {
      capacities: FULL_CAPACITIES,
      gateEntryId: LEGAL.resolutionId,
      sourceOid: LEGAL.oid,
      sources,
      status: "observed" as const,
      targetId: definition.targetId,
    },
    status: "observed" as const,
  };
}

/** A schema-legal projection holding exactly `outputs` minimal outputs. */
function minimalLegalProjection(outputs: number): HydratedProvenanceInput {
  const targets: GateTargetState[] = [];
  for (let left = outputs, ordinal = 0; left > 0; ordinal += 1) {
    const take = Math.min(LIMITS.materialisationMatches, left);
    targets.push(minimalLegalTarget(ordinal, take));
    left -= take;
  }
  return {
    closedUnitEvidence: "",
    closureEvidenceCommitment: LEGAL.digest,
    destinationProbeEvidence: [
      {
        destinationAlias: LEGAL.target.destinationAlias,
        destinationSubpath: LEGAL.target.destinationSubpath,
        gateEntryId: LEGAL.probeId,
        identity: {
          canonicalPath: `/${"a".repeat(4_095)}`,
          device: "9".repeat(20),
          inode: "9".repeat(20),
        },
        stage: "unit",
        status: "observed",
      },
    ],
    targetEvidence: targets,
    unitIds: ["u"],
  };
}

function largestFittingOutputCount(
  encode: (outputs: number) => number,
): number {
  let best = 0;
  while (
    best < LIMITS.materialisationOutputs &&
    encode(best + 1) <= LIMITS.projectionSnapshotBytes
  )
    best += 1;
  return best;
}

test("the frozen projection is stored compactly and hydrates byte-identically", () => {
  const contract = knowledgeContract();
  const knowledge = provenanceIntent(contract);
  const stored = knowledge.state.gate!.provenance!.projectionInputSnapshot;
  assert.ok(stored.targetEvidence.length > 0);
  for (const target of stored.targetEvidence)
    assert.equal((target as CompactGateTargetState).version, 2);
  const hydrated = hydrateProvenanceInput(stored);
  assert.ok(hydrated !== undefined);

  // Round trip, both directions, byte for byte.
  const recompacted = compactProvenanceInput(hydrated);
  assert.ok(recompacted !== undefined);
  assert.equal(
    canonicalJson(recompacted as unknown as JsonValue),
    canonicalJson(stored as unknown as JsonValue),
  );
  assert.equal(
    canonicalJson(hydrateProvenanceInput(recompacted) as unknown as JsonValue),
    canonicalJson(hydrated as unknown as JsonValue),
  );

  // Both encodings are legal, valid, and agree on every commitment.
  assert.ok(validate(ProvenanceInputSchema, stored).ok);
  assert.ok(validate(ProvenanceInputSchema, hydrated).ok);
  assert.ok(projectionInputIsValid(stored));
  assert.ok(projectionInputIsValid(hydrated));
  assert.equal(
    provenanceCarrySnapshotCommitment(stored),
    provenanceCarrySnapshotCommitment(hydrated),
  );

  // The consumer boundary is byte-identical for either encoding.
  assert.deepEqual(
    projectProvenanceRecords(knowledge.params, "codex"),
    projectProvenanceRecords(
      { ...knowledge.params, projectionInputSnapshot: hydrated },
      "codex",
    ),
  );
  assert.ok(
    projectionStorageByteLength(stored) < canonicalBytes(hydrated),
    "the compact encoding must be strictly smaller",
  );
});

test("the projection upcaster is total and refuses evidence it cannot reconstruct", () => {
  const legacy = minimalLegalProjection(2);
  assert.ok(validate(ProvenanceInputSchema, legacy).ok);
  const compact = compactProvenanceInput(legacy);
  assert.ok(compact !== undefined);
  assert.ok(validate(ProvenanceInputSchema, compact).ok);
  // Compaction is idempotent, so the stored bytes are canonical.
  assert.equal(
    canonicalJson(compactProvenanceInput(compact) as unknown as JsonValue),
    canonicalJson(compact as unknown as JsonValue),
  );
  assert.equal(
    canonicalJson(hydrateProvenanceInput(compact) as unknown as JsonValue),
    canonicalJson(legacy as unknown as JsonValue),
  );

  const target = legacy.targetEvidence[0]!;
  const contradiction = (next: GateTargetState) => ({
    ...legacy,
    targetEvidence: [next, ...legacy.targetEvidence.slice(1)],
  });
  // None of these restate what hydration would re-derive, so none compacts:
  // an observation disagreeing with its own source, a resolution whose source
  // list disagrees with its outputs, a per-output target id contradicting the
  // definition.
  for (const broken of [
    {
      ...target,
      materialisations: target.materialisations.map((item, index) =>
        index === 0
          ? {
              ...item,
              observation: { ...item.observation!, artifactByteCount: 7 },
            }
          : item,
      ),
    },
    {
      ...target,
      resolution: {
        ...target.resolution!,
        sources: [target.resolution!.sources![0]!],
      },
    },
    {
      ...target,
      materialisations: target.materialisations.map((item) => ({
        ...item,
        targetId: `sce:tgt:${"f".repeat(64)}`,
      })),
    },
  ])
    assert.equal(compactProvenanceInput(contradiction(broken)), undefined);

  // A half-compacted projection is ambiguous machine state, not evidence.
  const mixed = {
    ...compact,
    targetEvidence: [
      ...compact.targetEvidence.slice(0, 1),
      ...legacy.targetEvidence.slice(1),
    ],
  };
  assert.ok(validate(ProvenanceInputSchema, mixed).ok);
  assert.equal(projectionInputIsValid(mixed), false);
});

test("the compact projection buys real output capacity inside unchanged bounds", () => {
  // No bound moves, and neither does the per-target ceiling.
  assert.equal(LIMITS.projectionSnapshotBytes, 65_536);
  assert.equal(LIMITS.envelopeBytes, 131_072);
  assert.equal(LIMITS.materialisationMatches, 64);

  const legacyBytes = (outputs: number) =>
    canonicalBytes(minimalLegalProjection(outputs));
  const compactBytes = (outputs: number) =>
    projectionStorageByteLength(minimalLegalProjection(outputs));
  for (const outputs of [1, 64])
    for (const encoded of [
      minimalLegalProjection(outputs),
      compactProvenanceInput(minimalLegalProjection(outputs)),
    ])
      assert.ok(validate(ProvenanceInputSchema, encoded).ok);

  // Exact marginal cost of one more minimal legal output.
  assert.equal(legacyBytes(2) - legacyBytes(1), 1_307);
  assert.equal(compactBytes(2) - compactBytes(1), 645);

  // 64 minimal outputs did not fit and now do, with headroom to spare.
  assert.equal(legacyBytes(64), 89_093);
  assert.equal(compactBytes(64), 46_585);
  assert.ok(legacyBytes(64) > LIMITS.projectionSnapshotBytes);
  assert.ok(compactBytes(64) <= LIMITS.projectionSnapshotBytes);
  assert.equal(largestFittingOutputCount(legacyBytes), 46);
  assert.equal(largestFittingOutputCount(compactBytes), 92);
});

test("the exact legal reserve is measured on the encoding each copy is stored in", () => {
  const sources = [
    {
      blobOid: LEGAL.oid,
      byteCount: 1,
      path: "docs/a.txt",
      sha256: LEGAL.digest,
    },
  ];
  const binding: MaterialisationExpansionBinding = {
    capacities: FULL_CAPACITIES,
    destinationProbeGateEntryId: LEGAL.probeId,
    domainScope: "knowledge",
    driver: "SCE",
    executorTool: "codex",
    originUnitId: "unit-1",
    resolutionGateEntryId: LEGAL.resolutionId,
    runId: "run-1",
    sourceOid: LEGAL.oid,
    stage: "unit",
    target: { ...LEGAL.target, sourcePattern: "docs/*.txt" },
    targetId: LEGAL.targetId,
    targetOrdinal: 0,
    waveId: "wave-1",
  };
  const live = materialisationExpansionCost(sources, binding);
  const frozen = materialisationProjectionExpansionCost(sources, binding);
  // Live record plus compact frozen copy, not twice the live one.
  assert.equal(
    materialisationAggregateExpansionCost(sources, binding),
    live + frozen,
  );
  assert.ok(frozen < live);
  assert.ok(live + frozen < 2 * live);
  // A gate-stage tuple never enters the frozen projection at all.
  const gateBinding = {
    ...binding,
    originUnitId: null,
    stage: "gate" as const,
  };
  assert.equal(materialisationProjectionExpansionCost(sources, gateBinding), 0);
  assert.equal(
    materialisationAggregateExpansionCost(sources, gateBinding),
    materialisationExpansionCost(sources, gateBinding),
  );
});
