import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";

import {
  normalizeGitRemote,
  parseGitRemoteConfigOutput,
} from "../../preflight/index.js";
import { parseGitResult } from "./schemas.js";

export {
  GitEffectSchema,
  GitObjectFormatSchema,
  GitRepositorySchema,
  GitResultSchema,
  GitSnapshotSchema,
  isSchema as isGitSchema,
} from "./schemas.js";

export type GitObjectFormat = "sha1" | "sha256";
export type GitEffectState = "observed" | "refused" | "ambiguous";

export type GitResult = Readonly<{
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  timedOut?: boolean;
  unavailable?: boolean;
}>;

/** An injected seam; adapters never use a shell or interpolate command strings. */
export type GitRunner = (
  request: Readonly<{
    argv: readonly string[];
    cwd: string;
  }>,
) => Promise<GitResult>;

export type GitRepository = Readonly<{
  commonDir: string;
  cwd: string;
  identity: string;
  objectFormat: GitObjectFormat;
  remoteUrls: readonly string[];
}>;

export type GitSnapshot = Readonly<{
  changedPaths: readonly string[];
  clean: boolean;
  head: string;
  tree: string;
}>;

export type GitEffect = Readonly<{
  code:
    | "GIT_OK"
    | "GIT_BAD_INPUT"
    | "GIT_COMMAND_FAILED"
    | "GIT_DIRTY"
    | "GIT_ABSENT"
    | "GIT_FOREIGN_BRANCH"
    | "GIT_FOREIGN_PUBLICATION"
    | "GIT_FOREIGN_WORKTREE"
    | "GIT_IDENTITY_MISMATCH"
    | "GIT_MOVED_BASE"
    | "GIT_NOT_FAST_FORWARD"
    | "GIT_REFUSED"
    | "GIT_REMOTE_AMBIGUOUS"
    | "GIT_REMOTE_MISSING"
    | "GIT_UNSUPPORTED_OBJECT_FORMAT"
    | "GIT_UNRESOLVED_EFFECT";
  state: GitEffectState;
}>;

export type CandidateObservation = GitEffect &
  Readonly<{
    snapshot?: GitSnapshot;
  }>;

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REF = /^(?:[A-Za-z0-9][A-Za-z0-9._/-]*)(?:[A-Za-z0-9._/-])?$/u;
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PATH = /^[^\u0000\r\n]{1,4096}$/u;
const MAX_OUTPUT = 65_536;
const activeHookPaths = new Set<string>();

function exactOid(format: GitObjectFormat, value: string): boolean {
  return OID.test(value) && value.length === (format === "sha1" ? 40 : 64);
}

function safeRef(value: string): boolean {
  return (
    REF.test(value) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("//") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !/[\\ ~^:?*\[\u0000-\u001f\u007f]/u.test(value) &&
    value
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          !part.startsWith(".") &&
          !part.endsWith(".") &&
          !part.endsWith(".lock"),
      )
  );
}

function safePath(value: string): boolean {
  return PATH.test(value) && !value.startsWith("-") && !value.includes("../");
}

function safeAbsolutePath(value: string): boolean {
  return (
    isAbsolute(value) && safePath(value) && normalize(resolve(value)) !== "/"
  );
}

function scopedHookPath(value: string): boolean {
  if (!safeAbsolutePath(value)) return false;
  const root = normalize(resolve(tmpdir()));
  const candidate = normalize(resolve(value));
  const suffix = relative(root, candidate);
  return (
    !isAbsolute(suffix) &&
    !suffix.startsWith("../") &&
    suffix.startsWith("sce-git-pre-push-") &&
    !suffix.includes("/") &&
    activeHookPaths.has(candidate)
  );
}

