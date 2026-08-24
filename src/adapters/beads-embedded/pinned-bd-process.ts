import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";

import {
  MERGE_SLOT_LABEL,
  MERGE_SLOT_TITLE,
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  type FencingScope,
  type MutationBatch,
  validateMutationBatch,
} from "../../fencing/index.js";
import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import type { EmbeddedResult } from "./schemas.js";

import type {
  CrashDiscovery,
  EmbeddedProcessPort,
  EmbeddedProcessIdentity,
  EmbeddedReadback,
  EmbeddedRequest,
  EmbeddedResponse,
  EmbeddedState,
} from "./schemas.js";

const MAX_OUTPUT_BYTES = 65_536;
const PINNED_BD_VERSION = "1.1.0";
const PINNED_DOLT_VERSION = "2.2.1";
const PROCESS_TIMEOUT_MS = 15_000;
const EXECUTABLE_SAMPLE_BYTES = 65_536;

export interface ProjectionPersistencePort {
  mutate(batch: MutationBatch): Promise<EmbeddedResponse>;
  readback(batch: MutationBatch): Promise<EmbeddedReadback | undefined>;
  discover(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
  ): Promise<CrashDiscovery | undefined>;
  discoverAt(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
    ref: string,
  ): Promise<CrashDiscovery | undefined>;
}

export const SLOT_INITIALIZATION_AUTHORITY =
  "sce.embedded.slot.initialize.v1" as const;
export type SlotInitializationAuthority = typeof SLOT_INITIALIZATION_AUTHORITY;

export interface PinnedBdProcessOptions {
  /** Absolute, controller-approved executables; no PATH lookup is performed. */
  readonly bdExecutable: string;
  readonly cwd: string;
  /** Canonical `<data_dir>/<database>` proved by preflight/composition. */
  readonly databaseDirectory: string;
  readonly doltExecutable: string;
  /** Exact already-configured Dolt remote identity; never created by adapter. */
  readonly remote?: Readonly<{ name: string; ref: string; url: string }>;
  readonly prefix: string;
  readonly projections: ProjectionPersistencePort;
  readonly scope: FencingScope;
}

type Capture = Readonly<{
  code: number | null;
  exceeded: boolean;
  stdout: string;
}>;

type Executable = Readonly<{
  ctimeMs: number;
  dev: number;
  digest: string;
  ino: number;
  mtimeMs: number;
  mode: number;
  path: string;
  size: number;
}>;

function sameExecutable(
  left: Executable | undefined,
  right: Executable,
): boolean {
  return (
    left !== undefined &&
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.digest === right.digest &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.mode === right.mode &&
    left.path === right.path &&
    left.size === right.size
  );
}

