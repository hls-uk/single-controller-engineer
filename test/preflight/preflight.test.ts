import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";

import {
  canonicalizeContextDirectories,
  classifySubprocess,
  classifyTopology,
  containsSecretShape,
  deriveGitIdentity,
  executeSanitizedInspection,
  type EmbeddedStoreProof,
  isCanonicalSubdirectory,
  matchesCanonicalGitContext,
  type TopologyConfiguration,
  isSchema,
  normalizeGitRemote,
  parseBdContextJson,
  parseBdConfigValueJson,
  parseBdDoltShowJson,
  parseBootstrapPlanJson,
  parseGitRemoteConfigOutput,
  preflightEnvelope,
  subprocessRefusalCode,
} from "../../src/preflight/index.js";
import { observeGitRemoteUrls } from "../../src/preflight/subprocess.js";
import {
  PreflightEnvelopeSchema,
  DoltObservationSchema,
  InspectionCommandSchema,
  type BdContextObservation,
  type BootstrapPlan,
  type InspectionCommand,
} from "../../src/preflight/schemas.js";

const embeddedContext = (): BdContextObservation => ({
  backend: "dolt",
  bd_version: "1.1.0",
  beads_dir: "/workspace/repo/.beads",
  cwd_repo_root: "/workspace/repo",
  database: "sce",
  dolt_mode: "embedded",
  is_redirected: false,
  is_worktree: false,
  project_id: "project-1",
  repo_root: "/workspace/repo",
  role: "maintainer",
  schema_version: 1,
});

const bootstrapPlan = (): BootstrapPlan => ({
  action: "create",
  beadsDir: "/workspace/repo/.beads",
  database: "sce",
});

const embeddedStore = (): EmbeddedStoreProof => ({
  backend: "dolt",
  dataDir: "/workspace/repo/.beads/embeddeddolt",
  database: "sce",
  embedded: true,
  schemaVersion: 1,
});

const topologyConfiguration = (): TopologyConfiguration => ({
  prefix: "sce",
  syncRemote: "",
});

const gitInspection = {
  commonDir: "/workspace/repo/.git",
  objectFormat: "sha1" as const,
  remoteUrls: [
    "git@github.com:hls-uk/single-controller-engineer.git",
    "https://github.com/hls-uk/single-controller-engineer.git",
  ],
  topLevel: "/workspace/repo",
};

test("strict bd context parsing accepts only sanitized schema 1 fields", () => {
  const raw = JSON.stringify(embeddedContext());
  const parsed = parseBdContextJson(raw);
  assert.equal(parsed.ok, true);
  assert.equal(
    parseBdContextJson(JSON.stringify({ ...embeddedContext(), extra: true }))
      .ok,
    false,
  );
  assert.equal(
    parseBdContextJson(
      JSON.stringify({ ...embeddedContext(), server: "SECRET_CANARY" }),
    ).ok,
    false,
  );
  for (const canaryField of ["stdout", "stderr", "exception"])
    assert.equal(
      parseBdContextJson(
        JSON.stringify({
          ...embeddedContext(),
          [canaryField]: "SECRET_CANARY",
        }),
      ).ok,
      false,
    );
  assert.equal(
    parseBdContextJson(
      JSON.stringify({ ...embeddedContext(), schema_version: 2 }),
    ).ok,
    true,
  );
});

