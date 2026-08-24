import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import {
  type ChildProjection,
  type MutationBatch,
  type RootProjection,
  validateChildProjection,
  validateMutationBatch,
  validateRootProjection,
} from "../../fencing/index.js";
import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";

import type {
  CrashDiscovery,
  EmbeddedReadback,
  EmbeddedRequest,
  EmbeddedResponse,
} from "./schemas.js";
import type { ProjectionPersistencePort } from "./pinned-bd-process.js";

const MAX_OUTPUT_BYTES = 262_144;
const TIMEOUT_MS = 15_000;
const PINNED_DOLT_VERSION = "2.2.1";
type Executable = Readonly<{
  dev: number;
  ino: number;
  mtimeMs: number;
  path: string;
  size: number;
}>;
function sameExecutable(
  left: Executable | undefined,
  right: Executable,
): boolean {
  return (
    left !== undefined &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.path === right.path &&
    left.size === right.size
  );
}

export interface DoltProjectionOptions {
  /** Canonical `<bd dolt show.data_dir>/<database>` directory. */
  readonly databaseDirectory: string;
  readonly rootIssueId: string;
  readonly childIssueId: (unitId: string) => string | undefined;
  /** Absolute controller-approved executable; no PATH lookup is performed. */
  readonly doltExecutable: string;
}

export const PROJECTION_INITIALIZATION_AUTHORITY =
  "sce.embedded.projection.initialize.v1" as const;
export type ProjectionInitializationAuthority =
  typeof PROJECTION_INITIALIZATION_AUTHORITY;

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

/** Literal syntax uses only UTF-8 hex; issue IDs and JSON never enter SQL text. */
function stringLiteral(value: string): string {
  return `CONVERT(0x${hex(value)} USING utf8mb4)`;
}

function jsonLiteral(value: unknown): string {
  return `CAST(${stringLiteral(canonicalJson(value as JsonValue))} AS JSON)`;
}

function parseRows(
  source: string,
): readonly Record<string, unknown>[] | undefined {
  try {
    const input = JSON.parse(source) as unknown;
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !Array.isArray((input as { rows?: unknown }).rows) ||
      !(input as { rows: unknown[] }).rows.every(
        (row) => row !== null && typeof row === "object" && !Array.isArray(row),
      )
    )
      return undefined;
    return (input as { rows: Record<string, unknown>[] }).rows;
  } catch {
    return undefined;
  }
}

export class DoltProjectionPersistence implements ProjectionPersistencePort {
  private readonly directory: string;
  private readonly rootIssueId: string;
  private readonly childIssueId: (unitId: string) => string | undefined;
  private readonly doltExecutable: string;
  private versionCheck: Promise<boolean> | undefined;
  private versionExecutable: Executable | undefined;

  public constructor(options: DoltProjectionOptions) {
    try {
      this.directory = realpathSync.native(options.databaseDirectory);
    } catch {
      this.directory = "";
    }
    this.rootIssueId = options.rootIssueId;
    this.childIssueId = options.childIssueId;
    this.doltExecutable = options.doltExecutable;
  }

  public async mutate(batch: MutationBatch): Promise<EmbeddedResponse> {
    if (!validateMutationBatch(batch).ok)
      return { kind: "mutation", value: "quarantined" };
    const statement = this.writeStatement(batch);
    if (statement === undefined)
      return { kind: "mutation", value: "quarantined" };
    const output = await this.sql(
      `${statement}; SELECT ROW_COUNT() AS affected`,
    );
    const readback =
      output === undefined ||
      this.affected(output) !== batch.changedRows.length + 1
        ? undefined
        : await this.readback(batch);
    if (readback === undefined) return { kind: "mutation", value: "stale" };
    return { kind: "mutation", value: "applied" };
  }

  /**
   * Authorized bootstrap only. Normal CAS never calls this and therefore
   * refuses an absent `$.sce` envelope rather than creating it lazily.
   */
  public async initialize(
    authority: ProjectionInitializationAuthority,
    batch: MutationBatch,
  ): Promise<EmbeddedResponse> {
    if (
      authority !== PROJECTION_INITIALIZATION_AUTHORITY ||
      !validateMutationBatch(batch).ok
    )
      return { kind: "mutation", value: "quarantined" };
    const rows = this.rows(batch);
    if (rows === undefined) return { kind: "mutation", value: "quarantined" };
    const ids = rows.map((row) => stringLiteral(row.issueId)).join(",");
    const absent = rows
      .map(
        (row) =>
          `(id=${stringLiteral(row.issueId)} AND JSON_EXTRACT(metadata,'$.sce') IS NULL)`,
      )
      .join(" OR ");
    const cases = rows
      .map(
        (row) =>
          `WHEN ${stringLiteral(row.issueId)} THEN JSON_SET(metadata,'$.sce',${jsonLiteral(row.next)})`,
      )
      .join(" ");
    const source = await this.sql(
      `UPDATE issues SET metadata=CASE id ${cases} ELSE metadata END WHERE id IN (${ids}) AND (SELECT COUNT(*) FROM issues WHERE ${absent})=${rows.length}; SELECT ROW_COUNT() AS affected`,
    );
    const readback =
      source === undefined || this.affected(source) !== rows.length
        ? undefined
        : await this.readback(batch);
    if (readback === undefined) return { kind: "mutation", value: "stale" };
    return { kind: "mutation", value: "applied" };
  }

