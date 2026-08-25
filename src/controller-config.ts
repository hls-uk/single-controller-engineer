/**
 * Explicit local controller configuration for the packaged CLI.  This module
 * deliberately has no discovery defaults: a caller names every repository,
 * topology, executable, row, and credential *environment variable* needed to
 * compose recovery.  Credential values never enter the configuration object
 * or a CLI response.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, resolve } from "node:path";

import {
  canonicalGitCommonDir,
  nodeGitRunner,
  verifyRepository,
  type GitRepository,
} from "./adapters/git/index.js";
import {
  isSchema as isGitSchema,
  GitRepositorySchema,
} from "./adapters/git/schemas.js";
import {
  DoltProjectionPersistence,
  EmbeddedBeadsAdapter,
  PinnedBdEmbeddedProcess,
  type EmbeddedMode,
} from "./adapters/beads-embedded/index.js";
import {
  BeadsServerAdapter,
  DoltBeadsServerDriver,
  DoltSqlTransport,
  PinnedBdManagedServerProcess,
  PinnedBdServerProcess,
  type PinnedBdRuntimeEnvironment,
  type ServerIdentity,
} from "./adapters/beads-server/index.js";
import {
  createProductionRecoveryCommandRunner,
  type CommandRunner,
} from "./commands/index.js";
import {
  harnessSupportCommitment,
  parseHarnessSupport,
  type HarnessSupport,
} from "./harness/index.js";
import { FencingScopeSchema, type FencingScope } from "./fencing/index.js";
import {
  containsSecretShape,
  isSchema,
  PreflightEnvelopeSchema,
  type PreflightEnvelope,
} from "./preflight/index.js";
import { RepositoryRunSchema, type RepositoryRun } from "./protocol/schemas.js";

const MAX_CONFIG_BYTES = 256 * 1024;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]{0,159}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;

type SharedServerBaseConfig = Readonly<{
  bdExecutable: string;
  doltExecutable: string;
  identity: ServerIdentity;
  kind: "shared-server";
  rows: Readonly<{
    childBeadIds: Readonly<Record<string, string>>;
    rootBeadId: string;
  }>;
  workerEnvironment: string;
  workerUser: string;
  workspace: string;
  writerEnvironment: string;
  writerUser: string;
}>;

export type SharedServerConfig =
  | (SharedServerBaseConfig & Readonly<{ managed: false }>)
  | (SharedServerBaseConfig &
      Readonly<{
        dataDirectory: string;
        managed: true;
        runtimeConfigHome: string;
        runtimeHome: string;
      }>);

export type EmbeddedConfig = Readonly<{
  bdExecutable: string;
  childBeadIds: Readonly<Record<string, string>>;
  databaseDirectory: string;
  doltExecutable: string;
  kind: "embedded";
  mode: EmbeddedMode;
  /** Exact configured Beads prefix; never inferred from a store identity. */
  prefix: string;
  preflight: PreflightEnvelope;
  remote?: Readonly<{ name: string; ref: string; url: string }>;
  rootBeadId: string;
}>;

export type ControllerConfig = Readonly<{
  git: Readonly<{ remote?: string; repository: GitRepository }>;
  /** Optional only for an old run that has no harness configuration. */
  harnessSupport?: HarnessSupport;
  initialRun: RepositoryRun;
  nonce: string;
  scope: FencingScope;
  schema: "sce.controller-config";
  topology: EmbeddedConfig | SharedServerConfig;
  version: 1;
}>;

/** Narrow test seams; production supplies neither override. */
export interface ControllerConfigDependencies {
  readonly composeEmbedded?: (
    config: ControllerConfig,
    topology: EmbeddedConfig,
  ) => CommandRunner;
  readonly composeShared?: (
    config: ControllerConfig,
    topology: SharedServerConfig,
    credentials: Readonly<{ workerPassword: string; writerPassword: string }>,
  ) => Promise<CommandRunner | undefined>;
  /** Values are fetched by an explicit variable name and are never reported. */
  readonly environment?: (name: string) => string | undefined;
}

function record(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const value = input as Record<string, unknown>;
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",")
    ? value
    : undefined;
}

function text(value: unknown, limit = 4_096): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    !value.includes("\u0000")
    ? value
    : undefined;
}

function absolutePath(value: unknown): string | undefined {
  const path = text(value);
  if (path === undefined || !isAbsolute(path)) return undefined;
  const canonical = normalize(resolve(path));
  return canonical === "/" ? undefined : canonical;
}

