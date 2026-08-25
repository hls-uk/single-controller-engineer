import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FIXED_TARGET_NAME,
  FIXED_TARGET_REPOSITORY_ID,
  type FeedbackPacket,
} from "./packet.js";
import type {
  FeedbackGitHubTransport,
  GitHubDiscovery,
  GitHubIssue,
} from "./submit.js";
import type { FeedbackCommandExecutor } from "./runtime.js";

const MAX_PROVIDER_OUTPUT_BYTES = 128 * 1024;
const PAGE_SIZE = 100;
const MAX_ISSUES = 10_000;

const discoveryQuery = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){id issues(first:${PAGE_SIZE},after:$cursor,states:OPEN){nodes{number url body state} pageInfo{hasNextPage endCursor}}}}`;
const repositoryIdentityQuery =
  "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id}}";
/**
 * Optional production transport. It uses fixed repository arguments, a body
 * file rather than a shell string, readback after creation, and never exposes
 * provider output to public CLI responses.
 */
export class GhFeedbackTransport implements FeedbackGitHubTransport {
  public constructor(private readonly executor: FeedbackCommandExecutor) {}

  async discoverExactMarker(
    target: FeedbackPacket["target"],
    _marker: string,
  ): Promise<unknown> {
    if (
      target.repository !== FIXED_TARGET_NAME ||
      target.repositoryId !== FIXED_TARGET_REPOSITORY_ID
    )
      throw unavailable();
    const issues: GitHubIssue[] = [];
    let cursor: string | null = null;
    while (true) {
      const response = await this.graphql(discoveryQuery, cursor);
      const page = parseIssuePage(response);
      if (page === undefined) throw unavailable();
      issues.push(...page.issues);
      if (issues.length > MAX_ISSUES) throw unavailable();
      if (!page.hasNextPage) break;
      if (page.endCursor === null || page.endCursor.length === 0)
        throw unavailable();
      cursor = page.endCursor;
    }
    const discovery: GitHubDiscovery = {
      repositoryId: FIXED_TARGET_REPOSITORY_ID,
      paginationComplete: true,
      issues,
    };
    return discovery;
  }

  async createIssue(
    request: Readonly<{
      target: FeedbackPacket["target"];
      title: string;
      body: string;
    }>,
  ): Promise<unknown> {
    if (
      request.target.repository !== FIXED_TARGET_NAME ||
      request.target.repositoryId !== FIXED_TARGET_REPOSITORY_ID
    )
      throw rejected();
    const directory = await mkdtemp(join(tmpdir(), "sce-feedback-gh-"));
    const bodyFile = join(directory, "body.md");
    try {
      await writeFile(bodyFile, request.body, {
        encoding: "utf8",
        mode: 0o600,
      });
      // Discovery is only an existence hint. Re-bind the name to the immutable
      // target immediately before the irreversible provider mutation.
      if (!(await this.hasFixedRepositoryIdentity())) throw rejected();
      const created = await this.invoke("gh", [
        "issue",
        "create",
        "--repo",
        FIXED_TARGET_NAME,
        "--title",
        request.title,
        "--body-file",
        bodyFile,
      ]);
      if (created === undefined) throw unavailable();
      const number = issueNumber(created);
      if (number === undefined) throw rejected();
      const readback = await this.invoke("gh", [
        "issue",
        "view",
        String(number),
        "--repo",
        FIXED_TARGET_NAME,
        "--json",
        "number,url,body,state",
      ]);
      const issue =
        readback === undefined ? undefined : parseReadback(readback);
      if (issue === undefined) throw rejected();
      // Name ownership can change during the create/readback interval too.
      // Do not acknowledge a submission unless the immutable target still
      // resolves exactly after the provider has returned the issue body.
      if (!(await this.hasFixedRepositoryIdentity())) throw rejected();
      return issue;
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }

  private async graphql(
    query: string,
    cursor: string | null,
  ): Promise<unknown> {
    const result = await this.invoke("gh", [
      "api",
      "graphql",
      "--raw-field",
      `query=${query}`,
      "--raw-field",
      "owner=hls-uk",
      "--raw-field",
      "name=single-controller-engineer",
      ...(cursor === null ? [] : ["--raw-field", `cursor=${cursor}`]),
    ]);
    if (result === undefined) throw unavailable();
    return parseJson(result);
  }

  private async hasFixedRepositoryIdentity(): Promise<boolean> {
    const response = await this.graphql(repositoryIdentityQuery, null);
    const repository = nested(response, ["data", "repository"]);
    const candidate = record(repository);
    return (
      candidate !== undefined &&
      exactKeys(candidate, ["id"]) &&
      candidate.id === FIXED_TARGET_REPOSITORY_ID
    );
  }

  private async invoke(
    file: string,
    args: readonly string[],
  ): Promise<string | undefined> {
    try {
      const result = await this.executor.execute(file, args);
      if (result.code !== 0 || !bounded(result.stdout)) return undefined;
      return result.stdout;
    } catch {
      return undefined;
    }
  }
}

function parseIssuePage(value: unknown):
  | Readonly<{
      endCursor: string | null;
      hasNextPage: boolean;
      issues: readonly GitHubIssue[];
    }>
  | undefined {
  const repository = nested(value, ["data", "repository"]);
  const issues = nested(repository, ["issues"]);
  if (record(repository)?.id !== FIXED_TARGET_REPOSITORY_ID || !record(issues))
    return undefined;
  const nodes = record(issues)?.nodes;
  const pageInfo = record(issues)?.pageInfo;
  if (!Array.isArray(nodes) || !record(pageInfo)) return undefined;
  const parsed = nodes.map(parseIssue);
  if (parsed.some((issue) => issue === undefined)) return undefined;
  const hasNextPage = record(pageInfo)?.hasNextPage;
  const endCursor = record(pageInfo)?.endCursor;
  if (
    typeof hasNextPage !== "boolean" ||
    (endCursor !== null && typeof endCursor !== "string")
  )
    return undefined;
  return {
    endCursor,
    hasNextPage,
    issues: parsed as readonly GitHubIssue[],
  };
}

function parseReadback(value: string): GitHubIssue | undefined {
  return parseIssue(parseJson(value));
}

function parseIssue(value: unknown): GitHubIssue | undefined {
  const candidate = record(value);
  if (
    candidate === undefined ||
    !exactKeys(candidate, ["number", "url", "body", "state"]) ||
    !Number.isSafeInteger(candidate.number) ||
    (candidate.number as number) < 1 ||
    typeof candidate.url !== "string" ||
    typeof candidate.body !== "string" ||
    (candidate.state !== "OPEN" && candidate.state !== "CLOSED")
  )
    return undefined;
  const number = candidate.number as number;
  const url = `https://github.com/${FIXED_TARGET_NAME}/issues/${number}`;
  if (candidate.url !== url) return undefined;
  return {
    repositoryId: FIXED_TARGET_REPOSITORY_ID,
    number,
    url,
    body: candidate.body,
    open: candidate.state === "OPEN",
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function issueNumber(value: string): number | undefined {
  const match =
    /^https:\/\/github\.com\/hls-uk\/single-controller-engineer\/issues\/([1-9][0-9]*)\s*$/u.exec(
      value,
    );
  if (!match?.[1]) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nested(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    const next = record(current);
    if (next === undefined) return undefined;
    current = next[key];
  }
  return current;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function bounded(value: string): boolean {
  return (
    new TextEncoder().encode(value).byteLength <= MAX_PROVIDER_OUTPUT_BYTES
  );
}

function unavailable(): Error & { code: "GITHUB_UNAVAILABLE" } {
  return Object.assign(new Error("provider unavailable"), {
    code: "GITHUB_UNAVAILABLE" as const,
  });
}

function rejected(): Error & { code: "GITHUB_REJECTED" } {
  return Object.assign(new Error("provider rejected"), {
    code: "GITHUB_REJECTED" as const,
  });
}
