#!/usr/bin/env node

import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  commandNames,
  feedbackActions,
  isCommandName,
  isFeedbackAction,
  MAX_CLI_REQUEST_BYTES,
  MAX_CLI_RESPONSE_BYTES,
  stateOnlyCommandRunner,
  validateCommandPayload,
  validateCommandRequest,
  validateCommandRunnerResult,
} from "./commands/index.js";
import { createControllerConfigRunner } from "./controller-config.js";
import {
  runFeedbackCliAction,
  type FeedbackCliDependencies,
} from "./feedback/cli.js";
import { installSkills, uninstallSkills } from "./install/index.js";
import type {
  CommandName,
  CommandOptions,
  CommandRequest,
  CommandRunner,
  JsonObject,
} from "./commands/index.js";

export const CLI_VERSION = "0.1.0";
export const REQUEST_SCHEMA = "sce.command.request";
export const RESPONSE_SCHEMA = "sce.cli.response";
export const SCHEMA_VERSION = 1;

const EXIT_USAGE = 64;
const EXIT_UNAVAILABLE = 69;
const EXIT_SOFTWARE = 70;

const knownOptions = new Set([
  "--controller-config",
  "--expected-revision",
  "--help",
  "--idempotency-key",
  "--json",
  "--request",
]);
const installerOptions = new Set([
  "--host",
  "--destination",
  "--dry-run",
  "--help",
]);
const installerCommands = ["install-skill", "uninstall-skill"] as const;
type InstallerCommand = (typeof installerCommands)[number];
type CliCommandName = CommandName | InstallerCommand;
const cliCommandNames = [...commandNames, ...installerCommands] as const;

export class CliError extends Error {
  public readonly code: string;
  public readonly exitCode: number;

  public constructor(code: string, message: string, exitCode = EXIT_USAGE) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.name = "CliError";
  }
}

export interface CliSuccessResponse {
  readonly command?: CliCommandName;
  readonly ok: true;
  readonly result: JsonObject;
  readonly schema: typeof RESPONSE_SCHEMA;
  readonly version: typeof SCHEMA_VERSION;
}

export interface CliErrorResponse {
  readonly command?: CliCommandName;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly ok: false;
  readonly schema: typeof RESPONSE_SCHEMA;
  readonly version: typeof SCHEMA_VERSION;
}

export type CliResponse = CliErrorResponse | CliSuccessResponse;

export interface CliExecution {
  readonly exitCode: number;
  readonly response: CliResponse;
  readonly stdout: string;
}

export interface CliDependencies {
  /** Test/host seam for an explicit controller configuration. */
  readonly controllerConfigRunner?: (
    path: string,
  ) => Promise<CommandRunner | undefined>;
  readonly runner?: CommandRunner;
  /** Test/host seam for private feedback storage and provider execution. */
  readonly feedback?: FeedbackCliDependencies;
  /** Test-only explicit packaged skill source; never inferred from a user home. */
  readonly skillSource?: string;
  readonly version?: string;
}

type ParsedInvocation =
  | { readonly kind: "help"; readonly command?: CliCommandName }
  | { readonly kind: "version" }
  | {
      readonly controllerConfig?: string;
      readonly kind: "command";
      readonly request: CommandRequest;
    }
  | {
      readonly destination: string;
      readonly dryRun: boolean;
      /** An optional declaration of where the pair goes; absent means undeclared. */
      readonly host?: "claude" | "codex";
      readonly kind: "installer";
      readonly command: InstallerCommand;
    };

