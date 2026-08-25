import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  discoverIntegration,
  discoverRemoteIntegration,
  ensureBranch,
  ensureWorktree,
  GitRepositorySchema,
  GitResultSchema,
  integrateLocalFastForward,
  integrateRemoteFastForward,
  isGitSchema,
  nodeGitRunner,
  observeCandidate,
  publishCandidate,
  verifyRepository,
  type GitRepository,
  type GitResult,
  type GitRunner,
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

test("candidate observation binds exact base/head/tree and refuses dirty or scoped bytes", async () => {
  const base = sha1("1");
  const head = sha1("2");
  const tree = sha1("3");
  const runner = scripted(
    ...identityResults(),
    ok(`${head}\n`),
    ok(`${tree}\n`),
    ok(),
    ok(),
    ok("src/adapters/git/index.ts\u0000test/adapters/git/git.test.ts\u0000"),
  );
  const result = await observeCandidate(runner, repository(), {
    allowedPaths: ["src/adapters/git", "test/adapters/git"],
    base,
    expectedHead: head,
    expectedTree: tree,
  });
  assert.equal(result.state, "observed");
  assert.deepEqual(result.snapshot?.changedPaths, [
    "src/adapters/git/index.ts",
    "test/adapters/git/git.test.ts",
  ]);

  const dirty = scripted(
    ...identityResults(),
    ok(`${head}\n`),
    ok(`${tree}\n`),
    ok(" M src/adapters/git/index.ts\u0000"),
    ok(),
    ok(),
  );
  assert.equal(
    (
      await observeCandidate(dirty, repository(), {
        allowedPaths: ["src/adapters/git"],
        base,
        expectedHead: head,
        expectedTree: tree,
      })
    ).code,
    "GIT_DIRTY",
  );
  assert.equal(
    (
      await observeCandidate(scripted(), repository(), {
        allowedPaths: ["src", "src/adapters"],
        base,
        expectedHead: head,
        expectedTree: tree,
      })
    ).code,
    "GIT_BAD_INPUT",
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
  assert.equal(
    (
      await discoverIntegration(
        scripted(...identityResults(), ok(`${sha1("3")}\n`)),
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
  const root = await mkdtemp(join(tmpdir(), "sce-git-adapter-"));
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
  const root = await mkdtemp(join(tmpdir(), "sce-git-local-"));
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
