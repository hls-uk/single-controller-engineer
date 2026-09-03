/**
 * Pure provenance record projection.
 *
 * Every input is a journaled `provenance_commit` intent parameter plus the
 * run's recorded harness family, so the same run store projects the same
 * bytes. Nothing here reads configuration, the clock, or the filesystem.
 * The record grammar is the strict frontmatter the knowledge fast gate
 * validates (see the knowledge skill's `provenance-record.schema.json`).
 */
import { canonicalJson, type JsonValue } from "./canonical.js";
import { sha256 } from "./evidence.js";
import { decodeClosedUnitEvidence } from "./reducer.js";
import type {
  ClosureEvidence,
  GateMaterialisation,
  GateTargetState,
  ProvenanceInput,
  RuntimeEffect,
} from "./schemas.js";

export type ProvenanceCommitParams = Extract<
  RuntimeEffect,
  { kind: "provenance_commit" }
>["params"];

/** Commit-message trailer that makes a provenance commit discoverable by key. */
export const PROVENANCE_KEY_TRAILER = "SCE-Provenance-Key";
/** Constant author and committer email; the name is the controller holder. */
export const PROVENANCE_COMMITTER_EMAIL = "sce@noreply.invalid";
export const PROVENANCE_RECORD_SCHEMA = "sce.knowledge-provenance";
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const MAX_DRIVER_CHARACTERS = 256;
const MAX_SUMMARY_CHARACTERS = 8_192;
const MAX_DESTINATIONS = 64;

export type ProvenanceRecordFile = Readonly<{
  id: string;
  /** POSIX path relative to the repository root, inside the events directory. */
  path: string;
  bytes: string;
}>;

export type ProvenanceProjection =
  | Readonly<{
      ok: true;
      records: readonly ProvenanceRecordFile[];
      /** Domain-separated digest over every record path and its bytes. */
      recordsCommitment: string;
    }>
  | Readonly<{ ok: false; reason: string }>;

type MaterialisationEvidence = Readonly<{
  destination: string;
  digest: string | null;
  status: "observed" | "deferred";
}>;

/** Deterministic, filesystem-safe, unique per landed unit. */
export function deriveProvenanceRecordId(
  unitId: string,
  landedOid: string,
): string {
  const safe = unitId.replaceAll(/[^A-Za-z0-9._-]/gu, "-").slice(0, 140);
  return `${safe}--${landedOid.slice(0, 12)}`;
}

export function provenanceCommitSubject(waveId: string): string {
  return `sce: provenance for wave ${waveId}`;
}

export function provenanceCommitTrailer(idempotencyKey: string): string {
  return `${PROVENANCE_KEY_TRAILER}: ${idempotencyKey}`;
}

/** Git date rendering of the journaled UTC-second clock: `<unix> +0000`. */
export function provenanceCommitDate(timestamp: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/u.exec(
    timestamp,
  );
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const unix = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  if (!Number.isSafeInteger(unix) || unix < 0) return undefined;
  const rendered = new Date(unix).toISOString().replace(/\.\d{3}Z$/u, "Z");
  return rendered === timestamp ? `${unix / 1_000} +0000` : undefined;
}

export function provenanceRecordsCommitment(
  records: readonly ProvenanceRecordFile[],
): string {
  return sha256(
    canonicalJson({
      domain: "sce.provenance-records.v1",
      records: records.map((record) => ({
        path: record.path,
        sha256: sha256(record.bytes),
      })),
    }),
  );
}

/**
 * Project one canonical Markdown record per unit in the frozen snapshot.
 * Records are returned in byte-sorted path order.
 */