export function parseCliArguments(argv: readonly string[]): ParsedInvocation {
  if (argv.length === 0) {
    throw new CliError("SCE_MISSING_COMMAND", "A command is required.");
  }

  const first = argv[0];
  if (first === undefined) {
    throw new CliError("SCE_MISSING_COMMAND", "A command is required.");
  }
  if (first === "--help" || first === "-h") {
    if (argv.length !== 1) {
      throw new CliError(
        "SCE_UNEXPECTED_ARGUMENT",
        "--help does not accept arguments.",
      );
    }
    return { kind: "help" };
  }
  if (first === "--version" || first === "-V") {
    if (argv.length !== 1) {
      throw new CliError(
        "SCE_UNEXPECTED_ARGUMENT",
        "--version does not accept arguments.",
      );
    }
    return { kind: "version" };
  }
  if (first.startsWith("-")) {
    throw new CliError("SCE_UNKNOWN_OPTION", "Unknown option.");
  }
  if (isInstallerCommand(first))
    return parseInstallerCommand(first, argv.slice(1));
  if (!isCommandName(first)) {
    throw new CliError("SCE_UNKNOWN_COMMAND", "Unknown command.");
  }

  return parseCommand(first, argv.slice(1));
}

function isInstallerCommand(value: string): value is InstallerCommand {
  return installerCommands.includes(value as InstallerCommand);
}

function parseInstallerCommand(
  command: InstallerCommand,
  argv: readonly string[],
): ParsedInvocation {
  const values = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith("-"))
      throw new CliError("SCE_UNEXPECTED_ARGUMENT", "Unexpected argument.");
    const [option, inlineValue] = splitOption(
      token === "-h" ? "--help" : token,
    );
    if (!installerOptions.has(option))
      throw new CliError("SCE_UNKNOWN_OPTION", "Unknown option.");
    if (option === "--dry-run" || option === "--help") {
      if (inlineValue !== undefined)
        throw new CliError(
          "SCE_INVALID_OPTION_VALUE",
          `${option} does not accept a value.`,
        );
      setOption(values, option, true);
      continue;
    }
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value === "--" || value.startsWith("--"))
      throw new CliError(
        "SCE_MISSING_OPTION_VALUE",
        `${option} requires a value.`,
      );
    setOption(values, option, value);
  }
  if (values.has("--help")) {
    if (values.size !== 1)
      throw new CliError(
        "SCE_UNEXPECTED_ARGUMENT",
        "--help does not accept arguments.",
      );
    return { command, kind: "help" };
  }
  const host = optionValue(values, "--host");
  const destination = optionValue(values, "--destination");
  if (host !== undefined && host !== "codex" && host !== "claude")
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--host must be codex or claude.",
    );
  if (destination === undefined)
    throw new CliError(
      "SCE_MISSING_OPTION_VALUE",
      "--destination requires a value.",
    );
  if (command === "uninstall-skill" && values.has("--dry-run"))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--dry-run is only supported by install-skill.",
    );
  return {
    command,
    destination: parseDestination(destination),
    dryRun: values.has("--dry-run"),
    ...(host === undefined ? {} : { host }),
    kind: "installer",
  };
}

function parseCommand(
  command: CommandName,
  argv: readonly string[],
): ParsedInvocation {
  const positionals: string[] = [];
  const values = new Map<string, string | true>();
  let optionsEnded = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && token.startsWith("-")) {
      const [option, inlineValue] = splitOption(token);
      if (option === "-h") {
        setOption(values, "--help", true);
        continue;
      }
      if (!knownOptions.has(option)) {
        throw new CliError("SCE_UNKNOWN_OPTION", "Unknown option.");
      }
      if (option === "--json" || option === "--help") {
        if (inlineValue !== undefined) {
          throw new CliError(
            "SCE_INVALID_OPTION_VALUE",
            `${option} does not accept a value.`,
          );
        }
        setOption(values, option, true);
        continue;
      }

      const value = inlineValue ?? argv[++index];
      if (value === undefined || value === "--" || value.startsWith("--")) {
        throw new CliError(
          "SCE_MISSING_OPTION_VALUE",
          `${option} requires a value.`,
        );
      }
      setOption(values, option, value);
      continue;
    }
    positionals.push(token);
  }

  if (values.has("--help")) {
    if (positionals.length > 0) {
      throw new CliError(
        "SCE_UNEXPECTED_ARGUMENT",
        "--help does not accept arguments.",
      );
    }
    return { command, kind: "help" };
  }

  if (
    command === "feedback" &&
    (values.has("--controller-config") ||
      values.has("--expected-revision") ||
      values.has("--idempotency-key") ||
      values.has("--json"))
  )
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "This feedback action accepts only --request.",
    );

  const feedbackAction = parsePositionals(command, positionals);
  const request: unknown = {
    command,
    ...(feedbackAction === undefined ? {} : { feedbackAction }),
    options: parseOptions(values),
    schema: REQUEST_SCHEMA,
    version: SCHEMA_VERSION,
  };
  if (!validateCommandRequest(request))
    throw new CliError(
      "SCE_INVALID_REQUEST",
      "The command request is invalid.",
    );
  const controllerConfig = optionValue(values, "--controller-config");
  return {
    ...(controllerConfig === undefined
      ? {}
      : { controllerConfig: parseControllerConfigPath(controllerConfig) }),
    kind: "command",
    request,
  };
}

