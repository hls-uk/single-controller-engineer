import { realpathSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { spawn } from "node:child_process";

import {
  canonicalAbsolutePath,
  classifyTopology,
  deriveGitIdentity,
  type EmbeddedStoreProof,
  type LocalBareRemoteCanonicalizer,
  type TopologyConfiguration,
  preflightEnvelope,
} from "./identity.js";
import {
  BD_VERSION,
  type BdContextObservation,
  type BdDoltShowObservation,
  type InspectionCommand,
  type PreflightEnvelope,
  type RefusalCode,
  type SanitizedSubprocessObservation,
  type SanitizedSubprocessRequest,
  SanitizedSubprocessRequestSchema,
  isSchema,
  parseBdContextJson,
  parseBdConfigValueJson,
  parseBdDoltShowJson,
  parseBootstrapPlanJson,
} from "./schemas.js";

type CapturedProcess = {
  readonly exitCode: number | null;
  readonly outputExceeded: boolean;
  readonly signal: NodeJS.Signals | null;
  readonly spawnFailed: boolean;
  readonly stdout: string;
  readonly timedOut: boolean;
};

export type ProcessClassificationInput = Pick<
  CapturedProcess,
  "exitCode" | "outputExceeded" | "signal" | "spawnFailed" | "timedOut"
>;

function commandLabel(command: InspectionCommand): string {
  return [command.executable, ...command.argv].join(" ");
}

function normalizedSignal(
  signal: NodeJS.Signals | null,
): "SIGINT" | "SIGTERM" | "SIGKILL" | "other" | undefined {
  if (signal === null) return undefined;
  return signal === "SIGINT" || signal === "SIGTERM" || signal === "SIGKILL"
    ? signal
    : "other";
}

/** Pure, secret-free terminal classification shared by tests and execution. */
export function classifySubprocess(
  command: InspectionCommand,
  result: ProcessClassificationInput,
): SanitizedSubprocessObservation {
  const commandName = commandLabel(command);
  if (result.outputExceeded)
    return { command: commandName, outcome: "output_limit" };
  if (result.timedOut) return { command: commandName, outcome: "timeout" };
  if (result.spawnFailed)
    return { command: commandName, outcome: "unavailable" };
  if (result.signal !== null)
    return {
      command: commandName,
      outcome: "signal",
      signal: normalizedSignal(result.signal) ?? "other",
    };
  if (result.exitCode === 0)
    return { command: commandName, outcome: "ok", exitCode: 0 };
  return {
    command: commandName,
    outcome: "exit",
    exitCode: Math.max(0, Math.min(255, result.exitCode ?? 255)),
  };
}

export function subprocessRefusalCode(
  observation: SanitizedSubprocessObservation,
): RefusalCode | undefined {
  switch (observation.outcome) {
    case "ok":
      return undefined;
    case "exit":
      return "PF_SUBPROCESS_EXIT";
    case "signal":
      return "PF_SUBPROCESS_SIGNAL";
    case "timeout":
      return "PF_SUBPROCESS_TIMEOUT";
    case "output_limit":
      return "PF_SUBPROCESS_OUTPUT_LIMIT";
    case "unavailable":
      return "PF_SUBPROCESS_UNAVAILABLE";
  }
}

function canonicalCwd(cwd: string): string | undefined {
  const lexical = canonicalAbsolutePath(cwd);
  if (lexical === undefined) return undefined;
  try {
    const real = realpathSync(lexical);
    return statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

function canonicalObservedDirectory(path: string): string | undefined {
  const lexical = canonicalAbsolutePath(path);
  if (lexical === undefined) return undefined;
  try {
    const real = realpathSync(lexical);
    return statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

export type ContextDirectoryCanonicalizer = (
  path: string,
) => string | undefined;

/** Canonicalize the context directories before any identity is derived. */
export function canonicalizeContextDirectories(
  context: BdContextObservation,
  canonicalize: ContextDirectoryCanonicalizer,
): BdContextObservation | undefined {
  const cwdRepoRoot = canonicalize(context.cwd_repo_root);
  const repoRoot =
    context.repo_root === undefined
      ? undefined
      : canonicalize(context.repo_root);
  const beadsDir =
    context.beads_dir === undefined
      ? undefined
      : canonicalize(context.beads_dir);
  if (
    cwdRepoRoot === undefined ||
    (context.repo_root !== undefined && repoRoot === undefined) ||
    (context.beads_dir !== undefined && beadsDir === undefined)
  )
    return undefined;
  return {
    ...context,
    ...(beadsDir === undefined ? {} : { beads_dir: beadsDir }),
    cwd_repo_root: cwdRepoRoot,
    ...(repoRoot === undefined ? {} : { repo_root: repoRoot }),
  };
}

/** Filesystem proof for local aliases: realpath plus the minimum bare layout. */
function canonicalLocalBareRepository(path: string): string | undefined {
  const lexical = canonicalAbsolutePath(path);
  if (lexical === undefined) return undefined;
  try {
    const real = realpathSync(lexical);
    if (!statSync(real).isDirectory()) return undefined;
    if (!statSync(join(real, "HEAD")).isFile()) return undefined;
    if (!statSync(join(real, "objects")).isDirectory()) return undefined;
    if (!statSync(join(real, "refs")).isDirectory()) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

const localBareRemoteCanonicalizer: LocalBareRemoteCanonicalizer =
  canonicalLocalBareRepository;

function sanitizedEnvironment(): NodeJS.ProcessEnv | undefined {
  const path = process.env.PATH;
  if (
    path === undefined ||
    path.length === 0 ||
    path.length > 8_192 ||
    path.includes("\u0000")
  )
    return undefined;
  return { LANG: "C", LC_ALL: "C", PATH: path, TZ: "UTC" };
}

async function executeCaptured(
  request: SanitizedSubprocessRequest,
): Promise<CapturedProcess> {
  const cwd = canonicalCwd(request.cwd);
  const env = sanitizedEnvironment();
  if (cwd === undefined || env === undefined)
    return {
      exitCode: null,
      outputExceeded: false,
      signal: null,
      spawnFailed: true,
      stdout: "",
      timedOut: false,
    };
  return new Promise((resolveCapture) => {
    let stdout = "";
    let outputBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let spawnFailed = false;
    const child = spawn(request.command.executable, request.command.argv, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > request.maxOutputBytes) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolveCapture({
        exitCode,
        outputExceeded,
        signal,
        spawnFailed,
        stdout,
        timedOut,
      });
    });
  });
}

/** Executes only an exact allowlisted inspection command; stdout is private. */
export async function executeSanitizedInspection(
  input: unknown,
): Promise<SanitizedSubprocessObservation> {
  if (!isSchema(SanitizedSubprocessRequestSchema, input))
    return { command: "refused", outcome: "unavailable" };
  const request = input as SanitizedSubprocessRequest;
  const captured = await executeCaptured(request);
  return classifySubprocess(request.command, captured);
}

type CapturedInspection = {
  readonly observation: SanitizedSubprocessObservation;
  readonly stdout?: string;
};

async function captureInspection(
  request: SanitizedSubprocessRequest,
): Promise<CapturedInspection> {
  const captured = await executeCaptured(request);
  const observation = classifySubprocess(request.command, captured);
  return {
    observation,
    ...(observation.outcome === "ok" ? { stdout: captured.stdout } : {}),
  };
}

function request(
  cwd: string,
  command: InspectionCommand,
): SanitizedSubprocessRequest {
  return { command, cwd, maxOutputBytes: 65_536, timeoutMs: 10_000 };
}

async function inspectionOutput(
  cwd: string,
  command: InspectionCommand,
): Promise<
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly code: RefusalCode }
> {
  const captured = await captureInspection(request(cwd, command));
  const code = subprocessRefusalCode(captured.observation);
  if (code !== undefined || captured.stdout === undefined)
    return { ok: false, code: code ?? "PF_SUBPROCESS_UNAVAILABLE" };
  return { ok: true, stdout: captured.stdout };
}

function line(source: string): string | undefined {
  const value = source.trim();
  return value.length === 0 || value.includes("\n") ? undefined : value;
}

export function isCanonicalSubdirectory(root: string, path: string): boolean {
  const relation = relative(root, path);
  return (
    relation === "" ||
    (!isAbsolute(relation) && relation !== ".." && !relation.startsWith("../"))
  );
}

export type GitDirectoryObservation = Readonly<{
  commonDir: string;
  topLevel: string;
}>;

/**
 * Proves either one ordinary checkout or an exact linked-worktree/primary
 * pairing. Bare and prefix-only path relationships are rejected.
 */
export function matchesCanonicalGitContext(
  context: BdContextObservation,
  git: GitDirectoryObservation,
): boolean {
  if (
    context.repo_root === undefined ||
    context.beads_dir === undefined ||
    context.is_worktree === undefined ||
    context.cwd_repo_root !== git.topLevel ||
    basename(git.commonDir) !== ".git"
  )
    return false;
  const primaryRoot = dirname(git.commonDir);
  if (
    context.repo_root !== primaryRoot ||
    context.beads_dir !== join(primaryRoot, ".beads")
  )
    return false;
  return context.is_worktree
    ? git.topLevel !== primaryRoot
    : git.topLevel === primaryRoot;
}

const remoteConfigKey = /^remote\.([A-Za-z0-9][A-Za-z0-9._-]*)\.url$/u;
const secretRemoteName =
  /(?:^|[_.-])(?:api[_-]?(?:key|token)|authorization|bearer|cookie|credentials?|passwd|password|private[_-]?key|secret|session[_-]?token|token)(?:$|[_.-])/iu;

/** Privately parses git config --null --get-regexp output without exposing names. */
export function parseGitRemoteConfigOutput(
  source: string,
): string[] | undefined {
  if (source.includes("\uFFFD") || !source.endsWith("\u0000")) return undefined;
  const records = source.slice(0, -1).split("\u0000");
  if (records.length === 0 || records.some((record) => record.length === 0))
    return undefined;
  const urls: string[] = [];
  for (const record of records) {
    const separator = record.indexOf("\n");
    if (separator <= 0 || record.indexOf("\n", separator + 1) !== -1)
      return undefined;
    const key = record.slice(0, separator);
    const url = record.slice(separator + 1);
    if (
      !remoteConfigKey.test(key) ||
      secretRemoteName.test(key) ||
      url.length === 0 ||
      url.length > 1_024 ||
      /[\u0000\r\n\uFFFD]/u.test(url)
    )
      return undefined;
    urls.push(url);
  }
  return urls;
}

function embeddedStoreProof(
  observation: BdDoltShowObservation,
): EmbeddedStoreProof | undefined {
  if (
    observation.backend !== "dolt" ||
    observation.embedded !== true ||
    observation.schema_version !== 1
  )
    return undefined;
  const dataDir = canonicalObservedDirectory(observation.data_dir);
  if (dataDir === undefined) return undefined;
  return {
    backend: "dolt",
    dataDir,
    database: observation.database,
    embedded: true,
    schemaVersion: 1,
  };
}

/**
 * Read-only Phase 2 preflight. It deliberately has no bootstrap, server-start,
 * mutation, or tracker-command path; raw subprocess output is parsed privately.
 */
export async function inspectPreflight(
  cwd: string,
  options: { readonly providerId?: string } = {},
): Promise<PreflightEnvelope> {
  const safeCwd = canonicalCwd(cwd);
  if (safeCwd === undefined)
    return preflightEnvelope(
      { status: "refused", code: "PF_SUBPROCESS_UNAVAILABLE" },
      undefined,
    );
  const version = await inspectionOutput(safeCwd, {
    executable: "bd",
    argv: ["--version"],
  });
  if (!version.ok)
    return preflightEnvelope(
      { status: "refused", code: version.code },
      undefined,
    );
  if (
    !new RegExp(
      `^bd version ${BD_VERSION.replaceAll(".", "\\.")}(?:\\s|$)`,
      "u",
    ).test(version.stdout)
  )
    return preflightEnvelope(
      { status: "refused", code: "PF_BD_VERSION_UNSUPPORTED" },
      undefined,
    );
  const contextOutput = await inspectionOutput(safeCwd, {
    executable: "bd",
    argv: ["context", "--json"],
  });
  if (!contextOutput.ok)
    return preflightEnvelope(
      { status: "refused", code: contextOutput.code },
      undefined,
    );
  const context = parseBdContextJson(contextOutput.stdout);
  if (!context.ok)
    return preflightEnvelope(
      { status: "refused", code: "PF_BD_CONTEXT_INVALID" },
      undefined,
    );
  const canonicalContext = canonicalizeContextDirectories(
    context.value,
    canonicalObservedDirectory,
  );
  if (canonicalContext === undefined)
    return preflightEnvelope(
      { status: "refused", code: "PF_BD_CONTEXT_INVALID" },
      undefined,
    );
  const needsBootstrap =
    canonicalContext.backend === "none" ||
    canonicalContext.backend === "uninitialized" ||
    canonicalContext.dolt_mode === "uninitialized";
  let bootstrap;
  if (needsBootstrap) {
    const bootstrapOutput = await inspectionOutput(safeCwd, {
      executable: "bd",
      argv: ["bootstrap", "--dry-run", "--json"],
    });
    if (!bootstrapOutput.ok)
      return preflightEnvelope(
        { status: "refused", code: bootstrapOutput.code },
        undefined,
      );
    const plan = parseBootstrapPlanJson(bootstrapOutput.stdout);
    if (!plan.ok)
      return preflightEnvelope(
        { status: "refused", code: "PF_BOOTSTRAP_PLAN_INVALID" },
        undefined,
      );
    bootstrap = plan.value;
  }
  let configuration: TopologyConfiguration | undefined;
  if (!needsBootstrap) {
    const syncRemoteOutput = await inspectionOutput(safeCwd, {
      executable: "bd",
      argv: ["config", "get", "sync.remote", "--json"],
    });
    const prefixOutput = await inspectionOutput(safeCwd, {
      executable: "bd",
      argv: ["config", "get", "issue_prefix", "--json"],
    });
    if (!syncRemoteOutput.ok)
      return preflightEnvelope(
        { status: "refused", code: syncRemoteOutput.code },
        undefined,
      );
    if (!prefixOutput.ok)
      return preflightEnvelope(
        { status: "refused", code: prefixOutput.code },
        undefined,
      );
    const syncRemote = parseBdConfigValueJson(
      syncRemoteOutput.stdout,
      "sync.remote",
    );
    const prefix = parseBdConfigValueJson(prefixOutput.stdout, "issue_prefix");
    if (
      !syncRemote.ok ||
      !prefix.ok ||
      (syncRemote.value.value.length > 0 &&
        syncRemote.value.location === undefined)
    )
      return preflightEnvelope(
        { status: "refused", code: "PF_BD_CONFIG_INVALID" },
        undefined,
      );
    configuration = {
      prefix: prefix.value.value,
      syncRemote: syncRemote.value.value,
    };
  }
  let embeddedStore: EmbeddedStoreProof | undefined;
  if (
    canonicalContext.backend === "dolt" &&
    canonicalContext.dolt_mode === "embedded"
  ) {
    const doltShowOutput = await inspectionOutput(safeCwd, {
      executable: "bd",
      argv: ["dolt", "show", "--json"],
    });
    if (!doltShowOutput.ok)
      return preflightEnvelope(
        { status: "refused", code: doltShowOutput.code },
        undefined,
      );
    const doltShow = parseBdDoltShowJson(doltShowOutput.stdout);
    if (!doltShow.ok)
      return preflightEnvelope(
        { status: "refused", code: "PF_TOPOLOGY_CONTRADICTORY" },
        undefined,
      );
    embeddedStore = embeddedStoreProof(doltShow.value);
    if (embeddedStore === undefined)
      return preflightEnvelope(
        { status: "refused", code: "PF_TOPOLOGY_CONTRADICTORY" },
        undefined,
      );
  }
  const topology = classifyTopology(
    canonicalContext,
    bootstrap,
    embeddedStore,
    localBareRemoteCanonicalizer,
    configuration,
  );
  if (topology.status !== "ready")
    return preflightEnvelope(topology, undefined);

  const topLevelOutput = await inspectionOutput(safeCwd, {
    executable: "git",
    argv: ["rev-parse", "--show-toplevel"],
  });
  const commonDirOutput = await inspectionOutput(safeCwd, {
    executable: "git",
    argv: ["rev-parse", "--git-common-dir"],
  });
  const objectFormatOutput = await inspectionOutput(safeCwd, {
    executable: "git",
    argv: ["rev-parse", "--show-object-format"],
  });
  const remoteOutput =
    options.providerId === undefined
      ? await inspectionOutput(safeCwd, {
          executable: "git",
          argv: ["config", "--null", "--get-regexp", "^remote\\..*\\.url$"],
        })
      : undefined;
  if (!topLevelOutput.ok)
    return preflightEnvelope(
      { status: "refused", code: topLevelOutput.code },
      undefined,
    );
  if (!commonDirOutput.ok)
    return preflightEnvelope(
      { status: "refused", code: commonDirOutput.code },
      undefined,
    );
  if (!objectFormatOutput.ok)
    return preflightEnvelope(
      { status: "refused", code: objectFormatOutput.code },
      undefined,
    );
  if (remoteOutput !== undefined && !remoteOutput.ok)
    return preflightEnvelope(
      { status: "refused", code: remoteOutput.code },
      undefined,
    );
  const topLevel = line(topLevelOutput.stdout);
  const commonDirValue = line(commonDirOutput.stdout);
  const objectFormat = line(objectFormatOutput.stdout);
  if (
    topLevel === undefined ||
    commonDirValue === undefined ||
    objectFormat === undefined
  )
    return preflightEnvelope(
      { status: "refused", code: "PF_GIT_INSPECTION_INVALID" },
      undefined,
    );
  const commonDirInput = isAbsolute(commonDirValue)
    ? commonDirValue
    : resolve(topLevel, commonDirValue);
  const canonicalTopLevel = canonicalObservedDirectory(topLevel);
  const commonDir = canonicalObservedDirectory(commonDirInput);
  if (canonicalTopLevel === undefined || commonDir === undefined)
    return preflightEnvelope(
      { status: "refused", code: "PF_GIT_INSPECTION_INVALID" },
      undefined,
    );
  if (
    !matchesCanonicalGitContext(canonicalContext, {
      commonDir,
      topLevel: canonicalTopLevel,
    }) ||
    !isCanonicalSubdirectory(canonicalTopLevel, safeCwd)
  )
    return preflightEnvelope(
      { status: "refused", code: "PF_BD_CONTEXT_INVALID" },
      undefined,
    );
  const remoteUrls =
    remoteOutput === undefined
      ? []
      : remoteOutput.ok
        ? parseGitRemoteConfigOutput(remoteOutput.stdout)
        : undefined;
  if (remoteUrls === undefined)
    return preflightEnvelope(
      { status: "refused", code: "PF_GIT_INSPECTION_INVALID" },
      undefined,
    );
  const git = deriveGitIdentity(
    {
      commonDir,
      objectFormat,
      ...(options.providerId === undefined
        ? {}
        : { providerId: options.providerId }),
      remoteUrls,
      topLevel: canonicalTopLevel,
    },
    localBareRemoteCanonicalizer,
  );
  return preflightEnvelope(topology, git.ok ? git.value : undefined);
}