test("context directory evidence admits only exact canonical primary/worktree pairings", () => {
  const canonicalize = (path: string): string | undefined =>
    (
      ({
        "/linked/worktree": "/canonical/worktree",
        "/primary": "/canonical/primary",
        "/primary/.beads": "/canonical/primary/.beads",
      }) as Record<string, string>
    )[path];
  const canonical = canonicalizeContextDirectories(
    {
      ...embeddedContext(),
      beads_dir: "/primary/.beads",
      cwd_repo_root: "/linked/worktree",
      is_worktree: true,
      repo_root: "/primary",
    },
    canonicalize,
  );
  assert.ok(canonical);
  assert.equal(canonical.beads_dir, "/canonical/primary/.beads");
  assert.equal(canonical.cwd_repo_root, "/canonical/worktree");
  assert.equal(
    matchesCanonicalGitContext(canonical, {
      commonDir: "/canonical/primary/.git",
      topLevel: "/canonical/worktree",
    }),
    true,
  );
  assert.equal(
    matchesCanonicalGitContext(
      { ...canonical, is_worktree: false },
      { commonDir: "/canonical/primary/.git", topLevel: "/canonical/worktree" },
    ),
    false,
  );
  const { is_worktree: ignoredWorktreeFlag, ...withoutWorktreeFlag } =
    canonical;
  void ignoredWorktreeFlag;
  assert.equal(
    matchesCanonicalGitContext(withoutWorktreeFlag, {
      commonDir: "/canonical/primary/.git",
      topLevel: "/canonical/worktree",
    }),
    false,
  );
  assert.equal(
    matchesCanonicalGitContext(
      { ...canonical, is_worktree: true },
      { commonDir: "/canonical/primary/.git", topLevel: "/canonical/primary" },
    ),
    false,
  );
  assert.equal(
    matchesCanonicalGitContext(
      { ...canonical, repo_root: "/canonical/foreign" },
      { commonDir: "/canonical/primary/.git", topLevel: "/canonical/worktree" },
    ),
    false,
  );
  assert.equal(
    matchesCanonicalGitContext(
      { ...canonical, beads_dir: "/canonical/primary-copy/.beads" },
      { commonDir: "/canonical/primary/.git", topLevel: "/canonical/worktree" },
    ),
    false,
  );
  assert.equal(
    matchesCanonicalGitContext(canonical, {
      commonDir: "/canonical/primary.git",
      topLevel: "/canonical/worktree",
    }),
    false,
  );
  assert.equal(
    matchesCanonicalGitContext(canonical, {
      commonDir: "/canonical/foreign/.git",
      topLevel: "/canonical/worktree",
    }),
    false,
  );
  assert.equal(
    matchesCanonicalGitContext(
      {
        ...canonical,
        cwd_repo_root: "/canonical/primary",
        is_worktree: false,
      },
      { commonDir: "/canonical/primary/.git", topLevel: "/canonical/primary" },
    ),
    true,
  );
  assert.equal(
    isCanonicalSubdirectory("/real/repo", "/real/repo/subdir"),
    true,
  );
  assert.equal(
    isCanonicalSubdirectory("/real/repo", "/real/repository"),
    false,
  );
  assert.equal(isCanonicalSubdirectory("/real/repo", "/other/repo"), false);
});

test("bd dolt show parser accepts the pinned shape and refuses mismatched or secret facts", () => {
  const actualShape = {
    backend: "dolt",
    data_dir: "/workspace/repo/.beads/embeddeddolt",
    database: "sce",
    embedded: true,
    schema_version: 1,
  };
  assert.deepEqual(parseBdDoltShowJson(JSON.stringify(actualShape)), {
    ok: true,
    value: actualShape,
  });
  for (const invalid of [
    { ...actualShape, extra: true },
    { ...actualShape, secret: "SECRET_CANARY" },
    { ...actualShape, data_dir: "SECRET_CANARY" },
    { ...actualShape, backend: "other" },
  ])
    assert.equal(parseBdDoltShowJson(JSON.stringify(invalid)).ok, false);
});

test("bd config parser binds the pinned sync and prefix observations", () => {
  const syncRemote = {
    key: "sync.remote",
    location: "config.yaml",
    schema_version: 1,
    value: "git+ssh://git@github.com:hls-uk/single-controller-engineer.git",
  };
  const prefix = { key: "issue_prefix", schema_version: 1, value: "sce" };
  assert.deepEqual(
    parseBdConfigValueJson(JSON.stringify(syncRemote), "sync.remote"),
    {
      ok: true,
      value: syncRemote,
    },
  );
  assert.deepEqual(
    parseBdConfigValueJson(JSON.stringify(prefix), "issue_prefix"),
    {
      ok: true,
      value: prefix,
    },
  );
  assert.deepEqual(
    parseBdConfigValueJson(
      JSON.stringify({ key: "sync.remote", schema_version: 1, value: "" }),
      "sync.remote",
    ),
    {
      ok: true,
      value: { key: "sync.remote", schema_version: 1, value: "" },
    },
  );
  for (const invalid of [
    { ...syncRemote, key: "issue_prefix" },
    { ...syncRemote, schema_version: 2 },
    { ...syncRemote, value: "https://token@example.test/repo.git" },
    { ...syncRemote, value: "SECRET_CANARY" },
    { ...syncRemote, extra: true },
  ])
    assert.equal(
      parseBdConfigValueJson(JSON.stringify(invalid), "sync.remote").ok,
      false,
    );
});