function splitOption(token: string): readonly [string, string | undefined] {
  const equalsIndex = token.indexOf("=");
  return equalsIndex === -1
    ? [token, undefined]
    : [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
}

function setOption(
  values: Map<string, string | true>,
  option: string,
  value: string | true,
): void {
  if (values.has(option)) {
    throw new CliError(
      "SCE_DUPLICATE_OPTION",
      `Option may be specified once: ${option}`,
    );
  }
  values.set(option, value);
}

function parsePositionals(
  command: CommandName,
  positionals: readonly string[],
) {
  if (command !== "feedback") {
    if (positionals.length > 0) {
      throw new CliError("SCE_UNEXPECTED_ARGUMENT", "Unexpected argument.");
    }
    return undefined;
  }
  if (positionals.length === 0) {
    throw new CliError(
      "SCE_MISSING_ARGUMENT",
      "feedback requires one action: prepare, preview, submit, or flush.",
    );
  }
  if (positionals.length > 1) {
    throw new CliError("SCE_UNEXPECTED_ARGUMENT", "Unexpected argument.");
  }
  const action = positionals[0];
  if (action === undefined || !isFeedbackAction(action)) {
    throw new CliError("SCE_INVALID_ARGUMENT", "Unknown feedback action.");
  }
  return action;
}

function parseOptions(
  values: ReadonlyMap<string, string | true>,
): CommandOptions {
  const expectedRevision = optionValue(values, "--expected-revision");
  const idempotencyKey = optionValue(values, "--idempotency-key");
  const request = optionValue(values, "--request");
  return {
    ...(expectedRevision === undefined
      ? {}
      : { expectedRevision: parseExpectedRevision(expectedRevision) }),
    ...(idempotencyKey === undefined
      ? {}
      : { idempotencyKey: parseNonEmpty(idempotencyKey, "--idempotency-key") }),
    json: values.has("--json"),
    ...(request === undefined ? {} : { request: parseRequest(request) }),
  };
}

function parseControllerConfigPath(value: string): string {
  if (!isAbsolute(value) || value.length > 4_096 || value.includes("\u0000"))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--controller-config must be an absolute path.",
    );
  const path = normalize(resolve(value));
  if (path === "/")
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--controller-config must be an absolute path.",
    );
  return path;
}

function parseDestination(value: string): string {
  if (!isAbsolute(value) || value.length > 4_096 || value.includes("\u0000"))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--destination must be an absolute non-root path.",
    );
  const destination = normalize(resolve(value));
  if (destination === "/")
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--destination must be an absolute non-root path.",
    );
  return destination;
}

function optionValue(
  values: ReadonlyMap<string, string | true>,
  option: string,
) {
  const value = values.get(option);
  return typeof value === "string" ? value : undefined;
}

