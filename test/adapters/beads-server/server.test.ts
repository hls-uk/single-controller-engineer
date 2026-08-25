import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";

import {
  __setDoltBeadsServerDriverPostTransactionTestHookForTests,
  __setDoltSqlTransactionTestHookForTests,
  BeadsServerAdapter,
  buildServerCasProgram,
  DoltBeadsServerDriver,
  executeServerSqlProgram,
  deriveServerIdentity,
  makeServerSlotTransitionIntent,
  parseServerCasReadback,
  PinnedBdManagedServerProcess,
  PinnedBdServerProcess,
  slotScopeReference,
  DoltSqlTransport,
  type BeadsServerDriver,
  type ServerAutoCommitPolicy,
  type ServerDriverResponse,
  type ServerIdentity,
  type DoltSqlTransactionTestPhase,
} from "../../../src/adapters/beads-server/index.js";
import type { InitialControllerAcquire } from "../../../src/commands/recovery.js";
import {
  deriveChangedRowsCommitment,
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  makeChildProjection,
  makeRootProjection,
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
  type RootProjection,
  validateMutationBatch,
  withBatchCheckpoint,
} from "../../../src/fencing/index.js";
import type { BeadsIdentity } from "../../../src/preflight/index.js";
import {
  deriveIdempotencyKey,
  deriveSessionFingerprint,
  deriveSessionLineageRoot,
  reduce,
} from "../../../src/protocol/reducer.js";
import {
  canonicalJson,
  type JsonValue,
} from "../../../src/protocol/canonical.js";
import { event, run, unit } from "../../protocol/fixtures.js";

const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};
const holder = "run-1/incarnation-1";
const fakeManagedProcess = {
  start: async () => ({ status: "ok" as const, value: undefined }),
};

function identity(
  policy: ServerAutoCommitPolicy = "on",
  endpoint = "127.0.0.1:3306",
): ServerIdentity {
  const value = deriveServerIdentity({
    autoCommitPolicy: policy,
    beads: {
      beadsDir: "/repo/.beads",
      contextSchemaVersion: 1,
      database: "sce",
      mode: "managed_local_shared_server",
      prefix: "sce",
      provenance: "shared_server_flag",
      server: endpoint,
      toolVersion: "1.1.0",
    },
    credentialProvenance: "managed_local_runtime",
    credentialReference: "managed-writer-v1",
    schema: "beads",
    transportSecurity: "loopback_plaintext",
    workerCredentialReference: "managed-worker-ro-v1",
  });
  assert.ok(value);
  return value;
}

function externalIdentity(
  policy: ServerAutoCommitPolicy = "on",
  endpoint = "127.0.0.1:3306",
): ServerIdentity {
  const value = deriveServerIdentity({
    autoCommitPolicy: policy,
    beads: {
      beadsDir: "/repo/.beads",
      contextSchemaVersion: 1,
      database: "sce",
      mode: "external_server",
      prefix: "sce",
      provenance: "external_server_flag",
      server: endpoint,
      toolVersion: "1.1.0",
    },
    credentialProvenance: "environment",
    credentialReference: "external-writer-env-v1",
    schema: "beads",
    transportSecurity: "loopback_plaintext",
    workerCredentialReference: "external-worker-ro-env-v1",
  });
  assert.ok(value);
  return value;
}

function slot(
  status: "available" | "acquired",
  slotHolder: string | undefined,
  actor: string,
  slotScope: FencingScope = scope,
): MergeSlotObservation {
  const withoutHash = {
    actor,
    ...(slotHolder === undefined ? {} : { holder: slotHolder }),
    label: "gt:slot" as const,
    scope: slotScope,
    scopeCommitment: deriveScopeCommitment(slotScope),
    slotId: "sce-merge-slot",
    status,
    title: "Merge Slot" as const,
    version: 1 as const,
  };
  return { ...withoutHash, readbackHash: deriveSlotReadbackHash(withoutHash) };
}

function batchForRun(source = run()): MutationBatch {
  const before = makeRootProjection(source);
  const nextState = reduce(
    before.run,
    event(before.run, "reservation_intent", {
      reservations: [
        { id: "reservation-1", namespace: "branch", resource: "main" },
      ],
    }),
  );
  assert.equal(nextState.ok, true);
  if (!nextState.ok) throw new Error("fixture reduction failed");
  const base = makeRootProjection(nextState.nextState);
  const previous = before.childRows[0];
  assert.ok(previous);
  const child = makeChildProjection(base, previous.unitId);
  assert.ok(child);
  const changedRows = [
    {
      expectedCommitment: previous.commitment,
      expectedRevision: previous.revision,
      nextCommitment: child.commitment,
      nextRevision: child.revision,
      unitId: child.unitId,
    },
  ];
  const root = withBatchCheckpoint(base, changedRows);
  return {
    changedRows,
    checkpoint: {
      aggregateRevision: root.aggregateRevision,
      changedRowsCommitment: deriveChangedRowsCommitment(changedRows),
      rootCommitment: root.aggregateCommitment,
    },
    expectedAggregateCommitment: before.aggregateCommitment,
    expectedAggregateRevision: before.aggregateRevision,
    expectedChildren: [
      {
        expectedCommitment: previous.commitment,
        expectedRevision: previous.revision,
        unitId: previous.unitId,
      },
    ],
    expectedHolder: holder,
    holder,
    next: { children: [child], root },
    schema: "sce.fencing.batch",
    scope,
    version: 1,
  };
}

function batch(): MutationBatch {
  return batchForRun();
}

function initialServerAcquire(): InitialControllerAcquire {
  const base = run();
  const initial = {
    ...base,
    controller: { ...base.controller, state: "unacquired" as const },
    state: "initializing" as const,
  };
  const before = slot("available", undefined, holder);
  const after = slot("acquired", holder, holder);
  const slotTransition = makeServerSlotTransitionIntent({
    after,
    before,
    holder,
    kind: "acquire",
    scope,
  });
  assert.ok(slotTransition);
  const reduced = reduce(initial, {
    eventId: "server-acquire-intent",
    expectedRevision: initial.revision,
    idempotencyKey: deriveIdempotencyKey(
      initial,
      initial.revision,
      null,
      "controller_acquire",
    ),
    slotTransition,
    type: "controller_acquire_intent",
  });
  assert.equal(reduced.ok, true);
  if (!reduced.ok) throw new Error("initial server reduction failed");
  const root = makeRootProjection(reduced.nextState);
  return {
    expected: { children: "absent", holder, root: "absent", scope },
    next: {
      children: [makeChildProjection(root, "unit-1")!],
      root,
    },
    schema: "sce.recovery.initial-controller-acquire",
    version: 1,
  };
}

/** Exact bounded protocol session-lineage maximum for the real SQL fixture. */
function denseRun(sessionCount = 2_176) {
  const state = run();
  const sessionIds = Array.from(
    { length: sessionCount },
    (_, index) => `dense-session-${index}`,
  );
  const bitmapBytes = Math.ceil(sessionIds.length / 8);
  const raw = Buffer.alloc(bitmapBytes + sessionIds.length * 32);
  for (const [index, sessionId] of sessionIds.entries()) {
    raw[Math.floor(index / 8)]! |= 1 << (index % 8);
    Buffer.from(deriveSessionFingerprint(sessionId), "hex").copy(
      raw,
      bitmapBytes + index * 32,
    );
  }
  const sessionLineage = raw.toString("base64");
  return {
    ...state,
    sessionLineage,
    sessionLineageRoot: deriveSessionLineageRoot(
      sessionLineage,
      sessionIds.length,
    ),
    usedSessionCount: sessionIds.length,
  };
}

/**
 * A protocol-valid root close to its envelope high-water mark. One child
 * retains a 57 KiB projection and the other 63 retain bounded independent
 * facts, so the one-child reducer transition exercises JSON hex expansion
 * without inventing an invalid aggregate.
 */
function nearBoundRun() {
  return run(
    Array.from({ length: 64 }, (_, index) => {
      const id =
        index === 0 ? "unit-1" : `z-unit-${String(index + 1).padStart(2, "0")}`;
      return {
        ...unit(id),
        verificationCommands: [
          ...(index === 0
            ? Array.from({ length: 7 }, () => "x".repeat(8_192))
            : []),
          ...(index === 0 ? [] : ["y".repeat(900)]),
        ],
      };
    }),
  );
}

/**
 * The concrete protocol schema permits up to 64 affected children. This
 * helper keeps every field schema-valid while constructing the paired exact
 * 256 KiB boundary vectors used below. It is intentionally not sent to a
 * server: the production adapter must reject the 40-child case first.
 */
function schemaValidBoundaryBatch(changedChildCount: number): MutationBatch {
  const before = makeRootProjection(nearBoundRun());
  const nextRun = {
    ...before.run,
    revision: before.run.revision + 1,
    units: Object.fromEntries(
      Object.entries(before.run.units).map(([id, value]) => [
        id,
        { ...value, revision: value.revision + 1 },
      ]),
    ),
  };
  const base = makeRootProjection(nextRun);
  const children = Object.keys(nextRun.units)
    .sort()
    .slice(0, changedChildCount)
    .map((unitId) => makeChildProjection(base, unitId));
  assert.equal(
    children.some((child) => child === undefined),
    false,
  );
  const nextChildren = children.filter(
    (child): child is NonNullable<typeof child> => child !== undefined,
  );
  const changedRows = nextChildren.map((child) => {
    const expected = before.childRows.find(
      (row) => row.unitId === child.unitId,
    );
    assert.ok(expected);
    return {
      expectedCommitment: expected.commitment,
      expectedRevision: expected.revision,
      nextCommitment: child.commitment,
      nextRevision: child.revision,
      unitId: child.unitId,
    };
  });
  const root = withBatchCheckpoint(base, changedRows);
  return {
    changedRows,
    checkpoint: {
      aggregateRevision: root.aggregateRevision,
      changedRowsCommitment: deriveChangedRowsCommitment(changedRows),
      rootCommitment: root.aggregateCommitment,
    },
    expectedAggregateCommitment: before.aggregateCommitment,
    expectedAggregateRevision: before.aggregateRevision,
    expectedChildren: before.childRows
      .filter((row) =>
        changedRows.some((changed) => changed.unitId === row.unitId),
      )
      .map((row) => ({
        expectedCommitment: row.commitment,
        expectedRevision: row.revision,
        unitId: row.unitId,
      })),
    expectedHolder: holder,
    holder,
    next: { children: nextChildren, root },
    schema: "sce.fencing.batch",
    scope,
    version: 1,
  };
}

function sqlLiteral(value: string | number): string {
  return typeof value === "number"
    ? String(value)
    : `'${value.replaceAll("'", "''")}'`;
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed =
    typeof value === "string" && value.length > 0 ? JSON.parse(value) : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("expected JSON object readback");
  return parsed as Record<string, unknown>;
}

function renderSqlStatement(input: {
  parameters: readonly (string | number)[];
  sql: string;
}): string {
  let parameterIndex = 0;
  const sql = input.sql.replaceAll("?", () => {
    const value = input.parameters[parameterIndex];
    parameterIndex += 1;
    if (value === undefined) throw new Error("missing SQL parameter");
    return sqlLiteral(value);
  });
  if (parameterIndex !== input.parameters.length)
    throw new Error("unused SQL parameter");
  return sql;
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function removeFixtureDirectory(directory: string): Promise<void> {
  // bd's anonymous-event writer can close just after its server lifecycle
  // command returns. Reap only this exact fixture root through a quiet window,
  // so a late fixture-owned writer cannot recreate its isolated HOME after an
  // otherwise successful recursive removal.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      await rm(directory, { force: true, recursive: true });
      await delay(125);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !Object.hasOwn(error, "code") ||
        (error as NodeJS.ErrnoException).code !== "ENOTEMPTY"
      )
        throw error;
      await delay(100);
    }
  }
  await rm(directory, { force: true, recursive: true });
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (address === null || typeof address === "string")
    throw new Error("failed to allocate loopback port");
  return address.port;
}

async function runDolt(
  args: readonly string[],
  input: Readonly<{
    cwd: string;
    executable?: string;
    password?: string;
    stdin?: string;
  }>,
): Promise<void> {
  const executable =
    input.executable ??
    process.env.DOLT_TEST_EXECUTABLE ??
    "/opt/homebrew/bin/dolt";
  if (!isAbsolute(executable))
    throw new Error("test Dolt executable must be absolute");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: input.cwd,
      env: {
        DOLT_CLI_PASSWORD: input.password,
        PATH: `${dirname(executable)}:/usr/bin:/bin`,
      },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Dolt command failed")),
    );
    child.stdin.end(input.stdin);
  });
}

type FixtureDoltRead =
  | Readonly<{ status: "ok"; rows: readonly Record<string, unknown>[] }>
  | Readonly<{ status: "unavailable" }>;

/**
 * Test-owned independent CLI reader. Production transports deliberately have
 * no caller-supplied SQL API; fixture assertions therefore never reflect or
 * reach into their private driver channel.
 */
async function readFixtureDolt(
  input: Readonly<{
    cwd: string;
    endpoint: string;
    executable: string;
    password?: string;
    user?: string;
  }>,
  query: string,
): Promise<FixtureDoltRead> {
  const [host, port] = input.endpoint.split(":");
  if (host === undefined || port === undefined)
    return { status: "unavailable" };
  return new Promise((resolve) => {
    const child = spawn(
      input.executable,
      [
        "--no-tls",
        "--host",
        host,
        "--port",
        port,
        "--use-db",
        "sce",
        ...(input.user === undefined ? [] : ["--user", input.user]),
        "sql",
        "-q",
        query,
        "-r",
        "json",
      ],
      {
        cwd: input.cwd,
        env: {
          ...(input.password === undefined
            ? {}
            : { DOLT_CLI_PASSWORD: input.password }),
          PATH: `${dirname(input.executable)}:/usr/bin:/bin`,
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(output, "utf8") <= 1_048_576)
        output += chunk.toString("utf8");
    });
    child.once("error", () => resolve({ status: "unavailable" }));
    child.once("close", (code) => {
      if (code !== 0 || Buffer.byteLength(output, "utf8") > 1_048_576)
        return resolve({ status: "unavailable" });
      try {
        const parsed = JSON.parse(output) as unknown;
        const rows = Array.isArray(parsed)
          ? parsed
          : parsed !== null &&
              typeof parsed === "object" &&
              !Array.isArray(parsed) &&
              Array.isArray((parsed as { rows?: unknown }).rows)
            ? (parsed as { rows: unknown[] }).rows
            : parsed !== null &&
                typeof parsed === "object" &&
                !Array.isArray(parsed) &&
                Object.keys(parsed).length === 0
              ? []
              : undefined;
        if (
          rows === undefined ||
          !rows.every(
            (row) =>
              row !== null && typeof row === "object" && !Array.isArray(row),
          )
        )
          return resolve({ status: "unavailable" });
        return resolve({
          status: "ok",
          rows: rows as readonly Record<string, unknown>[],
        });
      } catch {
        return resolve({ status: "unavailable" });
      }
    });
  });
}

async function runBd(
  args: readonly string[],
  input: Readonly<{
    cwd: string;
    executable: string;
    password?: string;
    runtime?: Readonly<{ config: string; home: string }>;
  }>,
): Promise<string> {
  if (!isAbsolute(input.executable))
    throw new Error("test bd executable must be absolute");
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, args, {
      cwd: input.cwd,
      env: {
        BD_NON_INTERACTIVE: "1",
        ...(input.password === undefined
          ? {}
          : { BEADS_DOLT_PASSWORD: input.password }),
        CI: "1",
        ...(input.runtime === undefined ? {} : { HOME: input.runtime.home }),
        PATH: `${dirname(input.executable)}:/usr/bin:/bin`,
        ...(input.runtime === undefined
          ? {}
          : { XDG_CONFIG_HOME: input.runtime.config }),
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    // `close`, not `exit`, waits for stdout and its fixture-side event writer
    // to finish before teardown removes the isolated HOME/config root.
    child.once("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`bd fixture command failed: ${args.join(" ")}`)),
    );
  });
}

type PrivateBdServerTeardownAuthority = Readonly<{
  dataDirectory: string;
  pid: number;
  port: number;
}>;

type PrivateBdServerControl = Readonly<{
  dataDirectory: string;
  executable: string;
  runtime: Readonly<{ config: string; home: string }>;
  workspace: string;
}>;

async function privateBdServerStatus(
  input: PrivateBdServerControl,
): Promise<Record<string, unknown>> {
  const status = JSON.parse(
    await runBd(["-C", input.workspace, "dolt", "status", "--json"], {
      cwd: input.workspace,
      executable: input.executable,
      runtime: input.runtime,
    }),
  ) as unknown;
  if (status === null || typeof status !== "object" || Array.isArray(status))
    throw new Error("invalid private bd server status");
  return status as Record<string, unknown>;
}

async function privateBdServerTeardownAuthority(
  input: PrivateBdServerControl,
): Promise<PrivateBdServerTeardownAuthority> {
  const status = await privateBdServerStatus(input);
  if (
    status.running !== true ||
    typeof status.data_dir !== "string" ||
    !Number.isSafeInteger(status.pid) ||
    (status.pid as number) <= 0 ||
    !Number.isSafeInteger(status.port) ||
    (status.port as number) < 1 ||
    (status.port as number) > 65_535
  )
    throw new Error("private bd server did not report an owned running status");
  const [actual, expected] = await Promise.all([
    realpath(status.data_dir),
    realpath(input.dataDirectory),
  ]);
  if (actual !== expected)
    throw new Error("private bd server data directory identity mismatch");
  return {
    dataDirectory: expected,
    pid: status.pid as number,
    port: status.port as number,
  };
}

async function stopPrivateBdServer(
  input: PrivateBdServerControl,
  authority?: PrivateBdServerTeardownAuthority,
): Promise<void> {
  const status = await privateBdServerStatus(input);
  if (status.running === false) {
    assert.equal(status.data_dir, "");
    assert.equal(status.pid, 0);
    assert.equal(status.port, 0);
    return;
  }
  const observed = await privateBdServerTeardownAuthority(input);
  if (
    authority !== undefined &&
    (authority.dataDirectory !== observed.dataDirectory ||
      authority.pid !== observed.pid ||
      authority.port !== observed.port)
  )
    throw new Error("private bd server teardown authority changed");
  await runBd(["-C", input.workspace, "dolt", "stop", "--force"], {
    cwd: input.workspace,
    executable: input.executable,
    runtime: input.runtime,
  });
  const stopped = await privateBdServerStatus(input);
  assert.equal(stopped.running, false);
  assert.equal(stopped.data_dir, "");
  assert.equal(stopped.pid, 0);
  assert.equal(stopped.port, 0);
}

async function initializeFixtureGitWorkspace(cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/git", ["init", "-q"], {
      cwd,
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("fixture git init failed")),
    );
  });
}

async function stopDoltServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

type RealDoltServer = Readonly<{
  directory: string;
  endpoint: string;
  executable: string;
  readWorker: (query: string) => Promise<FixtureDoltRead>;
  readWriter: (query: string) => Promise<FixtureDoltRead>;
  stop: () => Promise<void>;
  worker: DoltSqlTransport;
  workerPassword: string;
  writer: DoltSqlTransport;
  writerPassword: string;
}>;

type BdDoltServer = RealDoltServer &
  Readonly<{
    bdExecutable: string;
    context: Readonly<Record<string, unknown>>;
    workspace: string;
  }>;

type ManagedBdServer = Readonly<{
  bdExecutable: string;
  context: Readonly<Record<string, unknown>>;
  directory: string;
  endpoint: string;
  executable: string;
  home: string;
  lifecycle: PinnedBdManagedServerProcess;
  runtime: Readonly<{ config: string; home: string }>;
  readWorker: (query: string) => Promise<FixtureDoltRead>;
  readWriter: (query: string) => Promise<FixtureDoltRead>;
  stop: () => Promise<void>;
  worker: DoltSqlTransport;
  workerPassword: string;
  workspace: string;
  writer: DoltSqlTransport;
  writerPassword: string;
}>;