test("topology classification relies on configuration provenance, never reachability", () => {
  const embedded = classifyTopology(
    embeddedContext(),
    undefined,
    embeddedStore(),
    undefined,
    topologyConfiguration(),
  );
  assert.deepEqual(embedded, {
    status: "ready",
    beads: {
      beadsDir: "/workspace/repo/.beads",
      contextSchemaVersion: 1,
      database: "sce",
      mode: "embedded",
      prefix: "sce",
      projectId: "project-1",
      provenance: "embedded_config",
      storePath: "/workspace/repo/.beads/embeddeddolt",
      toolVersion: "1.1.0",
    },
  });
  const managed = classifyTopology(
    {
      ...embeddedContext(),
      dolt_mode: "shared-server",
      server: "127.0.0.1:3306",
      server_source: "shared-server",
    },
    undefined,
    undefined,
    undefined,
    topologyConfiguration(),
  );
  assert.equal(managed.status, "ready");
  if (managed.status === "ready") {
    assert.equal(managed.beads.mode, "managed_local_shared_server");
    assert.equal(managed.beads.server, "127.0.0.1:3306");
  }
  const external = classifyTopology(
    {
      ...embeddedContext(),
      dolt_mode: "external",
      server: "beads.example.test:3306",
      server_source: "external",
    },
    undefined,
    undefined,
    undefined,
    topologyConfiguration(),
  );
  assert.equal(external.status, "ready");
  if (external.status === "ready")
    assert.equal(external.beads.mode, "external_server");

  assert.equal(
    classifyTopology(embeddedContext(), undefined).status,
    "refused",
  );
  for (const store of [
    { ...embeddedStore(), database: "other" },
    { ...embeddedStore(), schemaVersion: 2 },
    { ...embeddedStore(), embedded: false },
  ])
    assert.equal(
      classifyTopology(
        embeddedContext(),
        undefined,
        store as EmbeddedStoreProof,
        undefined,
        topologyConfiguration(),
      ).status,
      "refused",
    );
  const bareCanonicalizer = (path: string): string | undefined =>
    path === "/aliases/dolt.git" || path === "/linked/dolt.git"
      ? "/real/dolt.git"
      : undefined;
  const withLocalSync = classifyTopology(
    {
      ...embeddedContext(),
      sync_ref: "refs/dolt/data",
      sync_remote: "file:///aliases/dolt.git",
    },
    undefined,
    embeddedStore(),
    bareCanonicalizer,
    {
      prefix: "sce",
      syncRemote: "file:///aliases/dolt.git",
    },
  );
  assert.equal(withLocalSync.status, "ready");
  if (withLocalSync.status === "ready")
    assert.equal(withLocalSync.beads.syncRemote, "local:/real/dolt.git");
  assert.equal(
    classifyTopology(
      {
        ...embeddedContext(),
        sync_ref: "refs/dolt/data",
        sync_remote: "file:///missing/dolt.git",
      },
      undefined,
      embeddedStore(),
      bareCanonicalizer,
      {
        prefix: "sce",
        syncRemote: "file:///missing/dolt.git",
      },
    ).status,
    "refused",
  );
  assert.equal(
    classifyTopology(
      { ...embeddedContext(), prefix: "other" },
      undefined,
      embeddedStore(),
      undefined,
      topologyConfiguration(),
    ).status,
    "refused",
  );
  assert.equal(
    classifyTopology(
      {
        ...embeddedContext(),
        sync_ref: "refs/dolt/data",
        sync_remote: "git@github.com:hls-uk/other.git",
      },
      undefined,
      embeddedStore(),
      undefined,
      {
        prefix: "sce",
        syncRemote: "git@github.com:hls-uk/single-controller-engineer.git",
      },
    ).status,
    "refused",
  );

  for (const context of [
    { ...embeddedContext(), global: true },
    { ...embeddedContext(), proxied: true },
    { ...embeddedContext(), dolt_mode: "proxy" as const },
    {
      ...embeddedContext(),
      dolt_mode: "shared-server" as const,
      server: "127.0.0.1:3306",
    },
    { ...embeddedContext(), schema_version: 2 },
    { ...embeddedContext(), bd_version: "1.2.0" },
  ])
    assert.equal(
      classifyTopology(
        context,
        undefined,
        undefined,
        undefined,
        topologyConfiguration(),
      ).status,
      "refused",
    );
});

test("uninitialized preflight exposes only the dry-run bootstrap plan", () => {
  const topology = classifyTopology(
    {
      backend: "none",
      bd_version: "1.1.0",
      cwd_repo_root: "/workspace/repo",
      dolt_mode: "uninitialized",
      schema_version: 1,
    },
    bootstrapPlan(),
  );
  assert.equal(topology.status, "uninitialized");
  const envelope = preflightEnvelope(topology, undefined);
  assert.deepEqual(envelope.payload, {
    status: "uninitialized",
    bootstrap: bootstrapPlan(),
  });
  assert.equal(isSchema(PreflightEnvelopeSchema, envelope), true);
  assert.equal(
    isSchema(PreflightEnvelopeSchema, {
      ...envelope,
      payload: { ...envelope.payload, context: embeddedContext() },
    }),
    false,
  );
  assert.equal(
    classifyTopology(
      {
        backend: "none",
        bd_version: "1.1.0",
        cwd_repo_root: "/workspace/repo",
        database: "partial",
        dolt_mode: "uninitialized",
        schema_version: 1,
      },
      bootstrapPlan(),
    ).status,
    "refused",
  );
});

