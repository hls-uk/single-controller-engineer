import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const REPOSITORY_ID = "R_kgDOUCvUmw";
const REPOSITORY = "hls-uk/single-controller-engineer";
const MARKER =
  /^<!-- sce-feedback:v1;kind=(bug|enhancement);component=(adapter|capability|protocol|runtime|topology);tool=(0|[1-9][0-9]*)\.(0|[1-9][0-9]*);fingerprint=([0-9a-f]{64}) -->$/u;
const HEADER =
  /^<!-- Generated controlled telemetry\. -->\n- Component: (adapter|capability|protocol|runtime|topology)\n- Tool version: ((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.[0-9]+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\n- Toolchain: (node-22)\n- Requested model tier: (frontier|workhorse)\n- Protocol state: (blocked|failed|preflight|recovery|verification)\n- Stable error code: (SCE_[A-Z0-9_]{1,75})\n- Capability: (feedback\.(?:outbox|recovery|submit|transport))$/u;
const NARRATIVE_KEYS = [
  "expected",
  "observed",
  "reproduction",
  "limitation",
  "desiredCapability",
  "value",
  "workaround",
  "completionExample",
];
const HOSTILE_NARRATIVE =
  /https?:\/\/|(?:^|[\s"'])\/(?:Users|home|private|var|tmp)\/|\b(?:password|secret|api[_-]?key|authorization)\s*[:=]|\b(?:ghp_|github_pat_|sk-[A-Za-z0-9]|AKIA)[A-Za-z0-9_-]{8,}|```|\b(?:function|const|import|class)\s+[A-Za-z_$]/iu;
const UNSAFE_TEXT =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/u;

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function none() {
  return { action: "none" };
}

function controlledFingerprint(fields) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        capability_id: fields.capabilityId,
        component: fields.component,
        destination_repository_id: REPOSITORY_ID,
        kind: fields.kind,
        protocol_state: fields.protocolState,
        schema_version: 1,
        stable_error_code: fields.stableErrorCode,
        tool_major_minor: fields.toolMajorMinor,
      }),
    )
    .digest("hex");
}

export function parseControlledFeedback(body) {
  if (
    typeof body !== "string" ||
    body.includes("\r") ||
    hasUnpairedSurrogate(body) ||
    UNSAFE_TEXT.test(body) ||
    Buffer.byteLength(body, "utf8") > 16_384
  )
    return undefined;
  const divider = body.lastIndexOf("\n\n<!-- sce-feedback:");
  if (divider === -1) return undefined;
  const source = body.slice(0, divider);
  const marker = body.slice(divider + 2);
  const narrativePrefix = "\n\n# Reviewed narrative\n";
  const narrativeStart = source.indexOf(narrativePrefix);
  if (
    narrativeStart !== -1 &&
    source.indexOf(narrativePrefix, narrativeStart + narrativePrefix.length) !==
      -1
  )
    return undefined;
  const header =
    narrativeStart === -1 ? source : source.slice(0, narrativeStart);
  const narrative =
    narrativeStart === -1
      ? undefined
      : source.slice(narrativeStart + narrativePrefix.length);
  if (
    header === undefined ||
    (narrative !== undefined && !validNarrative(narrative))
  )
    return undefined;
  const match = HEADER.exec(header);
  if (match === null) return undefined;
  const [
    ,
    component,
    toolVersion,
    toolMajor,
    toolMinor,
    toolchain,
    requestedModelTier,
    protocolState,
    stableErrorCode,
    capabilityId,
  ] = match;
  const markerMatch = MARKER.exec(marker);
  const kind = markerMatch?.[1];
  const markerComponent = markerMatch?.[2];
  const markerMajor = markerMatch?.[3];
  const markerMinor = markerMatch?.[4];
  const fingerprint = markerMatch?.[5];
  if (
    component === undefined ||
    toolVersion === undefined ||
    toolMajor === undefined ||
    toolMinor === undefined ||
    toolchain === undefined ||
    requestedModelTier === undefined ||
    protocolState === undefined ||
    stableErrorCode === undefined ||
    capabilityId === undefined ||
    kind === undefined ||
    markerComponent !== component ||
    markerMajor !== toolMajor ||
    markerMinor !== toolMinor ||
    fingerprint === undefined ||
    markerMatch === null
  )
    return undefined;
  const computed = controlledFingerprint({
    capabilityId,
    component,
    kind,
    protocolState,
    stableErrorCode,
    toolMajorMinor: `${toolMajor}.${toolMinor}`,
  });
  return computed === fingerprint
    ? { fingerprint, marker, toolVersion }
    : undefined;
}