async function startRealDoltServer(
  input: Readonly<{
    /** Fixture-only seam: makes port-allocation cleanup deterministic. */
    allocatePort?: (directory: string) => Promise<number>;
    identityForEndpoint?: (endpoint: string) => ServerIdentity;
  }> = {},
): Promise<RealDoltServer> {
  const executable =
    process.env.DOLT_TEST_EXECUTABLE ?? "/opt/homebrew/bin/dolt";
  let directory: string | undefined;
  let server: ChildProcess | undefined;
  try {
    // The root becomes cleanup-owned before allocating a port. A failed bind
    // or allocation must never strand a Beads/Dolt fixture below the repo.
    const createdDirectory = await mkdtemp("/private/tmp/sce-real-dolt-");
    directory = createdDirectory;
    const databaseDirectory = join(createdDirectory, "sce");
    const port =
      input.allocatePort === undefined
        ? await unusedLoopbackPort()
        : await input.allocatePort(createdDirectory);
    await mkdir(databaseDirectory);
    await runDolt(["init"], { cwd: databaseDirectory, executable });
    server = spawn(
      executable,
      [
        "sql-server",
        "--data-dir",
        createdDirectory,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--socket",
        join(createdDirectory, "mysql.sock"),
        "--allow-cleartext-passwords",
        "--loglevel=error",
      ],
      {
        cwd: createdDirectory,
        env: { PATH: `${dirname(executable)}:/usr/bin:/bin` },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    const endpoint = `127.0.0.1:${port}`;
    const serverIdentity =
      input.identityForEndpoint?.(endpoint) ?? identity("on", endpoint);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        (
          await readFixtureDolt(
            { cwd: createdDirectory, endpoint, executable },
            "SELECT 1 AS ready",
          )
        ).status === "ok"
      )
        break;
      if (server.exitCode !== null) throw new Error("Dolt server exited");
      await delay(50);
      if (attempt === 99) throw new Error("Dolt server did not become ready");
    }
    const writerPassword = randomBytes(18).toString("hex");
    const workerPassword = randomBytes(18).toString("hex");
    await runDolt(
      [
        "--no-tls",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--use-db",
        "sce",
        "sql",
      ],
      {
        cwd: createdDirectory,
        executable,
        stdin: [
          `CREATE USER 'writer' IDENTIFIED BY '${writerPassword}';`,
          "GRANT ALL ON *.* TO 'writer';",
          `CREATE USER 'worker' IDENTIFIED BY '${workerPassword}';`,
          "GRANT SELECT ON sce.* TO 'worker';",
        ].join("\n"),
      },
    );
    return {
      directory: createdDirectory,
      endpoint,
      executable,
      readWorker: (query) =>
        readFixtureDolt(
          {
            cwd: createdDirectory,
            endpoint,
            executable,
            password: workerPassword,
            user: "worker",
          },
          query,
        ),
      readWriter: (query) =>
        readFixtureDolt(
          {
            cwd: createdDirectory,
            endpoint,
            executable,
            password: writerPassword,
            user: "writer",
          },
          query,
        ),
      stop: async () => stopDoltServer(server!),
      worker: new DoltSqlTransport({
        executable,
        identity: serverIdentity,
        password: workerPassword,
        user: "worker",
      }),
      workerPassword,
      writer: new DoltSqlTransport({
        executable,
        identity: serverIdentity,
        password: writerPassword,
        user: "writer",
      }),
      writerPassword,
    };
  } catch (error) {
    if (server !== undefined) await stopDoltServer(server);
    if (directory !== undefined)
      await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

/** Real bd 1.1.0 managed shared-server fixture, isolated below `directory`. */
async function createManagedBdServer(
  input: Readonly<{
    /** Test-only fault point after init owns and verifies its private server. */
    afterOwnedInit?: (
      value: Readonly<{
        directory: string;
        teardown: PrivateBdServerTeardownAuthority;
      }>,
    ) => void | Promise<void>;
  }> = {},
): Promise<ManagedBdServer> {
  const executable =
    process.env.DOLT_TEST_EXECUTABLE ?? "/opt/homebrew/bin/dolt";
  const bdExecutable = process.env.BD_TEST_EXECUTABLE ?? "/opt/homebrew/bin/bd";
  // Keep this repository outside the checked-out worktree so bd's project
  // discovery cannot reach or rewrite the controller's real `.beads` config.
  const directory = await mkdtemp("/private/tmp/sce-managed-bd-");
  const home = join(directory, "home");
  const runtime = { config: join(directory, "config"), home };
  const workspace = join(directory, "workspace");
  const dataDirectory = join(home, ".beads", "shared-server", "dolt");
  const writerPassword = randomBytes(18).toString("hex");
  const workerPassword = randomBytes(18).toString("hex");
  let teardown: PrivateBdServerTeardownAuthority | undefined;
  try {
    await mkdir(home);
    await mkdir(runtime.config);
    await mkdir(workspace);
    await initializeFixtureGitWorkspace(workspace);
    await runBd(
      [
        "init",
        "--non-interactive",
        "--prefix",
        "sce",
        "--shared-server",
        "--skip-agents",
        "--skip-hooks",
      ],
      { cwd: workspace, executable: bdExecutable, runtime },
    );
    // `bd init --shared-server` has started a process at this point. Verify
    // the exact private data-dir/pid/port before any other fixture setup so
    // every later failure can stop only this fixture-owned server.
    teardown = await privateBdServerTeardownAuthority({
      dataDirectory,
      executable: bdExecutable,
      runtime,
      workspace,
    });
    await input.afterOwnedInit?.({ directory, teardown });
    const context = JSON.parse(
      await runBd(["-C", workspace, "context", "--json"], {
        cwd: workspace,
        executable: bdExecutable,
        runtime,
      }),
    ) as Record<string, unknown>;
    assert.equal(context.backend, "dolt");
    assert.equal(context.database, "sce");
    assert.equal(context.dolt_mode, "server");
    assert.equal(context.server_host, "127.0.0.1");
    assert.equal(typeof context.server_port, "number");
    assert.equal(typeof context.beads_dir, "string");
    assert.equal((context.beads_dir as string).startsWith(workspace), true);
    assert.equal(
      (
        await stat(join(home, ".beads", "shared-server", "dolt-server.port"))
      ).isFile(),
      true,
    );
    const endpoint = `127.0.0.1:${String(context.server_port)}`;
    const serverIdentity = identity("on", endpoint);
    const writer = new DoltSqlTransport({
      executable,
      identity: serverIdentity,
      password: writerPassword,
      user: "writer",
    });
    const worker = new DoltSqlTransport({
      executable,
      identity: serverIdentity,
      password: workerPassword,
      user: "worker",
    });
    const rootSql = [
      "--no-tls",
      "--host",
      "127.0.0.1",
      "--port",
      String(context.server_port),
      "--use-db",
      "sce",
      "sql",
    ];
    await runDolt(rootSql, {
      cwd: directory,
      executable,
      stdin: [
        `CREATE USER 'writer' IDENTIFIED BY '${writerPassword}'`,
        "GRANT ALL ON *.* TO 'writer'",
        `CREATE USER 'worker' IDENTIFIED BY '${workerPassword}'`,
        "GRANT SELECT ON sce.* TO 'worker'",
      ].join(";\n"),
    });
    await runBd(
      [
        "-C",
        workspace,
        "--actor",
        "fixture",
        "--dolt-auto-commit",
        "on",
        "merge-slot",
        "create",
        "--json",
      ],
      { cwd: workspace, executable: bdExecutable, runtime },
    );
    const canonicalScope = canonicalJson(scope as JsonValue);
    await runDolt(
      [
        "--no-tls",
        "--host",
        "127.0.0.1",
        "--port",
        String(context.server_port),
        "--use-db",
        "sce",
        "--user",
        "writer",
        "sql",
        "-q",
        `SET @@SESSION.dolt_transaction_commit = 1; UPDATE sce.issues SET external_ref = ${sqlLiteral(slotScopeReference(scope))}, design = ${sqlLiteral(canonicalScope)} WHERE id = 'sce-merge-slot' AND status = 'open' AND external_ref IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) = '{}'`,
      ],
      { cwd: directory, executable, password: writerPassword },
    );
    for (const [id, title] of [
      ["sce-managed-root", "Managed root"],
      ["sce-managed-child", "Managed child"],
    ] as const) {
      await runBd(
        [
          "-C",
          workspace,
          "--actor",
          "fixture",
          "--dolt-auto-commit",
          "on",
          "create",
          "--id",
          id,
          title,
          "--json",
        ],
        { cwd: workspace, executable: bdExecutable, runtime },
      );
    }
    const lifecycle = new PinnedBdManagedServerProcess({
      dataDirectory,
      doltExecutable: executable,
      executable: bdExecutable,
      runtimeEnvironment: () => ({
        HOME: runtime.home,
        XDG_CONFIG_HOME: runtime.config,
      }),
      workspace,
    });
    return {
      bdExecutable,
      context,
      directory,
      endpoint,
      executable,
      home,
      lifecycle,
      runtime,
      readWorker: (query) =>
        readFixtureDolt(
          {
            cwd: directory,
            endpoint,
            executable,
            password: workerPassword,
            user: "worker",
          },
          query,
        ),
      readWriter: (query) =>
        readFixtureDolt(
          {
            cwd: directory,
            endpoint,
            executable,
            password: writerPassword,
            user: "writer",
          },
          query,
        ),
      stop: () =>
        stopPrivateBdServer({
          dataDirectory,
          executable: bdExecutable,
          runtime,
          workspace,
        }),
      worker,
      workerPassword,
      workspace,
      writer,
      writerPassword,
    };
  } catch (error) {
    try {
      if (teardown !== undefined)
        await stopPrivateBdServer(
          { dataDirectory, executable: bdExecutable, runtime, workspace },
          teardown,
        );
    } finally {
      await removeFixtureDirectory(directory);
    }
    throw error;
  }
}

async function startBdDoltServer(): Promise<BdDoltServer> {
  const fixture = await startRealDoltServer({
    identityForEndpoint: (endpoint) => externalIdentity("on", endpoint),
  });
  const bdExecutable = process.env.BD_TEST_EXECUTABLE ?? "/opt/homebrew/bin/bd";
  const workspace = join(fixture.directory, "bd-workspace");
  try {
    await mkdir(workspace);
    await initializeFixtureGitWorkspace(workspace);
    await runBd(
      [
        "init",
        "--non-interactive",
        "--prefix",
        "sce",
        "--server",
        "--external",
        "--server-host",
        "127.0.0.1",
        "--server-port",
        fixture.endpoint.split(":")[1]!,
        "--server-user",
        "writer",
        "--database",
        "sce",
        "--reinit-local",
        "--discard-remote",
        "--destroy-token",
        "DESTROY-sce",
        "--skip-agents",
        "--skip-hooks",
      ],
      {
        cwd: workspace,
        executable: bdExecutable,
        password: fixture.writerPassword,
      },
    );
    await runBd(
      ["-C", workspace, "--actor", "fixture", "dolt", "commit", "--json"],
      {
        cwd: workspace,
        executable: bdExecutable,
        password: fixture.writerPassword,
      },
    );
    const context = JSON.parse(
      await runBd(["-C", workspace, "context", "--json"], {
        cwd: workspace,
        executable: bdExecutable,
        password: fixture.writerPassword,
      }),
    ) as Record<string, unknown>;
    assert.equal(context.backend, "dolt");
    assert.equal(context.database, "sce");
    // Pinned bd 1.1.0 reports the server endpoint as separate host/port
    // fields. The fixture command above explicitly selects `--external`.
    assert.equal(context.dolt_mode, "server");
    assert.equal(context.server_host, "127.0.0.1");
    assert.equal(context.server_port, Number(fixture.endpoint.split(":")[1]));
    await runBd(
      [
        "-C",
        workspace,
        "--actor",
        "fixture",
        "--dolt-auto-commit",
        "on",
        "merge-slot",
        "create",
        "--json",
      ],
      {
        cwd: workspace,
        executable: bdExecutable,
        password: fixture.writerPassword,
      },
    );
    const canonicalScope = canonicalJson(scope as JsonValue);
    await runDolt(
      [
        "--no-tls",
        "--host",
        "127.0.0.1",
        "--port",
        fixture.endpoint.split(":")[1]!,
        "--use-db",
        "sce",
        "--user",
        "writer",
        "sql",
        "-q",
        `SET @@SESSION.dolt_transaction_commit = 1; UPDATE sce.issues SET external_ref = ${sqlLiteral(slotScopeReference(scope))}, design = ${sqlLiteral(canonicalScope)} WHERE id = 'sce-merge-slot' AND status = 'open' AND external_ref IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) = '{}'`,
      ],
      {
        cwd: fixture.directory,
        executable: fixture.executable,
        password: fixture.writerPassword,
      },
    );
    const slotIdentity = await fixture.readWriter(
      "SELECT id, status, metadata, external_ref, title, design FROM sce.issues WHERE id = 'sce-merge-slot'",
    );
    assert.deepEqual(slotIdentity, {
      status: "ok",
      rows: [
        {
          id: "sce-merge-slot",
          status: "open",
          metadata: "{}",
          external_ref: slotScopeReference(scope),
          title: "Merge Slot",
          design: canonicalScope,
        },
      ],
    });
    assert.deepEqual(
      await fixture.readWriter(
        "SELECT label FROM sce.labels WHERE issue_id = 'sce-merge-slot'",
      ),
      { status: "ok", rows: [{ label: "gt:slot" }] },
    );
    return { ...fixture, bdExecutable, context, workspace };
  } catch (error) {
    await fixture.stop();
    await rm(fixture.directory, { force: true, recursive: true });
    throw error;
  }
}

/** Deterministic disposable SQL-server contract double. */
class FakeServer implements BeadsServerDriver {
  readonly #identity: ServerIdentity;
  root: RootProjection;
  slot: MergeSlotObservation | undefined;
  unrelatedRevision = 0;
  mutationCalls = 0;
  readOnly = true;
  slotAcquireCalls = 0;
  slotCheckCalls = 0;
  slotTransitions = 0;
  lastSlotCheckActor: string | undefined;
  afterSlotCheck: (() => void) | undefined;
  slotAcquireMode: "malformed" | "ok" | "throw" | "unavailable" = "ok";
  slotCheckMode: "malformed" | "ok" | "throw" | "unavailable" = "ok";
  outage: "none" | "before" | "after" = "none";
  commitOverride: "auto" | "explicit" | undefined;
  discoveryCalls = 0;
  disarmCalls = 0;
  discoveryChildren: readonly unknown[] | undefined;
  discoveryMode: "malformed" | "misbound" | "ok" | "outage" | "throw" = "ok";

  constructor(
    serverIdentity: ServerIdentity,
    slotValue = slot("available", undefined, holder),
  ) {
    this.#identity = serverIdentity;
    this.slot = slotValue;
    this.root = makeRootProjection(run());
  }

  disarm(): void {
    this.disarmCalls += 1;
  }

  async probe(_expectedIdentity: ServerIdentity) {
    return {
      status: "ok" as const,
      value: {
        autoCommitPolicy: this.#identity.autoCommitPolicy,
        credentialReference: this.#identity.credentialReference,
        database: this.#identity.database,
        endpoint: this.#identity.endpoint,
        schema: this.#identity.schema,
        workerGrant: {
          credentialReference: this.#identity.workerCredentialReference,
          serverEnforced: true,
          writeDenied: this.readOnly,
        },
      },
    };
  }

  async mergeSlotAcquire(input: {
    actor: string;
    prefix: string;
    scope: FencingScope;
  }) {
    this.slotAcquireCalls += 1;
    if (this.slotAcquireMode === "throw") throw new Error("acquire failed");
    if (this.slotAcquireMode === "unavailable")
      return { status: "unavailable" as const };
    if (this.slotAcquireMode === "malformed")
      return { status: "ok" as const, value: {} as never };
    if (this.slot === undefined) return { status: "refused" as const };
    if (
      input.prefix !== "sce" ||
      deriveScopeCommitment(input.scope) !== this.slot.scopeCommitment
    )
      return { status: "refused" as const };
    if (this.slot.status === "available") {
      this.slot = slot("acquired", input.actor, input.actor);
      this.slotTransitions += 1;
    }
    return {
      status: "ok" as const,
      value: {
        observation: this.slot,
        scopeReference: slotScopeReference(input.scope),
      },
    };
  }

  async mergeSlotCheck(input: {
    actor?: string;
    prefix: string;
    scope: FencingScope;
  }) {
    this.slotCheckCalls += 1;
    this.lastSlotCheckActor = input.actor;
    if (this.slotCheckMode === "throw") throw new Error("check failed");
    if (this.slotCheckMode === "unavailable")
      return { status: "unavailable" as const };
    if (this.slotCheckMode === "malformed")
      return { status: "ok" as const, value: {} as never };
    if (
      this.slot === undefined ||
      input.prefix !== "sce" ||
      deriveScopeCommitment(input.scope) !== this.slot.scopeCommitment
    )
      return { status: "refused" as const };
    const observation =
      this.slot.status === "available"
        ? slot("available", undefined, input.actor ?? "slot-observer/0")
        : this.slot;
    const afterSlotCheck = this.afterSlotCheck;
    this.afterSlotCheck = undefined;
    afterSlotCheck?.();
    return {
      status: "ok" as const,
      value: {
        observation,
        scopeReference: slotScopeReference(input.scope),
      },
    };
  }

  async mergeSlotRelease(input: {
    actor: string;
    prefix: string;
    scope: FencingScope;
  }) {
    if (
      this.slot === undefined ||
      input.prefix !== "sce" ||
      this.slot.holder !== input.actor ||
      deriveScopeCommitment(input.scope) !== this.slot.scopeCommitment
    )
      return { status: "refused" as const };
    this.slot = slot("available", undefined, input.actor);
    return {
      status: "ok" as const,
      value: {
        observation: this.slot,
        scopeReference: slotScopeReference(input.scope),
      },
    };
  }

  async mutate(input: { batch: MutationBatch; identity: ServerIdentity }) {
    this.mutationCalls += 1;
    if (this.outage === "before")
      return {
        phase: "before_transaction" as const,
        status: "unavailable" as const,
      };
    const { batch: value } = input;
    if (
      input.identity.endpoint !== this.#identity.endpoint ||
      this.slot?.holder !== value.expectedHolder ||
      this.root.aggregateRevision !== value.expectedAggregateRevision ||
      this.root.aggregateCommitment !== value.expectedAggregateCommitment
    )
      return {
        status: "ok" as const,
        value: { commit: this.commit(), result: { status: "stale" as const } },
      };
    for (const expected of value.expectedChildren) {
      const actual = this.root.childRows.find(
        (row) => row.unitId === expected.unitId,
      );
      if (
        actual?.revision !== expected.expectedRevision ||
        actual.commitment !== expected.expectedCommitment
      )
        return {
          status: "ok" as const,
          value: {
            commit: this.commit(),
            result: { status: "stale" as const },
          },
        };
    }
    this.root = value.next.root;
    if (this.outage === "after")
      return {
        phase: "commit_unknown" as const,
        status: "unavailable" as const,
      };
    return {
      status: "ok" as const,
      value: {
        commit: this.commit(),
        result: {
          affectedRowCount: 1 + value.changedRows.length,
          checkpoint: value.checkpoint,
          children: value.next.children,
          root: value.next.root,
          status: "applied" as const,
        },
      },
    };
  }

  async discover(): Promise<
    ServerDriverResponse<{
      checkpoint: unknown;
      children: readonly unknown[];
      root: unknown;
      slot: unknown;
    }>
  > {
    this.discoveryCalls += 1;
    if (this.discoveryMode === "throw") throw new Error("fixture outage");
    if (this.discoveryMode === "outage") return { status: "unavailable" };
    if (this.discoveryMode === "misbound") return { status: "refused" };
    if (this.discoveryMode === "malformed")
      return {
        status: "ok",
        value: {},
      } as ServerDriverResponse<{
        checkpoint: unknown;
        children: readonly unknown[];
        root: unknown;
        slot: unknown;
      }>;
    return {
      status: "ok",
      value: {
        checkpoint: this.root.checkpoint,
        children:
          this.discoveryChildren ??
          Object.keys(this.root.run.units)
            .map((unitId) => makeChildProjection(this.root, unitId))
            .filter((child) => child !== undefined),
        root: this.root,
        slot: this.slot ?? slot("available", undefined, holder),
      },
    };
  }

  moveUnrelatedRow(): void {
    this.unrelatedRevision += 1;
  }

  commit() {
    return {
      autoCommitPolicy: this.#identity.autoCommitPolicy,
      commit:
        this.commitOverride ??
        (this.#identity.autoCommitPolicy === "on" ? "auto" : "explicit"),
      head: "a".repeat(40),
      workingSet: "clean" as const,
    };
  }
}

type ConcreteProbeFault =
  | "context"
  | "discovery_version"
  | "error"
  | "grants"
  | "identity"
  | "malformed"
  | "schema"
  | "swapped_database"
  | "swapped_endpoint"
  | "version"
  | "worker"
  | "writer_principal"
  | "workspace";

/**
 * A complete in-memory protocol fixture for concrete-driver readiness gates.
 * It intentionally never supports transaction execution: these tests prove
 * rejected preflight/invalid input reaches no SQL or bd command at all.
 */
function concreteReadinessHarness(fault?: ConcreteProbeFault) {
  const driverIdentity = identity();
  const adapterIdentity =
    fault === "identity" ? identity("on", "127.0.0.1:3307") : driverIdentity;
  const transportIdentity =
    fault === "swapped_endpoint"
      ? identity("on", "127.0.0.1:3307")
      : fault === "swapped_database"
        ? { ...driverIdentity, database: "other" }
        : driverIdentity;
  const calls = {
    bd: 0,
    bdArgv: [] as string[][],
    worker: 0,
    writer: 0,
    writerQueries: [] as string[],
  };
  const discoveryRoot = makeRootProjection(run());
  const discoveryChild = makeChildProjection(discoveryRoot, "unit-1");
  assert.ok(discoveryChild);
  const issueColumns = [
    ["id", "varchar"],
    ["status", "varchar"],
    ["metadata", "json"],
    ["external_ref", "varchar"],
    ["title", "varchar"],
    ["design", "longtext"],
  ].map(([column_name, data_type]) => ({ column_name, data_type }));
  const labelColumns = [
    ["issue_id", "varchar"],
    ["label", "varchar"],
  ].map(([column_name, data_type]) => ({ column_name, data_type }));
  const writer = new DoltSqlTransport({
    identity: transportIdentity,
    process: async (request) => {
      calls.writer += 1;
      if (request.argv[0] === "version")
        return {
          exitCode: 0,
          output: "dolt version 2.2.1\n",
          timedOut: false,
        };
      const query = request.argv.at(request.argv.indexOf("-q") + 1) ?? "";
      calls.writerQueries.push(query);
      if (
        fault === "error" &&
        query === "SELECT DATABASE() AS current_database"
      )
        throw new Error("fixture transport error");
      if (
        fault === "malformed" &&
        query === "SELECT DATABASE() AS current_database"
      )
        return { exitCode: 0, output: "{", timedOut: false };
      if (query === "SELECT DATABASE() AS current_database")
        return {
          exitCode: 0,
          output: '[{"current_database":"sce"}]',
          timedOut: false,
        };
      if (query === "SELECT DOLT_VERSION() AS dolt_version")
        return {
          exitCode: 0,
          output: JSON.stringify([
            {
              dolt_version:
                fault === "version" || fault === "discovery_version"
                  ? "2.2.2"
                  : "2.2.1",
            },
          ]),
          timedOut: false,
        };
      if (query === "SELECT CURRENT_USER() AS current_principal")
        return {
          exitCode: 0,
          output:
            fault === "writer_principal"
              ? '[{"current_principal":"other@%"}]'
              : '[{"current_principal":"writer@%"}]',
          timedOut: false,
        };
      if (
        query.startsWith("SELECT status, metadata, external_ref, title, design")
      )
        return {
          exitCode: 0,
          output: JSON.stringify([
            {
              design: canonicalJson(scope as JsonValue),
              external_ref: slotScopeReference(scope),
              metadata: "{}",
              status: "open",
              title: "Merge Slot",
            },
          ]),
          timedOut: false,
        };
      if (query.startsWith("SELECT label FROM `sce`.labels"))
        return {
          exitCode: 0,
          output: '[{"label":"gt:slot"}]',
          timedOut: false,
        };
      if (
        query.startsWith("SELECT id, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$'))")
      )
        return {
          exitCode: 0,
          output: JSON.stringify([
            {
              id: "sce-child",
              metadata: JSON.stringify({ sce: discoveryChild }),
            },
            {
              id: "sce-root",
              metadata: JSON.stringify({ sce: discoveryRoot }),
            },
          ]),
          timedOut: false,
        };
      if (query.includes("information_schema.tables"))
        return {
          exitCode: 0,
          output:
            fault === "schema" && query.includes("table_name = 'labels'")
              ? "[]"
              : query.includes("table_name = 'issues'")
                ? '[{"table_name":"issues"}]'
                : '[{"table_name":"labels"}]',
          timedOut: false,
        };
      if (query.includes("information_schema.columns"))
        return {
          exitCode: 0,
          output: JSON.stringify(
            query.includes("table_name = 'issues'")
              ? issueColumns
              : labelColumns,
          ),
          timedOut: false,
        };
      if (query === "SELECT @@autocommit AS auto_commit")
        return {
          exitCode: 0,
          output: '[{"auto_commit":"1"}]',
          timedOut: false,
        };
      if (query.startsWith("SET @@SESSION.dolt_transaction_commit"))
        return {
          exitCode: 0,
          output: '[{"dolt_transaction_commit":"1"}]',
          timedOut: false,
        };
      if (query === "SELECT * FROM dolt_status")
        return { exitCode: 0, output: "[]", timedOut: false };
      if (query === "SELECT DOLT_HASHOF('HEAD') AS head")
        return {
          exitCode: 0,
          output: '[{"head":"c96vvi04oug557a1fk7tcjm7ok5sqmiu"}]',
          timedOut: false,
        };
      if (query === "SHOW GRANTS FOR 'worker'@'%'")
        return {
          exitCode: 0,
          output: JSON.stringify(
            fault === "grants"
              ? [
                  {
                    "Grants for worker@%":
                      "GRANT UPDATE ON `sce`.* TO `worker`@`%`",
                  },
                ]
              : [
                  {
                    "Grants for worker@%": "GRANT USAGE ON *.* TO `worker`@`%`",
                  },
                  {
                    "Grants for worker@%":
                      "GRANT SELECT ON `sce`.* TO `worker`@`%`",
                  },
                ],
          ),
          timedOut: false,
        };
      throw new Error(`unexpected readiness writer query: ${query}`);
    },
    user: "writer",
  });
  const worker = new DoltSqlTransport({
    identity: transportIdentity,
    process: async (request) => {
      calls.worker += 1;
      if (request.argv[0] === "version")
        return {
          exitCode: 0,
          output: "dolt version 2.2.1\n",
          timedOut: false,
        };
      const query = request.argv.at(request.argv.indexOf("-q") + 1) ?? "";
      if (query.startsWith("SELECT id FROM `sce`.issues"))
        return fault === "worker"
          ? { exitCode: 1, output: "worker unavailable", timedOut: false }
          : { exitCode: 0, output: '[{"id":"sce-root"}]', timedOut: false };
      if (query === "SELECT CURRENT_USER() AS current_principal")
        return {
          exitCode: 0,
          output: '[{"current_principal":"worker@%"}]',
          timedOut: false,
        };
      const noOp = "UPDATE `sce`.issues SET status = status WHERE 1 = 0";
      if (query === noOp)
        return {
          exitCode: 1,
          output: `error on line 1 for query ${noOp}: Error 1105 (HY000): command denied to user 'worker'@'%'`,
          timedOut: false,
        };
      throw new Error(`unexpected readiness worker query: ${query}`);
    },
    user: "worker",
  });
  const slotProcess = new PinnedBdServerProcess({
    executable: "/fixture/bd",
    identity: driverIdentity,
    process: async (request) => {
      calls.bd += 1;
      calls.bdArgv.push([...request.argv]);
      if (request.argv[0] === "version")
        return { exitCode: 0, output: "bd version 1.1.0\n", timedOut: false };
      if (request.argv.includes("context"))
        return {
          exitCode: 0,
          output: JSON.stringify({
            backend: "dolt",
            beads_dir:
              fault === "workspace"
                ? "/fixture/other/.beads"
                : "/fixture/workspace/.beads",
            database: fault === "context" ? "wrong" : "sce",
            dolt_mode: "server",
            server_host: "127.0.0.1",
            server_port: 3306,
          }),
          timedOut: false,
        };
      throw new Error(
        `unexpected readiness bd command: ${request.argv.join(" ")}`,
      );
    },
    runtimeEnvironment: () => ({
      HOME: "/fixture/home",
      XDG_CONFIG_HOME: "/fixture/config",
    }),
    workspace: "/fixture/workspace",
  });
  const driver = new DoltBeadsServerDriver({
    identity: driverIdentity,
    rows: { childBeadIds: { "unit-1": "sce-child" }, rootBeadId: "sce-root" },
    slotProcess,
    worker,
    writer,
  });
  return {
    adapter: new BeadsServerAdapter({
      driver,
      identity: adapterIdentity,
      process: fakeManagedProcess,
    }),
    calls,
    driver,
    identity: driverIdentity,
  };
}

test("concrete driver stays disarmed after every rejected preflight gate", async () => {
  for (const fault of [
    "schema",
    "identity",
    "context",
    "worker",
    "grants",
    "version",
    "malformed",
    "error",
  ] as const) {
    const harness = concreteReadinessHarness(fault);
    const preflight = await harness.adapter.preflight();
    assert.notEqual(preflight.status, "ready", fault);
    const before = { ...harness.calls };
    assert.deepEqual(
      await harness.driver.mergeSlotAcquire({
        actor: holder,
        prefix: "sce",
        scope,
      }),
      { status: "refused" },
      `${fault}: acquire`,
    );
    assert.deepEqual(
      await harness.driver.mergeSlotCheck({
        actor: holder,
        prefix: "sce",
        scope,
      }),
      { status: "refused" },
      `${fault}: check`,
    );
    assert.deepEqual(
      await harness.driver.mergeSlotRelease({
        actor: holder,
        prefix: "sce",
        scope,
      }),
      { status: "refused" },
      `${fault}: release`,
    );
    assert.deepEqual(
      await harness.driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: makeRootProjection(run()),
        issueId: "sce-root",
      }),
      { status: "refused" },
      `${fault}: initialization`,
    );
    assert.deepEqual(
      await harness.driver.mutate({
        batch: batch(),
        identity: harness.identity,
      }),
      { phase: "before_transaction", status: "refused" },
      `${fault}: mutation`,
    );
    assert.deepEqual(harness.calls, before, `${fault}: zero retained calls`);
  }
});

test("unprobed concrete discovery live-binds before authoritative rows", async () => {
  for (const fault of [
    "swapped_endpoint",
    "swapped_database",
    "workspace",
    "discovery_version",
    "writer_principal",
  ] as const) {
    const harness = concreteReadinessHarness(fault);
    const result = await harness.driver.discover({
      identity: harness.identity,
      prefix: "sce",
      scope,
    });
    assert.deepEqual(result, { status: "refused" }, fault);
    // The identity proof can use its closed version/context/database reads,
    // but no slot or SCE metadata row is authoritative on a bad binding.
    assert.equal(
      harness.calls.writerQueries.some(
        (query) =>
          query.startsWith("SELECT status, metadata") ||
          query.startsWith("SELECT id, JSON_UNQUOTE"),
      ),
      false,
      `${fault}: no discovery rows`,
    );
    assert.equal(
      harness.calls.bdArgv.some((argv) => argv.includes("merge-slot")),
      false,
      `${fault}: no bd mutation`,
    );
    const before = {
      bd: harness.calls.bd,
      worker: harness.calls.worker,
      writer: harness.calls.writer,
    };
    assert.deepEqual(
      await harness.driver.mergeSlotAcquire({
        actor: holder,
        prefix: "sce",
        scope,
      }),
      { status: "refused" },
      `${fault}: discovery never arms readiness`,
    );
    assert.equal(harness.calls.bd, before.bd, `${fault}: no bd command`);
    assert.equal(
      harness.calls.worker,
      before.worker,
      `${fault}: no worker command`,
    );
    assert.equal(
      harness.calls.writer,
      before.writer,
      `${fault}: no writer command`,
    );
  }

  const wrongPrefix = concreteReadinessHarness();
  assert.deepEqual(
    await wrongPrefix.driver.discover({
      identity: wrongPrefix.identity,
      prefix: "wrong",
      scope,
    }),
    { status: "refused" },
  );
  assert.equal(
    wrongPrefix.calls.writerQueries.some((query) =>
      query.startsWith("SELECT status, metadata"),
    ),
    false,
    "wrong prefix reaches no slot row",
  );
  assert.equal(
    wrongPrefix.calls.bdArgv.some((argv) => argv.includes("merge-slot")),
    false,
  );
  assert.equal(wrongPrefix.calls.bd, 0, "wrong prefix has no bd command");
  assert.equal(
    wrongPrefix.calls.writer,
    0,
    "wrong prefix has no writer command",
  );
  assert.equal(
    wrongPrefix.calls.worker,
    0,
    "wrong prefix has no worker command",
  );

  // A direct, never-probed driver can reconcile after a mutation fault only
  // when its fresh live proof succeeds. That read does not arm a mutation.
  const valid = concreteReadinessHarness();
  const discovered = await valid.driver.discover({
    identity: valid.identity,
    prefix: "sce",
    scope,
  });
  assert.equal(discovered.status, "ok");
  const before = {
    bd: valid.calls.bd,
    worker: valid.calls.worker,
    writer: valid.calls.writer,
  };
  assert.deepEqual(
    await valid.driver.mergeSlotCheck({ actor: holder, prefix: "sce", scope }),
    { status: "refused" },
  );
  assert.equal(valid.calls.bd, before.bd);
  assert.equal(valid.calls.worker, before.worker);
  assert.equal(valid.calls.writer, before.writer);
});

test("adapter revokes a driver that returns malformed, mismatched, or throws", async () => {
  for (const mode of ["malformed", "mismatched", "error"] as const) {
    let armed = false;
    let mutationCommands = 0;
    const response = {
      autoCommitPolicy: "on" as const,
      credentialReference: "managed-writer-v1",
      database: "sce",
      endpoint: mode === "mismatched" ? "127.0.0.1:3307" : "127.0.0.1:3306",
      schema: "beads",
      workerGrant: {
        credentialReference: "managed-worker-ro-v1",
        serverEnforced: true,
        writeDenied: true,
      },
    };
    const driver: BeadsServerDriver = {
      disarm: () => {
        armed = false;
      },
      discover: async () => ({ status: "refused" }),
      mergeSlotAcquire: async () => {
        if (armed) mutationCommands += 1;
        return { status: "refused" };
      },
      mergeSlotCheck: async () => {
        if (armed) mutationCommands += 1;
        return { status: "refused" };
      },
      mergeSlotRelease: async () => {
        if (armed) mutationCommands += 1;
        return { status: "refused" };
      },
      mutate: async () => {
        if (armed) mutationCommands += 1;
        return { phase: "before_transaction", status: "refused" };
      },
      probe: async () => {
        armed = true;
        if (mode === "error") throw new Error("probe error");
        return {
          status: "ok",
          value: mode === "malformed" ? {} : response,
        } as ServerDriverResponse<never>;
      },
    };
    const adapter = new BeadsServerAdapter({
      driver,
      identity: identity(),
      process: fakeManagedProcess,
    });
    assert.notEqual((await adapter.preflight()).status, "ready", mode);
    assert.deepEqual(
      await driver.mergeSlotCheck({ actor: holder, prefix: "sce", scope }),
      { status: "refused" },
      mode,
    );
    assert.deepEqual(
      await driver.mutate({ batch: batch(), identity: identity() }),
      { phase: "before_transaction", status: "refused" },
      mode,
    );
    assert.equal(mutationCommands, 0, mode);
  }

  let disposedArmed = false;
  const disposable: BeadsServerDriver = {
    disarm: () => {
      disposedArmed = false;
    },
    discover: async () => ({ status: "refused" }),
    mergeSlotAcquire: async () => ({ status: "refused" }),
    mergeSlotCheck: async () => ({ status: "refused" }),
    mergeSlotRelease: async () => ({ status: "refused" }),
    mutate: async () => ({ phase: "before_transaction", status: "refused" }),
    probe: async () => {
      disposedArmed = true;
      return {
        status: "ok",
        value: {
          autoCommitPolicy: "on",
          credentialReference: "managed-writer-v1",
          database: "sce",
          endpoint: "127.0.0.1:3306",
          schema: "beads",
          workerGrant: {
            credentialReference: "managed-worker-ro-v1",
            serverEnforced: true,
            writeDenied: true,
          },
        },
      };
    },
  };
  const adapter = new BeadsServerAdapter({
    driver: disposable,
    identity: identity(),
    process: fakeManagedProcess,
  });
  assert.equal((await adapter.preflight()).status, "ready");
  assert.equal(disposedArmed, true);
  await adapter.dispose();
  assert.equal(disposedArmed, false);
});

test("direct concrete mutation normalizes the complete batch before any command", async () => {
  const malformed = (change: (value: Record<string, unknown>) => void) => {
    const value = structuredClone(batch()) as unknown as Record<
      string,
      unknown
    >;
    change(value);
    return value as MutationBatch;
  };
  const invalidBatches: readonly [string, MutationBatch][] = [
    ["extra field", malformed((value) => (value.extra = true))],
    ["holder", malformed((value) => (value.holder = "invalid holder"))],
    [
      "scope",
      malformed((value) => {
        value.scope = { ...scope, unexpected: true };
      }),
    ],
    [
      "root envelope",
      malformed((value) => {
        const next = value.next as Record<string, unknown>;
        next.root = {
          ...(next.root as Record<string, unknown>),
          aggregateRevision: -1,
        };
      }),
    ],
    [
      "children",
      malformed((value) => {
        (value.next as Record<string, unknown>).children = [];
      }),
    ],
    [
      "child envelope",
      malformed((value) => {
        const next = value.next as Record<string, unknown>;
        const children = structuredClone(next.children) as Record<
          string,
          unknown
        >[];
        children[0]!.holder = "invalid holder";
        next.children = children;
      }),
    ],
  ];
  for (const [name, invalid] of invalidBatches) {
    const harness = concreteReadinessHarness();
    assert.equal(
      (await harness.driver.probe(harness.identity)).status,
      "ok",
      name,
    );
    const before = { ...harness.calls };
    assert.deepEqual(
      await harness.driver.mutate({
        batch: invalid,
        identity: harness.identity,
      }),
      { phase: "before_transaction", status: "refused" },
      name,
    );
    // Invalid input disarms rather than leaving the previous successful probe
    // available for a later caller-supplied payload.
    assert.deepEqual(
      await harness.driver.mutate({
        batch: batch(),
        identity: harness.identity,
      }),
      { phase: "before_transaction", status: "refused" },
      `${name}: remains disarmed`,
    );
    assert.deepEqual(harness.calls, before, `${name}: zero transport/bd calls`);
  }
});

test("fresh concrete slot calls reject a wrong prefix before every command", async () => {
  for (const operation of ["acquire", "check", "release"] as const) {
    const harness = concreteReadinessHarness();
    assert.equal(
      (await harness.driver.probe(harness.identity)).status,
      "ok",
      operation,
    );
    const before = { ...harness.calls };
    const result =
      operation === "acquire"
        ? await harness.driver.mergeSlotAcquire({
            actor: holder,
            prefix: "wrong",
            scope,
          })
        : operation === "check"
          ? await harness.driver.mergeSlotCheck({
              actor: holder,
              prefix: "wrong",
              scope,
            })
          : await harness.driver.mergeSlotRelease({
              actor: holder,
              prefix: "wrong",
              scope,
            });
    assert.deepEqual(result, { status: "refused" }, operation);
    assert.deepEqual(harness.calls, before, `${operation}: zero commands`);
    assert.deepEqual(
      await harness.driver.mutate({
        batch: batch(),
        identity: harness.identity,
      }),
      { phase: "before_transaction", status: "refused" },
      `${operation}: wrong prefix disarms fresh instance`,
    );
    assert.deepEqual(harness.calls, before, `${operation}: zero movement`);
  }
});

test("concrete public driver boundaries are total over malformed runtime inputs", async () => {
  const cyclic = () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    return value;
  };
  const accessor = () => {
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, "identity", {
      enumerable: true,
      get: () => {
        throw new Error("accessor must not run");
      },
    });
    return value;
  };
  const proxy = () =>
    new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("proxy trap must not escape");
        },
      },
    );
  const slot = { actor: holder, prefix: "sce", scope };
  const initialization = {
    authority: "authorized_initialization" as const,
    envelope: makeRootProjection(run()),
    issueId: "sce-root",
  };
  const mutation = (serverIdentity: ServerIdentity) => ({
    batch: batch(),
    identity: serverIdentity,
  });
  const refused = { status: "refused" };
  const mutationRefused = { phase: "before_transaction", status: "refused" };

  // Unready instances reject malformed values without trying to normalize
  // them through a server operation.
  const unready = concreteReadinessHarness();
  const unreadyBefore = { ...unready.calls };
  let unreadyResult: unknown;
  await assert.doesNotReject(async () => {
    unreadyResult = await unready.driver.probe(cyclic() as ServerIdentity);
  });
  assert.deepEqual(unreadyResult, refused);
  await assert.doesNotReject(async () => {
    unreadyResult = await unready.driver.discover(cyclic() as never);
  });
  assert.deepEqual(unreadyResult, refused);
  await assert.doesNotReject(async () => {
    unreadyResult = await unready.driver.mergeSlotAcquire(cyclic() as never);
  });
  assert.deepEqual(unreadyResult, refused);
  await assert.doesNotReject(async () => {
    unreadyResult = await unready.driver.initializeEnvelope(cyclic() as never);
  });
  assert.deepEqual(unreadyResult, refused);
  await assert.doesNotReject(async () => {
    unreadyResult = await unready.driver.mutate(cyclic() as never);
  });
  assert.deepEqual(unreadyResult, mutationRefused);
  assert.deepEqual(unready.calls, unreadyBefore);

  const cases: readonly {
    expected: unknown;
    invoke: (
      driver: DoltBeadsServerDriver,
      serverIdentity: ServerIdentity,
    ) => Promise<unknown>;
    name: string;
  }[] = [
    {
      expected: refused,
      invoke: (driver) => driver.probe(cyclic() as ServerIdentity),
      name: "probe cyclic identity",
    },
    {
      expected: refused,
      invoke: (driver) => driver.probe(1n as unknown as ServerIdentity),
      name: "probe bigint identity",
    },
    {
      expected: refused,
      invoke: (driver) => driver.probe(accessor() as ServerIdentity),
      name: "probe accessor identity",
    },
    {
      expected: refused,
      invoke: (driver) => driver.probe(proxy() as ServerIdentity),
      name: "probe proxy identity",
    },
    {
      expected: refused,
      invoke: (driver, serverIdentity) =>
        driver.probe({ ...serverIdentity, unexpected: true } as ServerIdentity),
      name: "probe extra identity field",
    },
    {
      expected: refused,
      invoke: (driver) => driver.probe({} as ServerIdentity),
      name: "probe missing identity fields",
    },
    {
      expected: refused,
      invoke: (driver, serverIdentity) =>
        driver.discover({
          identity: cyclic() as ServerIdentity,
          prefix: "sce",
          scope,
        }),
      name: "discover cyclic identity",
    },
    {
      expected: refused,
      invoke: (driver, serverIdentity) =>
        driver.discover({
          identity: serverIdentity,
          prefix: 1n as unknown as string,
          scope,
        }),
      name: "discover bigint prefix",
    },
    {
      expected: refused,
      invoke: (driver, serverIdentity) =>
        driver.discover({
          identity: serverIdentity,
          prefix: "sce",
          scope: proxy() as FencingScope,
        }),
      name: "discover proxy scope",
    },
    {
      expected: refused,
      invoke: (driver) => driver.discover(accessor() as never),
      name: "discover accessor input",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.discover({ identity: identity(), prefix: "sce" } as never),
      name: "discover missing scope",
    },
    {
      expected: refused,
      invoke: (driver, serverIdentity) =>
        driver.discover({
          identity: serverIdentity,
          prefix: "sce",
          scope,
          unexpected: true,
        } as never),
      name: "discover extra field",
    },
    {
      expected: refused,
      invoke: (driver, serverIdentity) =>
        driver.mergeSlotAcquire({ ...slot, scope: cyclic() as FencingScope }),
      name: "slot acquire cyclic scope",
    },
    {
      expected: refused,
      invoke: (driver) => driver.mergeSlotCheck(proxy() as never),
      name: "slot check proxy input",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.mergeSlotRelease({ ...slot, actor: 1n as unknown as string }),
      name: "slot release bigint actor",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.mergeSlotAcquire({ ...slot, unexpected: true } as never),
      name: "slot extra field",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.mergeSlotAcquire({ prefix: "sce", scope } as never),
      name: "slot missing actor",
    },
    {
      expected: refused,
      invoke: (driver) => driver.initializeEnvelope(accessor() as never),
      name: "initialization accessor input",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.initializeEnvelope({ ...initialization, envelope: cyclic() }),
      name: "initialization cyclic envelope",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.initializeEnvelope({ ...initialization, envelope: 1n }),
      name: "initialization bigint envelope",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.initializeEnvelope({ ...initialization, envelope: proxy() }),
      name: "initialization proxy envelope",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.initializeEnvelope({
          ...initialization,
          unexpected: true,
        } as never),
      name: "initialization extra field",
    },
    {
      expected: refused,
      invoke: (driver) =>
        driver.initializeEnvelope({
          authority: "authorized_initialization",
          issueId: "sce-root",
        } as never),
      name: "initialization missing envelope",
    },
    {
      expected: mutationRefused,
      invoke: (driver) => driver.mutate(accessor() as never),
      name: "mutation accessor input",
    },
    {
      expected: mutationRefused,
      invoke: (driver) =>
        driver.mutate({
          batch: cyclic() as MutationBatch,
          identity: identity(),
        }),
      name: "mutation cyclic batch",
    },
    {
      expected: mutationRefused,
      invoke: (driver) =>
        driver.mutate({
          batch: 1n as unknown as MutationBatch,
          identity: identity(),
        }),
      name: "mutation bigint batch",
    },
    {
      expected: mutationRefused,
      invoke: (driver) =>
        driver.mutate({
          batch: proxy() as MutationBatch,
          identity: identity(),
        }),
      name: "mutation proxy batch",
    },
    {
      expected: mutationRefused,
      invoke: (driver, serverIdentity) =>
        driver.mutate({ batch: batch(), identity: cyclic() as ServerIdentity }),
      name: "mutation cyclic identity",
    },
    {
      expected: mutationRefused,
      invoke: (driver, serverIdentity) =>
        driver.mutate({
          batch: batch(),
          identity: 1n as unknown as ServerIdentity,
        }),
      name: "mutation bigint identity",
    },
    {
      expected: mutationRefused,
      invoke: (driver, serverIdentity) =>
        driver.mutate({
          ...mutation(serverIdentity),
          unexpected: true,
        } as never),
      name: "mutation extra field",
    },
    {
      expected: mutationRefused,
      invoke: (driver) => driver.mutate({ identity: identity() } as never),
      name: "mutation missing batch",
    },
  ];

  for (const testCase of cases) {
    const harness = concreteReadinessHarness();
    assert.equal(
      (await harness.driver.probe(harness.identity)).status,
      "ok",
      testCase.name,
    );
    const before = { ...harness.calls };
    let result: unknown;
    await assert.doesNotReject(async () => {
      result = await testCase.invoke(harness.driver, harness.identity);
    }, testCase.name);
    assert.deepEqual(result, testCase.expected, testCase.name);
    assert.deepEqual(harness.calls, before, `${testCase.name}: zero commands`);
    assert.deepEqual(
      await harness.driver.mergeSlotCheck(slot),
      refused,
      `${testCase.name}: malformed call disarms`,
    );
    assert.deepEqual(harness.calls, before, `${testCase.name}: remains zero`);
  }
});

