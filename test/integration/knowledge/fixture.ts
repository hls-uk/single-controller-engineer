import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import type { GitRepository } from "../../../src/adapters/git/index.js";
import {
  git,
  provenanceFixture,
  type ProvenanceFixture,
} from "../provenance/fixture.js";

export { CHECKS, git } from "../provenance/fixture.js";

export type CloneFixture = Readonly<{
  gitRepository: GitRepository;
  repository: string;
  worktreeRoot: string;
}>;

export type TwoCloneFixture = ProvenanceFixture &
  Readonly<{
    /** The second clone of the same bare remote, on the same machine. */
    cloneB: CloneFixture;
    remote: string;
  }>;

/**
 * One knowledge repository, one local bare remote holding `main`, and two
 * clones of it: the provenance fixture's clone A and a fresh clone B with its
 * own provenance worktree root. Both clones share the remote identity.
 */
export async function twoCloneFixture(): Promise<TwoCloneFixture> {
  const base = await provenanceFixture({ remote: true });
  const remote = base.remote!;
  const repository = join(base.root, "clone-b");
  git(base.root, "clone", "-q", "--branch", "main", remote, repository);
  const worktreeRoot = join(base.root, "provenance-b");
  const commonDir = await realpath(join(repository, ".git"));
  await mkdir(worktreeRoot);
  return {
    ...base,
    cloneB: {
      gitRepository: {
        commonDir,
        cwd: repository,
        identity: "provider:fixture",
        objectFormat: "sha1",
        remoteUrls: [remote],
      },
      repository,
      worktreeRoot,
    },
    remote,
  };
}
