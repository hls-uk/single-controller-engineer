import assert from "node:assert/strict";
import test from "node:test";

import {
  createMaterialisationAdapter,
  nodeMaterialisationProcess,
  type MaterialisationProcessPort,
} from "../../../src/adapters/materialise/index.js";
import { canonicalJson } from "../../../src/protocol/canonical.js";
import { sha256 } from "../../../src/protocol/evidence.js";
import { LIMITS, type RuntimeEffect } from "../../../src/protocol/schemas.js";

type ResolveEffect = Extract<
  RuntimeEffect,
  { kind: "materialisation_resolve" }
>;

const sourceOid = "a".repeat(40);
const pattern = "docs/*.txt";
/** `100644 blob <40 hex>\tdocs/report.txt\0` */
const recordBytes = 69;

/**
 * Emits only records the pattern matches, so a scan that stopped on matched
 * volume rather than on scanned volume would keep reading this listing.
 */
function emitter(records: number): readonly string[] {
  return [
    "-e",
    [
      `const record = Buffer.from("100644 blob ${sourceOid}\\tdocs/report.txt\\0");`,
      `for (let index = 0; index < ${records}; index += 1) process.stdout.write(record);`,
    ].join(""),
  ];
}

async function scan(records: number, maxScanBytes: number) {
  const runTree = nodeMaterialisationProcess.runTree;
  assert.ok(runTree);
  return await runTree(
    process.execPath,
    emitter(records),
    {
      cwd: "/tmp",
      env: { PATH: "/usr/bin:/bin" },
      maxOutputBytes: 8_192,
      maxScanBytes,
    },
    pattern,
  );
}

function resolveEffect(): ResolveEffect {
  const gateEntryId = `sce:gate:${"d".repeat(64)}`;
  return {
    effectId: "event-1:materialisation_resolve",
    gateEntryId,
    idempotencyKey: sha256("resolve-scan-valve"),
    kind: "materialisation_resolve",
    params: {
      destinationProbeGateEntryId: `sce:gate:${"c".repeat(64)}`,
      domainScope: "knowledge",
      driver: "SCE adapter test",
      executorTool: "codex",
      gateEntryId,
      originUnitId: "unit-1",
      remainingAggregateEnvelopeByteCapacity: LIMITS.envelopeBytes,
      remainingItemCapacity: LIMITS.materialisationOutputs,
      remainingProjectionSnapshotByteCapacity: 65_536,
      remainingSourceByteCapacity: LIMITS.materialisationWaveBytes,
      repositoryIdentity: "repo-1",
      runId: "run-1",
      sourceOid,
      sourcePattern: pattern,
      stage: "unit",
      target: {
        destinationAlias: "drive",
        destinationSubpath: "published",
        namingPolicy: "source-basename",
        sidecarRequired: true,
        sourcePattern: pattern,
      },
      targetId: `sce:tgt:${"e".repeat(64)}`,
      targetOrdinal: 0,
      waveId: "wave-1",
    },
    paramsHash: sha256("resolve-scan-valve-params"),
    schemaVersion: 1,
    unitId: null,
  };
}

/**
 * Answers the object-format and object-info probes from memory and streams the
 * listing through the real scan, so only the scan valve decides the outcome.
 */
function scanningPort(records: number, maxScanBytes: number) {
  const runTree = nodeMaterialisationProcess.runTree;
  assert.ok(runTree);
  const scanCaps: (number | undefined)[] = [];
  const port: MaterialisationProcessPort = {
    run: async (executable, argv, options) => {
      assert.equal(executable, "/usr/bin/git");
      const stdout = argv.includes("rev-parse")
        ? "sha1\n"
        : `${sourceOid} commit 3\n`;
      if (!argv.includes("rev-parse")) {
        assert.ok(argv.includes("cat-file"));
        assert.deepEqual(options.input, Buffer.from(`${sourceOid}\n`, "ascii"));
      }
      return {
        code: 0,
        signal: null,
        stderr: Buffer.alloc(0),
        stdout: Buffer.from(stdout, "ascii"),
      };
    },
    runTree: async (_executable, _argv, options, sourcePattern) => {
      scanCaps.push(options.maxScanBytes);
      return await runTree(
        process.execPath,
        emitter(records),
        { ...options, maxScanBytes },
        sourcePattern,
      );
    },
  };
  return { port, scanCaps };
}

test("the bounded tree scan retains a matched listing that stays under its cap", async () => {
  const result = await scan(4, 4 * recordBytes);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.parsingValid, true);
  assert.equal(result.retainedMatches, 4);
  assert.equal(result.stdout.byteLength, 4 * recordBytes);
});

test("a listing under the cap counts every match while retention stays bounded", async () => {
  const result = await scan(4_096, 4_096 * recordBytes);
  assert.equal(result.parsingValid, true);
  assert.equal(result.retainedMatches, 4_096);
  assert.ok(
    result.stdout.byteLength <=
      (LIMITS.materialisationMatches + 1) * recordBytes,
  );
});

test("the bounded tree scan fails an over-cap listing closed and retains nothing", async () => {
  const result = await scan(4_096, 4 * recordBytes);
  assert.equal(result.parsingValid, false);
  assert.equal(result.retainedMatches, 0);
  assert.equal(result.stdout.byteLength, 0);
  assert.equal(result.stderr.byteLength, 0);
});

test("an over-cap tree scan refuses the resolution as ambiguous ls-tree", async () => {
  const { port, scanCaps } = scanningPort(4_096, 4 * recordBytes);
  const adapter = createMaterialisationAdapter("/tmp", "sha1", port);
  assert.deepEqual(await adapter.resolve(resolveEffect()), {
    observationHash: sha256(
      canonicalJson({
        domain: "sce.materialisation-ambiguous.v1",
        facts: { operation: "ls-tree", sourceOid },
      }),
    ),
    status: "ambiguous",
  });
  assert.equal(scanCaps.length, 1);
  const declared = scanCaps[0];
  assert.ok(declared !== undefined && declared > 0);
  assert.ok(declared <= LIMITS.materialisationWaveBytes);
});