test("server identity binds only sanitized managed/external configuration provenance", () => {
  assert.equal(identity().endpoint, "127.0.0.1:3306");
  const external: BeadsIdentity = {
    beadsDir: "/repo/.beads",
    contextSchemaVersion: 1,
    database: "sce",
    mode: "external_server",
    prefix: "sce",
    provenance: "external_server_flag",
    server: "db.example.test:3306",
    toolVersion: "1.1.0",
  };
  assert.ok(
    deriveServerIdentity({
      autoCommitPolicy: "on",
      beads: external,
      credentialProvenance: "environment",
      credentialReference: "writer-v1",
      schema: "beads",
      transportSecurity: "tls",
      workerCredentialReference: "worker-ro-v1",
    }),
  );
  assert.ok(
    deriveServerIdentity({
      autoCommitPolicy: "on",
      beads: { ...external, server: "127.0.0.1:3306" },
      credentialProvenance: "environment",
      credentialReference: "writer-v1",
      schema: "beads",
      transportSecurity: "loopback_plaintext",
      workerCredentialReference: "worker-ro-v1",
    }),
  );
  assert.equal(
    deriveServerIdentity({
      autoCommitPolicy: "on",
      beads: external,
      credentialProvenance: "environment",
      credentialReference: "writer-v1",
      schema: "beads",
      transportSecurity: "loopback_plaintext",
      workerCredentialReference: "worker-ro-v1",
    }),
    undefined,
  );
  assert.equal(
    deriveServerIdentity({
      autoCommitPolicy: "on",
      beads: { ...external, server: "user:password@db.example.test" },
      credentialProvenance: "environment",
      credentialReference: "worker-ro-v1",
      schema: "beads",
      transportSecurity: "tls",
      workerCredentialReference: "worker-ro-v1",
    }),
    undefined,
  );
  assert.equal(
    deriveServerIdentity({
      autoCommitPolicy: "on",
      beads: external,
      credentialProvenance: "managed_local_runtime",
      credentialReference: "SECRET_CANARY",
      schema: "beads",
      transportSecurity: "loopback_plaintext",
      workerCredentialReference: "worker-ro-v1",
    }),
    undefined,
  );
});

