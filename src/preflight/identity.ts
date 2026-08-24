import { isAbsolute, normalize, resolve } from "node:path";

import {
  BD_CONTEXT_SCHEMA_VERSION,
  BD_VERSION,
  type BdContextObservation,
  type BeadsIdentity,
  type BootstrapPlan,
  type GitIdentity,
  type GitInspection,
  type PreflightEnvelope,
  type RefusalCode,
  type SafeParse,
  containsSecretShape,
  parseGitInspection,
} from "./schemas.js";

export type TopologyClassification =
  | { readonly status: "ready"; readonly beads: BeadsIdentity }
  | { readonly status: "uninitialized"; readonly bootstrap: BootstrapPlan }
  | { readonly status: "refused"; readonly code: RefusalCode };

const localServerHosts = new Set(["127.0.0.1", "::1", "localhost"]);

/** The process adapter supplies a realpath-plus-bare-repository proof. */
export type LocalBareRemoteCanonicalizer = (path: string) => string | undefined;

/** A bd dolt show observation whose dataDir was realpathed by the adapter. */
export type EmbeddedStoreProof = Readonly<{
  backend: "dolt";
  dataDir: string;
  database: string;
  embedded: true;
  schemaVersion: typeof BD_CONTEXT_SCHEMA_VERSION;
}>;

/** Values read from exact, versioned bd config get observations. */
export type TopologyConfiguration = Readonly<{
  prefix: string;
  syncRemote: string;
}>;

export const DOLT_SYNC_TRANSPORT_REF = "refs/dolt/data";

function refused(code: RefusalCode): TopologyClassification {
  return { status: "refused", code };
}

/** Lexical canonicalization only: the executor performs filesystem realpath. */
export function canonicalAbsolutePath(value: string): string | undefined {
  if (
    value.includes("\u0000") ||
    value.length === 0 ||
    !isAbsolute(value) ||
    containsSecretShape(value)
  )
    return undefined;
  const canonical = normalize(resolve(value));
  return canonical === "/" ? undefined : canonical;
}