function allowedGitArgv(argv: readonly string[]): boolean {
  const [command, ...args] = argv;
  if (command === "rev-parse")
    return (
      (args.length === 1 &&
        ["--git-common-dir", "--show-object-format"].includes(args[0] ?? "")) ||
      (args.length === 2 &&
        args[0] === "--verify" &&
        ["HEAD^{commit}", "HEAD^{tree}"].includes(args[1] ?? ""))
    );
  if (command === "config")
    return (
      args.length === 3 &&
      args[0] === "--null" &&
      args[1] === "--get-regexp" &&
      args[2] === "^remote\\..*\\.url$"
    );
  if (command === "for-each-ref")
    return (
      args.length === 2 &&
      args[0] === "--format=%(objectname)" &&
      args[1]?.startsWith("refs/heads/") === true &&
      safeRef(args[1].slice(11))
    );
  if (command === "branch")
    return (
      args.length === 2 && safeRef(args[0] ?? "") && OID.test(args[1] ?? "")
    );
  if (command === "worktree")
    return (
      (args.length === 2 && args[0] === "list" && args[1] === "--porcelain") ||
      (args.length === 3 &&
        args[0] === "add" &&
        safeAbsolutePath(args[1] ?? "") &&
        safeRef(args[2] ?? ""))
    );
  if (command === "status")
    return (
      args.length === 2 && args[0] === "--porcelain=v1" && args[1] === "-z"
    );
  if (command === "merge-base")
    return (
      args.length === 3 &&
      args[0] === "--is-ancestor" &&
      OID.test(args[1] ?? "") &&
      OID.test(args[2] ?? "")
    );
  if (command === "diff")
    return (
      args.length === 4 &&
      args[0] === "--name-only" &&
      args[1] === "-z" &&
      args[2] === "--no-renames" &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})\.\.(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(
        args[3] ?? "",
      )
    );
  if (command === "symbolic-ref")
    return args.length === 2 && args[0] === "-q" && args[1] === "HEAD";
  if (command === "merge")
    return (
      args.length === 2 && args[0] === "--ff-only" && OID.test(args[1] ?? "")
    );
  if (command === "remote")
    return (
      args.length === 4 &&
      args[0] === "get-url" &&
      args[1] === "--all" &&
      args[2] === "--push" &&
      REMOTE.test(args[3] ?? "")
    );
  if (command === "ls-remote")
    return (
      args.length === 4 &&
      args[0] === "--refs" &&
      args[1] === "--exit-code" &&
      REMOTE.test(args[2] ?? "") &&
      args[3]?.startsWith("refs/heads/") === true &&
      safeRef(args[3].slice(11))
    );
  if (command === "push") {
    const destination = /^([0-9a-f]{40}|[0-9a-f]{64}):refs\/heads\/(.+)$/u.exec(
      args[1] ?? "",
    );
    return (
      args.length === 2 &&
      REMOTE.test(args[0] ?? "") &&
      destination !== null &&
      safeRef(destination[2] ?? "")
    );
  }
  if (command === "-c") {
    const hookPath = (args[0] ?? "").slice("core.hooksPath=".length);
    const destination = /^([0-9a-f]{40}|[0-9a-f]{64}):refs\/heads\/(.+)$/u.exec(
      args[3] ?? "",
    );
    return (
      args.length === 4 &&
      args[0]?.startsWith("core.hooksPath=") === true &&
      scopedHookPath(hookPath) &&
      args[1] === "push" &&
      REMOTE.test(args[2] ?? "") &&
      destination !== null &&
      safeRef(destination[2] ?? "")
    );
  }
  return false;
}

function canonicalWorktreePath(value: string): string | undefined {
  if (!safeAbsolutePath(value)) return undefined;
  try {
    return normalize(realpathSync(value));
  } catch {
    try {
      return join(normalize(realpathSync(dirname(value))), basename(value));
    } catch {
      return undefined;
    }
  }
}

function canonicalExistingOrLexical(value: string): string {
  try {
    return normalize(realpathSync(value));
  } catch {
    return normalize(resolve(value));
  }
}

function effect(state: GitEffectState, code: GitEffect["code"]): GitEffect {
  return { code, state };
}

function commandOk(result: GitResult): boolean {
  return (
    result.exitCode === 0 &&
    result.signal === null &&
    result.timedOut !== true &&
    result.unavailable !== true &&
    Buffer.byteLength(result.stdout, "utf8") <= MAX_OUTPUT
  );
}

function terminalFailure(result: GitResult): GitEffect | undefined {
  if (result.timedOut === true || result.signal !== null)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (result.unavailable === true)
    return effect("refused", "GIT_COMMAND_FAILED");
  if (Buffer.byteLength(result.stdout, "utf8") > MAX_OUTPUT)
    return effect("refused", "GIT_COMMAND_FAILED");
  return undefined;
}

function lines(value: string): string[] | undefined {
  if (value.includes("\u0000") || value.length > MAX_OUTPUT) return undefined;
  const output = value.trimEnd();
  if (output.length === 0) return [];
  const result = output.split("\n");
  return result.some((line) => line.length === 0 || line.includes("\r"))
    ? undefined
    : result;
}

function oneLine(value: string): string | undefined {
  const result = lines(value);
  return result?.length === 1 ? result[0] : undefined;
}

function nulPaths(value: string): string[] | undefined {
  if (value.length === 0) return [];
  if (!value.endsWith("\u0000") || value.length > MAX_OUTPUT) return undefined;
  const paths = value.slice(0, -1).split("\u0000");
  if (paths.some((path) => !safePath(path))) return undefined;
  return paths;
}

function outputResult(result: GitResult): GitEffect | undefined {
  return (
    terminalFailure(result) ??
    (commandOk(result) ? undefined : effect("refused", "GIT_COMMAND_FAILED"))
  );
}

