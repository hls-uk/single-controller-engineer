import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { FeedbackAuthority } from "./authority.js";
import { authorizes } from "./authority.js";
import type { FeedbackPacket } from "./packet.js";
import {
  FIXED_TARGET_REPOSITORY_ID,
  validateFeedbackPacket,
} from "./packet.js";
import { GitHubIssueSchema, isFeedbackSchema } from "./schemas.js";
import {
  discoverExisting,
  executeDurableIntent,
  type FeedbackGitHubTransport,
  type GitHubIssue,
  type SubmitResult,
} from "./submit.js";

export const OUTBOX_MAX_PACKETS = 100;
export const OUTBOX_MAX_BYTES = 5 * 1024 * 1024;
const OUTBOX_SCHEMA_VERSION = 1 as const;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
// Process-local serialization supplements the durable intent file for separate
// instances sharing one common Git directory.
const activeFlushes = new Set<string>();

export type OutboxStatus =
  "pending" | "submit_intent" | "submitted" | "quarantined";

export interface OutboxEnvelope {
  readonly schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  readonly status: OutboxStatus;
  readonly packet: FeedbackPacket;
  readonly stableErrorCode?: string;
  readonly issue?: Readonly<{ number: number; url: string }>;
  readonly operationNonce?: string;
}

export type OutboxResult<T = undefined> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{
      status: "unavailable" | "busy" | "quota" | "not_found" | "invalid";
    }>;

type SubmitIntentRecovery =
  | Readonly<{ status: "absent"; value: OutboxEnvelope }>
  | Readonly<{ status: "existing"; value: OutboxEnvelope }>
  | Readonly<{
      status: "ambiguous";
      code: "GITHUB_UNAVAILABLE" | "GITHUB_REJECTED";
    }>
  | Exclude<OutboxResult<OutboxEnvelope>, Readonly<{ status: "ok" }>>;

type SubmissionLockAcquire =
  | Readonly<{
      status: "ok";
      descriptor: number;
      identity: Readonly<{ dev: number; ino: number }>;
      path: string;
    }>
  | Readonly<{ status: "busy" | "unavailable" }>;

export interface OutboxHooks {
  readonly afterTempFsync?: () => void;
  readonly afterRename?: () => void;
  /** Positive external observation of a killed holder; never a TTL/PID guess. */
  readonly recoverKilledLock?: (
    identity: Readonly<{ dev: number; ino: number }>,
  ) => boolean;
}

export class FeedbackOutbox {
  readonly directory: string;
  private readonly lockPath: string;

  private constructor(
    directory: string,
    private readonly hooks: OutboxHooks,
  ) {
    this.directory = directory;
    this.lockPath = join(directory, ".lock");
  }

  static open(
    commonDir: string,
    hooks: OutboxHooks = {},
  ): OutboxResult<FeedbackOutbox> {
    const directory = outboxDirectory(commonDir);
    return directory === undefined
      ? { status: "unavailable" }
      : { status: "ok", value: new FeedbackOutbox(directory, hooks) };
  }

  enqueue(packet: unknown): OutboxResult {
    return this.withLock(() => {
      const valid = validateFeedbackPacket(packet);
      if (valid === undefined) return { status: "invalid" };
      const path = this.packetPath(valid.telemetry.fingerprint);
      const existing = safeFile(path);
      if (existing !== undefined) {
        const envelope = parseEnvelope(existing);
        return envelope !== undefined && samePacket(envelope.packet, valid)
          ? { status: "ok", value: undefined }
          : { status: "invalid" };
      }
      const source = sourceFor({
        schemaVersion: OUTBOX_SCHEMA_VERSION,
        status: "pending",
        packet: valid,
      });
      const quota = this.hasCapacity(
        new TextEncoder().encode(source).byteLength,
      );
      if (quota !== "ok") return { status: quota };
      return this.write(path, {
        schemaVersion: OUTBOX_SCHEMA_VERSION,
        status: "pending",
        packet: valid,
      });
    });
  }