function validNarrative(value) {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 4_096 ||
    HOSTILE_NARRATIVE.test(value)
  )
    return false;
  const section =
    /(?:^|\n\n)## ([A-Za-z]+)\n([\s\S]*?)(?=\n\n## [A-Za-z]+\n|$)/gu;
  let previous = -1;
  let cursor = 0;
  for (const match of value.matchAll(section)) {
    const key = match?.[1];
    const content = match?.[2];
    const index = key === undefined ? -1 : NARRATIVE_KEYS.indexOf(key);
    if (
      match.index !== cursor ||
      index <= previous ||
      content === undefined ||
      content.startsWith("\n") ||
      content.endsWith("\n")
    )
      return false;
    cursor = match.index + match[0].length;
    previous = index;
  }
  return previous >= 0 && cursor === value.length;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff)
        return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

export function triagePlan(event, discovery) {
  if (
    !event ||
    typeof event !== "object" ||
    !event.repository ||
    typeof event.repository !== "object" ||
    event.repository.node_id !== REPOSITORY_ID ||
    !event.issue ||
    typeof event.issue !== "object" ||
    !Number.isSafeInteger(event.issue.number) ||
    event.issue.number < 1 ||
    event.issue.state !== "open"
  )
    return none();
  const eventPacket = parseControlledFeedback(event.issue.body);
  if (eventPacket === undefined) return none();
  if (
    !exactKeys(discovery, [
      "issues",
      "paginationComplete",
      "repositoryId",
      "schema",
      "version",
    ]) ||
    discovery.schema !== "sce.feedback-discovery" ||
    discovery.version !== 1 ||
    discovery.repositoryId !== REPOSITORY_ID ||
    discovery.paginationComplete !== true ||
    !Array.isArray(discovery.issues)
  )
    return none();
  const matches = [];
  const seen = new Set();
  for (const issue of discovery.issues) {
    if (
      !exactKeys(issue, ["body", "number", "open"]) ||
      !Number.isSafeInteger(issue.number) ||
      issue.number < 1 ||
      typeof issue.open !== "boolean" ||
      typeof issue.body !== "string" ||
      seen.has(issue.number)
    )
      return none();
    seen.add(issue.number);
    const packet = issue.open ? parseControlledFeedback(issue.body) : undefined;
    if (packet?.fingerprint === eventPacket.fingerprint)
      matches.push(issue.number);
  }
  if (!seen.has(event.issue.number)) return none();
  const canonical = matches.sort((left, right) => left - right)[0];
  if (canonical === undefined || canonical === event.issue.number)
    return none();
  return {
    action: "apply",
    comment: `Duplicate feedback report; canonical issue: https://github.com/${REPOSITORY}/issues/${canonical}`,
    issueNumber: event.issue.number,
    label: "duplicate",
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [eventPath, discoveryPath, outputPath] = process.argv.slice(2);
  if (
    eventPath === undefined ||
    discoveryPath === undefined ||
    outputPath === undefined ||
    process.argv.length !== 5
  )
    throw new Error("expected event, discovery, and output paths");
  let plan = none();
  try {
    plan = triagePlan(
      JSON.parse(readFileSync(eventPath, "utf8")),
      JSON.parse(readFileSync(discoveryPath, "utf8")),
    );
  } catch {
    plan = none();
  }
  writeFileSync(outputPath, `${JSON.stringify(plan)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
