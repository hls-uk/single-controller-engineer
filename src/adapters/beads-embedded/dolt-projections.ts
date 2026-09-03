import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import {
  type ChildProjection,
  type MergeSlotObservation,
  type MutationBatch,
  type RootProjection,
  validateMergeSlotObservation,
  validateChildProjection,
  validateMutationBatch,
  validateRootProjection,
} from "../../fencing/index.js";
import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import {
  ProvenanceCarryClaimRecordSchema,
  validate,
  type ProvenanceCarryClaimRecord,
} from "../../protocol/schemas.js";

import type {
  CarryCheckpointIntent,
  CrashDiscovery,
  EmbeddedInitialProjection,
  EmbeddedLoad,
  EmbeddedReadback,
  EmbeddedRequest,
  EmbeddedResponse,
} from "./schemas.js";
import { isPinnedBdIssueRow } from "./schemas.js";
import type { ProjectionPersistencePort } from "./pinned-bd-process.js";

const MAX_OUTPUT_BYTES = 262_144;
const TIMEOUT_MS = 15_000;
const PINNED_DOLT_VERSION = "2.2.1";
const EXECUTABLE_SAMPLE_BYTES = 65_536;
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
  try {
    return (
      canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue)
    );
  } catch {
    return false;
  }
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

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export class DoltProjectionPersistence implements ProjectionPersistencePort {
  private readonly directory: string;
  private readonly rootIssueId: string;
  private readonly childIssueId: (unitId: string) => string | undefined;
  private readonly doltExecutable: string;
  private versionCheck: Promise<boolean> | undefined;
  private versionExecutable: Executable | undefined;
  private rejectedExecutable: Executable | undefined;

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

  /** Existing-root acquire intent CAS with the available slot in its SQL CAS. */
  public async mutatePreOwnership(
    batch: MutationBatch,
    slot: MergeSlotObservation,
  ): Promise<EmbeddedResponse> {
    if (!validateMutationBatch(batch).ok)
      return { kind: "mutation", value: "quarantined" };
    const statement = this.writeStatement(batch, slot);
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
    return readback === undefined
      ? { kind: "mutation", value: "stale" }
      : { kind: "mutation", value: "applied" };
  }

  /**
   * Authorized bootstrap only. Normal CAS never calls this and therefore
   * refuses an absent `$.sce` envelope rather than creating it lazily.
   */
  public async initialize(
    authority: ProjectionInitializationAuthority,
    input: EmbeddedInitialProjection | MutationBatch,
    slot?: MergeSlotObservation,
  ): Promise<EmbeddedResponse> {
    if (authority !== PROJECTION_INITIALIZATION_AUTHORITY)
      return { kind: "mutation", value: "quarantined" };
    const legacy = validateMutationBatch(input);
    if (legacy.ok) return this.initializeLegacy(legacy.value, slot);
    if (slot === undefined) return { kind: "mutation", value: "quarantined" };
    const initial = input as EmbeddedInitialProjection;
    const rows = this.initialRows(initial);
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
    const slotPredicate = this.availableSlotPredicate(slot);
    const source = await this.sql(
      `UPDATE issues SET metadata=CASE id ${cases} ELSE metadata END WHERE id IN (${ids}) AND (SELECT COUNT(*) FROM issues WHERE ${absent})=${rows.length}${slotPredicate}; SELECT ROW_COUNT() AS affected`,
    );
    const readback =
      source === undefined || this.affected(source) !== rows.length
        ? undefined
        : await this.load();
    return readback?.status === "observed" &&
      same(readback.value.root, initial.root) &&
      same(readback.value.children, initial.children)
      ? { kind: "mutation", value: "applied" }
      : { kind: "mutation", value: "stale" };
  }

  private async initializeLegacy(
    batch: MutationBatch,
    slot: MergeSlotObservation | undefined,
  ): Promise<EmbeddedResponse> {
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
      `UPDATE issues SET metadata=CASE id ${cases} ELSE metadata END WHERE id IN (${ids}) AND (SELECT COUNT(*) FROM issues WHERE ${absent})=${rows.length}${slot === undefined ? "" : this.availableSlotPredicate(slot)}; SELECT ROW_COUNT() AS affected`,
    );
    const readback =
      source === undefined || this.affected(source) !== rows.length
        ? undefined
        : await this.readback(batch);
    return readback === undefined
      ? { kind: "mutation", value: "stale" }
      : { kind: "mutation", value: "applied" };
  }

  /**
   * Load exactly the root and every child that root references. A malformed
   * root/child, missing child, or duplicate mapping is never absence.
   */
  public async load(): Promise<EmbeddedLoad> {
    const source = await this.sql(this.selectStatement([this.rootIssueId]));
    const records = source === undefined ? undefined : parseRows(source);
    if (records === undefined) return { status: "unavailable" };
    if (records.length !== 1 || records[0]?.id !== this.rootIssueId)
      return { status: "ambiguous" };
    const rootValue = records[0]?.sce;
    if (rootValue === null) return { status: "absent" };
    const rootEnvelope = object(rootValue);
    if (
      rootEnvelope === undefined ||
      Object.keys(rootEnvelope).length !== 2 ||
      typeof rootEnvelope.commitment !== "string" ||
      !Object.prototype.hasOwnProperty.call(rootEnvelope, "projection")
    )
      return { status: "ambiguous" };
    const parsedRoot = validateRootProjection(rootEnvelope.projection);
    if (
      !parsedRoot.ok ||
      parsedRoot.value.aggregateCommitment !== rootEnvelope.commitment
    )
      return { status: "ambiguous" };
    const childIds = parsedRoot.value.childRows.map((child) =>
      this.childIssueId(child.unitId),
    );
    if (
      childIds.some((id) => id === undefined) ||
      new Set(childIds).size !== childIds.length
    )
      return { status: "ambiguous" };
    if (childIds.length === 0)
      return {
        status: "observed",
        value: { children: [], root: parsedRoot.value },
      };
    const childSource = await this.sql(
      this.selectStatement(childIds as string[]),
    );
    const childrenRows =
      childSource === undefined ? undefined : parseRows(childSource);
    if (childrenRows === undefined) return { status: "unavailable" };
    if (childrenRows.length !== childIds.length) return { status: "ambiguous" };
    const expected = new Map(
      parsedRoot.value.childRows.map((child) => [child.unitId, child]),
    );
    const seen = new Set<string>();
    const children: ChildProjection[] = [];
    for (const record of childrenRows) {
      if (
        Object.keys(record).length !== 2 ||
        typeof record.id !== "string" ||
        seen.has(record.id) ||
        !Object.prototype.hasOwnProperty.call(record, "sce")
      )
        return { status: "ambiguous" };
      seen.add(record.id);
      const envelope = object(record.sce);
      if (
        envelope === undefined ||
        Object.keys(envelope).length !== 2 ||
        typeof envelope.commitment !== "string" ||
        !Object.prototype.hasOwnProperty.call(envelope, "projection")
      )
        return { status: "ambiguous" };
      const child = validateChildProjection(envelope.projection);
      const reference = child.ok ? expected.get(child.value.unitId) : undefined;
      if (
        !child.ok ||
        reference === undefined ||
        child.value.commitment !== envelope.commitment ||
        this.childIssueId(child.value.unitId) !== record.id ||
        child.value.revision !== reference.revision ||
        child.value.commitment !== reference.commitment ||
        !same(child.value.scope, parsedRoot.value.scope) ||
        child.value.holder !== parsedRoot.value.holder ||
        !same(child.value.unit, parsedRoot.value.run.units[child.value.unitId])
      )
        return { status: "ambiguous" };
      children.push(child.value);
    }
    return children.length !== expected.size || seen.size !== childIds.length
      ? { status: "ambiguous" }
      : {
          status: "observed",
          value: {
            children: children.sort((a, b) =>
              compareCodeUnits(a.unitId, b.unitId),
            ),
            root: parsedRoot.value,
          },
        };
  }

  public async readCarry(
    predecessorRootIssueId: string,
  ): Promise<EmbeddedResponse> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(predecessorRootIssueId))
      return { kind: "carry_read", value: { status: "unavailable" } };
    const source = await this.sql(
      this.carrySelectStatement(predecessorRootIssueId),
    );
    const rows = source === undefined ? undefined : parseRows(source);
    if (rows === undefined)
      return { kind: "carry_read", value: { status: "unavailable" } };
    if (rows.length === 0)
      return { kind: "carry_read", value: { status: "not_found" } };
    if (
      rows.length !== 1 ||
      rows[0]?.id !== predecessorRootIssueId ||
      Object.keys(rows[0]).length !== 5
    )
      return { kind: "carry_read", value: { status: "unavailable" } };
    const row = rows[0];
    const envelope = object(row.sce);
    const root = validateRootProjection(envelope?.projection);
    const envelopeValid =
      envelope !== undefined &&
      Object.keys(envelope).length === 2 &&
      typeof envelope.commitment === "string" &&
      Object.prototype.hasOwnProperty.call(envelope, "projection") &&
      root.ok &&
      root.value.aggregateCommitment === envelope.commitment;
    const claims =
      row.claims_present === 0 &&
      row.claims === null &&
      row.claims_type === null
        ? {}
        : row.claims_present === 1 && row.claims_type === "OBJECT"
          ? row.claims
          : undefined;
    return {
      kind: "carry_read",
      value: {
        claims,
        root: envelopeValid ? root.value : undefined,
        status: "observed",
      },
    };
  }

  private carrySelectStatement(predecessorRootIssueId: string): string {
    return `SELECT id, JSON_EXTRACT(metadata,'$.sce') AS sce, JSON_EXTRACT(metadata,'$.sce_carry_claims') AS claims, JSON_CONTAINS_PATH(metadata,'one','$.sce_carry_claims') AS claims_present, JSON_TYPE(JSON_EXTRACT(metadata,'$.sce_carry_claims')) AS claims_type FROM issues WHERE id=${stringLiteral(predecessorRootIssueId)}`;
  }

  public async discoverCarry(
    request: Extract<EmbeddedRequest, { readonly kind: "carry_discover" }>,
    ref?: string,
  ): Promise<CrashDiscovery | undefined> {
    const intent = request.intent;
    if (
      !this.validCarryCheckpointIntent(intent) ||
      (ref !== undefined &&
        !(
          /^[A-Za-z0-9._-]{1,80}\/main$/u.test(ref) ||
          /^[0-9a-z]{20,64}$/u.test(ref)
        ))
    )
      return undefined;
    const statement = this.carrySelectStatement(intent.predecessorRootIssueId);
    const source = await this.sql(
      ref === undefined
        ? statement
        : statement.replace(" FROM issues", ` FROM issues AS OF '${ref}'`),
    );
    const rows = source === undefined ? undefined : parseRows(source);
    const currentHead = await this.head(ref);
    if (
      rows === undefined ||
      rows.length !== 1 ||
      rows[0]?.id !== intent.predecessorRootIssueId ||
      Object.keys(rows[0]).length !== 5 ||
      currentHead === undefined
    )
      return undefined;
    const row = rows[0];
    const envelope = object(row.sce);
    const root = validateRootProjection(envelope?.projection);
    if (
      envelope === undefined ||
      Object.keys(envelope).length !== 2 ||
      envelope.commitment !== intent.expectedAggregateCommitment ||
      !Object.prototype.hasOwnProperty.call(envelope, "projection") ||
      !root.ok ||
      root.value.aggregateCommitment !== intent.expectedAggregateCommitment
    )
      return { head: currentHead, status: "ambiguous" };
    const claims =
      row.claims_present === 0 &&
      row.claims === null &&
      row.claims_type === null
        ? {}
        : row.claims_present === 1 && row.claims_type === "OBJECT"
          ? object(row.claims)
          : undefined;
    if (claims === undefined) return { head: currentHead, status: "ambiguous" };
    if (Object.keys(claims).length === 0)
      return { head: currentHead, status: "absent" };
    const singleton = { [intent.exportDigest]: intent.record };
    return Object.keys(claims).length === 1 && same(claims, singleton)
      ? {
          head: currentHead,
          rootCommitment: root.value.aggregateCommitment,
          status: "observed",
        }
      : { head: currentHead, status: "ambiguous" };
  }

  public matchesCarryDelta(
    intent: CarryCheckpointIntent,
    source: string,
  ): boolean {
    if (!this.validCarryCheckpointIntent(intent)) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch {
      return false;
    }
    const tables = object(parsed)?.tables;
    const table = Array.isArray(tables) ? object(tables[0]) : undefined;
    const changes = table?.data_diff;
    if (
      !Array.isArray(tables) ||
      tables.length !== 1 ||
      table?.name !== "issues" ||
      !Array.isArray(changes) ||
      changes.length !== 1
    )
      return false;
    const delta = object(changes[0]);
    const before = object(delta?.from_row);
    const after = object(delta?.to_row);
    if (
      delta === undefined ||
      Object.keys(delta).length !== 2 ||
      before === undefined ||
      after === undefined ||
      before.id !== intent.predecessorRootIssueId ||
      after.id !== before.id ||
      !isPinnedBdIssueRow(before) ||
      !isPinnedBdIssueRow(after) ||
      Object.keys(before).length !== Object.keys(after).length ||
      Object.keys(before).some(
        (key) => !Object.prototype.hasOwnProperty.call(after, key),
      )
    )
      return false;
    for (const key of Object.keys(before)) {
      if (
        key !== "metadata" &&
        key !== "updated_at" &&
        !same(before[key], after[key])
      )
        return false;
    }
    const beforeMetadata = object(before.metadata);
    const afterMetadata = object(after.metadata);
    if (beforeMetadata === undefined || afterMetadata === undefined)
      return false;
    const beforeClaims = beforeMetadata.sce_carry_claims;
    if (
      !(
        beforeClaims === undefined ||
        (object(beforeClaims) !== undefined &&
          Object.keys(object(beforeClaims)!).length === 0)
      ) ||
      !same(afterMetadata.sce_carry_claims, {
        [intent.exportDigest]: intent.record,
      })
    )
      return false;
    const siblingKeys = new Set([
      ...Object.keys(beforeMetadata),
      ...Object.keys(afterMetadata),
    ]);
    for (const key of siblingKeys) {
      if (
        key !== "sce_carry_claims" &&
        !same(beforeMetadata[key], afterMetadata[key])
      )
        return false;
    }
    const sce = object(beforeMetadata.sce);
    return (
      sce?.commitment === intent.expectedAggregateCommitment &&
      same(beforeMetadata.sce, afterMetadata.sce)
    );
  }

  private validCarryCheckpointIntent(intent: CarryCheckpointIntent): boolean {
    const record = validate<ProvenanceCarryClaimRecord>(
      ProvenanceCarryClaimRecordSchema,
      intent.record,
    );
    return (
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(
        intent.predecessorRootIssueId,
      ) &&
      /^[0-9a-f]{64}$/u.test(intent.exportDigest) &&
      /^[0-9a-f]{64}$/u.test(intent.expectedAggregateCommitment) &&
      record.ok &&
      record.value !== undefined &&
      record.value.predecessorRootBeadId === intent.predecessorRootIssueId &&
      record.value.exportId === `sce:carry:${intent.exportDigest}`
    );
  }

  public async claimCarry(
    request: Extract<EmbeddedRequest, { readonly kind: "carry_claim" }>,
  ): Promise<EmbeddedResponse> {
    const parsedRecord = validate<ProvenanceCarryClaimRecord>(
      ProvenanceCarryClaimRecordSchema,
      request.record,
    );
    const slotPrefix = request.slot.slotId.endsWith("-merge-slot")
      ? request.slot.slotId.slice(0, -"-merge-slot".length)
      : "";
    if (
      !parsedRecord.ok ||
      parsedRecord.value === undefined ||
      !/^[0-9a-f]{64}$/u.test(request.exportDigest) ||
      request.record.exportId !== `sce:carry:${request.exportDigest}` ||
      request.record.predecessorRootBeadId !== request.predecessorRootIssueId ||
      !/^[0-9a-f]{64}$/u.test(request.expectedAggregateCommitment) ||
      !validateMergeSlotObservation(
        request.slot,
        slotPrefix,
        request.slot.scope,
      ).ok ||
      request.slot.status !== "acquired" ||
      request.slot.holder === undefined
    )
      return { kind: "carry_claim", value: { status: "unavailable" } };
    const singleton = { [request.exportDigest]: request.record };
    const slot = request.slot;
    const slotHolder = slot.holder!;
    const acquiredSlotPredicate = ` AND (SELECT COUNT(*) FROM issues WHERE id=${stringLiteral(slot.slotId)} AND title=${stringLiteral(slot.title)} AND status='in_progress' AND external_ref=${stringLiteral(`sce-scope:v1:${slot.scopeCommitment}`)} AND design=${stringLiteral(canonicalJson(slot.scope as JsonValue))} AND JSON_TYPE(metadata)='OBJECT' AND JSON_LENGTH(metadata)=1 AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.holder'))=${stringLiteral(slotHolder)})=1 AND (SELECT COUNT(*) FROM labels WHERE issue_id=${stringLiteral(slot.slotId)})=1 AND (SELECT COUNT(*) FROM labels WHERE issue_id=${stringLiteral(slot.slotId)} AND label=${stringLiteral(slot.label)})=1`;
    const readback = `SELECT @sce_affected AS affected, r.id AS root_id, JSON_EXTRACT(r.metadata,'$.sce') AS root_sce, JSON_EXTRACT(r.metadata,'$.sce_carry_claims') AS claims, s.id AS slot_id, s.title AS slot_title, s.status AS slot_status, s.external_ref AS slot_external_ref, s.design AS slot_design, s.metadata AS slot_metadata, (SELECT COUNT(*) FROM labels WHERE issue_id=s.id) AS label_count, (SELECT COUNT(*) FROM labels WHERE issue_id=s.id AND label=${stringLiteral(slot.label)}) AS matching_label_count FROM issues r JOIN issues s ON s.id=${stringLiteral(slot.slotId)} WHERE r.id=${stringLiteral(request.predecessorRootIssueId)}`;
    const output = await this.sql(
      `START TRANSACTION; UPDATE issues SET metadata=JSON_SET(metadata,'$.sce_carry_claims',${jsonLiteral(singleton)}) WHERE id=${stringLiteral(request.predecessorRootIssueId)} AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.sce.commitment'))=${stringLiteral(request.expectedAggregateCommitment)} AND (JSON_EXTRACT(metadata,'$.sce_carry_claims') IS NULL OR (JSON_TYPE(JSON_EXTRACT(metadata,'$.sce_carry_claims'))='OBJECT' AND JSON_LENGTH(JSON_EXTRACT(metadata,'$.sce_carry_claims'))=0))${acquiredSlotPredicate}; SET @sce_affected=ROW_COUNT(); ${readback} FOR UPDATE; COMMIT; ${readback}`,
    );
    if (output === undefined)
      return { kind: "carry_claim", value: { status: "unavailable" } };
    const rows = parseRows(output);
    const row = rows?.length === 1 ? rows[0] : undefined;
    if (row?.affected !== 1)
      return { kind: "carry_claim", value: { status: "stale" } };
    const rootEnvelope = object(row.root_sce);
    const root = validateRootProjection(rootEnvelope?.projection);
    if (
      Object.keys(row).length !== 12 ||
      row.root_id !== request.predecessorRootIssueId ||
      !root.ok ||
      root.value.aggregateCommitment !== request.expectedAggregateCommitment ||
      rootEnvelope?.commitment !== request.expectedAggregateCommitment ||
      !same(row.claims, singleton) ||
      row.slot_id !== slot.slotId ||
      row.slot_title !== slot.title ||
      row.slot_status !== "in_progress" ||
      row.slot_external_ref !== `sce-scope:v1:${slot.scopeCommitment}` ||
      row.slot_design !== canonicalJson(slot.scope as JsonValue) ||
      !same(row.slot_metadata, { holder: slotHolder }) ||
      row.label_count !== 1 ||
      row.matching_label_count !== 1
    )
      return { kind: "carry_claim", value: { status: "unavailable" } };
    return {
      kind: "carry_claim",
      value: {
        claims: row.claims,
        root: rootEnvelope?.projection,
        status: "observed",
      },
    };
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

  /**
   * The selected root/child readback above establishes the requested state.
   * This companion proof establishes that a Dolt checkpoint contains no other
   * pending or committed data movement.
   */
  public matchesBatchDelta(batchInput: MutationBatch, source: string): boolean {
    const batch = validateMutationBatch(batchInput);
    if (!batch.ok) return false;
    const rows = this.rows(batch.value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch {
      return false;
    }
    const root = object(parsed);
    if (
      rows === undefined ||
      root === undefined ||
      Object.keys(root).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(root, "tables") ||
      !Array.isArray(root.tables) ||
      root.tables.length !== 1
    )
      return false;
    const table = object(root.tables[0]);
    if (
      table === undefined ||
      Object.keys(table).length !== 2 ||
      table.name !== "issues" ||
      !Array.isArray(table.data_diff) ||
      table.data_diff.length !== rows.length
    )
      return false;
    const expected = new Map(rows.map((row) => [row.issueId, row]));
    const seen = new Set<string>();
    for (const input of table.data_diff) {
      const diff = object(input);
      const from = diff === undefined ? undefined : object(diff.from_row);
      const to = diff === undefined ? undefined : object(diff.to_row);
      if (
        diff === undefined ||
        Object.keys(diff).length !== 2 ||
        from === undefined ||
        to === undefined ||
        typeof from.id !== "string" ||
        from.id !== to.id ||
        seen.has(from.id)
      )
        return false;
      const row = expected.get(from.id);
      if (
        row === undefined ||
        !this.matchesProjectionRow(from, to, row.expectedCommitment, row.next)
      )
        return false;
      seen.add(from.id);
    }
    return seen.size === expected.size;
  }

  /** Complete root+initial-child delta proof used before initial commit/push. */
  public matchesInitialDelta(
    input: EmbeddedInitialProjection,
    source: string,
  ): boolean {
    const rows = this.initialRows(input);
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch {
      return false;
    }
    const table = object(parsed)?.tables;
    const change =
      Array.isArray(table) && table.length === 1
        ? object(table[0])?.data_diff
        : undefined;
    if (
      rows === undefined ||
      !Array.isArray(table) ||
      table.length !== 1 ||
      object(table[0])?.name !== "issues" ||
      !Array.isArray(change) ||
      change.length !== rows.length
    )
      return false;
    const expected = new Map(rows.map((row) => [row.issueId, row.next]));
    const seen = new Set<string>();
    for (const value of change) {
      const diff = object(value);
      const before = diff === undefined ? undefined : object(diff.from_row);
      const after = diff === undefined ? undefined : object(diff.to_row);
      if (
        diff === undefined ||
        before === undefined ||
        after === undefined ||
        typeof before.id !== "string" ||
        before.id !== after.id ||
        seen.has(before.id) ||
        !isPinnedBdIssueRow(before) ||
        !isPinnedBdIssueRow(after)
      )
        return false;
      const next = expected.get(before.id);
      const beforeMetadata = object(before.metadata);
      const afterMetadata = object(after.metadata);
      if (
        next === undefined ||
        beforeMetadata === undefined ||
        afterMetadata === undefined ||
        beforeMetadata.sce !== undefined ||
        !same(afterMetadata.sce, next)
      )
        return false;
      for (const key of Object.keys(before)) {
        if (
          key !== "metadata" &&
          key !== "updated_at" &&
          !same(before[key], after[key])
        )
          return false;
      }
      for (const key of Object.keys(beforeMetadata)) {
        if (key !== "sce" && !same(beforeMetadata[key], afterMetadata[key]))
          return false;
      }
      seen.add(before.id);
    }
    return seen.size === expected.size;
  }

  private writeStatement(
    batch: MutationBatch,
    slot?: MergeSlotObservation,
  ): string | undefined {
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
    return `UPDATE issues SET metadata=CASE id ${cases} ELSE metadata END WHERE id IN (${ids}) AND (SELECT COUNT(*) FROM issues WHERE ${expected})=${rows.length}${slot === undefined ? "" : this.availableSlotPredicate(slot)}`;
  }

  private availableSlotPredicate(slot: MergeSlotObservation): string {
    return ` AND (SELECT COUNT(*) FROM issues WHERE id=${stringLiteral(slot.slotId)} AND title=${stringLiteral(slot.title)} AND status='open' AND external_ref=${stringLiteral(`sce-scope:v1:${slot.scopeCommitment}`)} AND design=${stringLiteral(canonicalJson(slot.scope as JsonValue))} AND JSON_TYPE(metadata)='OBJECT' AND JSON_LENGTH(metadata)=0)=1 AND (SELECT COUNT(*) FROM labels WHERE issue_id=${stringLiteral(slot.slotId)} AND label=${stringLiteral(slot.label)})=1`;
  }

  private initialRows(
    input: EmbeddedInitialProjection,
  ): readonly { issueId: string; next: unknown }[] | undefined {
    const root = validateRootProjection(input.root);
    if (!root.ok) return undefined;
    const values: ChildProjection[] = [];
    for (const inputChild of input.children) {
      const child = validateChildProjection(inputChild);
      if (!child.ok) return undefined;
      values.push(child.value);
    }
    values.sort((left, right) => compareCodeUnits(left.unitId, right.unitId));
    if (
      values.length !== root.value.childRows.length ||
      values.some(
        (child, index) =>
          root.value.childRows[index]?.unitId !== child.unitId ||
          root.value.childRows[index]?.revision !== child.revision ||
          root.value.childRows[index]?.commitment !== child.commitment ||
          !same(child.scope, root.value.scope) ||
          child.holder !== root.value.holder ||
          !same(child.unit, root.value.run.units[child.unitId]),
      )
    )
      return undefined;
    const rows = [
      {
        issueId: this.rootIssueId,
        next: {
          commitment: root.value.aggregateCommitment,
          projection: root.value,
        },
      },
      ...values.map((child) => {
        const issueId = this.childIssueId(child.unitId);
        return issueId === undefined
          ? undefined
          : {
              issueId,
              next: { commitment: child.commitment, projection: child },
            };
      }),
    ];
    return rows.some((row) => row === undefined) ||
      new Set(rows.map((row) => row?.issueId)).size !== rows.length
      ? undefined
      : (rows as { issueId: string; next: unknown }[]).sort((left, right) =>
          compareCodeUnits(left.issueId, right.issueId),
        );
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
      (ref !== undefined &&
        !(
          /^[A-Za-z0-9._-]{1,80}\/main$/u.test(ref) ||
          /^[0-9a-z]{20,64}$/u.test(ref)
        ))
    )
      return undefined;
    const statement = this.selectStatement(rows.map((row) => row.issueId));
    const source = await this.sql(
      ref === undefined
        ? statement
        : statement.replace(" FROM issues", ` FROM issues AS OF '${ref}'`),
    );
    if (source === undefined) return undefined;
    return this.projectionRows(source, batch);
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

  private matchesProjectionRow(
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    expectedCommitment: string,
    next: unknown,
  ): boolean {
    if (
      !isPinnedBdIssueRow(from) ||
      !isPinnedBdIssueRow(to) ||
      Object.keys(from).length !== Object.keys(to).length ||
      Object.keys(from).some(
        (key) => !Object.prototype.hasOwnProperty.call(to, key),
      )
    )
      return false;
    for (const key of Object.keys(from)) {
      if (
        key !== "metadata" &&
        key !== "updated_at" &&
        !same(from[key], to[key])
      )
        return false;
    }
    if (
      typeof from.updated_at !== "string" ||
      typeof to.updated_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(from.updated_at) ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(to.updated_at)
    )
      return false;
    const before = object(from.metadata);
    const after = object(to.metadata);
    if (
      before === undefined ||
      after === undefined ||
      Object.keys(before).length !== Object.keys(after).length ||
      Object.keys(before).some(
        (key) => !Object.prototype.hasOwnProperty.call(after, key),
      )
    )
      return false;
    for (const key of Object.keys(before)) {
      if (key !== "sce" && !same(before[key], after[key])) return false;
    }
    const previous = object(before.sce);
    if (
      previous === undefined ||
      Object.keys(previous).length !== 2 ||
      previous.commitment !== expectedCommitment ||
      !Object.prototype.hasOwnProperty.call(previous, "projection")
    )
      return false;
    const projection = previous.projection;
    const commitment =
      projection !== null &&
      typeof projection === "object" &&
      "unitId" in projection
        ? (() => {
            const valid = validateChildProjection(projection);
            return valid.ok ? valid.value.commitment : undefined;
          })()
        : (() => {
            const valid = validateRootProjection(projection);
            return valid.ok ? valid.value.aggregateCommitment : undefined;
          })();
    return (
      commitment === expectedCommitment &&
      same(after.sce, next) &&
      !same(before.sce, after.sce)
    );
  }

  private parseReadback(
    source: string,
    batch: MutationBatch,
  ): EmbeddedReadback | undefined {
    const actual = this.projectionRows(source, batch);
    return actual === undefined ||
      !same(actual.root, batch.next.root) ||
      !same(
        actual.children,
        [...batch.next.children].sort((a, b) =>
          compareCodeUnits(a.unitId, b.unitId),
        ),
      )
      ? undefined
      : actual;
  }

  /**
   * A projection read is a fixed root/affected-child set, not a loose JSON
   * blob. Parse it once for local and AS OF reads so swapped/extra rows cannot
   * become recovery authority through a different call path.
   */
  private projectionRows(
    source: string,
    batch: MutationBatch,
  ): EmbeddedReadback | undefined {
    const expected = this.rows(batch);
    const records = parseRows(source);
    if (
      expected === undefined ||
      records === undefined ||
      records.length !== expected.length
    )
      return undefined;
    const expectedIds = new Set(expected.map((row) => row.issueId));
    if (expectedIds.size !== expected.length) return undefined;
    const seen = new Set<string>();
    let root: RootProjection | undefined;
    const children: ChildProjection[] = [];
    for (const record of records) {
      if (
        Object.keys(record).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(record, "id") ||
        !Object.prototype.hasOwnProperty.call(record, "sce") ||
        typeof record.id !== "string" ||
        !expectedIds.has(record.id) ||
        seen.has(record.id)
      )
        return undefined;
      seen.add(record.id);
      const envelope = object(record.sce);
      if (
        envelope === undefined ||
        Object.keys(envelope).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(envelope, "commitment") ||
        !Object.prototype.hasOwnProperty.call(envelope, "projection") ||
        typeof envelope.commitment !== "string"
      )
        return undefined;
      if (record.id === this.rootIssueId) {
        const candidate = validateRootProjection(envelope.projection);
        if (
          !candidate.ok ||
          candidate.value.aggregateCommitment !== envelope.commitment
        )
          return undefined;
        root = candidate.value;
        continue;
      }
      const candidate = validateChildProjection(envelope.projection);
      if (
        !candidate.ok ||
        candidate.value.commitment !== envelope.commitment ||
        this.childIssueId(candidate.value.unitId) !== record.id
      )
        return undefined;
      children.push(candidate.value);
    }
    return root === undefined ||
      seen.size !== expectedIds.size ||
      children.length !== batch.changedRows.length
      ? undefined
      : {
          children: children.sort((a, b) =>
            compareCodeUnits(a.unitId, b.unitId),
          ),
          root,
        };
  }

  private async sql(query: string): Promise<string | undefined> {
    const executable = this.executable();
    if (
      executable === undefined ||
      sameExecutable(this.rejectedExecutable, executable)
    )
      return undefined;
    this.rejectedExecutable = undefined;
    if (!(await this.pinnedVersion(executable))) return undefined;
    const operational = this.executable();
    if (operational === undefined || !sameExecutable(executable, operational)) {
      this.rejectedExecutable = operational ?? executable;
      return undefined;
    }
    return new Promise((resolve) => {
      let output = "";
      let bytes = 0;
      let settled = false;
      const child = spawn(
        operational.path,
        ["sql", "-r", "json", "-q", query],
        {
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
        },
      );
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