function identifier(value: unknown): string | undefined {
  const candidate = text(value, 160);
  return candidate !== undefined && SAFE_IDENTIFIER.test(candidate)
    ? candidate
    : undefined;
}

function environmentName(value: unknown): string | undefined {
  const candidate = text(value, 160);
  return candidate !== undefined && ENVIRONMENT_NAME.test(candidate)
    ? candidate
    : undefined;
}

function childRows(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length > 64 ||
    entries.some(
      ([unit, row]) =>
        identifier(unit) === undefined || identifier(row) === undefined,
    )
  )
    return undefined;
  return Object.freeze(Object.fromEntries(entries as [string, string][]));
}

function embeddedTopology(value: unknown): EmbeddedConfig | undefined {
  const base = record(value, [
    "bdExecutable",
    "childBeadIds",
    "databaseDirectory",
    "doltExecutable",
    "kind",
    "mode",
    "prefix",
    "preflight",
    "remote",
    "rootBeadId",
  ]);
  const noRemote = record(value, [
    "bdExecutable",
    "childBeadIds",
    "databaseDirectory",
    "doltExecutable",
    "kind",
    "mode",
    "prefix",
    "preflight",
    "rootBeadId",
  ]);
  const item = base ?? noRemote;
  if (
    item === undefined ||
    item.kind !== "embedded" ||
    (item.mode !== "local-only" && item.mode !== "git-sync") ||
    !isSchema(PreflightEnvelopeSchema, item.preflight)
  )
    return undefined;
  const remote = item.remote;
  const parsedRemote =
    remote === undefined ? undefined : record(remote, ["name", "ref", "url"]);
  if (
    (item.mode === "git-sync" && parsedRemote === undefined) ||
    (item.mode === "local-only" && parsedRemote !== undefined)
  )
    return undefined;
  const bdExecutable = absolutePath(item.bdExecutable);
  const doltExecutable = absolutePath(item.doltExecutable);
  const databaseDirectory = absolutePath(item.databaseDirectory);
  const rootBeadId = identifier(item.rootBeadId);
  const prefix = identifier(item.prefix);
  const mapped = childRows(item.childBeadIds);
  const preflight = item.preflight as PreflightEnvelope;
  if (
    bdExecutable === undefined ||
    doltExecutable === undefined ||
    databaseDirectory === undefined ||
    rootBeadId === undefined ||
    prefix === undefined ||
    mapped === undefined ||
    preflight.payload.status !== "ready" ||
    preflight.payload.beads.mode !== "embedded" ||
    preflight.payload.beads.prefix !== prefix ||
    (parsedRemote !== undefined &&
      (identifier(parsedRemote.name) === undefined ||
        parsedRemote.ref !== "refs/dolt/data" ||
        text(parsedRemote.url, 1_024) === undefined))
  )
    return undefined;
  return {
    bdExecutable,
    childBeadIds: mapped,
    databaseDirectory,
    doltExecutable,
    kind: "embedded",
    mode: item.mode,
    prefix,
    preflight,
    ...(parsedRemote === undefined
      ? {}
      : {
          remote: {
            name: parsedRemote.name as string,
            ref: parsedRemote.ref as string,
            url: parsedRemote.url as string,
          },
        }),
    rootBeadId,
  };
}