  public async readback(
    batch: MutationBatch,
  ): Promise<EmbeddedReadback | undefined> {
    if (!validateMutationBatch(batch).ok) return undefined;
    const statement = this.readStatement(batch);
    if (statement === undefined) return undefined;
    const output = await this.sql(statement);
    return output === undefined ? undefined : this.parseReadback(output, batch);
  }

  public async discover(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
  ): Promise<CrashDiscovery | undefined> {
    return this.discoverAt(request, undefined);
  }

  public async discoverAt(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
    ref: string | undefined,
  ): Promise<CrashDiscovery | undefined> {
    if (!validateMutationBatch(request.batch).ok) return undefined;
    const actual = await this.actual(request.batch, ref);
    const head = await this.head(ref);
    if (actual === undefined || head === undefined) return undefined;
    const rootCommitment = actual.root.aggregateCommitment;
    const childCommitments = actual.children.map((child) => child.commitment);
    if (
      same(actual.root, request.batch.next.root) &&
      same(actual.children, request.batch.next.children)
    )
      return { childCommitments, head, rootCommitment, status: "observed" };
    return rootCommitment === request.batch.expectedAggregateCommitment &&
      same(
        childCommitments,
        request.batch.expectedChildren.map((child) => child.expectedCommitment),
      )
      ? { head, status: "absent" }
      : { head, status: "ambiguous" };
  }

  private writeStatement(batch: MutationBatch): string | undefined {
    const rows = this.rows(batch);
    if (rows === undefined) return undefined;
    const expected = rows
      .map(
        (row) =>
          `(id=${stringLiteral(row.issueId)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.sce.commitment'))=${stringLiteral(row.expectedCommitment)})`,
      )
      .join(" OR ");
    const cases = rows
      .map(
        (row) =>
          `WHEN ${stringLiteral(row.issueId)} THEN JSON_SET(metadata,'$.sce',${jsonLiteral(row.next)})`,
      )
      .join(" ");
    const ids = rows.map((row) => stringLiteral(row.issueId)).join(",");
    return `UPDATE issues SET metadata=CASE id ${cases} ELSE metadata END WHERE id IN (${ids}) AND (SELECT COUNT(*) FROM issues WHERE ${expected})=${rows.length}`;
  }

  private readStatement(batch: MutationBatch): string | undefined {
    const rows = this.rows(batch);
    return rows === undefined
      ? undefined
      : this.selectStatement(rows.map((row) => row.issueId));
  }

  private selectStatement(ids: readonly string[]): string {
    return `SELECT id, JSON_EXTRACT(metadata,'$.sce') AS sce FROM issues WHERE id IN (${ids.map(stringLiteral).join(",")}) ORDER BY id`;
  }

