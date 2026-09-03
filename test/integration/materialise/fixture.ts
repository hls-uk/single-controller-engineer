import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  createMaterialisationAdapter,
  nodeMaterialisationProcess,
  type MaterialisationProcessPort,
} from "../../../src/adapters/materialise/index.js";
import { canonicalJson } from "../../../src/protocol/canonical.js";
import type { RuntimeEffect } from "../../../src/protocol/schemas.js";

export type ResolveEffect = Extract<
  RuntimeEffect,
  { kind: "materialisation_resolve" }
>;
export type ProbeEffect = Extract<RuntimeEffect, { kind: "destination_probe" }>;
export type MaterialiseEffect = Extract<RuntimeEffect, { kind: "materialise" }>;

export const hash = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

export function git(cwd: string, ...argv: string[]): Buffer {
  const result = spawnSync("/usr/bin/git", argv, {
    cwd,
    encoding: null,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `git ${argv.join(" ")} failed: ${result.stderr.toString("utf8")}`,
  );
  return result.stdout;
}

export function gitText(cwd: string, ...argv: string[]): string {
  return git(cwd, ...argv)
    .toString("utf8")
    .trim();
}

export type MaterialisationFixture = Readonly<{
  artifact: Buffer;
  destinationDirectory: string;
  destinationRoot: string;
  effect: MaterialiseEffect;
  repository: string;
  root: string;
  sidecar: Buffer;
  cleanup(): Promise<void>;
}>;

export async function materialisationFixture(): Promise<MaterialisationFixture> {
  const createdRoot = await mkdtemp(join(tmpdir(), "sce-materialise-"));
  const root = await realpath(createdRoot);
  const repository = join(root, "repository");
  const destinationRoot = join(root, "drive");
  const destinationDirectory = join(destinationRoot, "published");
  await mkdir(repository);
  git(repository, "init", "-q", "--object-format=sha1");
  await mkdir(join(repository, "docs"));
  const artifact = Buffer.from("accepted artifact\n", "utf8");
  await writeFile(join(repository, "docs", "report.txt"), artifact);
  git(repository, "add", "docs/report.txt");
  git(
    repository,
    "-c",
    "user.name=SCE Test",
    "-c",
    "user.email=sce@example.invalid",
    "commit",
    "-q",
    "-m",
    "fixture",
  );
  const sourceOid = gitText(repository, "rev-parse", "HEAD");
  const blobOid = gitText(
    repository,
    "rev-parse",
    `${sourceOid}:docs/report.txt`,
  );

  await mkdir(destinationDirectory, { recursive: true });
  await writeFile(join(destinationRoot, ".sce-drive-marker"), "fixture\n");
  const identity = await stat(destinationDirectory, { bigint: true });
  const timestamp = "2026-09-03T10:20:30Z";
  const artifactName = `report--${blobOid.slice(0, 12)}--20260903T102030Z.txt`;
  const gateEntryId = `sce:gate:${"a".repeat(64)}`;
  const sidecarValue = {
    artifactName,
    blobOid,
    byteCount: artifact.byteLength,
    destinationAlias: "drive",
    destinationSubpath: "published",
    domainScope: "knowledge",
    driver: "SCE integration test",
    executorTool: "codex",
    gateEntryId,
    originUnitId: "unit-1",
    runId: "run-1",
    schema: "sce.materialisation-provenance" as const,
    sha256: hash(artifact),
    sourceOid,
    sourcePath: "docs/report.txt",
    targetId: `sce:tgt:${"b".repeat(64)}`,
    timestamp,
    version: 1 as const,
    waveId: "wave-1",
  };
  const sidecar = Buffer.from(`${canonicalJson(sidecarValue)}\n`, "utf8");
  const effect: MaterialiseEffect = {
    effectId: "event-1:materialise",
    gateEntryId,
    idempotencyKey: hash("materialise-fixture"),
    kind: "materialise",
    params: {
      artifactName,
      destination: {
        alias: "drive",
        canonicalRoot: destinationRoot,
        markerFile: ".sce-drive-marker",
        mountPolicy: "required",
        namespaceControl: "exclusive",
      },
      destinationIdentity: {
        canonicalPath: destinationDirectory,
        device: String(identity.dev),
        inode: String(identity.ino),
      },
      destinationProbeGateEntryId: `sce:gate:${"c".repeat(64)}`,
      destinationSubpath: "published",
      domainScope: "knowledge",
      driver: "SCE integration test",
      executorTool: "codex",
      gateEntryId,
      namespaceControl: "exclusive",
      originUnitId: "unit-1",
      repositoryIdentity: "repo-1",
      runId: "run-1",
      sidecarByteCount: sidecar.byteLength,
      sidecarBytes: sidecar.toString("utf8"),
      sidecarName: `${artifactName}.sce-provenance.json`,
      sidecarSha256: hash(sidecar),
      source: {
        blobOid,
        byteCount: artifact.byteLength,
        path: "docs/report.txt",
        sha256: hash(artifact),
      },
      sourceOid,
      targetId: `sce:tgt:${"b".repeat(64)}`,
      timestamp,
      waveId: "wave-1",
    },
    paramsHash: hash("materialise-params"),
    schemaVersion: 1,
    unitId: null,
  };

  return {
    artifact,
    cleanup: async () => await rm(root, { force: true, recursive: true }),
    destinationDirectory,
    destinationRoot,
    effect,
    repository,
    root,
    sidecar,
  };
}

export function adapterFor(
  fixture: MaterialisationFixture,
  processPort: MaterialisationProcessPort = nodeMaterialisationProcess,
) {
  return createMaterialisationAdapter(fixture.repository, "sha1", processPort);
}

export function transformHelper(
  transform: (source: string) => string,
): MaterialisationProcessPort {
  return {
    run: async (executable, argv, options) => {
      if (executable !== process.execPath || argv[0] !== "-e")
        return await nodeMaterialisationProcess.run(executable, argv, options);
      assert.equal(typeof argv[1], "string", "helper source must be argv[1]");
      return await nodeMaterialisationProcess.run(
        executable,
        ["-e", transform(argv[1]!)],
        options,
      );
    },
  };
}

export function replaceHelperSource(
  source: string,
  needle: string,
  replacement: string,
): string {
  assert.ok(source.includes(needle), `missing helper seam: ${needle}`);
  return source.replace(needle, replacement);
}