function sharedServerTopology(value: unknown): SharedServerConfig | undefined {
  const external = record(value, [
    "bdExecutable",
    "doltExecutable",
    "identity",
    "kind",
    "rows",
    "workerEnvironment",
    "workerUser",
    "workspace",
    "writerEnvironment",
    "writerUser",
  ]);
  const managed = record(value, [
    "bdExecutable",
    "dataDirectory",
    "doltExecutable",
    "identity",
    "kind",
    "rows",
    "runtimeConfigHome",
    "runtimeHome",
    "workerEnvironment",
    "workerUser",
    "workspace",
    "writerEnvironment",
    "writerUser",
  ]);
  const item = external ?? managed;
  if (item === undefined || item.kind !== "shared-server") return undefined;
  const rows = record(item.rows, ["childBeadIds", "rootBeadId"]);
  const identity = item.identity;
  if (
    rows === undefined ||
    identity === null ||
    typeof identity !== "object" ||
    Array.isArray(identity)
  )
    return undefined;
  const bdExecutable = absolutePath(item.bdExecutable);
  const doltExecutable = absolutePath(item.doltExecutable);
  const workspace = absolutePath(item.workspace);
  const rootBeadId = identifier(rows.rootBeadId);
  const mapped = childRows(rows.childBeadIds);
  const writerEnvironment = environmentName(item.writerEnvironment);
  const workerEnvironment = environmentName(item.workerEnvironment);
  const writerUser = identifier(item.writerUser);
  const workerUser = identifier(item.workerUser);
  const server = parseServerIdentity(identity);
  if (
    bdExecutable === undefined ||
    doltExecutable === undefined ||
    workspace === undefined ||
    rootBeadId === undefined ||
    mapped === undefined ||
    writerEnvironment === undefined ||
    workerEnvironment === undefined ||
    writerEnvironment === workerEnvironment ||
    writerUser === undefined ||
    workerUser === undefined ||
    server === undefined
  )
    return undefined;
  if (external !== undefined) {
    if (server.topology !== "external_server") return undefined;
    return {
      bdExecutable,
      doltExecutable,
      identity: server,
      kind: "shared-server",
      managed: false,
      rows: { childBeadIds: mapped, rootBeadId },
      workerEnvironment,
      workerUser,
      workspace,
      writerEnvironment,
      writerUser,
    };
  }
  const dataDirectory = absolutePath(managed?.dataDirectory);
  const runtimeHome = absolutePath(managed?.runtimeHome);
  const runtimeConfigHome = absolutePath(managed?.runtimeConfigHome);
  if (
    server.topology !== "managed_local_shared_server" ||
    server.credentialProvenance !== "managed_local_runtime" ||
    dataDirectory === undefined ||
    runtimeHome === undefined ||
    runtimeConfigHome === undefined
  )
    return undefined;
  return {
    bdExecutable,
    dataDirectory,
    doltExecutable,
    identity: server,
    kind: "shared-server",
    managed: true,
    rows: { childBeadIds: mapped, rootBeadId },
    runtimeConfigHome,
    runtimeHome,
    workerEnvironment,
    workerUser,
    workspace,
    writerEnvironment,
    writerUser,
  };
}

/** ServerIdentitySchema is intentionally internal to the transport module. */
function parseServerIdentity(value: unknown): ServerIdentity | undefined {
  const item = record(value, [
    "autoCommitPolicy",
    "credentialProvenance",
    "credentialReference",
    "database",
    "endpoint",
    "prefix",
    "schema",
    "topology",
    "transportSecurity",
    "workerCredentialReference",
  ]);
  if (item === undefined) return undefined;
  const autoCommitPolicy = item.autoCommitPolicy;
  const credentialProvenance = item.credentialProvenance;
  const topology = item.topology;
  const transportSecurity = item.transportSecurity;
  if (
    (autoCommitPolicy !== "on" &&
      autoCommitPolicy !== "off" &&
      autoCommitPolicy !== "batch") ||
    (credentialProvenance !== "environment" &&
      credentialProvenance !== "managed_local_runtime") ||
    (topology !== "external_server" &&
      topology !== "managed_local_shared_server") ||
    (transportSecurity !== "tls" && transportSecurity !== "loopback_plaintext")
  )
    return undefined;
  const credentialReference = identifier(item.credentialReference);
  const workerCredentialReference = identifier(item.workerCredentialReference);
  const database = identifier(item.database);
  const prefix = identifier(item.prefix);
  const schema = identifier(item.schema);
  const endpoint = text(item.endpoint, 320);
  if (
    credentialReference === undefined ||
    workerCredentialReference === undefined ||
    credentialReference === workerCredentialReference ||
    database === undefined ||
    prefix === undefined ||
    schema === undefined ||
    endpoint === undefined
  )
    return undefined;
  return {
    autoCommitPolicy,
    credentialProvenance,
    credentialReference,
    database,
    endpoint,
    prefix,
    schema,
    topology,
    transportSecurity,
    workerCredentialReference,
  };
}

