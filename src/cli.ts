#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  commandNames,
  feedbackActions,
  isCommandName,
  isFeedbackAction,
  MAX_CLI_REQUEST_BYTES,
  stateOnlyCommandRunner,
  validateCommandPayload,
  validateCommandRequest,
  validateCommandRunnerResult,
} from "./commands/index.js";
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
  "--expected-revision",
  "--help",
  "--idempotency-key",
  "--json",
  "--request",
]);

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
  readonly command?: CommandName;
  readonly ok: true;
  readonly result: JsonObject;
  readonly schema: typeof RESPONSE_SCHEMA;
  readonly version: typeof SCHEMA_VERSION;
}

export interface CliErrorResponse {
  readonly command?: CommandName;
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
  readonly runner?: CommandRunner;
  readonly version?: string;
}

type ParsedInvocation =
  | { readonly kind: "help"; readonly command?: CommandName }
  | { readonly kind: "version" }
  | { readonly kind: "command"; readonly request: CommandRequest };

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
  if (!isCommandName(first)) {
    throw new CliError("SCE_UNKNOWN_COMMAND", "Unknown command.");
  }

  return parseCommand(first, argv.slice(1));
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

  const feedbackAction = parsePositionals(command, positionals);
  const request: CommandRequest = {
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
  return { kind: "command", request };
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

    const runner = dependencies.runner ?? stateOnlyCommandRunner;
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

export async function main(
  argv: readonly string[],
  dependencies: CliDependencies = {},
  write: (value: string) => void = (value) => process.stdout.write(value),
): Promise<number> {
  const execution = await runCli(argv, dependencies);
  write(execution.stdout);
  return execution.exitCode;
}

function success(result: JsonObject, command?: CommandName): CliExecution {
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
  command?: CommandName,
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
  return { exitCode, response, stdout: `${canonicalJson(response)}\n` };
}

function helpResult(
  command: CommandName | undefined,
  version: string,
): JsonObject {
  if (command === undefined) {
    return {
      commands: [...commandNames],
      name: "sce",
      usage:
        "sce <command> [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]",
      version,
    };
  }
  return {
    ...(command === "feedback" ? { actions: [...feedbackActions] } : {}),
    command,
    usage:
      command === "feedback"
        ? "sce feedback <prepare|preview|submit|flush> [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]"
        : `sce ${command} [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]`,
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