test("bootstrap parser drops free text and rejects secret-shaped values", () => {
  const source = JSON.stringify({
    action: "sync",
    beads_dir: "/workspace/repo/.beads",
    database: "sce",
    has_existing: false,
    reason: "sync.remote configured",
    schema_version: 1,
    sync_remote: "git@github.com:hls-uk/single-controller-engineer.git",
  });
  const parsed = parseBootstrapPlanJson(source);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal("reason" in parsed.value, false);
    assert.equal(JSON.stringify(parsed.value).includes("configured"), false);
  }
  assert.equal(
    parseBootstrapPlanJson(source.replace("configured", "SECRET_CANARY")).ok,
    false,
  );
});

test("Git identity normalizes every configured alias and refuses ambiguity or credentials", () => {
  const identity = deriveGitIdentity(gitInspection);
  assert.equal(identity.ok, true);
  if (identity.ok)
    assert.equal(
      identity.value.identity,
      "github.com/hls-uk/single-controller-engineer",
    );
  const canonicalPaths = deriveGitIdentity({
    ...gitInspection,
    commonDir: "/workspace/repo/../repo/.git",
    topLevel: "/workspace/repo/../repo",
  });
  assert.equal(canonicalPaths.ok, true);
  if (canonicalPaths.ok) {
    assert.equal(canonicalPaths.value.topLevel, "/workspace/repo");
    assert.equal(canonicalPaths.value.commonDir, "/workspace/repo/.git");
  }
  const bareCanonicalizer = (path: string): string | undefined =>
    path === "/aliases/repo.git" || path === "/srv/remotes/repo.git"
      ? "/real/repo.git"
      : undefined;
  assert.equal(
    normalizeGitRemote("file:///aliases/repo.git", bareCanonicalizer),
    "local:/real/repo.git",
  );
  assert.equal(
    normalizeGitRemote("/srv/remotes/repo.git", bareCanonicalizer),
    "local:/real/repo.git",
  );
  assert.equal(
    normalizeGitRemote("/missing/repo.git", bareCanonicalizer),
    undefined,
  );
  const localAliases = deriveGitIdentity(
    {
      ...gitInspection,
      remoteUrls: ["/aliases/repo.git", "file:///srv/remotes/repo.git"],
    },
    bareCanonicalizer,
  );
  assert.equal(localAliases.ok, true);
  if (localAliases.ok)
    assert.equal(localAliases.value.identity, "local:/real/repo.git");
  assert.equal(
    normalizeGitRemote("http://github.com/hls-uk/repo.git"),
    undefined,
  );
  assert.equal(normalizeGitRemote("/srv/remotes/not-bare"), undefined);
  assert.equal(
    deriveGitIdentity({
      ...gitInspection,
      remoteUrls: [
        "git@github.com:hls-uk/single-controller-engineer.git",
        "https://github.com/hls-uk/other.git",
      ],
    }).ok,
    false,
  );
  assert.equal(
    deriveGitIdentity({
      ...gitInspection,
      remoteUrls: [
        "https://token@github.com/hls-uk/single-controller-engineer.git",
      ],
    }).ok,
    false,
  );
  assert.equal(
    normalizeGitRemote(
      "ssh://alice@github.com/hls-uk/single-controller-engineer.git",
    ),
    undefined,
  );
  assert.equal(
    deriveGitIdentity({ ...gitInspection, providerId: "SECRET_CANARY" }).ok,
    false,
  );
  assert.equal(
    deriveGitIdentity({
      ...gitInspection,
      providerId: "immutable-provider-123",
      remoteUrls: [],
    }).ok,
    true,
  );
  const withoutRemotes = deriveGitIdentity({
    ...gitInspection,
    remoteUrls: [],
  });
  assert.equal(withoutRemotes.ok, true);
  if (withoutRemotes.ok)
    assert.equal(withoutRemotes.value.identity, "local:/workspace/repo/.git");
  assert.equal(
    normalizeGitRemote("https://github.com/%E0%A4%A.git"),
    undefined,
  );
  assert.equal(normalizeGitRemote("file:///srv/%E0%A4%A.git"), undefined);
});

