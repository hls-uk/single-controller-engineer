#!/usr/bin/env node

import { constants, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
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
  isStateCommandName,
  MAX_CLI_REQUEST_BYTES,
  MAX_CLI_RESPONSE_BYTES,
  stateOnlyCommandRunner,
  validateCommandPayload,
  validateCommandRequest,
  validateCommandRunnerResult,
} from "./commands/index.js";
import { MAX_CANDIDATE_DIFF_BYTES } from "./commands/candidate-digest.js";
import { createControllerConfigRunner } from "./controller-config.js";
import {
  runFeedbackCliAction,
  type FeedbackCliDependencies,
} from "./feedback/cli.js";
import { installSkills, uninstallSkills } from "./install/index.js";
import {
  bindSlotScope,
  composeControllerConfig,
  harnessFamilies,
  inspectDoltSync,
  inspectSlotScope,
  observeRepository,
  pushDoltData,
  writeComposedConfig,
  type ComposeOptions,
  type ComposedTopology,
  type HarnessFamily,
} from "./compose/index.js";
import type {
  CommandName,
  CommandOptions,
  CommandRequest,
  CommandRunner,
  JsonObject,
} from "./commands/index.js";
import type { StoreFailureTail } from "./fencing/index.js";

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
const composeCommand = "compose-config" as const;
type ComposeCommand = typeof composeCommand;
const composeValueOptions = new Set([
  "--authority",
  "--bd-executable",
  "--beads-mode",
  "--branch",
  "--controller-model",
  "--cwd",
  "--dolt-executable",
  "--frontier-model",
  "--harness",
  "--output",
  "--root-bead",
  "--workhorse-model",
]);
const composeFlagOptions = new Set([
  "--bind-slot",
  "--help",
  "--json",
  "--knowledge",
  "--no-knowledge",
  "--overwrite",
]);
const candidateDigestCommand = "candidate-digest" as const;
const candidateDigestValueOptions = new Set(["--file"]);
const candidateDigestFlagOptions = new Set(["--help", "--json", "--raw"]);
const authorityProfiles = [
  "local-change-only",
  "push-branch",
  "open-pr",
  "integrate",
] as const;
type CliCommandName = CommandName | InstallerCommand | ComposeCommand;
const cliCommandNames = [
  ...commandNames,
  ...installerCommands,
  composeCommand,
] as const;

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
  /** Test/host seam for the reproduced diff bytes on standard input. */
  readonly standardInput?: () => Promise<Uint8Array>;
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
    }
  | {
      readonly file?: string;
      readonly json: boolean;
      readonly kind: "candidate-digest";
      readonly raw: boolean;
    }
  | {
      readonly bdExecutable?: string;
      readonly bindSlot: boolean;
      readonly compose: ComposeOptions;
      readonly cwd: string;
      readonly doltExecutable?: string;
      readonly kind: "compose";
      readonly output: string;
      readonly overwrite: boolean;
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
  if (first === composeCommand) return parseComposeCommand(argv.slice(1));
  if (first === candidateDigestCommand)
    return parseCandidateDigestCommand(argv.slice(1));
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

function parseComposeCommand(argv: readonly string[]): ParsedInvocation {
  const values = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith("-"))
      throw new CliError("SCE_UNEXPECTED_ARGUMENT", "Unexpected argument.");
    const [option, inlineValue] = splitOption(
      token === "-h" ? "--help" : token,
    );
    if (composeFlagOptions.has(option)) {
      if (inlineValue !== undefined)
        throw new CliError(
          "SCE_INVALID_OPTION_VALUE",
          `${option} does not accept a value.`,
        );
      setOption(values, option, true);
      continue;
    }
    if (!composeValueOptions.has(option))
      throw new CliError("SCE_UNKNOWN_OPTION", "Unknown option.");
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
    return { command: composeCommand, kind: "help" };
  }
  const harness = optionValue(values, "--harness");
  const rootBeadId = optionValue(values, "--root-bead");
  const output = optionValue(values, "--output");
  if (harness === undefined || !isHarnessFamily(harness))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      `--harness must be one of: ${harnessFamilies.join(", ")}.`,
    );
  if (rootBeadId === undefined)
    throw new CliError(
      "SCE_MISSING_OPTION_VALUE",
      "--root-bead requires the epic issue id the run is created beneath.",
    );
  if (output === undefined)
    throw new CliError(
      "SCE_MISSING_OPTION_VALUE",
      "--output requires an absolute file path for the composed configuration.",
    );
  if (values.has("--knowledge") && values.has("--no-knowledge"))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--knowledge and --no-knowledge are mutually exclusive.",
    );
  const authority = optionValue(values, "--authority");
  if (
    authority !== undefined &&
    !(authorityProfiles as readonly string[]).includes(authority)
  )
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      `--authority must be one of: ${authorityProfiles.join(", ")}.`,
    );
  const beadsMode = optionValue(values, "--beads-mode");
  if (
    beadsMode !== undefined &&
    beadsMode !== "local-only" &&
    beadsMode !== "git-sync"
  )
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      "--beads-mode must be local-only or git-sync.",
    );
  const cwd = optionValue(values, "--cwd");
  const branch = optionValue(values, "--branch");
  const controller = optionValue(values, "--controller-model");
  const frontier = optionValue(values, "--frontier-model");
  const workhorse = optionValue(values, "--workhorse-model");
  const bdExecutable = optionValue(values, "--bd-executable");
  const doltExecutable = optionValue(values, "--dolt-executable");
  for (const [option, value] of [
    ["--bd-executable", bdExecutable],
    ["--dolt-executable", doltExecutable],
  ] as const)
    if (value !== undefined && !isAbsolute(value))
      throw new CliError(
        "SCE_INVALID_OPTION_VALUE",
        `${option} must be an absolute path.`,
      );
  return {
    ...(bdExecutable === undefined ? {} : { bdExecutable }),
    bindSlot: values.has("--bind-slot"),
    compose: {
      ...(authority === undefined
        ? {}
        : {
            authorityProfile: authority as NonNullable<
              ComposeOptions["authorityProfile"]
            >,
          }),
      ...(beadsMode === undefined ? {} : { beadsMode }),
      harnessFamily: harness,
      ...(branch === undefined ? {} : { integrationBranch: branch }),
      ...(values.has("--knowledge")
        ? { knowledge: true }
        : values.has("--no-knowledge")
          ? { knowledge: false }
          : {}),
      ...(controller === undefined &&
      frontier === undefined &&
      workhorse === undefined
        ? {}
        : {
            models: {
              ...(controller === undefined ? {} : { controller }),
              ...(frontier === undefined ? {} : { frontier }),
              ...(workhorse === undefined ? {} : { workhorse }),
            },
          }),
      rootBeadId,
    },
    cwd: cwd === undefined ? process.cwd() : parseAbsolutePath(cwd, "--cwd"),
    ...(doltExecutable === undefined ? {} : { doltExecutable }),
    kind: "compose",
    output: parseAbsolutePath(output, "--output"),
    overwrite: values.has("--overwrite"),
  };
}

