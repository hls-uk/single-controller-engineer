import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute } from "node:path";

import {
  MERGE_SLOT_LABEL,
  MERGE_SLOT_TITLE,
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  type FencingScope,
  type MergeSlotObservation,
  validateMergeSlotObservation,
  type MutationBatch,
  validateMutationBatch,
} from "../../fencing/index.js";
import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import {
  isPinnedBdIssueRow,
  redactedStderrTail,
  REMOTE_FAILURE_WINDOW_CHARS,
  type EmbeddedResult,
  type RemoteFailureTail,
} from "./schemas.js";

import type {
  CarryCheckpointIntent,
  CrashDiscovery,
  EmbeddedInitialProjection,
  EmbeddedLoad,
  EmbeddedProcessPort,
  EmbeddedProcessIdentity,
  EmbeddedReadback,
  EmbeddedRequest,
  EmbeddedResponse,
  EmbeddedState,
  RemoteSlotTransitionProof,
  SlotTransitionIntent,
} from "./schemas.js";
import { parseDoltDiff } from "./dolt-diff-json.js";
import { validateSlotTransitionIntent } from "./slot-transition.js";
import {
  canonicalLocalBareRepository,
  normalizeGitRemote,
} from "../../preflight/index.js";

const MAX_OUTPUT_BYTES = 65_536;
export const PINNED_BD_VERSION = "1.1.0";
export const PINNED_DOLT_VERSION = "2.2.1";
const PROCESS_TIMEOUT_MS = 15_000;
/**
 * Remote Dolt traffic (bd dolt push/pull, dolt fetch/push/pull) crosses the
 * network; a git+ssh remote regularly needs more than the local budget. A
 * child killed at either budget is a timeout, never a conflict.
 */
const NETWORK_TIMEOUT_MS = 120_000;
function processTimeoutMs(argv: readonly string[]): number {
  const [first, second] = argv;
  const network =
    (first === "dolt" && (second === "push" || second === "pull")) ||
    first === "fetch" ||
    first === "push" ||
    first === "pull";
  return network ? NETWORK_TIMEOUT_MS : PROCESS_TIMEOUT_MS;
}
/**
 * A checkpoint proof reads a complete `dolt diff` of the changed projection
 * rows. The projection reader admits 256 KiB per capture, and a data diff
 * carries each changed row twice (from/to) as base64-wrapped cells, so an
 * exact delta can approach 700 KiB; 1 MiB bounds it. Every other capture
 * keeps the 64 KiB budget, and an exceeded capture is never a proof.
 */
const DELTA_OUTPUT_BYTES = 1_048_576;
export function outputBytesFor(argv: readonly string[]): number {
  return argv[0] === "diff" ? DELTA_OUTPUT_BYTES : MAX_OUTPUT_BYTES;
}
const EXECUTABLE_SAMPLE_BYTES = 65_536;
const MAX_CLONE_LINEAGE_EDGES = 64;

export interface ProjectionPersistencePort {
  initialize?(
    authority: "sce.embedded.projection.initialize.v1",
    input: EmbeddedInitialProjection,
    slot: MergeSlotObservation,
  ): Promise<EmbeddedResponse>;
  /** Reads the projection at `ref` (a Dolt commit hash) or the working set. */
  load?(ref?: string): Promise<EmbeddedLoad>;
  readCarry?(predecessorRootIssueId: string): Promise<EmbeddedResponse>;
  claimCarry?(
    request: Extract<EmbeddedRequest, { readonly kind: "carry_claim" }>,
  ): Promise<EmbeddedResponse>;
  discoverCarry?(
    request: Extract<EmbeddedRequest, { readonly kind: "carry_discover" }>,
    ref?: string,
  ): Promise<CrashDiscovery | undefined>;
  matchesCarryDelta?(intent: CarryCheckpointIntent, source: string): boolean;
  mutate(batch: MutationBatch): Promise<EmbeddedResponse>;
  mutatePreOwnership?(
    batch: MutationBatch,
    slot: MergeSlotObservation,
  ): Promise<EmbeddedResponse>;
  matchesInitialDelta?(
    input: EmbeddedInitialProjection,
    source: string,
  ): boolean;
  readback(batch: MutationBatch): Promise<EmbeddedReadback | undefined>;
  discover(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
  ): Promise<CrashDiscovery | undefined>;
  discoverAt(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
    ref: string,
  ): Promise<CrashDiscovery | undefined>;
  /** Proves that a complete Dolt data diff contains this batch and nothing else. */
  matchesBatchDelta(batch: MutationBatch, source: string): boolean;
  /**
   * Proves that a complete Dolt data diff is exactly the row movement from
   * the committed projection to the one the working set holds. A port without
   * it never decodes a pending delta, and the engine keeps refusing one.
   */
  matchesProjectionStepDelta?(
    before: EmbeddedReadback,
    after: EmbeddedReadback,
    source: string,
  ): boolean;
}

/**
 * A bounded, purely local ancestry question over the Dolt commit graph. Both
 * hashes are closed inputs: each must match the pinned commit-hash shape or
 * the probe refuses before spawning anything, and no other field is read. It
 * is deliberately not an `EmbeddedRequest`: answering it costs no network and
 * writes nothing, and it is the only read that tells a locally-ahead store
 * from a diverged one.
 */
export type EmbeddedAncestryRequest = Readonly<{
  /** The commit whose reachability from `descendant` is proved. */
  ancestor: string;
  /** The commit whose ancestry is walked. */
  descendant: string;
  kind: "ancestry";
}>;

/**
 * `observed` proves that `ancestor` is reachable from `descendant`; `absent`
 * proves that it is not. Everything else -- an unpinned or unreadable engine,
 * an over-budget or malformed capture, any count that is not an exact 0 or 1
 * -- is `ambiguous` and decides nothing.
 */
export type EmbeddedAncestryProof = "observed" | "absent" | "ambiguous";

export type EmbeddedAncestryResponse = Readonly<{
  kind: "ancestry";
  value: EmbeddedAncestryProof;
}>;

/**
 * An optional process capability, like the optional members of
 * `ProjectionPersistencePort`. A port without it never proves ancestry, and
 * every caller keeps exactly the behaviour it had before the probe existed.
 */
export interface EmbeddedAncestryPort {
  ancestry(request: EmbeddedAncestryRequest): Promise<EmbeddedAncestryResponse>;
}

/**
 * What the uncommitted Dolt working set holds, relative to the committed head
 * a load serves. A command killed between its projection mutation and its
 * commit leaves exactly that: a delta no later batch can ever resubmit, which
 * blocks every mutation until someone settles it (sce-ul2.4).
 *
 * Like the ancestry probe this is deliberately not an `EmbeddedRequest`: it
 * writes nothing, costs no network, and a process that does not publish it
 * keeps exactly the behaviour it had before the probe existed.
 */
export type EmbeddedPendingWorkingSetRequest = Readonly<{
  kind: "pending_working_set";
}>;

/**
 * `clean` proves there is no uncommitted delta at all. `pending` reports one,
 * always with the exact committed head it was diffed against, with the
 * projection it decodes to when it decodes, and with `delta` saying whether
 * that delta is *exactly* the row movement from the head projection to it.
 * `unproven` is every other pending delta -- a foreign write, an unreadable
 * or over-budget capture, a partial row set -- and authorizes nothing.
 */
export type EmbeddedPendingWorkingSet =
  | Readonly<{ status: "clean" }>
  | Readonly<{
      delta: "projection_step" | "unproven";
      head: string;
      pending?: EmbeddedReadback;
      status: "pending";
    }>
  | Readonly<{ status: "unavailable" }>;

export type EmbeddedPendingWorkingSetResponse = Readonly<{
  kind: "pending_working_set";
  value: EmbeddedPendingWorkingSet;
}>;

/**
 * The optional pending-delta probe. It is read-only: deciding what to do with
 * a pending delta, and committing it, belongs to the adapter, which alone
 * holds the holder and slot authority that makes a checkpoint legal.
 */
export interface EmbeddedPendingWorkingSetPort {
  pendingWorkingSet(
    request: EmbeddedPendingWorkingSetRequest,
  ): Promise<EmbeddedPendingWorkingSetResponse>;
}

