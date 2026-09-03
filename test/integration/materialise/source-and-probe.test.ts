import assert from "node:assert/strict";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  nodeMaterialisationProcess,
  type MaterialisationProcessPort,
} from "../../../src/adapters/materialise/index.js";
import {
  canonicalJson,
  type JsonValue,
} from "../../../src/protocol/canonical.js";
import {
  deriveGateEntryId,
  materialisationAggregateExpansionCost,
  materialisationExpansionCost,
  materialisationProjectionExpansionCost,
  type MaterialisationExpansionBinding,
} from "../../../src/protocol/reducer.js";
import {
  LIMITS,
  type MaterialisationSource,
} from "../../../src/protocol/schemas.js";
import {
  adapterFor,
  gitText,
  hash,
  materialisationFixture,
  type MaterialisationFixture,
  type ProbeEffect,
  type ResolveEffect,
} from "./fixture.js";

function resolveEffect(
  fixture: MaterialisationFixture,
  changes: Partial<ResolveEffect["params"]> = {},
): ResolveEffect {
  const gateEntryId = `sce:gate:${"d".repeat(64)}`;
  const target = {
    destinationAlias: "drive",
    destinationSubpath: "published",
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: "docs/*.txt",
  };
  return {
    effectId: "event-1:materialisation_resolve",
    gateEntryId,
    idempotencyKey: hash("resolve-fixture"),
    kind: "materialisation_resolve",
    params: {
      destinationProbeGateEntryId: `sce:gate:${"c".repeat(64)}`,
      domainScope: "knowledge",
      driver: "SCE integration test",
      executorTool: "codex",
      gateEntryId,
      remainingAggregateEnvelopeByteCapacity: LIMITS.envelopeBytes,
      remainingItemCapacity: LIMITS.materialisationOutputs,
      remainingProjectionSnapshotByteCapacity: 65_536,
      remainingSourceByteCapacity: LIMITS.materialisationWaveBytes,
      originUnitId: "unit-1",
      repositoryIdentity: "repo-1",
      runId: "run-1",
      sourceOid: fixture.effect.params.sourceOid,
      sourcePattern: target.sourcePattern,
      stage: "unit",
      target,
      targetId: `sce:tgt:${"e".repeat(64)}`,
      targetOrdinal: 0,
      waveId: "wave-1",
      ...changes,
    },
    paramsHash: hash("resolve-params"),
    schemaVersion: 1,
    unitId: null,
  };
}

function expansionBinding(effect: ResolveEffect) {
  return {
    capacities: {
      remainingAggregateEnvelopeByteCapacity:
        effect.params.remainingAggregateEnvelopeByteCapacity,
      remainingItemCapacity: effect.params.remainingItemCapacity,
      remainingProjectionSnapshotByteCapacity:
        effect.params.remainingProjectionSnapshotByteCapacity,
      remainingSourceByteCapacity: effect.params.remainingSourceByteCapacity,
    },
    destinationProbeGateEntryId: effect.params.destinationProbeGateEntryId,
    domainScope: effect.params.domainScope,
    driver: effect.params.driver,
    executorTool: effect.params.executorTool,
    originUnitId: effect.params.originUnitId,
    resolutionGateEntryId: effect.params.gateEntryId,
    runId: effect.params.runId,
    sourceOid: effect.params.sourceOid,
    stage: effect.params.stage,
    target: effect.params.target,
    targetId: effect.params.targetId,
    targetOrdinal: effect.params.targetOrdinal,
    waveId: effect.params.waveId,
  };
}

type ProcessCall = Readonly<{
  executable: string;
  argv: readonly string[];
  options: Parameters<MaterialisationProcessPort["run"]>[2];
}>;

type ProcessResult = Awaited<ReturnType<MaterialisationProcessPort["run"]>>;

const sanitizedGitEnvironment = {
  GIT_ASKPASS: "/usr/bin/false",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_SSH_COMMAND: "/usr/bin/false",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
  SSH_ASKPASS: "/usr/bin/false",
  TMPDIR: "/tmp",
} as const;