function parseControllerConfig(input: unknown): ControllerConfig | undefined {
  if (containsSecretShape(input)) return undefined;
  const keys = [
    "git",
    "initialRun",
    "nonce",
    "schema",
    "scope",
    "topology",
    "version",
  ] as const;
  const value =
    record(input, keys) ?? record(input, [...keys, "harnessSupport"]);
  if (
    value === undefined ||
    value.schema !== "sce.controller-config" ||
    value.version !== 1 ||
    !isSchema(RepositoryRunSchema, value.initialRun) ||
    !isSchema(FencingScopeSchema, value.scope)
  )
    return undefined;
  const git =
    record(value.git, ["remote", "repository"]) ??
    record(value.git, ["repository"]);
  if (git === undefined || !isGitSchema(GitRepositorySchema, git.repository))
    return undefined;
  const nonce = identifier(value.nonce);
  const remote = git.remote === undefined ? undefined : identifier(git.remote);
  const topology =
    embeddedTopology(value.topology) ?? sharedServerTopology(value.topology);
  const run = value.initialRun as RepositoryRun;
  const parsedHarness =
    value.harnessSupport === undefined
      ? undefined
      : parseHarnessSupport(value.harnessSupport);
  const commitment =
    value.harnessSupport === undefined
      ? undefined
      : harnessSupportCommitment(value.harnessSupport);
  const scope = value.scope as FencingScope;
  const repository = git.repository as GitRepository;
  if (
    nonce === undefined ||
    (git.remote !== undefined && remote === undefined) ||
    topology === undefined ||
    (parsedHarness !== undefined && !parsedHarness.ok) ||
    (commitment !== undefined && !commitment.ok) ||
    (run.harness !== undefined && parsedHarness === undefined) ||
    (parsedHarness !== undefined &&
      (run.harness === undefined ||
        commitment === undefined ||
        !commitment.ok ||
        run.harness.family !== parsedHarness.value.capabilities.family ||
        run.harness.adapterVersion !==
          parsedHarness.value.capabilities.adapterVersion ||
        run.harness.harnessVersion !==
          parsedHarness.value.capabilities.harnessVersion ||
        run.harness.supportCommitment !== commitment.value)) ||
    canonicalGitCommonDir(repository.commonDir) !== repository.commonDir ||
    absolutePath(repository.cwd) !== repository.cwd ||
    run.controller.holder.length === 0 ||
    run.repositoryIdentity !== repository.identity ||
    run.repositoryIdentity !== scope.gitRepositoryIdentity ||
    run.storeIdentity !== scope.beadsStoreIdentity ||
    run.integrationBranch !== scope.integrationBranch
  )
    return undefined;
  if (
    topology.kind === "embedded" &&
    (topology.preflight.payload.status !== "ready" ||
      topology.preflight.payload.git.commonDir !== repository.commonDir ||
      topology.preflight.payload.git.identity !== repository.identity ||
      topology.preflight.payload.git.objectFormat !== repository.objectFormat)
  )
    return undefined;
  return {
    git: { repository, ...(remote === undefined ? {} : { remote }) },
    ...(parsedHarness === undefined
      ? {}
      : { harnessSupport: parsedHarness.value }),
    initialRun: run,
    nonce,
    scope,
    schema: "sce.controller-config",
    topology,
    version: 1,
  };
}

async function topologyProof(
  config: ControllerConfig,
): Promise<
  | Readonly<{ commonDir: string; holder: string; scope: FencingScope }>
  | undefined
> {
  const commonDir = canonicalGitCommonDir(config.git.repository.commonDir);
  if (commonDir === undefined || commonDir !== config.git.repository.commonDir)
    return undefined;
  const verified = await verifyRepository(nodeGitRunner, config.git.repository);
  if (verified.state !== "observed") return undefined;
  return {
    commonDir,
    holder: config.initialRun.controller.holder,
    scope: config.scope,
  };
}

function runtimeEnvironment(
  topology: Extract<SharedServerConfig, { managed: true }>,
): () => PinnedBdRuntimeEnvironment {
  return () => ({
    HOME: topology.runtimeHome,
    XDG_CONFIG_HOME: topology.runtimeConfigHome,
  });
}

async function embeddedTopologyProof(
  config: ControllerConfig,
  process: PinnedBdEmbeddedProcess,
): Promise<
  | Readonly<{ commonDir: string; holder: string; scope: FencingScope }>
  | undefined
> {
  // This is a fresh, pinned, read-only process observation.  It refuses an
  // unavailable/replaced executable or a contradictory embedded identity
  // before the coordinator can read a store or recover an effect.
  try {
    const state = await process.execute({ kind: "state" });
    return state.kind === "state" && state.value.reachable
      ? await topologyProof(config)
      : undefined;
  } catch {
    return undefined;
  }
}

