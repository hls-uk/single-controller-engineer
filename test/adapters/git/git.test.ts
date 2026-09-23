import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  DISCOVERY_DEPTH,
  type GitRepository,
  GitRepositorySchema,
  type GitResult,
  GitResultSchema,
  type GitRunner,
  allowedGitRequest,
  commitIdentityEnvironment,
  createProvenanceCommit,
  discoverDetachedWorktree,
  discoverIntegration,
  discoverRefresh,
  discoverRemoteIntegration,
  discoverWorktree,
  ensureBranch,
  ensureDetachedWorktree,
  ensureWorktree,
  fetchIntegrationBranch,
  findCommitByTrailer,
  integrateLocalFastForward,
  integrateRemoteFastForward,
  integrationRefHead,
  integrationTreeClean,
  isGitSchema,
  nodeGitRunner,
  observeCandidate,
  publishCandidate,
  readCommit,
  readRefOid,
  readTreeFiles,
  refreshCandidate,
  setDetachedHead,
  verifyCandidateWorktree,
  verifyRepository,
  writeWorktreeTree,
} from "../../../src/adapters/git/index.js";

const execFile = promisify(execFileCallback);
const sha1 = (digit: string): string => digit.repeat(40);
const repository = (): GitRepository => ({
  commonDir: "/repo/.git",
  cwd: "/repo",
  identity: "provider:fixture",
  objectFormat: "sha1",
  remoteUrls: ["https://example.invalid/repo.git"],
});

const ok = (stdout = ""): GitResult => ({
  exitCode: 0,
  signal: null,
  stdout,
});
const failed = (): GitResult => ({ exitCode: 1, signal: null, stdout: "" });

function scripted(...results: GitResult[]): GitRunner {
  return async () => results.shift() ?? failed();
}

function identityResults(): GitResult[] {
  return [
    ok("/repo/.git\n"),
    ok("sha1\n"),
    ok("remote.origin.url\nhttps://example.invalid/repo.git\u0000"),
  ];
}

/**
 * The final clean status completes on the next microtask. An index read begun
 * concurrently would still see H, while a read begun after it sees S.
 */
function flagAfterFinalStatus(
  head: string,
  tree: string,
  finalStatusCall: number,
): GitRunner {
  let indexCalls = 0;
  let statusCalls = 0;
  let finalStatusComplete = false;
  return async ({ argv }) => {
    if (argv[0] === "config")
      return argv.at(-1) === "^remote\\..*\\.url$"
        ? ok("remote.origin.url\nhttps://example.invalid/repo.git\u0000")
        : failed();
    if (argv[0] === "worktree")
      return ok(`worktree /task\nHEAD ${head}\nbranch refs/heads/sce/task\n\n`);
    if (argv[0] === "ls-files") {
      indexCalls += 1;
      return indexCalls === 2 && finalStatusComplete
        ? ok("S src/file.ts\u0000")
        : ok("H src/file.ts\u0000");
    }
    if (argv[0] === "status") {
      statusCalls += 1;
      if (statusCalls !== finalStatusCall) return ok();
      await Promise.resolve();
      finalStatusComplete = true;
      return ok();
    }
    if (argv[0] === "symbolic-ref") return ok("refs/heads/sce/task\n");
    if (argv[0] === "merge-base") return ok();
    if (argv[0] === "diff")
      return ok(
        argv.includes("--name-only")
          ? "src/file.ts\u0000"
          : "diff --git a/src/file.ts b/src/file.ts\n",
      );
    if (argv[0] === "-c" && argv.includes("diff"))
      return ok(
        argv.includes("--name-only")
          ? "src/file.ts\u0000"
          : "diff --git a/src/file.ts b/src/file.ts\n",
      );
    if (argv[0] === "rev-parse") {
      if (argv[1] === "--git-common-dir") return ok("/repo/.git\n");
      if (argv[1] === "--show-object-format") return ok("sha1\n");
      return ok(argv[2] === "HEAD^{commit}" ? `${head}\n` : `${tree}\n`);
    }
    return failed();
  };
}

test("candidate observation binds the owned worktree and exact diff bytes", async () => {
  const base = sha1("1");
  const head = sha1("2");
  const tree = sha1("3");
  const runner = scripted(
    ...identityResults(),
    ok(`worktree /task\nHEAD ${head}\nbranch refs/heads/sce/task\n\n`),
    ok("/repo/.git\n"),
    failed(),
    ok(
      "H src/adapters/git/index.ts\u0000H test/adapters/git/git.test.ts\u0000",
    ),
    ok(`${head}\n`),
    ok(`${tree}\n`),
    ok(),
    ok("refs/heads/sce/task\n"),
    ok(),
    ok("src/adapters/git/index.ts\u0000test/adapters/git/git.test.ts\u0000"),
    ok("diff --git a/src/adapters/git/index.ts b/src/adapters/git/index.ts\n"),
    ok(`${head}\n`),
    ok(`${tree}\n`),
    ok(),
    ok("refs/heads/sce/task\n"),
    ok(
      "H src/adapters/git/index.ts\u0000H test/adapters/git/git.test.ts\u0000",
    ),
  );
  const result = await observeCandidate(runner, repository(), {
    allowedPaths: ["src/adapters/git", "test/adapters/git"],
    base,
    branch: "sce/task",
    worktreePath: "/task",
  });
  assert.equal(result.state, "observed");
  assert.deepEqual(result.snapshot?.changedPaths, [
    "src/adapters/git/index.ts",
    "test/adapters/git/git.test.ts",
  ]);
  assert.equal(
    result.snapshot?.diff,
    "diff --git a/src/adapters/git/index.ts b/src/adapters/git/index.ts\n",
  );

  const dirty = scripted(
    ...identityResults(),
    ok(`worktree /task\nHEAD ${head}\nbranch refs/heads/sce/task\n\n`),
    ok("/repo/.git\n"),
    failed(),
    ok("H src/adapters/git/index.ts\u0000"),
    ok(`${head}\n`),
    ok(`${tree}\n`),
    ok(" M src/adapters/git/index.ts\u0000"),
    ok("refs/heads/sce/task\n"),
  );
  assert.equal(
    (
      await observeCandidate(dirty, repository(), {
        allowedPaths: ["src/adapters/git"],
        base,
        branch: "sce/task",
        worktreePath: "/task",
      })
    ).code,
    "GIT_DIRTY",
  );
  assert.equal(
    (
      await observeCandidate(scripted(), repository(), {
        allowedPaths: ["src", "src/adapters"],
        base,
        branch: "sce/task",
        worktreePath: "/task",
      })
    ).code,
    "GIT_BAD_INPUT",
  );
});

test("candidate observation rejects a head or clean-state race after diff capture", async () => {
  const base = sha1("1");
  const head = sha1("2");
  const moved = sha1("3");
  const tree = sha1("4");
  const raced = scripted(
    ...identityResults(),
    ok(`worktree /task\nHEAD ${head}\nbranch refs/heads/sce/task\n\n`),
    ok("/repo/.git\n"),
    failed(),
    ok("H src/file.ts\u0000"),
    ok(`${head}\n`),
    ok(`${tree}\n`),
    ok(),
    ok("refs/heads/sce/task\n"),
    ok(),
    ok("src/file.ts\u0000"),
    ok("diff --git a/src/file.ts b/src/file.ts\n"),
    ok(`${moved}\n`),
    ok(`${tree}\n`),
    ok(),
    ok("refs/heads/sce/task\n"),
  );
  assert.equal(
    (
      await observeCandidate(raced, repository(), {
        allowedPaths: ["src"],
        base,
        branch: "sce/task",
        worktreePath: "/task",
      })
    ).code,
    "GIT_REFUSED",
  );
});

test("candidate evidence ends with ordinary-index validation after final status", async () => {
  const base = sha1("1");
  const head = sha1("2");
  const tree = sha1("3");
  assert.equal(
    (
      await observeCandidate(
        flagAfterFinalStatus(head, tree, 2),
        repository(),
        {
          allowedPaths: ["src"],
          base,
          branch: "sce/task",
          worktreePath: "/task",
        },
      )
    ).state,
    "refused",
  );
  assert.equal(
    (
      await verifyCandidateWorktree(
        flagAfterFinalStatus(head, tree, 1),
        repository(),
        { branch: "sce/task", head, path: "/task", tree },
      )
    ).state,
    "refused",
  );
});