/**
 * The digest command reads diff bytes, never a JSON envelope, so it parses its
 * own bounded option surface instead of the shared request options.
 */
function parseCandidateDigestCommand(
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
    if (candidateDigestFlagOptions.has(option)) {
      if (inlineValue !== undefined)
        throw new CliError(
          "SCE_INVALID_OPTION_VALUE",
          `${option} does not accept a value.`,
        );
      setOption(values, option, true);
      continue;
    }
    if (!candidateDigestValueOptions.has(option))
      throw new CliError("SCE_UNKNOWN_OPTION", "Unknown option.");
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
    return { command: candidateDigestCommand, kind: "help" };
  }
  const file = optionValue(values, "--file");
  return {
    ...(file === undefined ? {} : { file: parseAbsolutePath(file, "--file") }),
    json: values.has("--json"),
    kind: candidateDigestCommand,
    raw: values.has("--raw"),
  };
}

function isHarnessFamily(value: string): value is HarnessFamily {
  return (harnessFamilies as readonly string[]).includes(value);
}

function parseAbsolutePath(value: string, option: string): string {
  if (!isAbsolute(value) || value.length > 4_096 || value.includes("\u0000"))
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      `${option} must be an absolute non-root path.`,
    );
  const path = normalize(resolve(value));
  if (path === "/")
    throw new CliError(
      "SCE_INVALID_OPTION_VALUE",
      `${option} must be an absolute non-root path.`,
    );
  return path;
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
    throw new CliError("SCE_INVALID_REQUEST", malformedRequestMessage(command));
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

/**
 * A rejected request carries only its code, so both refusal seams name the
 * exact payload the invoked command reads: the harness packet request, the
 * run envelope an explicit invocation supplies, or the authoritative store a
 * --controller-config invocation reads its run from.
 */
function malformedRequestMessage(command: CommandName): string {
  if (command === "harness-packet")
    return "The harness-packet request is invalid: --request must be a complete sce.harness-packet payload (unitId, role, baseOid, acceptance, mandatoryVerification, ownedPaths, plus the reviewer fields when role is reviewer).";
  if (isStateCommandName(command))
    return `The ${command} request is invalid: --request must be '{"run":{...}}' with a valid repository run envelope, or be omitted when --controller-config supplies the run.`;
  return "The command request is invalid.";
}

