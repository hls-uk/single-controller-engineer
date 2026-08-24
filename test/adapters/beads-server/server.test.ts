import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";

import {
  BeadsServerAdapter,
  buildServerCasProgram,
  DoltBeadsServerDriver,
  executeServerSqlProgram,
  deriveServerIdentity,
  parseServerCasReadback,
  PinnedBdServerProcess,
  slotScopeReference,
  DoltSqlTransport,
  type BeadsServerDriver,
  type ServerAutoCommitPolicy,
  type ServerDriverResponse,
  type ServerIdentity,
} from "../../../src/adapters/beads-server/index.js";
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
  withBatchCheckpoint,
} from "../../../src/fencing/index.js";
import type { BeadsIdentity } from "../../../src/preflight/index.js";
import { deriveIdempotencyKey, reduce } from "../../../src/protocol/reducer.js";
import {
  canonicalJson,
  type JsonValue,
} from "../../../src/protocol/canonical.js";
import { event, run } from "../../protocol/fixtures.js";

const scope: FencingScope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};
const holder = "run-1/incarnation-1";

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
): MergeSlotObservation {
  const withoutHash = {
    actor,
    ...(slotHolder === undefined ? {} : { holder: slotHolder }),
    label: "gt:slot" as const,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status,
    title: "Merge Slot" as const,
    version: 1 as const,
  };
  return { ...withoutHash, readbackHash: deriveSlotReadbackHash(withoutHash) };
}

function batch(): MutationBatch {
  const before = makeRootProjection(run());
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

async function runBd(
  args: readonly string[],
  input: Readonly<{
    cwd: string;
    executable: string;
    password?: string;
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
        PATH: `${dirname(input.executable)}:/usr/bin:/bin`,
      },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`bd fixture command failed: ${args.join(" ")}`)),
    );
  });
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
  root: DoltSqlTransport;
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

type ManagedDoltServer = RealDoltServer &
  Readonly<{
    lifecycle: Readonly<{
      start: () => Promise<ServerDriverResponse<void>>;
      stop: () => Promise<void>;
    }>;
    starts: () => number;
    stops: () => number;
  }>;

