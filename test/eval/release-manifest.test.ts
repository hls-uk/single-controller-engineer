import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.equal(manifest.expectedFiles.length, 18);
  assert.deepEqual(manifest.skipPatterns, [
    "64 retained units complete 16 repairs in waves of at most three within the envelope",
  ]);
});
