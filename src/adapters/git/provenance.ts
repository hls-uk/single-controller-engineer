/**
 * Production execution for the gate-facing `provenance_commit` and aggregate
 * `verify` effects. It turns exact journaled parameters into one detached
 * worktree lifecycle, projected record bytes, one deterministic commit, the
 * declared reproducibility check, and one fast-forward landing, and returns
 * only the strict result unions the reducer admits. Every uncertain outcome
 * is ambiguous; nothing here reads configuration or the clock.
 */
import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import { sha256 } from "../../protocol/evidence.js";
import {
  PROVENANCE_COMMITTER_EMAIL,
  projectProvenanceRecords,
  provenanceCommitDate,
  provenanceCommitSubject,
  provenanceCommitTrailer,
  type ProvenanceRecordFile,
} from "../../protocol/provenance.js";
import { deriveProvenanceWorktreePath } from "../../protocol/reducer.js";
import type {
  ProtocolEvent,
  RepositoryRun,
  RuntimeEffect,
} from "../../protocol/schemas.js";
import {
  createProvenanceCommit,
  discoverDetachedWorktree,
  ensureDetachedWorktree,
  fetchIntegrationBranch,
  findCommitByTrailer,
  integrateLocalFastForward,
  integrateRemoteFastForward,
  readCommit,
  readRefOid,
  readTreeFiles,
  setDetachedHead,
  verifyRepository,
  writeWorktreeTree,
  type GitEffect,
  type GitRepository,
  type GitRunner,
} from "./index.js";

export type ProvenanceCommitEffect = Extract<
  RuntimeEffect,
  { kind: "provenance_commit" }
>;
export type AggregateVerifyEffect = Extract<
  RuntimeEffect,
  { kind: "verify"; unitId: null }
>;
export type ProvenanceCommitResult = Extract<
  ProtocolEvent,
  { type: "provenance_commit_observed" }
>["result"];

export type ProcessOutcome = Readonly<{
  exitCode: number | null;
  signal: string | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  outputExceeded: boolean;
  failedToStart: boolean;
}>;

/** Bounded argv execution without a shell; the adapter supplies the environment. */
export interface ProvenanceProcessPort {
  run(
    argv: readonly string[],
    options: Readonly<{
      cwd: string;
      env: Readonly<Record<string, string>>;
      maxOutputBytes: number;
      timeoutMs: number;
    }>,
  ): Promise<ProcessOutcome>;
}

export type ProvenanceCommitOutcome =
  | Readonly<{ status: "observed"; result: ProvenanceCommitResult }>
  | Readonly<{ status: "ambiguous" }>
  | Readonly<{ status: "unavailable" }>;

export type AggregateVerifyOutcome =
  | Readonly<{ status: "observed"; passed: boolean; evidenceDigest: string }>
  | Readonly<{ status: "ambiguous" }>
  | Readonly<{ status: "unavailable" }>;

export interface ProvenanceAdapter {
  executeProvenanceCommit(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
  ): Promise<ProvenanceCommitOutcome>;
  reconcileProvenanceCommit(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
  ): Promise<ProvenanceCommitOutcome | Readonly<{ status: "absent" }>>;
  executeAggregateVerify(
    effect: AggregateVerifyEffect,
    run: RepositoryRun,
  ): Promise<AggregateVerifyOutcome>;
  reconcileAggregateVerify(
    effect: AggregateVerifyEffect,
    run: RepositoryRun,
  ): Promise<AggregateVerifyOutcome | Readonly<{ status: "absent" }>>;
}

export type ProvenanceAdapterOptions = Readonly<{
  git: Readonly<{
    repository: GitRepository;
    runner: GitRunner;
    remote?: string;
  }>;
  /** Injectable only for deterministic fixtures. */
  process?: ProvenanceProcessPort;
}>;

const COMMAND_TIMEOUT_MS = 600_000;
const GENERATOR_TIMEOUT_MS = 120_000;
const MAX_COMMAND_OUTPUT_BYTES = 65_536;
const MAX_RECORD_FILES = 64;