test("branch and worktree creation are exact idempotent triples and refuse foreign ownership", async () => {
  const base = sha1("1");
  const branch = scripted(...identityResults(), ok(), ok(), ok(`${base}\n`));
  assert.equal(
    (await ensureBranch(branch, repository(), { base, branch: "sce/task" }))
      .state,
    "observed",
  );

  const foreignWorktree = scripted(
    ...identityResults(),
    ok(
      `worktree /repo\nHEAD ${base}\nbranch refs/heads/main\n\nworktree /unrelated\nbare\nlocked\nprunable\n\nworktree /work\nHEAD ${sha1("2")}\nbranch refs/heads/sce/task\n\n`,
    ),
  );
  assert.equal(
    (
      await ensureWorktree(foreignWorktree, repository(), {
        branch: "sce/task",
        head: base,
        path: "/new-worktree",
      })
    ).code,
    "GIT_FOREIGN_WORKTREE",
  );
  const dirtyExisting = scripted(
    ...identityResults(),
    ok(`worktree /work\nHEAD ${base}\nbranch refs/heads/sce/task\n\n`),
    ok("/repo/.git\n"),
    ok(" M src/adapters/git/index.ts\u0000"),
  );
  assert.equal(
    (
      await ensureWorktree(dirtyExisting, repository(), {
        branch: "sce/task",
        head: base,
        path: "/work",
      })
    ).code,
    "GIT_DIRTY",
  );
});