function treeRecord(
  oid: string,
  path: Buffer | string,
  type = "blob",
  mode = "100644",
): Buffer {
  return Buffer.concat([
    Buffer.from(`${mode} ${type} ${oid}\t`, "ascii"),
    typeof path === "string" ? Buffer.from(path, "ascii") : path,
    Buffer.from([0]),
  ]);
}

function streamedTreePort(
  tree: Buffer,
  calls: ProcessCall[],
  override?: (
    executable: string,
    argv: readonly string[],
    options: Parameters<MaterialisationProcessPort["run"]>[2],
  ) => Promise<ProcessResult | undefined>,
): MaterialisationProcessPort {
  const runTree = nodeMaterialisationProcess.runTree;
  assert.ok(runTree);
  const source = `process.stdout.write(Buffer.from("${tree.toString("base64")}", "base64"));`;
  return {
    async run(executable, argv, options) {
      calls.push({ argv, executable, options });
      const replaced = await override?.(executable, argv, options);
      return (
        replaced ??
        (await nodeMaterialisationProcess.run(executable, argv, options))
      );
    },
    async runTree(executable, argv, options, sourcePattern) {
      calls.push({ argv, executable, options });
      return await runTree(
        process.execPath,
        ["-e", source],
        options,
        sourcePattern,
      );
    },
  };
}

function expectedResolutionRefusal(code: string, facts: JsonValue) {
  return {
    refusal: {
      code,
      detailHash: hash(
        canonicalJson({
          domain: "sce.materialisation-refusal.v1",
          facts,
        }),
      ),
    },
    status: "refused",
  };
}

