import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { GitRepository } from "../../../src/adapters/git/index.js";
import type { KnowledgeContract } from "../../../src/protocol/schemas.js";

const EXAMPLE = resolve(
  import.meta.dirname,
  "../../../examples/knowledge-repository",
);
export const CHECKS = resolve(
  import.meta.dirname,
  "../../../skills/single-controller-knowledge/references/manifest/checks",
);

export function git(cwd: string, ...argv: string[]): string {
  const result = spawnSync("/usr/bin/git", argv, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_NAME: "SCE Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "SCE Fixture",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
  });
  assert.equal(
    result.status,
    0,
    `git ${argv.join(" ")} failed: ${result.stderr}`,
  );
  return result.stdout.trim();
}

export type ProvenanceFixture = Readonly<{
  baseOid: string;
  driveRoot: string;
  gitRepository: GitRepository;
  landedOid: string;
  landedTreeOid: string;
  remote?: string;
  repository: string;
  root: string;
  worktreeRoot: string;
  contract(overrides?: Partial<KnowledgeContract>): KnowledgeContract;
  cleanup(): Promise<void>;
}>;

/**
 * A knowledge repository cloned from the shipped example, with one base
 * commit and one landed unit commit on `main`, an empty events directory,
 * and (optionally) a local bare remote already holding `main`.
 */
export async function provenanceFixture(
  options: Readonly<{ remote?: boolean }> = {},
): Promise<ProvenanceFixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sce-provenance-")));
  const repository = join(root, "repository");
  await cp(EXAMPLE, repository, { recursive: true });
  await rm(join(repository, "events", "example-event.md"), { force: true });
  // The protocol fixtures' launch packets bind owned path `src`; admit it as
  // a write root so the projected record passes the repository's boundary
  // policy exactly as a real task card would.
  const manifestPath = join(repository, "knowledge-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    boundaryPolicy: { allowedWriteRoots: string[] };
  };
  manifest.boundaryPolicy.allowedWriteRoots.push("src");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(repository, "generated", "timeline.md"),
    "# Knowledge timeline\n\nNo provenance events recorded.\n",
    "utf8",
  );
  git(repository, "init", "-q", "-b", "main", "--object-format=sha1");
  git(repository, "add", "-A");
  git(repository, "commit", "-q", "-m", "base");
  const baseOid = git(repository, "rev-parse", "HEAD");
  await appendFile(
    join(repository, "knowledge", "current", "access-guide.md"),
    "\nLanded by the fixture unit.\n",
    "utf8",
  );
  git(repository, "add", "-A");
  git(repository, "commit", "-q", "-m", "landed unit");
  const landedOid = git(repository, "rev-parse", "HEAD");
  const landedTreeOid = git(repository, "rev-parse", `${landedOid}^{tree}`);
  const worktreeRoot = join(root, "provenance");
  const driveRoot = join(root, "drive");
  await mkdir(worktreeRoot);
  await mkdir(driveRoot);
  const commonDir = await realpath(join(repository, ".git"));
  let remote: string | undefined;
  if (options.remote === true) {
    remote = join(root, "remote.git");
    git(
      root,
      "init",
      "-q",
      "--bare",
      "-b",
      "main",
      "--object-format=sha1",
      remote,
    );
    git(repository, "remote", "add", "origin", remote);
    git(repository, "push", "-q", "origin", "main");
  }
  const gitRepository: GitRepository = {
    commonDir,
    cwd: repository,
    identity: remote === undefined ? `local:${commonDir}` : "provider:fixture",
    objectFormat: "sha1",
    remoteUrls: remote === undefined ? [] : [remote],
  };
  const contract = (
    overrides: Partial<KnowledgeContract> = {},
  ): KnowledgeContract => ({
    aliases: [
      {
        alias: "partner-drive",
        canonicalRoot: driveRoot,
        markerFile: ".sce-drive-root",
        mountPolicy: "optional",
        namespaceControl: "exclusive",
      },
    ],
    audience: "example-internal",
    combinedVerificationCommands: [
      ["node", join(CHECKS, "check-markdown-format.mjs")],
      ["node", join(CHECKS, "check-provenance.mjs")],
      ["node", join(CHECKS, "check-generated.mjs")],
    ],
    domainScope: "example.internal",
    gateTargets: [],
    humanDriver: "Example Knowledge Lead",
    projectId: "example-knowledge",
    provenance: {
      eventsDirectory: "events",
      generatedDirectory: "generated",
      recordFormatVersion: 1,
      reproducibilityCommand: ["node", join(CHECKS, "check-generated.mjs")],
      rollupGeneratorCommand: ["node", "scripts/generate-rollup.mjs"],
    },
    provenanceWorktreeRoot: worktreeRoot,
    ...overrides,
  });
  return {
    baseOid,
    cleanup: async () => await rm(root, { force: true, recursive: true }),
    contract,
    driveRoot,
    gitRepository,
    landedOid,
    landedTreeOid,
    ...(remote === undefined ? {} : { remote }),
    repository,
    root,
    worktreeRoot,
  };
}