function parseExpectedRevision(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--expected-revision must be a non-negative integer.",
    );
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--expected-revision must be a safe integer.",
    );
  }
  return revision;
}

function parseNonEmpty(value: string, option: string): string {
  if (value.length === 0) {
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      `${option} must not be empty.`,
    );
  }
  return value;
}

function parseRequest(value: string): JsonObject {
  if (new TextEncoder().encode(value).byteLength > MAX_CLI_REQUEST_BYTES)
    throw new CliError(
      "SCE_REQUEST_TOO_LARGE",
      "--request exceeds the 128 KiB limit.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new CliError("SCE_INVALID_JSON", "--request must be valid JSON.");
  }
  if (!validateCommandPayload(parsed))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--request must be a bounded JSON object.",
    );
  return parsed;
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<CliExecution> {
  try {
    const invocation = parseCliArguments(argv);
    if (invocation.kind === "help") {
      return success(
        helpResult(invocation.command, dependencies.version ?? CLI_VERSION),
      );
    }
    if (invocation.kind === "version") {
      return success({ version: dependencies.version ?? CLI_VERSION });
    }
    if (invocation.kind === "installer") {
      return await runInstaller(invocation, dependencies);
    }
    if (invocation.request.command === "feedback") {
      const feedback = await runFeedbackCliAction(
        invocation.request.feedbackAction,
        invocation.request.options.request,
        dependencies.feedback,
      );
      return feedback.ok
        ? success(feedback.result as JsonObject, "feedback")
        : failure(
            feedback.code,
            feedback.message,
            feedback.exitCode,
            "feedback",
          );
    }

    const runner =
      invocation.controllerConfig === undefined
        ? (dependencies.runner ?? stateOnlyCommandRunner)
        : await (
            dependencies.controllerConfigRunner ?? createControllerConfigRunner
          )(invocation.controllerConfig);
    if (runner === undefined)
      return failure(
        "SCE_CONTROLLER_CONFIG_UNAVAILABLE",
        "The explicit controller configuration is unavailable.",
        EXIT_UNAVAILABLE,
        invocation.request.command,
      );
    let outcome;
    try {
      outcome = await runner(invocation.request);
    } catch {
      return failure(
        "SCE_RUNNER_FAILURE",
        "The command runner failed without a usable response.",
        EXIT_SOFTWARE,
        invocation.request.command,
      );
    }
    if (!validateCommandRunnerResult(outcome)) {
      return failure(
        "SCE_INVALID_RUNNER_RESULT",
        "The command runner returned an invalid result.",
        EXIT_SOFTWARE,
        invocation.request.command,
      );
    }
    if (outcome.status === "unavailable") {
      return failure(
        "SCE_COMMAND_UNAVAILABLE",
        `The ${invocation.request.command} command is unavailable.`,
        EXIT_UNAVAILABLE,
        invocation.request.command,
      );
    }
    if (outcome.status === "invalid") {
      return failure(
        outcome.code,
        "The request does not contain a valid repository run.",
        EXIT_USAGE,
        invocation.request.command,
      );
    }
    if (outcome.status === "blocked") {
      return failure(
        outcome.code,
        `The ${invocation.request.command} command is blocked pending authoritative recovery.`,
        EXIT_UNAVAILABLE,
        invocation.request.command,
      );
    }
    return success(outcome.result, invocation.request.command);
  } catch (error) {
    if (error instanceof CliError) {
      return failure(error.code, error.message, error.exitCode);
    }
    return failure(
      "SCE_INTERNAL_ERROR",
      "The CLI failed unexpectedly.",
      EXIT_SOFTWARE,
    );
  }
}