export const nodeProvenanceProcess: ProvenanceProcessPort = {
  run: async (argv, options) =>
    await new Promise((resolveOutcome) => {
      let settled = false;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let outputExceeded = false;
      let timedOut = false;
      let failedToStart = false;
      const finish = (exitCode: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveOutcome({
          exitCode,
          failedToStart,
          outputExceeded,
          signal,
          stderr: outputExceeded ? Buffer.alloc(0) : Buffer.concat(stderr),
          stdout: outputExceeded ? Buffer.alloc(0) : Buffer.concat(stdout),
          timedOut,
        });
      };
      const [executable, ...args] = argv;
      if (executable === undefined) {
        failedToStart = true;
        finish(null, null);
        return;
      }
      const child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs);
      const collect = (chunks: Buffer[], chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > options.maxOutputBytes) {
          outputExceeded = true;
          child.kill("SIGKILL");
          return;
        }
        chunks.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.once("error", () => {
        failedToStart = true;
        finish(null, null);
      });
      child.once("close", (code, signal) => finish(code, signal));
    }),
};

function ambiguous(): Readonly<{ status: "ambiguous" }> {
  return { status: "ambiguous" };
}

function unavailable(): Readonly<{ status: "unavailable" }> {
  return { status: "unavailable" };
}

function digest(value: JsonValue): string {
  return sha256(canonicalJson(value));
}