test("concrete Dolt transport allows plaintext only for loopback endpoints", () => {
  assert.doesNotThrow(
    () =>
      new DoltSqlTransport({
        identity: identity(),
        process: async () => ({ exitCode: 0, output: "[]", timedOut: false }),
        user: "writer",
      }),
  );
  assert.doesNotThrow(
    () =>
      new DoltSqlTransport({
        identity: externalIdentity(),
        process: async () => ({ exitCode: 0, output: "[]", timedOut: false }),
        user: "writer",
      }),
  );
  assert.throws(
    () =>
      new DoltSqlTransport({
        identity: {
          ...externalIdentity(),
          endpoint: "db.example.test:3306",
        },
        user: "writer",
      }),
    /invalid/,
  );
});

test("exported Dolt transport reflection exposes no SQL operation", async () => {
  const directory = await mkdtemp("/private/tmp/sce-closed-read-");
  const outfile = join(directory, "must-not-exist");
  const transport = new DoltSqlTransport({
    identity: identity(),
    process: async () => ({ exitCode: 0, output: "[]", timedOut: false }),
    user: "writer",
  });
  const ownKeys = Reflect.ownKeys(transport).map((key) =>
    typeof key === "symbol" ? `symbol:${String(key)}` : `string:${key}`,
  );
  const prototype = Object.getPrototypeOf(transport) as object;
  const prototypeKeys = Reflect.ownKeys(prototype)
    .map((key) =>
      typeof key === "symbol" ? `symbol:${String(key)}` : `string:${key}`,
    )
    .sort();
  assert.deepEqual(ownKeys, []);
  assert.deepEqual(prototypeKeys, ["string:constructor"]);

  const callable = Reflect.ownKeys(prototype).filter(
    (key) =>
      key !== "constructor" &&
      typeof Object.getOwnPropertyDescriptor(prototype, key)?.value ===
        "function",
  );
  assert.deepEqual(callable, []);
  assert.equal(Reflect.get(transport, "query"), undefined);
  assert.equal(Reflect.get(transport, "SELECT 1 INTO OUTFILE ?"), undefined);
  await assert.rejects(stat(outfile));
  await removeFixtureDirectory(directory);
});

test("pinned bd slot process pins version, holder argv, bounded output, and secret handling", async () => {
  const secret = randomBytes(18).toString("hex");
  const requests: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  }[] = [];
  const successful = new PinnedBdServerProcess({
    credentialEnvironment: () => ({ BEADS_DOLT_PASSWORD: secret }),
    executable: "/fixture/bd",
    process: async (request) => {
      requests.push(request);
      return {
        exitCode: 0,
        output: request.argv[0] === "version" ? "bd version 1.1.0\n" : "{}",
        timedOut: false,
      };
    },
    workspace: "/fixture/workspace",
  });
  assert.deepEqual(await successful.acquire(holder), { status: "completed" });
  assert.deepEqual(requests[1]?.argv, [
    "-C",
    "/fixture/workspace",
    "--actor",
    holder,
    "--dolt-auto-commit",
    "on",
    "merge-slot",
    "acquire",
    "--holder",
    holder,
    "--json",
  ]);
  assert.equal(requests[1]?.env.BEADS_DOLT_PASSWORD, secret);
  assert.equal(requests[1]?.argv.includes(secret), false);
  assert.equal(
    JSON.stringify(await successful.check("observer")).includes(secret),
    false,
  );

  const wrongVersion = new PinnedBdServerProcess({
    executable: "/fixture/bd",
    process: async () => ({
      exitCode: 0,
      output: "bd version 1.2.0\n",
      timedOut: false,
    }),
    workspace: "/fixture/workspace",
  });
  assert.deepEqual(await wrongVersion.check("observer"), { status: "refused" });
  for (const [name, result] of [
    ["timeout", { exitCode: undefined, output: "", timedOut: true }],
    ["oversize", { exitCode: 0, output: "x".repeat(16_385), timedOut: false }],
  ] as const) {
    const process = new PinnedBdServerProcess({
      executable: "/fixture/bd",
      process: async (request) =>
        request.argv[0] === "version"
          ? { exitCode: 0, output: "bd version 1.1.0\n", timedOut: false }
          : result,
      workspace: "/fixture/workspace",
    });
    assert.deepEqual(
      await process.check("observer"),
      {
        status: "unavailable",
      },
      name,
    );
  }
  const malformed = new PinnedBdServerProcess({
    executable: "/fixture/bd",
    process: async (request) => ({
      exitCode: 0,
      output: request.argv[0] === "version" ? "bd version 1.1.0\n" : "[",
      timedOut: false,
    }),
    workspace: "/fixture/workspace",
  });
  assert.deepEqual(await malformed.release(holder), { status: "ambiguous" });

  const directory = await mkdtemp("/private/tmp/sce-pinned-bd-");
  const executable = join(directory, "bd");
  try {
    await symlink("/opt/homebrew/bin/bd", executable);
    const replacementAware = new PinnedBdServerProcess({
      executable,
      workspace: directory,
    });
    await replacementAware.check("observer");
    await unlink(executable);
    await symlink("/usr/bin/false", executable);
    assert.deepEqual(await replacementAware.check("observer"), {
      status: "refused",
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("pinned managed bd lifecycle adopts exact servers and starts only stopped identities", async () => {
  const directory = await mkdtemp("/private/tmp/sce-managed-process-");
  const workspace = join(directory, "workspace");
  const dataDirectory = join(directory, "shared-server", "dolt");
  let running = true;
  let starts = 0;
  try {
    await mkdir(workspace);
    await mkdir(join(directory, "shared-server"));
    await mkdir(dataDirectory);
    const process = new PinnedBdManagedServerProcess({
      dataDirectory,
      doltExecutable: "/opt/homebrew/bin/dolt",
      executable: "/fixture/bd",
      process: async (request) => {
        if (request.argv[0] === "version")
          return {
            exitCode: 0,
            output: request.executable.endsWith("dolt")
              ? "dolt version 2.2.1\n"
              : "bd version 1.1.0\n",
            timedOut: false,
          };
        if (request.argv.includes("status"))
          return {
            exitCode: 0,
            output: JSON.stringify(
              running
                ? {
                    data_dir: dataDirectory,
                    pid: 123,
                    port: 3308,
                    running: true,
                    schema_version: 1,
                  }
                : {
                    data_dir: "",
                    pid: 0,
                    port: 0,
                    running: false,
                    schema_version: 1,
                  },
            ),
            timedOut: false,
          };
        if (request.argv.includes("start")) {
          starts += 1;
          running = true;
        }
        return { exitCode: 0, output: "", timedOut: false };
      },
      runtimeEnvironment: () => ({
        HOME: directory,
        XDG_CONFIG_HOME: directory,
      }),
      workspace,
    });
    assert.deepEqual(await process.start(), { status: "ok", value: undefined });
    assert.equal(starts, 0);

    running = false;
    assert.deepEqual(await process.start(), { status: "ok", value: undefined });
    assert.equal(starts, 1);
    assert.deepEqual(await process.start(), { status: "ok", value: undefined });
    assert.equal(starts, 1);

    const ambiguous = new PinnedBdManagedServerProcess({
      dataDirectory,
      doltExecutable: "/opt/homebrew/bin/dolt",
      executable: "/fixture/bd",
      process: async (request) => ({
        exitCode: 0,
        output:
          request.argv[0] === "version"
            ? request.executable.endsWith("dolt")
              ? "dolt version 2.2.1\n"
              : "bd version 1.1.0\n"
            : "{}",
        timedOut: false,
      }),
      workspace,
    });
    assert.deepEqual(await ambiguous.start(), { status: "refused" });
  } finally {
    await removeFixtureDirectory(directory);
  }
});

test("immutable executable pins poison self-replacing read, slot, and lifecycle children", async () => {
  const directory = await mkdtemp("/private/tmp/sce-executable-pin-");
  const doltLink = join(directory, "dolt");
  const bdLink = join(directory, "bd");
  const workspace = join(directory, "workspace");
  const dataDirectory = join(directory, "shared-server", "dolt");
  const writeTrap = async (name: string, version: string) => {
    const marker = join(directory, `${name}.executed`);
    const executable = join(directory, name);
    await writeFile(
      executable,
      `#!/bin/sh\nprintf invoked > '${marker}'\nprintf '%s\\n' '${version}'\n`,
    );
    await chmod(executable, 0o700);
    return { executable, marker };
  };
  const pointLink = async (link: string, target: string) => {
    await unlink(link);
    await symlink(target, link);
  };
  try {
    await mkdir(workspace);
    await mkdir(join(directory, "shared-server"));
    await mkdir(dataDirectory);
    const doltTrap = await writeTrap("dolt-replacement", "dolt version 2.2.1");
    const bdTrap = await writeTrap("bd-replacement", "bd version 1.1.0");

    await symlink("/opt/homebrew/bin/dolt", doltLink);
    const queryCalls: readonly string[][] = [];
    const queryTransport = new DoltSqlTransport({
      executable: doltLink,
      identity: identity(),
      process: async (request) => {
        (queryCalls as string[][]).push([...request.argv]);
        if (request.argv[0] === "version") {
          await pointLink(doltLink, doltTrap.executable);
          return {
            exitCode: 0,
            output: "dolt version 2.2.1\n",
            timedOut: false,
          };
        }
        throw new Error("replacement reached Dolt query child");
      },
      user: "writer",
    });
    const queryWorker = new DoltSqlTransport({
      identity: identity(),
      process: async () => ({ exitCode: 0, output: "[]", timedOut: false }),
      user: "worker",
    });
    const querySlot = new PinnedBdServerProcess({
      executable: "/fixture/bd",
      identity: identity(),
      process: async (request) => {
        if (request.argv[0] === "version")
          return { exitCode: 0, output: "bd version 1.1.0\n", timedOut: false };
        if (request.argv.includes("context"))
          return {
            exitCode: 0,
            output: JSON.stringify({
              backend: "dolt",
              beads_dir: "/fixture/workspace/.beads",
              database: "sce",
              dolt_mode: "server",
              server_host: "127.0.0.1",
              server_port: 3306,
            }),
            timedOut: false,
          };
        throw new Error("unexpected query pin slot command");
      },
      runtimeEnvironment: () => ({
        HOME: "/fixture/home",
        XDG_CONFIG_HOME: "/fixture/config",
      }),
      workspace: "/fixture/workspace",
    });
    const queryDriver = new DoltBeadsServerDriver({
      identity: identity(),
      rows: { childBeadIds: { "unit-1": "sce-2" }, rootBeadId: "sce-1" },
      slotProcess: querySlot,
      worker: queryWorker,
      writer: queryTransport,
    });
    assert.deepEqual(await queryDriver.probe(identity()), {
      status: "refused",
    });
    assert.deepEqual(queryCalls, [["version"]]);
    await assert.rejects(stat(doltTrap.marker));
    assert.deepEqual(await queryDriver.probe(identity()), {
      status: "refused",
    });
    assert.deepEqual(queryCalls, [["version"]]);
    await assert.rejects(stat(doltTrap.marker));

    await symlink("/opt/homebrew/bin/bd", bdLink);
    const slotCalls: readonly string[][] = [];
    const slotProcess = new PinnedBdServerProcess({
      executable: bdLink,
      process: async (request) => {
        (slotCalls as string[][]).push([...request.argv]);
        if (request.argv[0] === "version") {
          await pointLink(bdLink, bdTrap.executable);
          return { exitCode: 0, output: "bd version 1.1.0\n", timedOut: false };
        }
        throw new Error("replacement reached bd slot child");
      },
      workspace,
    });
    assert.deepEqual(await slotProcess.check("observer"), {
      status: "refused",
    });
    assert.deepEqual(slotCalls, [["version"]]);
    await assert.rejects(stat(bdTrap.marker));
    assert.deepEqual(await slotProcess.check("observer"), {
      status: "refused",
    });
    assert.deepEqual(slotCalls, [["version"]]);
    await assert.rejects(stat(bdTrap.marker));

    // The digest is part of a pin rather than replacement-only detection: a
    // same-inode file whose first sampled byte changes is also permanently
    // refused before the fake slot child gets another invocation.
    const sameInode = join(directory, "same-inode-bd");
    await copyFile("/usr/bin/false", sameInode);
    await chmod(sameInode, 0o700);
    const sameInodeCalls: string[][] = [];
    const sameInodeProcess = new PinnedBdServerProcess({
      executable: sameInode,
      process: async (request) => {
        sameInodeCalls.push([...request.argv]);
        return {
          exitCode: 0,
          output: request.argv[0] === "version" ? "bd version 1.1.0\n" : "{}",
          timedOut: false,
        };
      },
      workspace,
    });
    assert.deepEqual(await sameInodeProcess.check("observer"), {
      status: "completed",
    });
    const beforeSameInode = await stat(sameInode);
    const handle = await open(sameInode, "r+");
    try {
      await handle.write(Buffer.from([0]), 0, 1, 0);
    } finally {
      await handle.close();
    }
    assert.equal((await stat(sameInode)).ino, beforeSameInode.ino);
    const callsBeforePoison = sameInodeCalls.length;
    assert.deepEqual(await sameInodeProcess.check("observer"), {
      status: "refused",
    });
    assert.equal(sameInodeCalls.length, callsBeforePoison);

    await pointLink(bdLink, "/opt/homebrew/bin/bd");
    await pointLink(doltLink, "/opt/homebrew/bin/dolt");
    const managerBdCalls: string[][] = [];
    const managerBd = new PinnedBdManagedServerProcess({
      dataDirectory,
      doltExecutable: doltLink,
      executable: bdLink,
      process: async (request) => {
        managerBdCalls.push([...request.argv]);
        if (request.argv[0] === "version") {
          await pointLink(bdLink, bdTrap.executable);
          return { exitCode: 0, output: "bd version 1.1.0\n", timedOut: false };
        }
        throw new Error("replacement reached managed bd child");
      },
      runtimeEnvironment: () => ({
        HOME: directory,
        XDG_CONFIG_HOME: directory,
      }),
      workspace,
    });
    assert.deepEqual(await managerBd.start(), { status: "refused" });
    assert.deepEqual(managerBdCalls, [["version"]]);
    await assert.rejects(stat(bdTrap.marker));
    assert.deepEqual(await managerBd.start(), { status: "refused" });
    assert.deepEqual(managerBdCalls, [["version"]]);

    await pointLink(bdLink, "/opt/homebrew/bin/bd");
    await pointLink(doltLink, "/opt/homebrew/bin/dolt");
    const managerDoltCalls: string[][] = [];
    const managerDolt = new PinnedBdManagedServerProcess({
      dataDirectory,
      doltExecutable: doltLink,
      executable: bdLink,
      process: async (request) => {
        managerDoltCalls.push([...request.argv]);
        if (request.argv[0] !== "version")
          throw new Error("replacement reached managed status/start child");
        if (managerDoltCalls.length === 2)
          await pointLink(doltLink, doltTrap.executable);
        return {
          exitCode: 0,
          output:
            managerDoltCalls.length === 1
              ? "bd version 1.1.0\n"
              : "dolt version 2.2.1\n",
          timedOut: false,
        };
      },
      runtimeEnvironment: () => ({
        HOME: directory,
        XDG_CONFIG_HOME: directory,
      }),
      workspace,
    });
    assert.deepEqual(await managerDolt.start(), { status: "refused" });
    assert.deepEqual(managerDoltCalls, [["version"], ["version"]]);
    await assert.rejects(stat(doltTrap.marker));
    assert.deepEqual(await managerDolt.start(), { status: "refused" });
    assert.deepEqual(managerDoltCalls, [["version"], ["version"]]);
  } finally {
    await removeFixtureDirectory(directory);
  }
});

test("schema-bound adapter refuses a replaced Dolt before CAS transaction dispatch", async () => {
  const fixture = await startBdDoltServer();
  const serverIdentity = externalIdentity("on", fixture.endpoint);
  const clientDirectory = await mkdtemp("/private/tmp/sce-adapter-pin-");
  const clientExecutable = join(clientDirectory, "dolt");
  const rootId = "sce-pin-root";
  const childId = "sce-pin-child";
  try {
    await symlink(fixture.executable, clientExecutable);
    const writer = new DoltSqlTransport({
      executable: clientExecutable,
      identity: serverIdentity,
      password: fixture.writerPassword,
      user: "writer",
    });
    const driver = new DoltBeadsServerDriver({
      identity: serverIdentity,
      rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
      slotProcess: new PinnedBdServerProcess({
        credentialEnvironment: () => ({
          BEADS_DOLT_PASSWORD: fixture.writerPassword,
        }),
        executable: fixture.bdExecutable,
        identity: serverIdentity,
        workspace: fixture.workspace,
      }),
      worker: fixture.worker,
      writer,
    });
    const adapter = new BeadsServerAdapter({
      driver,
      identity: serverIdentity,
    });
    for (const [id, title] of [
      [rootId, "Pinned root"],
      [childId, "Pinned child"],
    ] as const) {
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "fixture",
          "--dolt-auto-commit",
          "on",
          "create",
          title,
          "--id",
          id,
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          password: fixture.writerPassword,
        },
      );
    }
    assert.deepEqual(await adapter.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    assert.equal(
      (await adapter.acquire({ holder, prefix: "sce", scope })).status,
      "acquired",
    );
    const initialRoot = makeRootProjection(run());
    const initialChild = makeChildProjection(initialRoot, "unit-1");
    assert.ok(initialChild);
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialRoot,
        issueId: rootId,
      }),
      { status: "initialized" },
    );
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialChild,
        issueId: childId,
      }),
      { status: "initialized" },
    );
    const beforeHead = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    const marker = join(clientDirectory, "replacement.executed");
    const replacement = join(clientDirectory, "replacement");
    await writeFile(
      replacement,
      `#!/bin/sh\nprintf invoked > '${marker}'\nprintf '%s\\n' 'dolt version 2.2.1'\n`,
    );
    await chmod(replacement, 0o700);
    await unlink(clientExecutable);
    await symlink(replacement, clientExecutable);
    const value = batch();
    assert.deepEqual(await adapter.compareAndSet(value), {
      // The poisoned executable is rejected before the guarded transaction;
      // any mutation-path failure disarms this adapter until a new preflight.
      status: "ambiguous",
    });
    assert.deepEqual(await adapter.compareAndSet(value), {
      status: "quarantined",
    });
    await assert.rejects(stat(marker));
    assert.deepEqual(
      await fixture.readWriter("SELECT DOLT_HASHOF('HEAD') AS head"),
      beforeHead,
    );
    const metadata = await fixture.readWriter(
      `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) AS metadata FROM sce.issues WHERE id IN (${sqlLiteral(rootId)}, ${sqlLiteral(childId)}) ORDER BY id`,
    );
    assert.equal(metadata.status, "ok");
    if (metadata.status !== "ok")
      throw new Error("adapter pin readback failed");
    const row = new Map(
      metadata.rows.map((value) => [value.id, jsonObject(value.metadata).sce]),
    );
    assert.deepEqual(row.get(rootId), initialRoot);
    assert.deepEqual(row.get(childId), initialChild);
  } finally {
    await fixture.stop();
    await removeFixtureDirectory(fixture.directory);
    await removeFixtureDirectory(clientDirectory);
  }
});