function independentlyCalculatedMaximumSidecarBytes(
  source: MaterialisationSource,
  binding: MaterialisationExpansionBinding,
): number {
  const basename = source.path.split("/").at(-1)!;
  const dot = basename.lastIndexOf(".");
  const suffix = dot > 0 ? basename.slice(dot + 1) : "";
  const stem = (dot > 0 ? basename.slice(0, dot) : basename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  const artifactName = `${stem}--${source.blobOid.slice(0, 12)}--99991231T235959Z${suffix === "" ? "" : `.${suffix.toLowerCase()}`}`;
  const gateEntryId = deriveGateEntryId(
    binding.runId,
    binding.waveId,
    `${binding.stage}-materialise`,
    {
      blobOid: source.blobOid,
      destinationProbeGateEntryId: binding.destinationProbeGateEntryId,
      path: source.path,
      sourceOid: binding.sourceOid,
      targetId: binding.targetId,
    },
  );
  return Buffer.byteLength(
    `${canonicalJson({
      artifactName,
      blobOid: source.blobOid,
      byteCount: source.byteCount,
      destinationAlias: binding.target.destinationAlias,
      destinationSubpath: binding.target.destinationSubpath,
      domainScope: binding.domainScope,
      driver: binding.driver,
      executorTool: binding.executorTool,
      gateEntryId,
      originUnitId: binding.originUnitId,
      runId: binding.runId,
      schema: "sce.materialisation-provenance",
      sha256: source.sha256,
      sourceOid: binding.sourceOid,
      sourcePath: source.path,
      targetId: binding.targetId,
      timestamp: "9999-12-31T23:59:59Z",
      version: 1,
      waveId: binding.waveId,
    })}\n`,
    "utf8",
  );
}

function assertReadOnlyGitCalls(calls: readonly ProcessCall[]): void {
  assert.ok(calls.length >= 3);
  for (const call of calls) {
    assert.equal(call.executable, "/usr/bin/git");
    assert.deepEqual(call.options.env, sanitizedGitEnvironment);
    assert.equal(call.argv[0], "--no-replace-objects");
    assert.equal(
      call.argv.some((part) =>
        [
          "add",
          "commit",
          "link",
          "mv",
          "push",
          "rename",
          "write-tree",
        ].includes(part),
      ),
      false,
    );
  }
}

async function assertNothingPublished(
  fixture: MaterialisationFixture,
): Promise<void> {
  assert.deepEqual(await readdir(fixture.destinationDirectory), []);
}

function probeEffect(
  fixture: MaterialisationFixture,
  changes: Partial<ProbeEffect["params"]> = {},
): ProbeEffect {
  const gateEntryId = `sce:gate:${"f".repeat(64)}`;
  return {
    effectId: "event-1:destination_probe",
    gateEntryId,
    idempotencyKey: hash("probe-fixture"),
    kind: "destination_probe",
    params: {
      destination: fixture.effect.params.destination,
      destinationSubpath: fixture.effect.params.destinationSubpath,
      gateEntryId,
      repositoryIdentity: "repo-1",
      stage: "unit",
      waveId: "wave-1",
      ...changes,
    },
    paramsHash: hash("probe-params"),
    schemaVersion: 1,
    unitId: null,
  };
}

test("source resolution reads the exact Git tree without consulting the worktree or a pathspec", async () => {
  const fixture = await materialisationFixture();
  try {
    const originalBranch = gitText(
      fixture.repository,
      "symbolic-ref",
      "--short",
      "HEAD",
    );
    gitText(fixture.repository, "checkout", "-q", "-b", "replacement-fixture");
    await writeFile(
      join(fixture.repository, "docs", "report.txt"),
      "replacement-object content\n",
    );
    gitText(fixture.repository, "add", "docs/report.txt");
    gitText(
      fixture.repository,
      "-c",
      "user.name=SCE Test",
      "-c",
      "user.email=sce@example.invalid",
      "commit",
      "-q",
      "-m",
      "replacement fixture",
    );
    const replacementOid = gitText(fixture.repository, "rev-parse", "HEAD");
    gitText(fixture.repository, "checkout", "-q", originalBranch);
    gitText(
      fixture.repository,
      "replace",
      fixture.effect.params.sourceOid,
      replacementOid,
    );
    await writeFile(
      join(fixture.repository, "docs", "report.txt"),
      "uncommitted replacement\n",
    );
    await writeFile(
      join(fixture.repository, "docs", "untracked.txt"),
      "not in the exact tree\n",
    );
    const statusBefore = gitText(
      fixture.repository,
      "status",
      "--porcelain=v1",
    );
    const calls: ProcessCall[] = [];
    const recordingPort: MaterialisationProcessPort = {
      run: async (executable, argv, options) => {
        calls.push({ argv, executable, options });
        return await nodeMaterialisationProcess.run(executable, argv, options);
      },
    };

    const result = await adapterFor(fixture, recordingPort).resolve(
      resolveEffect(fixture),
    );

    assert.deepEqual(result, {
      sources: [
        {
          blobOid: fixture.effect.params.source.blobOid,
          byteCount: fixture.artifact.byteLength,
          path: "docs/report.txt",
          sha256: hash(fixture.artifact),
        },
      ],
      status: "observed",
    });
    assert.equal(
      gitText(fixture.repository, "status", "--porcelain=v1"),
      statusBefore,
      "read-only discovery must not modify repository state",
    );
    assertReadOnlyGitCalls(calls);
    for (const call of calls) {
      assert.equal(call.options.cwd, fixture.repository);
      assert.ok(!call.argv.includes("docs/*.txt"));
    }
    const treeCall = calls.find((call) => call.argv.includes("ls-tree"));
    assert.ok(treeCall);
    assert.deepEqual(treeCall.argv.slice(0, 6), [
      "--no-replace-objects",
      "ls-tree",
      "-rz",
      "-r",
      "--full-tree",
      fixture.effect.params.sourceOid,
    ]);
    await assertNothingPublished(fixture);
  } finally {
    await fixture.cleanup();
  }
});

test("tree enumeration streams more than four MiB while retaining only bounded matches", async () => {
  const runTree = nodeMaterialisationProcess.runTree;
  assert.ok(runTree);
  const oid = "a".repeat(40);
  const script = [
    `const other = Buffer.from("100644 blob ${oid}\\tother/unrelated.txt\\0");`,
    "const chunk = Buffer.concat(Array.from({length: 1024}, () => other));",
    "for (let index = 0; index < 96; index += 1) process.stdout.write(chunk);",
    `process.stdout.write(Buffer.from("100644 blob ${oid}\\tdocs/report.txt\\0"));`,
  ].join("");
  const result = await runTree(
    process.execPath,
    ["-e", script],
    {
      cwd: "/tmp",
      env: { PATH: "/usr/bin:/bin" },
      maxOutputBytes: 8_192,
    },
    "docs/*.txt",
  );
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.parsingValid, true);
  assert.equal(result.retainedMatches, 1);
  assert.equal(
    result.stdout.toString("ascii").endsWith("\tdocs/report.txt\0"),
    true,
  );
  assert.ok(result.stdout.byteLength < 512);
});

