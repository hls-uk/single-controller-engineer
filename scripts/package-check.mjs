import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(new URL("..", import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), "sce-pack-"));
try {
  const cache = join(temporary, "cache");
  await mkdir(cache);
  const { stdout } = await run(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--offline",
      "--cache",
      cache,
      "--pack-destination",
      temporary,
    ],
    { cwd: root },
  );
  const packed = JSON.parse(stdout)[0];
  const files = packed.files.map((entry) => entry.path).sort();
  const expected = [
    "LICENSE",
    "README.md",
    "package.json",
    "skills/single-controller-engineer/SKILL.md",
    "skills/single-controller-engineer/agents/claude.yaml",
    "skills/single-controller-engineer/agents/openai.yaml",
    "skills/single-controller-engineer/references/accelerated-beta.md",
    "skills/single-controller-engineer/references/beads-embedded.md",
    "skills/single-controller-engineer/references/beads-server.md",
    "skills/single-controller-engineer/references/controller-contract.md",
    "skills/single-controller-engineer/references/model-routing.md",
    "skills/single-controller-engineer/references/protocol-state.md",
    "skills/single-controller-engineer/scripts/sce.mjs",
    "skills/single-controller-knowledge/SKILL.md",
    "skills/single-controller-knowledge/agents/claude.yaml",
    "skills/single-controller-knowledge/agents/openai.yaml",
    "skills/single-controller-knowledge/references/knowledge-contract.md",
    "skills/single-controller-knowledge/references/knowledge-severity.md",
    "skills/single-controller-knowledge/references/manifest/checks/README.md",
    "skills/single-controller-knowledge/references/manifest/checks/check-boundary.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/check-frontmatter.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/check-generated.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/check-markdown-format.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/check-provenance.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/check-relative-links.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/check-secrets.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/check-supersession.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/lib.mjs",
    "skills/single-controller-knowledge/references/manifest/checks/validate-manifest.mjs",
    "skills/single-controller-knowledge/references/manifest/knowledge-manifest.schema.json",
    "skills/single-controller-knowledge/references/manifest/provenance-record.schema.json",
    "skills/single-controller-knowledge/references/materialisation.md",
    "skills/single-controller-knowledge/references/provenance.md",
    "skills/single-controller-knowledge/references/repository-manifest.md",
    "skills/single-controller-feedback/SKILL.md",
    "skills/single-controller-feedback/agents/claude.yaml",
    "skills/single-controller-feedback/agents/openai.yaml",
    "skills/single-controller-feedback/references/feedback-contract.md",
  ].sort();
  if (JSON.stringify(files) !== JSON.stringify(expected))
    throw new Error(`unexpected npm tarball files: ${JSON.stringify(files)}`);
  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  if (packageJson.scripts.postinstall !== undefined)
    throw new Error("postinstall must be absent");
  const unpacked = join(temporary, "unpacked");
  await mkdir(unpacked);
  await run("tar", ["-xzf", join(temporary, packed.filename), "-C", unpacked]);
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const sourceBundle = await readFile(
    join(root, "skills/single-controller-engineer/scripts/sce.mjs"),
  );
  const packedBundle = await readFile(
    join(unpacked, "package/skills/single-controller-engineer/scripts/sce.mjs"),
  );
  if (digest(sourceBundle) !== digest(packedBundle))
    throw new Error("packed CLI bundle differs from reviewed source bundle");
  const fixture = join(temporary, "offline-install");
  const fixtureCache = join(temporary, "offline-cache");
  await mkdir(fixture);
  await mkdir(fixtureCache);
  await writeFile(
    join(fixture, "package.json"),
    '{"name":"sce-offline-fixture","private":true,"version":"1.0.0"}\n',
  );
  await run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      join(temporary, packed.filename),
    ],
    { cwd: fixture, env: { ...process.env, npm_config_cache: fixtureCache } },
  );
  const { stdout: installedVersion } = await run(
    join(fixture, "node_modules/.bin/sce"),
    ["--version"],
    { cwd: fixture },
  );
  const installedResponse = JSON.parse(installedVersion);
  if (
    installedResponse.ok !== true ||
    installedResponse.result?.version !== packageJson.version
  )
    throw new Error("offline-installed CLI reported an unexpected version");
  const harnessRequest = {
    acceptance: ["npm test"],
    baseOid: "a".repeat(40),
    mandatoryVerification: ["npm test"],
    ownedPaths: ["src/index.ts"],
    role: "worker",
    unitId: "package-smoke",
  };
  const installedCli = join(fixture, "node_modules/.bin/sce");
  const { stdout: harnessOutput } = await run(
    installedCli,
    ["harness-packet", "--request", JSON.stringify(harnessRequest)],
    { cwd: fixture },
  );
  if (JSON.parse(harnessOutput).ok !== true)
    throw new Error("offline-installed CLI could not create a harness packet");
  const telemetry = {
    capabilityId: "feedback.submit",
    component: "runtime",
    kind: "bug",
    protocolState: "failed",
    requestedModelTier: "workhorse",
    stableErrorCode: "SCE_PACKAGE_SMOKE",
    toolVersion: packageJson.version,
    toolchain: "node-22",
  };
  const { stdout: preparedOutput } = await run(
    installedCli,
    ["feedback", "prepare", "--request", JSON.stringify({ telemetry })],
    { cwd: fixture },
  );
  const prepared = JSON.parse(preparedOutput);
  if (prepared.ok !== true || prepared.result?.packet === undefined)
    throw new Error("offline-installed CLI could not prepare feedback");
  const { stdout: previewOutput } = await run(
    installedCli,
    [
      "feedback",
      "preview",
      "--request",
      JSON.stringify({ packet: prepared.result.packet }),
    ],
    { cwd: fixture },
  );
  if (JSON.parse(previewOutput).ok !== true)
    throw new Error("offline-installed CLI could not preview feedback");
  const skillDestination = join(fixture, "host-skills");
  const { stdout: dryRunOutput } = await run(
    installedCli,
    [
      "install-skill",
      "--host",
      "codex",
      "--destination",
      skillDestination,
      "--dry-run",
    ],
    { cwd: fixture },
  );
  const dryRun = JSON.parse(dryRunOutput);
  if (dryRun.ok !== true || dryRun.result?.status !== "dry-run")
    throw new Error(
      "offline-installed CLI could not dry-run skill installation",
    );
  const { stdout: installedSkillOutput } = await run(
    installedCli,
    ["install-skill", "--host", "claude", "--destination", skillDestination],
    { cwd: fixture },
  );
  const installedSkills = JSON.parse(installedSkillOutput);
  const recordedManifest = JSON.parse(
    await readFile(join(skillDestination, ".sce-skill-install.json"), "utf8"),
  );
  if (
    installedSkills.ok !== true ||
    installedSkills.result?.status !== "installed" ||
    JSON.stringify(installedSkills.result.manifest) !==
      JSON.stringify(recordedManifest) ||
    JSON.stringify(dryRun.result.manifest) !==
      JSON.stringify(recordedManifest) ||
    recordedManifest.skills?.["single-controller-engineer"] !==
      packageJson.version ||
    recordedManifest.skills?.["single-controller-knowledge"] !==
      packageJson.version ||
    recordedManifest.skills?.["single-controller-feedback"] !==
      packageJson.version
  )
    throw new Error("offline-installed skill set disagrees with its manifest");
  console.log(
    JSON.stringify(
      {
        bundleSha256: digest(sourceBundle),
        fileCount: files.length,
        files,
        tarball: packed.filename,
        version: installedResponse.result.version,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
