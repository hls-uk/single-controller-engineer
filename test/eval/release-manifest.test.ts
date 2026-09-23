import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("release evidence retains deferred suites and the honest clone-lineage boundary", async () => {
  const manifest = JSON.parse(
    await readFile(resolve("test/release.manifest.json"), "utf8"),
  ) as {
    deferred: string[];
    cloneLineageBoundary: { acceptedEdges: number; refusedEdges: number };
    requiredTests: Array<{ file: string; name: string }>;
  };
  assert.equal(manifest.cloneLineageBoundary.acceptedEdges, 64);
  assert.equal(manifest.cloneLineageBoundary.refusedEdges, 65);
  assert.deepEqual(manifest.deferred.sort(), [
    "crash",
    "live-agent",
    "protocol-stress",
    "provider",
    "topology",
  ]);
  assert.deepEqual(manifest.requiredTests, [
    {
      file: "test/release/production-lineage.test.ts",
      name: "production clone-lineage proof accepts exactly 64 permitted metadata edges",
    },
    {
      file: "test/adapters/beads-embedded/matrix.test.ts",
      name: "clone pull lineage rejects cycles, multiple authorities, and 65 nested branches before pull",
    },
  ]);
});

test("fast test manifest is explicit, recursive-root based, and names its single slow boundary", async () => {
  const manifest = JSON.parse(
    await readFile(resolve("test/fast.manifest.json"), "utf8"),
  ) as {
    budgetSeconds: number;
    expectedFiles: string[];
    roots: string[];
    skipPatterns: string[];
  };
  assert.equal(manifest.budgetSeconds, 60);
  assert.ok(manifest.roots.every((root) => root.startsWith("test/")));
  assert.equal(manifest.expectedFiles.length, 24);
  assert.deepEqual(manifest.skipPatterns, [
    "64 retained units complete 16 repairs in waves of at most three within the envelope",
  ]);
});

// A suite is release-only when it spawns a real bd, dolt, or provider process,
// or pins an absolute tool path, so it cannot run on an arbitrary machine
// inside a mandatory gate. Everything else deterministic belongs to a tier the
// validation workflow actually runs.
const releaseOnlyTests = [
  "test/adapters/beads-embedded/matrix.test.ts",
  "test/adapters/beads-embedded/real-bd-first-acquire.test.ts",
  "test/adapters/beads-embedded/real-bd.test.ts",
  "test/adapters/beads-server/server.test.ts",
  "test/release/knowledge-drive.test.ts",
  "test/release/production-lineage.test.ts",
];

async function testFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await testFiles(path)));
    else if (entry.name.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

test("every suite is claimed by exactly one tier and the deterministic seams are mandatory", async () => {
  const source = await readFile(resolve("scripts/test-tier.mjs"), "utf8");
  const declaration = source.match(
    /^const integrationRoots = \[\n((?:  "test\/[^"\n]+",\n)+)\];$/mu,
  );
  assert.ok(
    declaration,
    "scripts/test-tier.mjs no longer declares integrationRoots as a literal manifest",
  );
  assert.match(source, /^const integrationBudgetSeconds = 90;$/mu);
  const integration = (
    await Promise.all(
      [...declaration[1]!.matchAll(/"([^"]+)"/gu)].map(async (match) =>
        match[1]!.endsWith(".test.ts") ? [match[1]!] : testFiles(match[1]!),
      ),
    )
  ).flat();
  const fast = (
    JSON.parse(await readFile(resolve("test/fast.manifest.json"), "utf8")) as {
      expectedFiles: string[];
    }
  ).expectedFiles;

  const claimed = [...fast, ...integration, ...releaseOnlyTests];
  assert.equal(
    new Set(claimed).size,
    claimed.length,
    "a suite is claimed by more than one tier",
  );
  assert.deepEqual(
    [...claimed].sort(),
    (await testFiles("test")).sort(),
    "triage every suite into test/fast.manifest.json, integrationRoots in scripts/test-tier.mjs, or releaseOnlyTests here",
  );

  // The fencing seam and the pinned adapter seams guard refusals that a
  // reviewer would otherwise have to reproduce by hand.
  assert.ok(fast.includes("test/fencing/fencing.test.ts"));
  for (const seam of [
    "test/adapters/beads-embedded/adapter.test.ts",
    "test/adapters/beads-embedded/pinned-output-budget.test.ts",
    "test/adapters/materialise/namespace-binding.test.ts",
  ])
    assert.ok(
      integration.includes(seam),
      `seam outside a mandatory tier: ${seam}`,
    );
});