test("concrete driver rejects missing labels schema and merge-slot label skew", async () => {
  const missingLabels = new DoltSqlTransport({
    identity: identity(),
    process: async (request) => {
      if (request.argv[0] === "version")
        return {
          exitCode: 0,
          output: "dolt version 2.2.1\n",
          timedOut: false,
        };
      const query = request.argv.at(request.argv.indexOf("-q") + 1) ?? "";
      if (query === "SELECT DATABASE() AS current_database")
        return {
          exitCode: 0,
          output: '[{"current_database":"sce"}]',
          timedOut: false,
        };
      if (query === "SELECT DOLT_VERSION() AS dolt_version")
        return {
          exitCode: 0,
          output: '[{"dolt_version":"2.2.1"}]',
          timedOut: false,
        };
      if (query.includes("table_name = 'issues'"))
        return {
          exitCode: 0,
          output: '[{"table_name":"issues"}]',
          timedOut: false,
        };
      return { exitCode: 0, output: "[]", timedOut: false };
    },
    user: "writer",
  });
  const missingLabelsDriver = new DoltBeadsServerDriver({
    identity: identity(),
    rows: { childBeadIds: { "unit-1": "sce-2" }, rootBeadId: "sce-1" },
    writer: missingLabels,
  });
  assert.deepEqual(await missingLabelsDriver.probe(identity()), {
    status: "refused",
  });

  const labelSkewWriter = new DoltSqlTransport({
    identity: identity(),
    process: async (request) => {
      const query = request.argv.at(request.argv.indexOf("-q") + 1) ?? "";
      if (query.startsWith("SELECT status, metadata"))
        return {
          exitCode: 0,
          output: JSON.stringify([
            {
              design: canonicalJson(scope as JsonValue),
              external_ref: slotScopeReference(scope),
              metadata: JSON.stringify({ holder }),
              status: "in_progress",
              title: "Merge Slot",
            },
          ]),
          timedOut: false,
        };
      if (query.startsWith("SELECT label"))
        return {
          exitCode: 0,
          output: JSON.stringify([
            { label: "gt:slot" },
            { label: "unexpected" },
          ]),
          timedOut: false,
        };
      return { exitCode: 0, output: "[]", timedOut: false };
    },
    user: "writer",
  });
  const labelSkewDriver = new DoltBeadsServerDriver({
    identity: identity(),
    rows: { childBeadIds: { "unit-1": "sce-2" }, rootBeadId: "sce-1" },
    slotProcess: new PinnedBdServerProcess({
      executable: "/fixture/bd",
      process: async (request) => ({
        exitCode: 0,
        output: request.argv[0] === "version" ? "bd version 1.1.0\n" : "{}",
        timedOut: false,
      }),
      workspace: "/fixture/workspace",
    }),
    writer: labelSkewWriter,
  });
  assert.deepEqual(
    await labelSkewDriver.mergeSlotCheck({
      actor: holder,
      prefix: "sce",
      scope,
    }),
    { status: "refused" },
  );
});

test("concrete driver refuses off and batch policies without same-connection commit evidence", async () => {
  for (const policy of ["off", "batch"] as const) {
    const transport = new DoltSqlTransport({
      identity: identity(policy),
      process: async () => ({ exitCode: 0, output: "[]", timedOut: false }),
      user: "writer",
    });
    const driver = new DoltBeadsServerDriver({
      identity: identity(policy),
      rows: { childBeadIds: { "unit-1": "sce-2" }, rootBeadId: "sce-1" },
      writer: transport,
    });
    assert.deepEqual(await driver.probe(identity(policy)), {
      status: "refused",
    });
  }
});

test("worker readonly preflight accepts only the exact pinned permission denial", async () => {
  const issueColumns = [
    ["id", "varchar"],
    ["status", "varchar"],
    ["metadata", "json"],
    ["external_ref", "varchar"],
    ["title", "varchar"],
    ["design", "longtext"],
  ].map(([column_name, data_type]) => ({ column_name, data_type }));
  const labelColumns = [
    ["issue_id", "varchar"],
    ["label", "varchar"],
  ].map(([column_name, data_type]) => ({ column_name, data_type }));
  const writerQueries: string[] = [];
  let broadWorkerGrant = false;
  let observedServerVersion = "2.2.1";
  const writer = new DoltSqlTransport({
    identity: identity(),
    process: async (request) => {
      if (request.argv[0] === "version")
        return {
          exitCode: 0,
          output: "dolt version 2.2.1\n",
          timedOut: false,
        };
      const query = request.argv.at(request.argv.indexOf("-q") + 1) ?? "";
      writerQueries.push(query);
      if (query === "SELECT DATABASE() AS current_database")
        return {
          exitCode: 0,
          output: '[{"current_database":"sce"}]',
          timedOut: false,
        };
      if (query === "SELECT DOLT_VERSION() AS dolt_version")
        return {
          exitCode: 0,
          output: JSON.stringify([{ dolt_version: observedServerVersion }]),
          timedOut: false,
        };
      if (query === "SELECT CURRENT_USER() AS current_principal")
        return {
          exitCode: 0,
          output: '[{"current_principal":"writer@%"}]',
          timedOut: false,
        };
      if (query.includes("information_schema.tables"))
        return {
          exitCode: 0,
          output: query.includes("table_name = 'issues'")
            ? '[{"table_name":"issues"}]'
            : '[{"table_name":"labels"}]',
          timedOut: false,
        };
      if (query.includes("information_schema.columns"))
        return {
          exitCode: 0,
          output: JSON.stringify(
            query.includes("table_name = 'issues'")
              ? issueColumns
              : labelColumns,
          ),
          timedOut: false,
        };
      if (query === "SELECT @@autocommit AS auto_commit")
        return {
          exitCode: 0,
          output: '[{"auto_commit":"1"}]',
          timedOut: false,
        };
      if (query === "SHOW GRANTS FOR 'worker'@'%'")
        return {
          exitCode: 0,
          output: JSON.stringify([
            { "Grants for worker@%": "GRANT USAGE ON *.* TO `worker`@`%`" },
            {
              "Grants for worker@%": "GRANT SELECT ON `sce`.* TO `worker`@`%`",
            },
            ...(broadWorkerGrant
              ? [
                  {
                    "Grants for worker@%":
                      "GRANT UPDATE ON `sce`.* TO `worker`@`%`",
                  },
                ]
              : []),
          ]),
          timedOut: false,
        };
      if (query.startsWith("SET @@SESSION.dolt_transaction_commit"))
        return {
          exitCode: 0,
          output: '[{"dolt_transaction_commit":"1"}]',
          timedOut: false,
        };
      if (query === "SELECT * FROM dolt_status")
        return { exitCode: 0, output: "[]", timedOut: false };
      if (query === "SELECT DOLT_HASHOF('HEAD') AS head")
        return {
          exitCode: 0,
          output: '[{"head":"c96vvi04oug557a1fk7tcjm7ok5sqmiu"}]',
          timedOut: false,
        };
      throw new Error(`unexpected writer query: ${query}`);
    },
    user: "writer",
  });
  const exactNoop = "UPDATE `sce`.issues SET status = status WHERE 1 = 0";
  const slotProcess = new PinnedBdServerProcess({
    executable: "/fixture/bd",
    identity: identity(),
    process: async (request) => {
      if (request.argv[0] === "version")
        return { exitCode: 0, output: "bd version 1.1.0\n", timedOut: false };
      if (request.argv.includes("context"))
        return {
          exitCode: 0,
          output: JSON.stringify({
            backend: "dolt",
            beads_dir: "/fixture/workspace/.beads",
            database: "sce",
            dolt_mode: "server",
            server_host: "127.0.0.1",
            server_port: 3306,
          }),
          timedOut: false,
        };
      throw new Error("unexpected bd worker fixture command");
    },
    runtimeEnvironment: () => ({
      HOME: "/fixture/home",
      XDG_CONFIG_HOME: "/fixture/config",
    }),
    workspace: "/fixture/workspace",
  });
  for (const mode of [
    "denied",
    "allowed",
    "timeout",
    "outage",
    "malformed",
    "wrong_credential",
    "broad_grant",
    "bad_server_version",
  ] as const) {
    broadWorkerGrant = mode === "broad_grant";
    observedServerVersion = mode === "bad_server_version" ? "2.3.1" : "2.2.1";
    const workerWrites: string[] = [];
    const worker = new DoltSqlTransport({
      identity: identity(),
      process: async (request) => {
        if (request.argv[0] === "version")
          return {
            exitCode: 0,
            output: "dolt version 2.2.1\n",
            timedOut: false,
          };
        const query = request.argv.at(request.argv.indexOf("-q") + 1) ?? "";
        if (query.startsWith("SELECT id FROM `sce`.issues")) {
          if (mode === "wrong_credential")
            return {
              exitCode: 1,
              output: "Error 1045 (28000): Access denied for user 'worker'@'%'",
              timedOut: false,
            };
          return {
            exitCode: 0,
            output: '[{"id":"sce-root"}]',
            timedOut: false,
          };
        }
        if (query === "SELECT CURRENT_USER() AS current_principal")
          return {
            exitCode: 0,
            output: '[{"current_principal":"worker@%"}]',
            timedOut: false,
          };
        workerWrites.push(query);
        assert.equal(query, exactNoop);
        if (mode === "denied")
          return {
            exitCode: 1,
            output: `error on line 1 for query ${exactNoop}: Error 1105 (HY000): command denied to user 'worker'@'%'`,
            timedOut: false,
          };
        if (mode === "allowed")
          return { exitCode: 0, output: "[]", timedOut: false };
        if (mode === "timeout")
          return { exitCode: undefined, output: "", timedOut: true };
        if (mode === "outage") throw new Error("fixture outage");
        return {
          exitCode: 1,
          output: "not a permission result",
          timedOut: false,
        };
      },
      user: "worker",
    });
    const driver = new DoltBeadsServerDriver({
      identity: identity(),
      rows: { childBeadIds: { "unit-1": "sce-child" }, rootBeadId: "sce-root" },
      slotProcess,
      worker,
      writer,
    });
    const result = await driver.probe(identity());
    if (mode === "denied") {
      assert.equal(result.status, "ok", writerQueries.join("\n"));
      assert.deepEqual(workerWrites, [exactNoop]);
      assert.deepEqual(result, {
        status: "ok",
        value: {
          autoCommitPolicy: "on",
          credentialReference: "managed-writer-v1",
          database: "sce",
          endpoint: "127.0.0.1:3306",
          schema: "beads",
          workerGrant: {
            credentialReference: "managed-worker-ro-v1",
            serverEnforced: true,
            writeDenied: true,
          },
        },
      });
    } else {
      assert.notEqual(result.status, "ok", mode);
      assert.equal(
        JSON.stringify(result).includes('"writeDenied":true'),
        false,
        mode,
      );
    }
  }
});

test("real transaction child accepts stdin backpressure and contains an early EPIPE", async () => {
  const directory = await mkdtemp("/private/tmp/sce-transaction-stdin-");
  const executable = join(directory, "dolt");
  const epipeExecutable = join(directory, "dolt-epipe");
  const completionMarker = join(directory, "transaction-completed");
  const value = batchForRun(denseRun(2_176));
  const rows = {
    childBeadIds: { "unit-1": "sce-child" },
    rootBeadId: "sce-root",
  };
  const metadataReadback = JSON.stringify([
    {
      id: rows.rootBeadId,
      metadata: JSON.stringify({ sce: value.next.root }),
    },
    {
      id: rows.childBeadIds["unit-1"],
      metadata: JSON.stringify({ sce: value.next.children[0] }),
    },
  ]);
  const issueColumns = JSON.stringify(
    [
      ["id", "varchar"],
      ["status", "varchar"],
      ["metadata", "json"],
      ["external_ref", "varchar"],
      ["title", "varchar"],
      ["design", "longtext"],
    ].map(([column_name, data_type]) => ({ column_name, data_type })),
  );
  const labelColumns = JSON.stringify(
    [
      ["issue_id", "varchar"],
      ["label", "varchar"],
    ].map(([column_name, data_type]) => ({ column_name, data_type })),
  );
  const grants = JSON.stringify([
    { "Grants for worker@%": "GRANT USAGE ON *.* TO `worker`@`%`" },
    {
      "Grants for worker@%": "GRANT SELECT ON `sce`.* TO `worker`@`%`",
    },
  ]);
  const workerNoop = "UPDATE `sce`.issues SET status = status WHERE 1 = 0";
  const workerDenied = `error on line 1 for query ${workerNoop}: Error 1105 (HY000): command denied to user 'worker'@'%'`;
  const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
  const print = (value: string) => `printf '%s\\n' ${shellQuote(value)}`;
  const sqlChild = (epipe: boolean) =>
    [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then',
      `  ${print("dolt version 2.2.1")}`,
      "  exit 0",
      "fi",
      'query=""',
      'user=""',
      'last=""',
      'for argument in "$@"; do',
      '  if [ "$last" = "-q" ]; then query="$argument"; fi',
      '  if [ "$last" = "--user" ]; then user="$argument"; fi',
      '  last="$argument"',
      "done",
      'if [ -n "$query" ]; then',
      '  case "$query" in',
      `    "SELECT DATABASE() AS current_database") ${print('[{"current_database":"sce"}]')} ;;`,
      `    "SELECT DOLT_VERSION() AS dolt_version") ${print('[{"dolt_version":"2.2.1"}]')} ;;`,
      '    *"information_schema.tables"*)',
      `      case "$query" in *"table_name = 'issues'"*) ${print('[{"table_name":"issues"}]')} ;; *) ${print('[{"table_name":"labels"}]')} ;; esac ;;`,
      '    *"information_schema.columns"*)',
      `      case "$query" in *"table_name = 'issues'"*) ${print(issueColumns)} ;; *) ${print(labelColumns)} ;; esac ;;`,
      `    "SELECT @@autocommit AS auto_commit") ${print('[{"auto_commit":"1"}]')} ;;`,
      `    "SET @@SESSION.dolt_transaction_commit = 1; SELECT @@SESSION.dolt_transaction_commit AS dolt_transaction_commit") ${print('[{"dolt_transaction_commit":"1"}]')} ;;`,
      `    "SELECT * FROM dolt_status") ${print("[]")} ;;`,
      `    "SELECT DOLT_HASHOF('HEAD') AS head") ${print('[{"head":"c96vvi04oug557a1fk7tcjm7ok5sqmiu"}]')} ;;`,
      '    *"issues LIMIT 1"*) ' + print("[]") + " ;;",
      `    "SELECT CURRENT_USER() AS current_principal") if [ "$user" = "writer" ]; then ${print('[{"current_principal":"writer@%"}]')}; else ${print('[{"current_principal":"worker@%"}]')}; fi ;;`,
      `    "SHOW GRANTS FOR 'worker'@'%'") ${print(grants)} ;;`,
      `    *"SET status = status WHERE 1 = 0"*) ${print(workerDenied)} >&2; exit 1 ;;`,
      "    *\"SELECT id, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) AS metadata FROM\"*) " +
        print(metadataReadback) +
        " ;;",
      "    *) exit 1 ;;",
      "  esac",
      "  exit 0",
      "fi",
      ...(epipe
        ? ["exec 0<&-", "sleep 1", "exit 0"]
        : [
            "IFS= read -r transaction || exit 1",
            print('[{"affected_rows":2}]'),
            "IFS= read -r decision || exit 1",
            "IFS= read -r evidence || exit 1",
            print('[{"committed_head":"c96vvi04oug557a1fk7tcjm7ok5sqmiu"}]'),
            print('[{"working_set_rows":0}]'),
            `printf x > ${JSON.stringify(completionMarker)}`,
          ]),
    ].join("\n");
  const slotProcess = new PinnedBdServerProcess({
    executable: "/fixture/bd",
    identity: identity(),
    process: async (request) => {
      if (request.argv[0] === "version")
        return { exitCode: 0, output: "bd version 1.1.0\n", timedOut: false };
      if (request.argv.includes("context"))
        return {
          exitCode: 0,
          output: JSON.stringify({
            backend: "dolt",
            beads_dir: "/fixture/workspace/.beads",
            database: "sce",
            dolt_mode: "server",
            server_host: "127.0.0.1",
            server_port: 3306,
          }),
          timedOut: false,
        };
      throw new Error("unexpected stdin fixture bd command");
    },
    runtimeEnvironment: () => ({
      HOME: "/fixture/home",
      XDG_CONFIG_HOME: "/fixture/config",
    }),
    workspace: "/fixture/workspace",
  });
  const driverFor = (path: string) =>
    new DoltBeadsServerDriver({
      identity: identity(),
      rows,
      slotProcess,
      worker: new DoltSqlTransport({
        executable: path,
        identity: identity(),
        password: "worker-password",
        user: "worker",
      }),
      writer: new DoltSqlTransport({
        executable: path,
        identity: identity(),
        password: "writer-password",
        user: "writer",
      }),
    });
  try {
    await writeFile(executable, sqlChild(false));
    await writeFile(epipeExecutable, sqlChild(true));
    await chmod(executable, 0o700);
    await chmod(epipeExecutable, 0o700);

    const driver = driverFor(executable);
    assert.equal((await driver.probe(identity())).status, "ok");
    const started = Date.now();
    const completed = await driver.mutate({
      batch: value,
      identity: identity(),
    });
    assert.ok(Date.now() - started < 5_000, "queued stdin must not time out");
    assert.equal(completed.status, "ok");
    await stat(completionMarker);

    const epipeDriver = driverFor(epipeExecutable);
    assert.equal((await epipeDriver.probe(identity())).status, "ok");
    const epipe = await epipeDriver.mutate({
      batch: value,
      identity: identity(),
    });
    assert.deepEqual(epipe, {
      phase: "commit_unknown",
      status: "unavailable",
    });
  } finally {
    await removeFixtureDirectory(directory);
  }
});

test("authoritative slot CAS has no lazy creation, validates scope, and rejects contenders", async () => {
  const fake = new FakeServer(identity());
  const first = new BeadsServerAdapter({
    driver: fake,
    identity: identity(),
    process: fakeManagedProcess,
  });
  const second = new BeadsServerAdapter({
    driver: fake,
    identity: identity(),
    process: fakeManagedProcess,
  });
  assert.equal((await first.preflight()).status, "ready");
  assert.equal((await second.preflight()).status, "ready");
  assert.deepEqual(await first.acquire({ holder, prefix: "sce", scope }), {
    status: "acquired",
    slot: slot("acquired", holder, holder),
  });
  assert.deepEqual(
    await second.acquire({
      holder: "run-2/incarnation-1",
      prefix: "sce",
      scope,
    }),
    { status: "blocked" },
  );
  assert.deepEqual(
    await first.check({
      holder,
      prefix: "sce",
      scope: { ...scope, integrationBranch: "next" },
    }),
    { status: "quarantined" },
  );
  fake.slot = undefined;
  assert.deepEqual(await first.acquire({ holder, prefix: "sce", scope }), {
    status: "quarantined",
  });
});