test("a remoteless identity that cannot be spelled as an identifier is refused by name", () => {
  const remoteless = (commonDir: string) =>
    deriveGitIdentity({
      ...gitInspection,
      commonDir,
      remoteUrls: [],
      topLevel: dirname(commonDir),
    });
  for (const commonDir of [
    "/workspace/my repo/.git",
    "/workspace/repo@host/.git",
    "/workspace/~repo/.git",
    "/workspace/repo+mirror/.git",
    "/workspace/reposit\u00f3rio/.git",
    `/w/${"a".repeat(147)}/.git`,
  ]) {
    const derived = remoteless(commonDir);
    assert.equal(derived.ok, false);
    if (derived.ok) continue;
    assert.equal(
      derived.refusal?.code,
      "PF_GIT_LOCAL_IDENTITY_UNREPRESENTABLE",
    );
    assert.equal(derived.refusal?.message.includes(commonDir), true);
  }
  for (const commonDir of [
    "/workspace/repo/.git",
    `/w/${"a".repeat(146)}/.git`,
  ]) {
    const derived = remoteless(commonDir);
    assert.equal(derived.ok, true);
    if (derived.ok) assert.equal(derived.value.identity, `local:${commonDir}`);
  }
  assert.equal(
    deriveGitIdentity({
      ...gitInspection,
      commonDir: "/workspace/my repo/.git",
      providerId: "immutable-provider-123",
      remoteUrls: [],
      topLevel: "/workspace/my repo",
    }).ok,
    true,
  );
  const envelope = preflightEnvelope(
    { status: "refused", code: "PF_GIT_LOCAL_IDENTITY_UNREPRESENTABLE" },
    undefined,
  );
  assert.deepEqual(envelope.payload, {
    status: "refused",
    code: "PF_GIT_LOCAL_IDENTITY_UNREPRESENTABLE",
  });
  assert.equal(isSchema(PreflightEnvelopeSchema, envelope), true);
});

test("all-remotes NUL parser retains equivalent aliases but refuses malformed or contradictory records", () => {
  const allRemotes =
    "remote.origin.url\ngit@github.com:hls-uk/single-controller-engineer.git\u0000" +
    "remote.mirror.url\nhttps://github.com/hls-uk/single-controller-engineer.git\u0000";
  const urls = parseGitRemoteConfigOutput(allRemotes);
  assert.deepEqual(urls, [
    "git@github.com:hls-uk/single-controller-engineer.git",
    "https://github.com/hls-uk/single-controller-engineer.git",
  ]);
  assert.equal(
    deriveGitIdentity({ ...gitInspection, remoteUrls: urls ?? [] }).ok,
    true,
  );
  assert.equal(
    deriveGitIdentity({
      ...gitInspection,
      remoteUrls: [
        "git@github.com:hls-uk/single-controller-engineer.git",
        "https://github.com/hls-uk/other.git",
      ],
    }).ok,
    false,
  );
  for (const malformed of [
    "remote.origin.url\ngit@github.com:hls-uk/single-controller-engineer.git",
    "remote.origin.url\n\u0000",
    "remote.token.url\ngit@github.com:hls-uk/single-controller-engineer.git\u0000",
    "remote.origin.url\ngit@github.com:hls-uk/single-controller-engineer.git\u0000trailing",
    "remote.origin.url\n�\u0000",
  ])
    assert.equal(parseGitRemoteConfigOutput(malformed), undefined);
});

test("secret filtering rejects secret channels without rejecting benign session or token substrings", () => {
  for (const benign of [
    "/workspace/session-cache/tokenizer-reports",
    "sessional-tokenizer",
    { job: "tokenization-session" },
  ])
    assert.equal(containsSecretShape(benign), false);
  for (const secret of [
    "SECRET_CANARY",
    "token=SECRET_CANARY",
    { session: "value" },
    { session_token: "value" },
    { authorization: "Bearer SECRET_CANARY" },
    "https://user:password@example.test/repo.git",
  ])
    assert.equal(containsSecretShape(secret), true);
});