test("stage-aware sizing binds exact sidecars and keeps probe reserve outside adapter expansion", () => {
  const sources = [
    {
      blobOid: "a".repeat(40),
      byteCount: 1,
      path: "docs/a.txt",
      sha256: "b".repeat(64),
    },
  ];
  const target = {
    destinationAlias: "drive",
    destinationSubpath: "published",
    namingPolicy: "source-basename" as const,
    sidecarRequired: true as const,
    sourcePattern: "docs/*.txt",
  };
  const unit = {
    capacities: {
      remainingAggregateEnvelopeByteCapacity: LIMITS.envelopeBytes,
      remainingItemCapacity: LIMITS.materialisationOutputs,
      remainingProjectionSnapshotByteCapacity: 65_536,
      remainingSourceByteCapacity: LIMITS.materialisationWaveBytes,
    },
    destinationProbeGateEntryId: `sce:gate:${"f".repeat(64)}`,
    domainScope: "knowledge",
    driver: "SCE integration test",
    executorTool: "codex",
    originUnitId: "unit-1",
    resolutionGateEntryId: `sce:gate:${"e".repeat(64)}`,
    runId: "run-1",
    sourceOid: "c".repeat(40),
    stage: "unit" as const,
    target,
    targetId: `sce:tgt:${"d".repeat(64)}`,
    targetOrdinal: 0,
    waveId: "wave-1",
  };
  const gate = {
    ...unit,
    originUnitId: null,
    stage: "gate" as const,
  };
  const unitExpansion = materialisationExpansionCost(sources, unit);
  const gateExpansion = materialisationExpansionCost(sources, gate);
  const unitAggregate = materialisationAggregateExpansionCost(sources, unit);
  const gateAggregate = materialisationAggregateExpansionCost(sources, gate);

  assert.equal(unitExpansion, 1_915);
  assert.equal(gateExpansion, 1_911);
  assert.equal(unitAggregate, 3_830);
  assert.equal(gateAggregate, 1_911);
  assert.equal(materialisationProjectionExpansionCost(sources, unit), 1_915);
  assert.equal(unitAggregate, 2 * unitExpansion);
  assert.equal(materialisationProjectionExpansionCost(sources, gate), 0);
  assert.equal(gateAggregate, gateExpansion);
  assert.equal(
    expectedResolutionRefusal("evidence_budget_exceeded", {
      aggregateEvidenceBytes: unitAggregate,
      gateEntryId: unit.resolutionGateEntryId,
      projectionEvidenceBytes: 1_915,
    }).refusal.detailHash,
    "3c63856122731ac6113e5247c7529a30c8985e44aaf6efb513c6d5981e803bf3",
  );
  assert.equal(
    expectedResolutionRefusal("evidence_budget_exceeded", {
      aggregateEvidenceBytes: gateAggregate,
      gateEntryId: gate.resolutionGateEntryId,
      projectionEvidenceBytes: 0,
    }).refusal.detailHash,
    "07713f60b1eaa85a967d89bc6013de1e7b279a9911c2a3d6f38f1e3e9eed7858",
  );

  const threeDigitSidecar = { ...unit, driver: "x".repeat(274) };
  const fourDigitSidecar = { ...unit, driver: "x".repeat(275) };
  assert.equal(
    independentlyCalculatedMaximumSidecarBytes(sources[0]!, threeDigitSidecar),
    999,
  );
  assert.equal(
    independentlyCalculatedMaximumSidecarBytes(sources[0]!, fourDigitSidecar),
    1_000,
  );
  assert.equal(materialisationExpansionCost(sources, threeDigitSidecar), 1_915);
  assert.equal(materialisationExpansionCost(sources, fourDigitSidecar), 1_916);
});