test("acquire decides from an authoritative check before invoking bd", async () => {
  const foreignHolder = "run-2/incarnation-1";
  const previousHolder = "run-1/incarnation-0";
  const ready = async (server: FakeServer) => {
    const adapter = new BeadsServerAdapter({
      driver: server,
      identity: identity(),
      process: fakeManagedProcess,
    });
    assert.equal((await adapter.preflight()).status, "ready");
    return adapter;
  };
  const input = {
    holder,
    prefix: "sce",
    scope,
  };

  {
    const server = new FakeServer(identity());
    const adapter = await ready(server);
    assert.deepEqual(await adapter.acquire(input), {
      status: "acquired",
      slot: slot("acquired", holder, holder),
    });
    assert.deepEqual(
      {
        attempts: server.slotAcquireCalls,
        checkActor: server.lastSlotCheckActor,
        checks: server.slotCheckCalls,
        transitions: server.slotTransitions,
      },
      { attempts: 1, checkActor: holder, checks: 1, transitions: 1 },
    );
  }

  for (const knownHolder of [holder, foreignHolder]) {
    const server = new FakeServer(identity());
    const adapter = await ready(server);
    assert.deepEqual(await adapter.acquire({ ...input, knownHolder }), {
      status: "blocked",
    });
    assert.deepEqual(
      {
        attempts: server.slotAcquireCalls,
        checkActor: server.lastSlotCheckActor,
        checks: server.slotCheckCalls,
        transitions: server.slotTransitions,
      },
      { attempts: 0, checkActor: knownHolder, checks: 1, transitions: 0 },
    );
  }

  for (const knownHolder of [holder, foreignHolder]) {
    const server = new FakeServer(identity());
    const adapter = await ready(server);
    assert.deepEqual(
      await adapter.acquire({
        ...input,
        knownHolder,
        releaseEvidence: {
          holder: knownHolder,
          readback: slot("available", undefined, knownHolder),
        },
      }),
      { status: "acquired", slot: slot("acquired", holder, holder) },
    );
    assert.deepEqual(
      {
        attempts: server.slotAcquireCalls,
        checkActor: server.lastSlotCheckActor,
        checks: server.slotCheckCalls,
        transitions: server.slotTransitions,
      },
      { attempts: 1, checkActor: knownHolder, checks: 1, transitions: 1 },
    );
  }

  for (const releaseEvidence of [
    {
      holder: holder,
      readback: slot("available", undefined, holder),
    },
    {
      holder: foreignHolder,
      readback: slot("available", undefined, foreignHolder, {
        ...scope,
        integrationBranch: "other",
      }),
    },
  ]) {
    const server = new FakeServer(identity());
    const adapter = await ready(server);
    assert.deepEqual(
      await adapter.acquire({
        ...input,
        knownHolder: foreignHolder,
        releaseEvidence,
      }),
      { status: "blocked" },
    );
    assert.equal(server.slotCheckCalls, 1);
    assert.equal(server.slotAcquireCalls, 0);
    assert.equal(server.slotTransitions, 0);
  }

  {
    const server = new FakeServer(identity(), slot("acquired", holder, holder));
    const adapter = await ready(server);
    assert.deepEqual(await adapter.acquire({ ...input, knownHolder: holder }), {
      status: "resume",
      slot: slot("acquired", holder, holder),
    });
    assert.equal(server.slotCheckCalls, 1);
    assert.equal(server.slotAcquireCalls, 0);
    assert.equal(server.slotTransitions, 0);
  }

  {
    const server = new FakeServer(identity(), slot("acquired", holder, holder));
    const adapter = await ready(server);
    assert.deepEqual(
      await adapter.acquire({
        ...input,
        continuationEvidence: {
          after: slot("acquired", holder, holder),
          before: slot("acquired", previousHolder, previousHolder),
          nextHolder: holder,
          previousHolder,
        },
        knownHolder: previousHolder,
      }),
      { status: "continue", slot: slot("acquired", holder, holder) },
    );
    assert.equal(server.slotCheckCalls, 1);
    assert.equal(server.slotAcquireCalls, 0);
    assert.equal(server.slotTransitions, 0);
  }

  {
    const server = new FakeServer(
      identity(),
      slot("acquired", foreignHolder, foreignHolder),
    );
    const adapter = await ready(server);
    assert.deepEqual(
      await adapter.acquire({ ...input, knownHolder: foreignHolder }),
      { status: "blocked" },
    );
    assert.equal(server.slotCheckCalls, 1);
    assert.equal(server.slotAcquireCalls, 0);
    assert.equal(server.slotTransitions, 0);
  }

  {
    const server = new FakeServer(identity());
    server.afterSlotCheck = () => {
      server.slot = slot("acquired", foreignHolder, foreignHolder);
    };
    const adapter = await ready(server);
    assert.deepEqual(await adapter.acquire(input), { status: "blocked" });
    assert.deepEqual(
      {
        attempts: server.slotAcquireCalls,
        checks: server.slotCheckCalls,
        transitions: server.slotTransitions,
      },
      { attempts: 1, checks: 1, transitions: 0 },
    );
    assert.deepEqual(
      server.slot,
      slot("acquired", foreignHolder, foreignHolder),
    );
  }

  for (const failure of [
    { expected: "ambiguous", stage: "check", mode: "throw" },
    { expected: "unavailable", stage: "check", mode: "unavailable" },
    { expected: "quarantined", stage: "check", mode: "malformed" },
    { expected: "quarantined", stage: "check", mode: "refused" },
    { expected: "ambiguous", stage: "acquire", mode: "throw" },
    { expected: "unavailable", stage: "acquire", mode: "unavailable" },
    { expected: "quarantined", stage: "acquire", mode: "malformed" },
    { expected: "quarantined", stage: "acquire", mode: "refused" },
  ] as const) {
    const server = new FakeServer(identity());
    if (failure.stage === "check") {
      if (failure.mode === "refused") server.slot = undefined;
      else server.slotCheckMode = failure.mode;
    } else if (failure.mode === "refused") {
      server.afterSlotCheck = () => {
        server.slot = undefined;
      };
    } else {
      server.slotAcquireMode = failure.mode;
    }
    const adapter = await ready(server);
    assert.deepEqual(await adapter.acquire(input), {
      status: failure.expected,
    });
    const calls = {
      attempts: server.slotAcquireCalls,
      checks: server.slotCheckCalls,
    };
    assert.deepEqual(await adapter.acquire(input), { status: "quarantined" });
    assert.deepEqual(
      { attempts: server.slotAcquireCalls, checks: server.slotCheckCalls },
      calls,
    );
  }
});

test("readiness disarms every mutation until the exact preflight succeeds", async () => {
  const server = new FakeServer(identity());
  server.readOnly = false;
  const adapter = new BeadsServerAdapter({
    driver: server,
    identity: identity(),
    process: fakeManagedProcess,
  });
  assert.deepEqual(await adapter.preflight(), {
    status: "refused",
    code: "BS_READ_ONLY_NOT_ENFORCED",
  });
  assert.deepEqual(await adapter.acquire({ holder, prefix: "sce", scope }), {
    status: "quarantined",
  });
  assert.deepEqual(await adapter.compareAndSet(batch()), {
    status: "quarantined",
  });
  assert.equal(server.slotAcquireCalls, 0);
  assert.equal(server.mutationCalls, 0);

  server.readOnly = true;
  assert.deepEqual(await adapter.preflight(), {
    status: "ready",
    identity: identity(),
  });
  assert.equal(
    (await adapter.acquire({ holder, prefix: "sce", scope })).status,
    "acquired",
  );
  assert.equal(server.slotAcquireCalls, 1);
  await adapter.dispose();
  assert.deepEqual(await adapter.release({ holder, prefix: "sce", scope }), {
    status: "quarantined",
  });
});

test("discovery rejects duplicate or missing child unit projections", async () => {
  const server = new FakeServer(identity());
  server.root = makeRootProjection(run([unit("unit-1"), unit("unit-2")]));
  const first = makeChildProjection(server.root, "unit-1");
  const second = makeChildProjection(server.root, "unit-2");
  assert.ok(first);
  assert.ok(second);
  const adapter = new BeadsServerAdapter({
    driver: server,
    identity: identity(),
    process: fakeManagedProcess,
  });
  server.discoveryChildren = [first, first];
  assert.equal((await adapter.preflight()).status, "ready");
  assert.equal(await adapter.discover(scope), undefined);
  server.discoveryChildren = [first];
  assert.equal((await adapter.preflight()).status, "ready");
  assert.equal(await adapter.discover(scope), undefined);
  server.discoveryChildren = [first, second];
  assert.equal((await adapter.preflight()).status, "ready");
  assert.ok(await adapter.discover(scope));
});

test("adapter discovery cache retains only a current exact readback", async () => {
  for (const mode of ["outage", "misbound", "malformed", "throw"] as const) {
    const server = new FakeServer(identity());
    const adapter = new BeadsServerAdapter({
      driver: server,
      identity: identity(),
      process: fakeManagedProcess,
    });
    assert.equal((await adapter.preflight()).status, "ready", mode);
    const initial = await adapter.discover(scope);
    assert.ok(initial, `${mode}: initial discovery`);
    assert.deepEqual(adapter.lastDiscovery, initial, `${mode}: initial cache`);
    const mutationsBefore = server.mutationCalls;
    server.discoveryMode = mode;
    assert.equal(await adapter.discover(scope), undefined, mode);
    assert.equal(
      adapter.lastDiscovery,
      undefined,
      `${mode}: stale cache cleared`,
    );
    assert.equal(
      server.mutationCalls,
      mutationsBefore,
      `${mode}: discovery never writes`,
    );
  }

  const reset = new FakeServer(identity());
  const resetAdapter = new BeadsServerAdapter({
    driver: reset,
    identity: identity(),
    process: fakeManagedProcess,
  });
  assert.equal((await resetAdapter.preflight()).status, "ready");
  assert.ok(await resetAdapter.discover(scope));
  assert.ok(resetAdapter.lastDiscovery);
  assert.equal((await resetAdapter.preflight()).status, "ready");
  assert.equal(
    resetAdapter.lastDiscovery,
    undefined,
    "preflight reset clears cache",
  );
  assert.ok(await resetAdapter.discover(scope));
  await resetAdapter.dispose();
  assert.equal(resetAdapter.lastDiscovery, undefined, "dispose clears cache");
});

test("commit-unknown reconciliation replaces or clears prior discovery", async () => {
  for (const discoveryMode of ["outage", "ok"] as const) {
    const server = new FakeServer(identity());
    server.outage = "after";
    const adapter = new BeadsServerAdapter({
      driver: server,
      identity: identity(),
      process: fakeManagedProcess,
    });
    assert.equal((await adapter.preflight()).status, "ready", discoveryMode);
    assert.equal(
      (await adapter.acquire({ holder, prefix: "sce", scope })).status,
      "acquired",
      discoveryMode,
    );
    const initial = await adapter.discover(scope);
    assert.ok(initial, `${discoveryMode}: initial discovery`);
    server.discoveryMode = discoveryMode;
    assert.deepEqual(await adapter.compareAndSet(batch()), {
      status: "ambiguous",
    });
    assert.equal(server.mutationCalls, 1, `${discoveryMode}: no retry`);
    if (discoveryMode === "outage") {
      assert.equal(
        adapter.lastDiscovery,
        undefined,
        "failed reconciliation clears cache",
      );
    } else {
      const reconciled = adapter.lastDiscovery;
      assert.ok(reconciled, "successful reconciliation is cached");
      assert.deepEqual(reconciled.root, server.root);
      assert.notDeepEqual(reconciled, initial, "old snapshot was replaced");
    }
  }
});

test("adapter admits the schema-valid near-limit batch and refuses max-plus-one before CAS", async () => {
  const nearLimit = schemaValidBoundaryBatch(39);
  const overLimit = schemaValidBoundaryBatch(40);
  const nearBytes = Buffer.byteLength(
    canonicalJson(nearLimit as JsonValue),
    "utf8",
  );
  const overBytes = Buffer.byteLength(
    canonicalJson(overLimit as JsonValue),
    "utf8",
  );
  assert.equal(validateMutationBatch(nearLimit).ok, true);
  assert.equal(validateMutationBatch(overLimit).ok, true);
  assert.equal(nearBytes, 260_525);
  assert.equal(overBytes, 262_266);
  assert.ok(nearBytes <= 256 * 1024);
  assert.ok(overBytes > 256 * 1024);

  const server = new FakeServer(identity());
  server.root = makeRootProjection(nearBoundRun());
  const adapter = new BeadsServerAdapter({
    driver: server,
    identity: identity(),
    process: fakeManagedProcess,
  });
  assert.equal((await adapter.preflight()).status, "ready");
  assert.equal(
    (await adapter.acquire({ holder, prefix: "sce", scope })).status,
    "acquired",
  );
  assert.equal((await adapter.compareAndSet(nearLimit)).status, "applied");
  const mutationCalls = server.mutationCalls;
  assert.deepEqual(await adapter.compareAndSet(overLimit), {
    status: "quarantined",
  });
  assert.equal(
    server.mutationCalls,
    mutationCalls,
    "max-plus-one never reaches a server mutation",
  );
});

test("server transaction predicates holder/revisions, preserves unrelated rows, and reads back exact projections", async () => {
  const fake = new FakeServer(identity());
  const adapter = new BeadsServerAdapter({
    driver: fake,
    identity: identity(),
    process: fakeManagedProcess,
  });
  assert.equal((await adapter.preflight()).status, "ready");
  await adapter.acquire({ holder, prefix: "sce", scope });
  fake.moveUnrelatedRow();
  const value = batch();
  const applied = await adapter.compareAndSet(value);
  assert.equal(applied.status, "applied");
  assert.equal(fake.unrelatedRevision, 1);
  assert.deepEqual(await adapter.compareAndSet(value), { status: "stale" });
  const stale = batch();
  fake.slot = slot("acquired", "run-2/incarnation-1", "run-2/incarnation-1");
  assert.deepEqual(await adapter.compareAndSet(stale), { status: "stale" });
});

test("auto-commit policy is explicit and outage after commit is ambiguous with discovery", async () => {
  for (const policy of ["on", "off", "batch"] as const) {
    const server = new FakeServer(identity(policy));
    const adapter = new BeadsServerAdapter({
      driver: server,
      identity: identity(policy),
      process: fakeManagedProcess,
    });
    assert.equal((await adapter.preflight()).status, "ready");
    await adapter.acquire({ holder, prefix: "sce", scope });
    assert.equal((await adapter.compareAndSet(batch())).status, "applied");
  }
  const wrongCommit = new FakeServer(identity("off"));
  wrongCommit.commitOverride = "auto";
  const wrongAdapter = new BeadsServerAdapter({
    driver: wrongCommit,
    identity: identity("off"),
    process: fakeManagedProcess,
  });
  assert.equal((await wrongAdapter.preflight()).status, "ready");
  await wrongAdapter.acquire({ holder, prefix: "sce", scope });
  assert.deepEqual(await wrongAdapter.compareAndSet(batch()), {
    status: "quarantined",
  });
  assert.deepEqual(
    await wrongAdapter.acquire({ holder, prefix: "sce", scope }),
    { status: "quarantined" },
  );

  const outage = new FakeServer(identity());
  outage.outage = "after";
  const outageAdapter = new BeadsServerAdapter({
    driver: outage,
    identity: identity(),
    process: fakeManagedProcess,
  });
  assert.equal((await outageAdapter.preflight()).status, "ready");
  await outageAdapter.acquire({ holder, prefix: "sce", scope });
  assert.deepEqual(await outageAdapter.compareAndSet(batch()), {
    status: "ambiguous",
  });
  assert.equal(outage.discoveryCalls, 1);
  assert.equal(outage.root.aggregateRevision, 1);
});

test("allowlisted SQL program predicates every owned row and parser rejects non-exact readback", async () => {
  const server = new FakeServer(identity());
  const value = batch();
  const program = buildServerCasProgram(identity(), value, {
    childBeadIds: { "unit-1": "sce-2" },
    rootBeadId: "sce-1",
  });
  assert.ok(program);
  assert.equal(program.statements[0]?.sql, "START TRANSACTION");
  assert.equal(
    program.statements.filter(
      (statement) => statement.sql === "SELECT ROW_COUNT() AS affected_rows",
    ).length,
    2,
  );
  assert.ok(
    program.statements.some((statement) =>
      statement.sql.includes("$.sce.holder"),
    ),
  );
  assert.ok(
    program.statements.every(
      (statement) => !JSON.stringify(statement).includes("SECRET_CANARY"),
    ),
  );
  await server.mergeSlotAcquire({ actor: holder, prefix: "sce", scope });
  const raw = await server.mutate({ batch: value, identity: identity() });
  assert.equal(raw.status, "ok");
  if (raw.status !== "ok") throw new Error("fake transaction failed");
  assert.ok(parseServerCasReadback(raw.value, identity(), value));
  assert.equal(
    parseServerCasReadback(
      { ...raw.value, result: { ...raw.value.result, affectedRowCount: 99 } },
      identity(),
      value,
    ),
    undefined,
  );
});

test("SQL executor rolls back immediately when a root or child CAS affects the wrong row count", async () => {
  let arbitraryExecuted = false;
  assert.deepEqual(
    await executeServerSqlProgram(
      {
        expectedAffectedRows: [],
        statements: [{ parameters: [], sql: "DROP TABLE issues" }],
      },
      async () => {
        arbitraryExecuted = true;
        return [];
      },
    ),
    { status: "unavailable" },
  );
  assert.equal(arbitraryExecuted, false);
  const program = buildServerCasProgram(identity(), batch(), {
    childBeadIds: { "unit-1": "sce-2" },
    rootBeadId: "sce-1",
  });
  assert.ok(program);
  const executed: string[] = [];
  const result = await executeServerSqlProgram(program, async (statement) => {
    executed.push(statement.sql);
    if (statement.sql === "SELECT ROW_COUNT() AS affected_rows")
      return [
        {
          affected_rows:
            executed.filter(
              (sql) => sql === "SELECT ROW_COUNT() AS affected_rows",
            ).length === 1
              ? 1
              : 0,
        },
      ];
    return [];
  });
  assert.deepEqual(result, { status: "rolled_back" });
  assert.equal(executed.at(-1), "ROLLBACK");
  assert.equal(executed.includes("COMMIT"), false);
});

test("real shared server atomically bootstraps an absent recovery intent before slot acquisition", async () => {
  const fixture = await startBdDoltServer();
  const serverIdentity = externalIdentity("on", fixture.endpoint);
  const rootId = "sce-recovery-root";
  const childId = "sce-recovery-child";
  try {
    for (const [id, title] of [
      [rootId, "Recovery root"],
      [childId, "Recovery child"],
    ] as const)
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "fixture",
          "--dolt-auto-commit",
          "on",
          "create",
          title,
          "--id",
          id,
          "--metadata",
          "{}",
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          password: fixture.writerPassword,
        },
      );
    const adapter = new BeadsServerAdapter({
      driver: new DoltBeadsServerDriver({
        identity: serverIdentity,
        rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
        slotProcess: new PinnedBdServerProcess({
          credentialEnvironment: () => ({
            BEADS_DOLT_PASSWORD: fixture.writerPassword,
          }),
          executable: fixture.bdExecutable,
          identity: serverIdentity,
          workspace: fixture.workspace,
        }),
        worker: fixture.worker,
        writer: fixture.writer,
      }),
      identity: serverIdentity,
      recoveryScope: scope,
    });
    assert.equal((await adapter.preflight()).status, "ready");
    assert.deepEqual(await adapter.load(), { status: "absent" });
    const planned = await adapter.prepareControllerTransition({
      holder,
      kind: "acquire",
      scope,
    });
    assert.equal(planned.status, "planned");
    if (planned.status !== "planned") throw new Error("planning failed");
    const input = initialServerAcquire();
    assert.deepEqual(
      input.next.root.run.effectJournal[0]?.slotTransition,
      planned.transition,
    );
    const created = await adapter.createControllerAcquireIntent(input);
    assert.equal(created.status, "applied");
    assert.equal(created.status === "applied" && created.affectedRowCount, 2);
    const loaded = await adapter.load();
    assert.equal(loaded.status, "observed");
    assert.deepEqual(
      await adapter.reconcileControllerTransition(planned.transition),
      { status: "absent" },
    );
    assert.deepEqual(
      await adapter.executeControllerTransition(planned.transition),
      { status: "observed" },
    );
    assert.deepEqual(
      await adapter.reconcileControllerTransition(planned.transition),
      { status: "observed" },
    );
    const rows = await fixture.readWriter(
      `SELECT id, status, metadata FROM sce.issues WHERE id IN (${sqlLiteral(rootId)}, ${sqlLiteral(childId)}, 'sce-merge-slot') ORDER BY id`,
    );
    assert.equal(rows.status, "ok");
    if (rows.status !== "ok") throw new Error("readback failed");
    assert.equal(rows.rows.length, 3);
    assert.equal(
      rows.rows.find((row) => row.id === "sce-merge-slot")?.status,
      "in_progress",
    );
    for (const id of [rootId, childId])
      assert.equal(
        Object.hasOwn(
          jsonObject(rows.rows.find((row) => row.id === id)?.metadata),
          "sce",
        ),
        true,
      );
  } finally {
    await fixture.stop();
    await removeFixtureDirectory(fixture.directory);
  }
});

