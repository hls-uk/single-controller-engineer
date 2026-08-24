import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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
  assert.equal(
    normalizeGitRemote("https://github.com/%E0%A4%A.git"),
    undefined,
  );
  assert.equal(normalizeGitRemote("file:///srv/%E0%A4%A.git"), undefined);
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

test("allowlisted subprocess execution enforces caps, timeout, and sanitized environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sce-preflight-"));
  const executable = join(directory, "bd");
  const originalPath = process.env.PATH;
  const originalCanary = process.env.SECRET_CANARY;
  const request = {
    command: { executable: "bd" as const, argv: ["--version"] as const },
    cwd: directory,
    maxOutputBytes: 32,
    timeoutMs: 1_000,
  };
  const writeFakeBd = async (body: string): Promise<void> => {
    await writeFile(executable, `#!/usr/bin/env node\n${body}\n`, "utf8");
    await chmod(executable, 0o700);
  };
  try {
    process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;
    process.env.SECRET_CANARY = "SECRET_CANARY";

    await writeFakeBd('process.stdout.write("x".repeat(1024));');
    assert.deepEqual(await executeSanitizedInspection(request), {
      command: "bd --version",
      outcome: "output_limit",
    });

    await writeFakeBd('process.stderr.write("x".repeat(1024));');
    assert.deepEqual(await executeSanitizedInspection(request), {
      command: "bd --version",
      outcome: "output_limit",
    });

    await writeFakeBd("setInterval(() => undefined, 1_000);");
    assert.deepEqual(
      await executeSanitizedInspection({ ...request, timeoutMs: 200 }),
      { command: "bd --version", outcome: "timeout" },
    );

    await writeFakeBd(
      "if (process.env.SECRET_CANARY !== undefined) process.exit(9);",
    );
    const sanitized = await executeSanitizedInspection(request);
    assert.deepEqual(sanitized, {
      command: "bd --version",
      outcome: "ok",
      exitCode: 0,
    });
    assert.equal(JSON.stringify(sanitized).includes("SECRET_CANARY"), false);

    process.env.PATH = directory;
    const unavailable = await executeSanitizedInspection({
      ...request,
      command: {
        executable: "git" as const,
        argv: ["rev-parse", "--show-toplevel"] as const,
      },
    });
    assert.deepEqual(unavailable, {
      command: "git rev-parse --show-toplevel",
      outcome: "unavailable",
    });
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalCanary === undefined) delete process.env.SECRET_CANARY;
    else process.env.SECRET_CANARY = originalCanary;
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
