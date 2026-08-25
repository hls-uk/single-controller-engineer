import { authorizes, type FeedbackAuthority } from "./authority.js";
import { GhFeedbackTransport } from "./github.js";
import { FeedbackOutbox, recoverKilledProcessLock } from "./outbox.js";
import {
  prepareFeedback,
  previewFeedback,
  type FeedbackPacket,
  type ReviewedNarrativeInput,
  type SafeTelemetryInput,
  validateFeedbackPacket,
} from "./packet.js";
import {
  processFeedbackCommandExecutor,
  resolveGitCommonDirectory,
  type FeedbackCommandExecutor,
} from "./runtime.js";
import type { FeedbackGitHubTransport, GitHubIssue } from "./submit.js";

export interface FeedbackCliDependencies {
  readonly cwd?: string;
  readonly executor?: FeedbackCommandExecutor;
  readonly resolveCommonDirectory?: () => Promise<string | undefined>;
  readonly transport?: FeedbackGitHubTransport;
}

export type FeedbackCliOutcome =
  | Readonly<{ ok: true; result: Record<string, unknown> }>
  | Readonly<{
      code: string;
      exitCode: 64 | 69 | 70;
      message: string;
      ok: false;
    }>;

/** Executes the public feedback surface without falling back to a generic runner. */
export async function runFeedbackCliAction(
  action: "prepare" | "preview" | "submit" | "flush",
  request: unknown,
  dependencies: FeedbackCliDependencies = {},
): Promise<FeedbackCliOutcome> {
  if (action === "prepare") return prepare(request);
  if (action === "preview") return preview(request);
  if (action === "submit") return submit(request, dependencies);
  return flush(request, dependencies);
}

function prepare(request: unknown): FeedbackCliOutcome {
  const source = exactObject(request, ["telemetry", "narrative"]);
  if (source === undefined)
    return invalid(
      "SCE_INVALID_FEEDBACK_REQUEST",
      "Feedback request is invalid.",
    );
  const packet = prepareFeedback(
    source.telemetry as SafeTelemetryInput,
    source.narrative as ReviewedNarrativeInput | undefined,
  );
  return packet === undefined
    ? invalid("SCE_INVALID_FEEDBACK_REQUEST", "Feedback request is invalid.")
    : { ok: true, result: { packet } };
}

function preview(request: unknown): FeedbackCliOutcome {
  const source = exactObject(request, ["packet"]);
  if (source === undefined)
    return invalid(
      "SCE_INVALID_FEEDBACK_REQUEST",
      "Feedback request is invalid.",
    );
  const preview = previewFeedback(source.packet);
  return preview === undefined
    ? invalid("SCE_INVALID_FEEDBACK_PACKET", "Feedback packet is invalid.")
    : { ok: true, result: { preview } };
}

async function submit(
  request: unknown,
  dependencies: FeedbackCliDependencies,
): Promise<FeedbackCliOutcome> {
  const source = exactObject(request, ["packet", "authority"]);
  if (source === undefined)
    return invalid(
      "SCE_INVALID_FEEDBACK_REQUEST",
      "Feedback request is invalid.",
    );
  const packet = validateFeedbackPacket(source.packet);
  if (packet === undefined)
    return invalid(
      "SCE_INVALID_FEEDBACK_PACKET",
      "Feedback packet is invalid.",
    );
  const authority = parseAuthority(source.authority);
  const outbox = await openOutbox(dependencies);
  if (outbox === undefined)
    return unavailable(
      "SCE_FEEDBACK_OUTBOX_UNAVAILABLE",
      "Feedback outbox is unavailable.",
    );
  const enqueued = outbox.enqueue(packet);
  if (enqueued.status !== "ok")
    return unavailable(
      "SCE_FEEDBACK_OUTBOX_UNAVAILABLE",
      "Feedback outbox is unavailable.",
    );
  if (authority === undefined || !authorizes(packet, authority))
    return queued("SCE_FEEDBACK_QUEUED_AUTHORITY");
  return await executeFlush(
    outbox,
    packet.telemetry.fingerprint,
    authority,
    dependencies,
  );
}