test("real bd external-server workspace drives the concrete driver, adapter, and built-in slot", async () => {
  const fixture = await startBdDoltServer();
  const serverIdentity = externalIdentity("on", fixture.endpoint);
  const rootId = "sce-concrete-root";
  const childId = "sce-concrete-child";
  const unrelatedId = "sce-concrete-unrelated";
  const rawSqlArgs = [
    "--no-tls",
    "--host",
    "127.0.0.1",
    "--port",
    fixture.endpoint.split(":")[1]!,
    "--use-db",
    "sce",
    "--user",
    "writer",
    "sql",
  ];
  try {
    assert.equal(serverIdentity.topology, "external_server");
    assert.equal(serverIdentity.credentialProvenance, "environment");
    assert.equal(serverIdentity.transportSecurity, "loopback_plaintext");
    assert.equal(
      `${fixture.context.server_host}:${fixture.context.server_port}`,
      serverIdentity.endpoint,
    );
    // This exact maximum lineage is a 95 KiB schema-valid root. Combined
    // with the boundary test above it proves both a real large transaction
    // and that no schema-valid max-plus-one batch can reach SQL dispatch.
    const initialRoot = makeRootProjection(denseRun(2_176));
    const initialChild = makeChildProjection(initialRoot, "unit-1");
    assert.ok(initialChild);
    for (const [id, title, metadata] of [
      [rootId, "Concrete root", '{"preserved":"concrete"}'],
      [childId, "Concrete child", '{"preserved":"child"}'],
      [unrelatedId, "Concrete unrelated", '{"outside":"owned-scope"}'],
    ] as const) {
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "fixture",
          "--dolt-auto-commit",
          "on",
          "create",
          title,
          "--id",
          id,
          "--metadata",
          metadata,
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          password: fixture.writerPassword,
        },
      );
    }
    const slotProcess = new PinnedBdServerProcess({
      credentialEnvironment: () => ({
        BEADS_DOLT_PASSWORD: fixture.writerPassword,
      }),
      executable: fixture.bdExecutable,
      identity: serverIdentity,
      workspace: fixture.workspace,
    });
    const driver = new DoltBeadsServerDriver({
      identity: serverIdentity,
      rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
      slotProcess,
      worker: fixture.worker,
      writer: fixture.writer,
    });
    const adapter = new BeadsServerAdapter({
      driver,
      identity: serverIdentity,
    });
    assert.deepEqual(await fixture.readWriter("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    const initialHead = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.equal(initialHead.status, "ok");
    if (initialHead.status === "ok")
      assert.equal(typeof initialHead.rows[0]?.head, "string");
    assert.deepEqual(await adapter.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    assert.deepEqual(
      await readFixtureDolt(
        {
          cwd: fixture.directory,
          endpoint: fixture.endpoint,
          executable: fixture.executable,
          password: randomBytes(18).toString("hex"),
          user: "writer",
        },
        "SELECT 1",
      ),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await readFixtureDolt(
        {
          cwd: fixture.directory,
          endpoint: fixture.endpoint,
          executable: fixture.executable,
          password: fixture.writerPassword,
          user: "writer",
        },
        "SELECT * FROM wrong.issues",
      ),
      { status: "unavailable" },
    );
    assert.deepEqual(await adapter.acquire({ holder, prefix: "sce", scope }), {
      status: "acquired",
      slot: slot("acquired", holder, holder),
    });
    const rawHeld = JSON.parse(
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "independent",
          "--dolt-auto-commit",
          "on",
          "merge-slot",
          "check",
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          password: fixture.writerPassword,
        },
      ),
    ) as Record<string, unknown>;
    assert.equal(rawHeld.available, false);
    assert.equal(rawHeld.holder, holder);
    const sqlHeld = await fixture.readWriter(
      "SELECT status, metadata, external_ref, title, design FROM sce.issues WHERE id = 'sce-merge-slot'",
    );
    assert.equal(sqlHeld.status, "ok");
    if (sqlHeld.status !== "ok") throw new Error("slot SQL readback failed");
    assert.deepEqual(sqlHeld.rows, [
      {
        status: "in_progress",
        metadata: JSON.stringify({ holder }),
        external_ref: slotScopeReference(scope),
        title: "Merge Slot",
        design: canonicalJson(scope as JsonValue),
      },
    ]);
    const contender = new BeadsServerAdapter({
      driver: new DoltBeadsServerDriver({
        identity: serverIdentity,
        rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
        slotProcess: new PinnedBdServerProcess({
          credentialEnvironment: () => ({
            BEADS_DOLT_PASSWORD: fixture.writerPassword,
          }),
          executable: fixture.bdExecutable,
          identity: serverIdentity,
          workspace: fixture.workspace,
        }),
        worker: fixture.worker,
        writer: fixture.writer,
      }),
      identity: serverIdentity,
    });
    assert.deepEqual(await contender.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    assert.deepEqual(
      await contender.acquire({
        holder: "run-2/incarnation-1",
        prefix: "sce",
        scope,
      }),
      { status: "blocked" },
    );
    await assert.rejects(
      runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "independent",
          "--dolt-auto-commit",
          "on",
          "merge-slot",
          "acquire",
          "--holder",
          "run-3/incarnation-1",
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          password: fixture.writerPassword,
        },
      ),
      /bd fixture command failed/,
    );
    assert.deepEqual(await adapter.check({ holder, prefix: "sce", scope }), {
      status: "resume",
      slot: slot("acquired", holder, holder),
    });
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialRoot,
        issueId: rootId,
      }),
      { status: "initialized" },
    );
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialRoot,
        issueId: rootId,
      }),
      { status: "already_initialized" },
    );
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialChild,
        issueId: childId,
      }),
      { status: "initialized" },
    );
    await runDolt(rawSqlArgs, {
      cwd: fixture.directory,
      executable: fixture.executable,
      password: fixture.writerPassword,
      stdin: `SET @@SESSION.dolt_transaction_commit = 1; UPDATE issues SET metadata = JSON_SET(metadata, '$.outside_move', true) WHERE id = ${sqlLiteral(unrelatedId)}`,
    });
    const value = batchForRun(denseRun(2_176));
    const wireBytes = Buffer.byteLength(
      canonicalJson(value as JsonValue),
      "utf8",
    );
    assert.equal(validateMutationBatch(value).ok, true);
    assert.ok(wireBytes > 90_000, `${wireBytes} byte concrete batch`);
    assert.ok(wireBytes <= 256 * 1024, `${wireBytes} byte concrete batch`);
    const beforeCasHead = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    const applied = await adapter.compareAndSet(value);
    const afterCasHead = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.equal(applied.status, "applied");
    assert.equal(beforeCasHead.status, "ok");
    assert.equal(afterCasHead.status, "ok");
    if (beforeCasHead.status === "ok" && afterCasHead.status === "ok")
      assert.notEqual(afterCasHead.rows[0]?.head, beforeCasHead.rows[0]?.head);
    assert.deepEqual(await fixture.readWriter("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    const unrelated = await fixture.readWriter(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) AS metadata FROM issues WHERE id = ${sqlLiteral(unrelatedId)}`,
    );
    assert.equal(unrelated.status, "ok");
    if (unrelated.status === "ok")
      assert.deepEqual(jsonObject(unrelated.rows[0]?.metadata), {
        outside: "owned-scope",
        outside_move: true,
      });
    const discovered = await adapter.discover(scope);
    assert.ok(discovered);
    assert.deepEqual(discovered.root, value.next.root);
    assert.deepEqual(discovered.children, value.next.children);
    const beforeStaleHead = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    const staleResult = await adapter.compareAndSet(value);
    const afterStaleHead = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.deepEqual(afterStaleHead, beforeStaleHead);
    assert.deepEqual(await fixture.readWriter("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    assert.deepEqual(staleResult, { status: "stale" });
    await runDolt(rawSqlArgs, {
      cwd: fixture.directory,
      password: fixture.writerPassword,
      stdin: `SET @@SESSION.dolt_transaction_commit = 1; UPDATE issues SET metadata = JSON_SET(metadata, '$.sce', CAST(${sqlLiteral(JSON.stringify(initialRoot))} AS JSON)) WHERE id = ${sqlLiteral(rootId)}; UPDATE issues SET metadata = JSON_SET(metadata, '$.sce', CAST(${sqlLiteral(JSON.stringify(initialChild))} AS JSON)) WHERE id = ${sqlLiteral(childId)}; UPDATE issues SET metadata = JSON_SET(metadata, '$.sce.revision', 99) WHERE id = ${sqlLiteral(childId)}`,
    });
    assert.deepEqual(await adapter.compareAndSet(value), { status: "stale" });
    const staleRoot = await fixture.readWriter(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) AS metadata FROM issues WHERE id = ${sqlLiteral(rootId)}`,
    );
    assert.equal(staleRoot.status, "ok");
    if (staleRoot.status !== "ok")
      throw new Error("stale root readback failed");
    assert.deepEqual(jsonObject(staleRoot.rows[0]?.metadata).sce, initialRoot);
    assert.deepEqual(await adapter.release({ holder, prefix: "sce", scope }), {
      status: "released",
      slot: slot("available", undefined, holder),
    });
    const rawReleased = JSON.parse(
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "independent",
          "--dolt-auto-commit",
          "on",
          "merge-slot",
          "check",
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          password: fixture.writerPassword,
        },
      ),
    ) as Record<string, unknown>;
    assert.equal(rawReleased.available, true);
    assert.equal(rawReleased.holder, null);
    await runBd(
      [
        "-C",
        fixture.workspace,
        "--actor",
        "independent",
        "--dolt-auto-commit",
        "on",
        "merge-slot",
        "acquire",
        "--holder",
        "run-4/incarnation-1",
        "--json",
      ],
      {
        cwd: fixture.workspace,
        executable: fixture.bdExecutable,
        password: fixture.writerPassword,
      },
    );
    const restarted = new BeadsServerAdapter({
      driver: new DoltBeadsServerDriver({
        identity: serverIdentity,
        rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
        slotProcess: new PinnedBdServerProcess({
          credentialEnvironment: () => ({
            BEADS_DOLT_PASSWORD: fixture.writerPassword,
          }),
          executable: fixture.bdExecutable,
          identity: serverIdentity,
          workspace: fixture.workspace,
        }),
        worker: fixture.worker,
        writer: fixture.writer,
      }),
      identity: serverIdentity,
    });
    assert.deepEqual(await restarted.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    assert.deepEqual(
      await restarted.check({
        holder: "run-4/incarnation-1",
        prefix: "sce",
        scope,
      }),
      {
        status: "resume",
        slot: slot("acquired", "run-4/incarnation-1", "run-4/incarnation-1"),
      },
    );
    assert.deepEqual(
      await restarted.release({
        holder: "run-4/incarnation-1",
        prefix: "sce",
        scope,
      }),
      {
        status: "released",
        slot: slot("available", undefined, "run-4/incarnation-1"),
      },
    );
    await runBd(
      [
        "-C",
        fixture.workspace,
        "--actor",
        "independent",
        "--dolt-auto-commit",
        "on",
        "merge-slot",
        "acquire",
        "--holder",
        "run-5/incarnation-1",
        "--json",
      ],
      {
        cwd: fixture.workspace,
        executable: fixture.bdExecutable,
        password: fixture.writerPassword,
      },
    );
    await runBd(
      [
        "-C",
        fixture.workspace,
        "--actor",
        "independent",
        "--dolt-auto-commit",
        "on",
        "merge-slot",
        "release",
        "--holder",
        "run-5/incarnation-1",
        "--json",
      ],
      {
        cwd: fixture.workspace,
        executable: fixture.bdExecutable,
        password: fixture.writerPassword,
      },
    );
    const rawFinal = JSON.parse(
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "independent",
          "--dolt-auto-commit",
          "on",
          "merge-slot",
          "check",
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          password: fixture.writerPassword,
        },
      ),
    ) as Record<string, unknown>;
    assert.equal(rawFinal.available, true);
    assert.equal(rawFinal.holder, null);
    await fixture.stop();
    assert.deepEqual(await driver.probe(serverIdentity), {
      status: "unavailable",
    });
  } finally {
    await fixture.stop();
    await removeFixtureDirectory(fixture.directory);
  }
});

test("real transaction keeps its same-session head when an unrelated writer advances HEAD", async () => {
  const fixture = await startBdDoltServer();
  const serverIdentity = externalIdentity("on", fixture.endpoint);
  const rootId = "sce-session-head-root";
  const childId = "sce-session-head-child";
  const unrelatedId = "sce-session-head-unrelated";
  let clearPostTransactionHook: (() => void) | undefined;
  try {
    for (const [id, title] of [
      [rootId, "Session head root"],
      [childId, "Session head child"],
      [unrelatedId, "Session head unrelated"],
    ] as const) {
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "fixture",
          "--dolt-auto-commit",
          "on",
          "create",
          title,
          "--id",
          id,
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          password: fixture.writerPassword,
        },
      );
    }
    const driver = new DoltBeadsServerDriver({
      identity: serverIdentity,
      rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
      slotProcess: new PinnedBdServerProcess({
        credentialEnvironment: () => ({
          BEADS_DOLT_PASSWORD: fixture.writerPassword,
        }),
        executable: fixture.bdExecutable,
        identity: serverIdentity,
        workspace: fixture.workspace,
      }),
      worker: fixture.worker,
      writer: fixture.writer,
    });
    const adapter = new BeadsServerAdapter({
      driver,
      identity: serverIdentity,
    });
    assert.equal((await adapter.preflight()).status, "ready");
    assert.equal(
      (await adapter.acquire({ holder, prefix: "sce", scope })).status,
      "acquired",
    );
    const initialRoot = makeRootProjection(run());
    const initialChild = makeChildProjection(initialRoot, "unit-1");
    assert.ok(initialChild);
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialRoot,
        issueId: rootId,
      }),
      { status: "initialized" },
    );
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialChild,
        issueId: childId,
      }),
      { status: "initialized" },
    );
    const value = batch();
    let sameSessionHead: string | undefined;
    clearPostTransactionHook =
      __setDoltBeadsServerDriverPostTransactionTestHookForTests(
        async ({ committedHead }) => {
          sameSessionHead = committedHead;
          await runDolt(
            [
              "--no-tls",
              "--host",
              "127.0.0.1",
              "--port",
              fixture.endpoint.split(":")[1]!,
              "--use-db",
              "sce",
              "--user",
              "writer",
              "sql",
            ],
            {
              cwd: fixture.directory,
              executable: fixture.executable,
              password: fixture.writerPassword,
              stdin: `SET @@SESSION.dolt_transaction_commit = 1; UPDATE sce.issues SET metadata = JSON_SET(metadata, '$.unrelated_head_move', true) WHERE id = ${sqlLiteral(unrelatedId)}`,
            },
          );
        },
      );
    const result = await driver.mutate({
      batch: value,
      identity: serverIdentity,
    });
    clearPostTransactionHook();
    clearPostTransactionHook = undefined;
    assert.equal(result.status, "ok");
    if (result.status !== "ok") throw new Error("same-session CAS failed");
    const commit = result.value.commit as Record<string, unknown>;
    assert.equal(commit.head, sameSessionHead);
    assert.equal(typeof sameSessionHead, "string");
    const laterHead = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.equal(laterHead.status, "ok");
    if (laterHead.status !== "ok") throw new Error("head readback failed");
    assert.notEqual(laterHead.rows[0]?.head, sameSessionHead);
    const discovery = await driver.discover({
      identity: serverIdentity,
      prefix: "sce",
      scope,
    });
    assert.equal(discovery.status, "ok");
    if (discovery.status !== "ok")
      throw new Error("same-session discovery failed");
    if ("status" in discovery.value)
      throw new Error("same-session discovery was unexpectedly absent");
    assert.deepEqual(discovery.value.root, value.next.root);
    assert.deepEqual(discovery.value.children, value.next.children);
    assert.deepEqual(await fixture.readWriter("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
  } finally {
    clearPostTransactionHook?.();
    await fixture.stop();
    await removeFixtureDirectory(fixture.directory);
  }
});

test("real transport and bd workspace bindings reject same-db swaps before mutation", async () => {
  const first = await startBdDoltServer();
  const second = await startBdDoltServer();
  const firstIdentity = externalIdentity("on", first.endpoint);
  const rows = {
    childBeadIds: { "unit-1": "sce-binding-child" },
    rootBeadId: "sce-binding-root",
  };
  try {
    const beforeFirst = await first.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    const beforeSecond = await second.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    const endpointSwap = new BeadsServerAdapter({
      driver: new DoltBeadsServerDriver({
        identity: firstIdentity,
        rows,
        slotProcess: new PinnedBdServerProcess({
          credentialEnvironment: () => ({
            BEADS_DOLT_PASSWORD: first.writerPassword,
          }),
          executable: first.bdExecutable,
          identity: firstIdentity,
          workspace: first.workspace,
        }),
        worker: second.worker,
        writer: second.writer,
      }),
      identity: firstIdentity,
    });
    assert.deepEqual(await endpointSwap.preflight(), {
      status: "refused",
      code: "BS_SERVER_REFUSED",
    });
    assert.deepEqual(
      await endpointSwap.acquire({ holder, prefix: "sce", scope }),
      { status: "quarantined" },
    );

    const wrongWorkspace = new BeadsServerAdapter({
      driver: new DoltBeadsServerDriver({
        identity: firstIdentity,
        rows,
        slotProcess: new PinnedBdServerProcess({
          credentialEnvironment: () => ({
            BEADS_DOLT_PASSWORD: second.writerPassword,
          }),
          executable: second.bdExecutable,
          identity: firstIdentity,
          workspace: second.workspace,
        }),
        worker: first.worker,
        writer: first.writer,
      }),
      identity: firstIdentity,
    });
    assert.deepEqual(await wrongWorkspace.preflight(), {
      status: "refused",
      code: "BS_SERVER_REFUSED",
    });
    assert.deepEqual(
      await wrongWorkspace.acquire({ holder, prefix: "sce", scope }),
      { status: "quarantined" },
    );
    assert.deepEqual(
      await first.readWriter("SELECT DOLT_HASHOF('HEAD') AS head"),
      beforeFirst,
    );
    assert.deepEqual(
      await second.readWriter("SELECT DOLT_HASHOF('HEAD') AS head"),
      beforeSecond,
    );
    assert.deepEqual(await first.readWriter("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    assert.deepEqual(await second.readWriter("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
  } finally {
    await first.stop();
    await second.stop();
    await removeFixtureDirectory(first.directory);
    await removeFixtureDirectory(second.directory);
  }
});

test("real Dolt transaction child faults remain ambiguous until authoritative discovery", async () => {
  const fixture = await startBdDoltServer();
  const serverIdentity = externalIdentity("on", fixture.endpoint);
  let clearFaultHook: (() => void) | undefined;
  try {
    const driverFor = (rootId: string, childId: string) =>
      new DoltBeadsServerDriver({
        identity: serverIdentity,
        rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
        slotProcess: new PinnedBdServerProcess({
          credentialEnvironment: () => ({
            BEADS_DOLT_PASSWORD: fixture.writerPassword,
          }),
          executable: fixture.bdExecutable,
          identity: serverIdentity,
          workspace: fixture.workspace,
        }),
        worker: fixture.worker,
        writer: fixture.writer,
      });
    const slotAdapter = new BeadsServerAdapter({
      driver: driverFor("sce-fault-root-0", "sce-fault-child-0"),
      identity: serverIdentity,
    });
    assert.deepEqual(await slotAdapter.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    assert.equal(
      (await slotAdapter.acquire({ holder, prefix: "sce", scope })).status,
      "acquired",
    );

    const provision = async (index: number) => {
      const rootId = `sce-fault-root-${index}`;
      const childId = `sce-fault-child-${index}`;
      for (const [id, title] of [
        [rootId, `Fault root ${index}`],
        [childId, `Fault child ${index}`],
      ] as const) {
        await runBd(
          [
            "-C",
            fixture.workspace,
            "--actor",
            "fixture",
            "--dolt-auto-commit",
            "on",
            "create",
            title,
            "--id",
            id,
            "--metadata",
            JSON.stringify({ preserved: `fault-${index}` }),
            "--json",
          ],
          {
            cwd: fixture.workspace,
            executable: fixture.bdExecutable,
            password: fixture.writerPassword,
          },
        );
      }
      const driver = driverFor(rootId, childId);
      const adapter = new BeadsServerAdapter({
        driver,
        identity: serverIdentity,
      });
      assert.deepEqual(await adapter.preflight(), {
        status: "ready",
        identity: serverIdentity,
      });
      const initialRoot = makeRootProjection(run());
      const initialChild = makeChildProjection(initialRoot, "unit-1");
      assert.ok(initialChild);
      assert.deepEqual(
        await driver.initializeEnvelope({
          authority: "authorized_initialization",
          envelope: initialRoot,
          issueId: rootId,
        }),
        { status: "initialized" },
      );
      assert.deepEqual(
        await driver.initializeEnvelope({
          authority: "authorized_initialization",
          envelope: initialChild,
          issueId: childId,
        }),
        { status: "initialized" },
      );
      const read = async () => {
        const metadata = await fixture.readWriter(
          `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) AS metadata FROM sce.issues WHERE id IN (${sqlLiteral(rootId)}, ${sqlLiteral(childId)}) ORDER BY id`,
        );
        assert.equal(metadata.status, "ok");
        if (metadata.status !== "ok" || metadata.rows.length !== 2)
          throw new Error("fault fixture metadata readback failed");
        const entries: [string, unknown][] = [];
        for (const row of metadata.rows) {
          if (typeof row.id !== "string")
            throw new Error("fault fixture issue identity readback failed");
          entries.push([row.id, jsonObject(row.metadata).sce]);
        }
        const records = new Map<string, unknown>(entries);
        const head = await fixture.readWriter(
          "SELECT DOLT_HASHOF('HEAD') AS head",
        );
        assert.equal(head.status, "ok");
        if (head.status !== "ok" || typeof head.rows[0]?.head !== "string")
          throw new Error("fault fixture head readback failed");
        assert.deepEqual(
          await fixture.readWriter("SELECT * FROM dolt_status"),
          { status: "ok", rows: [] },
        );
        return {
          child: records.get(childId),
          head: head.rows[0].head,
          root: records.get(rootId),
        };
      };
      return {
        adapter,
        initialChild,
        initialRoot,
        read,
        value: batch(),
      };
    };

    const exercise = async (
      index: number,
      phase: DoltSqlTransactionTestPhase,
      noncooperative = false,
    ) => {
      const current = await provision(index);
      const before = await current.read();
      let matchingPhaseCalls = 0;
      clearFaultHook = __setDoltSqlTransactionTestHookForTests((fault) => {
        if (fault.phase !== phase) return;
        matchingPhaseCalls += 1;
        if (matchingPhaseCalls !== 1) return;
        if (noncooperative) {
          fault.pause();
          setTimeout(fault.abort, 10);
          return;
        }
        fault.abort();
      });
      const started = Date.now();
      const result = await current.adapter.compareAndSet(current.value);
      const elapsed = Date.now() - started;
      clearFaultHook();
      clearFaultHook = undefined;
      assert.equal(
        matchingPhaseCalls,
        1,
        `${phase} had exactly one real transaction-child attempt`,
      );
      assert.deepEqual(result, { status: "ambiguous" });
      if (noncooperative)
        assert.ok(
          elapsed >= 200,
          "the paused real child waited through TERM before KILL and close",
        );
      return { before, current, after: await current.read() };
    };

    const beforeRowcount = await exercise(
      1,
      "after_guarded_write_before_rowcount",
    );
    assert.deepEqual(
      beforeRowcount.after.root,
      beforeRowcount.current.initialRoot,
    );
    assert.deepEqual(
      beforeRowcount.after.child,
      beforeRowcount.current.initialChild,
    );
    assert.equal(beforeRowcount.after.head, beforeRowcount.before.head);
    assert.deepEqual(
      await beforeRowcount.current.adapter.discover(scope),
      beforeRowcount.current.adapter.lastDiscovery,
    );

    const beforeCommit = await exercise(2, "after_rowcount_before_commit");
    assert.deepEqual(beforeCommit.after.root, beforeCommit.current.initialRoot);
    assert.deepEqual(
      beforeCommit.after.child,
      beforeCommit.current.initialChild,
    );
    assert.equal(beforeCommit.after.head, beforeCommit.before.head);

    const noncooperative = await exercise(
      3,
      "after_rowcount_before_commit",
      true,
    );
    assert.deepEqual(
      noncooperative.after.root,
      noncooperative.current.initialRoot,
    );
    assert.deepEqual(
      noncooperative.after.child,
      noncooperative.current.initialChild,
    );
    assert.equal(noncooperative.after.head, noncooperative.before.head);

    const commitUnknown = await exercise(4, "after_commit_before_outcome");
    const commitUnknownDiscovery =
      await commitUnknown.current.adapter.discover(scope);
    assert.ok(commitUnknownDiscovery);
    const committedDuringUnknown =
      canonicalJson(commitUnknown.after.root as JsonValue) ===
      canonicalJson(commitUnknown.current.value.next.root as JsonValue);
    if (committedDuringUnknown) {
      assert.deepEqual(
        commitUnknown.after.child,
        commitUnknown.current.value.next.children[0],
      );
      assert.notEqual(commitUnknown.after.head, commitUnknown.before.head);
      assert.deepEqual(
        commitUnknownDiscovery.root,
        commitUnknown.current.value.next.root,
      );
      // This is an explicit, post-discovery probe rather than an automatic
      // retry. The exact already-applied batch must be stale and cannot move
      // its rows or Dolt head a second time.
      // The fault disarmed the adapter; discovery is intentionally read-only,
      // so a fresh complete preflight is required before this explicit probe.
      assert.deepEqual(await commitUnknown.current.adapter.preflight(), {
        status: "ready",
        identity: serverIdentity,
      });
      assert.deepEqual(
        await commitUnknown.current.adapter.compareAndSet(
          commitUnknown.current.value,
        ),
        { status: "stale" },
      );
      const afterUnknownStale = await commitUnknown.current.read();
      assert.deepEqual(afterUnknownStale.root, commitUnknown.after.root);
      assert.deepEqual(afterUnknownStale.child, commitUnknown.after.child);
      assert.equal(afterUnknownStale.head, commitUnknown.after.head);
    } else {
      assert.deepEqual(
        commitUnknown.after.root,
        commitUnknown.current.initialRoot,
      );
      assert.deepEqual(
        commitUnknown.after.child,
        commitUnknown.current.initialChild,
      );
      assert.equal(commitUnknown.after.head, commitUnknown.before.head);
      assert.deepEqual(
        commitUnknownDiscovery.root,
        commitUnknown.current.initialRoot,
      );
    }

    const afterCommitMarker = await exercise(
      5,
      "after_commit_marker_before_close",
    );
    assert.deepEqual(
      afterCommitMarker.after.root,
      afterCommitMarker.current.value.next.root,
    );
    assert.deepEqual(
      afterCommitMarker.after.child,
      afterCommitMarker.current.value.next.children[0],
    );
    assert.notEqual(
      afterCommitMarker.after.head,
      afterCommitMarker.before.head,
    );
    const markerDiscovery =
      await afterCommitMarker.current.adapter.discover(scope);
    assert.ok(markerDiscovery);
    assert.deepEqual(
      markerDiscovery.root,
      afterCommitMarker.current.value.next.root,
    );
    assert.deepEqual(
      markerDiscovery.children,
      afterCommitMarker.current.value.next.children,
    );
    // Likewise, an explicit reconciliation probe after the marker-confirmed
    // commit must not produce a second transition or a second head movement.
    assert.deepEqual(await afterCommitMarker.current.adapter.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    assert.deepEqual(
      await afterCommitMarker.current.adapter.compareAndSet(
        afterCommitMarker.current.value,
      ),
      { status: "stale" },
    );
    const afterMarkerStale = await afterCommitMarker.current.read();
    assert.deepEqual(afterMarkerStale.root, afterCommitMarker.after.root);
    assert.deepEqual(afterMarkerStale.child, afterCommitMarker.after.child);
    assert.equal(afterMarkerStale.head, afterCommitMarker.after.head);
    assert.equal(
      (await slotAdapter.release({ holder, prefix: "sce", scope })).status,
      "released",
    );
  } finally {
    clearFaultHook?.();
    await fixture.stop();
    await removeFixtureDirectory(fixture.directory);
  }
});

test("managed fixture tears down its init-owned server on pre-lifecycle setup failure", async () => {
  let fixtureDirectory: string | undefined;
  let teardown: PrivateBdServerTeardownAuthority | undefined;
  await assert.rejects(
    createManagedBdServer({
      afterOwnedInit: ({ directory, teardown: authority }) => {
        fixtureDirectory = directory;
        teardown = authority;
        throw new Error("forced pre-lifecycle fixture setup failure");
      },
    }),
    /forced pre-lifecycle fixture setup failure/u,
  );
  assert.ok(fixtureDirectory);
  assert.ok(teardown);
  if (fixtureDirectory === undefined || teardown === undefined)
    throw new Error("managed fixture teardown was not observed");
  const ownedTeardown = teardown;
  assert.equal(
    ownedTeardown.dataDirectory,
    join(fixtureDirectory, "home", ".beads", "shared-server", "dolt"),
  );
  await assert.rejects(stat(fixtureDirectory), { code: "ENOENT" });
  assert.throws(() => process.kill(ownedTeardown.pid, 0), { code: "ESRCH" });
});

test("managed bd shared-server lifecycle owns its isolated topology and recovers", async () => {
  const fixture = await createManagedBdServer();
  const serverIdentity = identity("on", fixture.endpoint);
  const rootId = "sce-managed-root";
  const childId = "sce-managed-child";
  const slotProcess = new PinnedBdServerProcess({
    executable: fixture.bdExecutable,
    identity: serverIdentity,
    runtimeEnvironment: () => ({
      HOME: fixture.runtime.home,
      XDG_CONFIG_HOME: fixture.runtime.config,
    }),
    workspace: fixture.workspace,
  });
  const driver = new DoltBeadsServerDriver({
    identity: serverIdentity,
    rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
    slotProcess,
    worker: fixture.worker,
    writer: fixture.writer,
  });
  const adapter = new BeadsServerAdapter({
    driver,
    identity: serverIdentity,
    process: fixture.lifecycle,
  });
  try {
    assert.equal(serverIdentity.topology, "managed_local_shared_server");
    assert.equal(serverIdentity.credentialProvenance, "managed_local_runtime");
    assert.equal(Object.hasOwn(serverIdentity, "storePath"), false);
    assert.equal(fixture.home.startsWith(fixture.directory), true);
    assert.equal(
      (fixture.context.beads_dir as string).startsWith(fixture.directory),
      true,
    );
    assert.deepEqual(await adapter.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    const slotBeforeWrongScope = await fixture.readWriter(
      "SELECT status, metadata, external_ref, title, design FROM sce.issues WHERE id = 'sce-merge-slot'",
    );
    const headBeforeWrongScope = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    const wrongScope = { ...scope, integrationBranch: "wrong-branch" };
    assert.deepEqual(
      await adapter.acquire({ holder, prefix: "sce", scope: wrongScope }),
      { status: "quarantined" },
    );
    assert.deepEqual(
      await adapter.acquire({ holder, prefix: "wrong", scope }),
      { status: "quarantined" },
    );
    assert.deepEqual(
      await fixture.readWriter(
        "SELECT status, metadata, external_ref, title, design FROM sce.issues WHERE id = 'sce-merge-slot'",
      ),
      slotBeforeWrongScope,
    );
    assert.deepEqual(
      await fixture.readWriter("SELECT DOLT_HASHOF('HEAD') AS head"),
      headBeforeWrongScope,
    );
    assert.deepEqual(await fixture.readWriter("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    assert.deepEqual(await adapter.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    const initialRoot = makeRootProjection(run());
    const initialChild = makeChildProjection(initialRoot, "unit-1");
    assert.ok(initialChild);
    assert.equal(
      (await adapter.acquire({ holder, prefix: "sce", scope })).status,
      "acquired",
    );
    const rawHeld = JSON.parse(
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "independent",
          "--dolt-auto-commit",
          "on",
          "merge-slot",
          "check",
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          runtime: fixture.runtime,
        },
      ),
    ) as Record<string, unknown>;
    assert.equal(rawHeld.available, false);
    assert.equal(rawHeld.holder, holder);
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialRoot,
        issueId: rootId,
      }),
      { status: "initialized" },
    );
    assert.deepEqual(
      await driver.initializeEnvelope({
        authority: "authorized_initialization",
        envelope: initialChild,
        issueId: childId,
      }),
      { status: "initialized" },
    );
    const value = batch();
    const before = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.equal((await adapter.compareAndSet(value)).status, "applied");
    const after = await fixture.readWriter(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.equal(before.status, "ok");
    assert.equal(after.status, "ok");
    if (before.status === "ok" && after.status === "ok")
      assert.notEqual(before.rows[0]?.head, after.rows[0]?.head);
    assert.deepEqual(await fixture.readWriter("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    assert.deepEqual(await adapter.compareAndSet(value), { status: "stale" });
    assert.equal(
      (
        await fixture.readWorker(
          `SELECT id FROM issues WHERE id = ${sqlLiteral(rootId)}`,
        )
      ).status,
      "ok",
    );
    assert.deepEqual(
      await fixture.readWorker(
        `UPDATE issues SET status = 'blocked' WHERE id = ${sqlLiteral(rootId)}`,
      ),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await readFixtureDolt(
        {
          cwd: fixture.directory,
          endpoint: fixture.endpoint,
          executable: fixture.executable,
          password: randomBytes(18).toString("hex"),
          user: "writer",
        },
        "SELECT 1",
      ),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await readFixtureDolt(
        {
          cwd: fixture.directory,
          endpoint: fixture.endpoint,
          executable: fixture.executable,
          password: fixture.writerPassword,
          user: "writer",
        },
        "SELECT * FROM wrong.issues",
      ),
      { status: "unavailable" },
    );
    assert.equal(
      (await adapter.release({ holder, prefix: "sce", scope })).status,
      "released",
    );
    const rawReleased = JSON.parse(
      await runBd(
        [
          "-C",
          fixture.workspace,
          "--actor",
          "independent",
          "--dolt-auto-commit",
          "on",
          "merge-slot",
          "check",
          "--json",
        ],
        {
          cwd: fixture.workspace,
          executable: fixture.bdExecutable,
          runtime: fixture.runtime,
        },
      ),
    ) as Record<string, unknown>;
    assert.equal(rawReleased.available, true);
    assert.equal(rawReleased.holder, null);
    // bd init started this private server. The adapter adopts that exact
    // status/provenance but must not claim its stop on dispose.
    await adapter.dispose();
    assert.equal((await fixture.readWriter("SELECT 1")).status, "ok");
    // The fixture explicitly owns its init-created private process; stop it
    // outside the adapter, then prove a fresh adapter owns its restart.
    await fixture.stop();
    assert.deepEqual(await fixture.readWriter("SELECT 1"), {
      status: "unavailable",
    });
    const recoveryLifecycle = new PinnedBdManagedServerProcess({
      dataDirectory: join(fixture.home, ".beads", "shared-server", "dolt"),
      doltExecutable: fixture.executable,
      executable: fixture.bdExecutable,
      runtimeEnvironment: () => ({
        HOME: fixture.runtime.home,
        XDG_CONFIG_HOME: fixture.runtime.config,
      }),
      workspace: fixture.workspace,
    });
    const recoveryDriver = new DoltBeadsServerDriver({
      identity: serverIdentity,
      rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
      slotProcess: new PinnedBdServerProcess({
        executable: fixture.bdExecutable,
        identity: serverIdentity,
        runtimeEnvironment: () => ({
          HOME: fixture.runtime.home,
          XDG_CONFIG_HOME: fixture.runtime.config,
        }),
        workspace: fixture.workspace,
      }),
      worker: fixture.worker,
      writer: fixture.writer,
    });
    const recovery = new BeadsServerAdapter({
      driver: recoveryDriver,
      identity: serverIdentity,
      process: recoveryLifecycle,
    });
    assert.deepEqual(await recovery.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    await recovery.dispose();
    assert.equal((await fixture.readWriter("SELECT 1")).status, "ok");
    await fixture.stop();
    assert.deepEqual(await fixture.readWriter("SELECT 1"), {
      status: "unavailable",
    });
  } finally {
    await fixture.stop();
    await removeFixtureDirectory(fixture.directory);
  }
});

test("default Dolt session leaves direct SQL pending and the driver refuses it", async () => {
  const fixture = await startRealDoltServer();
  const serverIdentity = identity("on", fixture.endpoint);
  const rawSqlArgs = [
    "--no-tls",
    "--host",
    "127.0.0.1",
    "--port",
    fixture.endpoint.split(":")[1]!,
    "--use-db",
    "sce",
    "--user",
    "writer",
    "sql",
  ];
  try {
    assert.deepEqual(
      await fixture.readWriter(
        "SELECT @@SESSION.dolt_transaction_commit AS dolt_transaction_commit",
      ),
      { status: "ok", rows: [{ dolt_transaction_commit: "0" }] },
    );
    await runDolt(rawSqlArgs, {
      cwd: fixture.directory,
      executable: fixture.executable,
      password: fixture.writerPassword,
      stdin: [
        "SET @@SESSION.dolt_transaction_commit = 1",
        "CREATE TABLE issues (id VARCHAR(255) NOT NULL PRIMARY KEY, title VARCHAR(500) NOT NULL, design LONGTEXT NOT NULL, status VARCHAR(32) NOT NULL, metadata JSON, external_ref VARCHAR(255))",
        "CREATE TABLE labels (issue_id VARCHAR(255) NOT NULL, label VARCHAR(255) NOT NULL)",
        "INSERT INTO issues (id, title, design, status, metadata) VALUES ('sce-control', 'Control', '', 'open', CAST('{}' AS JSON))",
      ].join(";\n"),
    });
    await runDolt(rawSqlArgs, {
      cwd: fixture.directory,
      executable: fixture.executable,
      password: fixture.writerPassword,
      stdin:
        "UPDATE issues SET status = 'in_progress' WHERE id = 'sce-control'",
    });
    const pending = await fixture.readWriter("SELECT * FROM dolt_status");
    assert.equal(pending.status, "ok");
    if (pending.status === "ok") assert.equal(pending.rows.length > 0, true);
    const driver = new DoltBeadsServerDriver({
      identity: serverIdentity,
      rows: {
        childBeadIds: { "unit-1": "sce-control" },
        rootBeadId: "sce-control",
      },
      worker: fixture.worker,
      writer: fixture.writer,
    });
    assert.deepEqual(await driver.probe(serverIdentity), { status: "refused" });
  } finally {
    await fixture.stop();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("real Dolt fixture cleans its private root before a port/listen setup failure", async () => {
  let cleanupOwned: string | undefined;
  await assert.rejects(
    startRealDoltServer({
      allocatePort: async (directory) => {
        cleanupOwned = directory;
        throw new Error("forced fixture port allocation failure");
      },
    }),
    /forced fixture port allocation failure/u,
  );
  assert.ok(cleanupOwned);
  assert.equal(cleanupOwned.startsWith("/private/tmp/sce-real-dolt-"), true);
  await assert.rejects(stat(cleanupOwned), { code: "ENOENT" });
});

test("real disposable Dolt server preserves scoped envelopes, grants, CAS rollback, and outage boundaries", async () => {
  const fixture = await startRealDoltServer();
  const rawSqlArgs = [
    "--no-tls",
    "--host",
    "127.0.0.1",
    "--port",
    fixture.endpoint.split(":")[1]!,
    "--use-db",
    "sce",
    "--user",
    "writer",
    "sql",
  ];
  try {
    await runDolt(rawSqlArgs, {
      cwd: fixture.directory,
      password: fixture.writerPassword,
      stdin:
        "CREATE TABLE issues (id VARCHAR(64) PRIMARY KEY, status VARCHAR(32), metadata JSON, external_ref VARCHAR(255))",
    });
    const initialRoot = makeRootProjection(run());
    const initialChild = makeChildProjection(initialRoot, "unit-1");
    assert.ok(initialChild);
    const rootId = "sce-root";
    const childId = "sce-child";
    await runDolt(rawSqlArgs, {
      cwd: fixture.directory,
      password: fixture.writerPassword,
      stdin: `INSERT INTO issues VALUES (${sqlLiteral(rootId)}, 'open', CAST(${sqlLiteral(JSON.stringify({ preserved: { source: "fixture" } }))} AS JSON), NULL), (${sqlLiteral(childId)}, 'open', CAST(${sqlLiteral(JSON.stringify({ unrelated: "kept" }))} AS JSON), NULL), ('sce-unrelated', 'open', CAST('{"outside":"owned-scope"}' AS JSON), NULL), ('sce-merge-slot', 'in_progress', CAST('{"holder":"run-1/incarnation-1"}' AS JSON), ${sqlLiteral(slotScopeReference(scope))})`,
    });
    for (const [issueId, envelope] of [
      [rootId, initialRoot],
      [childId, initialChild],
    ] as const) {
      await runDolt(rawSqlArgs, {
        cwd: fixture.directory,
        password: fixture.writerPassword,
        stdin: `UPDATE issues SET metadata = JSON_SET(metadata, '$.sce', CAST(${sqlLiteral(JSON.stringify(envelope))} AS JSON)) WHERE id = ${sqlLiteral(issueId)} AND JSON_EXTRACT(metadata, '$.sce') IS NULL`,
      });
    }
    const initializedRoot = await fixture.readWriter(
      `SELECT metadata FROM issues WHERE id = ${sqlLiteral(rootId)}`,
    );
    assert.equal(initializedRoot.status, "ok");
    if (initializedRoot.status !== "ok")
      throw new Error("root readback failed");
    const rootMetadata = jsonObject(initializedRoot.rows[0]?.metadata);
    assert.deepEqual(rootMetadata.preserved, {
      source: "fixture",
    });
    assert.deepEqual(rootMetadata.sce, initialRoot);

    const value = batch();
    const program = buildServerCasProgram(
      identity("on", fixture.endpoint),
      value,
      {
        childBeadIds: { "unit-1": childId },
        rootBeadId: rootId,
      },
    );
    assert.ok(program);
    await runDolt(rawSqlArgs, {
      cwd: fixture.directory,
      password: fixture.writerPassword,
      stdin:
        "UPDATE issues SET metadata = JSON_SET(metadata, '$.outside_move', 1) WHERE id = 'sce-unrelated'",
    });
    await runDolt(
      [
        "--no-tls",
        "--host",
        "127.0.0.1",
        "--port",
        fixture.endpoint.split(":")[1]!,
        "--use-db",
        "sce",
        "--user",
        "writer",
        "sql",
      ],
      {
        cwd: fixture.directory,
        password: fixture.writerPassword,
        stdin: `${program.statements.map(renderSqlStatement).join(";\n")};`,
      },
    );
    const changed = await fixture.readWriter(
      `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) AS metadata FROM issues WHERE id IN (${sqlLiteral(rootId)}, ${sqlLiteral(childId)}, 'sce-unrelated') ORDER BY id`,
    );
    assert.equal(changed.status, "ok");
    if (changed.status !== "ok") throw new Error("CAS readback failed");
    const byId = new Map(
      changed.rows.map((row) => {
        assert.notEqual(
          row.metadata,
          "",
          `empty metadata for ${String(row.id)}`,
        );
        return [row.id, jsonObject(row.metadata)];
      }),
    );
    assert.deepEqual(byId.get(rootId)?.sce, value.next.root);
    assert.deepEqual(byId.get(childId)?.sce, value.next.children[0]);
    assert.deepEqual(byId.get(rootId)?.preserved, {
      source: "fixture",
    });
    assert.deepEqual(byId.get("sce-unrelated"), {
      outside: "owned-scope",
      outside_move: 1,
    });

    await runDolt(
      [
        "--no-tls",
        "--host",
        "127.0.0.1",
        "--port",
        fixture.endpoint.split(":")[1]!,
        "--use-db",
        "sce",
        "--user",
        "writer",
        "sql",
      ],
      {
        cwd: fixture.directory,
        password: fixture.writerPassword,
        stdin: [
          "START TRANSACTION",
          `UPDATE issues SET metadata = JSON_SET(metadata, '$.rollback_probe', true) WHERE id = ${sqlLiteral(rootId)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateRevision')) = ${sqlLiteral(value.next.root.aggregateRevision)}`,
          `UPDATE issues SET metadata = JSON_SET(metadata, '$.rollback_probe', true) WHERE id = ${sqlLiteral(childId)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.revision')) = '-1'`,
          "ROLLBACK",
        ].join(";\n"),
      },
    );
    const rolledBack = await fixture.readWriter(
      `SELECT metadata FROM issues WHERE id = ${sqlLiteral(rootId)}`,
    );
    assert.equal(rolledBack.status, "ok");
    if (rolledBack.status !== "ok") throw new Error("rollback readback failed");
    assert.equal(
      Object.hasOwn(jsonObject(rolledBack.rows[0]?.metadata), "rollback_probe"),
      false,
    );

    assert.deepEqual(
      await fixture.readWorker(
        `UPDATE issues SET status = 'blocked' WHERE id = ${sqlLiteral(rootId)}`,
      ),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await readFixtureDolt(
        {
          cwd: fixture.directory,
          endpoint: fixture.endpoint,
          executable: fixture.executable,
          password: randomBytes(18).toString("hex"),
          user: "writer",
        },
        "SELECT 1",
      ),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await readFixtureDolt(
        {
          cwd: fixture.directory,
          endpoint: fixture.endpoint,
          executable: fixture.executable,
          password: fixture.writerPassword,
          user: "writer",
        },
        "SELECT * FROM wrong.issues",
      ),
      { status: "unavailable" },
    );
    await fixture.stop();
    assert.deepEqual(await fixture.readWriter("SELECT 1"), {
      status: "unavailable",
    });
  } finally {
    await fixture.stop();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("preflight refuses wrong database, missing server-enforced worker readonly, and external process fallback", async () => {
  const server = new FakeServer(identity());
  const adapter = new BeadsServerAdapter({
    driver: server,
    identity: identity(),
  });
  assert.deepEqual(await adapter.preflight(), {
    status: "refused",
    code: "BS_SERVER_REFUSED",
  });
  assert.throws(
    () =>
      new BeadsServerAdapter({
        driver: new FakeServer(externalIdentity()),
        identity: externalIdentity(),
        process: {
          start: async () => ({ status: "ok", value: undefined }),
        },
      }),
    /invalid server adapter topology/,
  );
  // Managed local requires an explicit process seam; an external adapter does not.
  let started = 0;
  const managed = new BeadsServerAdapter({
    driver: server,
    identity: identity(),
    process: {
      start: async () => {
        started += 1;
        return { status: "ok", value: undefined };
      },
    },
  });
  assert.deepEqual(await managed.preflight(), {
    status: "ready",
    identity: identity(),
  });
  assert.equal(started, 1);
  server.readOnly = false;
  assert.deepEqual(await managed.preflight(), {
    status: "refused",
    code: "BS_READ_ONLY_NOT_ENFORCED",
  });
});