export function projectProvenanceRecords(
  params: ProvenanceCommitParams,
  executorTool: string,
): ProvenanceProjection {
  const snapshot = params.projectionInputSnapshot;
  const evidence = decodeClosedUnitEvidence(snapshot.closedUnitEvidence);
  if (evidence === undefined)
    return { ok: false, reason: "closure evidence is undecodable" };
  if (params.knowledgeContract.humanDriver.length > MAX_DRIVER_CHARACTERS)
    return { ok: false, reason: "human driver exceeds the record bound" };
  const records: ProvenanceRecordFile[] = [];
  const ids = new Set<string>();
  for (const unitId of snapshot.unitIds) {
    const closure = evidence[unitId];
    if (closure === undefined || closure.outcome !== "landed")
      return { ok: false, reason: `unit ${unitId} has no landed evidence` };
    const projected = projectUnitRecord(
      params,
      snapshot,
      closure,
      executorTool,
    );
    if (!projected.ok) return projected;
    if (ids.has(projected.record.id))
      return {
        ok: false,
        reason: `duplicate record id ${projected.record.id}`,
      };
    ids.add(projected.record.id);
    records.push(projected.record);
  }
  records.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return {
    ok: true,
    records,
    recordsCommitment: provenanceRecordsCommitment(records),
  };
}

function projectUnitRecord(
  params: ProvenanceCommitParams,
  snapshot: ProvenanceInput,
  closure: Extract<ClosureEvidence, { outcome: "landed" }>,
  executorTool: string,
):
  | Readonly<{ ok: true; record: ProvenanceRecordFile }>
  | Readonly<{ ok: false; reason: string }> {
  const contract = params.knowledgeContract;
  if (closure.ownedPaths === undefined || closure.acceptanceIds === undefined)
    return {
      ok: false,
      reason: `unit ${closure.unitId} closure lacks task facts`,
    };
  if (closure.reviewer === undefined)
    return {
      ok: false,
      reason: `unit ${closure.unitId} closure lacks reviewer binding`,
    };
  const id = deriveProvenanceRecordId(closure.unitId, closure.landedOid);
  if (!RECORD_ID.test(id))
    return { ok: false, reason: `record id ${id} is not canonical` };
  const targets = snapshot.targetEvidence
    .filter(
      (target) =>
        target.definition.scope === "unit" &&
        target.definition.originUnitId === closure.unitId,
    )
    .sort(
      (left, right) =>
        left.definition.targetOrdinal - right.definition.targetOrdinal,
    );
  const materialisations = dedupe(targets.flatMap(materialisationEvidence));
  if (materialisations.length > MAX_DESTINATIONS)
    return { ok: false, reason: `unit ${closure.unitId} exceeds destinations` };
  const summary = `Unit ${closure.unitId} landed ${closure.landedOid} on base ${closure.baseOid} in run ${params.runId} wave ${params.waveId}.`;
  if (summary.length > MAX_SUMMARY_CHARACTERS)
    return { ok: false, reason: "summary exceeds the record bound" };
  const commands = closure.verification.commands;
  const frontmatter: readonly (readonly [string, JsonValue])[] = [
    ["schema", PROVENANCE_RECORD_SCHEMA],
    ["version", 1],
    ["id", id],
    ["projectId", contract.projectId],
    ["accessDomainId", contract.domainScope],
    ["audience", contract.audience],
    ["unitId", closure.unitId],
    ["humanDriver", contract.humanDriver],
    ["executorTool", executorTool],
    ["executorSessionId", closure.worker?.sessionId ?? null],
    ["timestampUtc", params.timestamp],
    ["baseOid", closure.baseOid],
    ["landedOid", closure.landedOid],
    ["ownedPaths", [...closure.ownedPaths]],
    ["acceptanceIds", [...closure.acceptanceIds]],
    ["verificationCommands", [...commands]],
    ["verificationResults", commands.map(() => "passed")],
    [
      "verificationEvidenceHashes",
      commands.map(() => closure.verification.evidenceHash),
    ],
    ["reviewDecision", "approve"],
    ["reviewBaseOid", closure.review.baseOid],
    ["reviewHeadOid", closure.review.headOid],
    ["reviewTreeOid", closure.review.treeOid],
    ["reviewPromptHash", closure.reviewer.promptHash],
    ["reviewResponseHash", closure.review.responseHash],
    [
      "materialisationDestinations",
      materialisations.map((item) => item.destination),
    ],
    ["materialisationDigests", materialisations.map((item) => item.digest)],
    ["materialisationStatuses", materialisations.map((item) => item.status)],
    ["supersedes", [...(closure.supersedes ?? [])]],
    ["tombstones", [...(closure.tombstones ?? [])]],
    ["summary", summary],
  ];
  const lines = [
    "---",
    ...frontmatter.map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "---",
    "",
    "# Provenance record",
    "",
    `- Unit \`${closure.unitId}\` (ordinal ${closure.unitOrdinal}) landed`,
    `  \`${closure.landedOid}\` on base \`${closure.baseOid}\`.`,
    `- Run \`${params.runId}\`, wave \`${params.waveId}\`, gate entry`,
    `  \`${params.gateEntryId}\`, provenance base \`${params.baseOid}\`.`,
    `- Candidate \`${closure.candidate.headOid}\` with tree`,
    `  \`${closure.candidate.treeOid}\`; repairs: ${closure.repairCount ?? 0}.`,
    "",
    "## Materialisation targets",
    "",
    ...(targets.length === 0
      ? ["No materialisation targets were declared."]
      : [
          "| Target | Pattern | Destination | Resolution | Outputs |",
          "| --- | --- | --- | --- | --- |",
          ...targets.map(targetRow),
        ]),
  ];
  const bytes = `${lines.join("\n")}\n`;
  if (/[\t]|[ \t]$/mu.test(bytes) || bytes.includes("\r"))
    return { ok: false, reason: "record bytes are not canonical Markdown" };
  return {
    ok: true,
    record: {
      bytes,
      id,
      path: `${contract.provenance.eventsDirectory}/${id}.md`,
    },
  };
}