test("subprocess classifier is pure, stable, and cannot accept injected commands", async () => {
  const command: InspectionCommand = {
    executable: "bd",
    argv: ["context", "--json"],
  };
  assert.equal(
    isSchema(InspectionCommandSchema, {
      executable: "bd",
      argv: ["dolt", "show", "--json"],
    }),
    true,
  );
  for (const argv of [
    ["config", "get", "sync.remote", "--json"],
    ["config", "get", "issue_prefix", "--json"],
  ])
    assert.equal(
      isSchema(InspectionCommandSchema, { executable: "bd", argv }),
      true,
    );
  assert.equal(
    isSchema(InspectionCommandSchema, {
      executable: "git",
      argv: ["config", "--null", "--get-regexp", "^remote\\..*\\.url$"],
    }),
    true,
  );
  assert.equal(
    isSchema(InspectionCommandSchema, {
      executable: "git",
      argv: ["remote", "get-url", "--all", "origin"],
    }),
    false,
  );
  const classifications = [
    [
      {
        exitCode: 0,
        outputExceeded: false,
        signal: null,
        spawnFailed: false,
        timedOut: false,
      },
      "ok",
    ],
    [
      {
        exitCode: 2,
        outputExceeded: false,
        signal: null,
        spawnFailed: false,
        timedOut: false,
      },
      "exit",
    ],
    [
      {
        exitCode: null,
        outputExceeded: false,
        signal: "SIGTERM" as const,
        spawnFailed: false,
        timedOut: false,
      },
      "signal",
    ],
    [
      {
        exitCode: null,
        outputExceeded: false,
        signal: null,
        spawnFailed: false,
        timedOut: true,
      },
      "timeout",
    ],
    [
      {
        exitCode: null,
        outputExceeded: true,
        signal: null,
        spawnFailed: false,
        timedOut: false,
      },
      "output_limit",
    ],
    [
      {
        exitCode: null,
        outputExceeded: false,
        signal: null,
        spawnFailed: true,
        timedOut: false,
      },
      "unavailable",
    ],
  ] as const;
  for (const [result, outcome] of classifications) {
    const observation = classifySubprocess(command, result);
    assert.equal(observation.outcome, outcome);
    assert.equal(JSON.stringify(observation).includes("SECRET_CANARY"), false);
  }
  assert.equal(
    subprocessRefusalCode(
      classifySubprocess(command, {
        exitCode: null,
        outputExceeded: true,
        signal: null,
        spawnFailed: false,
        timedOut: false,
      }),
    ),
    "PF_SUBPROCESS_OUTPUT_LIMIT",
  );
  const injected = await executeSanitizedInspection({
    command: { executable: "git", argv: ["status", "SECRET_CANARY"] },
    cwd: "/workspace/repo",
    env: { SECRET_CANARY: "SECRET_CANARY" },
    maxOutputBytes: 1,
    timeoutMs: 1,
  });
  assert.deepEqual(injected, { command: "refused", outcome: "unavailable" });
  const mutating = await executeSanitizedInspection({
    command: { executable: "bd", argv: ["bootstrap", "--yes"] },
    cwd: "/workspace/repo",
    maxOutputBytes: 1,
    timeoutMs: 1,
  });
  assert.deepEqual(mutating, { command: "refused", outcome: "unavailable" });
  const exceptionalCwd = await executeSanitizedInspection({
    command,
    cwd: "/workspace/SECRET_CANARY",
    maxOutputBytes: 1,
    timeoutMs: 1,
  });
  assert.deepEqual(exceptionalCwd, {
    command: "bd context --json",
    outcome: "unavailable",
  });
  assert.equal(JSON.stringify(exceptionalCwd).includes("SECRET_CANARY"), false);
});

/**
 * Fake `bd` programs run under the real executor, so each budget is proven on
 * its own: the cap cases leave the timeout nothing to fire on, and the timeout
 * case leaves the cap nothing to trip on. A loaded machine can then only make
 * a child slower, never change the outcome it is observed to have. Both
 * budgets below are the widest the request contract admits.
 *
 * sce-g7b swept the rest of the fast tier for that class. Only this file and
 * `test/cli/cli.test.ts` spawn anything there, and the latter sets no timeout
 * at all, so it has nothing to race. Every fake program below is therefore the
 * last of the kind, and each is now `#!/bin/sh`: a builtin, or a direct `exec`
 * of one small utility. No interpreter start-up is left between a spawn and
 * the outcome an assertion reads.
 */
const unreachableTimeoutMs = 15_000;
const unreachableOutputBytes = 65_536;

const withFakeBd = async (
  exercise: (
    writeFakeBd: (program: string) => Promise<void>,
    directory: string,
  ) => Promise<void>,
): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "sce-preflight-"));
  const executable = join(directory, "bd");
  const originalPath = process.env.PATH;
  const originalCanary = process.env.SECRET_CANARY;
  const writeFakeBd = async (program: string): Promise<void> => {
    await writeFile(executable, `${program}\n`, "utf8");
    await chmod(executable, 0o700);
  };
  try {
    process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;
    process.env.SECRET_CANARY = "SECRET_CANARY";
    await exercise(writeFakeBd, directory);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalCanary === undefined) delete process.env.SECRET_CANARY;
    else process.env.SECRET_CANARY = originalCanary;
    await rm(directory, { force: true, recursive: true });
  }
};

const inspectBd = (cwd: string, maxOutputBytes: number, timeoutMs: number) => ({
  command: { executable: "bd", argv: ["--version"] },
  cwd,
  maxOutputBytes,
  timeoutMs,
});

test("allowlisted subprocess execution caps output on either stream", async () => {
  await withFakeBd(async (writeFakeBd, directory) => {
    const overflow = "x".repeat(1_024);
    for (const producer of [
      `#!/bin/sh\nprintf '%s' '${overflow}'`,
      `#!/bin/sh\nprintf '%s' '${overflow}' >&2`,
    ]) {
      // A shell builtin writes far past the cap with no interpreter start-up
      // between the spawn and the first chunk.
      await writeFakeBd(producer);
      // Control: under a cap it cannot reach, the same producer completes well
      // inside the budget. The cap is therefore the only difference below, and
      // start-up latency can never be observed as a timeout.
      assert.deepEqual(
        await executeSanitizedInspection(
          inspectBd(directory, unreachableOutputBytes, unreachableTimeoutMs),
        ),
        { command: "bd --version", outcome: "ok", exitCode: 0 },
      );
      assert.deepEqual(
        await executeSanitizedInspection(
          inspectBd(directory, 32, unreachableTimeoutMs),
        ),
        { command: "bd --version", outcome: "output_limit" },
      );
    }
  });
});