function validRepository(repository: GitRepository): boolean {
  return (
    safeAbsolutePath(repository.cwd) &&
    safeAbsolutePath(repository.commonDir) &&
    repository.identity.length > 0 &&
    repository.identity.length <= 1024 &&
    !repository.identity.includes("\u0000") &&
    repository.remoteUrls.length <= 16 &&
    repository.remoteUrls.every(
      (url) => url.length > 0 && url.length <= 1024 && !url.includes("\u0000"),
    ) &&
    (repository.objectFormat === "sha1" || repository.objectFormat === "sha256")
  );
}

function localIdentity(repository: GitRepository): string {
  return `local:${canonicalExistingOrLexical(repository.commonDir)}`;
}

function validScope(value: string): boolean {
  return (
    safePath(value) &&
    !isAbsolute(value) &&
    value !== "." &&
    !value.endsWith("/") &&
    value
      .split("/")
      .every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function disjointScopes(scopes: readonly string[]): boolean {
  return scopes.every(
    (scope, index) =>
      scopes.findIndex((other) => other === scope) === index &&
      !scopes.some((other) => other !== scope && containedBy(other, scope)),
  );
}

function canonicalRemoteAliases(urls: readonly string[]): string[] | undefined {
  const aliases = urls.map((url) =>
    normalizeGitRemote(url, (path) => canonicalGitCommonDir(path)),
  );
  return aliases.some((alias) => alias === undefined)
    ? undefined
    : [...new Set(aliases as string[])].sort();
}

async function run(
  runner: GitRunner,
  repository: GitRepository,
  argv: readonly string[],
): Promise<GitResult> {
  try {
    const observed = parseGitResult(
      await runner({ argv, cwd: repository.cwd }),
    ) as GitResult | undefined;
    return (
      observed ?? {
        exitCode: null,
        signal: null,
        stdout: "",
        unavailable: true,
      }
    );
  } catch {
    return { exitCode: null, signal: null, stdout: "", unavailable: true };
  }
}

async function runAt(
  runner: GitRunner,
  cwd: string,
  argv: readonly string[],
): Promise<GitResult> {
  try {
    const observed = parseGitResult(await runner({ argv, cwd })) as
      GitResult | undefined;
    return (
      observed ?? {
        exitCode: null,
        signal: null,
        stdout: "",
        unavailable: true,
      }
    );
  } catch {
    return { exitCode: null, signal: null, stdout: "", unavailable: true };
  }
}

async function refOid(
  runner: GitRunner,
  repository: GitRepository,
  ref: string,
): Promise<
  | Readonly<{ state: "found"; oid: string }>
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "unreadable" }>
> {
  const result = await run(runner, repository, [
    "for-each-ref",
    "--format=%(objectname)",
    ref,
  ]);
  if (terminalFailure(result) !== undefined) return { state: "unreadable" };
  if (!commandOk(result)) return { state: "unreadable" };
  if (result.stdout.length === 0) return { state: "missing" };
  const value = oneLine(result.stdout);
  return value !== undefined && exactOid(repository.objectFormat, value)
    ? { state: "found", oid: value }
    : { state: "unreadable" };
}

async function remoteRefOid(
  runner: GitRunner,
  repository: GitRepository,
  remote: string,
  ref: string,
): Promise<
  | Readonly<{ state: "found"; oid: string }>
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "unreadable" }>
> {
  const result = await run(runner, repository, [
    "ls-remote",
    "--refs",
    "--exit-code",
    remote,
    ref,
  ]);
  if (terminalFailure(result) !== undefined) return { state: "unreadable" };
  if (result.exitCode === 2 && result.signal === null)
    return { state: "missing" };
  if (!commandOk(result)) return { state: "unreadable" };
  const record = oneLine(result.stdout);
  if (record === undefined) return { state: "unreadable" };
  const fields = record.split("\t");
  return fields.length === 2 &&
    fields[0] !== undefined &&
    fields[1] === ref &&
    exactOid(repository.objectFormat, fields[0])
    ? { state: "found", oid: fields[0] }
    : { state: "unreadable" };
}

function containedBy(scope: string, path: string): boolean {
  return path === scope || path.startsWith(`${scope}/`);
}

async function verifyWorktreeOwnership(
  runner: GitRunner,
  repository: GitRepository,
  path: string,
): Promise<GitEffect> {
  const result = await runAt(runner, path, ["rev-parse", "--git-common-dir"]);
  const failure = outputResult(result);
  if (failure !== undefined) return effect("refused", "GIT_FOREIGN_WORKTREE");
  const observed = oneLine(result.stdout);
  if (observed === undefined || !safePath(observed))
    return effect("refused", "GIT_FOREIGN_WORKTREE");
  const commonDir = isAbsolute(observed)
    ? normalize(resolve(observed))
    : normalize(resolve(path, observed));
  return canonicalExistingOrLexical(commonDir) ===
    canonicalExistingOrLexical(repository.commonDir)
    ? effect("observed", "GIT_OK")
    : effect("refused", "GIT_FOREIGN_WORKTREE");
}

