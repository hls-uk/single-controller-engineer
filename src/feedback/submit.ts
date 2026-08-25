import type { FeedbackAuthority } from "./authority.js";
import { authorizes } from "./authority.js";
import {
  FIXED_TARGET_REPOSITORY_ID,
  type FeedbackPacket,
  validateFeedbackPacket,
} from "./packet.js";
import {
  GitHubDiscoverySchema,
  GitHubCreateRequestSchema,
  GitHubIssueSchema,
  isFeedbackSchema,
} from "./schemas.js";

export interface GitHubIssue {
  readonly repositoryId: typeof FIXED_TARGET_REPOSITORY_ID;
  readonly number: number;
  readonly url: string;
  readonly body: string;
  readonly open: boolean;
}

export interface GitHubDiscovery {
  readonly repositoryId: typeof FIXED_TARGET_REPOSITORY_ID;
  readonly paginationComplete: true;
  readonly issues: readonly GitHubIssue[];
}

/** Narrow injected seam. Raw transport bytes are validated before use. */
export interface FeedbackGitHubTransport {
  discoverExactMarker(
    target: FeedbackPacket["target"],
    marker: string,
  ): Promise<unknown>;
  createIssue(
    request: Readonly<{
      target: FeedbackPacket["target"];
      title: string;
      body: string;
    }>,
  ): Promise<unknown>;
}

export type SubmitResult =
  | Readonly<{ status: "submitted"; issue: GitHubIssue }>
  | Readonly<{ status: "existing"; issue: GitHubIssue }>
  | Readonly<{ status: "unauthorized" }>
  | Readonly<{
      status: "ambiguous";
      code: "GITHUB_UNAVAILABLE" | "GITHUB_REJECTED";
    }>;

export type DiscoveryResult =
  | Readonly<{ status: "existing"; issue: GitHubIssue }>
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "invalid" | "unavailable" }>;

function canonicalIssueUrl(number: number): string {
  return `https://github.com/hls-uk/single-controller-engineer/issues/${number}`;
}

function validIssue(
  packet: FeedbackPacket,
  value: unknown,
  exactBody: boolean,
): value is GitHubIssue {
  return (
    isFeedbackSchema<GitHubIssue>(GitHubIssueSchema, value) &&
    value.repositoryId === packet.target.repositoryId &&
    value.url === canonicalIssueUrl(value.number) &&
    (exactBody
      ? value.body === packet.body
      : value.body.includes(packet.marker))
  );
}

function exactMatches(
  packet: FeedbackPacket,
  issues: readonly GitHubIssue[],
): GitHubIssue[] {
  return issues
    .filter((issue) => issue.open && validIssue(packet, issue, false))
    .sort((left, right) => left.number - right.number);
}

/** Requires provider proof that every page was inspected before an absence acts. */
export async function discoverExisting(
  packet: unknown,
  transport: FeedbackGitHubTransport,
): Promise<DiscoveryResult> {
  const valid = validateFeedbackPacket(packet);
  if (valid === undefined) return { status: "invalid" };
  let raw: unknown;
  try {
    raw = await transport.discoverExactMarker(valid.target, valid.marker);
  } catch {
    return { status: "unavailable" };
  }
  if (!isFeedbackSchema<GitHubDiscovery>(GitHubDiscoverySchema, raw))
    return { status: "invalid" };
  if (raw.repositoryId !== valid.target.repositoryId)
    return { status: "invalid" };
  const matches = exactMatches(valid, raw.issues);
  return matches[0] === undefined
    ? { status: "absent" }
    : { status: "existing", issue: matches[0] };
}

export async function submitFeedback(
  packet: unknown,
  authority: unknown,
  transport: FeedbackGitHubTransport,
): Promise<SubmitResult> {
  const valid = validateFeedbackPacket(packet);
  if (valid === undefined)
    return { status: "ambiguous", code: "GITHUB_REJECTED" };
  if (!authorizes(valid, authority)) return { status: "unauthorized" };
  const discovery = await discoverExisting(valid, transport);
  if (discovery.status === "existing")
    return { status: "existing", issue: discovery.issue };
  if (discovery.status === "invalid")
    return { status: "ambiguous", code: "GITHUB_REJECTED" };
  if (discovery.status === "unavailable")
    return { status: "ambiguous", code: "GITHUB_UNAVAILABLE" };
  try {
    const request = {
      target: valid.target,
      title: valid.title,
      body: valid.body,
    };
    if (
      !isFeedbackSchema<{
        target: FeedbackPacket["target"];
        title: string;
        body: string;
      }>(GitHubCreateRequestSchema, request)
    )
      return { status: "ambiguous", code: "GITHUB_REJECTED" };
    const issue = await transport.createIssue(request);
    return validIssue(valid, issue, true)
      ? { status: "submitted", issue }
      : { status: "ambiguous", code: "GITHUB_REJECTED" };
  } catch (error) {
    return {
      status: "ambiguous",
      code:
        (error as { readonly code?: unknown }).code === "GITHUB_REJECTED"
          ? "GITHUB_REJECTED"
          : "GITHUB_UNAVAILABLE",
    };
  }
}

export interface DuplicateReconciliation {
  readonly canonical: GitHubIssue;
  readonly duplicates: readonly Readonly<{
    number: number;
    label: "duplicate";
    comment: string;
  }>[];
}

/** Target-workflow plan: deterministic, no fuzzy matching or client mutation. */
export function reconcileExactDuplicates(
  packet: FeedbackPacket,
  issues: readonly GitHubIssue[],
): DuplicateReconciliation | undefined {
  const matches = exactMatches(packet, issues);
  const canonical = matches[0];
  if (canonical === undefined) return undefined;
  return {
    canonical,
    duplicates: matches.slice(1).map((issue) => ({
      number: issue.number,
      label: "duplicate" as const,
      comment: `Duplicate feedback report; canonical issue: ${canonical.url}`,
    })),
  };
}