function sanitizedEnvironment(
  extra: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const inherited: Record<string, string> = {};
  for (const key of ["PATH", "TMPDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value !== undefined) inherited[key] = value;
  }
  return {
    ...inherited,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: "/nonexistent",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    ...extra,
  };
}

function outcomeDigest(
  argv: readonly string[],
  outcome: ProcessOutcome,
): string {
  return digest({
    argv: [...argv],
    exitCode: outcome.exitCode,
    failedToStart: outcome.failedToStart,
    outputExceeded: outcome.outputExceeded,
    signal: outcome.signal,
    stderrSha256: sha256(outcome.stderr.toString("utf8")),
    stdoutSha256: sha256(outcome.stdout.toString("utf8")),
    timedOut: outcome.timedOut,
  });
}

function succeeded(outcome: ProcessOutcome): boolean {
  return (
    outcome.exitCode === 0 &&
    outcome.signal === null &&
    !outcome.timedOut &&
    !outcome.outputExceeded &&
    !outcome.failedToStart
  );
}

async function realDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function recordsOnDisk(
  worktreePath: string,
  records: readonly ProvenanceRecordFile[],
): Promise<boolean> {
  for (const record of records) {
    try {
      const bytes = await readFile(join(worktreePath, record.path), "utf8");
      if (bytes !== record.bytes) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function recordsAtCommit(
  files: ReadonlyMap<string, string>,
  records: readonly ProvenanceRecordFile[],
): boolean {
  return records.every((record) => files.get(record.path) === record.bytes);
}

export function createProvenanceAdapter(
  options: ProvenanceAdapterOptions,
): ProvenanceAdapter {
  const { repository, runner } = options.git;
  const processPort = options.process ?? nodeProvenanceProcess;

  async function integrationHead(
    run: RepositoryRun,
  ): Promise<string | undefined> {
    if (run.integrationProfile === "local-ff") {
      const head = await readRefOid(
        runner,
        repository,
        `refs/heads/${run.integrationBranch}`,
      );
      return head.state === "found" ? head.oid : undefined;
    }
    const remote = options.git.remote;
    if (remote === undefined) return undefined;
    const fetched = await fetchIntegrationBranch(runner, repository, {
      branch: run.integrationBranch,
      remote,
    });
    if (fetched.state !== "observed") return undefined;
    const head = await readRefOid(
      runner,
      repository,
      `refs/remotes/${remote}/${run.integrationBranch}`,
    );
    return head.state === "found" ? head.oid : undefined;
  }

  /** Keyed discovery: a landed commit is observed without a second act. */
  async function discoverLanded(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
    records: readonly ProvenanceRecordFile[],
  ): Promise<
    | Readonly<{ state: "found"; result: ProvenanceCommitResult }>
    | Readonly<{ state: "absent" }>
    | Readonly<{ state: "unreadable" }>
  > {
    const head = await integrationHead(run);
    if (head === undefined) return { state: "unreadable" };
    const found = await findCommitByTrailer(runner, repository, {
      start: head,
      trailer: provenanceCommitTrailer(effect.idempotencyKey),
    });
    if (found.state === "unreadable") return { state: "unreadable" };
    if (found.state === "absent") return { state: "absent" };
    if (found.commit.parents[0] !== effect.params.baseOid)
      return { state: "unreadable" };
    const files = await readTreeFiles(runner, repository, {
      commit: found.oid,
      directory: effect.params.knowledgeContract.provenance.eventsDirectory,
      maxFiles: MAX_RECORD_FILES,
    });
    if (files === undefined || !recordsAtCommit(files, records))
      return { state: "unreadable" };
    return {
      result: {
        attemptedBaseOid: effect.params.baseOid,
        commitOid: found.oid,
        status: "committed",
        treeOid: found.commit.tree,
      },
      state: "found",
    };
  }

  function bound(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
  ):
    | Readonly<{ ok: true; executorTool: string }>
    | Readonly<{ ok: false; outcome: ProvenanceCommitOutcome }> {
    const contract = effect.params.knowledgeContract;
    if (
      run.knowledgeContract === undefined ||
      canonicalJson(run.knowledgeContract as unknown as JsonValue) !==
        canonicalJson(contract as unknown as JsonValue) ||
      run.repositoryIdentity !== repository.identity ||
      run.gitObjectFormat !== repository.objectFormat
    )
      return { ok: false, outcome: ambiguous() };
    if (run.harness === undefined) return { ok: false, outcome: unavailable() };
    if (
      effect.params.worktreePath !==
      deriveProvenanceWorktreePath(
        contract.provenanceWorktreeRoot,
        effect.idempotencyKey,
      )
    )
      return { ok: false, outcome: ambiguous() };
    return { ok: true, executorTool: run.harness.family };
  }

  async function reconcileProvenanceCommit(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
  ): Promise<ProvenanceCommitOutcome | Readonly<{ status: "absent" }>> {
    const binding = bound(effect, run);
    if (!binding.ok) return binding.outcome;
    const projection = projectProvenanceRecords(
      effect.params,
      binding.executorTool,
    );
    if (!projection.ok) return unavailable();
    if ((await verifyRepository(runner, repository)).state !== "observed")
      return ambiguous();
    const landed = await discoverLanded(effect, run, projection.records);
    if (landed.state === "found")
      return { result: landed.result, status: "observed" };
    return landed.state === "absent" ? { status: "absent" } : ambiguous();
  }

  async function executeProvenanceCommit(
    effect: ProvenanceCommitEffect,
    run: RepositoryRun,
  ): Promise<ProvenanceCommitOutcome> {
    const binding = bound(effect, run);
    if (!binding.ok) return binding.outcome;
    const params = effect.params;
    const contract = params.knowledgeContract;
    const projection = projectProvenanceRecords(params, binding.executorTool);
    const date = provenanceCommitDate(params.timestamp);
    if (!projection.ok || date === undefined) return unavailable();
    if ((await verifyRepository(runner, repository)).state !== "observed")
      return ambiguous();
    const landed = await discoverLanded(effect, run, projection.records);
    if (landed.state === "found")
      return { result: landed.result, status: "observed" };
    if (landed.state === "unreadable") return ambiguous();
    if (!(await realDirectory(contract.provenanceWorktreeRoot)))
      return unavailable();
    const worktreePath = params.worktreePath;
    const trailer = provenanceCommitTrailer(effect.idempotencyKey);
    const subject = provenanceCommitSubject(params.waveId);
    const refusedWorktree = (
      condition: "dirty_worktree" | "unexpected_head",
      observedHeadOid: string | null,
    ): ProvenanceCommitOutcome => ({
      result: {
        condition,
        expectedBaseOid: params.baseOid,
        observedHeadOid,
        reasonDigest: digest({ condition, observedHeadOid, worktreePath }),
        status: "worktree_refused",
      },
      status: "observed",
    });

    let built: Readonly<{ commit: string; tree: string }> | undefined;
    const existing = await discoverDetachedWorktree(runner, repository, {
      path: worktreePath,
    });
    if (existing.state === "unreadable") return ambiguous();
    if (existing.state === "foreign")
      return refusedWorktree("unexpected_head", null);
    if (existing.state === "present") {
      if (!existing.clean)
        return refusedWorktree("dirty_worktree", existing.head);
      if (existing.head !== params.baseOid) {
        const commit = await readCommit(runner, repository, existing.head);
        if (
          commit === undefined ||
          commit.parents.length !== 1 ||
          commit.parents[0] !== params.baseOid ||
          !commit.message.split("\n").includes(trailer) ||
          !(await recordsOnDisk(worktreePath, projection.records))
        )
          return refusedWorktree("unexpected_head", existing.head);
        built = { commit: existing.head, tree: commit.tree };
      }
    } else {
      const created = await ensureDetachedWorktree(runner, repository, {
        head: params.baseOid,
        path: worktreePath,
      });
      if (created.state !== "observed") return ambiguous();
    }

    let generatorFailure: string | undefined;
    if (built === undefined) {
      try {
        for (const record of projection.records) {
          const target = join(worktreePath, record.path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, record.bytes, "utf8");
        }
      } catch {
        return ambiguous();
      }
      const generatorArgv = [
        ...contract.provenance.rollupGeneratorCommand,
        "--output",
        join(worktreePath, contract.provenance.generatedDirectory),
      ];
      const generated = await processPort.run(generatorArgv, {
        cwd: worktreePath,
        env: sanitizedEnvironment({
          SCE_PROVENANCE_BASE_OID: params.baseOid,
        }),
        maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
        timeoutMs: GENERATOR_TIMEOUT_MS,
      });
      if (!succeeded(generated))
        generatorFailure = outcomeDigest(generatorArgv, generated);
      const tree = await writeWorktreeTree(runner, repository, worktreePath);
      if (tree === undefined) return ambiguous();
      const commit = await createProvenanceCommit(runner, repository, {
        identity: {
          date,
          email: PROVENANCE_COMMITTER_EMAIL,
          name: run.controller.holder,
        },
        parent: params.baseOid,
        subject,
        trailer,
        tree,
        worktreePath,
      });
      if (commit === undefined) return ambiguous();
      const pointed = await setDetachedHead(runner, repository, {
        commit,
        worktreePath,
      });
      if (pointed.state !== "observed") return ambiguous();
      built = { commit, tree };
    }

    const reproducibilityFailed = (
      reason: string,
    ): ProvenanceCommitOutcome => ({
      result: {
        attemptedCommitOid: built!.commit,
        attemptedTreeOid: built!.tree,
        reasonDigest: digest({ reason }),
        status: "reproducibility_failed",
      },
      status: "observed",
    });
    if (generatorFailure !== undefined)
      return reproducibilityFailed(`generator:${generatorFailure}`);
    const reproducibility = await processPort.run(
      contract.provenance.reproducibilityCommand,
      {
        cwd: worktreePath,
        env: sanitizedEnvironment({
          SCE_PROVENANCE_BASE_OID: params.baseOid,
          SCE_PROVENANCE_COMMIT_OID: built.commit,
        }),
        maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
        timeoutMs: COMMAND_TIMEOUT_MS,
      },
    );
    if (!succeeded(reproducibility))
      return reproducibilityFailed(
        `check:${outcomeDigest(contract.provenance.reproducibilityCommand, reproducibility)}`,
      );
    const after = await discoverDetachedWorktree(runner, repository, {
      path: worktreePath,
    });
    if (after.state !== "present" || after.head !== built.commit)
      return ambiguous();
    if (!after.clean) return reproducibilityFailed("drift:worktree_dirty");
    if (!(await recordsOnDisk(worktreePath, projection.records)))
      return reproducibilityFailed("drift:records_rewritten");

    const landing: GitEffect =
      run.integrationProfile === "local-ff"
        ? await integrateLocalFastForward(runner, repository, {
            base: params.baseOid,
            candidate: built.commit,
            integrationRef: `refs/heads/${run.integrationBranch}`,
          })
        : options.git.remote === undefined
          ? { code: "GIT_REMOTE_MISSING", state: "refused" }
          : await integrateRemoteFastForward(runner, repository, {
              base: params.baseOid,
              candidate: built.commit,
              integrationBranch: run.integrationBranch,
              remote: options.git.remote,
            });
    if (landing.state === "observed")
      return {
        result: {
          attemptedBaseOid: params.baseOid,
          commitOid: built.commit,
          status: "committed",
          treeOid: built.tree,
        },
        status: "observed",
      };
    if (landing.state === "ambiguous") return ambiguous();
    if (landing.code === "GIT_MOVED_BASE") {
      const advanced = await integrationHead(run);
      if (advanced === undefined || advanced === params.baseOid)
        return ambiguous();
      return {
        result: {
          advancedBaseOid: advanced,
          attemptedCommitOid: built.commit,
          attemptedTreeOid: built.tree,
          status: "base_advanced",
        },
        status: "observed",
      };
    }
    return {
      result: {
        attemptedCommitOid: built.commit,
        attemptedTreeOid: built.tree,
        reasonDigest: digest({ code: landing.code }),
        status: "integration_refused",
      },
      status: "observed",
    };
  }

  async function executeAggregateVerify(
    effect: AggregateVerifyEffect,
    run: RepositoryRun,
  ): Promise<AggregateVerifyOutcome> {
    const params = effect.params;
    const contract = run.knowledgeContract;
    if (
      contract === undefined ||
      run.repositoryIdentity !== repository.identity ||
      run.gitObjectFormat !== repository.objectFormat ||
      canonicalJson(params.commands as unknown as JsonValue) !==
        canonicalJson(contract.combinedVerificationCommands as JsonValue) ||
      params.candidate.headOid !== params.provenanceOid ||
      !params.worktreePath.startsWith(
        `${posix.normalize(contract.provenanceWorktreeRoot)}/sce-provenance-`,
      )
    )
      return ambiguous();
    if ((await verifyRepository(runner, repository)).state !== "observed")
      return ambiguous();
    const commit = await readCommit(runner, repository, params.provenanceOid);
    if (
      commit === undefined ||
      commit.tree !== params.candidate.treeOid ||
      commit.parents[0] !== params.candidate.baseOid
    )
      return ambiguous();
    const worktree = await ensureDetachedWorktree(runner, repository, {
      head: params.provenanceOid,
      path: params.worktreePath,
    });
    if (worktree.state !== "observed") return ambiguous();
    const results: JsonValue[] = [];
    let passed = true;
    for (const argv of params.commands) {
      const outcome = await processPort.run(argv, {
        cwd: params.worktreePath,
        env: sanitizedEnvironment({
          SCE_CANDIDATE_BASE_OID: params.candidate.baseOid,
          SCE_PROVENANCE_COMMIT_OID: params.provenanceOid,
        }),
        maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      results.push(outcomeDigest(argv, outcome));
      if (!succeeded(outcome)) {
        passed = false;
        break;
      }
    }
    return {
      evidenceDigest: digest({
        domain: "sce.provenance.aggregate-verify.v1",
        passed,
        results,
        worktreePath: params.worktreePath,
      }),
      passed,
      status: "observed",
    };
  }

  return {
    executeAggregateVerify,
    executeProvenanceCommit,
    reconcileAggregateVerify: async () => ({ status: "absent" }),
    reconcileProvenanceCommit,
  };
}