/**
 * What the commits this clone holds beyond its remote actually moved. Like
 * the two probes above it is read-only, costs no network, and is deliberately
 * not an `EmbeddedRequest`.
 *
 * Both hashes are closed inputs; the caller proves the ancestry relation
 * first, so this asks only what the proved range contains.
 */
export type EmbeddedAheadRangeRequest = Readonly<{
  /** The durable local head whose unpublished range is classified. */
  head: string;
  kind: "ahead_range";
  /** The remote head the range is measured from, already proved an ancestor. */
  remoteHead: string;
}>;

/**
 * `engine_delta` proves the whole range moved exactly the projection rows
 * this engine writes -- the root plus each child whose commitment moved, in
 * the issues table, in their `sce` envelope alone -- and nothing else. Any
 * other row, table, column, insert, or deletion in the range is `foreign`: an
 * operator's own uncommitted-then-committed `bd` write is the ordinary case.
 * `unavailable` is an unreadable, over-budget, or uncapable probe and proves
 * nothing either way.
 */
export type EmbeddedAheadRange = "engine_delta" | "foreign" | "unavailable";

export type EmbeddedAheadRangeResponse = Readonly<{
  kind: "ahead_range";
  value: EmbeddedAheadRange;
}>;

/**
 * The optional ahead-range probe. It classifies; it never publishes. Deciding
 * to push the range belongs to the adapter, which alone holds the slot and
 * holder authority that makes a push legal.
 */
export interface EmbeddedAheadRangePort {
  aheadRange(
    request: EmbeddedAheadRangeRequest,
  ): Promise<EmbeddedAheadRangeResponse>;
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
  /** Present only when the child wrote stderr; see `redactedStderrTail`. */
  stderrTail?: RemoteFailureTail;
  stdout: string;
  /** The child was killed at its time budget; its exit code proves nothing. */
  timedOut: boolean;
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

/**
 * A bounded rolling window over one child's stderr. Only the window is held:
 * a child that floods stderr costs the same as one that writes a line.
 */
function stderrWindow() {
  let text = "";
  let dropped = false;
  return {
    push(chunk: Buffer): void {
      text += chunk.toString("utf8");
      if (text.length > REMOTE_FAILURE_WINDOW_CHARS) {
        text = text.slice(text.length - REMOTE_FAILURE_WINDOW_CHARS);
        dropped = true;
      }
    },
    /** The `Capture` field, or no field at all when nothing survives. */
    captured(): Readonly<{ stderrTail?: RemoteFailureTail }> {
      const stderrTail = redactedStderrTail(text, dropped);
      return stderrTail === undefined ? {} : { stderrTail };
    },
  };
}

/**
 * Attaches a failed child's tail to the observation it caused. The tail never
 * changes a classification; it only lets a refusal name its cause.
 */
/**
 * A clean, in-budget exit carries no tail. A child killed at a budget keeps
 * whatever it said even when it managed to exit 0 before the kill landed: the
 * budget decided the refusal, so the tail is its only account (sce-ul2.7).
 */
export function failureTail(
  capture: Pick<Capture, "code" | "exceeded" | "stderrTail" | "timedOut">,
): Readonly<{ stderrTail?: RemoteFailureTail }> {
  const clean = capture.code === 0 && !capture.exceeded && !capture.timedOut;
  return clean || capture.stderrTail === undefined
    ? {}
    : { stderrTail: capture.stderrTail };
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

/**
 * A configured Dolt remote matches the run's remote when the raw URL is equal
 * or when both reduce to the same identity preflight derives for `bd`'s
 * `sync.remote` (Dolt prints `git+` schemes that preflight normalizes away).
 */
function sameRemoteIdentity(configuredUrl: string, expected: string): boolean {
  if (configuredUrl === expected) return true;
  const plain = configuredUrl.startsWith("git+file://")
    ? configuredUrl.slice("git+".length)
    : configuredUrl;
  const normalized = normalizeGitRemote(plain, canonicalLocalBareRepository);
  return normalized !== undefined && normalized === expected;
}

/** Non-interactive SSH/Git for remote Dolt transport: agent passthrough, no prompts. */
function sshEnvironment(): Readonly<Record<string, string>> {
  const socket = process.env.SSH_AUTH_SOCK;
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
    ...(socket === undefined || socket.length === 0 || socket.includes("\u0000")
      ? {}
      : { SSH_AUTH_SOCK: socket }),
  };
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

/**
 * The only clone-local merge delta emitted by a pinned bd 1.1.0 `dolt pull`.
 * This is deliberately separate from exactSlotDelta: metadata is never
 * tolerated in the authoritative remote parent→effect proof.
 */
export function isPinnedCloneMergeDelta(source: string): boolean {
  const raw = object(parseDoltDiff(source));
  if (
    raw === undefined ||
    Object.keys(raw).length !== 1 ||
    Object.keys(raw)[0] !== "tables"
  )
    return false;
  const tables = raw?.tables;
  if (!Array.isArray(tables) || tables.length !== 1) return false;
  const table = object(tables[0]);
  const diffs = table?.data_diff;
  if (
    table === undefined ||
    Object.keys(table).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(table, "name") ||
    !Object.prototype.hasOwnProperty.call(table, "data_diff") ||
    table.name !== "metadata" ||
    !Array.isArray(diffs) ||
    diffs.length !== 2
  )
    return false;
  const seen = new Set<string>();
  for (const diff of diffs) {
    const entry = object(diff);
    const from = object(entry?.from_row);
    const to = object(entry?.to_row);
    if (
      entry === undefined ||
      Object.keys(entry).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(entry, "from_row") ||
      !Object.prototype.hasOwnProperty.call(entry, "to_row") ||
      from === undefined ||
      to === undefined ||
      Object.keys(from).length !== 2 ||
      Object.keys(to).length !== 2 ||
      Object.keys(from).some((key) => key !== "key" && key !== "value") ||
      Object.keys(to).some((key) => key !== "key" && key !== "value") ||
      from.key !== to.key ||
      typeof from.key !== "string" ||
      seen.has(from.key) ||
      typeof from.value !== "string" ||
      typeof to.value !== "string" ||
      from.value === to.value
    )
      return false;
    seen.add(from.key);
    if (
      (from.key === "clone_id" &&
        (!/^[0-9a-f]{16}$/u.test(from.value) ||
          !/^[0-9a-f]{16}$/u.test(to.value))) ||
      (from.key === "last_import_time" &&
        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
          from.value,
        ) ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
            to.value,
          )))
    )
      return false;
  }
  return (
    seen.size === 2 && seen.has("clone_id") && seen.has("last_import_time")
  );
}

const SLOT_ISSUE_BASE_KEYS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "compaction_level",
  "content_hash",
  "created_at",
  "created_by",
  "description",
  "design",
  "ephemeral",
  "event_kind",
  "external_ref",
  "hook_bead",
  "id",
  "is_blocked",
  "is_template",
  "issue_type",
  "metadata",
  "mol_type",
  "no_history",
  "notes",
  "owner",
  "payload",
  "pinned",
  "priority",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "status",
  "target",
  "timeout_ns",
  "title",
  "updated_at",
  "waiters",
  "wisp_type",
  "work_type",
] as const;
const SLOT_ISSUE_NUMERIC_KEYS = [
  "compaction_level",
  "ephemeral",
  "is_blocked",
  "is_template",
  "no_history",
  "pinned",
  "priority",
  "timeout_ns",
] as const;
const SLOT_ISSUE_STRING_KEYS = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "content_hash",
  "created_by",
  "description",
  "design",
  "event_kind",
  "external_ref",
  "hook_bead",
  "mol_type",
  "notes",
  "owner",
  "payload",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "target",
  "waiters",
  "wisp_type",
  "work_type",
] as const;
const EVENT_ROW_KEYS = [
  "actor",
  "created_at",
  "event_type",
  "id",
  "issue_id",
  "new_value",
  "old_value",
] as const;
const EVENT_OLD_BASE_KEYS = [
  "created_at",
  "description",
  "design",
  "external_ref",
  "id",
  "issue_type",
  "labels",
  "priority",
  "status",
  "title",
  "updated_at",
] as const;

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return (
      canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue)
    );
  } catch {
    return false;
  }
}

function sqlTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
  );
}

function eventTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
  );
}

function eventId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  );
}

function jsonObjectString(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return object(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function exactSlotMetadata(
  value: unknown,
  holder: string | undefined,
): boolean {
  const metadata = object(value);
  return (
    metadata !== undefined &&
    hasExactKeys(metadata, holder === undefined ? [] : ["holder"]) &&
    (holder === undefined || metadata.holder === holder)
  );
}

function exactSlotIssueRow(
  row: Record<string, unknown>,
  expectedId: string,
  status: "open" | "in_progress",
  holder: string | undefined,
  hasStartedAt: boolean,
): boolean {
  const expectedKeys = hasStartedAt
    ? [...SLOT_ISSUE_BASE_KEYS, "started_at"]
    : SLOT_ISSUE_BASE_KEYS;
  return (
    isPinnedBdIssueRow(row) &&
    hasExactKeys(row, expectedKeys) &&
    row.id === expectedId &&
    row.issue_type === "task" &&
    row.status === status &&
    row.title === MERGE_SLOT_TITLE &&
    exactSlotMetadata(row.metadata, holder) &&
    SLOT_ISSUE_STRING_KEYS.every((key) => typeof row[key] === "string") &&
    SLOT_ISSUE_NUMERIC_KEYS.every(
      (key) => typeof row[key] === "number" && Number.isSafeInteger(row[key]),
    ) &&
    sqlTimestamp(row.created_at) &&
    sqlTimestamp(row.updated_at) &&
    (!hasStartedAt || sqlTimestamp(row.started_at))
  );
}

function exactPriorEventValue(
  value: Record<string, unknown>,
  issue: Record<string, unknown>,
  beforeHolder: string | undefined,
  hasStartedAt: boolean,
): boolean {
  const expectedKeys = [
    ...EVENT_OLD_BASE_KEYS,
    ...(beforeHolder === undefined ? [] : ["metadata"]),
    ...(hasStartedAt ? ["started_at"] : []),
  ];
  return (
    hasExactKeys(value, expectedKeys) &&
    value.id === issue.id &&
    value.title === issue.title &&
    value.description === issue.description &&
    value.design === issue.design &&
    value.status === issue.status &&
    value.priority === issue.priority &&
    value.issue_type === issue.issue_type &&
    value.external_ref === issue.external_ref &&
    eventTimestamp(value.created_at) &&
    eventTimestamp(value.updated_at) &&
    (!hasStartedAt || eventTimestamp(value.started_at)) &&
    Array.isArray(value.labels) &&
    value.labels.length === 1 &&
    value.labels[0] === MERGE_SLOT_LABEL &&
    (beforeHolder === undefined ||
      exactSlotMetadata(value.metadata, beforeHolder))
  );
}

function exactNextEventValue(
  value: Record<string, unknown>,
  issue: Record<string, unknown>,
  afterHolder: string | undefined,
): boolean {
  return (
    hasExactKeys(value, ["metadata", "status"]) &&
    value.status === issue.status &&
    typeof value.metadata === "string" &&
    exactSlotMetadata(jsonObjectString(value.metadata), afterHolder)
  );
}

/**
 * Strictly proves the complete, pinned bd 1.1.0 effect of one merge-slot
 * transition. This accepts parsed values only: every JSON envelope, table,
 * data-diff, and row has an exact known shape before semantic comparison.
 */
export function isPinnedSlotTransitionDelta(
  source: string,
  prefix: string,
  intent: SlotTransitionIntent,
): boolean {
  const raw = object(parseDoltDiff(source));
  if (raw === undefined || !hasExactKeys(raw, ["tables"])) return false;
  const tables = raw.tables;
  if (!Array.isArray(tables) || tables.length !== 2) return false;
  const byName = new Map<string, Record<string, unknown>>();
  for (const table of tables) {
    const value = object(table);
    const name = value === undefined ? undefined : value.name;
    if (
      value === undefined ||
      !hasExactKeys(value, ["name", "data_diff"]) ||
      (name !== "issues" && name !== "events") ||
      byName.has(name)
    )
      return false;
    byName.set(name, value);
  }
  const issues = byName.get("issues");
  const events = byName.get("events");
  if (issues === undefined || events === undefined) return false;
  const issueDiffs = issues.data_diff;
  const eventDiffs = events.data_diff;
  if (
    !Array.isArray(issueDiffs) ||
    issueDiffs.length !== 1 ||
    !Array.isArray(eventDiffs) ||
    eventDiffs.length !== 1
  )
    return false;
  const issue = object(issueDiffs[0]);
  const event = object(eventDiffs[0]);
  if (
    issue === undefined ||
    event === undefined ||
    !hasExactKeys(issue, ["from_row", "to_row"]) ||
    !hasExactKeys(event, ["from_row", "to_row"])
  )
    return false;
  const from = object(issue.from_row);
  const to = object(issue.to_row);
  const eventFrom = object(event.from_row);
  const eventTo = object(event.to_row);
  if (
    from === undefined ||
    to === undefined ||
    eventFrom === undefined ||
    !hasExactKeys(eventFrom, []) ||
    eventTo === undefined ||
    !hasExactKeys(eventTo, EVENT_ROW_KEYS) ||
    sameJson(from, to)
  )
    return false;
  const expectedId = `${prefix}-merge-slot`;
  const before = intent.before.slot;
  const after = intent.after;
  const fromStatus = before.status === "available" ? "open" : "in_progress";
  const toStatus = after.status === "available" ? "open" : "in_progress";
  // A released bd 1.1.0 slot preserves its historical started_at. A pristine
  // available slot has none; these are the only two pinned shapes.
  const fromHasStartedAt = Object.prototype.hasOwnProperty.call(
    from,
    "started_at",
  );
  const exactFrom = exactSlotIssueRow(
    from,
    expectedId,
    fromStatus,
    before.holder,
    fromHasStartedAt,
  );
  const exactTo = exactSlotIssueRow(
    to,
    expectedId,
    toStatus,
    after.holder,
    true,
  );
  if (
    !exactFrom ||
    !exactTo ||
    (before.status === "acquired" && !fromHasStartedAt)
  )
    return false;
  // bd 1.1.0 changes only status/holder metadata and generated timestamps on
  // the built-in issue. All other concrete fields are frozen byte-for-byte.
  const mutable = new Set(["metadata", "started_at", "status", "updated_at"]);
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (!mutable.has(key) && !sameJson(from[key], to[key])) return false;
  }
  const previousValue = jsonObjectString(eventTo.old_value);
  const nextValue = jsonObjectString(eventTo.new_value);
  return (
    eventId(eventTo.id) &&
    eventTo.issue_id === expectedId &&
    eventTo.actor === intent.holder &&
    eventTo.event_type === "status_changed" &&
    sqlTimestamp(eventTo.created_at) &&
    previousValue !== undefined &&
    exactPriorEventValue(
      previousValue,
      from,
      before.holder,
      fromHasStartedAt,
    ) &&
    nextValue !== undefined &&
    exactNextEventValue(nextValue, to, after.holder)
  );
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
  const rows = object(parsed)?.rows;
  const raw = Array.isArray(parsed)
    ? parsed.length === 1
      ? object(parsed[0])
      : undefined
    : Array.isArray(rows) && rows.length === 1
      ? object(rows[0])
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

function parseRemoteSlotDocument(
  issueSource: string,
  labelsSource: string,
  expectedId: string,
  expectedScope: FencingScope,
): SlotDocument | undefined {
  const rows = sqlRows(issueSource);
  const labels = sqlRows(labelsSource);
  if (
    rows === undefined ||
    rows.length !== 1 ||
    labels === undefined ||
    labels.length !== 1 ||
    labels[0]?.label !== MERGE_SLOT_LABEL
  )
    return undefined;
  return parseSlotDocument(
    JSON.stringify([{ ...rows[0], labels: [MERGE_SLOT_LABEL] }]),
    expectedId,
    expectedScope,
  );
}

/**
 * Concrete pinned-bd transport. It owns process invocation and exact parsing;
 * projection persistence is a separate topology-specific port because bd 1.1.0
 * has no atomic generic "write these arbitrary metadata rows" command.
 */
export class PinnedBdEmbeddedProcess
  implements
    EmbeddedProcessPort,
    EmbeddedAheadRangePort,
    EmbeddedAncestryPort,
    EmbeddedPendingWorkingSetPort
{
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

  /**
   * Publishes the pinned ancestry proof. It runs one bounded local SQL
   * capture under the ordinary 64 KiB budget and the ordinary local time
   * budget; no remote is contacted, so this probe can never be the thing
   * that stalls a command.
   */
  public async ancestry(
    request: EmbeddedAncestryRequest,
  ): Promise<EmbeddedAncestryResponse> {
    return {
      kind: "ancestry",
      value: await this.ancestryProof(request.ancestor, request.descendant),
    };
  }

  /**
   * Reads, and only reads, what the uncommitted working set holds. The head
   * projection and the working-set projection are each loaded through the
   * same validated reader a normal load uses, and the delta between them is
   * proved complete against `dolt diff --data`, so a pending set that also
   * moved a row outside the projection can never decode as a step.
   */
  public async pendingWorkingSet(): Promise<EmbeddedPendingWorkingSetResponse> {
    return {
      kind: "pending_working_set",
      value: await this.decodePendingWorkingSet(),
    };
  }

  /**
   * Reads, and only reads, what the unpublished commits moved. Only a
   * direct-parent edge is admitted. Its complete `dolt diff --data`
   * must match the projection step; an endpoint diff over multiple commits
   * could hide foreign writes that were later reverted.
   */
  public async aheadRange(
    request: EmbeddedAheadRangeRequest,
  ): Promise<EmbeddedAheadRangeResponse> {
    return {
      kind: "ahead_range",
      value: await this.classifyAheadRange(request.remoteHead, request.head),
    };
  }

  private async classifyAheadRange(
    remoteHead: string,
    head: string,
  ): Promise<EmbeddedAheadRange> {
    const load = this.projections.load;
    const matches = this.projections.matchesProjectionStepDelta;
    if (
      load === undefined ||
      matches === undefined ||
      safeHead(remoteHead) === undefined ||
      safeHead(head) === undefined ||
      remoteHead === head
    )
      return "unavailable";
    const parents = await this.directParents(head);
    if (parents === undefined) return "unavailable";
    if (parents.length !== 1 || parents[0] !== remoteHead) return "foreign";
    const published = await load.call(this.projections, remoteHead);
    const local = await load.call(this.projections, head);
    if (published.status !== "observed" || local.status !== "observed")
      return "unavailable";
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      remoteHead,
      head,
    ]);
    if (diff === undefined || diff.code !== 0 || diff.exceeded)
      return "unavailable";
    return matches.call(
      this.projections,
      published.value,
      local.value,
      diff.stdout,
    )
      ? "engine_delta"
      : "foreign";
  }

  private async decodePendingWorkingSet(): Promise<EmbeddedPendingWorkingSet> {
    const load = this.projections.load;
    const matches = this.projections.matchesProjectionStepDelta;
    if (load === undefined || matches === undefined)
      return { status: "unavailable" };
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    if (workingSet === undefined) return { status: "unavailable" };
    if (workingSet === "clean") return { status: "clean" };
    const head = await this.doltHead(this.databaseDirectory);
    if (head === undefined) return { status: "unavailable" };
    const working = await load.call(this.projections);
    const pending =
      working.status === "observed" ? { pending: working.value } : {};
    const committed = await load.call(this.projections, head);
    if (committed.status !== "observed" || working.status !== "observed")
      return { delta: "unproven", head, ...pending, status: "pending" };
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      head,
    ]);
    return {
      delta:
        diff !== undefined &&
        diff.code === 0 &&
        !diff.exceeded &&
        matches.call(
          this.projections,
          committed.value,
          working.value,
          diff.stdout,
        )
          ? "projection_step"
          : "unproven",
      head,
      ...pending,
      status: "pending",
    };
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
      case "load": {
        if (this.projections.load === undefined)
          return { kind: "load", value: { status: "unavailable" } };
        const workingSet = await this.doltWorkingSet(this.databaseDirectory);
        if (workingSet === undefined)
          return { kind: "load", value: { status: "unavailable" } };
        if (workingSet === "clean")
          return { kind: "load", value: await this.projections.load() };
        // A pending working set is an unproven write: a batch whose process
        // died between mutation and commit, or unrelated work. The durable
        // checkpoint is HEAD. Only the exact batch that wrote the delta can
        // prove and commit it (compareAndSet's pending branch); serving the
        // working set here would let the engine build on state it can never
        // resubmit, and so block forever.
        const head = await this.doltHead(this.databaseDirectory);
        return {
          kind: "load",
          value:
            head === undefined
              ? { status: "ambiguous" }
              : await this.projections.load(head),
        };
      }
      case "carry_read":
        return this.projections.readCarry === undefined
          ? { kind: "carry_read", value: { status: "unavailable" } }
          : await this.projections.readCarry(request.predecessorRootIssueId);
      case "carry_claim":
        return this.projections.claimCarry === undefined
          ? { kind: "carry_claim", value: { status: "unavailable" } }
          : await this.projections.claimCarry(request);
      case "carry_discover": {
        const value = await this.projections.discoverCarry?.(request);
        if (value === undefined)
          throw new Error("carry checkpoint discovery failed");
        return {
          kind: "carry_discover",
          value:
            request.point === "after_push" && this.remote !== undefined
              ? await this.proveRemoteCarryCheckpoint(request, value)
              : await this.proveCarryCheckpoint(request, value),
        };
      }
      case "slot": {
        if (request.source === "remote") {
          if (request.action !== "check" || this.remote === undefined)
            throw new Error("invalid remote slot request");
          const remoteRef = await this.fetchRemoteMain(this.remote);
          const slot =
            remoteRef === undefined
              ? undefined
              : await this.remoteSlotAt(remoteRef, request.actor);
          if (slot === undefined)
            throw new Error("remote slot readback failed");
          return {
            kind: "slot",
            value: this.slotObservation(slot, request.actor),
          };
        }
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
        return {
          kind: "slot",
          value: this.slotObservation(slot, request.actor),
        };
      }
      case "slot_transition":
        return {
          kind: "slot_transition",
          value: await this.proveSlotTransition(request.intent),
        };
      case "slot_lineage":
        return {
          kind: "slot_lineage",
          value: validateSlotTransitionIntent(
            request.intent,
            this.prefix,
            this.scope,
            this.remote === undefined ? "local-only" : "git-sync",
          )
            ? await this.proveSlotLineage(
                request.intent.before.head,
                request.head,
              )
            : "ambiguous",
        };
      case "remote_slot_transition":
        return {
          kind: "remote_slot_transition",
          value: await this.proveRemoteSlotTransition(request.intent),
        };
      case "mutation":
        if (!validateMutationBatch(request.batch).ok)
          return { kind: "mutation", value: "quarantined" };
        return this.projections.mutate(request.batch);
      case "initialize":
        if (
          !validateMergeSlotObservation(request.slot, this.prefix, this.scope)
            .ok ||
          request.slot.status !== "available" ||
          request.slot.holder !== undefined
        )
          return { kind: "mutation", value: "quarantined" };
        return this.projections.initialize === undefined
          ? { kind: "mutation", value: "unavailable" }
          : this.projections.initialize(
              "sce.embedded.projection.initialize.v1",
              request.input,
              request.slot,
            );
      case "preownership_mutation":
        if (!validateMutationBatch(request.batch).ok)
          return { kind: "mutation", value: "quarantined" };
        if (
          !validateMergeSlotObservation(request.slot, this.prefix, this.scope)
            .ok ||
          request.slot.status !== "available" ||
          request.slot.holder !== undefined
        )
          return { kind: "mutation", value: "quarantined" };
        return this.projections.mutatePreOwnership === undefined
          ? { kind: "mutation", value: "unavailable" }
          : this.projections.mutatePreOwnership(request.batch, request.slot);
      case "initial_commit":
        return {
          kind: "commit",
          value: await this.commitInitialProjection(request.input),
        };
      case "initial_push":
        return {
          kind: "push",
          value: await this.pushInitialProjection(request.input),
        };
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
          return {
            kind: "discover",
            value: await this.proveCheckpointDelta(request, value),
          };
        return {
          kind: "discover",
          value: await this.proveRemoteCheckpointDelta(request, value),
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
      case "pull": {
        if (this.remote === undefined)
          return { kind: "pull", value: "ambiguous" };
        const before = await this.doltHead(this.databaseDirectory);
        const workingSet = await this.doltWorkingSet(this.databaseDirectory);
        const remote = await this.remoteHead(
          this.databaseDirectory,
          this.remote,
        );
        if (
          before === undefined ||
          remote === undefined ||
          workingSet === undefined
        )
          return { kind: "pull", value: "unavailable" };
        if (workingSet !== "clean") return { kind: "pull", value: "conflict" };
        if (before === remote) return { kind: "pull", value: "applied" };
        const fastForward = await this.isAncestor(before, remote);
        const cloneLineage = fastForward
          ? false
          : await this.provePinnedCloneLineage(before, remote);
        if (!fastForward && !cloneLineage)
          return { kind: "pull", value: "conflict" };
        const capture = await this.run(["dolt", request.kind, "--json"]);
        if (capture === undefined || capture.exceeded || capture.timedOut)
          return {
            kind: "pull",
            // A child killed at its time or output budget exits with no code,
            // so `failureTail` publishes what it managed to say. Whatever it
            // wrote before the kill is the only account of the stall an
            // operator will ever get; the classification is already decided.
            ...(capture === undefined ? {} : failureTail(capture)),
            value: "unavailable",
          };
        const after = await this.doltHead(this.databaseDirectory);
        const afterRemote = await this.remoteHead(
          this.databaseDirectory,
          this.remote,
        );
        return {
          kind: "pull",
          ...failureTail(capture),
          value:
            capture.code === 0 &&
            afterRemote === remote &&
            (fastForward
              ? after === remote
              : after !== undefined &&
                (await this.provePinnedClonePull(
                  before,
                  remote,
                  after,
                  cloneLineage,
                )))
              ? "applied"
              : "conflict",
        };
      }
      case "push": {
        const capture = await this.run(["dolt", request.kind, "--json"]);
        if (capture === undefined || capture.exceeded || capture.timedOut)
          return {
            kind: "push",
            ...(capture === undefined ? {} : failureTail(capture)),
            value: "unavailable",
          };
        return {
          kind: "push",
          ...failureTail(capture),
          value: capture.code === 0 ? "applied" : "conflict",
        };
      }
    }
  }

  private slotObservation(slot: SlotDocument, actor: string) {
    const withoutHash = {
      // The observation actor is the durable slot holder when held; the
      // command caller is only a request identity and must not fabricate a
      // holder/actor agreement for a competing controller.
      actor: slot.holder ?? actor,
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
      ...withoutHash,
      readbackHash: deriveSlotReadbackHash(withoutHash),
    };
  }

  /** Commit only an exact all-row initial projection delta. */
  private async commitInitialProjection(
    input: EmbeddedInitialProjection,
  ): Promise<"applied" | "ambiguous" | "unavailable"> {
    const head = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    if (head === undefined || workingSet === undefined) return "unavailable";
    if (this.projections.matchesInitialDelta === undefined)
      return "unavailable";
    if (workingSet === "pending") {
      const diff = await this.runDolt(this.databaseDirectory, [
        "diff",
        "--data",
        "-r",
        "json",
        head,
      ]);
      if (
        diff === undefined ||
        diff.code !== 0 ||
        diff.exceeded ||
        !this.projections.matchesInitialDelta(input, diff.stdout)
      )
        return "ambiguous";
      const committed = await this.run(["dolt", "commit", "--json"]);
      return committed === undefined || committed.exceeded
        ? "unavailable"
        : committed.code === 0
          ? "applied"
          : "ambiguous";
    }
    if (workingSet !== "clean") return "ambiguous";
    const parents = await this.directParents(head);
    if (
      parents === undefined ||
      parents.length !== 1 ||
      parents[0] === undefined
    )
      return "ambiguous";
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      parents[0],
      head,
    ]);
    return diff !== undefined &&
      diff.code === 0 &&
      !diff.exceeded &&
      this.projections.matchesInitialDelta(input, diff.stdout)
      ? "applied"
      : "ambiguous";
  }

  /** Push only the exact direct checkpoint whose parent is the remote head. */
  private async pushInitialProjection(
    input: EmbeddedInitialProjection,
  ): Promise<"applied" | "conflict" | "ambiguous" | "unavailable"> {
    if (
      this.remote === undefined ||
      this.projections.matchesInitialDelta === undefined
    )
      return "unavailable";
    const head = await this.doltHead(this.databaseDirectory);
    const remote = await this.remoteHead(this.databaseDirectory, this.remote);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    if (head === undefined || remote === undefined || workingSet === undefined)
      return "unavailable";
    if (workingSet !== "clean") return "ambiguous";
    if (head === remote) return "applied";
    const parents = await this.directParents(head);
    if (parents === undefined || parents.length !== 1 || parents[0] !== remote)
      return "ambiguous";
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      remote,
      head,
    ]);
    if (
      diff === undefined ||
      diff.code !== 0 ||
      diff.exceeded ||
      !this.projections.matchesInitialDelta(input, diff.stdout)
    )
      return "ambiguous";
    const pushed = await this.run(["dolt", "push", "--json"]);
    if (pushed === undefined || pushed.exceeded) return "unavailable";
    if (pushed.code !== 0) return "conflict";
    const after = await this.remoteHead(this.databaseDirectory, this.remote);
    return after === head ? "applied" : "ambiguous";
  }

  /**
   * Validates exactly the two rows a bd 1.1.0 merge-slot action is allowed to
   * create: its `issues` row and Beads' corresponding immutable `events`
   * audit record. Any other table, issue, label, or field movement is refused.
   */
  private exactSlotDelta(
    source: string,
    intent: SlotTransitionIntent,
  ): boolean {
    return isPinnedSlotTransitionDelta(source, this.prefix, intent);
  }

  private async proveCarryCheckpoint(
    request: Extract<EmbeddedRequest, { readonly kind: "carry_discover" }>,
    discovery: CrashDiscovery,
  ): Promise<CrashDiscovery> {
    if (
      discovery.status !== "observed" ||
      this.projections.discoverCarry === undefined ||
      this.projections.matchesCarryDelta === undefined
    )
      return discovery.status === "observed"
        ? { status: "ambiguous" }
        : discovery;
    const currentHead = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    if (currentHead === undefined || workingSet === undefined)
      return { status: "ambiguous" };
    if (workingSet === "pending") {
      const before = await this.projections.discoverCarry(request, currentHead);
      const diff = await this.runDolt(this.databaseDirectory, [
        "diff",
        "--data",
        "-r",
        "json",
        currentHead,
      ]);
      const proven =
        before?.status === "absent" &&
        diff !== undefined &&
        diff.code === 0 &&
        !diff.exceeded &&
        this.projections.matchesCarryDelta(request.intent, diff.stdout)
          ? { ...discovery, baseHead: currentHead, head: currentHead }
          : { status: "ambiguous" as const };
      return this.bindRemoteCheckpointBaseline(proven);
    }
    if (workingSet !== "clean") return { status: "ambiguous" };
    const committed = await this.proveCommittedCarryCheckpoint(
      request,
      discovery,
      currentHead,
    );
    return this.bindRemoteCheckpointBaseline(committed);
  }

  private async proveCommittedCarryCheckpoint(
    request: Extract<EmbeddedRequest, { readonly kind: "carry_discover" }>,
    discovery: CrashDiscovery,
    currentHead: string,
  ): Promise<CrashDiscovery> {
    if (
      discovery.status !== "observed" ||
      discovery.head !== currentHead ||
      this.projections.discoverCarry === undefined ||
      this.projections.matchesCarryDelta === undefined
    )
      return { status: "ambiguous" };
    const parents = await this.directParents(currentHead);
    const parent = parents?.length === 1 ? parents[0] : undefined;
    if (parent === undefined) return { status: "ambiguous" };
    const before = await this.projections.discoverCarry(request, parent);
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      parent,
      currentHead,
    ]);
    return before?.status === "absent" &&
      diff !== undefined &&
      diff.code === 0 &&
      !diff.exceeded &&
      this.projections.matchesCarryDelta(request.intent, diff.stdout)
      ? { ...discovery, baseHead: parent, head: currentHead }
      : { status: "ambiguous" };
  }

  private async proveRemoteCarryCheckpoint(
    request: Extract<EmbeddedRequest, { readonly kind: "carry_discover" }>,
    local: CrashDiscovery,
  ): Promise<CrashDiscovery> {
    if (
      local.status !== "observed" ||
      this.remote === undefined ||
      this.projections.discoverCarry === undefined
    )
      return { status: "ambiguous" };
    const localHead = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    const remoteRef = await this.fetchRemoteMain(this.remote);
    const remoteHead =
      remoteRef === undefined ? undefined : await this.doltRefHead(remoteRef);
    const remote =
      remoteRef === undefined
        ? undefined
        : await this.projections.discoverCarry(request, remoteRef);
    if (
      localHead === undefined ||
      workingSet !== "clean" ||
      remoteHead === undefined ||
      remote === undefined ||
      localHead !== remoteHead
    )
      return { status: "ambiguous" };
    const proven = await this.proveCommittedCarryCheckpoint(
      request,
      remote,
      remoteHead,
    );
    return proven.status === "observed" &&
      proven.baseHead !== undefined &&
      local.rootCommitment === proven.rootCommitment
      ? { ...local, baseHead: proven.baseHead, head: localHead, remoteHead }
      : { status: "ambiguous" };
  }

  /**
   * Selected projection readback alone cannot authorize a commit: another
   * pending or committed row could be carried with it. Bind recovery to the
   * complete current working-set or one-parent commit delta.
   */
  private async proveCheckpointDelta(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
    discovery: CrashDiscovery,
  ): Promise<CrashDiscovery> {
    if (discovery.status !== "observed") return discovery;
    const head = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    if (head === undefined || workingSet === undefined)
      return { status: "ambiguous" };
    if (workingSet === "pending") {
      const before = await this.projections.discoverAt(request, head);
      const diff = await this.runDolt(this.databaseDirectory, [
        "diff",
        "--data",
        "-r",
        "json",
        head,
      ]);
      const proven =
        before?.status === "absent" &&
        diff !== undefined &&
        diff.code === 0 &&
        !diff.exceeded &&
        this.projections.matchesBatchDelta(request.batch, diff.stdout)
          ? { ...discovery, baseHead: head, head }
          : { status: "ambiguous" as const };
      return this.bindRemoteCheckpointBaseline(proven);
    }
    if (workingSet !== "clean") return { status: "ambiguous" };
    return this.bindRemoteCheckpointBaseline(
      await this.proveCommittedCheckpoint(request, discovery, head),
    );
  }

  /** Exact one-parent checkpoint proof at a stable local or fetched ref. */
  private async proveCommittedCheckpoint(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
    discovery: CrashDiscovery,
    head: string,
  ): Promise<CrashDiscovery> {
    if (discovery.status !== "observed" || discovery.head !== head)
      return { status: "ambiguous" };
    const parents = await this.directParents(head);
    if (parents === undefined || parents.length !== 1)
      return { status: "ambiguous" };
    const parent = parents[0];
    if (parent === undefined) return { status: "ambiguous" };
    const before = await this.projections.discoverAt(request, parent);
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      parent,
      head,
    ]);
    return before?.status === "absent" &&
      diff !== undefined &&
      diff.code === 0 &&
      !diff.exceeded &&
      this.projections.matchesBatchDelta(request.batch, diff.stdout)
      ? { ...discovery, baseHead: parent, head }
      : { status: "ambiguous" };
  }

  /**
   * Remote durable authority is an exact effect commit, not merely a selected
   * projection. A clone may wrap it once in bd's pinned metadata merge; that
   * preserves the clone-local head while proving the remote effect and its
   * expected parent without accepting arbitrary later ancestry.
   */
  private async proveRemoteCheckpointDelta(
    request: Extract<EmbeddedRequest, { readonly kind: "discover" }>,
    local: CrashDiscovery,
  ): Promise<CrashDiscovery> {
    if (this.remote === undefined || local.status !== "observed")
      return { status: "ambiguous" };
    const localHead = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    const remoteRef = await this.fetchRemoteMain(this.remote);
    const remoteHead =
      remoteRef === undefined ? undefined : await this.doltRefHead(remoteRef);
    const remote =
      remoteRef === undefined
        ? undefined
        : await this.projections.discoverAt(request, remoteRef);
    if (
      localHead === undefined ||
      workingSet !== "clean" ||
      remoteHead === undefined ||
      remote === undefined
    )
      return { status: "ambiguous" };
    const effect = await this.proveCommittedCheckpoint(
      request,
      remote,
      remoteHead,
    );
    if (
      effect.status !== "observed" ||
      local.rootCommitment !== effect.rootCommitment ||
      canonicalJson(local.childCommitments as JsonValue) !==
        canonicalJson(effect.childCommitments as JsonValue)
    )
      return { status: "ambiguous" };
    if (localHead === remoteHead && effect.baseHead !== undefined)
      return {
        ...local,
        baseHead: effect.baseHead,
        head: localHead,
        remoteHead,
      };
    const parents = await this.directParents(localHead);
    if (
      parents === undefined ||
      parents.length !== 2 ||
      parents.filter((parent) => parent === remoteHead).length !== 1
    )
      return { status: "ambiguous" };
    const otherParent = parents.find((parent) => parent !== remoteHead);
    const baseHead = effect.baseHead;
    if (
      otherParent === undefined ||
      baseHead === undefined ||
      !(await this.exactPinnedCloneDelta(remoteHead, localHead)) ||
      !(await this.provePinnedCloneLineage(otherParent, baseHead))
    )
      return { status: "ambiguous" };
    return { ...local, baseHead, head: localHead, remoteHead };
  }

  /** Verifies the exact post-pull clone merge from the pre-pull local head. */
  private async provePinnedClonePull(
    before: string,
    remote: string,
    after: string,
    prePullLineage: boolean,
  ): Promise<boolean> {
    const parents = await this.directParents(after);
    if (
      parents === undefined ||
      parents.length !== 2 ||
      parents.filter((parent) => parent === remote).length !== 1 ||
      !parents.includes(before)
    )
      return false;
    return prePullLineage && (await this.exactPinnedCloneDelta(remote, after));
  }

  /**
   * A checkpoint may be pushed only from the fetched remote baseline itself,
   * or from bd's exact clone-local metadata-only representation of it.
   */
  private async bindRemoteCheckpointBaseline(
    discovery: CrashDiscovery,
  ): Promise<CrashDiscovery> {
    if (discovery.status !== "observed" || this.remote === undefined)
      return discovery;
    const baseHead = discovery.baseHead;
    const remoteHead = await this.remoteHead(
      this.databaseDirectory,
      this.remote,
    );
    if (
      baseHead === undefined ||
      remoteHead === undefined ||
      !(
        baseHead === remoteHead ||
        (await this.isPinnedCloneBaseline(remoteHead, baseHead))
      )
    )
      return { status: "ambiguous" };
    return { ...discovery, remoteHead };
  }

  /** Exact pinned clone metadata delta from a fetched remote baseline. */
  private async isPinnedCloneBaseline(
    remoteHead: string,
    localHead: string,
  ): Promise<boolean> {
    if (remoteHead === localHead) return true;
    const parents = await this.directParents(localHead);
    if (parents === undefined || (parents.length !== 1 && parents.length !== 2))
      return false;
    if (parents.length === 1)
      return (
        parents[0] === remoteHead &&
        (await this.exactPinnedCloneDelta(remoteHead, localHead))
      );
    if (parents.filter((parent) => parent === remoteHead).length !== 1)
      return false;
    const otherParent = parents.find((parent) => parent !== remoteHead);
    return (
      otherParent !== undefined &&
      (await this.exactPinnedCloneDelta(remoteHead, localHead)) &&
      (await this.provePinnedCloneLineage(otherParent, remoteHead))
    );
  }

  /** The only tolerated clone-local history edge is the pinned metadata pair. */
  private async exactPinnedCloneDelta(
    from: string,
    to: string,
  ): Promise<boolean> {
    const diff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      from,
      to,
    ]);
    return (
      diff !== undefined &&
      diff.code === 0 &&
      !diff.exceeded &&
      isPinnedCloneMergeDelta(diff.stdout)
    );
  }

  /**
   * Bounded, direct-parent proof of clone-only history. Every traversed edge
   * is independently the pinned metadata pair; endpoint net diffs never
   * authorize hidden add/revert history.
   */
  private async provePinnedCloneLineage(
    localHead: string,
    authoritativeHead: string,
    depth = 0,
    visited = new Set<string>(),
  ): Promise<boolean> {
    if (
      depth >= MAX_CLONE_LINEAGE_EDGES ||
      visited.has(localHead) ||
      localHead === authoritativeHead
    )
      return false;
    visited.add(localHead);
    const parents = await this.directParents(localHead);
    if (parents === undefined || (parents.length !== 1 && parents.length !== 2))
      return false;
    const authorityParents: string[] = [];
    for (const parent of parents) {
      if (
        parent === authoritativeHead ||
        (await this.isAncestor(parent, authoritativeHead))
      )
        authorityParents.push(parent);
    }
    if (authorityParents.length !== 1) return false;
    const authorityParent = authorityParents[0];
    if (
      authorityParent === undefined ||
      !(await this.exactPinnedCloneDelta(authorityParent, localHead))
    )
      return false;
    if (parents.length === 1) return true;
    const otherParent = parents.find((parent) => parent !== authorityParent);
    return (
      otherParent !== undefined &&
      (await this.provePinnedCloneLineage(
        otherParent,
        authorityParent,
        depth + 1,
        visited,
      ))
    );
  }

  private async proveSlotTransition(
    intent: SlotTransitionIntent,
  ): Promise<"observed" | "absent" | "ambiguous"> {
    if (
      !validateSlotTransitionIntent(
        intent,
        this.prefix,
        this.scope,
        this.remote === undefined ? "local-only" : "git-sync",
      )
    )
      return "ambiguous";
    const head = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
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
    if (
      head === undefined ||
      workingSet === undefined ||
      slot === undefined ||
      canonicalJson(this.slotObservation(slot, intent.holder) as JsonValue) !==
        canonicalJson(intent.after as JsonValue) ||
      (workingSet === "clean" && head === intent.before.head)
    )
      return "absent";
    // A pending slot change sits on the current head. A committed one is the
    // newest slot-touching commit beneath the head: under auto-commit the
    // controller's journal commits sit both before it (the intent) and after
    // it (an ambiguity record, a checkpoint). Its parent must descend from the
    // planned head with the slot untouched, and nothing else may.
    const located =
      workingSet === "pending"
        ? { base: head, commit: head }
        : await this.latestSlotCommit(head);
    if (located === undefined) return "ambiguous";
    const lineage = await this.proveSlotLineage(
      intent.before.head,
      located.base,
    );
    if (lineage !== "observed") return lineage;
    const args =
      workingSet === "pending"
        ? ["diff", "--data", "-r", "json", located.base]
        : ["diff", "--data", "-r", "json", located.base, located.commit];
    const diff = await this.runDolt(this.databaseDirectory, args);
    return diff !== undefined &&
      diff.code === 0 &&
      !diff.exceeded &&
      this.exactSlotDelta(diff.stdout, intent)
      ? "observed"
      : "ambiguous";
  }

  /** Exact remote-AS-OF readback bound to one bounded fetch reference. */
  private async remoteSlotAt(
    remoteRef: string,
    actor: string,
  ): Promise<MergeSlotObservation | undefined> {
    const show = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT id, title, status, metadata, external_ref, design FROM issues AS OF '${remoteRef}' WHERE id = '${this.prefix}-merge-slot'`,
    ]);
    const labels = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT label FROM labels AS OF '${remoteRef}' WHERE issue_id = '${this.prefix}-merge-slot'`,
    ]);
    const slot =
      show === undefined ||
      show.code !== 0 ||
      show.exceeded ||
      labels === undefined ||
      labels.code !== 0 ||
      labels.exceeded
        ? undefined
        : parseRemoteSlotDocument(
            show.stdout,
            labels.stdout,
            `${this.prefix}-merge-slot`,
            this.scope,
          );
    return slot === undefined ? undefined : this.slotObservation(slot, actor);
  }

  private async doltRefHead(ref: string): Promise<string | undefined> {
    const capture = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT DOLT_HASHOF('${ref}') AS head`,
    ]);
    return capture === undefined || capture.code !== 0 || capture.exceeded
      ? undefined
      : sqlHead(capture.stdout);
  }

  /** Strict immediate-parent list from the pinned Dolt system table. */
  private async directParents(
    commit: string,
  ): Promise<readonly string[] | undefined> {
    if (safeHead(commit) === undefined) return undefined;
    const capture = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT parent_hash, parent_index FROM dolt_commit_ancestors WHERE commit_hash = '${commit}' ORDER BY parent_index`,
    ]);
    const rows =
      capture === undefined || capture.code !== 0 || capture.exceeded
        ? undefined
        : sqlRows(capture.stdout);
    if (rows === undefined || rows.length === 0 || rows.length > 2)
      return undefined;
    const values = rows.map((row, index) =>
      Object.keys(row).length === 2 &&
      Object.keys(row).every(
        (key) => key === "parent_hash" || key === "parent_index",
      ) &&
      row.parent_index === index
        ? safeHead(row.parent_hash)
        : undefined,
    );
    return values.some((value) => value === undefined) ||
      new Set(values).size !== values.length
      ? undefined
      : (values as readonly string[]);
  }

  /**
   * Pinned, bounded ancestry predicate: reachable, or not proved reachable.
   */
  private async isAncestor(
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return (await this.ancestryProof(ancestor, descendant)) === "observed";
  }

  /**
   * The pinned ancestry proof. The CTE returns one exact count row, so no
   * caller can infer reachability from a partial ancestor listing, and the
   * three values keep "provably not an ancestor" apart from "could not
   * tell" -- a distinction only the locally-ahead reconciliation needs, and
   * one the boolean predicate above deliberately collapses.
   */
  private async ancestryProof(
    ancestor: string,
    descendant: string,
  ): Promise<EmbeddedAncestryProof> {
    if (safeHead(ancestor) === undefined || safeHead(descendant) === undefined)
      return "ambiguous";
    const capture = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `WITH RECURSIVE ancestry(parent_hash) AS (SELECT parent_hash FROM dolt_commit_ancestors WHERE commit_hash = '${descendant}' UNION SELECT edge.parent_hash FROM dolt_commit_ancestors AS edge JOIN ancestry ON edge.commit_hash = ancestry.parent_hash) SELECT COUNT(*) AS matches FROM ancestry WHERE parent_hash = '${ancestor}'`,
    ]);
    if (capture === undefined || capture.code !== 0 || capture.exceeded)
      return "ambiguous";
    const raw = json(capture.stdout);
    const rows = raw?.rows;
    const row =
      Array.isArray(rows) && rows.length === 1 ? object(rows[0]) : undefined;
    if (
      raw === undefined ||
      !hasExactKeys(raw, ["rows"]) ||
      row === undefined ||
      !hasExactKeys(row, ["matches"])
    )
      return "ambiguous";
    // The recursive CTE unions its rows, so the count of one parent hash is
    // 0 or 1. Any other number is a shape this engine was not pinned to.
    if (row.matches === 1) return "observed";
    return row.matches === 0 ? "absent" : "ambiguous";
  }

  private async soleParent(commit: string): Promise<string | undefined> {
    const parents = await this.directParents(commit);
    return parents !== undefined && parents.length === 1
      ? parents[0]
      : undefined;
  }

  /**
   * Slot-untouched lineage: `head` is `from` itself, or a descendant whose
   * intervening commits never wrote the built-in slot's issue, label, or
   * event rows. One exact count row decides; any other shape is ambiguous.
   */
  private async proveSlotLineage(
    from: string,
    head: string,
  ): Promise<"observed" | "absent" | "ambiguous"> {
    if (safeHead(from) === undefined || safeHead(head) === undefined)
      return "ambiguous";
    if (from === head) return "observed";
    if (!(await this.isAncestor(from, head))) return "absent";
    const touched = await this.slotTouched(from, head);
    if (touched === undefined) return "ambiguous";
    return touched ? "absent" : "observed";
  }

  /**
   * Whether any commit in `from..to` wrote the built-in slot's issue, label,
   * or event rows. One exact count row decides; any other shape is unknown.
   */
  private async slotTouched(
    from: string,
    to: string,
  ): Promise<boolean | undefined> {
    if (safeHead(from) === undefined || safeHead(to) === undefined)
      return undefined;
    const slot = `${this.prefix}-merge-slot`;
    const rowsTouching = (table: string, column: string) =>
      `(SELECT COUNT(*) FROM dolt_diff('${from}', '${to}', '${table}') WHERE from_${column} = '${slot}' OR to_${column} = '${slot}')`;
    const capture = await this.runDolt(this.databaseDirectory, [
      "sql",
      "-r",
      "json",
      "-q",
      `SELECT ${rowsTouching("issues", "id")} + ${rowsTouching("labels", "issue_id")} + ${rowsTouching("events", "issue_id")} AS touched`,
    ]);
    if (capture === undefined || capture.code !== 0 || capture.exceeded)
      return undefined;
    const raw = json(capture.stdout);
    const rows = raw?.rows;
    const row =
      Array.isArray(rows) && rows.length === 1 ? object(rows[0]) : undefined;
    if (
      raw === undefined ||
      !hasExactKeys(raw, ["rows"]) ||
      row === undefined ||
      !hasExactKeys(row, ["touched"]) ||
      typeof row.touched !== "number" ||
      !Number.isInteger(row.touched)
    )
      return undefined;
    return row.touched !== 0;
  }

  /**
   * Walks back from `head` through single-parent commits that never touched
   * the built-in slot to the newest commit that did. Bounded like clone
   * lineage; a merge, a root, or an unproved edge is undefined, never guessed.
   */
  private async latestSlotCommit(
    head: string,
  ): Promise<Readonly<{ base: string; commit: string }> | undefined> {
    let commit = head;
    for (let depth = 0; depth < MAX_CLONE_LINEAGE_EDGES; depth += 1) {
      const base = await this.soleParent(commit);
      if (base === undefined) return undefined;
      const touched = await this.slotTouched(base, commit);
      if (touched === undefined) return undefined;
      if (touched) return { base, commit };
      commit = base;
    }
    return undefined;
  }

  private remoteProof(
    status: "absent" | "ambiguous",
  ): RemoteSlotTransitionProof {
    return {
      schema: "sce.beads-embedded.remote-slot-transition-proof",
      status,
      version: 1,
    };
  }

  /**
   * A clean different clone cannot prove the whole range from the origin
   * controller's before-head to its merge head: bd adds clone-local metadata
   * during pull. First prove the remote one-parent slot effect exactly, then
   * admit only that pinned pull metadata in the local merge relation.
   */
  private async proveRemoteSlotTransition(
    intent: SlotTransitionIntent,
  ): Promise<RemoteSlotTransitionProof> {
    if (
      this.remote === undefined ||
      !validateSlotTransitionIntent(
        intent,
        this.prefix,
        this.scope,
        "git-sync",
      ) ||
      intent.before.remoteHead === undefined
    )
      return this.remoteProof("ambiguous");
    const localHead = await this.doltHead(this.databaseDirectory);
    const workingSet = await this.doltWorkingSet(this.databaseDirectory);
    const remoteRef = await this.fetchRemoteMain(this.remote);
    const remoteHead =
      remoteRef === undefined ? undefined : await this.doltRefHead(remoteRef);
    if (
      localHead === undefined ||
      workingSet !== "clean" ||
      remoteRef === undefined ||
      remoteHead === undefined ||
      remoteHead === intent.before.remoteHead
    )
      return this.remoteProof("absent");
    // The other clone's journal commits may sit above its slot effect on the
    // remote exactly as they do locally; locate the effect beneath the head.
    const located = await this.latestSlotCommit(remoteHead);
    if (
      located === undefined ||
      (await this.proveSlotLineage(intent.before.remoteHead, located.base)) !==
        "observed"
    )
      return this.remoteProof("ambiguous");
    const effectDiff = await this.runDolt(this.databaseDirectory, [
      "diff",
      "--data",
      "-r",
      "json",
      located.base,
      located.commit,
    ]);
    const remoteSlot = await this.remoteSlotAt(remoteRef, intent.holder);
    if (
      effectDiff === undefined ||
      effectDiff.code !== 0 ||
      effectDiff.exceeded ||
      !this.exactSlotDelta(effectDiff.stdout, intent) ||
      remoteSlot === undefined ||
      canonicalJson(remoteSlot as JsonValue) !==
        canonicalJson(intent.after as JsonValue)
    )
      return this.remoteProof("ambiguous");
    if (localHead !== remoteHead) {
      const localParents = await this.directParents(localHead);
      if (
        localParents === undefined ||
        localParents.length !== 2 ||
        localParents.filter((parent) => parent === remoteHead).length !== 1 ||
        !(await this.exactPinnedCloneDelta(remoteHead, localHead))
      )
        return this.remoteProof("ambiguous");
      const otherParent = localParents.find((parent) => parent !== remoteHead);
      if (
        otherParent === undefined ||
        !(await this.provePinnedCloneLineage(
          otherParent,
          intent.before.remoteHead,
        ))
      )
        return this.remoteProof("ambiguous");
    }
    return {
      effectHead: located.commit,
      localHead,
      remoteHead,
      schema: "sce.beads-embedded.remote-slot-transition-proof",
      status: "observed",
      version: 1,
    };
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
      let timedOut = false;
      let settled = false;
      const child = spawn(executable, argv, {
        cwd: this.cwd,
        env: {
          // bd and ssh resolve `~`; without HOME bd writes its config into a
          // literal `~/` under the working directory and dirties the tree.
          HOME: homedir(),
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname(this.bdExecutable)}:${dirname(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          DARWIN_USER_TEMP_DIR:
            process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          TZ: "UTC",
          // A git+ssh Dolt remote needs the agent socket, and every prompt
          // must fail rather than wait on a terminal nobody is watching.
          ...sshEnvironment(),
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, processTimeoutMs(argv));
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) {
          exceeded = true;
          child.kill("SIGKILL");
        } else stdout += chunk.toString("utf8");
      });
      const stderr = stderrWindow();
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
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
          resolve({ code, exceeded, stdout, timedOut, ...stderr.captured() });
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
          parts[1] !== undefined &&
          sameRemoteIdentity(parts[1], remote.url)
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
      let timedOut = false;
      let settled = false;
      const child = spawn(executable, argv, {
        cwd,
        env: {
          // bd and ssh resolve `~`; without HOME bd writes its config into a
          // literal `~/` under the working directory and dirties the tree.
          HOME: homedir(),
          LANG: "C",
          LC_ALL: "C",
          PATH: `${dirname(this.bdExecutable)}:${dirname(this.doltExecutable)}:/usr/bin:/bin`,
          TMPDIR: process.env.TMPDIR ?? "/private/tmp",
          DARWIN_USER_TEMP_DIR:
            process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
          TZ: "UTC",
          // A git+ssh Dolt remote needs the agent socket, and every prompt
          // must fail rather than wait on a terminal nobody is watching.
          ...sshEnvironment(),
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, processTimeoutMs(argv));
      const budget = outputBytesFor(argv);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > budget) {
          exceeded = true;
          child.kill("SIGKILL");
        } else stdout += chunk.toString("utf8");
      });
      const stderr = stderrWindow();
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
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
          resolve({ code, exceeded, stdout, timedOut, ...stderr.captured() });
        }
      });
    });
  }
}