  read(fingerprint: string): OutboxResult<OutboxEnvelope> {
    if (!FINGERPRINT.test(fingerprint)) return { status: "invalid" };
    const source = safeFile(this.packetPath(fingerprint));
    if (source === undefined) return { status: "not_found" };
    const envelope = parseEnvelope(source);
    return envelope === undefined ||
      envelope.packet.telemetry.fingerprint !== fingerprint
      ? { status: "invalid" }
      : { status: "ok", value: envelope };
  }

  list(): OutboxResult<readonly OutboxEnvelope[]> {
    const names = safeNames(this.directory);
    if (names === undefined) return { status: "unavailable" };
    const envelopes: OutboxEnvelope[] = [];
    for (const name of names.filter((entry) =>
      /^[0-9a-f]{64}\.json$/u.test(entry),
    )) {
      const source = safeFile(join(this.directory, name));
      const envelope = source === undefined ? undefined : parseEnvelope(source);
      if (
        envelope === undefined ||
        envelope.packet.telemetry.fingerprint !== name.slice(0, -5)
      )
        return { status: "invalid" };
      envelopes.push(envelope);
    }
    return {
      status: "ok",
      value: envelopes.sort((a, b) =>
        a.packet.telemetry.fingerprint.localeCompare(
          b.packet.telemetry.fingerprint,
        ),
      ),
    };
  }

  findExactMarker(marker: string): OutboxResult<readonly OutboxEnvelope[]> {
    const listed = this.list();
    return listed.status !== "ok"
      ? listed
      : {
          status: "ok",
          value: listed.value.filter((entry) => entry.packet.marker === marker),
        };
  }

  markSubmitIntent(
    fingerprint: string,
    operationNonce: string,
  ): OutboxResult<OutboxEnvelope> {
    if (!/^[A-Za-z0-9._:-]{16,160}$/u.test(operationNonce))
      return { status: "invalid" };
    return this.transition(
      fingerprint,
      ["pending", "submit_intent"],
      "submit_intent",
      { operationNonce },
    );
  }

  markSubmitted(
    fingerprint: string,
    issue: GitHubIssue,
  ): OutboxResult<OutboxEnvelope> {
    const current = this.read(fingerprint);
    if (
      current.status !== "ok" ||
      !isFeedbackSchema<GitHubIssue>(GitHubIssueSchema, issue) ||
      issue.repositoryId !== FIXED_TARGET_REPOSITORY_ID ||
      issue.url !==
        `https://github.com/hls-uk/single-controller-engineer/issues/${issue.number}` ||
      issue.body !== current.value.packet.body
    )
      return { status: "invalid" };
    return this.transition(
      fingerprint,
      ["pending", "submit_intent"],
      "submitted",
      {
        issue: { number: issue.number, url: issue.url },
      },
    );
  }

  quarantine(
    fingerprint: string,
    stableErrorCode: string,
  ): OutboxResult<OutboxEnvelope> {
    if (!/^[A-Z][A-Z0-9_]{0,79}$/u.test(stableErrorCode))
      return { status: "invalid" };
    return this.transition(
      fingerprint,
      ["pending", "submit_intent", "submitted", "quarantined"],
      "quarantined",
      { stableErrorCode },
    );
  }

  async recoverSubmitIntent(
    fingerprint: string,
    transport: FeedbackGitHubTransport,
  ): Promise<SubmitIntentRecovery> {
    const loaded = this.read(fingerprint);
    if (loaded.status !== "ok") return loaded;
    if (loaded.value.status !== "submit_intent") return { status: "invalid" };
    try {
      const existing = await discoverExisting(loaded.value.packet, transport);
      if (existing.status === "existing") {
        const persisted = this.markSubmitted(fingerprint, existing.issue);
        return persisted.status === "ok"
          ? { status: "existing", value: persisted.value }
          : persisted;
      }
      if (existing.status === "absent")
        return { status: "absent", value: loaded.value };
      return {
        status: "ambiguous",
        code:
          existing.status === "invalid"
            ? "GITHUB_REJECTED"
            : "GITHUB_UNAVAILABLE",
      };
    } catch {
      return { status: "ambiguous", code: "GITHUB_UNAVAILABLE" };
    }
  }