function canonicalServer(value: string): string | undefined {
  if (
    value.length === 0 ||
    value.includes("\u0000") ||
    containsSecretShape(value) ||
    /[@/?#\s]/u.test(value)
  )
    return undefined;
  const bracketed = /^\[([0-9A-Fa-f:]+)\](?::([0-9]{1,5}))?$/u.exec(value);
  if (bracketed !== null) {
    const host = bracketed[1]?.toLowerCase();
    const port = bracketed[2];
    if (host === undefined) return undefined;
    return port === undefined ? `[${host}]` : `[${host}]:${port}`;
  }
  const match = /^([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/u.exec(value);
  if (match === null) return undefined;
  const host = match[1]?.toLowerCase();
  const port = match[2];
  if (
    host === undefined ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    (port !== undefined && Number(port) > 65_535)
  )
    return undefined;
  return port === undefined ? host : `${host}:${port}`;
}

function serverHost(server: string): string {
  if (server.startsWith("[")) return server.slice(1, server.indexOf("]"));
  return server.split(":", 1)[0] ?? server;
}

function canonicalRemotePath(value: string): string | undefined {
  if (
    value.length === 0 ||
    value.includes("\u0000") ||
    containsSecretShape(value)
  )
    return undefined;
  const withoutGitSuffix = value.replace(/\.git$/u, "");
  if (
    withoutGitSuffix.length === 0 ||
    withoutGitSuffix.startsWith("/") ||
    withoutGitSuffix.includes("//") ||
    withoutGitSuffix
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  )
    return undefined;
  return withoutGitSuffix;
}

function canonicalLocalBarePath(
  path: string,
  canonicalize: LocalBareRemoteCanonicalizer | undefined,
): string | undefined {
  const lexical = canonicalAbsolutePath(path);
  if (lexical === undefined || canonicalize === undefined) return undefined;
  const canonical = canonicalize(lexical);
  return canonical === undefined ? undefined : canonicalAbsolutePath(canonical);
}

function decodeRemotePath(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** Canonical equivalent forms for Git SSH/HTTPS aliases and proven local bare paths. */
export function normalizeGitRemote(
  value: string,
  localBareCanonicalizer?: LocalBareRemoteCanonicalizer,
): string | undefined {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    containsSecretShape(value)
  )
    return undefined;
  if (isAbsolute(value)) {
    if (!value.endsWith(".git")) return undefined;
    const path = canonicalLocalBarePath(value, localBareCanonicalizer);
    return path === undefined ? undefined : `local:${path}`;
  }
  const shorthand = /^git@([A-Za-z0-9.-]+):(.+)$/u.exec(value);
  if (shorthand !== null) {
    const host = shorthand[1]?.toLowerCase();
    const path =
      shorthand[2] === undefined
        ? undefined
        : canonicalRemotePath(shorthand[2]);
    return host === undefined || path === undefined
      ? undefined
      : `${host}/${path}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.port !== "" ||
    containsSecretShape(parsed.username)
  )
    return undefined;
  if (parsed.protocol === "file:") {
    if (
      parsed.username !== "" ||
      (parsed.hostname !== "" && parsed.hostname !== "localhost")
    )
      return undefined;
    if (!parsed.pathname.endsWith(".git")) return undefined;
    const decodedPath = decodeRemotePath(parsed.pathname);
    const path =
      decodedPath === undefined
        ? undefined
        : canonicalLocalBarePath(decodedPath, localBareCanonicalizer);
    return path === undefined ? undefined : `local:${path}`;
  }
  if (
    !["https:", "ssh:", "git+ssh:"].includes(parsed.protocol) ||
    (parsed.protocol !== "ssh:" &&
      parsed.protocol !== "git+ssh:" &&
      parsed.username !== "") ||
    ((parsed.protocol === "ssh:" || parsed.protocol === "git+ssh:") &&
      parsed.username !== "git")
  )
    return undefined;
  const decodedPath = decodeRemotePath(parsed.pathname);
  const remotePath =
    decodedPath === undefined
      ? undefined
      : canonicalRemotePath(decodedPath.replace(/^\/+/, ""));
  return remotePath === undefined
    ? undefined
    : `${parsed.hostname.toLowerCase()}/${remotePath}`;
}

function normalizedSyncRemote(
  value: string | undefined,
  localBareCanonicalizer: LocalBareRemoteCanonicalizer | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  return normalizeGitRemote(value, localBareCanonicalizer);
}

function validPrefix(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value);
}

function baseIdentity(
  context: BdContextObservation,
  localBareCanonicalizer: LocalBareRemoteCanonicalizer | undefined,
  configuration: TopologyConfiguration | undefined,
) {
  const beadsDir =
    context.beads_dir === undefined
      ? undefined
      : canonicalAbsolutePath(context.beads_dir);
  if (configuration === undefined || !validPrefix(configuration.prefix))
    return undefined;
  if (context.prefix !== undefined && context.prefix !== configuration.prefix)
    return undefined;
  const configuredSyncRemote = normalizedSyncRemote(
    configuration.syncRemote,
    localBareCanonicalizer,
  );
  const contextualSyncRemote = normalizedSyncRemote(
    context.sync_remote,
    localBareCanonicalizer,
  );
  const hasConfiguredSync = configuration.syncRemote.length > 0;
  if (
    (context.beads_dir !== undefined && beadsDir === undefined) ||
    (context.sync_remote !== undefined && contextualSyncRemote === undefined) ||
    (hasConfiguredSync && configuredSyncRemote === undefined) ||
    (!hasConfiguredSync &&
      (context.sync_remote !== undefined || context.sync_ref !== undefined)) ||
    (hasConfiguredSync &&
      context.sync_remote !== undefined &&
      contextualSyncRemote !== configuredSyncRemote) ||
    (hasConfiguredSync &&
      context.sync_ref !== undefined &&
      context.sync_ref !== DOLT_SYNC_TRANSPORT_REF)
  )
    return undefined;
  return {
    ...(beadsDir === undefined ? {} : { beadsDir }),
    ...(context.database === undefined ? {} : { database: context.database }),
    prefix: configuration.prefix,
    ...(context.project_id === undefined
      ? {}
      : { projectId: context.project_id }),
    ...(context.rig === undefined ? {} : { rig: context.rig }),
    ...(hasConfiguredSync && configuredSyncRemote !== undefined
      ? {
          syncRef: DOLT_SYNC_TRANSPORT_REF,
          syncRemote: configuredSyncRemote,
        }
      : {}),
    contextSchemaVersion:
      BD_CONTEXT_SCHEMA_VERSION as typeof BD_CONTEXT_SCHEMA_VERSION,
    toolVersion: BD_VERSION as typeof BD_VERSION,
  };
}

export function classifyTopology(
  context: BdContextObservation,
  bootstrap: BootstrapPlan | undefined,
  embeddedStore?: EmbeddedStoreProof,
  localBareCanonicalizer?: LocalBareRemoteCanonicalizer,
  configuration?: TopologyConfiguration,
): TopologyClassification {
  if (context.bd_version !== BD_VERSION)
    return refused("PF_BD_VERSION_UNSUPPORTED");
  if (context.schema_version !== BD_CONTEXT_SCHEMA_VERSION)
    return refused("PF_BD_CONTEXT_SCHEMA_UNSUPPORTED");
  const uninitialized =
    context.backend === "none" ||
    context.backend === "uninitialized" ||
    context.dolt_mode === "uninitialized";
  if (uninitialized) {
    if (
      (context.backend === "dolt" && context.dolt_mode !== "uninitialized") ||
      context.server !== undefined ||
      context.server_source !== undefined ||
      context.database !== undefined ||
      context.beads_dir !== undefined ||
      bootstrap === undefined
    )
      return refused("PF_TOPOLOGY_CONTRADICTORY");
    return { status: "uninitialized", bootstrap };
  }
  if (
    context.backend !== "dolt" ||
    context.global === true ||
    context.proxied === true ||
    context.dolt_mode === "global" ||
    context.dolt_mode === "proxy" ||
    context.server_source === "global" ||
    context.server_source === "proxy"
  )
    return refused("PF_TOPOLOGY_REFUSED");
  const base = baseIdentity(context, localBareCanonicalizer, configuration);
  if (
    base === undefined ||
    base.beadsDir === undefined ||
    base.database === undefined
  )
    return refused("PF_TOPOLOGY_CONTRADICTORY");
  if (
    context.dolt_mode === "embedded" &&
    context.server === undefined &&
    context.server_source === undefined &&
    context.is_redirected !== true
  ) {
    if (
      embeddedStore === undefined ||
      embeddedStore.backend !== "dolt" ||
      embeddedStore.embedded !== true ||
      embeddedStore.database !== base.database ||
      embeddedStore.schemaVersion !== BD_CONTEXT_SCHEMA_VERSION
    )
      return refused("PF_TOPOLOGY_CONTRADICTORY");
    const storePath = canonicalAbsolutePath(embeddedStore.dataDir);
    if (storePath === undefined) return refused("PF_TOPOLOGY_CONTRADICTORY");
    return {
      status: "ready",
      beads: {
        ...base,
        mode: "embedded",
        provenance: "embedded_config",
        storePath,
      },
    };
  }
  const server =
    context.server === undefined ? undefined : canonicalServer(context.server);
  if (server === undefined) return refused("PF_TOPOLOGY_CONTRADICTORY");
  const source = context.server_source;
  if (
    context.dolt_mode === "shared-server" &&
    source === "shared-server" &&
    localServerHosts.has(serverHost(server)) &&
    context.is_redirected !== true
  )
    return {
      status: "ready",
      beads: {
        ...base,
        mode: "managed_local_shared_server",
        provenance: "shared_server_flag",
        server,
      },
    };
  if (
    ["external", "server", "shared-server"].includes(context.dolt_mode ?? "") &&
    (source === "server" || source === "external") &&
    context.is_redirected !== true
  )
    return {
      status: "ready",
      beads: {
        ...base,
        mode: "external_server",
        provenance: "external_server_flag",
        server,
      },
    };
  return refused("PF_TOPOLOGY_CONTRADICTORY");
}

export function deriveGitIdentity(
  input: unknown,
  localBareCanonicalizer?: LocalBareRemoteCanonicalizer,
): SafeParse<GitIdentity> {
  const inspection = parseGitInspection(input);
  if (!inspection.ok) return { ok: false };
  const topLevel = canonicalAbsolutePath(inspection.value.topLevel);
  const commonDir = canonicalAbsolutePath(inspection.value.commonDir);
  if (topLevel === undefined || commonDir === undefined) return { ok: false };
  const aliases = inspection.value.remoteUrls.map((remote) =>
    normalizeGitRemote(remote, localBareCanonicalizer),
  );
  if (aliases.some((alias) => alias === undefined)) return { ok: false };
  let identity: string | undefined;
  if (inspection.value.providerId !== undefined) {
    if (containsSecretShape(inspection.value.providerId)) return { ok: false };
    identity = `provider:${inspection.value.providerId}`;
  } else {
    if (aliases.length === 0 || aliases.some((alias) => alias === undefined))
      return { ok: false };
    const distinct = new Set(aliases);
    if (distinct.size !== 1) return { ok: false };
    identity = [...distinct][0];
  }
  if (identity === undefined) return { ok: false };
  return {
    ok: true,
    value: {
      commonDir,
      identity,
      objectFormat: inspection.value.objectFormat,
      topLevel,
    },
  };
}

export function preflightEnvelope(
  topology: TopologyClassification,
  git: GitIdentity | undefined,
): PreflightEnvelope {
  if (topology.status === "refused")
    return {
      schema: "sce.preflight",
      version: 1,
      payload: { status: "refused", code: topology.code },
    };
  if (topology.status === "uninitialized")
    return {
      schema: "sce.preflight",
      version: 1,
      payload: { status: "uninitialized", bootstrap: topology.bootstrap },
    };
  if (git === undefined)
    return {
      schema: "sce.preflight",
      version: 1,
      payload: { status: "refused", code: "PF_GIT_INSPECTION_INVALID" },
    };
  return {
    schema: "sce.preflight",
    version: 1,
    payload: { status: "ready", beads: topology.beads, git },
  };
}
