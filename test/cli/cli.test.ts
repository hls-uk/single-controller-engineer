import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  commandNames,
  createRecoveryCommandRunner,
  MAX_CLI_RESPONSE_BYTES,
  validateCommandRequest,
} from "../../src/commands/index.js";
import { canonicalJson, parseCliArguments, runCli } from "../../src/cli.js";
import { legalActions } from "../../src/protocol/actions.js";
import { reduce } from "../../src/protocol/reducer.js";

import { HASH, event, run, transition, unit } from "../protocol/fixtures.js";
test("mutating and external commands report stable unavailability", async () => {
  for (const command of commandNames.filter(
    (item) => !["inspect", "status", "next"].includes(item),
  )) {
    const argv = command === "feedback" ? [command, "prepare"] : [command];
    const execution = await runCli(argv);
    assert.equal(execution.exitCode, 69);
    assert.deepEqual(JSON.parse(execution.stdout), {
      command,
      error: {
        code: "SCE_COMMAND_UNAVAILABLE",
        message: `The ${command} command is unavailable.`,
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
        "sce <command> [--controller-config <absolute path>] [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]",
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
      "sce feedback <prepare|preview|submit|flush> [--controller-config <absolute path>] [--json] [--request <json>] [--expected-revision <n>] [--idempotency-key <key>]",
  });
});

test("an explicit controller config replaces the unavailable default without fallback", async () => {
  const state = run();
  let path: string | undefined;
  const configured = await runCli(
    ["plan-wave", "--controller-config", "/tmp/sce.json"],
    {
      async controllerConfigRunner(input) {
        path = input;
        return createRecoveryCommandRunner(async () => ({
          revision: state.revision,
          run: state,
          status: "idle",
        }));
      },
    },
  );
  assert.equal(path, "/tmp/sce.json");
  assert.equal(configured.exitCode, 0);
  assert.deepEqual(JSON.parse(configured.stdout).result, {
    revision: state.revision,
    status: "idle",
  });

  const rejected = await runCli([
    "plan-wave",
    "--controller-config",
    "/tmp/missing.json",
  ]);
  assert.equal(rejected.exitCode, 69);
  assert.equal(
    JSON.parse(rejected.stdout).error.code,
    "SCE_CONTROLLER_CONFIG_UNAVAILABLE",
  );
});

test("a runner receives a typed parsed request and can return a successful envelope", async () => {
  let received: unknown;
  const state = run();
  const execution = await runCli(
    [
      "next",
      "--json",
      "--expected-revision=7",
      "--idempotency-key",
      "dispatch-42",
      "--request",
      JSON.stringify({ run: state }),
    ],
    {
      runner(request) {
        received = request;
        return {
          result: { legalActions: ["plan-wave"] },
          schema: "sce.command.result",
          status: "ok",
          version: 1,
        };
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
      request: { run: state },
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

test("an injected recovery composition replaces the Phase-2 unavailable boundary", async () => {
  let calls = 0;
  const state = run();
  const execution = await runCli(["plan-wave", "--json"], {
    runner: createRecoveryCommandRunner(async (event) => {
      calls += 1;
      assert.equal(event, undefined);
      return { revision: state.revision, run: state, status: "idle" };
    }),
  });
  assert.equal(calls, 1);
  assert.equal(execution.exitCode, 0);
  assert.deepEqual(JSON.parse(execution.stdout).result, {
    revision: state.revision,
    status: "idle",
  });
});

test("feedback requires and validates its action", () => {
  assert.throws(() => parseCliArguments(["feedback"]), {
    message:
      "feedback requires one action: prepare, preview, submit, or flush.",
  });
  assert.throws(() => parseCliArguments(["feedback", "unknown"]), {
    message: "Unknown feedback action.",
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
  const execution = await runCli(
    ["inspect", "--request", JSON.stringify({ run: run() })],
    {
      runner() {
        throw new Error("canary secret");
      },
    },
  );
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
test("default runner deterministically inspects valid repository state", async () => {
  const state = run();
  const source = JSON.stringify({ run: state });
  const inspect = await runCli(["inspect", "--request", source]);
  assert.deepEqual(JSON.parse(inspect.stdout).result, {
    ambiguities: [],
    integrationBranch: "main",
    repositoryIdentity: "repo-1",
    revision: 0,
    state: "active",
    unitCount: 1,
  });
  const status = await runCli(["status", "--request", source]);
  assert.deepEqual(JSON.parse(status.stdout).result, {
    activeModifyingUnitIds: [],
    ambiguities: [],
    effectCount: 0,
    revision: 0,
    state: "active",
  });
  const next = await runCli(["next", "--request", source]);
  assert.deepEqual(JSON.parse(next.stdout).result, {
    legalActions: legalActions(state),
    revision: 0,
  });
  assert.equal(inspect.exitCode, 0);
  assert.equal(status.exitCode, 0);
  assert.equal(next.exitCode, 0);
});

test("CLI state requests reject text that only exceeds the UTF-8 byte bound", async () => {
  const oversized = {
    ...run(),
    units: {
      "unit-1": {
        ...run().units["unit-1"]!,
        worktreePath: "🙂".repeat(2_049),
      },
    },
  };
  const execution = await runCli([
    "inspect",
    "--request",
    JSON.stringify({ run: oversized }),
  ]);
  assert.equal(execution.exitCode, 64);
  assert.equal(JSON.parse(execution.stdout).error.code, "SCE_INVALID_REQUEST");
});

test("read commands expose the exact bounded ambiguity recovery", async () => {
  let state = run();
  state = transition(
    state,
    event(state, "reservation_intent", {
      reservations: [{ id: "res-1", namespace: "port", resource: "3001" }],
    }),
    reduce,
  );
  state = transition(
    state,
    event(state, "effect_ambiguous", {
      effectId: "event-1:reservation_acquire",
      effectKind: "reservation_acquire",
    }),
    reduce,
  );
  const expected = [
    {
      effectId: "event-1:reservation_acquire",
      effectKind: "reservation_acquire",
      observationType: "reservation_observed",
      unitId: "unit-1",
    },
  ];
  for (const command of ["inspect", "status"]) {
    const execution = await runCli([
      command,
      "--request",
      JSON.stringify({ run: state }),
    ]);
    assert.equal(execution.exitCode, 0);
    assert.deepEqual(JSON.parse(execution.stdout).result.ambiguities, expected);
  }
  const next = await runCli([
    "next",
    "--request",
    JSON.stringify({ run: state }),
  ]);
  assert.equal(next.exitCode, 0);
  assert.deepEqual(JSON.parse(next.stdout).result.legalActions, [
    {
      effectId: "event-1:reservation_acquire",
      effectKind: "reservation_acquire",
      mode: "record",
      type: "reservation_observed",
      unitId: "unit-1",
    },
  ]);
});

test("blocked read commands expose every durable in-flight observation", async () => {
  const unitIds = ["unit-1", "unit-2", "unit-3"] as const;
  let state = run(unitIds.map((id) => unit(id)));
  const effectIds = new Map<string, string>();
  for (const [index, unitId] of unitIds.entries()) {
    state = transition(
      state,
      event(
        state,
        "reservation_intent",
        {
          reservations: [
            {
              id: `res-${index + 1}`,
              namespace: "port",
              resource: `${3001 + index}`,
            },
          ],
        },
        unitId,
      ),
      reduce,
    );
    effectIds.set(
      unitId,
      state.effectJournal.at(-1)?.effectId ?? "missing-effect-id",
    );
  }
  state = transition(
    state,
    event(
      state,
      "effect_ambiguous",
      {
        effectId: effectIds.get("unit-1"),
        effectKind: "reservation_acquire",
      },
      "unit-1",
    ),
    reduce,
  );
  const expected = unitIds.map((unitId) => ({
    effectId: effectIds.get(unitId),
    effectKind: "reservation_acquire",
    observationType: "reservation_observed",
    unitId,
  }));
  for (const command of ["inspect", "status"]) {
    const execution = await runCli([
      command,
      "--request",
      JSON.stringify({ run: state }),
    ]);
    assert.equal(execution.exitCode, 0);
    assert.deepEqual(JSON.parse(execution.stdout).result.ambiguities, expected);
  }
  const next = await runCli([
    "next",
    "--request",
    JSON.stringify({ run: state }),
  ]);
  assert.equal(next.exitCode, 0);
  const actions = JSON.parse(next.stdout).result.legalActions;
  assert.deepEqual(
    actions,
    expected.map((item) => ({
      effectId: item.effectId,
      effectKind: item.effectKind,
      mode: "record",
      type: item.observationType,
      unitId: item.unitId,
    })),
  );
  assert.equal(
    actions.some((action: { mode: string }) => action.mode === "emit"),
    false,
  );
});
test("malformed, oversize, and invalid state requests fail closed", async () => {
  const tooLarge = `{\"payload\":\"${"x".repeat(128 * 1024)}\"}`;
  for (const [source, code] of [
    [JSON.stringify({ run: run(), unknown: true }), "SCE_INVALID_REQUEST"],
    ["{", "SCE_INVALID_JSON"],
    [tooLarge, "SCE_REQUEST_TOO_LARGE"],
    ['{"run":{}}', "SCE_INVALID_REQUEST"],
  ] as const) {
    const execution = await runCli(["next", "--request", source]);
    assert.equal(JSON.parse(execution.stdout).error.code, code);
  }
});
test("conditional command envelopes reject accidental fields and semantic state", async () => {
  const state = run();
  const header = { schema: "sce.command.request", version: 1 } as const;
  assert.equal(
    validateCommandRequest({
      ...header,
      command: "next",
      options: { json: false, request: { run: state } },
    }),
    true,
  );
  for (const request of [
    {
      ...header,
      command: "next",
      feedbackAction: "prepare",
      options: { json: false, request: { run: state } },
    },
    {
      ...header,
      command: "feedback",
      options: { json: false },
    },
    {
      ...header,
      command: "feedback",
      feedbackAction: "prepare",
      options: { json: false, request: { run: state } },
    },
    {
      ...header,
      command: "publish",
      options: { json: false, accidental: true },
    },
  ]) {
    assert.equal(validateCommandRequest(request), false);
  }

  const semanticInvalid = {
    ...state,
    activeModifyingUnitIds: ["unit-1"],
  };
  for (const command of ["inspect", "next", "status"]) {
    const execution = await runCli([
      command,
      "--request",
      JSON.stringify({ run: semanticInvalid }),
    ]);
    assert.equal(execution.exitCode, 64);
    assert.equal(
      JSON.parse(execution.stdout).error.code,
      "SCE_INVALID_STATE_REQUEST",
    );
  }
});
test("invalid runner results are rejected without leaking fields", async () => {
  const execution = await runCli(
    ["inspect", "--request", JSON.stringify({ run: run() })],
    {
      runner() {
        return { status: "ok", result: {}, leaked: "canary secret" } as never;
      },
    },
  );
  assert.equal(
    JSON.parse(execution.stdout).error.code,
    "SCE_INVALID_RUNNER_RESULT",
  );
  assert.doesNotMatch(execution.stdout, /canary secret/u);
});
test("next action returns sorted protocol descriptors only for validated state", async () => {
  const state = run([unit("unit-2"), unit("unit-1")]);
  const execution = await runCli([
    "next",
    "--request",
    JSON.stringify({ run: state }),
  ]);
  assert.equal(execution.exitCode, 0);
  assert.deepEqual(JSON.parse(execution.stdout).result, {
    legalActions: legalActions(state),
    revision: 0,
  });
});
test("oversized runner output is replaced by a bounded sanitized envelope", async () => {
  const largeResult = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [
      `field-${index}`,
      "x".repeat(8_192),
    ]),
  );
  const execution = await runCli(
    ["next", "--request", JSON.stringify({ run: run() })],
    {
      runner() {
        return {
          result: largeResult,
          schema: "sce.command.result",
          status: "ok",
          version: 1,
        };
      },
    },
  );
  assert.equal(execution.exitCode, 70);
  assert.equal(JSON.parse(execution.stdout).error.code, "SCE_RESULT_TOO_LARGE");
  assert.ok(
    new TextEncoder().encode(execution.stdout).byteLength <=
      MAX_CLI_RESPONSE_BYTES,
  );
  assert.doesNotMatch(execution.stdout, /xxxxxxxx/u);
});
test("vendored CLI bundle is reproducible and executable", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const build = () =>
    spawnSync(process.execPath, ["scripts/build.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
  const output = resolve(
    root,
    "skills/single-controller-engineer/scripts/sce.mjs",
  );
  assert.equal(build().status, 0);
  const first = await readFile(output);
  assert.equal(build().status, 0);
  assert.deepEqual(await readFile(output), first);
  const execution = spawnSync(process.execPath, [output, "--version"], {
    encoding: "utf8",
  });
  assert.equal(execution.status, 0);
  assert.equal(
    execution.stdout,
    '{"ok":true,"result":{"version":"0.1.0"},"schema":"sce.cli.response","version":1}\n',
  );
  assert.ok((await stat(output)).mode & 0o111);
});