test("allowlisted subprocess execution times out a silent child", async () => {
  await withFakeBd(async (writeFakeBd, directory) => {
    // Silent, and alive far past the budget: no byte can reach the cap, so the
    // timeout is the single reachable outcome. `exec` keeps the child at the
    // shell's own pid, so the executor's SIGKILL lands on it; `sleep` is the
    // one utility spawned anywhere in this file, and it replaces the node
    // start-up this budget used to race. This is the only sub-second budget
    // left in the fast tier.
    await writeFakeBd("#!/bin/sh\nexec sleep 30");
    assert.deepEqual(
      await executeSanitizedInspection(
        inspectBd(directory, unreachableOutputBytes, 200),
      ),
      { command: "bd --version", outcome: "timeout" },
    );
  });
});

test("allowlisted subprocess execution sanitizes the environment", async () => {
  await withFakeBd(async (writeFakeBd, directory) => {
    // `${SECRET_CANARY+set}` is non-empty whenever the variable exists at
    // all, so even an empty-valued leak fails the run.
    await writeFakeBd(
      '#!/bin/sh\n[ -z "${SECRET_CANARY+set}" ] || exit 9\nexit 0',
    );
    const sanitized = await executeSanitizedInspection(
      inspectBd(directory, unreachableOutputBytes, unreachableTimeoutMs),
    );
    assert.deepEqual(sanitized, {
      command: "bd --version",
      outcome: "ok",
      exitCode: 0,
    });
    assert.equal(JSON.stringify(sanitized).includes("SECRET_CANARY"), false);

    process.env.PATH = directory;
    assert.deepEqual(
      await executeSanitizedInspection({
        ...inspectBd(directory, unreachableOutputBytes, unreachableTimeoutMs),
        command: {
          executable: "git",
          argv: ["rev-parse", "--show-toplevel"],
        },
      }),
      { command: "git rev-parse --show-toplevel", outcome: "unavailable" },
    );
  });
});

/**
 * `sh` exports PWD and SHLVL (and, in some shells, `_`) into anything it runs,
 * so those three names are the recorder's own rather than the executor's.
 * Every other name below is exactly what this layer handed to `spawn`.
 */
const shellExported = new Set(["PWD", "SHLVL", "_"]);

const recordedEnvironment = async (
  path: string,
): Promise<Record<string, string>> => {
  const entries: Array<[string, string]> = [];
  for (const record of (await readFile(path, "utf8"))
    .split("\n")
    .slice(0, -1)) {
    const separator = record.indexOf("=");
    assert.ok(separator > 0, `unreadable environment record: ${record}`);
    const name = record.slice(0, separator);
    if (!shellExported.has(name))
      entries.push([name, record.slice(separator + 1)]);
  }
  return Object.fromEntries(entries);
};

/**
 * sce-296.22: `bd` resolves `~` for its own configuration, so a child with no
 * HOME writes `~/.config/bd` under the working directory and the engine's
 * sanitized Git status then reads the checkout as dirty. The pinned embedded
 * process has always passed the operator's home; the process boundary in front
 * of `bd context` now passes the same one, while a Git child still carries
 * none.
 */
test("a bd child carries the operator home and a git child carries none", async () => {
  await withFakeBd(async (writeFakeBd, directory) => {
    const recording = join(directory, "environment");
    // `exec env` is one small utility and no interpreter start-up, like every
    // other fake program in this file.
    const recorder = `#!/bin/sh\nexec env > ${recording}`;
    const sanitized = {
      LANG: "C",
      LC_ALL: "C",
      PATH: process.env.PATH,
      TZ: "UTC",
    };

    await writeFakeBd(recorder);
    assert.deepEqual(
      await executeSanitizedInspection(
        inspectBd(directory, unreachableOutputBytes, unreachableTimeoutMs),
      ),
      { command: "bd --version", outcome: "ok", exitCode: 0 },
    );
    assert.deepEqual(await recordedEnvironment(recording), {
      ...sanitized,
      HOME: homedir(),
    });

    const fakeGit = join(directory, "git");
    await writeFile(fakeGit, `${recorder}\n`, "utf8");
    await chmod(fakeGit, 0o700);
    assert.deepEqual(
      await executeSanitizedInspection({
        ...inspectBd(directory, unreachableOutputBytes, unreachableTimeoutMs),
        command: { executable: "git", argv: ["rev-parse", "--show-toplevel"] },
      }),
      { command: "git rev-parse --show-toplevel", outcome: "ok", exitCode: 0 },
    );
    assert.deepEqual(await recordedEnvironment(recording), sanitized);
  });
});

