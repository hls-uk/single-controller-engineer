import { spawn } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tier = process.argv[2];

async function discover(path) {
  const kind = await lstat(path);
  if (kind.isSymbolicLink())
    throw new Error(`refusing symlinked test path: ${path}`);
  if (kind.isFile()) return path.endsWith(".test.ts") ? [path] : [];
  if (!kind.isDirectory()) return [];
  const files = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink())
      throw new Error(`refusing symlinked test path: ${entry.name}`);
    files.push(...(await discover(resolve(path, entry.name))));
  }
  return files;
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

// The integration tier is a manifest, not a directory glob: every deterministic
// seam suite it discovers is named here, so a change to a fenced adapter
// boundary cannot pass both mandatory gates unobserved. A suite that spawns a
// real bd, dolt, or provider process, or that pins an absolute tool path, stays
// in the release tier instead.
const integrationRoots = [
  "test/adapters/beads-embedded/adapter.test.ts",
  "test/adapters/beads-embedded/carry.test.ts",
  "test/adapters/beads-embedded/closure.test.ts",
  "test/adapters/beads-embedded/dolt-diff-json.test.ts",
  "test/adapters/beads-embedded/pinned-issue-row.test.ts",
  "test/adapters/beads-embedded/pinned-output-budget.test.ts",
  "test/adapters/beads-server/carry.test.ts",
  "test/adapters/git/git.test.ts",
  "test/adapters/materialise/namespace-binding.test.ts",
  "test/adapters/materialise/tree-scan-valve.test.ts",
  "test/commands/production-recovery.test.ts",
  "test/commands/recovery-embedded.test.ts",
  "test/commands/recovery-server.test.ts",
  "test/integration",
];
// The tier measures under 10s on a development machine because the runner
// executes the files in parallel. The bound refuses a real-tool suite that
// drifted in (those run for minutes); it does not police ordinary growth.
const integrationBudgetSeconds = 90;

if (!new Set(["fast", "integration", "release"]).has(tier))
  throw new Error("expected fast, integration, or release tier");
let files;
let budget;
let skipPatterns = [];
if (tier === "fast") {
  const manifest = JSON.parse(
    await readFile(resolve(root, "test/fast.manifest.json"), "utf8"),
  );
  if (
    !exactKeys(manifest, [
      "budgetSeconds",
      "expectedFiles",
      "roots",
      "schema",
      "skipPatterns",
      "version",
    ]) ||
    manifest.schema !== "sce.fast-tests" ||
    manifest.version !== 1 ||
    !Number.isInteger(manifest.budgetSeconds) ||
    manifest.budgetSeconds < 1 ||
    !Array.isArray(manifest.roots) ||
    !Array.isArray(manifest.expectedFiles) ||
    !Array.isArray(manifest.skipPatterns)
  )
    throw new Error("invalid fast test manifest");
  if (
    !manifest.roots.every(
      (path) =>
        typeof path === "string" &&
        path.startsWith("test/") &&
        !path.includes(".."),
    ) ||
    !manifest.expectedFiles.every(
      (path) =>
        typeof path === "string" &&
        path.startsWith("test/") &&
        path.endsWith(".test.ts"),
    ) ||
    JSON.stringify(manifest.skipPatterns) !==
      JSON.stringify([
        "64 retained units complete 16 repairs in waves of at most three within the envelope",
      ])
  )
    throw new Error("unsafe fast test manifest");
  files = (
    await Promise.all(
      manifest.roots.map((path) => discover(resolve(root, path))),
    )
  )
    .flat()
    .sort();
  const expected = [...manifest.expectedFiles].sort();
  const actual = files.map((path) => relative(root, path));
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  )
    throw new Error(
      `fast test discovery differs from manifest: ${JSON.stringify(actual)}`,
    );
  budget = manifest.budgetSeconds;
  skipPatterns = manifest.skipPatterns;
} else if (tier === "integration") {
  if (
    !integrationRoots.every(
      (path) =>
        typeof path === "string" &&
        path.startsWith("test/") &&
        !path.includes(".."),
    )
  )
    throw new Error("unsafe integration test roots");
  files = (
    await Promise.all(
      integrationRoots.map((path) => discover(resolve(root, path))),
    )
  )
    .flat()
    .sort();
  const discovered = files.map((path) => relative(root, path));
  if (new Set(discovered).size !== discovered.length)
    throw new Error(
      `integration test discovery repeats a file: ${JSON.stringify(discovered)}`,
    );
  budget = integrationBudgetSeconds;
} else {
  files = (
    await discover(resolve(root, "test")).catch((error) =>
      error.code === "ENOENT" ? [] : Promise.reject(error),
    )
  ).sort();
}
if (files.length === 0) throw new Error(`no ${tier} tests discovered`);
console.log(files.map((file) => relative(root, file)).join("\n"));
const started = performance.now();
const code = await new Promise((complete) => {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      ...(tier === "fast"
        ? skipPatterns.flatMap((pattern) => ["--test-skip-pattern", pattern])
        : []),
      ...files,
    ],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    },
  );
  child.once("exit", (status, signal) => complete(signal ? 1 : (status ?? 1)));
});
if (code !== 0) process.exitCode = code;
const elapsed = (performance.now() - started) / 1_000;
if (budget !== undefined && elapsed > budget)
  throw new Error(
    `${tier} test budget exceeded: ${elapsed.toFixed(2)}s > ${budget}s`,
  );
console.log(`${tier} test tier completed in ${elapsed.toFixed(2)}s`);