/** Bounded content proof catches same-inode replacements between probes. */
function executableDigest(path: string, size: number): string | undefined {
  if (!Number.isSafeInteger(size) || size < 0) return undefined;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const hash = createHash("sha256").update(`${size}:`);
    const sample = Math.min(size, EXECUTABLE_SAMPLE_BYTES);
    const first = Buffer.alloc(sample);
    if (sample > 0)
      hash.update(first.subarray(0, readSync(descriptor, first, 0, sample, 0)));
    if (size > sample) {
      const last = Buffer.alloc(sample);
      hash.update(
        last.subarray(
          0,
          readSync(descriptor, last, 0, sample, Math.max(0, size - sample)),
        ),
      );
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function safeString(value: unknown, max = 160): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes("\u0000")
    ? value
    : undefined;
}

function safeHead(value: unknown): string | undefined {
  const head = safeString(value, 64);
  return head !== undefined && /^[0-9a-z]{20,64}$/u.test(head)
    ? head
    : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function json(source: string): Record<string, unknown> | undefined {
  try {
    return object(JSON.parse(source) as unknown);
  } catch {
    return undefined;
  }
}

/** Strict projection of bd 1.1.0's adapter-owned status envelope. */
export function parsePinnedBdState(source: string): EmbeddedState | undefined {
  const raw = json(source);
  if (
    raw === undefined ||
    Object.keys(raw).some(
      (key) =>
        ![
          "auto_commit",
          "head",
          "reachable",
          "remote_head",
          "working_set",
        ].includes(key),
    )
  )
    return undefined;
  // This engine envelope alone cannot prove the complete state contract.
  return undefined;
}

function doltShow(
  source: string,
): { readonly dataDir: string; readonly database: string } | undefined {
  const raw = json(source);
  if (
    raw === undefined ||
    raw.backend !== "dolt" ||
    raw.embedded !== true ||
    raw.schema_version !== 1
  )
    return undefined;
  const dataDir = safeString(raw.data_dir, 4096);
  const database = safeString(raw.database);
  return dataDir === undefined || database === undefined
    ? undefined
    : { dataDir, database };
}

function autoCommit(source: string): "off" | "on" | "batch" | undefined {
  const raw = json(source);
  if (
    raw === undefined ||
    raw.key !== "dolt.auto-commit" ||
    raw.schema_version !== 1
  )
    return undefined;
  return raw.value === "off" || raw.value === "on" || raw.value === "batch"
    ? raw.value
    : undefined;
}

function sqlRows(
  source: string,
): readonly Record<string, unknown>[] | undefined {
  const raw = json(source);
  // Dolt 2.2.1 emits `{}` (rather than `{rows: []}`) for an empty result.
  if (raw !== undefined && Object.keys(raw).length === 0) return [];
  return raw !== undefined &&
    Array.isArray(raw.rows) &&
    raw.rows.every((row) => object(row) !== undefined)
    ? (raw.rows as readonly Record<string, unknown>[])
    : undefined;
}

function sqlHead(source: string): string | undefined {
  const rows = sqlRows(source);
  return rows?.length === 1 ? safeHead(rows[0]?.head) : undefined;
}

function sqlWorkingSet(source: string): "clean" | "pending" | undefined {
  const rows = sqlRows(source);
  if (rows === undefined) return undefined;
  return rows.length === 0
    ? "clean"
    : rows.every(
          (row) =>
            row.staged === 0 &&
            typeof row.status === "string" &&
            safeString(row.table_name) !== undefined,
        )
      ? "pending"
      : undefined;
}

type SlotDocument = Readonly<{
  holder?: string;
  scope: FencingScope;
  status: "available" | "acquired";
}>;

/**
 * merge-slot acquire replaces metadata in bd 1.1.0, so scope lives in stable
 * initialization-only issue fields. Normal slot operations must never rewrite
 * either field.
 */
function parseSlotDocument(
  source: string,
  expectedId: string,
  expectedScope: FencingScope,
): SlotDocument | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
  const raw =
    Array.isArray(parsed) && parsed.length === 1
      ? object(parsed[0])
      : undefined;
  const metadata =
    raw === undefined
      ? undefined
      : raw.metadata === undefined
        ? {}
        : object(raw.metadata);
  const labels =
    raw === undefined || !Array.isArray(raw.labels) ? undefined : raw.labels;
  if (
    raw === undefined ||
    raw.id !== expectedId ||
    raw.title !== MERGE_SLOT_TITLE ||
    !Array.isArray(labels) ||
    labels.length !== 1 ||
    labels[0] !== MERGE_SLOT_LABEL ||
    (raw.status !== "open" && raw.status !== "in_progress") ||
    metadata === undefined ||
    Object.keys(metadata).some((key) => key !== "holder") ||
    raw.external_ref !==
      `sce-scope:v1:${deriveScopeCommitment(expectedScope)}` ||
    raw.design !== canonicalJson(expectedScope as JsonValue)
  )
    return undefined;
  const holder =
    metadata.holder === undefined
      ? undefined
      : safeString(metadata.holder, 321);
  if (metadata.holder !== undefined && holder === undefined) return undefined;
  if ((raw.status === "open") !== (holder === undefined)) return undefined;
  return {
    ...(holder === undefined ? {} : { holder }),
    scope: expectedScope,
    status: raw.status === "open" ? "available" : "acquired",
  };
}

/**
 * Concrete pinned-bd transport. It owns process invocation and exact parsing;
 * projection persistence is a separate topology-specific port because bd 1.1.0
 * has no atomic generic "write these arbitrary metadata rows" command.
 */
export class PinnedBdEmbeddedProcess implements EmbeddedProcessPort {
  public readonly identity: EmbeddedProcessIdentity;
  private readonly bdExecutable: string;
  private readonly cwd: string;
  private readonly databaseDirectory: string;
  private readonly doltExecutable: string;
  private bdVersionCheck: Promise<Capture | undefined> | undefined;
  private bdVersionExecutable: Executable | undefined;
  private bdRejectedExecutable: Executable | undefined;
  private doltVersionCheck: Promise<Capture | undefined> | undefined;
  private doltVersionExecutable: Executable | undefined;
  private doltRejectedExecutable: Executable | undefined;
  private readonly prefix: string;
  private readonly projections: ProjectionPersistencePort;
  private readonly remote:
    Readonly<{ name: string; ref: string; url: string }> | undefined;
  private readonly scope: FencingScope;

  public constructor(options: PinnedBdProcessOptions) {
    this.bdExecutable = options.bdExecutable;
    this.cwd = options.cwd;
    this.databaseDirectory = this.canonicalDirectory(options.databaseDirectory);
    this.doltExecutable = options.doltExecutable;
    this.prefix = options.prefix;
    this.projections = options.projections;
    this.remote = options.remote;
    this.scope = options.scope;
    const storePath =
      this.databaseDirectory === ""
        ? ""
        : this.canonicalDirectory(dirname(this.databaseDirectory));
    this.identity = {
      database:
        this.databaseDirectory === "" ? "" : basename(this.databaseDirectory),
      databaseDirectory: this.databaseDirectory,
      prefix: this.prefix,
      ...(this.remote === undefined ? {} : { remote: this.remote }),
      storePath,
    };
  }

  /** Authorized bootstrap only; normal acquire/check/release never touches it. */
  public async initializeSlotScope(
    authority: SlotInitializationAuthority,
  ): Promise<EmbeddedResult> {
    if (authority !== SLOT_INITIALIZATION_AUTHORITY)
      return this.result("quarantined");
    const before = await this.run([
      "show",
      `${this.prefix}-merge-slot`,
      "--long",
      "--json",
    ]);
    if (
      before === undefined ||
      before.code !== 0 ||
      before.exceeded ||
      !this.uninitializedSlot(before.stdout)
    )
      return this.result("quarantined");
    const update = await this.run([
      "update",
      `${this.prefix}-merge-slot`,
      "--external-ref",
      `sce-scope:v1:${deriveScopeCommitment(this.scope)}`,
      "--design",
      canonicalJson(this.scope as JsonValue),
      "--json",
    ]);
    if (update === undefined || update.code !== 0 || update.exceeded)
      return this.result("ambiguous");
    const after = await this.run([
      "show",
      `${this.prefix}-merge-slot`,
      "--long",
      "--json",
    ]);
    return after !== undefined &&
      after.code === 0 &&
      !after.exceeded &&
      parseSlotDocument(
        after.stdout,
        `${this.prefix}-merge-slot`,
        this.scope,
      ) !== undefined
      ? this.result("applied")
      : this.result("ambiguous");
  }

  public async execute(request: EmbeddedRequest): Promise<EmbeddedResponse> {
    switch (request.kind) {
      case "state": {
        const engine = await this.run(["dolt", "status", "--json"]);
        const show = await this.run(["dolt", "show", "--json"]);
        const policy = await this.run([
          "config",
          "get",
          "dolt.auto-commit",
          "--json",
        ]);
        const shown =
          show === undefined || show.code !== 0 || show.exceeded
            ? undefined
            : doltShow(show.stdout);
        const engineOk =
          engine !== undefined &&
          engine.code === 0 &&
          !engine.exceeded &&
          this.engineStatus(engine.stdout);
        const configured =
          policy === undefined || policy.code !== 0 || policy.exceeded
            ? undefined
            : autoCommit(policy.stdout);
        const cwd =
          shown === undefined
            ? undefined
            : this.canonicalDirectory(`${shown.dataDir}/${shown.database}`);
        if (cwd === undefined || cwd !== this.databaseDirectory)
          return {
            kind: "state",
            value: {
              autoCommit: "off",
              reachable: false,
              workingSet: "unknown",
            },
          };
        const head = cwd === undefined ? undefined : await this.doltHead(cwd);
        const workingSet =
          cwd === undefined ? undefined : await this.doltWorkingSet(cwd);
        const remoteHead =
          cwd === undefined || this.remote === undefined
            ? undefined
            : await this.remoteHead(cwd, this.remote);
        return !engineOk ||
          configured === undefined ||
          head === undefined ||
          workingSet === undefined
          ? {
              kind: "state",
              value: {
                autoCommit: "off",
                reachable: false,
                workingSet: "unknown",
              },
            }
          : {
              kind: "state",
              value: {
                autoCommit: configured,
                head,
                reachable: true,
                ...(this.remote === undefined || remoteHead === undefined
                  ? {}
                  : { remoteHead }),
                workingSet,
              },
            };
      }
      case "slot": {
        const action = await this.run([
          "--actor",
          request.actor,
          "merge-slot",
          request.action,
          "--json",
        ]);
        if (
          action === undefined ||
          action.exceeded ||
          (action.code !== 0 && request.action === "release")
        )
          throw new Error("pinned bd slot operation failed");
        const show = await this.run([
          "show",
          `${this.prefix}-merge-slot`,
          "--long",
          "--json",
        ]);
        const slot =
          show === undefined || show.code !== 0 || show.exceeded
            ? undefined
            : parseSlotDocument(
                show.stdout,
                `${this.prefix}-merge-slot`,
                this.scope,
              );
        if (slot === undefined)
          throw new Error("pinned bd slot readback failed");
        const withoutHash = {
          // The observation actor is the durable slot holder when held; the
          // command caller is only a request identity and must not fabricate
          // a holder/actor agreement for a competing controller.
          actor: slot.holder ?? request.actor,
          ...(slot.holder === undefined ? {} : { holder: slot.holder }),
          label: MERGE_SLOT_LABEL,
          scope: this.scope,
          scopeCommitment: deriveScopeCommitment(this.scope),
          slotId: `${this.prefix}-merge-slot`,
          status: slot.status,
          title: MERGE_SLOT_TITLE,
          version: 1 as const,
        };
        return {
          kind: "slot",
          value: {
            ...withoutHash,
            readbackHash: deriveSlotReadbackHash(withoutHash),
          },
        };
      }
      case "mutation":
        if (!validateMutationBatch(request.batch).ok)
          return { kind: "mutation", value: "quarantined" };
        return this.projections.mutate(request.batch);
      case "readback": {
        if (!validateMutationBatch(request.batch).ok)
          throw new Error("invalid readback batch");
        const value = await this.projections.readback(request.batch);
        if (value === undefined) throw new Error("projection readback failed");
        return { kind: "readback", value };
      }
      case "discover": {
        if (!validateMutationBatch(request.batch).ok)
          throw new Error("invalid recovery batch");
        const value = await this.projections.discover(request);
        if (value === undefined) throw new Error("checkpoint discovery failed");
        if (request.point !== "after_push" || this.remote === undefined)
          return { kind: "discover", value };
        const remoteRef = await this.fetchRemoteMain(this.remote);
        const remote =
          remoteRef === undefined
            ? undefined
            : await this.projections.discoverAt(request, remoteRef);
        if (remote === undefined || remote.status === "ambiguous")
          return { kind: "discover", value: { status: "ambiguous" } };
        if (remote.status === "absent")
          return { kind: "discover", value: { ...value, status: "absent" } };
        return {
          kind: "discover",
          value: {
            ...value,
            ...(remote.childCommitments === undefined
              ? {}
              : { childCommitments: remote.childCommitments }),
            ...(remote.head === undefined ? {} : { remoteHead: remote.head }),
            ...(remote.rootCommitment === undefined
              ? {}
              : { rootCommitment: remote.rootCommitment }),
            status:
              value.status === "observed" &&
              value.rootCommitment === remote.rootCommitment &&
              canonicalJson(value.childCommitments as JsonValue) ===
                canonicalJson(remote.childCommitments as JsonValue)
                ? "observed"
                : "ambiguous",
          },
        };
      }
      case "commit": {
        const capture = await this.run(["dolt", request.kind, "--json"]);
        if (capture === undefined || capture.exceeded)
          return { kind: "commit", value: "unavailable" };
        return {
          kind: "commit",
          value: capture.code === 0 ? "applied" : "ambiguous",
        };
      }
      case "pull":
      case "push": {
        const capture = await this.run(["dolt", request.kind, "--json"]);
        if (capture === undefined || capture.exceeded)
          return { kind: request.kind, value: "unavailable" };
        return {
          kind: request.kind,
          value: capture.code === 0 ? "applied" : "conflict",
        };
      }
    }
  }

  private async run(argv: readonly string[]): Promise<Capture | undefined> {
    const executable = this.executable(this.bdExecutable);
    if (
      executable === undefined ||
      sameExecutable(this.bdRejectedExecutable, executable)
    )
      return undefined;
    this.bdRejectedExecutable = undefined;
    if (!sameExecutable(this.bdVersionExecutable, executable)) {
      this.bdVersionCheck = undefined;
      this.bdVersionExecutable = executable;
    }
    this.bdVersionCheck ??= this.runOnce(executable.path, ["--version"]);
    const version = await this.bdVersionCheck;
    if (
      version === undefined ||
      version.code !== 0 ||
      !new RegExp(
        `^bd version ${PINNED_BD_VERSION}(?: \\(Homebrew\\))?\\n?$`,
        "u",
      ).test(version.stdout)
    )
      return undefined;
    const operational = this.executable(this.bdExecutable);
    if (operational === undefined || !sameExecutable(executable, operational)) {
      this.bdRejectedExecutable = operational ?? executable;
      return undefined;
    }
    return this.runOnce(operational.path, argv);
  }

  private async runOnce(
    executable: string,
    argv: readonly string[],
  ): Promise<Capture | undefined> {
    return new Promise((resolve) => {
      let stdout = "";
      let bytes = 0;
      let exceeded = false;
      let settled = false;
      const child = spawn(executable, argv, {
        cwd: this.cwd,
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname(this.bdExecutable)}:${dirname(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          DARWIN_USER_TEMP_DIR:
            process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          TZ: "UTC",
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) {
          exceeded = true;
          child.kill("SIGKILL");
        } else stdout += chunk.toString("utf8");
      });
      child.once("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(undefined);
        }
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({ code, exceeded, stdout });
        }
      });
    });
  }

  private engineStatus(source: string): boolean {
    const raw = json(source);
    return (
      raw !== undefined &&
      raw.mode === "embedded" &&
      raw.schema_version === 1 &&
      raw.data_dir_exists === true &&
      typeof raw.data_dir === "string" &&
      typeof raw.server_running === "boolean"
    );
  }

  private uninitializedSlot(source: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch {
      return false;
    }
    const issue =
      Array.isArray(parsed) && parsed.length === 1
        ? object(parsed[0])
        : undefined;
    return (
      issue !== undefined &&
      issue.id === `${this.prefix}-merge-slot` &&
      issue.title === MERGE_SLOT_TITLE &&
      Array.isArray(issue.labels) &&
      issue.labels.length === 1 &&
      issue.labels[0] === MERGE_SLOT_LABEL &&
      (issue.external_ref === undefined ||
        issue.external_ref === "" ||
        issue.external_ref === null) &&
      (issue.design === undefined ||
        issue.design === "" ||
        issue.design === null)
    );
  }

  private result(code: EmbeddedResult["code"]): EmbeddedResult {
    return { code, schema: "sce.beads-embedded.result", version: 1 };
  }

  private async doltHead(cwd: string): Promise<string | undefined> {
    const capture = await this.runDolt(cwd, [
      "sql",
      "-r",
      "json",
      "-q",
      'SELECT DOLT_HASHOF("HEAD") AS head',
    ]);
    return capture === undefined || capture.code !== 0 || capture.exceeded
      ? undefined
      : sqlHead(capture.stdout);
  }

  private async doltWorkingSet(
    cwd: string,
  ): Promise<"clean" | "pending" | undefined> {
    const capture = await this.runDolt(cwd, [
      "sql",
      "-r",
      "json",
      "-q",
      "SELECT * FROM dolt_status",
    ]);
    return capture === undefined || capture.code !== 0 || capture.exceeded
      ? undefined
      : sqlWorkingSet(capture.stdout);
  }

  private async remoteHead(
    cwd: string,
    remote: Readonly<{ name: string; url: string }>,
  ): Promise<string | undefined> {
    if (cwd !== this.databaseDirectory) return undefined;
    const remoteRef = await this.fetchRemoteMain(remote);
    if (remoteRef === undefined) return undefined;
    const capture = await this.runDolt(cwd, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT DOLT_HASHOF('${remoteRef}') AS head`,
    ]);
    return capture === undefined || capture.code !== 0 || capture.exceeded
      ? undefined
      : sqlHead(capture.stdout);
  }

  private async fetchRemoteMain(
    remote: Readonly<{ name: string; url: string }>,
  ): Promise<string | undefined> {
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(remote.name)) return undefined;
    if (!(await this.remoteIsConfigured(this.databaseDirectory, remote)))
      return undefined;
    const fetched = await this.runDolt(this.databaseDirectory, [
      "fetch",
      remote.name,
    ]);
    return fetched !== undefined && fetched.code === 0 && !fetched.exceeded
      ? `${remote.name}/main`
      : undefined;
  }

  private async remoteIsConfigured(
    cwd: string,
    remote: Readonly<{ name: string; url: string }>,
  ): Promise<boolean> {
    if (
      !/^[A-Za-z0-9._-]{1,80}$/u.test(remote.name) ||
      cwd !== this.databaseDirectory
    )
      return false;
    const configured = await this.runDolt(cwd, ["remote", "-v"]);
    return (
      configured !== undefined &&
      configured.code === 0 &&
      !configured.exceeded &&
      configured.stdout.split("\n").some((line) => {
        const parts = line.trim().split(/\s+/u);
        return (
          parts.length === 2 &&
          parts[0] === remote.name &&
          parts[1] === remote.url
        );
      })
    );
  }

  private async runDolt(
    cwd: string,
    argv: readonly string[],
  ): Promise<Capture | undefined> {
    const executable = this.executable(this.doltExecutable);
    if (
      executable === undefined ||
      sameExecutable(this.doltRejectedExecutable, executable)
    )
      return undefined;
    this.doltRejectedExecutable = undefined;
    if (!sameExecutable(this.doltVersionExecutable, executable)) {
      this.doltVersionCheck = undefined;
      this.doltVersionExecutable = executable;
    }
    this.doltVersionCheck ??= this.runDoltOnce(executable.path, cwd, [
      "version",
    ]);
    const version = await this.doltVersionCheck;
    if (
      version === undefined ||
      version.code !== 0 ||
      version.stdout.split("\n", 1)[0] !== `dolt version ${PINNED_DOLT_VERSION}`
    )
      return undefined;
    const operational = this.executable(this.doltExecutable);
    if (operational === undefined || !sameExecutable(executable, operational)) {
      this.doltRejectedExecutable = operational ?? executable;
      return undefined;
    }
    return this.runDoltOnce(operational.path, cwd, argv);
  }

  private executable(value: string): Executable | undefined {
    if (!isAbsolute(value) || value.length > 4096 || value.includes("\u0000"))
      return undefined;
    try {
      const path = realpathSync.native(value);
      const stat = statSync(path, { throwIfNoEntry: false });
      const digest =
        stat === undefined ? undefined : executableDigest(path, stat.size);
      return stat === undefined || !stat.isFile() || digest === undefined
        ? undefined
        : {
            ctimeMs: stat.ctimeMs,
            dev: stat.dev,
            digest,
            ino: stat.ino,
            mtimeMs: stat.mtimeMs,
            mode: stat.mode,
            path,
            size: stat.size,
          };
    } catch {
      return undefined;
    }
  }

  private canonicalDirectory(value: string): string {
    try {
      return realpathSync.native(value);
    } catch {
      return "";
    }
  }

  private async runDoltOnce(
    executable: string,
    cwd: string,
    argv: readonly string[],
  ): Promise<Capture | undefined> {
    return new Promise((resolve) => {
      let stdout = "";
      let bytes = 0;
      let exceeded = false;
      let settled = false;
      const child = spawn(executable, argv, {
        cwd,
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname(this.bdExecutable)}:${dirname(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          DARWIN_USER_TEMP_DIR:
            process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          TZ: "UTC",
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) {
          exceeded = true;
          child.kill("SIGKILL");
        } else stdout += chunk.toString("utf8");
      });
      child.once("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(undefined);
        }
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({ code, exceeded, stdout });
        }
      });
    });
  }
}