test("a home this layer cannot prove refuses the bd child and leaves git alone", async () => {
  await withFakeBd(async (writeFakeBd, directory) => {
    await writeFakeBd("#!/bin/sh\nexit 0");
    const fakeGit = join(directory, "git");
    await writeFile(fakeGit, "#!/bin/sh\nprintf '%s' /\n", "utf8");
    await chmod(fakeGit, 0o700);
    const originalHome = process.env.HOME;
    try {
      // `homedir()` reads HOME verbatim on POSIX, so an empty or relative
      // value is exactly the ambiguous home that must block the child rather
      // than let it write a literal `~` into the checkout.
      for (const home of ["", "relative/home"]) {
        process.env.HOME = home;
        assert.deepEqual(
          await executeSanitizedInspection(
            inspectBd(directory, unreachableOutputBytes, unreachableTimeoutMs),
          ),
          { command: "bd --version", outcome: "unavailable" },
        );
        assert.deepEqual(
          await executeSanitizedInspection({
            ...inspectBd(
              directory,
              unreachableOutputBytes,
              unreachableTimeoutMs,
            ),
            command: {
              executable: "git",
              argv: ["rev-parse", "--show-toplevel"],
            },
          }),
          {
            command: "git rev-parse --show-toplevel",
            outcome: "ok",
            exitCode: 0,
          },
        );
      }
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});

test("the remote-url query reads a silent no-match as an empty remote list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sce-preflight-remotes-"));
  const executable = join(directory, "git");
  const originalPath = process.env.PATH;
  // sce-g7b: shell builtins, like the fake `bd` programs above. These run at
  // the request contract's own 10 s budget rather than a test-chosen one, so
  // they were never racing, but dropping the interpreter keeps the fast tier
  // free of the whole class and of six node start-ups.
  const writeFakeGit = async (program: string): Promise<void> => {
    await writeFile(executable, `${program}\n`, "utf8");
    await chmod(executable, 0o700);
  };
  try {
    process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;

    // A repository with no configured remote: git exits 1 and says nothing.
    await writeFakeGit("#!/bin/sh\nexit 1");
    assert.deepEqual(await observeGitRemoteUrls(directory), {
      ok: true,
      urls: [],
    });

    // A NUL terminates the record this parser reads; `\000` is the POSIX octal
    // escape for it, which dash and bash both emit.
    await writeFakeGit(
      "#!/bin/sh\nprintf 'remote.origin.url\\ngit@github.com:hls-uk/single-controller-engineer.git\\000'",
    );
    assert.deepEqual(await observeGitRemoteUrls(directory), {
      ok: true,
      urls: ["git@github.com:hls-uk/single-controller-engineer.git"],
    });

    // Every other terminal shape stays fail-closed.
    for (const program of [
      "#!/bin/sh\nprintf '%s' 'fatal: not a git repository' >&2\nexit 1",
      "#!/bin/sh\nprintf '%s' 'remote.origin.url'\nexit 1",
      "#!/bin/sh\nexit 2",
    ]) {
      await writeFakeGit(program);
      assert.deepEqual(await observeGitRemoteUrls(directory), {
        ok: false,
        code: "PF_SUBPROCESS_EXIT",
      });
    }

    // A zero exit still has to prove its own output.
    await writeFakeGit("#!/bin/sh\nprintf '%s' 'remote.origin.url'");
    assert.deepEqual(await observeGitRemoteUrls(directory), {
      ok: true,
      urls: undefined,
    });
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(directory, { force: true, recursive: true });
  }
});

test("preflight envelopes and refusal codes contain no subprocess or secret payload", () => {
  const refused = preflightEnvelope(
    { status: "refused", code: "PF_SUBPROCESS_EXIT" },
    undefined,
  );
  assert.deepEqual(refused.payload, {
    status: "refused",
    code: "PF_SUBPROCESS_EXIT",
  });
  assert.equal(JSON.stringify(refused).includes("SECRET_CANARY"), false);
  assert.equal(isSchema(PreflightEnvelopeSchema, refused), true);
  assert.equal(
    isSchema(DoltObservationSchema, {
      autoCommit: "batch",
      database: "sce",
      head: "a".repeat(40),
      reachable: true,
      workingSet: "clean",
    }),
    true,
  );
  assert.equal(
    isSchema(DoltObservationSchema, {
      autoCommit: "batch",
      database: "sce",
      reachable: true,
      secret: "SECRET_CANARY",
      workingSet: "clean",
    }),
    false,
  );
});