async function runInstaller(
  invocation: Extract<ParsedInvocation, { readonly kind: "installer" }>,
  dependencies: CliDependencies,
): Promise<CliExecution> {
  try {
    const source = dependencies.skillSource ?? resolvePackagedSkillSource();
    /** An undeclared host is reported by omission, never as a null or empty value. */
    const declaredHost =
      invocation.host === undefined ? {} : { host: invocation.host };
    if (invocation.command === "install-skill") {
      const result = await installSkills({
        destination: invocation.destination,
        dryRun: invocation.dryRun,
        source,
      });
      return success(
        {
          ...declaredHost,
          manifest: result.manifest,
          status: result.status,
        } as JsonObject,
        invocation.command,
      );
    }
    await uninstallSkills(invocation.destination);
    return success(
      { ...declaredHost, status: "uninstalled" },
      invocation.command,
    );
  } catch {
    return failure(
      "SCE_SKILL_INSTALL_FAILED",
      "The packaged skill operation could not be completed.",
      EXIT_UNAVAILABLE,
      invocation.command,
    );
  }
}

/** Source and bundled binaries use only a sibling package asset, never a home path. */
export function resolvePackagedSkillSource(
  moduleUrl = import.meta.url,
): string {
  const modulePath = fileURLToPath(moduleUrl);
  const moduleDirectory = dirname(modulePath);
  const packageRoot =
    basename(moduleDirectory) === "src"
      ? resolve(moduleDirectory, "..")
      : resolve(moduleDirectory, "../../..");
  return join(packageRoot, "skills");
}

export async function main(
  argv: readonly string[],
  dependencies: CliDependencies = {},
  write: (value: string) => void = (value) => process.stdout.write(value),
): Promise<number> {
  const execution = await runCli(argv, dependencies);
  write(execution.stdout);
  return execution.exitCode;
}

function success(result: JsonObject, command?: CliCommandName): CliExecution {
  return execution(
    {
      ...(command === undefined ? {} : { command }),
      ok: true,
      result,
      schema: RESPONSE_SCHEMA,
      version: SCHEMA_VERSION,
    },
    0,
  );
}

function failure(
  code: string,
  message: string,
  exitCode: number,
  command?: CliCommandName,
): CliExecution {
  return execution(
    {
      ...(command === undefined ? {} : { command }),
      error: { code, message },
      ok: false,
      schema: RESPONSE_SCHEMA,
      version: SCHEMA_VERSION,
    },
    exitCode,
  );
}

function execution(response: CliResponse, exitCode: number): CliExecution {
  const stdout = `${canonicalJson(response)}\n`;
  if (new TextEncoder().encode(stdout).byteLength <= MAX_CLI_RESPONSE_BYTES)
    return { exitCode, response, stdout };

  const boundedResponse: CliErrorResponse = {
    error: {
      code: "SCE_RESULT_TOO_LARGE",
      message: "The command result exceeds the 128 KiB limit.",
    },
    ok: false,
    schema: RESPONSE_SCHEMA,
    version: SCHEMA_VERSION,
  };
  return {
    exitCode: EXIT_SOFTWARE,
    response: boundedResponse,
    stdout: `${canonicalJson(boundedResponse)}\n`,
  };
}

function helpResult(
  command: CliCommandName | undefined,
  version: string,
): JsonObject {
  if (command === undefined) {
    return {
      commands: [...cliCommandNames],
      name: "sce",
      usage:
        "sce <command> [--controller-config <absolute path>] [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]",
      version,
    };
  }
  return {
    ...(command === "feedback" ? { actions: [...feedbackActions] } : {}),
    command,
    usage:
      command === "feedback"
        ? "sce feedback <prepare|preview|submit|flush> --request <json>"
        : command === "install-skill"
          ? "sce install-skill [--host <codex|claude>] --destination <absolute path> [--dry-run]"
          : command === "uninstall-skill"
            ? "sce uninstall-skill [--host <codex|claude>] --destination <absolute path>"
            : `sce ${command} [--controller-config <absolute path>] [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]`,
  };
}

/** Emits recursively key-sorted JSON so response bytes are repeatable. */
export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON numbers must be finite.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new TypeError("Value is not JSON serializable.");
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(entrypoint)).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  void main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