async function flush(
  request: unknown,
  dependencies: FeedbackCliDependencies,
): Promise<FeedbackCliOutcome> {
  const source = exactObject(request, ["fingerprint", "authority"]);
  if (
    source === undefined ||
    typeof source.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.fingerprint)
  )
    return invalid(
      "SCE_INVALID_FEEDBACK_REQUEST",
      "Feedback request is invalid.",
    );
  const outbox = await openOutbox(dependencies);
  if (outbox === undefined)
    return unavailable(
      "SCE_FEEDBACK_OUTBOX_UNAVAILABLE",
      "Feedback outbox is unavailable.",
    );
  const loaded = outbox.read(source.fingerprint);
  if (loaded.status === "not_found")
    return invalid("SCE_FEEDBACK_NOT_FOUND", "Feedback packet is not queued.");
  if (loaded.status !== "ok")
    return unavailable(
      "SCE_FEEDBACK_OUTBOX_UNAVAILABLE",
      "Feedback outbox is unavailable.",
    );
  if (loaded.value.status === "submitted" && loaded.value.issue !== undefined)
    return {
      ok: true,
      result: { issue: loaded.value.issue, status: "existing" },
    };
  const authority = parseAuthority(source.authority);
  if (authority === undefined || !authorizes(loaded.value.packet, authority))
    return queued("SCE_FEEDBACK_QUEUED_AUTHORITY");
  return await executeFlush(
    outbox,
    source.fingerprint,
    authority,
    dependencies,
  );
}

async function executeFlush(
  outbox: FeedbackOutbox,
  fingerprint: string,
  authority: FeedbackAuthority,
  dependencies: FeedbackCliDependencies,
): Promise<FeedbackCliOutcome> {
  const transport =
    dependencies.transport ??
    new GhFeedbackTransport(
      dependencies.executor ?? processFeedbackCommandExecutor,
    );
  let result;
  try {
    result = await outbox.flush(fingerprint, authority, transport);
  } catch {
    return unavailable(
      "SCE_FEEDBACK_QUEUED_UNAVAILABLE",
      "Feedback remains queued.",
    );
  }
  if (result.status === "submitted" || result.status === "existing") {
    return {
      ok: true,
      result: { issue: publicIssue(result.issue), status: result.status },
    };
  }
  if (result.status === "unauthorized")
    return queued("SCE_FEEDBACK_QUEUED_AUTHORITY");
  if (result.status === "ambiguous")
    return unavailable(
      "SCE_FEEDBACK_QUEUED_UNAVAILABLE",
      "Feedback remains queued.",
    );
  return unavailable(
    "SCE_FEEDBACK_OUTBOX_UNAVAILABLE",
    "Feedback outbox is unavailable.",
  );
}

async function openOutbox(
  dependencies: FeedbackCliDependencies,
): Promise<FeedbackOutbox | undefined> {
  const common = await (
    dependencies.resolveCommonDirectory ??
    (() =>
      resolveGitCommonDirectory(
        dependencies.executor ?? processFeedbackCommandExecutor,
        dependencies.cwd,
      ))
  )().catch(() => undefined);
  if (common === undefined) return undefined;
  const opened = FeedbackOutbox.open(common, {
    recoverKilledLock: recoverKilledProcessLock,
  });
  return opened.status === "ok" ? opened.value : undefined;
}

function parseAuthority(value: unknown): FeedbackAuthority | undefined {
  const source = exactObject(value, [
    "schemaVersion",
    "operation",
    "source",
    "targetRepositoryId",
    "fingerprint",
    "previewHash",
    "operationNonce",
  ]);
  if (
    source === undefined ||
    source.schemaVersion !== 1 ||
    source.operation !== "create_issue" ||
    (source.source !== "current_user" &&
      source.source !== "policy_safe_telemetry") ||
    source.targetRepositoryId !== "R_kgDOUCvUmw" ||
    typeof source.fingerprint !== "string" ||
    typeof source.previewHash !== "string" ||
    typeof source.operationNonce !== "string"
  )
    return undefined;
  return source as unknown as FeedbackAuthority;
}

function exactObject(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => allowed.includes(key))
    ? record
    : undefined;
}

function publicIssue(issue: GitHubIssue): Record<string, unknown> {
  return { number: issue.number, url: issue.url };
}

function invalid(code: string, message: string): FeedbackCliOutcome {
  return { code, exitCode: 64, message, ok: false };
}

function queued(code: string): FeedbackCliOutcome {
  return {
    code,
    exitCode: 69,
    message: "Feedback remains durably queued.",
    ok: false,
  };
}

function unavailable(code: string, message: string): FeedbackCliOutcome {
  return { code, exitCode: 69, message, ok: false };
}