  private async actual(
    batch: MutationBatch,
    ref: string | undefined,
  ): Promise<EmbeddedReadback | undefined> {
    const rows = this.rows(batch);
    if (
      rows === undefined ||
      (ref !== undefined && !/^[A-Za-z0-9._-]{1,80}\/main$/u.test(ref))
    )
      return undefined;
    const statement = this.selectStatement(rows.map((row) => row.issueId));
    const source = await this.sql(
      ref === undefined
        ? statement
        : statement.replace(" FROM issues", ` FROM issues AS OF '${ref}'`),
    );
    if (source === undefined) return undefined;
    const records = parseRows(source);
    if (records === undefined || records.length !== rows.length)
      return undefined;
    let root: RootProjection | undefined;
    const children: ChildProjection[] = [];
    for (const record of records) {
      if (typeof record.id !== "string") return undefined;
      const payload = record.sce;
      const projection =
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload)
          ? (payload as { projection?: unknown }).projection
          : undefined;
      if (record.id === this.rootIssueId) {
        const candidate = validateRootProjection(projection);
        if (!candidate.ok) return undefined;
        root = candidate.value;
        continue;
      }
      const candidate = validateChildProjection(projection);
      if (
        !candidate.ok ||
        this.childIssueId(candidate.value.unitId) !== record.id
      )
        return undefined;
      children.push(candidate.value);
    }
    return root === undefined || children.length !== batch.changedRows.length
      ? undefined
      : {
          children: children.sort((a, b) =>
            compareCodeUnits(a.unitId, b.unitId),
          ),
          root,
        };
  }

  private rows(batch: MutationBatch):
    | readonly {
        issueId: string;
        expectedCommitment: string;
        next: unknown;
      }[]
    | undefined {
    const children = batch.changedRows.map((row) => {
      const child = batch.next.children.find(
        (item) => item.unitId === row.unitId,
      );
      const issueId = this.childIssueId(row.unitId);
      return child === undefined || issueId === undefined
        ? undefined
        : {
            expectedCommitment: row.expectedCommitment,
            issueId,
            next: { commitment: child.commitment, projection: child },
          };
    });
    if (children.some((row) => row === undefined)) return undefined;
    return [
      {
        expectedCommitment: batch.expectedAggregateCommitment,
        issueId: this.rootIssueId,
        next: {
          commitment: batch.next.root.aggregateCommitment,
          projection: batch.next.root,
        },
      },
      ...(children as {
        expectedCommitment: string;
        issueId: string;
        next: unknown;
      }[]),
    ].sort((left, right) => compareCodeUnits(left.issueId, right.issueId));
  }

  private parseReadback(
    source: string,
    batch: MutationBatch,
  ): EmbeddedReadback | undefined {
    const rows = parseRows(source);
    if (rows === undefined || rows.length !== batch.changedRows.length + 1)
      return undefined;
    let root: RootProjection | undefined;
    const children: ChildProjection[] = [];
    for (const row of rows) {
      const payload = row.sce;
      if (
        payload === null ||
        typeof payload !== "object" ||
        Array.isArray(payload)
      )
        return undefined;
      const projection = (payload as { projection?: unknown }).projection;
      const candidateRoot = validateRootProjection(projection);
      if (candidateRoot.ok) {
        root = candidateRoot.value;
        continue;
      }
      const candidateChild = validateChildProjection(projection);
      if (!candidateChild.ok) return undefined;
      children.push(candidateChild.value);
    }
    return root === undefined ||
      !same(root, batch.next.root) ||
      !same(
        children.sort((a, b) => compareCodeUnits(a.unitId, b.unitId)),
        [...batch.next.children].sort((a, b) =>
          compareCodeUnits(a.unitId, b.unitId),
        ),
      )
      ? undefined
      : { children, root };
  }

  private async sql(query: string): Promise<string | undefined> {
    const executable = this.executable();
    if (executable === undefined || !(await this.pinnedVersion(executable)))
      return undefined;
    return new Promise((resolve) => {
      let output = "";
      let bytes = 0;
      let settled = false;
      const child = spawn(executable.path, ["sql", "-r", "json", "-q", query], {
        cwd: this.directory,
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          DARWIN_USER_TEMP_DIR:
            process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          TZ: "UTC",
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) child.kill("SIGKILL");
        else output += chunk.toString("utf8");
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
          resolve(code === 0 && bytes <= MAX_OUTPUT_BYTES ? output : undefined);
        }
      });
    });
  }

  private affected(source: string): number | undefined {
    const rows = parseRows(source);
    const value = rows?.length === 1 ? rows[0]?.affected : undefined;
    return typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : undefined;
  }

  private executable(): Executable | undefined {
    if (
      !isAbsolute(this.doltExecutable) ||
      this.doltExecutable.includes("\u0000")
    )
      return undefined;
    try {
      const path = realpathSync.native(this.doltExecutable);
      const stat = statSync(path, { throwIfNoEntry: false });
      return stat === undefined || !stat.isFile()
        ? undefined
        : {
            dev: stat.dev,
            ino: stat.ino,
            mtimeMs: stat.mtimeMs,
            path,
            size: stat.size,
          };
    } catch {
      return undefined;
    }
  }

  private pinnedVersion(executable: Executable): Promise<boolean> {
    if (!sameExecutable(this.versionExecutable, executable)) {
      this.versionCheck = undefined;
      this.versionExecutable = executable;
    }
    this.versionCheck ??= new Promise((resolve) => {
      let output = "";
      let settled = false;
      const child = spawn(executable.path, ["version"], {
        cwd: this.directory,
        env: {
          DARWIN_USER_TEMP_DIR:
            process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          TZ: "UTC",
        },
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES)
          child.kill("SIGKILL");
      });
      child.once("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(
            code === 0 &&
              output.split("\n", 1)[0] ===
                `dolt version ${PINNED_DOLT_VERSION}`,
          );
        }
      });
    });
    return this.versionCheck;
  }

  private async head(ref: string | undefined): Promise<string | undefined> {
    const source = await this.sql(
      `SELECT DOLT_HASHOF('${ref ?? "HEAD"}') AS head`,
    );
    const rows = source === undefined ? undefined : parseRows(source);
    const value = rows?.length === 1 ? rows[0]?.head : undefined;
    return typeof value === "string" && /^[0-9a-z]{20,64}$/u.test(value)
      ? value
      : undefined;
  }
}
