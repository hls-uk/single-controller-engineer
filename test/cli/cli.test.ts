import assert from "node:assert/strict";
import test from "node:test";

import { commandNames } from "../../src/commands/index.js";
import { canonicalJson, parseCliArguments, runCli } from "../../src/cli.js";

test("every designed command is discovered and reports stable Phase 1 unavailability", async () => {
  for (const command of commandNames) {
    const argv = command === "feedback" ? [command, "prepare"] : [command];
    const execution = await runCli(argv);
    assert.equal(execution.exitCode, 69);
    assert.deepEqual(JSON.parse(execution.stdout), {
      command,
      error: {
        code: "SCE_COMMAND_UNAVAILABLE",
        message: `The ${command} command is not wired in Phase 1.`,
      },
      ok: false,
      schema: "sce.cli.response",
      version: 1,
    });
  }
});

test("global help and version are JSON envelopes", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.deepEqual(JSON.parse(help.stdout), {
    ok: true,
    result: {
      commands: [...commandNames],
      name: "sce",
      usage:
        "sce <command> [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]",
      version: "0.1.0",
    },
    schema: "sce.cli.response",
    version: 1,
  });

  const version = await runCli(["--version"]);
  assert.equal(version.exitCode, 0);
  assert.deepEqual(JSON.parse(version.stdout).result, { version: "0.1.0" });
});

test("command help exposes feedback's explicit subcommand surface", async () => {
  const execution = await runCli(["feedback", "--help"]);
  assert.equal(execution.exitCode, 0);
  assert.deepEqual(JSON.parse(execution.stdout).result, {
    actions: ["prepare", "preview", "submit", "flush"],
    command: "feedback",
    usage:
      "sce feedback <prepare|preview|submit|flush> [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]",
  });
});

test("a runner receives a typed parsed request and can return a successful envelope", async () => {
  let received: unknown;
  const execution = await runCli(
    [
      "next",
      "--json",
      "--expected-revision=7",
      "--idempotency-key",
      "dispatch-42",
      "--request",
      '{"unit":"unit-1","wave":2}',
    ],
    {
      runner(request) {
        received = request;
        return { result: { legalActions: ["plan-wave"] }, status: "ok" };
      },
    },
  );

  assert.equal(execution.exitCode, 0);
  assert.deepEqual(received, {
    command: "next",
    options: {
      expectedRevision: 7,
      idempotencyKey: "dispatch-42",
      json: true,
      request: { unit: "unit-1", wave: 2 },
    },
    schema: "sce.command.request",
    version: 1,
  });
  assert.deepEqual(JSON.parse(execution.stdout), {
    command: "next",
    ok: true,
    result: { legalActions: ["plan-wave"] },
    schema: "sce.cli.response",
    version: 1,
  });
});

test("feedback requires and validates its action", () => {
  assert.throws(() => parseCliArguments(["feedback"]), {
    message:
      "feedback requires one action: prepare, preview, submit, or flush.",
  });
  assert.throws(() => parseCliArguments(["feedback", "unknown"]), {
    message: "Unknown feedback action: unknown",
  });
  assert.deepEqual(parseCliArguments(["feedback", "flush"]), {
    kind: "command",
    request: {
      command: "feedback",
      feedbackAction: "flush",
      options: { json: false },
      schema: "sce.command.request",
      version: 1,
    },
  });
});

test("unknown commands, positional arguments, and unknown options fail closed", async () => {
  for (const [argv, code] of [
    [["unknown"], "SCE_UNKNOWN_COMMAND"],
    [["inspect", "extra"], "SCE_UNEXPECTED_ARGUMENT"],
    [["inspect", "--unknown"], "SCE_UNKNOWN_OPTION"],
    [["inspect", "--request"], "SCE_MISSING_OPTION_VALUE"],
    [["inspect", "--json=1"], "SCE_INVALID_OPTION_VALUE"],
    [["inspect", "--json", "--json"], "SCE_DUPLICATE_OPTION"],
  ] as const) {
    const execution = await runCli(argv);
    assert.equal(execution.exitCode, 64);
    assert.equal(JSON.parse(execution.stdout).error.code, code);
  }
});

test("option values use strict, bounded formats", async () => {
  for (const [argv, code] of [
    [["status", "--expected-revision", "-1"], "SCE_INVALID_OPTION_VALUE"],
    [["status", "--expected-revision", "1.5"], "SCE_INVALID_OPTION_VALUE"],
    [
      ["status", "--expected-revision", "9007199254740992"],
      "SCE_INVALID_OPTION_VALUE",
    ],
    [["status", "--idempotency-key="], "SCE_INVALID_OPTION_VALUE"],
    [["status", "--request", "not-json"], "SCE_INVALID_JSON"],
    [["status", "--request", "[]"], "SCE_INVALID_OPTION_VALUE"],
  ] as const) {
    const execution = await runCli(argv);
    assert.equal(execution.exitCode, 64);
    assert.equal(JSON.parse(execution.stdout).error.code, code);
  }
});

test("runner failures cannot leak their thrown values", async () => {
  const execution = await runCli(["inspect"], {
    runner() {
      throw new Error("canary secret");
    },
  });
  assert.equal(execution.exitCode, 70);
  assert.deepEqual(JSON.parse(execution.stdout).error, {
    code: "SCE_RUNNER_FAILURE",
    message: "The command runner failed without a usable response.",
  });
  assert.doesNotMatch(execution.stdout, /canary secret/u);
});

test("canonical JSON sorts object keys while preserving array order", () => {
  assert.equal(
    canonicalJson({ z: ["b", "a"], a: { d: 1, c: 2 } }),
    '{"a":{"c":2,"d":1},"z":["b","a"]}',
  );
});