  async flush(
    fingerprint: string,
    authority: FeedbackAuthority | undefined,
    transport: FeedbackGitHubTransport,
  ): Promise<SubmitResult | OutboxResult> {
    const flushKey = `${this.directory}/${fingerprint}`;
    if (activeFlushes.has(flushKey)) return { status: "busy" };
    activeFlushes.add(flushKey);
    const submissionLock = this.acquireSubmissionLock(fingerprint);
    if (submissionLock.status !== "ok") {
      activeFlushes.delete(flushKey);
      return submissionLock;
    }
    try {
      const loaded = this.read(fingerprint);
      if (loaded.status !== "ok") return loaded;
      if (
        loaded.value.status === "quarantined" ||
        loaded.value.status === "submitted"
      )
        return { status: "invalid" };
      if (loaded.value.status === "submit_intent") {
        const recovered = await this.recoverSubmitIntent(
          fingerprint,
          transport,
        );
        if (recovered.status === "ambiguous") return recovered;
        if (recovered.status === "existing")
          return {
            status: "existing",
            issue: {
              repositoryId: recovered.value.packet.target.repositoryId,
              number: recovered.value.issue!.number,
              url: recovered.value.issue!.url,
              body: recovered.value.packet.body,
              open: true,
            },
          };
        if (recovered.status !== "absent") return recovered;
        if (
          authority === undefined ||
          recovered.value.operationNonce === authority.operationNonce
        )
          return { status: "unauthorized" };
      }
      if (
        authority === undefined ||
        !authorizes(loaded.value.packet, authority)
      )
        return { status: "unauthorized" };
      const intent = this.markSubmitIntent(
        fingerprint,
        authority.operationNonce,
      );
      if (intent.status !== "ok") return intent;
      const result = await executeDurableIntent(
        intent.value.packet,
        authority,
        transport,
      );
      if (result.status === "submitted" || result.status === "existing") {
        const persisted = this.markSubmitted(fingerprint, result.issue);
        if (persisted.status !== "ok") return persisted;
      }
      return result;
    } finally {
      this.releaseLock(
        submissionLock.descriptor,
        submissionLock.identity,
        submissionLock.path,
      );
      activeFlushes.delete(flushKey);
    }
  }

  private transition(
    fingerprint: string,
    allowed: readonly OutboxStatus[],
    status: OutboxStatus,
    extra: Pick<
      OutboxEnvelope,
      "issue" | "stableErrorCode" | "operationNonce"
    > = {},
  ): OutboxResult<OutboxEnvelope> {
    return this.withLock(() => {
      const current = this.read(fingerprint);
      if (current.status !== "ok") return current;
      if (!allowed.includes(current.value.status)) return { status: "invalid" };
      const next: OutboxEnvelope = { ...current.value, status, ...extra };
      const written = this.write(this.packetPath(fingerprint), next);
      return written.status === "ok" ? { status: "ok", value: next } : written;
    });
  }