async function verifyCleanWorktree(
  runner: GitRunner,
  repository: GitRepository,
  path: string,
): Promise<GitEffect> {
  const ownership = await verifyWorktreeOwnership(runner, repository, path);
  if (ownership.state !== "observed") return ownership;
  const status = await runAt(runner, path, ["status", "--porcelain=v1", "-z"]);
  if (!commandOk(status)) return effect("refused", "GIT_FOREIGN_WORKTREE");
  return status.stdout.length === 0
    ? effect("observed", "GIT_OK")
    : effect("refused", "GIT_DIRTY");
}

async function verifySinglePushRemote(
  runner: GitRunner,
  repository: GitRepository,
  remote: string,
): Promise<GitEffect> {
  const result = await run(runner, repository, [
    "remote",
    "get-url",
    "--all",
    "--push",
    remote,
  ]);
  const failure = outputResult(result);
  if (failure !== undefined) return effect("refused", "GIT_REMOTE_AMBIGUOUS");
  const urls = lines(result.stdout);
  // Multiple push URLs make one git push an uncontrolled set of external acts.
  if (
    urls?.length !== 1 ||
    urls[0] === undefined ||
    /(?:^|[/:@])(?:token|password|secret|bearer|authorization)(?:[=:]|$)/iu.test(
      urls[0],
    )
  )
    return effect("refused", "GIT_REMOTE_AMBIGUOUS");
  const expectedAliases = canonicalRemoteAliases(repository.remoteUrls);
  const pushAliases = canonicalRemoteAliases(urls);
  if (
    expectedAliases === undefined ||
    pushAliases === undefined ||
    pushAliases.length !== 1 ||
    !expectedAliases.includes(pushAliases[0] ?? "")
  )
    return effect("refused", "GIT_REMOTE_AMBIGUOUS");
  return effect("observed", "GIT_OK");
}

/**
 * Git's ordinary non-force fast-forward rule cannot distinguish an approved
 * base from an intervening ancestor. A one-shot pre-push hook receives the
 * remote's advertised old OID in this push transaction and rejects any move.
 * It lives in a private temporary directory and never changes repository hooks.
 */