function embeddedRunner(
  config: ControllerConfig,
  topology: EmbeddedConfig,
): CommandRunner {
  const projections = new DoltProjectionPersistence({
    childIssueId: (unitId) => topology.childBeadIds[unitId],
    databaseDirectory: topology.databaseDirectory,
    doltExecutable: topology.doltExecutable,
    rootIssueId: topology.rootBeadId,
  });
  const process = new PinnedBdEmbeddedProcess({
    bdExecutable: topology.bdExecutable,
    cwd: config.git.repository.cwd,
    databaseDirectory: topology.databaseDirectory,
    doltExecutable: topology.doltExecutable,
    prefix: topology.prefix,
    projections,
    scope: config.scope,
    ...(topology.remote === undefined ? {} : { remote: topology.remote }),
  });
  const adapter = new EmbeddedBeadsAdapter({
    holder: config.initialRun.controller.holder,
    mode: topology.mode,
    prefix: topology.prefix,
    preflight: topology.preflight,
    process,
    scope: config.scope,
  });
  return createProductionRecoveryCommandRunner({
    git: { ...config.git, runner: nodeGitRunner },
    ...(config.harnessSupport === undefined
      ? {}
      : { harness: { support: config.harnessSupport } }),
    initialRun: config.initialRun,
    nonce: config.nonce,
    preOwnership: adapter,
    proveTopology: async () => await embeddedTopologyProof(config, process),
    store: adapter,
    topology: adapter,
  });
}

async function sharedServerRunner(
  config: ControllerConfig,
  topology: SharedServerConfig,
  environment: (name: string) => string | undefined = (name) =>
    process.env[name],
): Promise<CommandRunner | undefined> {
  const writerPassword = environment(topology.writerEnvironment);
  const workerPassword = environment(topology.workerEnvironment);
  if (writerPassword === undefined || workerPassword === undefined)
    return undefined;
  try {
    const writer = new DoltSqlTransport({
      executable: topology.doltExecutable,
      identity: topology.identity,
      password: writerPassword,
      role: "writer",
      user: topology.writerUser,
    });
    const worker = new DoltSqlTransport({
      executable: topology.doltExecutable,
      identity: topology.identity,
      password: workerPassword,
      role: "worker",
      user: topology.workerUser,
    });
    const childRuntime = topology.managed
      ? runtimeEnvironment(topology)
      : undefined;
    const slotProcess = new PinnedBdServerProcess({
      credentialEnvironment: () => ({ BEADS_DOLT_PASSWORD: writerPassword }),
      executable: topology.bdExecutable,
      identity: topology.identity,
      ...(childRuntime === undefined
        ? {}
        : { runtimeEnvironment: childRuntime }),
      workspace: topology.workspace,
    });
    const managedProcess = topology.managed
      ? new PinnedBdManagedServerProcess({
          dataDirectory: topology.dataDirectory,
          doltExecutable: topology.doltExecutable,
          executable: topology.bdExecutable,
          runtimeEnvironment: runtimeEnvironment(topology),
          workspace: topology.workspace,
        })
      : undefined;
    const driver = new DoltBeadsServerDriver({
      identity: topology.identity,
      rows: topology.rows,
      slotProcess,
      worker,
      writer,
    });
    const adapter = new BeadsServerAdapter({
      driver,
      identity: topology.identity,
      recoveryScope: config.scope,
      ...(managedProcess === undefined ? {} : { process: managedProcess }),
    });
    if ((await adapter.preflight()).status !== "ready") return undefined;
    return createProductionRecoveryCommandRunner({
      git: { ...config.git, runner: nodeGitRunner },
      ...(config.harnessSupport === undefined
        ? {}
        : { harness: { support: config.harnessSupport } }),
      initialRun: config.initialRun,
      nonce: config.nonce,
      preOwnership: adapter,
      proveTopology: async () => await topologyProof(config),
      store: adapter,
      topology: adapter,
    });
  } catch {
    return undefined;
  }
}

/** Reads and composes an explicit local controller config without exposing it. */
export async function createControllerConfigRunner(
  path: string,
  dependencies: ControllerConfigDependencies = {},
): Promise<CommandRunner | undefined> {
  if (!isAbsolute(path)) return undefined;
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  if (Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES) return undefined;
  let input: unknown;
  try {
    input = JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
  const config = parseControllerConfig(input);
  if (config === undefined) return undefined;
  const topology = config.topology;
  if (topology.kind === "embedded")
    return (
      dependencies.composeEmbedded?.(config, topology) ??
      embeddedRunner(config, topology)
    );
  const environment = dependencies.environment ?? ((name) => process.env[name]);
  const writerPassword = environment(topology.writerEnvironment);
  const workerPassword = environment(topology.workerEnvironment);
  if (writerPassword === undefined || workerPassword === undefined)
    return undefined;
  if (dependencies.composeShared !== undefined)
    return await dependencies.composeShared(config, topology, {
      workerPassword,
      writerPassword,
    });
  return await sharedServerRunner(config, topology, (name) =>
    name === topology.writerEnvironment
      ? writerPassword
      : name === topology.workerEnvironment
        ? workerPassword
        : undefined,
  );
}