  private withLock<T>(operation: () => OutboxResult<T>): OutboxResult<T> {
    let descriptor: number | undefined;
    let opened: Readonly<{ dev: number; ino: number }> | undefined;
    try {
      if (constants.O_NOFOLLOW === undefined) return { status: "unavailable" };
      descriptor = openSync(
        this.lockPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o600)
        return { status: "unavailable" };
      opened = { dev: stat.dev, ino: stat.ino };
      return operation();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        return { status: "unavailable" };
      return this.recoverKilledLock(this.lockPath)
        ? this.withLock(operation)
        : { status: "busy" };
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        try {
          const stat = lstatSync(this.lockPath);
          if (
            stat.isFile() &&
            !stat.isSymbolicLink() &&
            (stat.mode & 0o777) === 0o600 &&
            stat.dev === opened?.dev &&
            stat.ino === opened?.ino
          )
            unlinkSync(this.lockPath);
        } catch {
          // A lock we cannot positively identify must not be removed.
        }
      }
    }
  }

  private recoverKilledLock(path: string): boolean {
    try {
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o777) !== 0o600
      )
        return false;
      const identity = { dev: stat.dev, ino: stat.ino };
      if (this.hooks.recoverKilledLock?.(identity) !== true) return false;
      const current = lstatSync(path);
      if (
        current.dev !== identity.dev ||
        current.ino !== identity.ino ||
        current.isSymbolicLink()
      )
        return false;
      unlinkSync(path);
      return true;
    } catch {
      return false;
    }
  }

  private acquireSubmissionLock(fingerprint: string): SubmissionLockAcquire {
    const path = join(this.directory, `.submit-${fingerprint}.lock`);
    try {
      if (constants.O_NOFOLLOW === undefined) return { status: "unavailable" };
      const descriptor = openSync(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
        closeSync(descriptor);
        return { status: "unavailable" };
      }
      return {
        status: "ok",
        descriptor,
        identity: { dev: stat.dev, ino: stat.ino },
        path,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        return { status: "unavailable" };
      return this.recoverKilledLock(path)
        ? this.acquireSubmissionLock(fingerprint)
        : { status: "busy" };
    }
  }

  private releaseLock(
    descriptor: number,
    identity: Readonly<{ dev: number; ino: number }>,
    path: string,
  ): void {
    closeSync(descriptor);
    try {
      const stat = lstatSync(path);
      if (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.dev === identity.dev &&
        stat.ino === identity.ino
      )
        unlinkSync(path);
    } catch {
      // Replacement and unreadable locks are left intact.
    }
  }

  private hasCapacity(incomingBytes: number): "ok" | "quota" | "unavailable" {
    const names = safeNames(this.directory);
    if (names === undefined) return "unavailable";
    let packets = 0;
    let bytes = 0;
    for (const name of names) {
      if (name === ".lock") continue;
      const stat = safeStat(join(this.directory, name));
      if (stat === undefined) return "unavailable";
      bytes += stat.size;
      if (/^[0-9a-f]{64}\.json$/u.test(name)) packets += 1;
    }
    return packets >= OUTBOX_MAX_PACKETS ||
      bytes + incomingBytes > OUTBOX_MAX_BYTES
      ? "quota"
      : "ok";
  }

  private write(path: string, envelope: OutboxEnvelope): OutboxResult {
    const source = sourceFor(envelope);
    if (new TextEncoder().encode(source).byteLength > OUTBOX_MAX_BYTES)
      return { status: "quota" };
    const temporary = join(
      this.directory,
      `.${envelope.packet.telemetry.fingerprint}.${randomUUID()}.tmp`,
    );
    let descriptor: number | undefined;
    try {
      if (constants.O_NOFOLLOW === undefined) return { status: "unavailable" };
      descriptor = openSync(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, source, "utf8");
      fsyncSync(descriptor);
      this.hooks.afterTempFsync?.();
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, path);
      fsyncDirectory(this.directory);
      this.hooks.afterRename?.();
      return { status: "ok", value: undefined };
    } catch {
      return { status: "unavailable" };
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  private packetPath(fingerprint: string): string {
    return join(this.directory, `${fingerprint}.json`);
  }
}

function outboxDirectory(commonDir: string): string | undefined {
  try {
    // `realpath` may canonicalize macOS's /var alias; reject an input symlink
    // while still operating only on the resolved common directory.
    if (lstatSync(commonDir).isSymbolicLink()) return undefined;
    const resolved = realpathSync(commonDir);
    if (!strictDirectory(resolved)) return undefined;
    const sce = join(resolved, "sce");
    createStrictDirectory(sce);
    const outbox = join(sce, "feedback-outbox");
    createStrictDirectory(outbox);
    return statSync(resolved).dev === statSync(outbox).dev ? outbox : undefined;
  } catch {
    return undefined;
  }
}

function createStrictDirectory(path: string): void {
  let created = false;
  try {
    mkdirSync(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Never chmod an existing path before proving its identity and ownership.
  if (!strictDirectory(path)) throw new Error("unsafe outbox directory");
  if (created) chmodSync(path, 0o700);
  if (!strictDirectory(path, 0o700)) throw new Error("unsafe outbox directory");
}

function strictDirectory(path: string, mode?: number): boolean {
  try {
    const stat = lstatSync(path);
    return (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (typeof process.getuid !== "function" || stat.uid === process.getuid()) &&
      (mode === undefined || (stat.mode & 0o777) === mode)
    );
  } catch {
    return false;
  }
}

function safeNames(directory: string): readonly string[] | undefined {
  try {
    return readdirSync(directory);
  } catch {
    return undefined;
  }
}

function safeStat(path: string) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink() ? stat : undefined;
  } catch {
    return undefined;
  }
}

function safeFile(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (before.mode & 0o777) !== 0o600 ||
      constants.O_NOFOLLOW === undefined
    )
      return undefined;
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > OUTBOX_MAX_BYTES
    )
      return undefined;
    return readFileSync(descriptor, "utf8");
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function fsyncDirectory(directory: string): void {
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function samePacket(left: FeedbackPacket, right: FeedbackPacket): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceFor(envelope: OutboxEnvelope): string {
  return JSON.stringify(envelope);
}

function parseEnvelope(value: string): OutboxEnvelope | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !isObject(parsed) ||
      !hasExactKeys(parsed, [
        "schemaVersion",
        "status",
        "packet",
        "stableErrorCode",
        "issue",
        "operationNonce",
      ])
    )
      return undefined;
    const status = parsed.status;
    if (
      !isStatus(status) ||
      parsed.schemaVersion !== OUTBOX_SCHEMA_VERSION ||
      !isObject(parsed.packet)
    )
      return undefined;
    const packet = parsed.packet as unknown as FeedbackPacket;
    const valid = validateFeedbackPacket(packet);
    if (valid === undefined) return undefined;
    const stableErrorCode = parsed.stableErrorCode;
    const issue = parsed.issue;
    const operationNonce = parsed.operationNonce;
    if (
      stableErrorCode !== undefined &&
      (typeof stableErrorCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,79}$/u.test(stableErrorCode))
    )
      return undefined;
    if (issue !== undefined && !validIssue(issue)) return undefined;
    if (
      operationNonce !== undefined &&
      (typeof operationNonce !== "string" ||
        !/^[A-Za-z0-9._:-]{16,160}$/u.test(operationNonce))
    )
      return undefined;
    if (status === "submitted" && issue === undefined) return undefined;
    if (status === "submit_intent" && operationNonce === undefined)
      return undefined;
    if (status === "quarantined" && stableErrorCode === undefined)
      return undefined;
    return {
      schemaVersion: OUTBOX_SCHEMA_VERSION,
      status,
      packet: valid,
      ...(stableErrorCode === undefined ? {} : { stableErrorCode }),
      ...(issue === undefined
        ? {}
        : { issue: { number: issue.number, url: issue.url } }),
      ...(operationNonce === undefined ? {} : { operationNonce }),
    };
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validIssue(
  value: unknown,
): value is Readonly<{ number: number; url: string }> {
  return (
    isObject(value) &&
    typeof value.number === "number" &&
    Number.isSafeInteger(value.number) &&
    value.number >= 1 &&
    typeof value.url === "string" &&
    value.url ===
      `https://github.com/hls-uk/single-controller-engineer/issues/${value.number}` &&
    Object.keys(value).every((key) => key === "number" || key === "url")
  );
}

function isStatus(value: unknown): value is OutboxStatus {
  return (
    value === "pending" ||
    value === "submit_intent" ||
    value === "submitted" ||
    value === "quarantined"
  );
}