async function guardedPush(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{
    base: string;
    candidate: string;
    ref: string;
    remote: string;
  }>,
): Promise<GitResult> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "sce-git-pre-push-"));
    const hook = join(directory, "pre-push");
    await writeFile(
      hook,
      `#!/bin/sh\nIFS=' '\nread -r local_ref local_oid remote_ref remote_oid || exit 1\n[ "$local_oid" = '${input.candidate}' ] || exit 1\n[ "$remote_ref" = '${input.ref}' ] || exit 1\n[ "$remote_oid" = '${input.base}' ] || exit 1\nexit 0\n`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(hook, 0o700);
    activeHookPaths.add(normalize(resolve(directory)));
    return await run(runner, repository, [
      "-c",
      `core.hooksPath=${directory}`,
      "push",
      input.remote,
      `${input.candidate}:${input.ref}`,
    ]);
  } catch {
    return { exitCode: null, signal: null, stdout: "", unavailable: true };
  } finally {
    if (directory !== undefined) {
      activeHookPaths.delete(normalize(resolve(directory)));
      await rm(directory, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }
}

/** Verify exact common-dir/object-format identity before every mutating effect. */
export async function verifyRepository(
  runner: GitRunner,
  repository: GitRepository,
): Promise<GitEffect> {
  if (!validRepository(repository)) return effect("refused", "GIT_BAD_INPUT");
  const [common, format, remotes] = await Promise.all([
    run(runner, repository, ["rev-parse", "--git-common-dir"]),
    run(runner, repository, ["rev-parse", "--show-object-format"]),
    run(runner, repository, [
      "config",
      "--null",
      "--get-regexp",
      "^remote\\..*\\.url$",
    ]),
  ]);
  const failure =
    terminalFailure(common) ??
    terminalFailure(format) ??
    terminalFailure(remotes);
  if (failure !== undefined) return failure;
  if (!commandOk(common) || !commandOk(format))
    return effect("refused", "GIT_COMMAND_FAILED");
  const commonDir = oneLine(common.stdout);
  const objectFormat = oneLine(format.stdout);
  if (
    commonDir === undefined ||
    objectFormat === undefined ||
    !safePath(commonDir) ||
    objectFormat !== repository.objectFormat
  )
    return effect("refused", "GIT_UNSUPPORTED_OBJECT_FORMAT");
  const canonicalCommon = isAbsolute(commonDir)
    ? normalize(resolve(commonDir))
    : normalize(resolve(repository.cwd, commonDir));
  if (
    canonicalExistingOrLexical(canonicalCommon) !==
    canonicalExistingOrLexical(repository.commonDir)
  )
    return effect("refused", "GIT_IDENTITY_MISMATCH");
  const noConfiguredRemotes =
    remotes.exitCode === 1 &&
    remotes.signal === null &&
    remotes.stdout.length === 0;
  if (!commandOk(remotes) && !noConfiguredRemotes)
    return effect("refused", "GIT_COMMAND_FAILED");
  const actualUrls = noConfiguredRemotes
    ? []
    : parseGitRemoteConfigOutput(remotes.stdout);
  const expectedAliases = canonicalRemoteAliases(repository.remoteUrls);
  const actualAliases =
    actualUrls === undefined ? undefined : canonicalRemoteAliases(actualUrls);
  if (
    expectedAliases === undefined ||
    actualAliases === undefined ||
    expectedAliases.length !== actualAliases.length ||
    expectedAliases.some((alias, index) => alias !== actualAliases[index])
  )
    return effect("refused", "GIT_IDENTITY_MISMATCH");
  if (
    actualAliases.length === 0 &&
    repository.identity !== localIdentity(repository)
  )
    return effect("refused", "GIT_IDENTITY_MISMATCH");
  if (
    actualAliases.length > 0 &&
    !repository.identity.startsWith("provider:") &&
    (actualAliases.length !== 1 || actualAliases[0] !== repository.identity)
  )
    return effect("refused", "GIT_IDENTITY_MISMATCH");
  return effect("observed", "GIT_OK");
}

/** Reads only the exact candidate state and rejects dirty or out-of-scope bytes. */
export async function observeCandidate(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{
    allowedPaths: readonly string[];
    base: string;
    expectedHead: string;
    expectedTree: string;
  }>,
): Promise<CandidateObservation> {
  if (
    !exactOid(repository.objectFormat, input.base) ||
    !exactOid(repository.objectFormat, input.expectedHead) ||
    !exactOid(repository.objectFormat, input.expectedTree) ||
    input.allowedPaths.length === 0 ||
    input.allowedPaths.some((path) => !validScope(path)) ||
    !disjointScopes(input.allowedPaths)
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const [headResult, treeResult, statusResult, ancestorResult, diffResult] =
    await Promise.all([
      run(runner, repository, ["rev-parse", "--verify", "HEAD^{commit}"]),
      run(runner, repository, ["rev-parse", "--verify", "HEAD^{tree}"]),
      run(runner, repository, ["status", "--porcelain=v1", "-z"]),
      run(runner, repository, [
        "merge-base",
        "--is-ancestor",
        input.base,
        input.expectedHead,
      ]),
      run(runner, repository, [
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        `${input.base}..${input.expectedHead}`,
      ]),
    ]);
  for (const result of [
    headResult,
    treeResult,
    statusResult,
    ancestorResult,
    diffResult,
  ]) {
    const failure = terminalFailure(result);
    if (failure !== undefined) return failure;
  }
  if (
    !commandOk(headResult) ||
    !commandOk(treeResult) ||
    !commandOk(statusResult) ||
    !commandOk(ancestorResult) ||
    !commandOk(diffResult)
  )
    return effect("refused", "GIT_REFUSED");
  const head = oneLine(headResult.stdout);
  const tree = oneLine(treeResult.stdout);
  const changedPaths = nulPaths(diffResult.stdout);
  if (
    head === undefined ||
    tree === undefined ||
    changedPaths === undefined ||
    !exactOid(repository.objectFormat, head) ||
    !exactOid(repository.objectFormat, tree) ||
    head !== input.expectedHead ||
    tree !== input.expectedTree
  )
    return effect("refused", "GIT_REFUSED");
  const clean = statusResult.stdout.length === 0;
  if (!clean) return effect("refused", "GIT_DIRTY");
  const canonicalChangedPaths = [...new Set(changedPaths)].sort();
  if (
    canonicalChangedPaths.some(
      (path) => !input.allowedPaths.some((scope) => containedBy(scope, path)),
    )
  )
    return effect("refused", "GIT_REFUSED");
  return {
    code: "GIT_OK",
    snapshot: { changedPaths: canonicalChangedPaths, clean, head, tree },
    state: "observed",
  };
}

/** Idempotently creates an exact branch or refuses a branch owned by another head. */
export async function ensureBranch(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{ base: string; branch: string }>,
): Promise<GitEffect> {
  if (!safeRef(input.branch) || !exactOid(repository.objectFormat, input.base))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const ref = `refs/heads/${input.branch}`;
  const before = await refOid(runner, repository, ref);
  if (before.state === "found" && before.oid === input.base)
    return effect("observed", "GIT_OK");
  if (before.state !== "missing") return effect("refused", "GIT_REFUSED");
  const created = await run(runner, repository, [
    "branch",
    input.branch,
    input.base,
  ]);
  const after = await refOid(runner, repository, ref);
  if (after.state === "found" && after.oid === input.base)
    return effect("observed", "GIT_OK");
  if (after.state === "unreadable" || terminalFailure(created) !== undefined)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return created.exitCode === 0
    ? effect("ambiguous", "GIT_UNRESOLVED_EFFECT")
    : effect("refused", "GIT_REFUSED");
}

/** Read-only branch recovery probe; it never calls `git branch`. */
export async function discoverBranch(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{ base: string; branch: string }>,
): Promise<GitEffect> {
  if (!safeRef(input.branch) || !exactOid(repository.objectFormat, input.base))
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const current = await refOid(
    runner,
    repository,
    `refs/heads/${input.branch}`,
  );
  if (current.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (current.state === "missing") return effect("refused", "GIT_ABSENT");
  return current.oid === input.base
    ? effect("observed", "GIT_OK")
    : effect("refused", "GIT_FOREIGN_BRANCH");
}

type WorktreeRecord = Readonly<{
  branch?: string;
  head?: string;
  path: string;
}>;

function parseWorktreeList(
  source: string,
  format: GitObjectFormat,
): WorktreeRecord[] | undefined {
  const blocks = source.trimEnd().split("\n\n");
  if (blocks.length === 0 || blocks.some((block) => block.length === 0))
    return undefined;
  const records: WorktreeRecord[] = [];
  for (const block of blocks) {
    const fields = new Map<string, string>();
    for (const line of block.split("\n")) {
      const position = line.indexOf(" ");
      if (position === -1) {
        if (!["bare", "detached", "locked", "prunable"].includes(line))
          return undefined;
        if (fields.has(line)) return undefined;
        fields.set(line, "");
        continue;
      }
      if (position < 1 || fields.has(line.slice(0, position))) return undefined;
      if (
        !["worktree", "HEAD", "branch", "locked", "prunable"].includes(
          line.slice(0, position),
        )
      )
        return undefined;
      fields.set(line.slice(0, position), line.slice(position + 1));
    }
    const path = fields.get("worktree");
    const head = fields.get("HEAD");
    const branch = fields.get("branch");
    if (
      path === undefined ||
      !safeAbsolutePath(path) ||
      (head !== undefined && !exactOid(format, head)) ||
      (branch !== undefined &&
        (!branch.startsWith("refs/heads/") || !safeRef(branch.slice(11))))
    )
      return undefined;
    records.push({
      ...(branch === undefined ? {} : { branch }),
      ...(head === undefined ? {} : { head }),
      path,
    });
  }
  return records;
}

/** Worktree creation is idempotent only for the same canonical path/branch/head triple. */
export async function ensureWorktree(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{ branch: string; head: string; path: string }>,
): Promise<GitEffect> {
  if (
    !safeRef(input.branch) ||
    !exactOid(repository.objectFormat, input.head) ||
    !safeAbsolutePath(input.path)
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const listed = await run(runner, repository, [
    "worktree",
    "list",
    "--porcelain",
  ]);
  const listFailure = outputResult(listed);
  if (listFailure !== undefined) return listFailure;
  const records = parseWorktreeList(listed.stdout, repository.objectFormat);
  if (records === undefined) return effect("refused", "GIT_REFUSED");
  const wantedPath = canonicalWorktreePath(input.path);
  if (wantedPath === undefined) return effect("refused", "GIT_BAD_INPUT");
  const existing = records.find((record) => record.path === wantedPath);
  const wantedBranch = `refs/heads/${input.branch}`;
  if (existing !== undefined)
    return existing.head === input.head && existing.branch === wantedBranch
      ? verifyCleanWorktree(runner, repository, input.path)
      : effect("refused", "GIT_FOREIGN_WORKTREE");
  if (records.some((record) => record.branch === wantedBranch))
    return effect("refused", "GIT_FOREIGN_WORKTREE");
  const added = await run(runner, repository, [
    "worktree",
    "add",
    input.path,
    input.branch,
  ]);
  const reread = await run(runner, repository, [
    "worktree",
    "list",
    "--porcelain",
  ]);
  if (!commandOk(reread)) return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  const discovered = parseWorktreeList(
    reread.stdout,
    repository.objectFormat,
  )?.find((record) => record.path === wantedPath);
  if (discovered?.head !== input.head || discovered.branch !== wantedBranch)
    return terminalFailure(added) === undefined && added.exitCode !== 0
      ? effect("refused", "GIT_REFUSED")
      : effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return verifyCleanWorktree(runner, repository, input.path);
}

/** Read-only worktree recovery probe; absence is distinguished from foreign. */
export async function discoverWorktree(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{ branch: string; head: string; path: string }>,
): Promise<GitEffect> {
  if (
    !safeRef(input.branch) ||
    !exactOid(repository.objectFormat, input.head) ||
    !safeAbsolutePath(input.path)
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const listed = await run(runner, repository, [
    "worktree",
    "list",
    "--porcelain",
  ]);
  const failure = outputResult(listed);
  if (failure !== undefined) return failure;
  const records = parseWorktreeList(listed.stdout, repository.objectFormat);
  const wantedPath = canonicalWorktreePath(input.path);
  if (records === undefined || wantedPath === undefined)
    return effect("refused", "GIT_REFUSED");
  const existing = records.find((record) => record.path === wantedPath);
  if (existing === undefined) return effect("refused", "GIT_ABSENT");
  return existing.head === input.head &&
    existing.branch === `refs/heads/${input.branch}`
    ? verifyCleanWorktree(runner, repository, input.path)
    : effect("refused", "GIT_FOREIGN_WORKTREE");
}

/** Recovery is read-only: it determines whether an intent already took effect. */
export async function discoverIntegration(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{ base: string; candidate: string; integrationRef: string }>,
): Promise<GitEffect> {
  if (
    !safeRef(input.integrationRef) ||
    !exactOid(repository.objectFormat, input.base) ||
    !exactOid(repository.objectFormat, input.candidate) ||
    input.base === input.candidate
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const current = await refOid(runner, repository, input.integrationRef);
  if (current.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (current.state !== "found")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (current.oid === input.candidate) return effect("observed", "GIT_OK");
  // Only an exact durable base can authorize the coordinator's one local
  // fast-forward attempt. Missing, foreign, and unreadable refs are never
  // positive absence because they cannot prove the persisted precondition.
  return current.oid === input.base
    ? effect("refused", "GIT_ABSENT")
    : effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
}

/** local-ff checks the approved base immediately before merge and reads its result back. */
export async function integrateLocalFastForward(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{ base: string; candidate: string; integrationRef: string }>,
): Promise<GitEffect> {
  if (
    !safeRef(input.integrationRef) ||
    !exactOid(repository.objectFormat, input.base) ||
    !exactOid(repository.objectFormat, input.candidate)
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const before = await refOid(runner, repository, input.integrationRef);
  if (before.state !== "found" || before.oid !== input.base)
    return effect("refused", "GIT_MOVED_BASE");
  const headRef = await run(runner, repository, ["symbolic-ref", "-q", "HEAD"]);
  if (!commandOk(headRef) || oneLine(headRef.stdout) !== input.integrationRef)
    return effect("refused", "GIT_FOREIGN_WORKTREE");
  const clean = await run(runner, repository, [
    "status",
    "--porcelain=v1",
    "-z",
  ]);
  if (!commandOk(clean) || clean.stdout.length !== 0)
    return effect("refused", "GIT_DIRTY");
  const merged = await run(runner, repository, [
    "merge",
    "--ff-only",
    input.candidate,
  ]);
  const after = await refOid(runner, repository, input.integrationRef);
  if (after.state === "found" && after.oid === input.candidate)
    return effect("observed", "GIT_OK");
  if (after.state === "unreadable" || terminalFailure(merged) !== undefined)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return merged.exitCode === 0
    ? effect("ambiguous", "GIT_UNRESOLVED_EFFECT")
    : effect("refused", "GIT_NOT_FAST_FORWARD");
}

/** Candidate branch publication is a boundary: it never requests provider integration. */
export async function publishCandidate(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{ candidate: string; remote: string; remoteBranch: string }>,
): Promise<GitEffect> {
  if (
    !REMOTE.test(input.remote) ||
    !safeRef(input.remoteBranch) ||
    !exactOid(repository.objectFormat, input.candidate)
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const remoteVerified = await verifySinglePushRemote(
    runner,
    repository,
    input.remote,
  );
  if (remoteVerified.state !== "observed") return remoteVerified;
  const pushed = await run(runner, repository, [
    "push",
    input.remote,
    `${input.candidate}:refs/heads/${input.remoteBranch}`,
  ]);
  const remote = await remoteRefOid(
    runner,
    repository,
    input.remote,
    `refs/heads/${input.remoteBranch}`,
  );
  if (remote.state === "found" && remote.oid === input.candidate)
    return effect("observed", "GIT_OK");
  if (remote.state === "unreadable" || terminalFailure(pushed) !== undefined)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
}

/** Read-only remote-ref publication recovery probe. */
export async function discoverPublication(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{ candidate: string; remote: string; remoteBranch: string }>,
): Promise<GitEffect> {
  if (
    !REMOTE.test(input.remote) ||
    !safeRef(input.remoteBranch) ||
    !exactOid(repository.objectFormat, input.candidate)
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const remoteVerified = await verifySinglePushRemote(
    runner,
    repository,
    input.remote,
  );
  if (remoteVerified.state !== "observed") return remoteVerified;
  const current = await remoteRefOid(
    runner,
    repository,
    input.remote,
    `refs/heads/${input.remoteBranch}`,
  );
  if (current.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (current.state === "missing") return effect("refused", "GIT_ABSENT");
  return current.oid === input.candidate
    ? effect("observed", "GIT_OK")
    : effect("refused", "GIT_FOREIGN_PUBLICATION");
}

/**
 * One non-force candidate-to-integration push.  The server's fast-forward
 * rule is the CAS: a remote base change must reject this exact ref update.
 */
export async function integrateRemoteFastForward(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{
    base: string;
    candidate: string;
    integrationBranch: string;
    remote: string;
  }>,
): Promise<GitEffect> {
  if (
    !REMOTE.test(input.remote) ||
    !safeRef(input.integrationBranch) ||
    !exactOid(repository.objectFormat, input.base) ||
    !exactOid(repository.objectFormat, input.candidate)
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const remoteVerified = await verifySinglePushRemote(
    runner,
    repository,
    input.remote,
  );
  if (remoteVerified.state !== "observed") return remoteVerified;
  const ref = `refs/heads/${input.integrationBranch}`;
  const before = await remoteRefOid(runner, repository, input.remote, ref);
  if (before.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (before.state === "found" && before.oid === input.candidate)
    return effect("observed", "GIT_OK");
  if (before.state === "missing")
    return effect("refused", "GIT_REMOTE_MISSING");
  if (before.oid !== input.base) return effect("refused", "GIT_MOVED_BASE");
  const pushed = await guardedPush(runner, repository, {
    base: input.base,
    candidate: input.candidate,
    ref,
    remote: input.remote,
  });
  const after = await remoteRefOid(runner, repository, input.remote, ref);
  if (after.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (after.state === "found" && after.oid === input.candidate)
    return effect("observed", "GIT_OK");
  if (after.state === "found" && after.oid !== input.base)
    return effect("refused", "GIT_MOVED_BASE");
  if (after.state === "missing" || terminalFailure(pushed) !== undefined)
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (pushed.exitCode !== 0) return effect("refused", "GIT_NOT_FAST_FORWARD");
  return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
}

/** Read-only remote recovery for a persisted integration intent. */
export async function discoverRemoteIntegration(
  runner: GitRunner,
  repository: GitRepository,
  input: Readonly<{
    base: string;
    candidate: string;
    integrationBranch: string;
    remote: string;
  }>,
): Promise<GitEffect> {
  if (
    !REMOTE.test(input.remote) ||
    !safeRef(input.integrationBranch) ||
    !exactOid(repository.objectFormat, input.base) ||
    !exactOid(repository.objectFormat, input.candidate) ||
    input.base === input.candidate
  )
    return effect("refused", "GIT_BAD_INPUT");
  const verified = await verifyRepository(runner, repository);
  if (verified.state !== "observed") return verified;
  const remoteVerified = await verifySinglePushRemote(
    runner,
    repository,
    input.remote,
  );
  if (remoteVerified.state !== "observed") return remoteVerified;
  const observed = await remoteRefOid(
    runner,
    repository,
    input.remote,
    `refs/heads/${input.integrationBranch}`,
  );
  if (observed.state === "unreadable")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (observed.state === "missing")
    return effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
  if (observed.oid === input.candidate) return effect("observed", "GIT_OK");
  // Only the exact durable remote base can authorize one guarded non-force
  // update. A missing or third-party remote tip has no positive precondition.
  return observed.oid === input.base
    ? effect("refused", "GIT_ABSENT")
    : effect("ambiguous", "GIT_UNRESOLVED_EFFECT");
}

/** Production runner for the adapter; tests normally inject a deterministic seam. */
export const nodeGitRunner: GitRunner = async ({ argv, cwd }) => {
  if (!safeAbsolutePath(cwd) || !allowedGitArgv(argv))
    return { exitCode: null, signal: null, stdout: "", unavailable: true };
  return new Promise((done) => {
    let stdout = "";
    let outputBytes = 0;
    let timedOut = false;
    let unavailable = false;
    const child = spawn("/usr/bin/git", argv, {
      cwd,
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin", TZ: "UTC" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const consume = (isStdout: boolean, chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT) child.kill("SIGKILL");
      else if (isStdout) stdout += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => consume(true, chunk));
    child.stderr.on("data", (chunk: Buffer) => consume(false, chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 15_000);
    child.once("error", () => {
      unavailable = true;
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      done({ exitCode, signal, stdout, timedOut, unavailable });
    });
  });
};

/** Canonical local identity proof used by direct callers that have filesystem authority. */
export function canonicalGitCommonDir(path: string): string | undefined {
  if (!safeAbsolutePath(path)) return undefined;
  try {
    const canonical = realpathSync(path);
    return safeAbsolutePath(canonical) ? canonical : undefined;
  } catch {
    return undefined;
  }
}

export function isPathWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}