function materialisationEvidence(
  target: GateTargetState,
): readonly MaterialisationEvidence[] {
  const { destinationAlias, destinationSubpath } = target.definition.target;
  const home = `${destinationAlias}:${destinationSubpath}`;
  if (target.materialisations.length === 0)
    return [{ destination: home, digest: null, status: "deferred" }];
  return target.materialisations.map((item) =>
    item.status === "observed" &&
    item.observation !== undefined &&
    item.artifactName !== undefined
      ? {
          destination: `${home}/${item.artifactName}`,
          digest: item.observation.artifactSha256,
          status: "observed" as const,
        }
      : {
          destination:
            item.artifactName === undefined
              ? home
              : `${home}/${item.artifactName}`,
          digest: null,
          status: "deferred" as const,
        },
  );
}

function dedupe(
  items: readonly MaterialisationEvidence[],
): readonly MaterialisationEvidence[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = canonicalJson(item as unknown as JsonValue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/[\r\n\t]/gu, " ");
}

function targetRow(target: GateTargetState): string {
  const definition = target.definition;
  const resolution =
    target.resolution === undefined
      ? `${target.status}${dispositionSuffix(target.disposition, target.followUpBeadId)}`
      : target.resolution.status === "observed"
        ? `observed ${target.resolution.sourceOid.slice(0, 12)}`
        : `${target.resolution.status}${
            target.resolution.lastRefusal === undefined
              ? ""
              : ` refused:${target.resolution.lastRefusal.code}`
          }${dispositionSuffix(
            target.resolution.disposition ?? target.disposition,
            target.resolution.followUpBeadId ?? target.followUpBeadId,
          )}`;
  const outputs =
    target.materialisations.length === 0
      ? "none"
      : target.materialisations.map(outputCell).join("; ");
  return `| ${cell(definition.targetId)} | \`${cell(definition.target.sourcePattern)}\` | \`${cell(
    `${definition.target.destinationAlias}:${definition.target.destinationSubpath}`,
  )}\` | ${cell(resolution)} | ${cell(outputs)} |`;
}

function outputCell(item: GateMaterialisation): string {
  const name = item.artifactName ?? item.source.path;
  const refusal =
    item.lastRefusal === undefined ? "" : ` refused:${item.lastRefusal.code}`;
  return `${name} ${item.status}${refusal}${dispositionSuffix(
    item.disposition,
    item.followUpBeadId,
  )}`;
}

function dispositionSuffix(
  disposition: string | undefined,
  followUpBeadId: string | undefined,
): string {
  return `${disposition === undefined ? "" : ` ${disposition}`}${
    followUpBeadId === undefined ? "" : ` follow-up:${followUpBeadId}`
  }`;
}