test("source resolution accepts exact net evidence capacity and refuses one byte less", async () => {
  const fixture = await materialisationFixture();
  try {
    const sources = [
      {
        blobOid: fixture.effect.params.source.blobOid,
        byteCount: fixture.artifact.byteLength,
        path: "docs/report.txt",
        sha256: hash(fixture.artifact),
      },
    ];
    let exactEffect = resolveEffect(fixture, {
      remainingAggregateEnvelopeByteCapacity: 4_096,
      remainingProjectionSnapshotByteCapacity: 2_048,
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const binding = expansionBinding(exactEffect);
      const remainingAggregateEnvelopeByteCapacity =
        materialisationAggregateExpansionCost(sources, binding);
      const remainingProjectionSnapshotByteCapacity =
        materialisationProjectionExpansionCost(sources, binding);
      if (
        remainingAggregateEnvelopeByteCapacity ===
          exactEffect.params.remainingAggregateEnvelopeByteCapacity &&
        remainingProjectionSnapshotByteCapacity ===
          exactEffect.params.remainingProjectionSnapshotByteCapacity
      )
        break;
      exactEffect = resolveEffect(fixture, {
        remainingAggregateEnvelopeByteCapacity,
        remainingProjectionSnapshotByteCapacity,
      });
    }
    const exactBinding = expansionBinding(exactEffect);
    const exactAggregate = materialisationAggregateExpansionCost(
      sources,
      exactBinding,
    );
    const exactProjection = materialisationProjectionExpansionCost(
      sources,
      exactBinding,
    );
    assert.equal(
      exactEffect.params.remainingAggregateEnvelopeByteCapacity,
      exactAggregate,
    );
    assert.equal(
      exactEffect.params.remainingProjectionSnapshotByteCapacity,
      exactProjection,
    );
    assert.deepEqual(await adapterFor(fixture).resolve(exactEffect), {
      sources,
      status: "observed",
    });

    const shortEffect = resolveEffect(fixture, {
      remainingAggregateEnvelopeByteCapacity: exactAggregate,
      remainingProjectionSnapshotByteCapacity: exactProjection - 1,
    });
    const shortBinding = expansionBinding(shortEffect);
    const shortAggregate = materialisationAggregateExpansionCost(
      sources,
      shortBinding,
    );
    const shortProjection = materialisationProjectionExpansionCost(
      sources,
      shortBinding,
    );
    assert.equal(shortAggregate, exactAggregate);
    assert.equal(shortProjection, exactProjection);
    assert.deepEqual(
      await adapterFor(fixture).resolve(shortEffect),
      expectedResolutionRefusal("evidence_budget_exceeded", {
        aggregateEvidenceBytes: shortAggregate,
        gateEntryId: shortEffect.gateEntryId,
        projectionEvidenceBytes: shortProjection,
      }),
    );
    await assertNothingPublished(fixture);
  } finally {
    await fixture.cleanup();
  }
});

for (const boundary of [
  { expected: "zero_matches", matchCount: 0 },
  {
    expected: "evidence_budget_exceeded",
    matchCount: LIMITS.materialisationMatches,
  },
  {
    expected: "too_many_matches",
    matchCount: LIMITS.materialisationMatches + 1,
  },
] as const) {
  test(`source resolution treats ${boundary.matchCount} matches as ${boundary.expected}`, async () => {
    const fixture = await materialisationFixture();
    try {
      const blobOid = fixture.effect.params.source.blobOid;
      const paths = Array.from(
        { length: boundary.matchCount },
        (_, index) => `docs/item-${String(index).padStart(2, "0")}.txt`,
      );
      const tree =
        paths.length === 0
          ? treeRecord(blobOid, "other/unmatched.txt")
          : Buffer.concat(paths.map((path) => treeRecord(blobOid, path)));
      const calls: ProcessCall[] = [];
      const result = await adapterFor(
        fixture,
        streamedTreePort(tree, calls),
      ).resolve(resolveEffect(fixture));
      const sources = paths.map((path) => ({
        blobOid,
        byteCount: fixture.artifact.byteLength,
        path,
        sha256: hash(fixture.artifact),
      }));
      const effect = resolveEffect(fixture);
      const binding = expansionBinding(effect);
      assert.deepEqual(
        result,
        expectedResolutionRefusal(
          boundary.expected,
          boundary.expected === "zero_matches"
            ? { pattern: "docs/*.txt" }
            : boundary.expected === "too_many_matches"
              ? { matchCount: boundary.matchCount }
              : {
                  aggregateEvidenceBytes: materialisationAggregateExpansionCost(
                    sources,
                    binding,
                  ),
                  gateEntryId: effect.gateEntryId,
                  projectionEvidenceBytes:
                    materialisationProjectionExpansionCost(sources, binding),
                },
        ),
      );
      assertReadOnlyGitCalls(calls);
      await assertNothingPublished(fixture);
    } finally {
      await fixture.cleanup();
    }
  });
}

test("matched invalid UTF-8 and control path bytes refuse the complete resolution", async () => {
  const fixture = await materialisationFixture();
  try {
    const blobOid = fixture.effect.params.source.blobOid;
    const cases = [
      {
        name: "invalid UTF-8",
        path: Buffer.concat([
          Buffer.from("docs/z", "ascii"),
          Buffer.from([0xff]),
          Buffer.from(".txt", "ascii"),
        ]),
      },
      { name: "control", path: Buffer.from("docs/z\u0001.txt", "binary") },
      { name: "newline", path: Buffer.from("docs/z\n.txt", "binary") },
      { name: "tab", path: Buffer.from("docs/z\t.txt", "binary") },
    ] as const;
    for (const candidate of cases) {
      const calls: ProcessCall[] = [];
      const tree = Buffer.concat([
        treeRecord(blobOid, "docs/0-valid.txt"),
        treeRecord(blobOid, candidate.path),
      ]);
      const result = await adapterFor(
        fixture,
        streamedTreePort(tree, calls),
      ).resolve(resolveEffect(fixture));

      assert.deepEqual(
        result,
        expectedResolutionRefusal("unsafe_path", {
          pathHash: hash(candidate.path),
        }),
        candidate.name,
      );
      assertReadOnlyGitCalls(calls);
      await assertNothingPublished(fixture);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("a matched non-blob refuses the complete resolution without publication", async () => {
  const fixture = await materialisationFixture();
  try {
    const path = Buffer.from("docs/folder.txt", "ascii");
    const calls: ProcessCall[] = [];
    const result = await adapterFor(
      fixture,
      streamedTreePort(
        treeRecord(
          fixture.effect.params.source.blobOid,
          path,
          "tree",
          "040000",
        ),
        calls,
      ),
    ).resolve(resolveEffect(fixture));

    assert.deepEqual(
      result,
      expectedResolutionRefusal("non_blob", { pathHashes: [hash(path)] }),
    );
    assertReadOnlyGitCalls(calls);
    await assertNothingPublished(fixture);
  } finally {
    await fixture.cleanup();
  }
});

test("blob and aggregate source-byte limits refuse the complete resolution", async () => {
  const fixture = await materialisationFixture();
  try {
    const blobOid = fixture.effect.params.source.blobOid;
    const oversizeCalls: ProcessCall[] = [];
    const oversize = await adapterFor(
      fixture,
      streamedTreePort(
        treeRecord(blobOid, "docs/oversize.txt"),
        oversizeCalls,
        async (_executable, argv, options) => {
          if (
            argv.includes(
              "--batch-check=%(objectname) %(objecttype) %(objectsize)",
            ) &&
            options.input?.toString("ascii") === `${blobOid}\n`
          )
            return {
              code: 0,
              signal: null,
              stderr: Buffer.alloc(0),
              stdout: Buffer.from(
                `${blobOid} blob ${LIMITS.materialisationBlobBytes + 1}\n`,
                "ascii",
              ),
            };
          return undefined;
        },
      ),
    ).resolve(resolveEffect(fixture));
    assert.deepEqual(
      oversize,
      expectedResolutionRefusal("blob_too_large", { blobOid }),
    );
    assertReadOnlyGitCalls(oversizeCalls);
    await assertNothingPublished(fixture);

    const aggregateCalls: ProcessCall[] = [];
    const aggregate = await adapterFor(
      fixture,
      streamedTreePort(
        Buffer.concat([
          treeRecord(blobOid, "docs/first.txt"),
          treeRecord(blobOid, "docs/second.txt"),
        ]),
        aggregateCalls,
      ),
    ).resolve(
      resolveEffect(fixture, {
        remainingSourceByteCapacity: fixture.artifact.byteLength * 2 - 1,
      }),
    );
    assert.deepEqual(
      aggregate,
      expectedResolutionRefusal("wave_byte_limit", {
        byteCount: fixture.artifact.byteLength * 2,
      }),
    );
    assertReadOnlyGitCalls(aggregateCalls);
    await assertNothingPublished(fixture);
  } finally {
    await fixture.cleanup();
  }
});

test("an overlong matched raw tree path refuses the whole resolution", async () => {
  const fixture = await materialisationFixture();
  try {
    const port: MaterialisationProcessPort = {
      run: nodeMaterialisationProcess.run,
      runTree: async () => ({
        code: 0,
        parsingValid: true,
        retainedMatches: 1,
        signal: null,
        stderr: Buffer.alloc(0),
        stdout: Buffer.alloc(0),
        unsafeMatchedPathHash: "f".repeat(64),
      }),
    };
    const result = await adapterFor(fixture, port).resolve(
      resolveEffect(fixture),
    );
    assert.deepEqual(
      result,
      expectedResolutionRefusal("unsafe_path", {
        pathHash: "f".repeat(64),
      }),
    );
    await assertNothingPublished(fixture);
  } finally {
    await fixture.cleanup();
  }
});

test("destination probe distinguishes required and optional unmounted aliases", async () => {
  const fixture = await materialisationFixture();
  try {
    await rm(join(fixture.destinationRoot, ".sce-drive-marker"));
    const adapter = adapterFor(fixture);
    const required = await adapter.probe(probeEffect(fixture));
    assert.equal(required.status, "refused");
    if (required.status === "refused")
      assert.equal(required.refusal.code, "required_alias_unmounted");

    const optional = await adapter.probe(
      probeEffect(fixture, {
        destination: {
          ...fixture.effect.params.destination,
          mountPolicy: "optional",
        },
      }),
    );
    assert.equal(optional.status, "refused");
    if (optional.status === "refused")
      assert.equal(optional.refusal.code, "optional_alias_unmounted");
  } finally {
    await fixture.cleanup();
  }
});

test("destination probe refuses non-canonical paths and symlinked containment", async () => {
  const fixture = await materialisationFixture();
  try {
    const adapter = adapterFor(fixture);
    const nonCanonical = await adapter.probe(
      probeEffect(fixture, {
        destination: {
          ...fixture.effect.params.destination,
          canonicalRoot: `${fixture.destinationRoot}/../drive`,
        },
      }),
    );
    assert.equal(nonCanonical.status, "refused");
    if (nonCanonical.status === "refused")
      assert.equal(nonCanonical.refusal.code, "invalid_destination");

    await rm(fixture.destinationDirectory, { recursive: true });
    const elsewhere = join(fixture.root, "elsewhere");
    await mkdir(elsewhere);
    await symlink(elsewhere, fixture.destinationDirectory, "dir");
    const linked = await adapter.probe(probeEffect(fixture));
    assert.equal(linked.status, "refused");
    if (linked.status === "refused")
      assert.equal(linked.refusal.code, "invalid_destination");
  } finally {
    await fixture.cleanup();
  }
});

test("destination reprobe rejects an identity that no longer names the admitted inode", async () => {
  const fixture = await materialisationFixture();
  try {
    const result = await adapterFor(fixture).probe(
      probeEffect(fixture, {
        expectedPriorIdentity: {
          ...fixture.effect.params.destinationIdentity,
          inode: "0",
        },
      }),
    );
    assert.equal(result.status, "ambiguous");
  } finally {
    await fixture.cleanup();
  }
});