function refusedRequestMessage(
  command: CommandName,
  controllerConfig: boolean,
): string {
  if (command === "harness-packet")
    return "The harness-packet request is not a usable launch packet: --request must carry a valid sce.harness-packet payload within the bounded launch size.";
  if (!isStateCommandName(command))
    return "The request does not contain a valid repository run.";
  return controllerConfig
    ? `The ${command} command reads its repository run from the --controller-config authoritative store, which did not supply a valid run; an explicit --request '{"run":{...}}' envelope is read only without --controller-config.`
    : `The ${command} command needs a repository run: pass --request '{"run":{...}}' with the run envelope, or --controller-config <absolute path> to read the run from its authoritative store.`;
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
    if (invocation.kind === "compose") return await runCompose(invocation);
    if (invocation.kind === candidateDigestCommand)
      return await runCandidateDigest(invocation, dependencies);
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
        withCause(
          `The ${invocation.request.command} command is unavailable`,
          outcome.stderrTail,
        ),
        EXIT_UNAVAILABLE,
        invocation.request.command,
      );
    }
    if (outcome.status === "invalid") {
      return failure(
        outcome.code,
        refusedRequestMessage(
          invocation.request.command,
          invocation.controllerConfig !== undefined,
        ),
        EXIT_USAGE,
        invocation.request.command,
      );
    }
    if (outcome.status === "blocked") {
      return failure(
        outcome.code,
        withCause(
          `The ${invocation.request.command} command is blocked pending authoritative recovery`,
          outcome.stderrTail,
        ),
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

/**
 * Derives the protocol's domain-separated candidate digest from the exact bytes
 * the reviewer packet's canonical Git command prints, so nobody has to read
 * `deriveCandidateDiffHash` to learn that a plain SHA-256 of those bytes is a
 * different digest. Reading is the only effect: no repository state is touched.
 */
async function runCandidateDigest(
  invocation: Extract<ParsedInvocation, { readonly kind: "candidate-digest" }>,
  dependencies: CliDependencies,
): Promise<CliExecution> {
  const read = await readCandidateDiff(invocation, dependencies);
  if (!read.ok)
    return failure(
      read.code,
      read.message,
      read.exitCode,
      candidateDigestCommand,
    );
  const request: unknown = {
    command: candidateDigestCommand,
    options: {
      json: invocation.json,
      request: {
        diff: read.diff,
        ...(invocation.raw ? { raw: true } : {}),
      },
    },
    schema: REQUEST_SCHEMA,
    version: SCHEMA_VERSION,
  };
  if (!validateCommandRequest(request))
    return failure(
      "SCE_CANDIDATE_DIFF_INVALID",
      `The reproduced diff is not bytes the candidate collector could have observed: it must be non-empty, free of NUL bytes, and at most ${MAX_CANDIDATE_DIFF_BYTES} bytes.`,
      EXIT_USAGE,
      candidateDigestCommand,
    );
  const runner = dependencies.runner ?? stateOnlyCommandRunner;
  let outcome;
  try {
    outcome = await runner(request);
  } catch {
    return failure(
      "SCE_RUNNER_FAILURE",
      "The command runner failed without a usable response.",
      EXIT_SOFTWARE,
      candidateDigestCommand,
    );
  }
  if (!validateCommandRunnerResult(outcome))
    return failure(
      "SCE_INVALID_RUNNER_RESULT",
      "The command runner returned an invalid result.",
      EXIT_SOFTWARE,
      candidateDigestCommand,
    );
  if (outcome.status === "ok")
    return success(outcome.result, candidateDigestCommand);
  return failure(
    "SCE_COMMAND_UNAVAILABLE",
    "The candidate-digest command is unavailable.",
    EXIT_UNAVAILABLE,
    candidateDigestCommand,
  );
}

/**
 * Accepts only bytes the collector itself would have hashed. Invalid UTF-8 is
 * refused rather than decoded with replacement characters, which would silently
 * produce a digest no packet can ever match, and a leading byte-order mark is
 * dropped exactly as the collector's decoder drops it rather than hashed as
 * content, which would mismatch by three invisible bytes.
 */
async function readCandidateDiff(
  invocation: Extract<ParsedInvocation, { readonly kind: "candidate-digest" }>,
  dependencies: CliDependencies,
): Promise<
  | Readonly<{ diff: string; ok: true }>
  | Readonly<{ code: string; exitCode: number; message: string; ok: false }>
> {
  let bytes: Uint8Array;
  try {
    bytes =
      invocation.file !== undefined
        ? await readCandidateDiffFile(invocation.file)
        : dependencies.standardInput !== undefined
          ? await dependencies.standardInput()
          : await readProcessStandardInput();
  } catch (error) {
    if (error instanceof CliError)
      return {
        code: error.code,
        exitCode: error.exitCode,
        message: error.message,
        ok: false,
      };
    return {
      code: "SCE_CANDIDATE_DIFF_UNREADABLE",
      exitCode: EXIT_UNAVAILABLE,
      message:
        invocation.file === undefined
          ? "The reproduced diff could not be read from standard input."
          : `The reproduced diff could not be read from ${invocation.file}.`,
      ok: false,
    };
  }
  const invalid = (message: string) => ({
    code: "SCE_CANDIDATE_DIFF_INVALID",
    exitCode: EXIT_USAGE,
    message,
    ok: false as const,
  });
  if (bytes.byteLength === 0)
    return invalid(
      "No diff bytes were supplied: pipe the packet's candidateDiffCommand output in, or pass --file <absolute path>.",
    );
  if (bytes.byteLength > MAX_CANDIDATE_DIFF_BYTES)
    return invalid(
      `The reproduced diff exceeds the ${MAX_CANDIDATE_DIFF_BYTES} bytes a collected candidate diff may have, so these bytes were never hashed as a candidate.`,
    );
  let diff: string;
  try {
    // The collector decodes its `git diff` bytes with this exact decoder, and
    // a WHATWG UTF-8 decoder that does not ignore the mark strips a leading
    // BOM before anything is hashed. Matching it is what makes a BOM-prefixed
    // reproduction reach the collected digest instead of missing it.
    diff = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return invalid(
      "The reproduced diff is not valid UTF-8; the protocol digest is taken over the UTF-8 bytes the collector observed.",
    );
  }
  if (diff.length === 0)
    return invalid(
      "The reproduced diff is nothing but a byte-order mark, which the collector strips before hashing, so no candidate bytes remain.",
    );
  if (diff.includes("\u0000"))
    return invalid(
      "The reproduced diff contains a NUL byte, which the candidate collector refuses; these bytes were never hashed as a candidate.",
    );
  return { diff, ok: true };
}

/**
 * Measures `--file` before reading a byte of it. The handle is opened without
 * blocking, so a FIFO or device named here cannot hang the command, and the
 * size and kind are taken from that same open handle, so what is measured is
 * what would be read. Anything that is not a regular file holds no collected
 * diff to hash, and a file past the candidate bound was never a candidate, so
 * both are refused before the bytes reach memory.
 */
async function readCandidateDiffFile(path: string): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile())
      throw new CliError(
        "SCE_CANDIDATE_DIFF_UNREADABLE",
        `${path} is not a regular file, so it holds no diff bytes the candidate collector could have observed.`,
        EXIT_UNAVAILABLE,
      );
    if (stats.size > MAX_CANDIDATE_DIFF_BYTES)
      throw new CliError(
        "SCE_CANDIDATE_DIFF_INVALID",
        `${path} measures ${stats.size} bytes, past the ${MAX_CANDIDATE_DIFF_BYTES} bytes a collected candidate diff may have, so these bytes were never hashed as a candidate.`,
        EXIT_USAGE,
      );
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Reads standard input to the candidate bound; a longer stream is refused. */
async function readProcessStandardInput(): Promise<Uint8Array> {
  if (process.stdin.isTTY === true)
    throw new CliError(
      "SCE_CANDIDATE_DIFF_UNREADABLE",
      "Standard input is a terminal: pipe the packet's candidateDiffCommand output in, or pass --file <absolute path>.",
      EXIT_UNAVAILABLE,
    );
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = chunk as Uint8Array;
    chunks.push(bytes);
    total += bytes.byteLength;
    if (total > MAX_CANDIDATE_DIFF_BYTES) break;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function runCompose(
  invocation: Extract<ParsedInvocation, { readonly kind: "compose" }>,
): Promise<CliExecution> {
  const observed = await observeRepository(invocation.cwd, {
    rootBeadId: invocation.compose.rootBeadId,
    ...(invocation.compose.integrationBranch === undefined
      ? {}
      : { integrationBranch: invocation.compose.integrationBranch }),
    ...(invocation.bdExecutable === undefined
      ? {}
      : { bdExecutable: invocation.bdExecutable }),
    ...(invocation.doltExecutable === undefined
      ? {}
      : { doltExecutable: invocation.doltExecutable }),
  });
  if (!observed.ok)
    return failure(
      observed.code,
      observed.message,
      EXIT_UNAVAILABLE,
      composeCommand,
    );
  const composed = composeControllerConfig(
    observed.observation,
    invocation.compose,
  );
  if (!composed.ok)
    return failure(
      composed.code,
      composed.message,
      EXIT_UNAVAILABLE,
      composeCommand,
    );
  const document = composed.config as unknown as {
    scope: Parameters<typeof inspectSlotScope>[3];
    topology: ComposedTopology;
  };
  const cwd =
    observed.observation.preflight.payload.status === "ready"
      ? observed.observation.preflight.payload.git.topLevel
      : invocation.cwd;
  let slotScope = await inspectSlotScope(
    cwd,
    observed.observation.bdExecutable,
    document.topology.prefix,
    document.scope,
  );
  if (slotScope === "foreign")
    return failure(
      "SCE_COMPOSE_SLOT_FOREIGN",
      `${document.topology.prefix}-merge-slot is bound to a different scope; it is never rebound automatically.`,
      EXIT_UNAVAILABLE,
      composeCommand,
    );
  const warnings = [...composed.summary.warnings];
  let doltSync = await inspectDoltSync(cwd, document.topology, document.scope);
  if (invocation.bindSlot && slotScope === "unbound") {
    const bound = await bindSlotScope(cwd, document.topology, document.scope);
    if (bound !== "applied")
      return failure(
        "SCE_COMPOSE_SLOT_BIND_FAILED",
        `Binding ${document.topology.prefix}-merge-slot to the run scope returned ${bound}.`,
        EXIT_UNAVAILABLE,
        composeCommand,
      );
    slotScope = "bound";
    if (document.topology.remote !== undefined)
      doltSync = await pushDoltData(cwd, document.topology, document.scope);
  } else if (slotScope === "unbound")
    warnings.push(
      `${document.topology.prefix}-merge-slot is not bound to a scope yet; rerun with --bind-slot (or the first acquire-controller is quarantined).`,
    );
  else if (slotScope === "unreadable")
    warnings.push(
      `${document.topology.prefix}-merge-slot could not be read; create it with bd merge-slot create before the first run.`,
    );
  if (doltSync === "remote-missing" || doltSync === "local-ahead")
    warnings.push(
      `Dolt data is ${doltSync === "remote-missing" ? "not on the remote yet" : "ahead of the remote"}; run bd dolt push before the first acquire-controller, which refuses an unsynced git-sync store as ambiguous.`,
    );
  else if (doltSync === "unreachable")
    warnings.push(
      "The pinned bd/dolt process could not read the embedded store; the first command will report it unavailable.",
    );
  const written = await writeComposedConfig(
    invocation.output,
    composed.config,
    invocation.overwrite,
  );
  if (!written.ok)
    return failure(
      written.code,
      written.message,
      EXIT_UNAVAILABLE,
      composeCommand,
    );
  return success(
    {
      ...(composed.summary as unknown as JsonObject),
      doltSync,
      output: written.path,
      preflight: observed.observation.preflight as unknown as JsonObject,
      slotScope,
      status: "composed",
      warnings,
    },
    composeCommand,
  );
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

/**
 * A refusal an operator can act on. Without a tail this is exactly the
 * sentence it always was; with one, the trailing full stop gives way to the
 * remote child's own already-redacted words, which are the only account of
 * why the store refused. The tail is bounded at 2 KiB by its schema, so the
 * message stays far inside the CLI response limit.
 */
function withCause(sentence: string, tail?: StoreFailureTail): string {
  return tail === undefined ? `${sentence}.` : `${sentence}: ${tail.text}`;
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
            : command === candidateDigestCommand
              ? [
                  "sce candidate-digest [--file <absolute path>] [--raw] [--json] (the reproduced diff is read from standard input when --file is absent)",
                  "SCE_CANDIDATE_DIFF_INVALID: the bytes are not bytes the collector could have hashed (empty, oversize, NUL-bearing, or not UTF-8).",
                  "SCE_CANDIDATE_DIFF_UNREADABLE: the bytes could not be read at all (a missing file, a file that is not a regular file, or a terminal on standard input).",
                ].join("\n")
              : command === composeCommand
                ? "sce compose-config --harness <claude|codex> --root-bead <id> --output <absolute path> [--cwd <absolute path>] [--branch <name>] [--authority <local-change-only|push-branch|open-pr|integrate>] [--beads-mode <local-only|git-sync>] [--controller-model <id>] [--frontier-model <id>] [--workhorse-model <id>] [--knowledge|--no-knowledge] [--bd-executable <absolute path>] [--dolt-executable <absolute path>] [--bind-slot] [--overwrite] [--json]"
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