async function startRealDoltServer(
  input: Readonly<{
    identityForEndpoint?: (endpoint: string) => ServerIdentity;
  }> = {},
): Promise<RealDoltServer> {
  const executable =
    process.env.DOLT_TEST_EXECUTABLE ?? "/opt/homebrew/bin/dolt";
  const directory = await mkdtemp(join(process.cwd(), ".sce-real-dolt-"));
  const databaseDirectory = join(directory, "sce");
  const port = await unusedLoopbackPort();
  let server: ChildProcess | undefined;
  try {
    await mkdir(databaseDirectory);
    await runDolt(["init"], { cwd: databaseDirectory, executable });
    server = spawn(
      executable,
      [
        "sql-server",
        "--data-dir",
        directory,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--socket",
        join(directory, "mysql.sock"),
        "--allow-cleartext-passwords",
        "--loglevel=error",
      ],
      {
        cwd: directory,
        env: { PATH: `${dirname(executable)}:/usr/bin:/bin` },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    const endpoint = `127.0.0.1:${port}`;
    const serverIdentity =
      input.identityForEndpoint?.(endpoint) ?? identity("on", endpoint);
    const root = new DoltSqlTransport({
      executable,
      identity: serverIdentity,
      user: "root",
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await root.query("SELECT 1 AS ready")).status === "ok") break;
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
        cwd: directory,
        executable,
        stdin: [
          `CREATE USER 'writer' IDENTIFIED BY '${writerPassword}';`,
          "GRANT ALL ON sce.* TO 'writer';",
          `CREATE USER 'worker' IDENTIFIED BY '${workerPassword}';`,
          "GRANT SELECT ON sce.* TO 'worker';",
        ].join("\n"),
      },
    );
    return {
      directory,
      endpoint,
      executable,
      root,
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
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

/**
 * Managed-local fixture boundary. It deliberately does not invoke bd
 * --shared-server, which would use the operator's global shared-server home.
 * Its lifecycle owns this disposable loopback sql-server process instead.
 */
async function createManagedDoltServer(): Promise<ManagedDoltServer> {
  const executable =
    process.env.DOLT_TEST_EXECUTABLE ?? "/opt/homebrew/bin/dolt";
  const directory = await mkdtemp(join(process.cwd(), ".sce-managed-dolt-"));
  const databaseDirectory = join(directory, "sce");
  const port = await unusedLoopbackPort();
  const endpoint = `127.0.0.1:${port}`;
  const serverIdentity = identity("on", endpoint);
  const writerPassword = randomBytes(18).toString("hex");
  const workerPassword = randomBytes(18).toString("hex");
  let server: ChildProcess | undefined;
  let provisioned = false;
  let startCount = 0;
  let stopCount = 0;
  const root = new DoltSqlTransport({
    executable,
    identity: serverIdentity,
    user: "root",
  });
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
  const stop = async (): Promise<void> => {
    stopCount += 1;
    if (server !== undefined) await stopDoltServer(server);
  };
  try {
    await mkdir(databaseDirectory);
    await runDolt(["init"], { cwd: databaseDirectory, executable });
    const lifecycle = {
      start: async (): Promise<ServerDriverResponse<void>> => {
        if (server !== undefined && server.exitCode === null)
          return { status: "ok", value: undefined };
        startCount += 1;
        server = spawn(
          executable,
          [
            "sql-server",
            "--data-dir",
            directory,
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
            "--socket",
            join(directory, "mysql.sock"),
            "--allow-cleartext-passwords",
            "--loglevel=error",
          ],
          {
            cwd: directory,
            env: { PATH: `${dirname(executable)}:/usr/bin:/bin` },
            stdio: ["ignore", "ignore", "ignore"],
          },
        );
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if ((await root.query("SELECT 1 AS ready")).status === "ok") break;
          if (server.exitCode !== null) return { status: "unavailable" };
          await delay(50);
          if (attempt === 99) return { status: "unavailable" };
        }
        if (provisioned) return { status: "ok", value: undefined };
        try {
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
              cwd: directory,
              executable,
              stdin: [
                `CREATE USER 'writer' IDENTIFIED BY '${writerPassword}'`,
                "GRANT ALL ON sce.* TO 'writer'",
                `CREATE USER 'worker' IDENTIFIED BY '${workerPassword}'`,
                "GRANT SELECT ON sce.* TO 'worker'",
              ].join(";\n"),
            },
          );
          await runDolt(
            [
              "--no-tls",
              "--host",
              "127.0.0.1",
              "--port",
              String(port),
              "--use-db",
              "sce",
              "--user",
              "writer",
              "sql",
            ],
            {
              cwd: directory,
              executable,
              password: writerPassword,
              stdin: [
                "SET @@SESSION.dolt_transaction_commit = 1",
                "CREATE TABLE issues (id VARCHAR(255) NOT NULL PRIMARY KEY, title VARCHAR(500) NOT NULL, design LONGTEXT NOT NULL, status VARCHAR(32) NOT NULL, metadata JSON, external_ref VARCHAR(255))",
                "CREATE TABLE labels (issue_id VARCHAR(255) NOT NULL, label VARCHAR(255) NOT NULL)",
              ].join(";\n"),
            },
          );
          provisioned = true;
          return { status: "ok", value: undefined };
        } catch {
          await stop();
          return { status: "unavailable" };
        }
      },
      stop,
    };
    return {
      directory,
      endpoint,
      executable,
      lifecycle,
      root,
      starts: () => startCount,
      stop,
      stops: () => stopCount,
      worker,
      workerPassword,
      writer,
      writerPassword,
    };
  } catch (error) {
    await stop();
    await rm(directory, { force: true, recursive: true });
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
    const slotIdentity = await fixture.writer.query(
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
      await fixture.writer.query(
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
  readOnly = true;
  outage: "none" | "before" | "after" = "none";
  commitOverride: "auto" | "explicit" | undefined;
  discoveryCalls = 0;

  constructor(
    serverIdentity: ServerIdentity,
    slotValue = slot("available", undefined, holder),
  ) {
    this.#identity = serverIdentity;
    this.slot = slotValue;
    this.root = makeRootProjection(run());
  }

  async probe() {
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
    if (this.slot === undefined) return { status: "refused" as const };
    if (
      input.prefix !== "sce" ||
      deriveScopeCommitment(input.scope) !== this.slot.scopeCommitment
    )
      return { status: "refused" as const };
    if (this.slot.status === "available")
      this.slot = slot("acquired", input.actor, input.actor);
    return {
      status: "ok" as const,
      value: {
        observation: this.slot,
        scopeReference: slotScopeReference(input.scope),
      },
    };
  }

  async mergeSlotCheck(input: { prefix: string; scope: FencingScope }) {
    if (
      this.slot === undefined ||
      input.prefix !== "sce" ||
      deriveScopeCommitment(input.scope) !== this.slot.scopeCommitment
    )
      return { status: "refused" as const };
    return {
      status: "ok" as const,
      value: {
        observation: this.slot,
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
    return {
      status: "ok",
      value: {
        checkpoint: this.root.checkpoint,
        children: Object.keys(this.root.run.units)
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

test("concrete Dolt transport allows plaintext only for loopback endpoints", async () => {
  const requests: unknown[] = [];
  const transport = new DoltSqlTransport({
    identity: identity(),
    password: "value-not-logged",
    process: async (request) => {
      requests.push(request);
      return { exitCode: 0, output: '[{"ok":1}]', timedOut: false };
    },
    user: "writer",
  });
  assert.deepEqual(await transport.query("SELECT 1 AS ok"), {
    status: "ok",
    rows: [{ ok: 1 }],
  });
  assert.deepEqual(requests, [
    {
      argv: [
        "--no-tls",
        "--host",
        "127.0.0.1",
        "--port",
        "3306",
        "--use-db",
        "sce",
        "--user",
        "writer",
        "sql",
        "-q",
        "SELECT 1 AS ok",
        "-r",
        "json",
      ],
      executable: "",
      env: { DOLT_CLI_PASSWORD: "value-not-logged", PATH: process.env.PATH },
      timeoutMs: 15_000,
    },
  ]);
  const tlsRequests: unknown[] = [];
  const external = new DoltSqlTransport({
    identity: {
      ...identity(),
      credentialProvenance: "environment",
      endpoint: "db.example.test:3306",
      topology: "external_server",
      transportSecurity: "tls",
    },
    process: async (request) => {
      tlsRequests.push(request);
      return { exitCode: 0, output: "[]", timedOut: false };
    },
    user: "writer",
  });
  assert.deepEqual(await external.query("SELECT 1"), {
    status: "ok",
    rows: [],
  });
  assert.equal(
    (tlsRequests[0] as { argv: readonly string[] }).argv.includes("--no-tls"),
    false,
  );
  assert.deepEqual(
    await transport.query("UPDATE issues SET status = 'blocked'"),
    {
      status: "refused",
    },
  );
  const timedOut = new DoltSqlTransport({
    identity: identity(),
    process: async () => ({ exitCode: undefined, output: "", timedOut: true }),
    user: "writer",
  });
  assert.deepEqual(await timedOut.query("SELECT 1"), { status: "unavailable" });
  const oversized = new DoltSqlTransport({
    identity: identity(),
    process: async () => ({
      exitCode: 0,
      output: " ".repeat(65_537),
      timedOut: false,
    }),
    user: "writer",
  });
  assert.deepEqual(await oversized.query("SELECT 1"), {
    status: "unavailable",
  });
  const loopbackExternal = new DoltSqlTransport({
    identity: externalIdentity(),
    process: async () => ({ exitCode: 0, output: "[]", timedOut: false }),
    user: "writer",
  });
  assert.deepEqual(await loopbackExternal.query("SELECT 1"), {
    status: "ok",
    rows: [],
  });
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

  const directory = await mkdtemp(join(process.cwd(), ".sce-pinned-bd-"));
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

test("concrete driver rejects missing labels schema and merge-slot label skew", async () => {
  const missingLabels = new DoltSqlTransport({
    identity: identity(),
    process: async (request) => {
      const query = request.argv.at(request.argv.indexOf("-q") + 1) ?? "";
      if (query === "SELECT DATABASE() AS current_database")
        return {
          exitCode: 0,
          output: '[{"current_database":"sce"}]',
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
  assert.deepEqual(await missingLabelsDriver.probe(), { status: "refused" });

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
    assert.deepEqual(await driver.probe(), { status: "refused" });
  }
});

test("authoritative slot CAS has no lazy creation, validates scope, and rejects contenders", async () => {
  const fake = new FakeServer(identity());
  const first = new BeadsServerAdapter({ driver: fake, identity: identity() });
  const second = new BeadsServerAdapter({ driver: fake, identity: identity() });
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

test("server transaction predicates holder/revisions, preserves unrelated rows, and reads back exact projections", async () => {
  const fake = new FakeServer(identity());
  const adapter = new BeadsServerAdapter({
    driver: fake,
    identity: identity(),
  });
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
    });
    await adapter.acquire({ holder, prefix: "sce", scope });
    assert.equal((await adapter.compareAndSet(batch())).status, "applied");
  }
  const wrongCommit = new FakeServer(identity("off"));
  wrongCommit.commitOverride = "auto";
  const wrongAdapter = new BeadsServerAdapter({
    driver: wrongCommit,
    identity: identity("off"),
  });
  await wrongAdapter.acquire({ holder, prefix: "sce", scope });
  assert.deepEqual(await wrongAdapter.compareAndSet(batch()), {
    status: "quarantined",
  });

  const outage = new FakeServer(identity());
  outage.outage = "after";
  const outageAdapter = new BeadsServerAdapter({
    driver: outage,
    identity: identity(),
  });
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
    const initialRoot = makeRootProjection(run());
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
    assert.deepEqual(await fixture.writer.query("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    const initialHead = await fixture.writer.query(
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
      await new DoltSqlTransport({
        executable: fixture.executable,
        identity: serverIdentity,
        password: randomBytes(18).toString("hex"),
        user: "writer",
      }).query("SELECT 1"),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await new DoltSqlTransport({
        executable: fixture.executable,
        identity: { ...serverIdentity, database: "wrong" },
        password: fixture.writerPassword,
        user: "writer",
      }).query("SELECT 1"),
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
    const sqlHeld = await fixture.writer.query(
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
          workspace: fixture.workspace,
        }),
        worker: fixture.worker,
        writer: fixture.writer,
      }),
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
    const value = batch();
    const beforeCasHead = await fixture.writer.query(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    const applied = await adapter.compareAndSet(value);
    const afterCasHead = await fixture.writer.query(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.equal(applied.status, "applied");
    assert.equal(beforeCasHead.status, "ok");
    assert.equal(afterCasHead.status, "ok");
    if (beforeCasHead.status === "ok" && afterCasHead.status === "ok")
      assert.notEqual(afterCasHead.rows[0]?.head, beforeCasHead.rows[0]?.head);
    assert.deepEqual(await fixture.writer.query("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    const unrelated = await fixture.writer.query(
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
    const beforeStaleHead = await fixture.writer.query(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    const staleResult = await adapter.compareAndSet(value);
    const afterStaleHead = await fixture.writer.query(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.deepEqual(afterStaleHead, beforeStaleHead);
    assert.deepEqual(await fixture.writer.query("SELECT * FROM dolt_status"), {
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
    const staleRoot = await fixture.writer.query(
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
          workspace: fixture.workspace,
        }),
        worker: fixture.worker,
        writer: fixture.writer,
      }),
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
    assert.deepEqual(await driver.probe(), { status: "unavailable" });
  } finally {
    await fixture.stop();
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test("managed lifecycle owns a real local server and recovers without embedded fallback", async () => {
  const fixture = await createManagedDoltServer();
  const serverIdentity = identity("on", fixture.endpoint);
  const rootId = "sce-managed-root";
  const childId = "sce-managed-child";
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
  const driver = new DoltBeadsServerDriver({
    identity: serverIdentity,
    rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
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
    assert.deepEqual(await adapter.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    assert.equal(fixture.starts(), 1);
    const initialRoot = makeRootProjection(run());
    const initialChild = makeChildProjection(initialRoot, "unit-1");
    assert.ok(initialChild);
    await runDolt(rawSqlArgs, {
      cwd: fixture.directory,
      executable: fixture.executable,
      password: fixture.writerPassword,
      stdin: [
        "SET @@SESSION.dolt_transaction_commit = 1",
        `INSERT INTO issues (id, title, design, status, metadata, external_ref) VALUES (${sqlLiteral(rootId)}, 'Managed root', '', 'open', CAST('{"preserved":"managed"}' AS JSON), NULL), (${sqlLiteral(childId)}, 'Managed child', '', 'open', CAST('{"preserved":"child"}' AS JSON), NULL), ('sce-merge-slot', 'Merge Slot', ${sqlLiteral(canonicalJson(scope as JsonValue))}, 'in_progress', CAST(${sqlLiteral(JSON.stringify({ holder }))} AS JSON), ${sqlLiteral(slotScopeReference(scope))})`,
        "INSERT INTO labels (issue_id, label) VALUES ('sce-merge-slot', 'gt:slot')",
      ].join(";\n"),
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
        envelope: initialChild,
        issueId: childId,
      }),
      { status: "initialized" },
    );
    const value = batch();
    const before = await fixture.writer.query(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.equal((await adapter.compareAndSet(value)).status, "applied");
    const after = await fixture.writer.query(
      "SELECT DOLT_HASHOF('HEAD') AS head",
    );
    assert.equal(before.status, "ok");
    assert.equal(after.status, "ok");
    if (before.status === "ok" && after.status === "ok")
      assert.notEqual(before.rows[0]?.head, after.rows[0]?.head);
    assert.deepEqual(await fixture.writer.query("SELECT * FROM dolt_status"), {
      status: "ok",
      rows: [],
    });
    assert.deepEqual(await adapter.compareAndSet(value), { status: "stale" });
    assert.deepEqual(
      await new DoltSqlTransport({
        executable: fixture.executable,
        identity: serverIdentity,
        password: randomBytes(18).toString("hex"),
        user: "writer",
      }).query("SELECT 1"),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await new DoltSqlTransport({
        executable: fixture.executable,
        identity: { ...serverIdentity, database: "wrong" },
        password: fixture.writerPassword,
        user: "writer",
      }).query("SELECT 1"),
      { status: "unavailable" },
    );
    await adapter.dispose();
    assert.equal(fixture.stops(), 1);
    assert.deepEqual(await fixture.writer.query("SELECT 1"), {
      status: "unavailable",
    });
    const recoveryDriver = new DoltBeadsServerDriver({
      identity: serverIdentity,
      rows: { childBeadIds: { "unit-1": childId }, rootBeadId: rootId },
      worker: fixture.worker,
      writer: fixture.writer,
    });
    const recovery = new BeadsServerAdapter({
      driver: recoveryDriver,
      identity: serverIdentity,
      process: fixture.lifecycle,
    });
    assert.deepEqual(await recovery.preflight(), {
      status: "ready",
      identity: serverIdentity,
    });
    assert.equal(fixture.starts(), 2);
    await recovery.dispose();
    assert.equal(fixture.stops(), 2);
  } finally {
    await fixture.stop();
    await rm(fixture.directory, { force: true, recursive: true });
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
      await fixture.writer.query(
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
    const pending = await fixture.writer.query("SELECT * FROM dolt_status");
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
    assert.deepEqual(await driver.probe(), { status: "refused" });
  } finally {
    await fixture.stop();
    await rm(fixture.directory, { force: true, recursive: true });
  }
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
    const initializedRoot = await fixture.writer.query(
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
    const changed = await fixture.writer.query(
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
    const rolledBack = await fixture.writer.query(
      `SELECT metadata FROM issues WHERE id = ${sqlLiteral(rootId)}`,
    );
    assert.equal(rolledBack.status, "ok");
    if (rolledBack.status !== "ok") throw new Error("rollback readback failed");
    assert.equal(
      Object.hasOwn(jsonObject(rolledBack.rows[0]?.metadata), "rollback_probe"),
      false,
    );

    assert.deepEqual(
      await fixture.worker.query(
        `UPDATE issues SET status = 'blocked' WHERE id = ${sqlLiteral(rootId)}`,
      ),
      { status: "refused" },
    );
    assert.deepEqual(
      await new DoltSqlTransport({
        executable: fixture.executable,
        identity: identity("on", fixture.endpoint),
        password: randomBytes(18).toString("hex"),
        user: "writer",
      }).query("SELECT 1"),
      { status: "unavailable" },
    );
    assert.deepEqual(
      await new DoltSqlTransport({
        executable: fixture.executable,
        identity: { ...identity("on", fixture.endpoint), database: "wrong" },
        password: fixture.writerPassword,
        user: "writer",
      }).query("SELECT 1"),
      { status: "unavailable" },
    );
    await fixture.stop();
    assert.deepEqual(await fixture.writer.query("SELECT 1"), {
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
          stop: async () => undefined,
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
      stop: async () => undefined,
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
