/**
 * Shared-Dolt server adapter.
 *
 * This module deliberately talks to a small injected driver instead of a SQL
 * client.  The production driver is responsible for issuing the pinned SQL/
 * bd operations; keeping that boundary explicit makes it impossible for this
 * layer to quietly substitute an embedded store or a read-then-write CAS.
 */
import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import {
  containsSecretShape,
  isSchema,
  type BeadsIdentity,
} from "../../preflight/index.js";
import { strictObject } from "../../preflight/schemas.js";
import {
  CheckpointObservationSchema,
  decideControllerSlot,
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  type FencingScope,
  type MergeSlotObservation,
  type MutationBatch,
  type RunStorePort,
  type RunStoreResult,
  RunStoreResultSchema,
  validateChildProjection,
  validateMergeSlotObservation,
  validateMutationBatch,
  validateRootProjection,
  validateSlotRelease,
} from "../../fencing/index.js";

const MAX_ENDPOINT_BYTES = 320;
const MAX_SCHEMA_BYTES = 160;
const MAX_FINGERPRINT_BYTES = 160;
const bytes = new TextEncoder();

export type ServerCredentialProvenance =
  "environment" | "managed_local_runtime";
export type ServerAutoCommitPolicy = "on" | "off" | "batch";
export type ServerTopology = "managed_local_shared_server" | "external_server";
export type ServerTransportSecurity = "tls" | "loopback_plaintext";

/** Never contains a DSN, username/password, token, or certificate value. */
export type ServerIdentity = Readonly<{
  autoCommitPolicy: ServerAutoCommitPolicy;
  credentialProvenance: ServerCredentialProvenance;
  /** A non-secret stable label for audit only, never a credential value. */
  credentialReference: string;
  database: string;
  endpoint: string;
  prefix: string;
  schema: string;
  topology: ServerTopology;
  transportSecurity: ServerTransportSecurity;
  /** Separate non-secret reference; must never equal the writer reference. */
  workerCredentialReference: string;
}>;

const DOLT_SQL_TIMEOUT_MS = 15_000;
// A schema-valid mutation batch is bounded at 256 KiB. Rendering its canonical
// JSON as hex SQL literals doubles that payload, and the guarded statement
// repeats compact predicates/readback framing. Keep one bounded 1 MiB ceiling
// for that concrete wire form and for the corresponding JSON readback.
const DOLT_SQL_MAX_STATEMENT_BYTES = 1_048_576;
const DOLT_SQL_MAX_OUTPUT_BYTES = 1_048_576;
const DOLT_SQL_MAX_ERROR_BYTES = 4_096;
const BD_PROCESS_TIMEOUT_MS = 15_000;
const BD_PROCESS_MAX_OUTPUT_BYTES = 16_384;
const PROCESS_TERM_GRACE_MS = 250;
const EXECUTABLE_SAMPLE_BYTES = 4_096;

export type DoltSqlProcessRequest = Readonly<{
  argv: readonly string[];
  executable: string;
  env: Readonly<Record<string, string | undefined>>;
  timeoutMs: number;
}>;
export type DoltSqlProcessResult = Readonly<{
  exitCode: number | undefined;
  output: string;
  /** Internal bounded diagnostic only; never returned to transport callers. */
  stderr?: string;
  timedOut: boolean;
}>;
export type DoltSqlProcess = (
  request: DoltSqlProcessRequest,
) => Promise<DoltSqlProcessResult>;

type DoltSqlExecution =
  | Readonly<{ status: "ok"; output: string }>
  | Readonly<{ status: "unavailable" | "refused" }>;
type DoltSqlTransactionExecution =
  | Readonly<{ status: "ok"; rows: number }>
  | Readonly<{ status: "unavailable" | "refused" }>;

/**
 * The exported transport must expose no mutation-capable property, including
 * a discoverable symbol. These closures are installed per instance in a
 * module-scoped WeakMap and can only be reached by the closed driver helpers
 * below; reflection over an exported transport cannot discover the map or
 * obtain an invocation handle.
 */
type DoltSqlTransportOperations = Readonly<{
  executeProgram: (query: string) => Promise<
    | Readonly<{
        status: "ok";
        results: readonly (readonly Record<string, unknown>[])[];
      }>
    | Readonly<{ status: "unavailable" | "refused" }>
  >;
  executeTransaction: (
    statement: string,
    expectedRows: number,
  ) => Promise<DoltSqlTransactionExecution>;
  probeWorkerWrite: () => Promise<
    "allowed" | "denied" | "refused" | "unavailable"
  >;
}>;

const doltSqlTransportOperations = new WeakMap<
  DoltSqlTransport,
  DoltSqlTransportOperations
>();

function executeDoltSqlProgram(
  transport: DoltSqlTransport,
  query: string,
): ReturnType<DoltSqlTransportOperations["executeProgram"]> {
  return (
    doltSqlTransportOperations.get(transport)?.executeProgram(query) ??
    Promise.resolve({ status: "refused" } as const)
  );
}

function executeDoltSqlTransaction(
  transport: DoltSqlTransport,
  statement: string,
  expectedRows: number,
): Promise<DoltSqlTransactionExecution> {
  return (
    doltSqlTransportOperations
      .get(transport)
      ?.executeTransaction(statement, expectedRows) ??
    Promise.resolve({ status: "refused" } as const)
  );
}

function probeDoltSqlWorkerWrite(
  transport: DoltSqlTransport,
): ReturnType<DoltSqlTransportOperations["probeWorkerWrite"]> {
  return (
    doltSqlTransportOperations.get(transport)?.probeWorkerWrite() ??
    Promise.resolve("refused" as const)
  );
}

type ExecutableSnapshot = Readonly<{
  canonical: string;
  fingerprint: string;
}>;

/**
 * Fingerprint a canonical executable without reading an unbounded binary into
 * memory. Metadata catches replacement and a bounded first/last digest closes
 * the same-inode, same-size substitution gap. Callers poison their pin on any
 * difference rather than accepting a later matching-version replacement.
 */