test("local fast-forward refuses a moved approved base and discovers crash outcomes by readback", async () => {
  const base = sha1("1");
  const candidate = sha1("2");
  const moved = scripted(...identityResults(), ok(`${sha1("3")}\n`));
  assert.equal(
    (
      await integrateLocalFastForward(moved, repository(), {
        base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).code,
    "GIT_MOVED_BASE",
  );
  const landed = scripted(...identityResults(), ok(`${candidate}\n`));
  assert.equal(
    (
      await discoverIntegration(landed, repository(), {
        base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).state,
    "observed",
  );
  const preAct = scripted(...identityResults(), ok(`${base}\n`));
  assert.equal(
    (
      await discoverIntegration(preAct, repository(), {
        base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).code,
    "GIT_ABSENT",
  );
  // A moved ref with the candidate provably not beneath it is an exact
  // refusal; a probe that cannot answer keeps it ambiguous.
  const movedRef = await discoverIntegration(
    scripted(...identityResults(), ok(`${sha1("3")}\n`), failed()),
    repository(),
    { base, candidate, integrationRef: "refs/heads/main" },
  );
  assert.equal(movedRef.state, "refused");
  assert.equal(movedRef.code, "GIT_MOVED_BASE");
  assert.equal(
    (
      await discoverIntegration(
        scripted(...identityResults(), ok(`${sha1("3")}\n`), {
          exitCode: 128,
          signal: null,
          stdout: "",
        }),
        repository(),
        { base, candidate, integrationRef: "refs/heads/main" },
      )
    ).state,
    "ambiguous",
  );
  assert.equal(
    (
      await discoverIntegration(
        scripted(...identityResults(), ok()),
        repository(),
        {
          base,
          candidate,
          integrationRef: "refs/heads/main",
        },
      )
    ).state,
    "ambiguous",
  );
  const unreadable = scripted(...identityResults(), {
    exitCode: null,
    signal: "SIGKILL",
    stdout: "",
  });
  assert.equal(
    (
      await discoverIntegration(unreadable, repository(), {
        base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).code,
    "GIT_UNRESOLVED_EFFECT",
  );

  const wrongRepository = scripted(
    ok("/foreign/.git\n"),
    ok("sha1\n"),
    ok("https://example.invalid/repo.git\n"),
    ok(`${candidate}\n`),
  );
  assert.equal(
    (
      await discoverIntegration(wrongRepository, repository(), {
        base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).code,
    "GIT_IDENTITY_MISMATCH",
  );
});

test("remote ff performs one non-force push and rejects a stale remote readback", async () => {
  const base = sha1("1");
  const candidate = sha1("2");
  const stale = scripted(
    ...identityResults(),
    ok("https://example.invalid/repo.git\n"),
    ok(`${base}\trefs/heads/main\n`),
    failed(),
    ok(`${sha1("3")}\trefs/heads/main\n`),
  );
  assert.equal(
    (
      await integrateRemoteFastForward(stale, repository(), {
        base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).code,
    "GIT_MOVED_BASE",
  );
  const calls: string[][] = [];
  const capture: GitRunner = async ({ argv }) => {
    calls.push([...argv]);
    if (argv[0] === "rev-parse")
      return argv[1] === "--git-common-dir" ? ok("/repo/.git\n") : ok("sha1\n");
    if (argv[0] === "config")
      return ok("remote.origin.url\nhttps://example.invalid/repo.git\u0000");
    if (argv[0] === "remote") return ok("https://example.invalid/repo.git\n");
    if (argv[0] === "ls-remote")
      return calls.filter((call) => call[0] === "ls-remote").length === 1
        ? ok(`${base}\trefs/heads/main\n`)
        : ok(`${candidate}\trefs/heads/main\n`);
    return ok();
  };
  assert.equal(
    (
      await integrateRemoteFastForward(capture, repository(), {
        base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).state,
    "observed",
  );
  const guardedPush = calls.find((argv) => argv[0] === "-c");
  assert.deepEqual(guardedPush?.slice(2), [
    "push",
    "origin",
    `${candidate}:refs/heads/main`,
  ]);
  assert.equal(
    guardedPush?.some((part) => part === "--force"),
    false,
  );
  const unavailableBeforePush = scripted(
    ...identityResults(),
    ok("https://example.invalid/repo.git\n"),
    { exitCode: null, signal: "SIGKILL", stdout: "" },
  );
  assert.equal(
    (
      await integrateRemoteFastForward(unavailableBeforePush, repository(), {
        base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).code,
    "GIT_UNRESOLVED_EFFECT",
  );
  const unreadableAfterPush = scripted(
    ...identityResults(),
    ok("https://example.invalid/repo.git\n"),
    ok(`${base}\trefs/heads/main\n`),
    failed(),
    { exitCode: null, signal: "SIGKILL", stdout: "" },
  );
  assert.equal(
    (
      await integrateRemoteFastForward(unreadableAfterPush, repository(), {
        base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).code,
    "GIT_UNRESOLVED_EFFECT",
  );
  const divergentPushUrl = scripted(
    ...identityResults(),
    ok("https://example.invalid/other.git\n"),
  );
  assert.equal(
    (
      await integrateRemoteFastForward(divergentPushUrl, repository(), {
        base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).code,
    "GIT_REMOTE_AMBIGUOUS",
  );
});

test("publication is a separate handoff boundary with remote candidate readback", async () => {
  const candidate = sha1("2");
  const calls: string[][] = [];
  const runner: GitRunner = async ({ argv }) => {
    calls.push([...argv]);
    if (argv[0] === "rev-parse")
      return argv[1] === "--git-common-dir" ? ok("/repo/.git\n") : ok("sha1\n");
    if (argv[0] === "config")
      return ok("remote.origin.url\nhttps://example.invalid/repo.git\u0000");
    if (argv[0] === "remote") return ok("https://example.invalid/repo.git\n");
    if (argv[0] === "push") return ok();
    return ok(`${candidate}\trefs/heads/sce/task\n`);
  };
  assert.equal(
    (
      await publishCandidate(runner, repository(), {
        candidate,
        remote: "origin",
        remoteBranch: "sce/task",
      })
    ).state,
    "observed",
  );
  assert.equal(
    calls.some((argv) => argv[0] === "merge"),
    false,
  );
});

test("schemas admit local-only identity and valid Node signals while strict refs reject adversarial atoms", async () => {
  assert.equal(
    isGitSchema(GitRepositorySchema, {
      commonDir: "/repo/.git",
      cwd: "/repo",
      identity: "local:/repo/.git",
      objectFormat: "sha1",
      remoteUrls: [],
    }),
    true,
  );
  assert.equal(
    isGitSchema(GitResultSchema, {
      exitCode: null,
      signal: "SIGUSR2",
      stdout: "",
    }),
    true,
  );
  assert.equal(
    isGitSchema(GitResultSchema, {
      exitCode: null,
      signal: "SIGUNKNOWN",
      stdout: "",
    }),
    true,
  );
  assert.equal(
    isGitSchema(GitResultSchema, {
      exitCode: null,
      signal: "usr2",
      stdout: "",
    }),
    false,
  );
  const blocked = await nodeGitRunner({
    argv: ["branch", "sce//bad", sha1("1")],
    cwd: "/repo",
  });
  assert.equal(blocked.unavailable, true);
  const forgedHook = await nodeGitRunner({
    argv: [
      "-c",
      `core.hooksPath=${join(tmpdir(), "sce-git-pre-push-forged")}`,
      "push",
      "origin",
      `${sha1("2")}:refs/heads/main`,
    ],
    cwd: "/repo",
  });
  assert.equal(forgedHook.unavailable, true);
});

async function git(cwd: string, ...argv: string[]): Promise<string> {
  const { stdout } = await execFile("git", argv, { cwd });
  return stdout;
}

async function setupRepository(objectFormat?: "sha1" | "sha256"): Promise<{
  base: string;
  cwd: string;
  remote: string;
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "sce-git-adapter-")),
  );
  const remote = join(root, "remote.git");
  const cwd = join(root, "repo");
  await git(
    root,
    "init",
    "--bare",
    ...(objectFormat === undefined ? [] : [`--object-format=${objectFormat}`]),
    remote,
  );
  await git(
    root,
    "init",
    ...(objectFormat === undefined ? [] : [`--object-format=${objectFormat}`]),
    cwd,
  );
  await git(cwd, "config", "user.email", "test@example.invalid");
  await git(cwd, "config", "user.name", "SCE test");
  await git(cwd, "commit", "--allow-empty", "-m", "base");
  await git(cwd, "branch", "-M", "main");
  await git(cwd, "remote", "add", "origin", remote);
  await git(cwd, "push", "-u", "origin", "main");
  return { base: (await git(cwd, "rev-parse", "HEAD")).trim(), cwd, remote };
}

async function actualRepository(cwd: string): Promise<GitRepository> {
  const commonDir = (await git(cwd, "rev-parse", "--git-common-dir")).trim();
  const canonicalCommonDir = await realpath(resolve(cwd, commonDir));
  const remote = await git(cwd, "remote", "get-url", "origin").catch(
    () => undefined,
  );
  return {
    commonDir: canonicalCommonDir,
    cwd,
    identity:
      remote === undefined ? `local:${canonicalCommonDir}` : "provider:fixture",
    objectFormat: (
      await git(cwd, "rev-parse", "--show-object-format")
    ).trim() as "sha1" | "sha256",
    remoteUrls: remote === undefined ? [] : [remote.trim()],
  };
}

test("real no-remote repository supports the local-only fast-forward profile", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sce-git-local-")));
  const cwd = join(root, "repo");
  t.after(() => rm(root, { force: true, recursive: true }));
  await git(root, "init", cwd);
  await git(cwd, "config", "user.email", "test@example.invalid");
  await git(cwd, "config", "user.name", "SCE test");
  await git(cwd, "commit", "--allow-empty", "-m", "base");
  await git(cwd, "branch", "-M", "main");
  const base = (await git(cwd, "rev-parse", "HEAD")).trim();
  const repo = await actualRepository(cwd);
  assert.equal(repo.remoteUrls.length, 0);
  assert.equal((await verifyRepository(nodeGitRunner, repo)).state, "observed");
  await git(cwd, "branch", "sce/local", base);
  const worktree = join(root, "task");
  await git(cwd, "worktree", "add", worktree, "sce/local");
  await git(worktree, "commit", "--allow-empty", "-m", "candidate");
  const candidate = (await git(worktree, "rev-parse", "HEAD")).trim();
  assert.equal(
    (
      await discoverIntegration(nodeGitRunner, repo, {
        base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).code,
    "GIT_ABSENT",
  );
  assert.equal(
    (
      await integrateLocalFastForward(nodeGitRunner, repo, {
        base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).state,
    "observed",
  );
  assert.equal(
    (
      await discoverIntegration(nodeGitRunner, repo, {
        base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).state,
    "observed",
  );
});

test("real worktree candidate observation binds exact committed diff bytes", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "sce-git-candidate-")),
  );
  const cwd = join(root, "repo");
  t.after(() => rm(root, { force: true, recursive: true }));
  await git(root, "init", cwd);
  await git(cwd, "config", "user.email", "test@example.invalid");
  await git(cwd, "config", "user.name", "SCE test");
  await git(cwd, "commit", "--allow-empty", "-m", "base");
  await git(cwd, "branch", "-M", "main");
  const base = (await git(cwd, "rev-parse", "HEAD")).trim();
  const worktree = join(root, "candidate");
  await git(cwd, "branch", "sce/candidate", base);
  await git(cwd, "worktree", "add", worktree, "sce/candidate");
  await writeFile(join(worktree, "candidate.txt"), "candidate\n", "utf8");
  await git(worktree, "add", "candidate.txt");
  await git(worktree, "commit", "-m", "candidate");
  const head = (await git(worktree, "rev-parse", "HEAD")).trim();
  const tree = (await git(worktree, "rev-parse", "HEAD^{tree}")).trim();
  const indexRaw = (
    await git(worktree, "rev-parse", "--git-path", "index")
  ).trim();
  const index = isAbsolute(indexRaw) ? indexRaw : resolve(worktree, indexRaw);
  const indexBefore = await readFile(index);
  const indexBeforeStat = await stat(index);
  const candidateCalls: string[] = [];
  const observed = await observeCandidate(
    async (request) => {
      const result = await nodeGitRunner(request);
      candidateCalls.push(
        `${request.argv.join(" ")}=${result.exitCode}:${result.stdout}`,
      );
      return result;
    },
    await actualRepository(cwd),
    {
      allowedPaths: ["candidate.txt"],
      base,
      branch: "sce/candidate",
      worktreePath: worktree,
    },
  );
  assert.equal(
    observed.state,
    "observed",
    `${observed.code}\n${candidateCalls.join("\n")}`,
  );
  assert.deepEqual(observed.snapshot?.changedPaths, ["candidate.txt"]);
  assert.equal(observed.snapshot?.head, head);
  assert.equal(observed.snapshot?.tree, tree);
  assert.match(
    observed.snapshot?.diff ?? "",
    /^diff --git a\/candidate.txt b\/candidate.txt/mu,
  );
  const indexAfter = await readFile(index);
  const indexAfterStat = await stat(index);
  assert.deepEqual(indexAfter, indexBefore);
  assert.equal(indexAfterStat.ino, indexBeforeStat.ino);
  assert.equal(indexAfterStat.mtimeMs, indexBeforeStat.mtimeMs);
  assert.equal(
    createHash("sha256").update(indexAfter).digest("hex"),
    createHash("sha256").update(indexBefore).digest("hex"),
  );
  await git(worktree, "config", "diff.noprefix", "true");
  const configured = await observeCandidate(
    nodeGitRunner,
    await actualRepository(cwd),
    {
      allowedPaths: ["candidate.txt"],
      base,
      branch: "sce/candidate",
      worktreePath: worktree,
    },
  );
  assert.equal(configured.state, "refused");
  await git(worktree, "config", "--unset", "diff.noprefix");
  const attributes = join(root, "external-attributes");
  await writeFile(attributes, "*.txt binary\n", "utf8");
  await git(worktree, "config", "core.attributesFile", attributes);
  const externalAttributes = await observeCandidate(
    nodeGitRunner,
    await actualRepository(cwd),
    {
      allowedPaths: ["candidate.txt"],
      base,
      branch: "sce/candidate",
      worktreePath: worktree,
    },
  );
  assert.equal(externalAttributes.state, "refused");
  await git(worktree, "config", "--unset", "core.attributesFile");
  for (const [flag, clear] of [
    ["--assume-unchanged", "--no-assume-unchanged"],
    ["--skip-worktree", "--no-skip-worktree"],
  ] as const) {
    await writeFile(join(worktree, "candidate.txt"), `${flag}\n`, "utf8");
    await git(worktree, "update-index", flag, "candidate.txt");
    assert.equal(
      (
        await observeCandidate(nodeGitRunner, await actualRepository(cwd), {
          allowedPaths: ["candidate.txt"],
          base,
          branch: "sce/candidate",
          worktreePath: worktree,
        })
      ).state,
      "refused",
    );
    assert.equal(
      (
        await verifyCandidateWorktree(
          nodeGitRunner,
          await actualRepository(cwd),
          { branch: "sce/candidate", head, path: worktree, tree },
        )
      ).state,
      "refused",
    );
    await git(worktree, "update-index", clear, "candidate.txt");
    await writeFile(join(worktree, "candidate.txt"), "candidate\n", "utf8");
  }
  const alias = join(root, "candidate-alias");
  await symlink(worktree, alias, "dir");
  assert.equal(
    (
      await verifyCandidateWorktree(
        nodeGitRunner,
        await actualRepository(cwd),
        { branch: "sce/candidate", head, path: worktree, tree },
      )
    ).state,
    "observed",
  );
  assert.equal(
    (
      await discoverWorktree(nodeGitRunner, await actualRepository(cwd), {
        branch: "sce/candidate",
        head,
        path: alias,
      })
    ).code,
    "GIT_FOREIGN_WORKTREE",
  );
  assert.equal(
    (
      await ensureWorktree(nodeGitRunner, await actualRepository(cwd), {
        branch: "sce/candidate",
        head,
        path: alias,
      })
    ).code,
    "GIT_FOREIGN_WORKTREE",
  );
  assert.equal(
    (
      await verifyCandidateWorktree(
        nodeGitRunner,
        await actualRepository(cwd),
        { branch: "sce/candidate", head, path: alias, tree },
      )
    ).code,
    "GIT_FOREIGN_WORKTREE",
  );
  assert.equal(
    (
      await observeCandidate(nodeGitRunner, await actualRepository(cwd), {
        allowedPaths: ["candidate.txt"],
        base,
        branch: "sce/candidate",
        worktreePath: alias,
      })
    ).code,
    "GIT_FOREIGN_WORKTREE",
  );
});

test("real disposable bare remote proves worktree discovery, local ff, and stale push rejection", async (t) => {
  const fixture = await setupRepository();
  t.after(() => rm(join(fixture.cwd, ".."), { force: true, recursive: true }));
  const repo = await actualRepository(fixture.cwd);
  assert.equal((await verifyRepository(nodeGitRunner, repo)).state, "observed");
  assert.equal(
    (
      await ensureBranch(nodeGitRunner, repo, {
        base: fixture.base,
        branch: "sce/task",
      })
    ).state,
    "observed",
  );
  const worktree = join(fixture.cwd, "..", "task-worktree");
  assert.equal(
    (
      await ensureWorktree(nodeGitRunner, repo, {
        branch: "sce/task",
        head: fixture.base,
        path: worktree,
      })
    ).state,
    "observed",
  );
  await git(worktree, "commit", "--allow-empty", "-m", "candidate");
  const candidate = (await git(worktree, "rev-parse", "HEAD")).trim();
  await git(fixture.cwd, "update-ref", "refs/heads/main", fixture.base);
  assert.equal(
    (
      await integrateLocalFastForward(nodeGitRunner, repo, {
        base: fixture.base,
        candidate,
        integrationRef: "refs/heads/main",
      })
    ).state,
    "observed",
  );
  await git(fixture.cwd, "push", "origin", "refs/heads/main:refs/heads/main");
  await git(worktree, "commit", "--allow-empty", "-m", "second candidate");
  const second = (await git(worktree, "rev-parse", "HEAD")).trim();
  await git(fixture.cwd, "commit", "--allow-empty", "-m", "remote advance");
  await git(fixture.cwd, "push", "origin", "main:main");
  assert.equal(
    (
      await integrateRemoteFastForward(nodeGitRunner, repo, {
        base: candidate,
        candidate: second,
        integrationBranch: "main",
        remote: "origin",
      })
    ).code,
    "GIT_MOVED_BASE",
  );
});

test("real guarded remote ff rejects an intermediate ancestor that races after precheck", async (t) => {
  const fixture = await setupRepository();
  t.after(() => rm(join(fixture.cwd, ".."), { force: true, recursive: true }));
  const repo = await actualRepository(fixture.cwd);
  await git(fixture.cwd, "commit", "--allow-empty", "-m", "intermediate");
  const intermediate = (await git(fixture.cwd, "rev-parse", "HEAD")).trim();
  await git(
    fixture.cwd,
    "push",
    "origin",
    `${intermediate}:refs/heads/sce/race-object`,
  );
  await git(fixture.cwd, "commit", "--allow-empty", "-m", "candidate");
  const candidate = (await git(fixture.cwd, "rev-parse", "HEAD")).trim();
  let raced = false;
  const runner: GitRunner = async (request) => {
    if (request.argv[0] === "-c" && !raced) {
      raced = true;
      await execFile("git", [
        "--git-dir",
        fixture.remote,
        "update-ref",
        "refs/heads/main",
        intermediate,
      ]);
    }
    return nodeGitRunner(request);
  };
  const outcome = await integrateRemoteFastForward(runner, repo, {
    base: fixture.base,
    candidate,
    integrationBranch: "main",
    remote: "origin",
  });
  assert.equal(raced, true);
  assert.equal(outcome.code, "GIT_MOVED_BASE");
  assert.equal(
    (await git(fixture.cwd, "ls-remote", "--refs", "origin", "refs/heads/main"))
      .split("\t")[0]
      ?.trim(),
    intermediate,
  );
});

test("real guarded remote ff accepts only the exact advertised base", async (t) => {
  const fixture = await setupRepository();
  t.after(() => rm(join(fixture.cwd, ".."), { force: true, recursive: true }));
  const repo = await actualRepository(fixture.cwd);
  await git(fixture.cwd, "commit", "--allow-empty", "-m", "candidate");
  const candidate = (await git(fixture.cwd, "rev-parse", "HEAD")).trim();
  assert.equal(
    (
      await discoverRemoteIntegration(nodeGitRunner, repo, {
        base: fixture.base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).code,
    "GIT_ABSENT",
  );
  assert.equal(
    (
      await integrateRemoteFastForward(nodeGitRunner, repo, {
        base: fixture.base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).state,
    "observed",
  );
  assert.equal(
    (
      await discoverRemoteIntegration(nodeGitRunner, repo, {
        base: fixture.base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).state,
    "observed",
  );
  assert.equal(
    (await git(fixture.cwd, "ls-remote", "--refs", "origin", "refs/heads/main"))
      .split("\t")[0]
      ?.trim(),
    candidate,
  );
});

test("remote discovery positively observes an already-landed candidate without pushing", async () => {
  const base = sha1("1");
  const candidate = sha1("2");
  const calls: string[][] = [];
  const runner: GitRunner = async ({ argv }) => {
    calls.push([...argv]);
    if (argv[0] === "rev-parse")
      return argv[1] === "--git-common-dir" ? ok("/repo/.git\n") : ok("sha1\n");
    if (argv[0] === "config")
      return ok("remote.origin.url\nhttps://example.invalid/repo.git\u0000");
    if (argv[0] === "remote") return ok("https://example.invalid/repo.git\n");
    return ok(`${candidate}\trefs/heads/main\n`);
  };
  assert.equal(
    (
      await discoverRemoteIntegration(runner, repository(), {
        base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).state,
    "observed",
  );
  assert.equal(
    calls.some((argv) => argv.includes("push")),
    false,
  );
  const preAct = scripted(
    ...identityResults(),
    ok("https://example.invalid/repo.git\n"),
    ok(`${base}\trefs/heads/main\n`),
  );
  assert.equal(
    (
      await discoverRemoteIntegration(preAct, repository(), {
        base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).code,
    "GIT_ABSENT",
  );
  assert.equal(
    (
      await discoverRemoteIntegration(
        scripted(
          ...identityResults(),
          ok("https://example.invalid/repo.git\n"),
          ok(`${sha1("3")}\trefs/heads/main\n`),
        ),
        repository(),
        { base, candidate, integrationBranch: "main", remote: "origin" },
      )
    ).state,
    "ambiguous",
  );
  assert.equal(
    (
      await discoverRemoteIntegration(runner, repository(), {
        base: candidate,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).code,
    "GIT_BAD_INPUT",
  );
  const missing = scripted(
    ...identityResults(),
    ok("https://example.invalid/repo.git\n"),
    { exitCode: 2, signal: null, stdout: "" },
  );
  assert.equal(
    (
      await discoverRemoteIntegration(missing, repository(), {
        base,
        candidate,
        integrationBranch: "main",
        remote: "origin",
      })
    ).state,
    "ambiguous",
  );
  assert.equal(
    (
      await discoverRemoteIntegration(
        scripted(
          ...identityResults(),
          ok(
            "https://example.invalid/repo.git\nhttps://mirror.invalid/repo.git\n",
          ),
        ),
        repository(),
        { base, candidate, integrationBranch: "main", remote: "origin" },
      )
    ).code,
    "GIT_REMOTE_AMBIGUOUS",
  );
});

test("crash-after-act readback positively discovers every Git mutation boundary", async () => {
  const base = sha1("1");
  const candidate = sha1("2");
  const crashed: GitResult = { exitCode: null, signal: "SIGUSR2", stdout: "" };
  assert.equal(
    (
      await ensureBranch(
        scripted(...identityResults(), ok(), crashed, ok(`${base}\n`)),
        repository(),
        { base, branch: "sce/crash-branch" },
      )
    ).state,
    "observed",
  );
  assert.equal(
    (
      await ensureWorktree(
        scripted(
          ...identityResults(),
          ok(`worktree /repo\nHEAD ${base}\nbranch refs/heads/main\n\n`),
          crashed,
          ok(
            `worktree /repo\nHEAD ${base}\nbranch refs/heads/main\n\nworktree /private/tmp/sce-crash-worktree\nHEAD ${base}\nbranch refs/heads/sce/crash-worktree\n\n`,
          ),
          ok("/repo/.git\n"),
          ok(),
        ),
        repository(),
        {
          branch: "sce/crash-worktree",
          head: base,
          path: "/private/tmp/sce-crash-worktree",
        },
      )
    ).state,
    "observed",
  );
  assert.equal(
    (
      await integrateLocalFastForward(
        scripted(
          ...identityResults(),
          ok(`${base}\n`),
          ok("refs/heads/main\n"),
          ok(),
          crashed,
          ok(`${candidate}\n`),
        ),
        repository(),
        { base, candidate, integrationRef: "refs/heads/main" },
      )
    ).state,
    "observed",
  );
  assert.equal(
    (
      await publishCandidate(
        scripted(
          ...identityResults(),
          ok("https://example.invalid/repo.git\n"),
          crashed,
          ok(`${candidate}\trefs/heads/sce/crash\n`),
        ),
        repository(),
        { candidate, remote: "origin", remoteBranch: "sce/crash" },
      )
    ).state,
    "observed",
  );
  assert.equal(
    (
      await integrateRemoteFastForward(
        scripted(
          ...identityResults(),
          ok("https://example.invalid/repo.git\n"),
          ok(`${base}\trefs/heads/main\n`),
          crashed,
          ok(`${candidate}\trefs/heads/main\n`),
        ),
        repository(),
        { base, candidate, integrationBranch: "main", remote: "origin" },
      )
    ).state,
    "observed",
  );
  assert.deepEqual(
    await integrateRemoteFastForward(
      scripted(
        ...identityResults(),
        ok("https://example.invalid/repo.git\n"),
        ok(`${base}\trefs/heads/main\n`),
        crashed,
        ok(`${base}\trefs/heads/main\n`),
      ),
      repository(),
      { base, candidate, integrationBranch: "main", remote: "origin" },
    ),
    { code: "GIT_UNRESOLVED_EFFECT", state: "ambiguous" },
  );
});

test("real SHA-256 repository is accepted when this Git supports it", async (t) => {
  const fixture = await setupRepository("sha256").catch(() => undefined);
  if (fixture === undefined)
    return t.skip("Git lacks SHA-256 repository support");
  t.after(() => rm(join(fixture.cwd, ".."), { force: true, recursive: true }));
  const repo = await actualRepository(fixture.cwd);
  assert.equal(repo.objectFormat, "sha256");
  assert.equal((await verifyRepository(nodeGitRunner, repo)).state, "observed");
  assert.equal(
    (
      await ensureBranch(nodeGitRunner, repo, {
        base: fixture.base,
        branch: "sce/sha256",
      })
    ).state,
    "observed",
  );
});

test("refreshCandidate rebases a clean unit worktree onto a moved integration head and refuses conflicts unchanged", async () => {
  const { base, cwd } = await setupRepository();
  const repo = await actualRepository(cwd);
  const worktreePath = await realpath(
    await mkdtemp(join(tmpdir(), "sce-git-refresh-")),
  );
  await rm(worktreePath, { force: true, recursive: true });
  await git(cwd, "branch", "unit/one", base);
  await git(cwd, "worktree", "add", worktreePath, "unit/one");
  await writeFile(join(worktreePath, "unit.txt"), "unit change\n");
  await git(worktreePath, "add", "unit.txt");
  await git(worktreePath, "commit", "-m", "unit work");
  const candidate = (await git(worktreePath, "rev-parse", "HEAD")).trim();
  // Main moves on independently of the unit.
  await writeFile(join(cwd, "main.txt"), "main change\n");
  await git(cwd, "add", "main.txt");
  await git(cwd, "commit", "-m", "main work");
  const moved = (await git(cwd, "rev-parse", "HEAD")).trim();
  const input = {
    base: moved,
    branch: "unit/one",
    previousBase: base,
    worktreePath,
  };
  const probe = await discoverRefresh(nodeGitRunner, repo, input);
  assert.equal(probe.state, "refused");
  assert.equal(probe.code, "GIT_ABSENT");
  assert.equal(probe.head, candidate);
  const refreshed = await refreshCandidate(nodeGitRunner, repo, input);
  assert.equal(refreshed.state, "observed", JSON.stringify(refreshed));
  assert.notEqual(refreshed.head, candidate);
  assert.equal(
    await git(worktreePath, "merge-base", "--is-ancestor", moved, "HEAD"),
    "",
  );
  assert.equal(
    (await git(worktreePath, "rev-parse", "HEAD")).trim(),
    refreshed.head,
  );
  // Idempotent: a branch already on the new base is observed as is.
  const again = await refreshCandidate(nodeGitRunner, repo, input);
  assert.equal(again.state, "observed");
  assert.equal(again.head, refreshed.head);
  assert.equal(
    (await discoverRefresh(nodeGitRunner, repo, input)).state,
    "observed",
  );
  // A conflicting move is refused with the unchanged head and a clean tree.
  await writeFile(join(cwd, "unit.txt"), "conflicting main change\n");
  await git(cwd, "add", "unit.txt");
  await git(cwd, "commit", "-m", "main conflict");
  const conflicting = (await git(cwd, "rev-parse", "HEAD")).trim();
  const refused = await refreshCandidate(nodeGitRunner, repo, {
    ...input,
    base: conflicting,
    previousBase: moved,
  });
  assert.equal(refused.state, "refused", JSON.stringify(refused));
  assert.equal(refused.code, "GIT_NOT_FAST_FORWARD");
  assert.equal(refused.head, refreshed.head);
  assert.equal((await git(worktreePath, "status", "--porcelain")).trim(), "");
  assert.equal(
    (await git(worktreePath, "rev-parse", "HEAD")).trim(),
    refreshed.head,
  );
  // A dirty worktree never rebases.
  await writeFile(join(worktreePath, "dirty.txt"), "x\n");
  const dirty = await refreshCandidate(nodeGitRunner, repo, {
    ...input,
    base: conflicting,
    previousBase: moved,
  });
  assert.equal(dirty.state, "refused");
  assert.equal(dirty.code, "GIT_DIRTY");
});

test("a modified bd passive export never blocks local fast-forward integration; anything else still does", async () => {
  assert.equal(integrationTreeClean(""), true);
  assert.equal(integrationTreeClean(" M .beads/interactions.jsonl\0"), true);
  assert.equal(
    integrationTreeClean(
      " M .beads/issues.jsonl\0 M .beads/interactions.jsonl\0",
    ),
    true,
  );
  assert.equal(integrationTreeClean("M  .beads/interactions.jsonl\0"), false);
  assert.equal(integrationTreeClean("?? .beads/other.jsonl\0"), false);
  assert.equal(integrationTreeClean(" M .beads/nested/x.jsonl\0"), false);
  assert.equal(integrationTreeClean(" M src/index.ts\0"), false);
  assert.equal(
    integrationTreeClean(" M .beads/interactions.jsonl\0 M src/a.ts\0"),
    false,
  );

  const { base, cwd } = await setupRepository();
  const repo = await actualRepository(cwd);
  await mkdir(join(cwd, ".beads"), { recursive: true });
  await writeFile(join(cwd, ".beads", "interactions.jsonl"), "{}\n");
  await git(cwd, "add", ".beads/interactions.jsonl");
  await git(cwd, "commit", "-m", "audit export");
  const exportBase = (await git(cwd, "rev-parse", "HEAD")).trim();
  await git(cwd, "branch", "unit/ff", exportBase);
  const worktreePath = await realpath(
    await mkdtemp(join(tmpdir(), "sce-git-ff-")),
  );
  await rm(worktreePath, { force: true, recursive: true });
  await git(cwd, "worktree", "add", worktreePath, "unit/ff");
  await writeFile(join(worktreePath, "unit.txt"), "candidate\n");
  await git(worktreePath, "add", "unit.txt");
  await git(worktreePath, "commit", "-m", "candidate");
  const candidate = (await git(worktreePath, "rev-parse", "HEAD")).trim();
  // The audit export churns underneath; the fast-forward still lands.
  await writeFile(join(cwd, ".beads", "interactions.jsonl"), "{}\n{}\n");
  const landed = await integrateLocalFastForward(nodeGitRunner, repo, {
    base: exportBase,
    candidate,
    integrationRef: "refs/heads/main",
  });
  assert.equal(landed.state, "observed", JSON.stringify(landed));
  assert.equal(
    (await git(cwd, "rev-parse", "refs/heads/main")).trim(),
    candidate,
  );
  assert.notEqual(base, candidate);
});

test("discoverIntegration reports a moved base as an exact refusal when the candidate is not beneath the ref", async () => {
  const { base, cwd } = await setupRepository();
  const repo = await actualRepository(cwd);
  await git(cwd, "branch", "unit/probe", base);
  await writeFile(join(cwd, "main.txt"), "main moved\n");
  await git(cwd, "add", "main.txt");
  await git(cwd, "commit", "-m", "main moved");
  const moved = (await git(cwd, "rev-parse", "HEAD")).trim();
  const worktreePath = await realpath(
    await mkdtemp(join(tmpdir(), "sce-git-probe-")),
  );
  await rm(worktreePath, { force: true, recursive: true });
  await git(cwd, "worktree", "add", worktreePath, "unit/probe");
  await writeFile(join(worktreePath, "unit.txt"), "candidate\n");
  await git(worktreePath, "add", "unit.txt");
  await git(worktreePath, "commit", "-m", "candidate");
  const candidate = (await git(worktreePath, "rev-parse", "HEAD")).trim();
  const probe = await discoverIntegration(nodeGitRunner, repo, {
    base,
    candidate,
    integrationRef: "refs/heads/main",
  });
  assert.equal(probe.state, "refused");
  assert.equal(probe.code, "GIT_MOVED_BASE");
  assert.equal(
    await integrationRefHead(nodeGitRunner, repo, "refs/heads/main"),
    moved,
  );
  assert.equal(
    await integrationRefHead(nodeGitRunner, repo, "refs/heads/missing"),
    undefined,
  );
});

/**
 * K3 scripted-runner coverage. Every fixture below drives the adapter through
 * `router`, which admits a call only when the production runner's own gate
 * admits it, so each operation proves its emitted vectors in place while the
 * table test proves the adversarial variants are refused.
 */
type GitRequest = Parameters<GitRunner>[0];
type Route = (request: GitRequest) => GitResult | undefined;

function router(...routes: readonly Route[]): GitRunner {
  return async (request) => {
    assert.ok(
      allowedGitRequest(request),
      `the production runner refuses ${JSON.stringify(request.argv)}`,
    );
    for (const route of routes) {
      const result = route(request);
      if (result !== undefined) return result;
    }
    return failed();
  };
}

const identity: Route = ({ argv, cwd }) => {
  if (cwd !== "/repo") return undefined;
  if (argv[0] === "rev-parse" && argv[1] === "--git-common-dir")
    return ok("/repo/.git\n");
  if (argv[0] === "rev-parse" && argv[1] === "--show-object-format")
    return ok("sha1\n");
  if (argv[0] === "config")
    return ok("remote.origin.url\nhttps://example.invalid/repo.git\u0000");
  return undefined;
};

/** `worktree list --porcelain` output: the main checkout plus a given block. */
function listing(entry: string): GitResult {
  return ok(
    `worktree /repo\nHEAD ${sha1("1")}\nbranch refs/heads/main\n\n${entry}`,
  );
}

function detachedEntry(path: string, head: string): string {
  return `worktree ${path}\nHEAD ${head}\ndetached\n\n`;
}

/** A repository whose only extra worktree is detached at `head` on `path`. */
function detached(
  path: string,
  head: string,
  options: Readonly<{ clean?: boolean; entry?: () => string }> = {},
): Route {
  const entry = options.entry ?? (() => detachedEntry(path, head));
  return ({ argv, cwd }) => {
    if (argv[0] === "worktree" && argv[1] === "list") return listing(entry());
    if (cwd !== path) return undefined;
    if (argv[0] === "rev-parse" && argv[1] === "--git-common-dir")
      return ok("/repo/.git\n");
    if (argv[0] === "rev-parse" && argv[1] === "--verify")
      return ok(`${head}\n`);
    if (argv[0] === "status")
      return ok(
        options.clean === false ? " M generated/timeline.md\u0000" : "",
      );
    return undefined;
  };
}

/** A canonical absolute directory whose child never needs to exist on disk. */
async function provenancePath(name: string): Promise<string> {
  return join(await realpath(tmpdir()), `sce-provenance-${name}`);
}

const admits = (
  argv: readonly string[],
  env?: Readonly<Record<string, string>>,
): boolean =>
  allowedGitRequest({
    argv,
    cwd: "/repo",
    ...(env === undefined ? {} : { env }),
  });

test("the production runner admits every K3 vector and refuses its adversarial variants", async () => {
  const worktreePath = await provenancePath("gate");
  const tree = sha1("a");
  const parent = sha1("b");
  const subject = "sce: provenance for wave wave-1";
  const trailer = `SCE-Provenance-Key: sce:${"c".repeat(64)}`;
  const admitted: readonly (readonly string[])[] = [
    ["worktree", "add", "--detach", worktreePath, parent],
    ["add", "--all"],
    ["write-tree"],
    ["commit-tree", tree, "-p", parent, "-m", subject, "-m", trailer],
    ["update-ref", "--no-deref", "HEAD", parent],
    ["cat-file", "commit", parent],
    ["cat-file", "blob", tree],
    ["rev-list", `--max-count=${DISCOVERY_DEPTH}`, parent],
    ["ls-tree", "-r", "-z", parent, "--", "events"],
    [
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ],
  ];
  for (const argv of admitted) assert.equal(admits(argv), true, argv.join(" "));

  const refused: readonly (readonly string[])[] = [
    // Detached creation binds one absolute path to one exact commit.
    ["worktree", "add", "--detach", "provenance/gate", parent],
    ["worktree", "add", "--detach", worktreePath, "refs/heads/main"],
    ["worktree", "add", "--detach", worktreePath],
    ["worktree", "add", "--detach", worktreePath, parent, "--lock"],
    ["worktree", "remove", worktreePath],
    // Staging and tree writing take no operands at all.
    ["add", "-A"],
    ["add", "--all", "."],
    ["add"],
    ["write-tree", "--prefix=generated/"],
    // The commit is exactly one parent, the keyed two-line message, and no
    // signing or amending switch.
    ["commit-tree", tree, "-p", parent, "-m", subject],
    ["commit-tree", "HEAD^{tree}", "-p", parent, "-m", subject, "-m", trailer],
    [
      "commit-tree",
      tree,
      "-p",
      parent,
      "-m",
      "provenance for wave wave-1",
      "-m",
      trailer,
    ],
    [
      "commit-tree",
      tree,
      "-p",
      parent,
      "-m",
      subject,
      "-m",
      "X-Provenance-Key: sce:1",
    ],
    ["commit-tree", tree, "-p", parent, "-m", subject, "-m", trailer, "-S"],
    // Only the worktree's own detached HEAD moves, and only to an exact OID.
    ["update-ref", "HEAD", parent],
    ["update-ref", "--no-deref", "refs/heads/main", parent],
    ["update-ref", "--no-deref", "HEAD", "refs/heads/main"],
    // Object reads name one exact object of one expected type.
    ["cat-file", "tree", parent],
    ["cat-file", "-p", parent],
    ["cat-file", "commit", "HEAD"],
    // Keyed discovery is capped at exactly DISCOVERY_DEPTH commits.
    ["rev-list", `--max-count=${DISCOVERY_DEPTH + 1}`, parent],
    ["rev-list", `--max-count=${DISCOVERY_DEPTH}`, "HEAD"],
    ["rev-list", `--max-count=${DISCOVERY_DEPTH}`, parent, "--all"],
    ["rev-list", parent],
    // Record reads stay inside one safe relative directory of one commit.
    ["ls-tree", "-r", "-z", parent, "--", "/events"],
    ["ls-tree", "-r", "-z", parent, "--", "../events"],
    ["ls-tree", "-r", "-z", parent, "--", "events/"],
    ["ls-tree", "-r", "-z", parent, "--", "events/../secrets"],
    ["ls-tree", "-r", "-z", parent, "events"],
    ["ls-tree", "-r", parent, "--", "events"],
    // The fetch refreshes exactly one remote-tracking ref of its own remote.
    [
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/upstream/main",
    ],
    [
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/next",
    ],
    [
      "fetch",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ],
    ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/heads/main"],
    ["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"],
  ];
  for (const argv of refused) assert.equal(admits(argv), false, argv.join(" "));

  // The gate is the conjunction of directory, argv, and environment.
  assert.equal(allowedGitRequest({ argv: ["write-tree"], cwd: "repo" }), false);
  assert.equal(allowedGitRequest({ argv: ["write-tree"], cwd: "/" }), false);
  const env = commitIdentityEnvironment({
    date: "1700000000 +0000",
    email: "sce@noreply.invalid",
    name: "holder/incarnation-1",
  });
  assert.deepEqual(env, {
    GIT_AUTHOR_DATE: "1700000000 +0000",
    GIT_AUTHOR_EMAIL: "sce@noreply.invalid",
    GIT_AUTHOR_NAME: "holder/incarnation-1",
    GIT_COMMITTER_DATE: "1700000000 +0000",
    GIT_COMMITTER_EMAIL: "sce@noreply.invalid",
    GIT_COMMITTER_NAME: "holder/incarnation-1",
  });
  assert.equal(admits(["write-tree"], env), true);
  assert.equal(admits(["write-tree"], { GIT_DIR: "/elsewhere/.git" }), false);
  assert.equal(admits(["write-tree"], { GIT_AUTHOR_NAME: "a\nb" }), false);
  assert.equal(admits(["write-tree"], { GIT_AUTHOR_NAME: "" }), false);
  for (const identityInput of [
    { date: "1700000000 +0000", email: "sce@noreply.invalid", name: "a <b>" },
    { date: "1700000000 +0000", email: "sce at noreply", name: "holder" },
    { date: "1700000000 +0100", email: "sce@noreply.invalid", name: "holder" },
    { date: "-1 +0000", email: "sce@noreply.invalid", name: "holder" },
  ])
    assert.equal(commitIdentityEnvironment(identityInput), undefined);
});

test("detached worktree discovery, creation, and HEAD movement bind one exact path", async () => {
  const worktreePath = await provenancePath("lifecycle");
  const head = sha1("2");
  const other = sha1("3");

  assert.deepEqual(
    await discoverDetachedWorktree(
      router(identity, detached(worktreePath, head)),
      repository(),
      { path: worktreePath },
    ),
    { clean: true, head, state: "present" },
  );
  assert.deepEqual(
    await discoverDetachedWorktree(
      router(identity, detached(worktreePath, head, { entry: () => "" })),
      repository(),
      { path: worktreePath },
    ),
    { state: "absent" },
  );
  // A branch-attached worktree at that path is never the provenance worktree.
  assert.deepEqual(
    await discoverDetachedWorktree(
      router(
        identity,
        detached(worktreePath, head, {
          entry: () =>
            `worktree ${worktreePath}\nHEAD ${head}\nbranch refs/heads/sce/task\n\n`,
        }),
      ),
      repository(),
      { path: worktreePath },
    ),
    { state: "foreign" },
  );
  // Only the exact canonical spelling of the path is admitted.
  assert.deepEqual(
    await discoverDetachedWorktree(
      router(identity, detached(worktreePath, head)),
      repository(),
      { path: `${worktreePath}/` },
    ),
    { state: "foreign" },
  );
  assert.deepEqual(
    await discoverDetachedWorktree(
      router(identity, ({ argv }) =>
        argv[0] === "worktree" ? failed() : undefined,
      ),
      repository(),
      { path: worktreePath },
    ),
    { state: "unreadable" },
  );

  // Creation is idempotent for the same path already detached at that head.
  assert.deepEqual(
    await ensureDetachedWorktree(
      router(identity, detached(worktreePath, head)),
      repository(),
      { head, path: worktreePath },
    ),
    { code: "GIT_OK", state: "observed" },
  );
  assert.deepEqual(
    await ensureDetachedWorktree(
      router(identity, detached(worktreePath, head, { clean: false })),
      repository(),
      { head, path: worktreePath },
    ),
    { code: "GIT_DIRTY", state: "refused" },
  );
  assert.deepEqual(
    await ensureDetachedWorktree(
      router(identity, detached(worktreePath, other)),
      repository(),
      { head, path: worktreePath },
    ),
    { code: "GIT_FOREIGN_WORKTREE", state: "refused" },
  );
  assert.deepEqual(
    await ensureDetachedWorktree(router(identity), repository(), {
      head: "HEAD",
      path: worktreePath,
    }),
    { code: "GIT_BAD_INPUT", state: "refused" },
  );

  let created = false;
  const creating = router(
    identity,
    ({ argv }) => {
      if (argv[0] !== "worktree" || argv[1] !== "add") return undefined;
      created = true;
      return ok();
    },
    detached(worktreePath, head, {
      entry: () => (created ? detachedEntry(worktreePath, head) : ""),
    }),
  );
  assert.deepEqual(
    await ensureDetachedWorktree(creating, repository(), {
      head,
      path: worktreePath,
    }),
    { code: "GIT_OK", state: "observed" },
  );
  // An add that provably did nothing is a refusal; one that cannot be proven
  // either way stays ambiguous.
  assert.deepEqual(
    await ensureDetachedWorktree(
      router(identity, detached(worktreePath, head, { entry: () => "" })),
      repository(),
      { head, path: worktreePath },
    ),
    { code: "GIT_REFUSED", state: "refused" },
  );
  assert.deepEqual(
    await ensureDetachedWorktree(
      router(
        identity,
        ({ argv }) =>
          argv[0] === "worktree" && argv[1] === "add"
            ? { exitCode: null, signal: "SIGKILL", stdout: "" }
            : undefined,
        detached(worktreePath, head, { entry: () => "" }),
      ),
      repository(),
      { head, path: worktreePath },
    ),
    { code: "GIT_UNRESOLVED_EFFECT", state: "ambiguous" },
  );

  const moved: Route = ({ argv }) =>
    argv[0] === "update-ref" ? ok() : undefined;
  assert.deepEqual(
    await setDetachedHead(
      router(identity, moved, detached(worktreePath, head)),
      repository(),
      { commit: head, worktreePath },
    ),
    { code: "GIT_OK", state: "observed" },
  );
  assert.deepEqual(
    await setDetachedHead(
      router(identity, moved, detached(worktreePath, other)),
      repository(),
      { commit: head, worktreePath },
    ),
    { code: "GIT_UNRESOLVED_EFFECT", state: "ambiguous" },
  );
  assert.deepEqual(
    await setDetachedHead(
      router(identity, detached(worktreePath, other)),
      repository(),
      { commit: head, worktreePath },
    ),
    { code: "GIT_REFUSED", state: "refused" },
  );
  assert.deepEqual(
    await setDetachedHead(router(identity), repository(), {
      commit: head,
      worktreePath: "provenance/relative",
    }),
    { code: "GIT_BAD_INPUT", state: "refused" },
  );
});

test("the provenance commit is built from journaled facts and a constant identity", async () => {
  const worktreePath = await provenancePath("commit");
  const tree = sha1("a");
  const parent = sha1("b");
  const commit = sha1("c");
  const subject = "sce: provenance for wave wave-1";
  const trailer = `SCE-Provenance-Key: sce:${"d".repeat(64)}`;
  const identityInput = {
    date: "1700000000 +0000",
    email: "sce@noreply.invalid",
    name: "holder/incarnation-1",
  };

  const staged: string[][] = [];
  const staging = router(({ argv, cwd }) => {
    if (cwd !== worktreePath) return undefined;
    staged.push([...argv]);
    if (argv[0] === "add") return ok();
    if (argv[0] === "write-tree") return ok(`${tree}\n`);
    return undefined;
  });
  assert.equal(
    await writeWorktreeTree(staging, repository(), worktreePath),
    tree,
  );
  assert.deepEqual(staged, [["add", "--all"], ["write-tree"]]);
  assert.equal(
    await writeWorktreeTree(
      router(({ argv }) => (argv[0] === "add" ? failed() : undefined)),
      repository(),
      worktreePath,
    ),
    undefined,
  );
  assert.equal(
    await writeWorktreeTree(
      router(({ argv }) =>
        argv[0] === "add" ? ok() : ok("refs/heads/main\n"),
      ),
      repository(),
      worktreePath,
    ),
    undefined,
  );
  assert.equal(
    await writeWorktreeTree(router(), repository(), "provenance/relative"),
    undefined,
  );

  const requests: GitRequest[] = [];
  const committing = router((request) => {
    requests.push(request);
    return request.argv[0] === "commit-tree" ? ok(`${commit}\n`) : undefined;
  });
  assert.equal(
    await createProvenanceCommit(committing, repository(), {
      identity: identityInput,
      parent,
      subject,
      trailer,
      tree,
      worktreePath,
    }),
    commit,
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    argv: ["commit-tree", tree, "-p", parent, "-m", subject, "-m", trailer],
    cwd: worktreePath,
    env: commitIdentityEnvironment(identityInput),
  });

  // Every journaled parameter is revalidated before the object is built, and
  // a refusal never reaches the runner at all.
  for (const input of [
    { identity: { ...identityInput, date: "1700000000 +0100" } },
    { parent: "HEAD" },
    { tree: `${tree}^{tree}` },
    { subject: "provenance for wave wave-1" },
    { trailer: "X-Provenance-Key: sce:1" },
    { worktreePath: "provenance/relative" },
  ])
    assert.equal(
      await createProvenanceCommit(router(), repository(), {
        identity: identityInput,
        parent,
        subject,
        trailer,
        tree,
        worktreePath,
        ...input,
      }),
      undefined,
    );
  assert.equal(
    await createProvenanceCommit(
      router(({ argv }) =>
        argv[0] === "commit-tree" ? ok("not-an-object-id\n") : undefined,
      ),
      repository(),
      {
        identity: identityInput,
        parent,
        subject,
        trailer,
        tree,
        worktreePath,
      },
    ),
    undefined,
  );
});

test("keyed discovery reads commits, trailers, records, and refs within exact bounds", async () => {
  const tree = sha1("a");
  const parent = sha1("b");
  const trailer = `SCE-Provenance-Key: sce:${"d".repeat(64)}`;
  const body = `sce: provenance for wave wave-1\n\n${trailer}\n`;
  const commitObject = (oid: string, carriesTrailer: boolean): GitResult =>
    ok(
      `tree ${tree}\nparent ${parent}\nauthor holder <sce@noreply.invalid> 1700000000 +0000\ncommitter holder <sce@noreply.invalid> 1700000000 +0000\n\n${
        carriesTrailer ? body : "sce: provenance for wave wave-0\n"
      }`,
    );

  assert.deepEqual(
    await readCommit(
      router(() => commitObject(sha1("c"), true)),
      repository(),
      sha1("c"),
    ),
    { message: body, parents: [parent], tree },
  );
  assert.equal(
    await readCommit(
      router(() => ok(`parent ${parent}\n\n${body}`)),
      repository(),
      sha1("c"),
    ),
    undefined,
  );
  assert.equal(
    await readCommit(
      router(() => ok(`tree ${tree}\n`)),
      repository(),
      sha1("c"),
    ),
    undefined,
  );
  assert.equal(await readCommit(router(), repository(), "HEAD"), undefined);

  const walk = (oids: readonly string[], carrier?: string): GitRunner =>
    router(identity, ({ argv }) => {
      if (argv[0] === "rev-list")
        return ok(oids.map((oid) => `${oid}\n`).join(""));
      if (argv[0] === "cat-file")
        return commitObject(argv[2] ?? "", argv[2] === carrier);
      return undefined;
    });
  const keyed = sha1("e");
  const found = await findCommitByTrailer(
    walk([sha1("c"), keyed, sha1("f")], keyed),
    repository(),
    { start: sha1("c"), trailer },
  );
  assert.equal(found.state, "found");
  if (found.state !== "found") throw new Error("unreachable");
  assert.equal(found.oid, keyed);
  assert.equal(found.commit.tree, tree);

  // The walk is capped at DISCOVERY_DEPTH commits: a keyed commit pushed past
  // that many landings is simply not seen.
  const window = Array.from({ length: DISCOVERY_DEPTH }, (_, index) =>
    index.toString(16).padStart(40, "0"),
  );
  let requested: readonly string[] = [];
  const bounded = router(identity, ({ argv }) => {
    if (argv[0] === "rev-list") {
      requested = [...argv];
      return ok(window.map((oid) => `${oid}\n`).join(""));
    }
    if (argv[0] === "cat-file") return commitObject(argv[2] ?? "", false);
    return undefined;
  });
  assert.deepEqual(
    await findCommitByTrailer(bounded, repository(), {
      start: sha1("c"),
      trailer,
    }),
    { state: "absent" },
  );
  assert.deepEqual(requested, [
    "rev-list",
    `--max-count=${DISCOVERY_DEPTH}`,
    sha1("c"),
  ]);
  assert.deepEqual(
    await findCommitByTrailer(walk(["refs/heads/main"]), repository(), {
      start: sha1("c"),
      trailer,
    }),
    { state: "unreadable" },
  );
  assert.deepEqual(
    await findCommitByTrailer(router(identity), repository(), {
      start: sha1("c"),
      trailer: "X-Provenance-Key: sce:1",
    }),
    { state: "unreadable" },
  );

  const blob = sha1("9");
  const treeFiles = (entries: readonly string[]): GitRunner =>
    router(identity, ({ argv }) => {
      if (argv[0] === "ls-tree")
        return ok(entries.map((entry) => `${entry}\u0000`).join(""));
      if (argv[0] === "cat-file" && argv[1] === "blob")
        return ok("# Provenance record\n");
      return undefined;
    });
  assert.deepEqual(
    await readTreeFiles(
      treeFiles([
        `100644 blob ${blob}\tevents/unit-1--abcdef012345.md`,
        `100644 blob ${blob}\tevents/unit-2--abcdef012345.md`,
      ]),
      repository(),
      { commit: parent, directory: "events", maxFiles: 8 },
    ),
    new Map([
      ["events/unit-1--abcdef012345.md", "# Provenance record\n"],
      ["events/unit-2--abcdef012345.md", "# Provenance record\n"],
    ]),
  );
  for (const [entries, maxFiles] of [
    [
      [`100644 blob ${blob}\tevents/a.md`, `100644 blob ${blob}\tevents/b.md`],
      1,
    ],
    [[`120000 blob ${blob}\tevents/a.md`], 8],
    [[`040000 tree ${blob}\tevents/nested`], 8],
    [[`100644 blob ${blob} events/a.md`], 8],
  ] as const)
    assert.equal(
      await readTreeFiles(treeFiles(entries), repository(), {
        commit: parent,
        directory: "events",
        maxFiles,
      }),
      undefined,
    );
  assert.equal(
    await readTreeFiles(router(identity), repository(), {
      commit: parent,
      directory: "../events",
      maxFiles: 8,
    }),
    undefined,
  );

  const ref = "refs/remotes/origin/main";
  const forEachRef = (stdout: string): GitRunner =>
    router(identity, ({ argv }) =>
      argv[0] === "for-each-ref" ? ok(stdout) : undefined,
    );
  assert.deepEqual(
    await readRefOid(forEachRef(`${parent}\n`), repository(), ref),
    { oid: parent, state: "found" },
  );
  assert.deepEqual(await readRefOid(forEachRef(""), repository(), ref), {
    state: "missing",
  });
  assert.deepEqual(
    await readRefOid(forEachRef("refs/heads/main\n"), repository(), ref),
    { state: "unreadable" },
  );

  const fetching = (result: GitResult): GitRunner =>
    router(identity, ({ argv }) => (argv[0] === "fetch" ? result : undefined));
  assert.deepEqual(
    await fetchIntegrationBranch(fetching(ok()), repository(), {
      branch: "main",
      remote: "origin",
    }),
    { code: "GIT_OK", state: "observed" },
  );
  assert.deepEqual(
    await fetchIntegrationBranch(fetching(failed()), repository(), {
      branch: "main",
      remote: "origin",
    }),
    { code: "GIT_COMMAND_FAILED", state: "refused" },
  );
  assert.deepEqual(
    await fetchIntegrationBranch(
      fetching({ exitCode: null, signal: "SIGKILL", stdout: "" }),
      repository(),
      { branch: "main", remote: "origin" },
    ),
    { code: "GIT_UNRESOLVED_EFFECT", state: "ambiguous" },
  );
  for (const input of [
    { branch: "main", remote: "origin/extra" },
    { branch: "-main", remote: "origin" },
    { branch: "main..other", remote: "origin" },
  ])
    assert.deepEqual(
      await fetchIntegrationBranch(router(identity), repository(), input),
      { code: "GIT_BAD_INPUT", state: "refused" },
    );
});
