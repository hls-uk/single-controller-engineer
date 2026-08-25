import { execFile } from "node:child_process";
import { constants, accessSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024;
const MAX_GIT_COMMON_DIR_BYTES = 4 * 1024;
const EXECUTABLE_CANDIDATES = {
  gh: ["/usr/bin/gh", "/usr/local/bin/gh", "/opt/homebrew/bin/gh"],
  git: ["/usr/bin/git"],
} as const;

export interface CommandExecution {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A deliberately narrow subprocess seam. Callers never receive raw failures. */
export interface FeedbackCommandExecutor {
  execute(
    file: string,
    args: readonly string[],
    options?: Readonly<{ cwd?: string }>,
  ): Promise<CommandExecution>;
}

export const processFeedbackCommandExecutor: FeedbackCommandExecutor = {
  async execute(file, args, options = {}) {
    const executable = productionExecutable(file);
    if (executable === undefined) return { code: 126, stderr: "", stdout: "" };
    try {
      const result = await executeFile(executable, [...args], {
        cwd: options.cwd,
        encoding: "utf8",
        env: feedbackEnvironment(file),
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        shell: false,
        timeout: 15_000,
        windowsHide: true,
      });
      return {
        code: 0,
        stderr: typeof result.stderr === "string" ? result.stderr : "",
        stdout: typeof result.stdout === "string" ? result.stdout : "",
      };
    } catch (error) {
      const failure = error as {
        readonly code?: unknown;
        readonly stderr?: unknown;
        readonly stdout?: unknown;
      };
      return {
        code: typeof failure.code === "number" ? failure.code : 1,
        stderr: boundedText(failure.stderr) ?? "",
        stdout: boundedText(failure.stdout) ?? "",
      };
    }
  },
};

function productionExecutable(file: string): string | undefined {
  if (file !== "git" && file !== "gh") return undefined;
  for (const candidate of EXECUTABLE_CANDIDATES[file]) {
    try {
      const real = realpathSync(candidate);
      const entry = lstatSync(real);
      accessSync(real, constants.X_OK);
      if (isAbsolute(real) && entry.isFile() && !entry.isSymbolicLink())
        return real;
    } catch {
      // A missing allowlisted executable is ordinary provider unavailability.
    }
  }
  return undefined;
}

function feedbackEnvironment(file: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GH_PROMPT_DISABLED: "1",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PATH: "/usr/bin:/bin",
    TZ: "UTC",
  };
  if (file !== "gh") return environment;
  // Only authentication/configuration inputs required by the fixed GitHub
  // transport cross the subprocess boundary. Repository and command identity
  // remain constants in the typed adapter.
  for (const key of [
    "GH_CONFIG_DIR",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "HOME",
    "XDG_CONFIG_HOME",
  ] as const) {
    const value = process.env[key];
    if (value !== undefined && !value.includes("\u0000"))
      environment[key] = value;
  }
  return environment;
}

/**
 * Resolves Git's shared metadata directory, not a worktree-local .git file.
 * Every provider submission is anchored here so linked worktrees share one
 * private durable outbox. Any ambiguity is refused.
 */
export async function resolveGitCommonDirectory(
  executor: FeedbackCommandExecutor,
  cwd = process.cwd(),
): Promise<string | undefined> {
  let result: CommandExecution;
  try {
    result = await executor.execute("git", ["rev-parse", "--git-common-dir"], {
      cwd,
    });
  } catch {
    return undefined;
  }
  if (result.code !== 0) return undefined;
  const output = boundedText(result.stdout, MAX_GIT_COMMON_DIR_BYTES);
  if (output === undefined) return undefined;
  const lines = output.split("\n");
  const candidate = lines[0];
  if (
    lines.length !== 2 ||
    lines[1] !== "" ||
    candidate === undefined ||
    candidate === ""
  )
    return undefined;
  if (
    candidate.includes("\u0000") ||
    candidate.includes("\r") ||
    candidate.includes("\n")
  )
    return undefined;
  try {
    const real = realpathSync(resolve(cwd, candidate));
    const entry = lstatSync(real);
    return entry.isDirectory() && !entry.isSymbolicLink() ? real : undefined;
  } catch {
    return undefined;
  }
}

function boundedText(
  value: unknown,
  limit = MAX_COMMAND_OUTPUT_BYTES,
): string | undefined {
  if (typeof value !== "string") return undefined;
  return new TextEncoder().encode(value).byteLength <= limit
    ? value
    : undefined;
}