async function executableSnapshot(
  executable: string,
): Promise<ExecutableSnapshot | undefined> {
  try {
    const canonical = await realpath(executable);
    const information = await stat(canonical);
    if (!information.isFile() || (information.mode & 0o111) === 0)
      return undefined;
    const sampleSize = Math.min(information.size, EXECUTABLE_SAMPLE_BYTES);
    const handle = await open(canonical, "r");
    try {
      const first = Buffer.alloc(sampleSize);
      const firstRead = await handle.read(first, 0, sampleSize, 0);
      const lastOffset = Math.max(0, information.size - sampleSize);
      const last = Buffer.alloc(sampleSize);
      const lastRead = await handle.read(last, 0, sampleSize, lastOffset);
      const digest = createHash("sha256")
        .update("first\0")
        .update(first.subarray(0, firstRead.bytesRead))
        .update("last\0")
        .update(last.subarray(0, lastRead.bytesRead))
        .digest("hex");
      return {
        canonical,
        fingerprint: [
          canonical,
          information.dev,
          information.ino,
          information.size,
          information.mtimeMs,
          information.ctimeMs,
          information.mode,
          digest,
        ].join(":"),
      };
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Internal fault boundaries for the one real `dolt sql` transaction child.
 * This deliberately exposes no SQL, environment, credential, or stdin
 * authority: tests can only stop or pause the already-spawned child.
 *
 * @internal Test-only qualification seam. Production leaves it unset.
 */
export type DoltSqlTransactionTestPhase =
  | "after_guarded_write_before_rowcount"
  | "after_rowcount_before_commit"
  | "after_commit_before_outcome"
  | "after_commit_marker_before_close";

type DoltSqlTransactionTestHook = (
  input: Readonly<{
    abort: () => void;
    pause: () => void;
    phase: DoltSqlTransactionTestPhase;
  }>,
) => void;

let doltSqlTransactionTestHook: DoltSqlTransactionTestHook | undefined;

/** @internal Installs a child-lifecycle-only hook for real transport tests. */
export function __setDoltSqlTransactionTestHookForTests(
  hook: DoltSqlTransactionTestHook | undefined,
): () => void {
  const previous = doltSqlTransactionTestHook;
  doltSqlTransactionTestHook = hook;
  return () => {
    if (doltSqlTransactionTestHook === hook)
      doltSqlTransactionTestHook = previous;
  };
}

function parseDoltRows(
  output: string,
): readonly Record<string, unknown>[] | undefined {
  const decoded = JSON.parse(output) as unknown;
  const parsed = Array.isArray(decoded)
    ? decoded
    : decoded !== null &&
        typeof decoded === "object" &&
        !Array.isArray(decoded) &&
        Object.keys(decoded).length === 0
      ? []
      : decoded !== null &&
          typeof decoded === "object" &&
          !Array.isArray(decoded) &&
          Object.keys(decoded).length === 1 &&
          Object.hasOwn(decoded, "rows") &&
          Array.isArray((decoded as { rows: unknown }).rows)
        ? (decoded as { rows: unknown[] }).rows
        : undefined;
  if (
    parsed === undefined ||
    containsSecretShape(decoded) ||
    !parsed.every(
      (row) => row !== null && typeof row === "object" && !Array.isArray(row),
    )
  )
    return undefined;
  return parsed as readonly Record<string, unknown>[];
}

function readOnlySql(query: string): boolean {
  return (
    /^\s*(?:SELECT|SHOW|DESCRIBE|EXPLAIN)\b/iu.test(query) &&
    !query.includes(";")
  );
}

function loopbackEndpoint(endpoint: string): boolean {
  const host = endpoint.startsWith("[")
    ? endpoint.slice(1, endpoint.indexOf("]"))
    : endpoint.split(":", 1)[0];
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Concrete pinned `dolt sql` process transport. It accepts JSON results only;
 * stderr, passwords, and arbitrary inherited environment are never returned.
 */
export class DoltSqlTransport {
  readonly #identity: ServerIdentity;
  readonly #executable: string | undefined;
  readonly #password: string | undefined;
  readonly #process: DoltSqlProcess;
  readonly #user: string;
  #executablePoisoned = false;
  #executableSnapshot: ExecutableSnapshot | undefined;
  #verifiedExecutable: string | undefined;

  constructor(
    input: Readonly<{
      identity: ServerIdentity;
      executable?: string;
      password?: string;
      process?: DoltSqlProcess;
      user: string;
    }>,
  ) {
    if (
      !validIdentifier(input.user) ||
      (input.executable !== undefined && !isAbsolute(input.executable)) ||
      (input.process === undefined && input.executable === undefined) ||
      (input.identity.transportSecurity === "loopback_plaintext" &&
        !loopbackEndpoint(input.identity.endpoint)) ||
      (input.identity.topology === "external_server" &&
        input.identity.transportSecurity !== "tls" &&
        input.identity.transportSecurity !== "loopback_plaintext") ||
      (input.password !== undefined &&
        (!safeText(input.password, 4_096) ||
          containsSecretShape(input.password)))
    )
      throw new Error("invalid Dolt SQL transport configuration");
    this.#identity = input.identity;
    this.#executable = input.executable;
    this.#password = input.password;
    this.#process = input.process ?? runDoltSql;
    this.#user = input.user;
    doltSqlTransportOperations.set(
      this,
      Object.freeze({
        executeProgram: (query) => this.#executeProgram(query),
        executeTransaction: (statement, expectedRows) =>
          this.#executeTransaction(statement, expectedRows),
        probeWorkerWrite: () => this.#probeWorkerWrite(),
      }),
    );
  }

  /** Read-only diagnostics and readbacks; server mutations use a private seam. */
  async query(
    query: string,
  ): Promise<
    | Readonly<{ status: "ok"; rows: readonly Record<string, unknown>[] }>
    | Readonly<{ status: "unavailable" | "refused" }>
  > {
    if (
      !safeText(query, DOLT_SQL_MAX_STATEMENT_BYTES) ||
      containsSecretShape(query) ||
      !readOnlySql(query)
    )
      return { status: "refused" };
    const result = await this.#execute(query);
    if (result.status !== "ok") return result;
    try {
      const rows = parseDoltRows(result.output);
      return rows === undefined
        ? { status: "refused" }
        : { status: "ok", rows };
    } catch {
      return { status: "refused" };
    }
  }

  async #executeProgram(query: string): Promise<
    | Readonly<{
        status: "ok";
        results: readonly (readonly Record<string, unknown>[])[];
      }>
    | Readonly<{ status: "unavailable" | "refused" }>
  > {
    // The module-private WeakMap closure receives only SQL assembled from
    // validated projections. Do not apply heuristic text secret matching to
    // canonical protocol JSON: legitimate field names include `Token`.
    if (!safeText(query, DOLT_SQL_MAX_STATEMENT_BYTES))
      return { status: "refused" };
    const result = await this.#execute(query);
    if (result.status !== "ok") return result;
    try {
      const output = result.output.trim();
      const results =
        output.length === 0
          ? []
          : output
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map(parseDoltRows);
      return results.some((rows) => rows === undefined)
        ? { status: "refused" }
        : {
            status: "ok",
            results: results as readonly (readonly Record<string, unknown>[])[],
          };
    } catch {
      return { status: "refused" };
    }
  }

  async #executeTransaction(
    statement: string,
    expectedRows: number,
  ): Promise<DoltSqlTransactionExecution> {
    if (
      !safeText(statement, DOLT_SQL_MAX_STATEMENT_BYTES) ||
      !Number.isSafeInteger(expectedRows) ||
      expectedRows < 1 ||
      this.#process !== runDoltSql
    )
      return { status: "refused" };
    const [host, port] = this.#endpointParts();
    const executable = await this.#verifiedDoltExecutable();
    if (host === undefined || port === undefined || executable === undefined)
      return { status: "refused" };
    if ((await this.#pinnedDoltExecutable()) !== executable)
      return { status: "refused" };
    const argv = [
      ...(this.#identity.transportSecurity === "loopback_plaintext"
        ? ["--no-tls"]
        : []),
      "--host",
      host,
      "--port",
      port,
      "--use-db",
      this.#identity.database,
      "--user",
      this.#user,
      "sql",
      "-r",
      "json",
    ];
    return runDoltSqlTransaction({
      argv,
      executable,
      expectedRows,
      password: this.#password,
      statement,
    });
  }

  /**
   * Private, constant no-op capability probe. It never accepts caller SQL and
   * reports denial only for Dolt's exact pinned table-write permission error.
   * Every other failure is deliberately non-evidence.
   */
  async #probeWorkerWrite(): Promise<
    "allowed" | "denied" | "refused" | "unavailable"
  > {
    const [host, port] = this.#endpointParts();
    const executable = await this.#verifiedDoltExecutable();
    const database = quotedIdentifier(this.#identity.database);
    if (
      host === undefined ||
      port === undefined ||
      executable === undefined ||
      database === undefined ||
      (await this.#pinnedDoltExecutable()) !== executable
    )
      return "refused";
    const statement = `UPDATE ${database}.issues SET status = status WHERE 1 = 0`;
    try {
      const result = await this.#process({
        argv: [
          ...(this.#identity.transportSecurity === "loopback_plaintext"
            ? ["--no-tls"]
            : []),
          "--host",
          host,
          "--port",
          port,
          "--use-db",
          this.#identity.database,
          "--user",
          this.#user,
          "sql",
          "-q",
          statement,
          "-r",
          "json",
        ],
        executable,
        env: {
          DOLT_CLI_PASSWORD: this.#password ?? "",
          PATH: `${dirname(executable)}:/usr/bin:/bin`,
        },
        timeoutMs: DOLT_SQL_TIMEOUT_MS,
      });
      // Dolt CLI writes the pinned MySQL error on stderr in server mode, but
      // some supported terminal modes route it to stdout. It remains bounded,
      // private, and is only compared to the exact denial diagnostic below.
      const diagnostic =
        (result.stderr ?? "").trim().length > 0
          ? (result.stderr ?? "")
          : result.output;
      if (
        result.timedOut ||
        result.exitCode === undefined ||
        Buffer.byteLength(result.output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES ||
        Buffer.byteLength(diagnostic, "utf8") > DOLT_SQL_MAX_ERROR_BYTES ||
        containsSecretShape(diagnostic)
      )
        return "unavailable";
      if (result.exitCode === 0) return "allowed";
      // Pinned Dolt 2.2.1 emits this exact 1105 wrapper and command-denied
      // diagnostic for the constant issues-table UPDATE. Do not treat login,
      // network, parser, timeout, or generic nonzero failures as denial.
      const escapedStatement = statement.replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      );
      const denied = new RegExp(
        `^error on line 1 for query ${escapedStatement}: Error 1105 \\(HY000\\): command denied to user '${this.#user}'@'%'$`,
        "u",
      );
      return denied.test(diagnostic.trim()) ? "denied" : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  async #execute(query: string): Promise<DoltSqlExecution> {
    const [host, port] = this.#endpointParts();
    if (host === undefined || port === undefined) return { status: "refused" };
    const executable = await this.#verifiedDoltExecutable();
    if (executable === undefined) return { status: "refused" };
    if ((await this.#pinnedDoltExecutable()) !== executable)
      return { status: "refused" };
    const argv = [
      ...(this.#identity.transportSecurity === "loopback_plaintext"
        ? ["--no-tls"]
        : []),
      "--host",
      host,
      "--port",
      port,
      "--use-db",
      this.#identity.database,
      "--user",
      this.#user,
      "sql",
      "-q",
      query,
      "-r",
      "json",
    ];
    try {
      const result = await this.#process({
        argv,
        executable,
        // Dolt's CLI reads this variable during authentication. Keeping it in
        // the child environment avoids exposing a password through argv.
        env: {
          DOLT_CLI_PASSWORD: this.#password ?? "",
          PATH:
            this.#executable === undefined
              ? process.env.PATH
              : dirname(this.#executable),
        },
        timeoutMs: DOLT_SQL_TIMEOUT_MS,
      });
      if (result.timedOut || result.exitCode !== 0)
        return { status: "unavailable" };
      if (Buffer.byteLength(result.output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES)
        return { status: "unavailable" };
      return { status: "ok", output: result.output };
    } catch {
      return { status: "unavailable" };
    }
  }

  #endpointParts(): readonly [string | undefined, string | undefined] {
    const bracketed = /^\[([^\]]+)\]:(\d{1,5})$/u.exec(this.#identity.endpoint);
    if (bracketed !== null) return [bracketed[1], bracketed[2]];
    const plain = /^([A-Za-z0-9.-]+):(\d{1,5})$/u.exec(this.#identity.endpoint);
    return plain === null ? [undefined, undefined] : [plain[1], plain[2]];
  }

  async #verifiedDoltExecutable(): Promise<string | undefined> {
    if (this.#process !== runDoltSql && this.#executable === undefined)
      return "";
    const executable = await this.#pinnedDoltExecutable();
    if (executable === undefined) return undefined;
    if (this.#verifiedExecutable === executable) return executable;
    const version = await this.#process({
      argv: ["version"],
      executable,
      env: { PATH: `${dirname(executable)}:/usr/bin:/bin` },
      timeoutMs: DOLT_SQL_TIMEOUT_MS,
    });
    // A version process is not an authority to refresh the pin. Recheck the
    // exact object after it closes so a self-replacing version binary poisons
    // this transport before any query or transaction child can be spawned.
    if ((await this.#pinnedDoltExecutable()) !== executable) return undefined;
    if (
      version.timedOut ||
      version.exitCode !== 0 ||
      Buffer.byteLength(version.output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES ||
      !/^dolt version 2\.2\.1(?:\s|$)/u.test(version.output)
    )
      return undefined;
    this.#verifiedExecutable = executable;
    return executable;
  }

  async #pinnedDoltExecutable(): Promise<string | undefined> {
    if (this.#executablePoisoned) return undefined;
    if (this.#executable === undefined)
      return this.#process === runDoltSql ? undefined : "";
    const snapshot = await executableSnapshot(this.#executable);
    // Synthetic process tests may use a non-existent fixture path. Real
    // process execution never has this escape hatch.
    if (snapshot === undefined)
      return this.#process === runDoltSql ? undefined : this.#executable;
    if (
      this.#executableSnapshot !== undefined &&
      this.#executableSnapshot.fingerprint !== snapshot.fingerprint
    ) {
      this.#executablePoisoned = true;
      return undefined;
    }
    this.#executableSnapshot ??= snapshot;
    return snapshot.canonical;
  }
}

async function runDoltSql(
  request: DoltSqlProcessRequest,
): Promise<DoltSqlProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(request.executable, request.argv, {
      env: request.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let stderr = "";
    let capped = false;
    let failed = false;
    let timedOut = false;
    let closing = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (): void => {
      if (closing) return;
      closing = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, PROCESS_TERM_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (capped) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES) {
        capped = true;
        terminate();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (capped) return;
      stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stderr, "utf8") > DOLT_SQL_MAX_ERROR_BYTES) {
        capped = true;
        terminate();
      }
    });
    child.once("error", () => {
      failed = true;
      terminate();
    });
    // `close`, unlike `exit`, waits for stdout to close. In particular, no
    // timeout result can race a still-running child that may later write.
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve({
        exitCode:
          capped || timedOut || failed ? undefined : (code ?? undefined),
        output,
        stderr,
        timedOut: capped || timedOut,
      });
    });
  });
}

async function runDoltSqlTransaction(
  input: Readonly<{
    argv: readonly string[];
    executable: string;
    expectedRows: number;
    password: string | undefined;
    statement: string;
  }>,
): Promise<DoltSqlTransactionExecution> {
  return new Promise((resolve) => {
    const child = spawn(input.executable, input.argv, {
      env: {
        DOLT_CLI_PASSWORD: input.password ?? "",
        PATH: `${dirname(input.executable)}:/usr/bin:/bin`,
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    let rowCount: number | undefined;
    let result: DoltSqlTransactionExecution | undefined;
    let finalSent = false;
    let postCommitClean = false;
    let postCommitHead: string | undefined;
    let rowCountPhaseObserved = false;
    let closing = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finishAfterClose = (value: DoltSqlTransactionExecution): void => {
      if (result !== undefined) return;
      result = value;
    };
    const terminate = (value: DoltSqlTransactionExecution): void => {
      finishAfterClose(value);
      if (closing) return;
      closing = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, PROCESS_TERM_GRACE_MS);
    };
    const observeTestPhase = (phase: DoltSqlTransactionTestPhase): void => {
      const hook = doltSqlTransactionTestHook;
      if (hook === undefined || result !== undefined) return;
      try {
        hook({
          abort: () => terminate({ status: "unavailable" }),
          pause: () => {
            if (!closing) child.kill("SIGSTOP");
          },
          phase,
        });
      } catch {
        terminate({ status: "unavailable" });
      }
    };
    const timer = setTimeout(() => {
      terminate({ status: "unavailable" });
    }, DOLT_SQL_TIMEOUT_MS);
    const sendFinal = (commit: boolean): void => {
      if (finalSent || closing) return;
      finalSent = true;
      if (!commit) {
        child.stdin.write("ROLLBACK;\n");
        child.stdin.end();
        return;
      }
      // Keep the commit and both evidence reads on this one process/session.
      // A fresh connection can later reconcile an interrupted response, but it
      // cannot turn an unknown child outcome into an applied result here.
      child.stdin.write("COMMIT;\n");
      observeTestPhase("after_commit_before_outcome");
      if (closing) return;
      child.stdin.write(
        "SELECT DOLT_HASHOF('HEAD') AS committed_head; SELECT COUNT(*) AS working_set_rows FROM dolt_status;\n",
      );
      child.stdin.end();
    };
    const inspectLine = (line: string): void => {
      if (line.trim().length === 0 || result !== undefined) return;
      // The stdin program above has exactly one trailing result query. Dolt
      // executes the guarded UPDATE before producing that query's JSON, so a
      // test fault here is after the real write and before we parse/evaluate
      // its affected-row readback or send a transaction decision.
      if (!rowCountPhaseObserved && rowCount === undefined && !finalSent) {
        rowCountPhaseObserved = true;
        observeTestPhase("after_guarded_write_before_rowcount");
        if (closing) return;
      }
      let rows: readonly Record<string, unknown>[] | undefined;
      try {
        rows = parseDoltRows(line);
      } catch {
        terminate({ status: "refused" });
        return;
      }
      if (rows === undefined) {
        terminate({ status: "refused" });
        return;
      }
      if (rows.length === 1 && rows[0]?.committed_head !== undefined) {
        const head = rows[0].committed_head;
        if (typeof head !== "string" || !/^[0-9a-z]{20,64}$/u.test(head)) {
          terminate({ status: "refused" });
          return;
        }
        postCommitHead = head;
        return;
      }
      if (rows.length === 1 && rows[0]?.working_set_rows !== undefined) {
        const count = Number(rows[0].working_set_rows);
        if (!Number.isSafeInteger(count) || count !== 0) {
          terminate({ status: "refused" });
          return;
        }
        postCommitClean = true;
        if (postCommitHead === undefined) {
          terminate({ status: "refused" });
          return;
        }
        observeTestPhase("after_commit_marker_before_close");
        return;
      }
      const value = rows[0]?.affected_rows;
      if (value === undefined || rowCount !== undefined) return;
      const parsed =
        typeof value === "number" || typeof value === "string"
          ? Number(value)
          : NaN;
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        terminate({ status: "refused" });
        return;
      }
      rowCount = parsed;
      observeTestPhase("after_rowcount_before_commit");
      if (closing) return;
      sendFinal(parsed === input.expectedRows);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (result !== undefined) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES) {
        terminate({ status: "unavailable" });
        return;
      }
      const lines = output.split("\n");
      output = lines.pop() ?? "";
      for (const line of lines) inspectLine(line);
    });
    child.once("error", () => terminate({ status: "unavailable" }));
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (result !== undefined) return resolve(result);
      // A successful exit proves the exact decision was sent through the same
      // connection. Applied writes additionally need a same-session Dolt head
      // and clean working-set marker; no decision is never an apply result.
      resolve(
        code === 0 &&
          finalSent &&
          rowCount !== undefined &&
          (rowCount !== input.expectedRows ||
            (postCommitClean && postCommitHead !== undefined))
          ? { status: "ok", rows: rowCount }
          : { status: "unavailable" },
      );
    });
    child.stdin.write(
      `SET @@SESSION.dolt_transaction_commit = 1; START TRANSACTION; ${input.statement}; SET @sce_affected_rows := ROW_COUNT(); SELECT @sce_affected_rows AS affected_rows;\n`,
    );
  });
}

export type PinnedBdProcessRequest = Readonly<{
  argv: readonly string[];
  executable: string;
  env: Readonly<Record<string, string | undefined>>;
  timeoutMs: number;
}>;
export type PinnedBdProcessResult = Readonly<{
  exitCode: number | undefined;
  output: string;
  timedOut: boolean;
}>;
export type PinnedBdProcess = (
  request: PinnedBdProcessRequest,
) => Promise<PinnedBdProcessResult>;

export type PinnedBdSlotCommandResult =
  | Readonly<{ status: "completed" | "rejected" }>
  | Readonly<{ status: "unavailable" | "ambiguous" | "refused" }>;

/** Narrow child-only runtime configuration; it is never included in results. */
export type PinnedBdRuntimeEnvironment = Readonly<{
  HOME?: string | undefined;
  XDG_CONFIG_HOME?: string | undefined;
}>;

export type PinnedBdServerProcessInput = Readonly<{
  /** Called only at spawn time, so the process never retains a password. */
  credentialEnvironment?: () => Readonly<{
    BEADS_DOLT_PASSWORD?: string | undefined;
  }>;
  executable: string;
  /** Test seam; production uses the canonical executable process. */
  process?: PinnedBdProcess;
  /** Optional isolated child HOME/config used by managed bd server mode. */
  runtimeEnvironment?: () => PinnedBdRuntimeEnvironment;
  workspace: string;
}>;

/** Pinned bd 1.1.0 authority for the built-in merge-slot row. */
export class PinnedBdServerProcess {
  readonly #credentialEnvironment:
    (() => Readonly<{ BEADS_DOLT_PASSWORD?: string | undefined }>) | undefined;
  readonly #executable: string;
  readonly #process: PinnedBdProcess;
  readonly #runtimeEnvironment: (() => PinnedBdRuntimeEnvironment) | undefined;
  readonly #workspace: string;
  #executablePoisoned = false;
  #executableSnapshot: ExecutableSnapshot | undefined;
  #verifiedExecutable: string | undefined;

  constructor(input: PinnedBdServerProcessInput) {
    if (!isAbsolute(input.executable) || !isAbsolute(input.workspace))
      throw new Error("invalid pinned bd process configuration");
    this.#credentialEnvironment = input.credentialEnvironment;
    this.#executable = input.executable;
    this.#process = input.process ?? runPinnedBd;
    this.#runtimeEnvironment = input.runtimeEnvironment;
    this.#workspace = input.workspace;
  }

  async acquire(actor: string): Promise<PinnedBdSlotCommandResult> {
    return this.#run("acquire", actor);
  }

  async check(actor: string): Promise<PinnedBdSlotCommandResult> {
    return this.#run("check", actor);
  }

  async release(actor: string): Promise<PinnedBdSlotCommandResult> {
    return this.#run("release", actor);
  }

  async #run(
    command: "acquire" | "check" | "release",
    actor: string,
  ): Promise<PinnedBdSlotCommandResult> {
    if (!validIdentifier(actor)) return { status: "refused" };
    const verification = await this.#verify();
    if (verification.status !== "ok") return verification;
    const workspace = await this.#canonicalWorkspace();
    if (workspace === undefined) return { status: "refused" };
    const executable = verification.executable;
    if ((await this.#canonicalExecutable()) !== executable)
      return { status: "refused" };
    const result = await this.#exec(executable, [
      "-C",
      workspace,
      "--actor",
      actor,
      "--dolt-auto-commit",
      "on",
      "merge-slot",
      command,
      ...(command === "check" ? [] : ["--holder", actor]),
      "--json",
    ]);
    if (
      result.timedOut ||
      result.exitCode === undefined ||
      Buffer.byteLength(result.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES
    )
      return { status: "unavailable" };
    if (result.exitCode !== 0) return { status: "rejected" };
    try {
      const parsed = JSON.parse(result.output) as unknown;
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? { status: "completed" }
        : { status: "ambiguous" };
    } catch {
      return { status: "ambiguous" };
    }
  }

  async #verify(): Promise<
    | Readonly<{ executable: string; status: "ok" }>
    | Readonly<{ status: "unavailable" | "refused" }>
  > {
    const executable = await this.#canonicalExecutable();
    if (executable === undefined) return { status: "refused" };
    if (this.#verifiedExecutable === executable)
      return { status: "ok", executable };
    const result = await this.#exec(executable, ["version"]);
    if ((await this.#canonicalExecutable()) !== executable)
      return { status: "refused" };
    if (
      result.timedOut ||
      result.exitCode === undefined ||
      Buffer.byteLength(result.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES
    )
      return { status: "unavailable" };
    if (
      result.exitCode !== 0 ||
      !/^bd version 1\.1\.0(?:\s|$)/u.test(result.output)
    )
      return { status: "refused" };
    this.#verifiedExecutable = executable;
    return { status: "ok", executable };
  }

  async #canonicalExecutable(): Promise<string | undefined> {
    if (this.#executablePoisoned) return undefined;
    const snapshot = await executableSnapshot(this.#executable);
    // Synthetic process tests retain their deliberately pathless fixture
    // executable. Native production execution requires a pinned file.
    if (snapshot === undefined)
      return this.#process === runPinnedBd ? undefined : this.#executable;
    if (
      this.#executableSnapshot !== undefined &&
      this.#executableSnapshot.fingerprint !== snapshot.fingerprint
    ) {
      this.#executablePoisoned = true;
      return undefined;
    }
    this.#executableSnapshot ??= snapshot;
    return snapshot.canonical;
  }

  async #canonicalWorkspace(): Promise<string | undefined> {
    if (this.#process !== runPinnedBd) return this.#workspace;
    try {
      const canonical = await realpath(this.#workspace);
      return (await stat(canonical)).isDirectory() ? canonical : undefined;
    } catch {
      return undefined;
    }
  }

  async #exec(
    executable: string,
    argv: readonly string[],
    additionalPath: readonly string[] = [],
  ): Promise<PinnedBdProcessResult> {
    const source = this.#credentialEnvironment?.();
    const runtime = this.#runtimeEnvironment?.();
    const password = source?.BEADS_DOLT_PASSWORD;
    if (password !== undefined && !safeText(password, 4_096))
      return { exitCode: undefined, output: "", timedOut: false };
    if (
      runtime !== undefined &&
      (Object.keys(runtime).some(
        (key) => key !== "HOME" && key !== "XDG_CONFIG_HOME",
      ) ||
        (runtime.HOME !== undefined &&
          (!isAbsolute(runtime.HOME) || !safeText(runtime.HOME, 4_096))) ||
        (runtime.XDG_CONFIG_HOME !== undefined &&
          (!isAbsolute(runtime.XDG_CONFIG_HOME) ||
            !safeText(runtime.XDG_CONFIG_HOME, 4_096))))
    )
      return { exitCode: undefined, output: "", timedOut: false };
    return this.#process({
      argv,
      executable,
      env: {
        BD_NON_INTERACTIVE: "1",
        ...(password === undefined ? {} : { BEADS_DOLT_PASSWORD: password }),
        CI: "1",
        ...(runtime?.HOME === undefined ? {} : { HOME: runtime.HOME }),
        PATH: [dirname(executable), ...additionalPath, "/usr/bin", "/bin"].join(
          ":",
        ),
        ...(runtime?.XDG_CONFIG_HOME === undefined
          ? {}
          : { XDG_CONFIG_HOME: runtime.XDG_CONFIG_HOME }),
      },
      timeoutMs: BD_PROCESS_TIMEOUT_MS,
    });
  }
}

async function runPinnedBd(
  request: PinnedBdProcessRequest,
): Promise<PinnedBdProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(request.executable, request.argv, {
      env: request.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    let capped = false;
    let failed = false;
    let timedOut = false;
    let closing = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (): void => {
      if (closing) return;
      closing = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, PROCESS_TERM_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (capped) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES) {
        capped = true;
        terminate();
      }
    });
    child.once("error", () => {
      failed = true;
      terminate();
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve({
        exitCode:
          capped || timedOut || failed ? undefined : (code ?? undefined),
        output,
        timedOut: capped || timedOut,
      });
    });
  });
}

export type ServerCommitReadback = Readonly<{
  autoCommitPolicy: ServerAutoCommitPolicy;
  commit: "auto" | "explicit";
  head?: string;
  workingSet: "clean";
}>;

export type ServerProbe = Readonly<{
  autoCommitPolicy: ServerAutoCommitPolicy;
  credentialReference: string;
  database: string;
  endpoint: string;
  schema: string;
  /** Concrete server-grant proof, never a cooperative client flag. */
  workerGrant: Readonly<{
    credentialReference: string;
    serverEnforced: boolean;
    writeDenied: boolean;
  }>;
}>;

export type ServerDiscovery = Readonly<{
  checkpoint: unknown;
  children: readonly unknown[];
  root: unknown;
  slot: unknown;
}>;

/** Immutable initialization-time slot identity; bd 1.1.0 preserves external_ref. */
export type ServerSlotReadback = Readonly<{
  observation: MergeSlotObservation;
  scopeReference: string;
}>;

export function slotScopeReference(scope: FencingScope): string {
  return `sce-scope:v1:${deriveScopeCommitment(scope)}`;
}

export type ServerDriverFailure = "unavailable" | "ambiguous" | "refused";

export type ServerDriverResponse<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: ServerDriverFailure }>;

export type ServerMutationDriverResponse =
  | Readonly<{
      status: "ok";
      value: Readonly<{ commit: unknown; result: unknown }>;
    }>
  | Readonly<{
      /** Before transaction is safe to call unavailable; later is not. */
      phase: "before_transaction" | "commit_unknown";
      status: ServerDriverFailure;
    }>;

/**
 * The driver must make these operations authoritative on the SQL server.
 * `mutate` is one transaction: slot holder, root revision/commitment, every
 * child revision/commitment, exact row count, and all readbacks are checked
 * before it can report applied.  There is intentionally no create-slot API.
 */
export interface BeadsServerDriver {
  probe(): Promise<ServerDriverResponse<ServerProbe>>;
  mergeSlotAcquire(
    input: Readonly<{
      actor: string;
      prefix: string;
      scope: FencingScope;
    }>,
  ): Promise<ServerDriverResponse<ServerSlotReadback>>;
  mergeSlotCheck(
    input: Readonly<{
      actor?: string;
      prefix: string;
      scope: FencingScope;
    }>,
  ): Promise<ServerDriverResponse<ServerSlotReadback>>;
  mergeSlotRelease(
    input: Readonly<{
      actor: string;
      prefix: string;
      scope: FencingScope;
    }>,
  ): Promise<ServerDriverResponse<ServerSlotReadback>>;
  mutate(
    input: Readonly<{
      batch: MutationBatch;
      identity: ServerIdentity;
    }>,
  ): Promise<ServerMutationDriverResponse>;
  /** Read-only reconciliation after a failed/unknown commit; never retries it. */
  discover(
    input: Readonly<{
      identity: ServerIdentity;
      prefix: string;
      scope: FencingScope;
    }>,
  ): Promise<ServerDriverResponse<ServerDiscovery>>;
}

/** Managed setup may start/probe an authority-owned server; it never stops it. */
export interface ManagedServerProcess {
  start(): Promise<ServerDriverResponse<void>>;
}

export type PinnedBdManagedServerProcessInput = Readonly<{
  /** Exact bd-managed shared-server data directory this lifecycle may own. */
  dataDirectory: string;
  /** Pinned Dolt 2.2.1 executable which bd launches for this lifecycle. */
  doltExecutable: string;
  executable: string;
  /** Test seam; production resolves and pins the supplied executable. */
  process?: PinnedBdProcess;
  /** Child-only HOME/config for bd's managed shared-server state. */
  runtimeEnvironment?: () => PinnedBdRuntimeEnvironment;
  workspace: string;
}>;

/**
 * The concrete managed-local lifecycle. This deliberately invokes bd's
 * supported shared-server probe/start commands rather than spawning a Dolt
 * substitute. It never stops a shared server; the fixture-only admin helper
 * owns teardown while HOME/config stay outside the host user.
 */
export class PinnedBdManagedServerProcess implements ManagedServerProcess {
  readonly #dataDirectory: string;
  readonly #doltExecutable: string;
  readonly #executable: string;
  readonly #process: PinnedBdProcess;
  readonly #runtimeEnvironment: (() => PinnedBdRuntimeEnvironment) | undefined;
  readonly #workspace: string;
  #doltPoisoned = false;
  #doltSnapshot: ExecutableSnapshot | undefined;
  #executablePoisoned = false;
  #executableSnapshot: ExecutableSnapshot | undefined;
  #verifiedDolt: string | undefined;
  #verifiedExecutable: string | undefined;

  constructor(input: PinnedBdManagedServerProcessInput) {
    if (
      !isAbsolute(input.dataDirectory) ||
      !isAbsolute(input.doltExecutable) ||
      !isAbsolute(input.executable) ||
      !isAbsolute(input.workspace)
    )
      throw new Error("invalid pinned managed bd process configuration");
    this.#dataDirectory = input.dataDirectory;
    this.#doltExecutable = input.doltExecutable;
    this.#executable = input.executable;
    this.#process = input.process ?? runPinnedBd;
    this.#runtimeEnvironment = input.runtimeEnvironment;
    this.#workspace = input.workspace;
  }

  async start(): Promise<ServerDriverResponse<void>> {
    const executable = await this.#verify();
    if (executable === undefined) return { status: "refused" };
    const dolt = await this.#verifyDolt();
    if (dolt === undefined) return { status: "refused" };
    const workspace = await this.#canonicalWorkspace();
    if (workspace === undefined) return { status: "refused" };
    if (
      (await this.#canonicalExecutable()) !== executable ||
      (await this.#canonicalDolt()) !== dolt
    )
      return { status: "refused" };
    const before = await this.#status(executable, dolt, workspace);
    if (before === undefined) return { status: "refused" };
    // An existing, exact private server is adopted, never stopped by dispose.
    if (before === "running") return { status: "ok", value: undefined };
    if (
      (await this.#canonicalExecutable()) !== executable ||
      (await this.#canonicalDolt()) !== dolt
    )
      return { status: "refused" };
    const result = await this.#exec(
      executable,
      ["-C", workspace, "dolt", "start"],
      [dirname(dolt)],
    );
    if (result.timedOut || result.exitCode === undefined)
      return { status: "unavailable" };
    if (result.exitCode !== 0) return { status: "refused" };
    if (
      (await this.#canonicalExecutable()) !== executable ||
      (await this.#canonicalDolt()) !== dolt
    )
      return { status: "refused" };
    if ((await this.#status(executable, dolt, workspace)) !== "running")
      return { status: "refused" };
    return { status: "ok", value: undefined };
  }

  async #verify(): Promise<string | undefined> {
    const executable = await this.#canonicalExecutable();
    if (executable === undefined) return undefined;
    if (this.#verifiedExecutable === executable) return executable;
    const result = await this.#exec(executable, ["version"]);
    if ((await this.#canonicalExecutable()) !== executable) return undefined;
    if (
      result.timedOut ||
      result.exitCode !== 0 ||
      Buffer.byteLength(result.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES ||
      !/^bd version 1\.1\.0(?:\s|$)/u.test(result.output)
    )
      return undefined;
    this.#verifiedExecutable = executable;
    return executable;
  }

  async #canonicalExecutable(): Promise<string | undefined> {
    if (this.#executablePoisoned) return undefined;
    const snapshot = await executableSnapshot(this.#executable);
    if (snapshot === undefined)
      return this.#process === runPinnedBd ? undefined : this.#executable;
    if (
      this.#executableSnapshot !== undefined &&
      this.#executableSnapshot.fingerprint !== snapshot.fingerprint
    ) {
      this.#executablePoisoned = true;
      return undefined;
    }
    this.#executableSnapshot ??= snapshot;
    return snapshot.canonical;
  }

  async #verifyDolt(): Promise<string | undefined> {
    const dolt = await this.#canonicalDolt();
    if (dolt === undefined) return undefined;
    if (this.#verifiedDolt === dolt) return dolt;
    const result = await this.#exec(dolt, ["version"]);
    if ((await this.#canonicalDolt()) !== dolt) return undefined;
    if (
      result.timedOut ||
      result.exitCode !== 0 ||
      Buffer.byteLength(result.output, "utf8") > DOLT_SQL_MAX_OUTPUT_BYTES ||
      !/^dolt version 2\.2\.1(?:\s|$)/u.test(result.output)
    )
      return undefined;
    this.#verifiedDolt = dolt;
    return dolt;
  }

  async #canonicalDolt(): Promise<string | undefined> {
    if (this.#doltPoisoned) return undefined;
    const snapshot = await executableSnapshot(this.#doltExecutable);
    if (snapshot === undefined)
      return this.#process === runPinnedBd ? undefined : this.#doltExecutable;
    if (
      this.#doltSnapshot !== undefined &&
      this.#doltSnapshot.fingerprint !== snapshot.fingerprint
    ) {
      this.#doltPoisoned = true;
      return undefined;
    }
    this.#doltSnapshot ??= snapshot;
    return snapshot.canonical;
  }

  async #status(
    executable: string,
    dolt: string,
    workspace: string,
  ): Promise<"running" | "stopped" | undefined> {
    // Status is an operational bd spawn too. Keep this local recheck beside
    // the child launch so a caller cannot accidentally rely on an older
    // start-level verification.
    if (
      (await this.#canonicalExecutable()) !== executable ||
      (await this.#canonicalDolt()) !== dolt
    )
      return undefined;
    const result = await this.#exec(
      executable,
      ["-C", workspace, "dolt", "status", "--json"],
      [dirname(dolt)],
    );
    if (
      result.timedOut ||
      result.exitCode !== 0 ||
      Buffer.byteLength(result.output, "utf8") > BD_PROCESS_MAX_OUTPUT_BYTES
    )
      return undefined;
    try {
      const parsed = JSON.parse(result.output) as unknown;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.keys(parsed).sort().join(",") !==
          "data_dir,pid,port,running,schema_version"
      )
        return undefined;
      const value = parsed as Record<string, unknown>;
      if (value.schema_version !== 1 || typeof value.running !== "boolean")
        return undefined;
      if (!value.running)
        return value.data_dir === "" && value.pid === 0 && value.port === 0
          ? "stopped"
          : undefined;
      if (
        typeof value.data_dir !== "string" ||
        !isAbsolute(value.data_dir) ||
        typeof value.pid !== "number" ||
        !Number.isSafeInteger(value.pid) ||
        value.pid <= 0 ||
        typeof value.port !== "number" ||
        !Number.isSafeInteger(value.port) ||
        value.port < 1 ||
        value.port > 65_535
      )
        return undefined;
      const [actual, expected] = await Promise.all([
        realpath(value.data_dir),
        realpath(this.#dataDirectory),
      ]);
      return actual === expected ? "running" : undefined;
    } catch {
      return undefined;
    }
  }

  async #canonicalWorkspace(): Promise<string | undefined> {
    try {
      const canonical = await realpath(this.#workspace);
      return (await stat(canonical)).isDirectory() ? canonical : undefined;
    } catch {
      return undefined;
    }
  }

  async #exec(
    executable: string,
    argv: readonly string[],
    additionalPath: readonly string[] = [],
  ): Promise<PinnedBdProcessResult> {
    const runtime = this.#runtimeEnvironment?.();
    if (
      runtime !== undefined &&
      (Object.keys(runtime).some(
        (key) => key !== "HOME" && key !== "XDG_CONFIG_HOME",
      ) ||
        (runtime.HOME !== undefined &&
          (!isAbsolute(runtime.HOME) || !safeText(runtime.HOME, 4_096))) ||
        (runtime.XDG_CONFIG_HOME !== undefined &&
          (!isAbsolute(runtime.XDG_CONFIG_HOME) ||
            !safeText(runtime.XDG_CONFIG_HOME, 4_096))))
    )
      return { exitCode: undefined, output: "", timedOut: false };
    return this.#process({
      argv,
      executable,
      env: {
        BD_NON_INTERACTIVE: "1",
        CI: "1",
        ...(runtime?.HOME === undefined ? {} : { HOME: runtime.HOME }),
        PATH: [dirname(executable), ...additionalPath, "/usr/bin", "/bin"].join(
          ":",
        ),
        ...(runtime?.XDG_CONFIG_HOME === undefined
          ? {}
          : { XDG_CONFIG_HOME: runtime.XDG_CONFIG_HOME }),
      },
      timeoutMs: BD_PROCESS_TIMEOUT_MS,
    });
  }
}

export type ServerPreflight =
  | Readonly<{ status: "ready"; identity: ServerIdentity }>
  | Readonly<{
      status: "refused" | "unavailable" | "ambiguous";
      code:
        | "BS_IDENTITY_MISMATCH"
        | "BS_READ_ONLY_NOT_ENFORCED"
        | "BS_SERVER_AMBIGUOUS"
        | "BS_SERVER_REFUSED"
        | "BS_SERVER_UNAVAILABLE";
    }>;

export type ServerSlotResult =
  | Readonly<{
      status: "acquired" | "resume" | "continue";
      slot: MergeSlotObservation;
    }>
  | Readonly<{ status: "released"; slot: MergeSlotObservation }>
  | Readonly<{
      status: "blocked" | "quarantined" | "unavailable" | "ambiguous";
    }>;

function safeText(value: string, max: number): boolean {
  return (
    bytes.encode(value).byteLength > 0 &&
    bytes.encode(value).byteLength <= max &&
    !value.includes("\0") &&
    !containsSecretShape(value)
  );
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function validEndpoint(value: string): boolean {
  return (
    safeText(value, MAX_ENDPOINT_BYTES) &&
    /^[A-Za-z0-9.[\]:-]+$/u.test(value) &&
    !value.includes("@")
  );
}

function validIdentifier(value: string, max = MAX_SCHEMA_BYTES): boolean {
  return safeText(value, max) && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value);
}

function mapFailure(
  failure: Exclude<ServerDriverResponse<never>, { status: "ok" }>["status"],
): "unavailable" | "ambiguous" | "quarantined" {
  if (failure === "unavailable") return "unavailable";
  if (failure === "ambiguous") return "ambiguous";
  return "quarantined";
}

function sameServerIdentity(
  identity: ServerIdentity,
  probe: ServerProbe,
): boolean {
  return (
    identity.endpoint === probe.endpoint &&
    identity.database === probe.database &&
    identity.schema === probe.schema &&
    identity.autoCommitPolicy === probe.autoCommitPolicy &&
    identity.credentialReference === probe.credentialReference &&
    probe.workerGrant.credentialReference ===
      identity.workerCredentialReference &&
    identity.workerCredentialReference !== identity.credentialReference
  );
}

const ServerProbeSchema = strictObject({
  autoCommitPolicy: Type.Union([
    Type.Literal("on"),
    Type.Literal("off"),
    Type.Literal("batch"),
  ]),
  credentialReference: Type.String({
    minLength: 1,
    maxLength: MAX_FINGERPRINT_BYTES,
  }),
  database: Type.String({ minLength: 1, maxLength: MAX_SCHEMA_BYTES }),
  endpoint: Type.String({ minLength: 1, maxLength: MAX_ENDPOINT_BYTES }),
  schema: Type.String({ minLength: 1, maxLength: MAX_SCHEMA_BYTES }),
  workerGrant: strictObject({
    credentialReference: Type.String({
      minLength: 1,
      maxLength: MAX_FINGERPRINT_BYTES,
    }),
    serverEnforced: Type.Boolean(),
    writeDenied: Type.Boolean(),
  }),
});
const ServerCommitReadbackSchema = strictObject({
  autoCommitPolicy: Type.Union([
    Type.Literal("on"),
    Type.Literal("off"),
    Type.Literal("batch"),
  ]),
  commit: Type.Union([Type.Literal("auto"), Type.Literal("explicit")]),
  head: Type.Optional(
    Type.String({
      minLength: 20,
      maxLength: 64,
      pattern: "^[0-9a-z]{20,64}$",
    }),
  ),
  workingSet: Type.Literal("clean"),
});

function parseProbe(input: unknown): ServerProbe | undefined {
  return isSchema<ServerProbe>(ServerProbeSchema, input) ? input : undefined;
}

function parseCommit(input: unknown): ServerCommitReadback | undefined {
  return isSchema<ServerCommitReadback>(ServerCommitReadbackSchema, input)
    ? input
    : undefined;
}

function parseResult(input: unknown): RunStoreResult | undefined {
  if (!isSchema<RunStoreResult>(RunStoreResultSchema, input)) return undefined;
  const result = input as RunStoreResult;
  if (result.status !== "applied") return result;
  if (
    !validateRootProjection(result.root).ok ||
    !isSchema(CheckpointObservationSchema, result.checkpoint)
  )
    return undefined;
  return result.children.every((child) => validateChildProjection(child).ok)
    ? result
    : undefined;
}

function parseSlotReadback(
  input: unknown,
  prefix: string,
  scope: FencingScope,
): MergeSlotObservation | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "observation,scopeReference" ||
    value.scopeReference !== slotScopeReference(scope)
  )
    return undefined;
  const slot = validateMergeSlotObservation(value.observation, prefix, scope);
  return slot.ok ? slot.value : undefined;
}

function parseDiscovery(
  input: unknown,
  prefix: string,
  scope: FencingScope,
): ServerDiscovery | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "checkpoint,children,root,slot" ||
    !Array.isArray(value.children)
  )
    return undefined;
  const root = validateRootProjection(value.root);
  const slot = validateMergeSlotObservation(value.slot, prefix, scope);
  if (
    !root.ok ||
    !slot.ok ||
    !isSchema(CheckpointObservationSchema, value.checkpoint) ||
    !exact(root.value.checkpoint, value.checkpoint) ||
    value.children.length !== root.value.childRows.length
  )
    return undefined;
  for (const child of value.children) {
    const parsed = validateChildProjection(child);
    const reference = parsed.ok
      ? root.value.childRows.find((row) => row.unitId === parsed.value.unitId)
      : undefined;
    if (
      !parsed.ok ||
      reference?.revision !== parsed.value.revision ||
      reference.commitment !== parsed.value.commitment
    )
      return undefined;
  }
  return {
    checkpoint: value.checkpoint,
    children: value.children,
    root: value.root,
    slot: value.slot,
  };
}

/**
 * Binds preflight's sanitized topology to a single server configuration.
 * The caller supplies only a credential provenance/reference, never a secret.
 */
export function deriveServerIdentity(
  input: Readonly<{
    autoCommitPolicy: ServerAutoCommitPolicy;
    beads: BeadsIdentity;
    credentialProvenance: ServerCredentialProvenance;
    credentialReference: string;
    schema: string;
    transportSecurity: ServerTransportSecurity;
    workerCredentialReference: string;
  }>,
): ServerIdentity | undefined {
  const { beads } = input;
  if (
    (beads.mode !== "managed_local_shared_server" &&
      beads.mode !== "external_server") ||
    beads.server === undefined ||
    beads.database === undefined ||
    beads.prefix === undefined ||
    !validEndpoint(beads.server) ||
    !validIdentifier(beads.database) ||
    !validIdentifier(beads.prefix) ||
    !validIdentifier(input.schema) ||
    !validIdentifier(input.credentialReference, MAX_FINGERPRINT_BYTES) ||
    !validIdentifier(input.workerCredentialReference, MAX_FINGERPRINT_BYTES) ||
    input.workerCredentialReference === input.credentialReference
  )
    return undefined;
  if (
    (beads.mode === "managed_local_shared_server" &&
      input.credentialProvenance !== "managed_local_runtime") ||
    (beads.mode === "external_server" &&
      input.credentialProvenance !== "environment")
  )
    return undefined;
  if (
    input.transportSecurity === "loopback_plaintext" &&
    !loopbackEndpoint(beads.server)
  )
    return undefined;
  return {
    autoCommitPolicy: input.autoCommitPolicy,
    credentialProvenance: input.credentialProvenance,
    credentialReference: input.credentialReference,
    database: beads.database,
    endpoint: beads.server,
    prefix: beads.prefix,
    schema: input.schema,
    topology: beads.mode,
    transportSecurity: input.transportSecurity,
    workerCredentialReference: input.workerCredentialReference,
  };
}

/** Strict server-only RunStorePort with explicit slot and outage reconciliation. */
export class BeadsServerAdapter implements RunStorePort {
  readonly #driver: BeadsServerDriver;
  readonly #identity: ServerIdentity;
  readonly #process: ManagedServerProcess | undefined;
  #started = false;
  #lastDiscovery: ServerDiscovery | undefined;

  constructor(
    input: Readonly<{
      driver: BeadsServerDriver;
      identity: ServerIdentity;
      process?: ManagedServerProcess;
    }>,
  ) {
    if (
      (input.identity.topology === "external_server" &&
        input.process !== undefined) ||
      (input.identity.topology === "managed_local_shared_server" &&
        input.identity.credentialProvenance !== "managed_local_runtime")
    )
      throw new Error("invalid server adapter topology");
    this.#driver = input.driver;
    this.#identity = input.identity;
    this.#process = input.process;
  }

  async preflight(): Promise<ServerPreflight> {
    if (
      this.#identity.topology === "managed_local_shared_server" &&
      !this.#started
    ) {
      if (this.#process === undefined)
        return { status: "refused", code: "BS_SERVER_REFUSED" };
      let started: ServerDriverResponse<void>;
      try {
        started = await this.#process.start();
      } catch {
        return { status: "unavailable", code: "BS_SERVER_UNAVAILABLE" };
      }
      if (started.status !== "ok")
        return this.#preflightFailure(started.status);
      this.#started = true;
    }
    let probe: ServerDriverResponse<ServerProbe>;
    try {
      probe = await this.#driver.probe();
    } catch {
      return { status: "unavailable", code: "BS_SERVER_UNAVAILABLE" };
    }
    if (probe.status !== "ok") return this.#preflightFailure(probe.status);
    const parsed = parseProbe(probe.value);
    if (parsed === undefined || !sameServerIdentity(this.#identity, parsed))
      return { status: "refused", code: "BS_IDENTITY_MISMATCH" };
    if (!parsed.workerGrant.serverEnforced || !parsed.workerGrant.writeDenied)
      return { status: "refused", code: "BS_READ_ONLY_NOT_ENFORCED" };
    return { status: "ready", identity: this.#identity };
  }

  async dispose(): Promise<void> {
    // A managed bd shared server is authority-owned and may be shared across
    // projects. Disposal only forgets this adapter's adoption; it never sends
    // a server-wide stop operation.
    this.#started = false;
  }

  async acquire(
    input: Readonly<{
      continuationEvidence?: unknown;
      holder: string;
      knownHolder?: string;
      prefix: string;
      scope: FencingScope;
    }>,
  ): Promise<ServerSlotResult> {
    let result: ServerDriverResponse<ServerSlotReadback>;
    try {
      result = await this.#driver.mergeSlotAcquire({
        actor: input.holder,
        prefix: input.prefix,
        scope: input.scope,
      });
    } catch {
      return { status: "ambiguous" };
    }
    if (result.status !== "ok") return { status: mapFailure(result.status) };
    const parsed = parseSlotReadback(result.value, input.prefix, input.scope);
    if (parsed === undefined) return { status: "quarantined" };
    // `bd merge-slot acquire` returns the post-CAS holder.  There is no
    // pre-acquire available observation to feed the pure decision helper.
    if (
      input.knownHolder === undefined &&
      parsed.status === "acquired" &&
      parsed.holder === input.holder &&
      parsed.actor === input.holder
    )
      return { status: "acquired", slot: parsed };
    const decision = decideControllerSlot(
      input.prefix,
      input.scope,
      input.holder,
      input.knownHolder,
      parsed,
      input.continuationEvidence,
    );
    if (decision.kind === "acquire") {
      // An acquire response must positively prove the server set this holder.
      if (
        parsed.status !== "acquired" ||
        parsed.holder !== input.holder ||
        parsed.actor !== input.holder
      )
        return { status: "quarantined" };
      return { status: "acquired", slot: parsed };
    }
    if (decision.kind === "resume" || decision.kind === "continue")
      return { status: decision.kind, slot: parsed };
    return { status: decision.kind };
  }

  async check(
    input: Readonly<{
      holder: string;
      prefix: string;
      scope: FencingScope;
    }>,
  ): Promise<ServerSlotResult> {
    let result: ServerDriverResponse<ServerSlotReadback>;
    try {
      result = await this.#driver.mergeSlotCheck({
        actor: input.holder,
        prefix: input.prefix,
        scope: input.scope,
      });
    } catch {
      return { status: "ambiguous" };
    }
    if (result.status !== "ok") return { status: mapFailure(result.status) };
    const parsed = parseSlotReadback(result.value, input.prefix, input.scope);
    if (parsed === undefined) return { status: "quarantined" };
    return parsed.status === "acquired" && parsed.holder === input.holder
      ? { status: "resume", slot: parsed }
      : { status: "blocked" };
  }

  async release(
    input: Readonly<{
      holder: string;
      prefix: string;
      scope: FencingScope;
    }>,
  ): Promise<ServerSlotResult> {
    let result: ServerDriverResponse<ServerSlotReadback>;
    try {
      result = await this.#driver.mergeSlotRelease({
        actor: input.holder,
        prefix: input.prefix,
        scope: input.scope,
      });
    } catch {
      return { status: "ambiguous" };
    }
    if (result.status !== "ok") return { status: mapFailure(result.status) };
    const evidence = validateSlotRelease(
      input.prefix,
      input.scope,
      input.holder,
      {
        holder: input.holder,
        readback: result.value.observation,
      },
    );
    return evidence.ok
      ? { status: "released", slot: result.value.observation }
      : { status: "quarantined" };
  }

  /** Exact server readback used to reconcile, never to blindly retry a commit. */
  async discover(scope: FencingScope): Promise<ServerDiscovery | undefined> {
    try {
      const response = await this.#driver.discover({
        identity: this.#identity,
        prefix: this.#identity.prefix,
        scope,
      });
      if (response.status !== "ok") return undefined;
      const parsed = parseDiscovery(
        response.value,
        this.#identity.prefix,
        scope,
      );
      if (parsed === undefined) return undefined;
      this.#lastDiscovery = parsed;
      return parsed;
    } catch {
      return undefined;
    }
  }

  get lastDiscovery(): ServerDiscovery | undefined {
    return this.#lastDiscovery;
  }

  async compareAndSet(batchInput: MutationBatch): Promise<RunStoreResult> {
    const batch = validateMutationBatch(batchInput);
    if (!batch.ok) return { status: "quarantined" };
    let response: ServerMutationDriverResponse;
    try {
      response = await this.#driver.mutate({
        batch: batch.value,
        identity: this.#identity,
      });
    } catch {
      await this.discover(batch.value.scope);
      return { status: "ambiguous" };
    }
    if (response.status !== "ok") {
      // A network failure after a transaction starts is never reported stale.
      // Discovery is intentionally read-only and its facts stay local to the
      // driver seam; callers receive ambiguous and must reconcile before retry.
      await this.discover(batch.value.scope);
      return {
        status:
          response.phase === "before_transaction" &&
          response.status === "unavailable"
            ? "unavailable"
            : "ambiguous",
      };
    }
    const commit = parseCommit(response.value.commit);
    const result = parseResult(response.value.result);
    if (commit === undefined || result === undefined || !this.#durable(commit))
      return { status: "quarantined" };
    if (result.status !== "applied") return result;
    if (
      result.affectedRowCount !== batch.value.changedRows.length + 1 ||
      !exact(result.root, batch.value.next.root) ||
      !exact(result.children, batch.value.next.children) ||
      !exact(result.checkpoint, batch.value.checkpoint)
    )
      return { status: "quarantined" };
    return result;
  }

  #durable(commit: ServerCommitReadback): boolean {
    if (
      commit.autoCommitPolicy !== this.#identity.autoCommitPolicy ||
      commit.workingSet !== "clean"
    )
      return false;
    return this.#identity.autoCommitPolicy === "on"
      ? commit.commit === "auto"
      : commit.commit === "explicit";
  }

  #preflightFailure(failure: ServerDriverFailure): ServerPreflight {
    if (failure === "unavailable")
      return { status: "unavailable", code: "BS_SERVER_UNAVAILABLE" };
    if (failure === "ambiguous")
      return { status: "ambiguous", code: "BS_SERVER_AMBIGUOUS" };
    return { status: "refused", code: "BS_SERVER_REFUSED" };
  }
}

/** A concrete, parameter-only SQL program for the pinned server schema. */
export type ServerSqlStatement = Readonly<{
  parameters: readonly (string | number)[];
  sql: string;
}>;
export type ServerSqlProgram = Readonly<{
  /** The executor must rollback immediately if any update differs from one. */
  expectedAffectedRows: readonly number[];
  statements: readonly ServerSqlStatement[];
}>;
export type ServerSqlExecutor = (
  statement: ServerSqlStatement,
) => Promise<readonly Record<string, unknown>[]>;
export type ServerSqlExecutionResult =
  | Readonly<{ status: "committed" }>
  | Readonly<{ status: "rolled_back" | "unavailable" }>;
export type ServerBeadRows = Readonly<{
  childBeadIds: Readonly<Record<string, string>>;
  rootBeadId: string;
}>;

// This legacy executor remains for the deterministic rollback test. It is not
// a general SQL seam: only immutable programs made by the two allowlisted
// builders below are executable. The concrete driver uses its guarded single
// statement instead.
const generatedServerPrograms = new WeakSet<object>();

function generatedServerProgram(input: ServerSqlProgram): ServerSqlProgram {
  const statements = Object.freeze(
    input.statements.map((statement) =>
      Object.freeze({
        parameters: Object.freeze([...statement.parameters]),
        sql: statement.sql,
      }),
    ),
  );
  const program = Object.freeze({
    expectedAffectedRows: Object.freeze([...input.expectedAffectedRows]),
    statements,
  });
  generatedServerPrograms.add(program);
  return program;
}

/**
 * Execute a generated transaction without ever treating a zero-row CAS as a
 * successful commit.  `ROW_COUNT()` is deliberately checked before the next
 * mutation and before `COMMIT`, so a stale root or child rolls back every
 * earlier update in the same transaction.
 */
export async function executeServerSqlProgram(
  program: ServerSqlProgram,
  execute: ServerSqlExecutor,
): Promise<ServerSqlExecutionResult> {
  if (!generatedServerPrograms.has(program)) return { status: "unavailable" };
  let transactionStarted = false;
  let committed = false;
  let affectedIndex = 0;
  const rollback = async (): Promise<ServerSqlExecutionResult> => {
    try {
      await execute({ parameters: [], sql: "ROLLBACK" });
      return { status: "rolled_back" };
    } catch {
      return { status: "unavailable" };
    }
  };
  try {
    for (const statement of program.statements) {
      if (
        statement.sql === "COMMIT" &&
        affectedIndex !== program.expectedAffectedRows.length
      )
        return transactionStarted
          ? await rollback()
          : { status: "unavailable" };
      const rows = await execute(statement);
      if (statement.sql === "START TRANSACTION") transactionStarted = true;
      if (statement.sql === "SELECT ROW_COUNT() AS affected_rows") {
        const expected = program.expectedAffectedRows[affectedIndex];
        const actual = rows[0]?.affected_rows;
        affectedIndex += 1;
        if (
          expected === undefined ||
          (typeof actual !== "number" && typeof actual !== "string") ||
          Number(actual) !== expected
        )
          return transactionStarted
            ? await rollback()
            : { status: "unavailable" };
      }
      if (statement.sql === "COMMIT") committed = true;
    }
  } catch {
    return transactionStarted && !committed
      ? await rollback()
      : { status: "unavailable" };
  }
  return committed ? { status: "committed" } : { status: "unavailable" };
}

function quotedIdentifier(value: string): string | undefined {
  return validIdentifier(value) ? `\`${value}\`` : undefined;
}

/**
 * Builds the one server-side transaction expected from a production SQL
 * transport.  Dynamic values are parameters only.  It locks the already
 * provisioned built-in merge-slot, then predicates root and every affected
 * child on scope, revision, commitment, and holder.  The final SELECTs are
 * mandatory typed readbacks; unrelated rows are never selected or compared.
 */
export function buildServerCasProgram(
  identity: ServerIdentity,
  batchInput: unknown,
  rows: ServerBeadRows,
): ServerSqlProgram | undefined {
  const batch = validateMutationBatch(batchInput);
  const database = quotedIdentifier(identity.database);
  if (
    !batch.ok ||
    database === undefined ||
    identity.prefix.length === 0 ||
    !validIdentifier(rows.rootBeadId)
  )
    return undefined;
  const value = batch.value;
  const statements: ServerSqlStatement[] = [
    { parameters: [], sql: "START TRANSACTION" },
    {
      parameters: [
        `${identity.prefix}-merge-slot`,
        slotScopeReference(value.scope),
        value.expectedHolder,
      ],
      sql: `SELECT id, status, metadata, external_ref FROM ${database}.issues WHERE id = ? AND status = 'in_progress' AND external_ref = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.holder')) = ? FOR UPDATE`,
    },
    {
      parameters: [
        canonicalJson(value.next.root as JsonValue),
        rows.rootBeadId,
        value.expectedAggregateRevision,
        value.expectedAggregateCommitment,
        value.expectedHolder,
        canonicalJson(value.scope as JsonValue),
      ],
      sql: `UPDATE ${database}.issues SET metadata = JSON_SET(metadata, '$.sce', CAST(? AS JSON)) WHERE id = ? AND JSON_EXTRACT(metadata, '$.sce') IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateRevision')) = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateCommitment')) = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.holder')) = ? AND JSON_EXTRACT(metadata, '$.sce.scope') = CAST(? AS JSON)`,
    },
    { parameters: [], sql: "SELECT ROW_COUNT() AS affected_rows" },
  ];
  for (const child of value.next.children) {
    const expected = value.expectedChildren.find(
      (item) => item.unitId === child.unitId,
    );
    const childBeadId = rows.childBeadIds[child.unitId];
    if (
      expected === undefined ||
      childBeadId === undefined ||
      !validIdentifier(childBeadId)
    )
      return undefined;
    statements.push({
      parameters: [
        canonicalJson(child as JsonValue),
        childBeadId,
        expected.expectedRevision,
        expected.expectedCommitment,
        value.expectedHolder,
        canonicalJson(value.scope as JsonValue),
      ],
      sql: `UPDATE ${database}.issues SET metadata = JSON_SET(metadata, '$.sce', CAST(? AS JSON)) WHERE id = ? AND JSON_EXTRACT(metadata, '$.sce') IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.revision')) = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.commitment')) = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.holder')) = ? AND JSON_EXTRACT(metadata, '$.sce.scope') = CAST(? AS JSON)`,
    });
    statements.push({
      parameters: [],
      sql: "SELECT ROW_COUNT() AS affected_rows",
    });
  }
  statements.push(
    {
      parameters: [rows.rootBeadId],
      sql: `SELECT metadata FROM ${database}.issues WHERE id = ? FOR UPDATE`,
    },
    {
      parameters: [
        ...value.changedRows.map((row) => rows.childBeadIds[row.unitId]!),
      ],
      sql: `SELECT id, metadata FROM ${database}.issues WHERE id IN (${value.changedRows.map(() => "?").join(",") || "''"}) ORDER BY id`,
    },
    { parameters: [], sql: "COMMIT" },
  );
  return generatedServerProgram({
    expectedAffectedRows: Array(value.changedRows.length + 1).fill(1),
    statements,
  });
}

/**
 * Separate initialization-only path. Callers must obtain initialization
 * authority before invoking it; normal transition CAS deliberately cannot
 * create an absent `$.sce` envelope.
 */
export function buildServerEnvelopeInitializationProgram(
  input: Readonly<{
    authority: "authorized_initialization";
    database: string;
    envelope: unknown;
    issueId: string;
  }>,
): ServerSqlProgram | undefined {
  const database = quotedIdentifier(input.database);
  if (
    input.authority !== "authorized_initialization" ||
    database === undefined ||
    !validIdentifier(input.issueId) ||
    containsSecretShape(input.envelope)
  )
    return undefined;
  let envelope: string;
  try {
    envelope = canonicalJson(input.envelope as JsonValue);
  } catch {
    return undefined;
  }
  return generatedServerProgram({
    expectedAffectedRows: [1],
    statements: [
      { parameters: [], sql: "START TRANSACTION" },
      {
        parameters: [envelope, input.issueId],
        sql: `UPDATE ${database}.issues SET metadata = JSON_SET(metadata, '$.sce', CAST(? AS JSON)) WHERE id = ? AND JSON_EXTRACT(metadata, '$.sce') IS NULL`,
      },
      { parameters: [], sql: "SELECT ROW_COUNT() AS affected_rows" },
      { parameters: [], sql: "COMMIT" },
    ],
  });
}

/**
 * Parses a SQL transport's controlled JSON projection; it does not forward
 * native driver errors or result objects.  An `applied` result must match the
 * request byte-for-byte, including row count and checkpoint.
 */
export function parseServerCasReadback(
  input: unknown,
  identity: ServerIdentity,
  batchInput: unknown,
):
  | Readonly<{ commit: ServerCommitReadback; result: RunStoreResult }>
  | undefined {
  const batch = validateMutationBatch(batchInput);
  if (batch.ok === false || input === null || typeof input !== "object")
    return undefined;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "commit,result") return undefined;
  const commit = parseCommit(value.commit);
  const result = parseResult(value.result);
  if (commit === undefined || result === undefined) return undefined;
  const durable =
    commit.autoCommitPolicy === identity.autoCommitPolicy &&
    commit.workingSet === "clean" &&
    (identity.autoCommitPolicy === "on"
      ? commit.commit === "auto"
      : commit.commit === "explicit");
  if (!durable || result.status !== "applied") return undefined;
  if (
    result.affectedRowCount !== batch.value.changedRows.length + 1 ||
    !exact(result.root, batch.value.next.root) ||
    !exact(result.children, batch.value.next.children) ||
    !exact(result.checkpoint, batch.value.checkpoint)
  )
    return undefined;
  return { commit, result };
}

function sqlLiteral(value: string | number): string {
  if (typeof value === "number") return String(value);
  // Hex is exact UTF-8 and cannot reinterpret backslashes, quotes, or JSON
  // escape sequences while crossing the CLI argument boundary.
  return `CONVERT(0x${Buffer.from(value, "utf8").toString("hex")} USING utf8mb4)`;
}

function sqlJson(value: unknown): string {
  // Dolt's SQL JSON parser accepts ordinary JSON text here; canonical JSON is
  // used for all equality checks, but does not need to be the wire encoding.
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("invalid SQL JSON value");
  return `CAST(${sqlLiteral(encoded)} AS JSON)`;
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  let parsed = value;
  try {
    if (typeof parsed === "string") parsed = JSON.parse(parsed) as unknown;
  } catch {
    return undefined;
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

export type ServerEnvelopeInitializationResult =
  | Readonly<{ status: "initialized" | "already_initialized" }>
  | Readonly<{ status: ServerDriverFailure }>;

/**
 * Production shared-server driver. All mutation SQL is constructed here and
 * sent through DoltSqlTransport's module-private channel; callers have only
 * a read-only transport API. CAS is one guarded UPDATE, so stale root/child
 * predicates produce zero durable writes rather than a partially committed
 * transaction.
 */
export class DoltBeadsServerDriver implements BeadsServerDriver {
  readonly #identity: ServerIdentity;
  readonly #rows: ServerBeadRows;
  readonly #slotProcess: PinnedBdServerProcess | undefined;
  readonly #worker: DoltSqlTransport | undefined;
  readonly #writer: DoltSqlTransport;
  #autoCommitObserved = false;
  #doltTransactionCommitObserved = false;

  constructor(
    input: Readonly<{
      identity: ServerIdentity;
      rows: ServerBeadRows;
      slotProcess?: PinnedBdServerProcess;
      worker?: DoltSqlTransport;
      writer: DoltSqlTransport;
    }>,
  ) {
    if (
      !validIdentifier(input.rows.rootBeadId) ||
      Object.values(input.rows.childBeadIds).some((id) => !validIdentifier(id))
    )
      throw new Error("invalid server bead rows");
    this.#identity = input.identity;
    this.#rows = input.rows;
    this.#slotProcess = input.slotProcess;
    this.#worker = input.worker;
    this.#writer = input.writer;
  }

  async probe(): Promise<ServerDriverResponse<ServerProbe>> {
    if (this.#identity.autoCommitPolicy !== "on") return { status: "refused" };
    const database = await this.#writer.query(
      "SELECT DATABASE() AS current_database",
    );
    if (database.status !== "ok") return { status: database.status };
    if (
      database.rows.length !== 1 ||
      database.rows[0]?.current_database !== this.#identity.database
    )
      return { status: "refused" };
    const issuesTable = await this.#writer.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ${sqlLiteral(this.#identity.database)} AND table_name = 'issues'`,
    );
    if (issuesTable.status !== "ok") return { status: issuesTable.status };
    if (
      issuesTable.rows.length !== 1 ||
      (issuesTable.rows[0]?.table_name !== "issues" &&
        issuesTable.rows[0]?.TABLE_NAME !== "issues")
    )
      return { status: "refused" };
    const labelsTable = await this.#writer.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ${sqlLiteral(this.#identity.database)} AND table_name = 'labels'`,
    );
    if (labelsTable.status !== "ok") return { status: labelsTable.status };
    if (
      labelsTable.rows.length !== 1 ||
      (labelsTable.rows[0]?.table_name !== "labels" &&
        labelsTable.rows[0]?.TABLE_NAME !== "labels")
    )
      return { status: "refused" };
    const columns = await this.#writer.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ${sqlLiteral(this.#identity.database)} AND table_name = 'issues'`,
    );
    if (columns.status !== "ok") return { status: columns.status };
    const requiredColumns = new Map([
      ["id", "varchar"],
      ["status", "varchar"],
      ["metadata", "json"],
      ["external_ref", "varchar"],
      ["title", "varchar"],
      ["design", "longtext"],
    ]);
    for (const row of columns.rows) {
      const name = String(
        row.column_name ?? row.COLUMN_NAME ?? "",
      ).toLowerCase();
      const type = String(row.data_type ?? row.DATA_TYPE ?? "").toLowerCase();
      if (requiredColumns.get(name) === type) requiredColumns.delete(name);
    }
    if (requiredColumns.size !== 0) return { status: "refused" };
    const labelColumns = await this.#writer.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ${sqlLiteral(this.#identity.database)} AND table_name = 'labels'`,
    );
    if (labelColumns.status !== "ok") return { status: labelColumns.status };
    const requiredLabelColumns = new Map([
      ["issue_id", "varchar"],
      ["label", "varchar"],
    ]);
    for (const row of labelColumns.rows) {
      const name = String(
        row.column_name ?? row.COLUMN_NAME ?? "",
      ).toLowerCase();
      const type = String(row.data_type ?? row.DATA_TYPE ?? "").toLowerCase();
      if (requiredLabelColumns.get(name) === type)
        requiredLabelColumns.delete(name);
    }
    if (requiredLabelColumns.size !== 0) return { status: "refused" };
    const autoCommit = await this.#writer.query(
      "SELECT @@autocommit AS auto_commit",
    );
    if (
      autoCommit.status !== "ok" ||
      autoCommit.rows.length !== 1 ||
      String(autoCommit.rows[0]?.auto_commit) !== "1"
    )
      return { status: "refused" };
    const doltTransactionCommit = await executeDoltSqlProgram(
      this.#writer,
      "SET @@SESSION.dolt_transaction_commit = 1; SELECT @@SESSION.dolt_transaction_commit AS dolt_transaction_commit",
    );
    if (
      doltTransactionCommit.status !== "ok" ||
      doltTransactionCommit.results.at(-1)?.length !== 1 ||
      String(
        doltTransactionCommit.results.at(-1)?.[0]?.dolt_transaction_commit,
      ) !== "1"
    )
      return { status: "refused" };
    const initialCommit = await this.#doltCommitEvidence();
    if (initialCommit.status !== "ok") return initialCommit;
    this.#autoCommitObserved = true;
    this.#doltTransactionCommitObserved = true;
    if (this.#worker === undefined) return { status: "refused" };
    const issues = quotedIdentifier(this.#identity.database);
    if (issues === undefined) return { status: "refused" };
    const workerRead = await this.#worker.query(
      `SELECT id FROM ${issues}.issues LIMIT 1`,
    );
    if (workerRead.status !== "ok") return { status: workerRead.status };
    const workerProbe = await probeDoltSqlWorkerWrite(this.#worker);
    // A ready server must positively prove its independent worker credential
    // received the exact table-write privilege denial. Timeouts, bad logins,
    // malformed output, executable refusal, and arbitrary command failures
    // are no more evidence of read-only enforcement than an allowed write.
    if (workerProbe === "allowed") return { status: "refused" };
    if (workerProbe !== "denied")
      return {
        status: workerProbe === "unavailable" ? "unavailable" : "refused",
      };
    return {
      status: "ok",
      value: {
        autoCommitPolicy: this.#identity.autoCommitPolicy,
        credentialReference: this.#identity.credentialReference,
        database: this.#identity.database,
        endpoint: this.#identity.endpoint,
        schema: this.#identity.schema,
        workerGrant: {
          credentialReference: this.#identity.workerCredentialReference,
          serverEnforced: true,
          writeDenied: true,
        },
      },
    };
  }

  async mergeSlotAcquire(
    input: Readonly<{ actor: string; prefix: string; scope: FencingScope }>,
  ): Promise<ServerDriverResponse<ServerSlotReadback>> {
    if (this.#slotProcess === undefined) return { status: "refused" };
    const precheck = await this.#slotReadback(
      input.prefix,
      input.scope,
      input.actor,
    );
    if (precheck.status !== "ok") return precheck;
    const attempt = await this.#slotProcess.acquire(input.actor);
    return this.#slotAfterCommand("acquire", attempt, input);
  }

  async mergeSlotCheck(
    input: Readonly<{ actor?: string; prefix: string; scope: FencingScope }>,
  ): Promise<ServerDriverResponse<ServerSlotReadback>> {
    if (this.#slotProcess === undefined) return { status: "refused" };
    const actor = input.actor ?? "slot-observer";
    const precheck = await this.#slotReadback(input.prefix, input.scope, actor);
    if (precheck.status !== "ok") return precheck;
    const attempt = await this.#slotProcess.check(actor);
    return this.#slotAfterCommand("check", attempt, { ...input, actor });
  }

  async mergeSlotRelease(
    input: Readonly<{ actor: string; prefix: string; scope: FencingScope }>,
  ): Promise<ServerDriverResponse<ServerSlotReadback>> {
    if (this.#slotProcess === undefined) return { status: "refused" };
    const precheck = await this.#slotReadback(
      input.prefix,
      input.scope,
      input.actor,
    );
    if (
      precheck.status !== "ok" ||
      precheck.value.observation.status !== "acquired" ||
      precheck.value.observation.holder !== input.actor
    )
      return precheck.status === "ok" ? { status: "refused" } : precheck;
    const attempt = await this.#slotProcess.release(input.actor);
    return this.#slotAfterCommand("release", attempt, input);
  }

  async initializeEnvelope(
    input: Readonly<{
      authority: "authorized_initialization";
      envelope: unknown;
      issueId: string;
    }>,
  ): Promise<ServerEnvelopeInitializationResult> {
    if (
      input.authority !== "authorized_initialization" ||
      !validIdentifier(input.issueId) ||
      containsSecretShape(input.envelope)
    )
      return { status: "refused" };
    const affected = await this.#mutateAffected(
      `UPDATE ${this.#issues()} SET metadata = JSON_SET(metadata, '$.sce', ${sqlJson(input.envelope)}) WHERE id = ${sqlLiteral(input.issueId)} AND JSON_EXTRACT(metadata, '$.sce') IS NULL`,
      1,
    );
    if (affected.status !== "ok") return { status: affected.status };
    if (affected.rows === 0) return { status: "already_initialized" };
    return affected.rows === 1
      ? { status: "initialized" }
      : { status: "refused" };
  }

  async mutate(
    input: Readonly<{ batch: MutationBatch; identity: ServerIdentity }>,
  ): Promise<ServerMutationDriverResponse> {
    if (!exact(input.identity, this.#identity))
      return { phase: "before_transaction", status: "refused" };
    if (
      this.#identity.autoCommitPolicy !== "on" ||
      !this.#autoCommitObserved ||
      !this.#doltTransactionCommitObserved
    )
      return { phase: "before_transaction", status: "refused" };
    const beforeCommit = await this.#doltCommitEvidence();
    if (beforeCommit.status !== "ok")
      return { phase: "before_transaction", status: beforeCommit.status };
    const statement = this.#casStatement(input.batch);
    if (statement === undefined)
      return { phase: "before_transaction", status: "refused" };
    const affected = await this.#mutateAffected(
      statement,
      input.batch.changedRows.length + 1,
    );
    if (affected.status !== "ok")
      return { phase: "commit_unknown", status: affected.status };
    if (affected.rows === 0) {
      const afterStale = await this.#doltCommitEvidence();
      if (
        afterStale.status !== "ok" ||
        afterStale.value.head !== beforeCommit.value.head
      )
        return {
          phase: "commit_unknown",
          status: afterStale.status === "ok" ? "ambiguous" : afterStale.status,
        };
      return {
        status: "ok",
        value: {
          commit: afterStale.value,
          result: { status: "stale" },
        },
      };
    }
    if (affected.rows !== input.batch.changedRows.length + 1)
      return { phase: "commit_unknown", status: "ambiguous" };
    const readback = await this.#readback(input.batch);
    if (readback.status !== "ok")
      return { phase: "commit_unknown", status: readback.status };
    const afterCommit = await this.#doltCommitEvidence();
    if (
      afterCommit.status !== "ok" ||
      afterCommit.value.head === beforeCommit.value.head
    )
      return {
        phase: "commit_unknown",
        status: afterCommit.status === "ok" ? "ambiguous" : afterCommit.status,
      };
    return {
      status: "ok",
      value: {
        commit: afterCommit.value,
        result: {
          affectedRowCount: affected.rows,
          checkpoint: input.batch.checkpoint,
          children: input.batch.next.children,
          root: input.batch.next.root,
          status: "applied",
        },
      },
    };
  }

  async discover(
    input: Readonly<{
      identity: ServerIdentity;
      prefix: string;
      scope: FencingScope;
    }>,
  ): Promise<ServerDriverResponse<ServerDiscovery>> {
    if (!exact(input.identity, this.#identity)) return { status: "refused" };
    const slot = await this.#slotReadback(input.prefix, input.scope);
    if (slot.status !== "ok") return slot;
    const metadata = await this.#metadata([
      this.#rows.rootBeadId,
      ...Object.values(this.#rows.childBeadIds),
    ]);
    if (metadata.status !== "ok") return { status: metadata.status };
    const root = metadata.value.get(this.#rows.rootBeadId)?.sce;
    const parsedRoot = validateRootProjection(root);
    if (!parsedRoot.ok) return { status: "refused" };
    const children = Object.values(this.#rows.childBeadIds).map(
      (id) => metadata.value.get(id)?.sce,
    );
    if (
      children.length !== parsedRoot.value.childRows.length ||
      children.some((child) => !validateChildProjection(child).ok)
    )
      return { status: "refused" };
    return {
      status: "ok",
      value: {
        checkpoint: parsedRoot.value.checkpoint,
        children,
        root: parsedRoot.value,
        slot: slot.value.observation,
      },
    };
  }

  async #doltCommitEvidence(): Promise<
    | Readonly<{ status: "ok"; value: ServerCommitReadback }>
    | Readonly<{ status: ServerDriverFailure }>
  > {
    const status = await this.#writer.query("SELECT * FROM dolt_status");
    if (status.status !== "ok") return status;
    if (status.rows.length !== 0) return { status: "refused" };
    const head = await this.#writer.query("SELECT DOLT_HASHOF('HEAD') AS head");
    const value = head.status === "ok" ? head.rows[0]?.head : undefined;
    if (
      head.status !== "ok" ||
      head.rows.length !== 1 ||
      typeof value !== "string" ||
      !/^[0-9a-z]{20,64}$/u.test(value)
    )
      return head.status === "ok" ? { status: "refused" } : head;
    return {
      status: "ok",
      value: {
        autoCommitPolicy: this.#identity.autoCommitPolicy,
        commit: "auto",
        head: value,
        workingSet: "clean",
      },
    };
  }

  #issues(): string {
    const database = quotedIdentifier(this.#identity.database);
    if (database === undefined) throw new Error("invalid server database");
    return `${database}.issues`;
  }

  #labels(): string {
    const database = quotedIdentifier(this.#identity.database);
    if (database === undefined) throw new Error("invalid server database");
    return `${database}.labels`;
  }

  #slotDesign(prefix: string, scope: FencingScope): string {
    const slotId = sqlLiteral(`${prefix}-merge-slot`);
    return `id = ${slotId} AND external_ref = ${sqlLiteral(slotScopeReference(scope))} AND design = ${sqlLiteral(canonicalJson(scope as JsonValue))} AND title = 'Merge Slot' AND (SELECT COUNT(*) FROM ${this.#labels()} WHERE issue_id = ${slotId}) = 1 AND EXISTS (SELECT 1 FROM ${this.#labels()} WHERE issue_id = ${slotId} AND label = 'gt:slot')`;
  }

  #slot(
    status: "available" | "acquired",
    holder: string | undefined,
    actor: string,
    scope: FencingScope,
  ): MergeSlotObservation | undefined {
    if (!validIdentifier(actor)) return undefined;
    const withoutHash = {
      actor,
      ...(holder === undefined ? {} : { holder }),
      label: "gt:slot" as const,
      scope,
      scopeCommitment: deriveScopeCommitment(scope),
      slotId: `${this.#identity.prefix}-merge-slot`,
      status,
      title: "Merge Slot" as const,
      version: 1 as const,
    };
    return {
      ...withoutHash,
      readbackHash: deriveSlotReadbackHash(withoutHash),
    };
  }

  async #slotAfterCommand(
    command: "acquire" | "check" | "release",
    attempt: PinnedBdSlotCommandResult,
    input: Readonly<{ actor: string; prefix: string; scope: FencingScope }>,
  ): Promise<ServerDriverResponse<ServerSlotReadback>> {
    if (attempt.status === "unavailable" || attempt.status === "refused")
      return attempt;
    // A malformed success response cannot establish what happened. A
    // rejected acquire is different: bd reports contention with a nonzero
    // exit, and the exact SQL readback below is the authority for `blocked`.
    if (attempt.status === "ambiguous") return { status: "ambiguous" };
    const readback = await this.#slotReadback(
      input.prefix,
      input.scope,
      input.actor,
    );
    if (readback.status !== "ok") return readback;
    const observation = readback.value.observation;
    if (attempt.status === "rejected") {
      return command === "acquire" &&
        observation.status === "acquired" &&
        observation.holder !== input.actor
        ? readback
        : { status: "ambiguous" };
    }
    if (
      (command === "acquire" &&
        (observation.status !== "acquired" ||
          observation.holder !== input.actor)) ||
      (command === "release" && observation.status !== "available")
    )
      return { status: "ambiguous" };
    return readback;
  }

  async #slotReadback(
    prefix: string,
    scope: FencingScope,
    actor = "slot-observer",
  ): Promise<ServerDriverResponse<ServerSlotReadback>> {
    const result = await this.#writer.query(
      `SELECT status, metadata, external_ref, title, design FROM ${this.#issues()} WHERE id = ${sqlLiteral(`${prefix}-merge-slot`)}`,
    );
    if (result.status !== "ok") return { status: result.status };
    if (
      result.rows.length !== 1 ||
      result.rows[0]?.external_ref !== slotScopeReference(scope) ||
      result.rows[0]?.title !== "Merge Slot" ||
      result.rows[0]?.design !== canonicalJson(scope as JsonValue)
    )
      return { status: "refused" };
    const labels = await this.#writer.query(
      `SELECT label FROM ${this.#labels()} WHERE issue_id = ${sqlLiteral(`${prefix}-merge-slot`)}`,
    );
    if (labels.status !== "ok") return { status: labels.status };
    if (labels.rows.length !== 1 || labels.rows[0]?.label !== "gt:slot")
      return { status: "refused" };
    const metadata = jsonRecord(result.rows[0]?.metadata);
    const metadataKeys =
      metadata === undefined ? [] : Object.keys(metadata).sort();
    const holder = metadata?.holder;
    const acquired = result.rows[0]?.status === "in_progress";
    if (
      (result.rows[0]?.status !== "open" && !acquired) ||
      (acquired && typeof holder !== "string") ||
      (!acquired && holder !== undefined) ||
      (acquired && metadataKeys.join(",") !== "holder") ||
      (!acquired && metadataKeys.length !== 0)
    )
      return { status: "refused" };
    const observation = this.#slot(
      acquired ? "acquired" : "available",
      acquired && typeof holder === "string" ? holder : undefined,
      acquired && typeof holder === "string" ? holder : actor,
      scope,
    );
    const parsed = validateMergeSlotObservation(observation, prefix, scope);
    return parsed.ok
      ? {
          status: "ok",
          value: {
            observation: parsed.value,
            scopeReference: slotScopeReference(scope),
          },
        }
      : { status: "refused" };
  }

  async #mutateAffected(
    statement: string,
    expectedRows: number,
  ): Promise<
    | Readonly<{ status: "ok"; rows: number }>
    | Readonly<{ status: ServerDriverFailure }>
  > {
    const response = await executeDoltSqlTransaction(
      this.#writer,
      statement,
      expectedRows,
    );
    if (response.status !== "ok") return response;
    return { status: "ok", rows: response.rows };
  }

  async #metadata(ids: readonly string[]): Promise<
    | Readonly<{
        status: "ok";
        value: ReadonlyMap<string, Record<string, unknown>>;
      }>
    | Readonly<{ status: ServerDriverFailure }>
  > {
    if (ids.length === 0 || ids.some((id) => !validIdentifier(id)))
      return { status: "refused" };
    const result = await this.#writer.query(
      `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$')) AS metadata FROM ${this.#issues()} WHERE id IN (${ids.map(sqlLiteral).join(",")}) ORDER BY id`,
    );
    if (result.status !== "ok") return { status: result.status };
    if (result.rows.length !== ids.length) return { status: "refused" };
    const value = new Map<string, Record<string, unknown>>();
    for (const row of result.rows) {
      if (typeof row.id !== "string") return { status: "refused" };
      const metadata = jsonRecord(row.metadata);
      if (metadata === undefined || value.has(row.id))
        return { status: "refused" };
      value.set(row.id, metadata);
    }
    return { status: "ok", value };
  }

  async #readback(
    batch: MutationBatch,
  ): Promise<
    Readonly<{ status: "ok" }> | Readonly<{ status: ServerDriverFailure }>
  > {
    const metadata = await this.#metadata([
      this.#rows.rootBeadId,
      ...batch.next.children.map(
        (child) => this.#rows.childBeadIds[child.unitId]!,
      ),
    ]);
    if (metadata.status !== "ok") return { status: metadata.status };
    const root = metadata.value.get(this.#rows.rootBeadId)?.sce;
    const children = batch.next.children.map(
      (child) =>
        metadata.value.get(this.#rows.childBeadIds[child.unitId]!)?.sce,
    );
    return exact(root, batch.next.root) && exact(children, batch.next.children)
      ? { status: "ok" }
      : { status: "ambiguous" };
  }

  #casStatement(batch: MutationBatch): string | undefined {
    const children = batch.next.children.map((child) => {
      const expected = batch.expectedChildren.find(
        (value) => value.unitId === child.unitId,
      );
      const id = this.#rows.childBeadIds[child.unitId];
      return expected === undefined || id === undefined || !validIdentifier(id)
        ? undefined
        : { child, expected, id };
    });
    if (children.some((child) => child === undefined)) return undefined;
    const mapped = children as readonly {
      child: MutationBatch["next"]["children"][number];
      expected: MutationBatch["expectedChildren"][number];
      id: string;
    }[];
    const ids = [this.#rows.rootBeadId, ...mapped.map((child) => child.id)];
    if (new Set(ids).size !== ids.length) return undefined;
    const scope = sqlJson(batch.scope);
    const eligibility = [
      `${this.#slotDesign(this.#identity.prefix, batch.scope)} AND status = 'in_progress' AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.holder')) = ${sqlLiteral(batch.expectedHolder)}`,
      `id = ${sqlLiteral(this.#rows.rootBeadId)} AND JSON_EXTRACT(metadata, '$.sce') IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateRevision')) = ${sqlLiteral(batch.expectedAggregateRevision)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.aggregateCommitment')) = ${sqlLiteral(batch.expectedAggregateCommitment)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.holder')) = ${sqlLiteral(batch.expectedHolder)} AND JSON_EXTRACT(metadata, '$.sce.scope') = ${scope}`,
      ...mapped.map(
        ({ expected, id }) =>
          `id = ${sqlLiteral(id)} AND JSON_EXTRACT(metadata, '$.sce') IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.revision')) = ${sqlLiteral(expected.expectedRevision)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.commitment')) = ${sqlLiteral(expected.expectedCommitment)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sce.holder')) = ${sqlLiteral(batch.expectedHolder)} AND JSON_EXTRACT(metadata, '$.sce.scope') = ${scope}`,
      ),
    ];
    const cases = [
      `WHEN ${sqlLiteral(this.#rows.rootBeadId)} THEN JSON_SET(target.metadata, '$.sce', ${sqlJson(batch.next.root)})`,
      ...mapped.map(
        ({ child, id }) =>
          `WHEN ${sqlLiteral(id)} THEN JSON_SET(target.metadata, '$.sce', ${sqlJson(child)})`,
      ),
    ];
    return `UPDATE ${this.#issues()} AS target JOIN (SELECT COUNT(*) AS eligible FROM ${this.#issues()} WHERE ${eligibility.map((item) => `(${item})`).join(" OR ")}) AS gate SET target.metadata = CASE target.id ${cases.join(" ")} ELSE target.metadata END WHERE target.id IN (${ids.map(sqlLiteral).join(",")}) AND gate.eligible = ${ids.length + 1}`;
  }
}
