import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  commandNames,
  createRecoveryCommandRunner,
  MAX_CLI_RESPONSE_BYTES,
  validateCommandRequest,
} from "../../src/commands/index.js";
import {
  canonicalJson,
  parseCliArguments,
  resolvePackagedSkillSource,
  runCli,
} from "../../src/cli.js";
import {
  authorityFor,
  FeedbackOutbox,
  prepareFeedback,
  type FeedbackGitHubTransport,
} from "../../src/feedback/index.js";
import { legalActions } from "../../src/protocol/actions.js";
import {
  canonicalCandidateDiffCommand,
  reduce,
} from "../../src/protocol/reducer.js";
import { createPacket } from "../../src/harness/index.js";

import { HASH, event, run, transition, unit } from "../protocol/fixtures.js";
test("mutating and external commands report stable unavailability", async () => {
  for (const command of commandNames.filter(
    (item) =>
      ![
        "inspect",
        "status",
        "next",
        "harness-packet",
        "feedback",
        "claim-provenance-carry",
      ].includes(item),
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
      commands: [...commandNames, "install-skill", "uninstall-skill"],
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
    usage: "sce feedback <prepare|preview|submit|flush> --request <json>",
  });
});

test("an explicit controller config replaces the unavailable default without fallback", async () => {
  const state = run();
  const expected = {
    configuration: state.harness!,
    eventId: "configure-harness",
    expectedRevision: state.revision,
    type: "harness_configured" as const,
  };
  let path: string | undefined;
  const configured = await runCli(
    [
      "configure-harness",
      "--controller-config",
      "/tmp/sce.json",
      "--request",
      JSON.stringify({ event: expected }),
    ],
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
    "configure-harness",
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
  const expected = {
    configuration: state.harness!,
    eventId: "configure-harness",
    expectedRevision: state.revision,
    type: "harness_configured" as const,
  };
  const execution = await runCli(
    [
      "configure-harness",
      "--json",
      "--request",
      JSON.stringify({ event: expected }),
    ],
    {
      runner: createRecoveryCommandRunner(async (event) => {
        calls += 1;
        assert.deepEqual(event, expected);
        return { revision: state.revision, run: state, status: "idle" };
      }),
    },
  );
  assert.equal(calls, 1);
  assert.equal(execution.exitCode, 0);
  assert.deepEqual(JSON.parse(execution.stdout).result, {
    revision: state.revision,
    status: "idle",
  });
});

test("public harness-packet emits immutable worker and reviewer prompt bytes", async () => {
  const worker = {
    acceptance: ["acceptance-b", "acceptance-a"],
    baseOid: "a".repeat(40),
    mandatoryVerification: ["npm test"],
    ownedPaths: ["src/b", "src/a"],
    role: "worker" as const,
    unitId: "unit-1",
  };
  const reviewer = {
    ...worker,
    candidateDiffByteCount: 29,
    candidateDiffHash: "d".repeat(64),
    candidateDiffStat: { deletions: 0, fileCount: 1, insertions: 1 },
    headOid: "b".repeat(40),
    role: "reviewer" as const,
    worktreePath: "/tmp/unit-1",
  };
  for (const input of [worker, reviewer]) {
    const expected = createPacket(input);
    assert.equal(expected.ok, true);
    if (!expected.ok) return;
    const execution = await runCli([
      "harness-packet",
      "--json",
      "--request",
      JSON.stringify(input),
    ]);
    assert.equal(execution.exitCode, 0);
    const actual = JSON.parse(execution.stdout).result;
    assert.deepEqual(actual, {
      hash: expected.hash,
      payload: expected.payload,
      schema: expected.schema,
      version: expected.version,
    });
    assert.equal(actual.version, input.role === "reviewer" ? 2 : 1);
    if (input.role === "reviewer") {
      const payload = JSON.parse(actual.payload);
      assert.equal(Object.hasOwn(payload, "diff"), false);
      assert.deepEqual(
        payload.candidateDiffCommand,
        canonicalCandidateDiffCommand(input.baseOid, input.headOid),
      );
    }
  }
  const invalid = await runCli([
    "harness-packet",
    "--json",
    "--request",
    JSON.stringify({ ...worker, unexpected: true }),
  ]);
  assert.equal(invalid.exitCode, 64);
});

test("manual harness acknowledgements cross the CLI as narrow host facts", async () => {
  const acknowledgement = {
    effectId: "effect-1",
    kind: "launch",
    schema: "sce.harness-tool-acknowledgement",
    session: {
      clientKey: "effect-1",
      fresh: true,
      harnessFamily: "codex",
      harnessVersion: 1,
      promptHash: HASH,
      readOnly: false,
      requestedModel: "workhorse",
      returnedModel: "workhorse-1",
      role: "worker",
      sessionId: "worker-1",
      worktreePath: "/tmp/unit-1",
    },
    version: 1,
  };
  const execution = await runCli(
    [
      "record-dispatch",
      "--json",
      "--request",
      JSON.stringify({ harnessAcknowledgement: acknowledgement }),
    ],
    {
      runner: createRecoveryCommandRunner(async (request) => {
        assert.deepEqual(request, { harnessAcknowledgement: acknowledgement });
        return {
          revision: 7,
          run: run(),
          status: "tool_request",
          toolRequest: {
            operation: "launch",
            schema: "sce.harness-tool-request",
            version: 1,
          },
        };
      }),
    },
  );
  assert.equal(execution.exitCode, 0);
  assert.deepEqual(JSON.parse(execution.stdout).result, {
    revision: 7,
    status: "tool_request",
    toolRequest: {
      operation: "launch",
      schema: "sce.harness-tool-request",
      version: 1,
    },
  });
});

test("qualify accepts only a strict verified acknowledgement", async () => {
  const verified = {
    baseOid: "a".repeat(40),
    commands: ["npm test"],
    effectId: "verify-1",
    evidenceDigest: HASH,
    headOid: "b".repeat(40),
    kind: "verified",
    passed: true,
    schema: "sce.harness-tool-acknowledgement",
    treeOid: "c".repeat(40),
    version: 1,
    worktreePath: "/tmp/unit-1",
  };
  let calls = 0;
  const runner = createRecoveryCommandRunner(async (request) => {
    calls += 1;
    assert.deepEqual(request, {
      harnessAcknowledgement:
        calls === 1 ? verified : { ...verified, passed: false },
    });
    return {
      revision: 8,
      run: run(),
      status: "tool_request",
      toolRequest: {
        operation: "verify",
        schema: "sce.harness-tool-request",
        version: 1,
      },
    };
  });
  const accepted = await runCli(
    [
      "qualify",
      "--json",
      "--request",
      JSON.stringify({ harnessAcknowledgement: verified }),
    ],
    { runner },
  );
  assert.equal(accepted.exitCode, 0);
  assert.equal(JSON.parse(accepted.stdout).result.status, "tool_request");
  const failed = await runCli(
    [
      "qualify",
      "--json",
      "--request",
      JSON.stringify({
        harnessAcknowledgement: { ...verified, passed: false },
      }),
    ],
    { runner },
  );
  assert.equal(failed.exitCode, 0);
  const rejected = await runCli(
    [
      "qualify",
      "--json",
      "--request",
      JSON.stringify({
        harnessAcknowledgement: {
          effectId: "verify-1",
          kind: "launch",
          schema: "sce.harness-tool-acknowledgement",
          session: {
            clientKey: "client-1",
            fresh: true,
            harnessFamily: "codex",
            harnessVersion: 1,
            promptHash: HASH,
            readOnly: false,
            requestedModel: "gpt-5.6-terra",
            returnedModel: "gpt-5.6-terra",
            role: "worker",
            sessionId: "session-1",
            worktreePath: "/tmp/unit-1",
          },
          version: 1,
        },
      }),
    ],
    { runner },
  );
  assert.equal(rejected.exitCode, 64);
  const smuggled = await runCli(
    [
      "record-dispatch",
      "--json",
      "--request",
      JSON.stringify({ harnessAcknowledgement: verified }),
    ],
    { runner },
  );
  assert.equal(smuggled.exitCode, 64);
  assert.equal(calls, 2);
});

test("recovery commands refuse missing mutating payloads before injected runners", async () => {
  let calls = 0;
  const execution = await runCli(["dispatch-request", "--json"], {
    runner: createRecoveryCommandRunner(async () => {
      calls += 1;
      return { revision: 0, run: run(), status: "idle" };
    }),
  });
  assert.equal(execution.exitCode, 64);
  assert.equal(calls, 0);
  assert.equal(
    JSON.parse(execution.stdout).error.code,
    "SCE_INVALID_STATE_REQUEST",
  );
});

test("feedback requires and validates its action", () => {
  assert.throws(() => parseCliArguments(["feedback"]), {
    message:
      "feedback requires one action: prepare, preview, submit, or flush.",
  });
  assert.throws(() => parseCliArguments(["feedback", "unknown"]), {
    message: "Unknown feedback action.",
  });
  assert.throws(() => parseCliArguments(["feedback", "flush"]), {
    message: "The command request is invalid.",
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

const feedbackTelemetry = {
  capabilityId: "feedback.submit" as const,
  component: "runtime" as const,
  kind: "bug" as const,
  protocolState: "failed" as const,
  requestedModelTier: "workhorse" as const,
  stableErrorCode: "SCE_CLI_FEEDBACK",
  toolVersion: "0.1.0",
  toolchain: "node-22" as const,
};

async function temporaryFeedbackCommon(): Promise<{
  readonly common: string;
  readonly root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "sce-cli-feedback-"));
  const common = join(root, "common");
  await mkdir(common, { mode: 0o700 });
  return { common, root };
}

function issueTransport(counter: { creates: number }): FeedbackGitHubTransport {
  return {
    async discoverExactMarker() {
      return {
        issues: [],
        paginationComplete: true,
        repositoryId: "R_kgDOUCvUmw",
      };
    },
    async createIssue(request) {
      counter.creates += 1;
      return {
        body: request.body,
        number: 42,
        open: true,
        repositoryId: "R_kgDOUCvUmw",
        url: "https://github.com/hls-uk/single-controller-engineer/issues/42",
      };
    },
  };
}

test("feedback prepare and preview are purely local typed operations", async () => {
  let commonLookups = 0;
  const prepared = await runCli(
    [
      "feedback",
      "prepare",
      "--request",
      JSON.stringify({ telemetry: feedbackTelemetry }),
    ],
    {
      feedback: {
        async resolveCommonDirectory() {
          commonLookups += 1;
          return undefined;
        },
      },
    },
  );
  assert.equal(prepared.exitCode, 0);
  const packet = JSON.parse(prepared.stdout).result.packet;
  const preview = await runCli(
    ["feedback", "preview", "--request", JSON.stringify({ packet })],
    {
      feedback: {
        async resolveCommonDirectory() {
          commonLookups += 1;
          return undefined;
        },
      },
    },
  );
  assert.equal(preview.exitCode, 0);
  assert.equal(
    JSON.parse(preview.stdout).result.preview.repositoryId,
    "R_kgDOUCvUmw",
  );
  assert.equal(commonLookups, 0);
});

test("feedback queues before authority and fake authorized submit/flush cannot double-create", async () => {
  const fixture = await temporaryFeedbackCommon();
  try {
    const packet = prepareFeedback(feedbackTelemetry);
    assert.ok(packet);
    if (packet === undefined) return;
    const counter = { creates: 0 };
    const queued = await runCli(
      ["feedback", "submit", "--request", JSON.stringify({ packet })],
      {
        feedback: {
          async resolveCommonDirectory() {
            return fixture.common;
          },
          transport: issueTransport(counter),
        },
      },
    );
    assert.equal(queued.exitCode, 69);
    assert.equal(
      JSON.parse(queued.stdout).error.code,
      "SCE_FEEDBACK_QUEUED_AUTHORITY",
    );
    assert.equal(counter.creates, 0);
    const outbox = FeedbackOutbox.open(fixture.common);
    assert.equal(outbox.status, "ok");
    if (outbox.status !== "ok") return;
    assert.equal(outbox.value.read(packet.telemetry.fingerprint).status, "ok");
    const authority = authorityFor(
      packet,
      "current_user",
      "cli-authority-nonce-0001",
    );
    assert.ok(authority);
    if (authority === undefined) return;
    const submitted = await runCli(
      [
        "feedback",
        "submit",
        "--request",
        JSON.stringify({ authority, packet }),
      ],
      {
        feedback: {
          async resolveCommonDirectory() {
            return fixture.common;
          },
          transport: issueTransport(counter),
        },
      },
    );
    assert.equal(submitted.exitCode, 0);
    assert.equal(counter.creates, 1);
    const flushed = await runCli(
      [
        "feedback",
        "flush",
        "--request",
        JSON.stringify({
          authority,
          fingerprint: packet.telemetry.fingerprint,
        }),
      ],
      {
        feedback: {
          async resolveCommonDirectory() {
            return fixture.common;
          },
          transport: issueTransport(counter),
        },
      },
    );
    assert.equal(flushed.exitCode, 0);
    assert.equal(JSON.parse(flushed.stdout).result.status, "existing");
    assert.equal(counter.creates, 1);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("public feedback flush recovers a submit intent after a proven killed lock holder", async () => {
  const fixture = await temporaryFeedbackCommon();
  try {
    const packet = prepareFeedback(feedbackTelemetry);
    assert.ok(packet);
    if (packet === undefined) return;
    const outbox = FeedbackOutbox.open(fixture.common);
    assert.equal(outbox.status, "ok");
    if (outbox.status !== "ok") return;
    assert.equal(outbox.value.enqueue(packet).status, "ok");
    const authority = authorityFor(
      packet,
      "current_user",
      "cli-killed-holder-nonce-0001",
    );
    assert.ok(authority);
    if (authority === undefined) return;
    assert.equal(
      outbox.value.markSubmitIntent(
        packet.telemetry.fingerprint,
        authority.operationNonce,
      ).status,
      "ok",
    );
    await writeFile(
      join(
        outbox.value.directory,
        `.submit-${packet.telemetry.fingerprint}.lock`,
      ),
      "pid=2147483647\ntoken=00000000-0000-4000-8000-000000000000\n",
      { mode: 0o600 },
    );
    const existing = {
      body: packet.body,
      number: 43,
      open: true,
      repositoryId: "R_kgDOUCvUmw" as const,
      url: "https://github.com/hls-uk/single-controller-engineer/issues/43",
    };
    let creates = 0;
    const execution = await runCli(
      [
        "feedback",
        "flush",
        "--request",
        JSON.stringify({
          authority,
          fingerprint: packet.telemetry.fingerprint,
        }),
      ],
      {
        feedback: {
          async resolveCommonDirectory() {
            return fixture.common;
          },
          transport: {
            async discoverExactMarker() {
              return {
                issues: [existing],
                paginationComplete: true,
                repositoryId: "R_kgDOUCvUmw",
              };
            },
            async createIssue() {
              creates += 1;
              throw new Error("must not create while recovering exact intent");
            },
          },
        },
      },
    );
    assert.equal(execution.exitCode, 0, execution.stdout);
    assert.equal(JSON.parse(execution.stdout).result.status, "existing");
    assert.equal(creates, 0);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("feedback common-directory refusal and executor failures never leak canaries", async () => {
  const packet = prepareFeedback(feedbackTelemetry);
  assert.ok(packet);
  if (packet === undefined) return;
  const execution = await runCli(
    ["feedback", "submit", "--request", JSON.stringify({ packet })],
    {
      feedback: {
        executor: {
          async execute() {
            throw new Error("ghp_secret-canary-never-print");
          },
        },
      },
    },
  );
  assert.equal(execution.exitCode, 69);
  assert.equal(
    JSON.parse(execution.stdout).error.code,
    "SCE_FEEDBACK_OUTBOX_UNAVAILABLE",
  );
  assert.doesNotMatch(execution.stdout, /secret-canary/u);
});

test("skill commands install an exact pair from deterministic packaged source", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-cli-install-"));
  const destination = join(root, "skills");
  try {
    const source = resolvePackagedSkillSource();
    assert.equal(source, resolve("skills"));
    const dryRun = await runCli(
      [
        "install-skill",
        "--host",
        "codex",
        "--destination",
        destination,
        "--dry-run",
      ],
      { skillSource: source },
    );
    assert.equal(dryRun.exitCode, 0);
    assert.equal(JSON.parse(dryRun.stdout).result.status, "dry-run");
    const installed = await runCli(
      ["install-skill", "--host=claude", "--destination", destination],
      { skillSource: source },
    );
    assert.equal(installed.exitCode, 0);
    const installedResult = JSON.parse(installed.stdout).result;
    const manifest = JSON.parse(
      await readFile(join(destination, ".sce-skill-install.json"), "utf8"),
    );
    assert.deepEqual(installedResult.manifest, manifest);
    const removed = await runCli(
      ["uninstall-skill", "--host", "claude", "--destination", destination],
      { skillSource: source },
    );
    assert.equal(removed.exitCode, 0);
    assert.equal(JSON.parse(removed.stdout).result.status, "uninstalled");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("an undeclared install host installs the same pair and is omitted, not empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-cli-install-hostless-"));
  const destination = join(root, "skills");
  try {
    const source = resolvePackagedSkillSource();
    const dryRun = await runCli(
      ["install-skill", "--destination", destination, "--dry-run"],
      { skillSource: source },
    );
    assert.equal(dryRun.exitCode, 0, dryRun.stdout);
    const previewed = JSON.parse(dryRun.stdout).result;
    assert.equal(previewed.status, "dry-run");
    assert.equal("host" in previewed, false);
    assert.deepEqual(Object.keys(previewed.manifest.skills).sort(), [
      "single-controller-engineer",
      "single-controller-feedback",
    ]);
    assert.ok(previewed.manifest.files.length > 0);

    const installed = await runCli(
      ["install-skill", "--destination", destination],
      { skillSource: source },
    );
    assert.equal(installed.exitCode, 0, installed.stdout);
    const installedResult = JSON.parse(installed.stdout).result;
    assert.equal(installedResult.status, "installed");
    assert.equal("host" in installedResult, false);
    assert.deepEqual(
      installedResult.manifest,
      JSON.parse(
        await readFile(join(destination, ".sce-skill-install.json"), "utf8"),
      ),
    );
    assert.deepEqual(installedResult.manifest, previewed.manifest);

    const removed = await runCli(
      ["uninstall-skill", "--destination", destination],
      { skillSource: source },
    );
    assert.equal(removed.exitCode, 0, removed.stdout);
    const removedResult = JSON.parse(removed.stdout).result;
    assert.deepEqual(removedResult, { status: "uninstalled" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a declared install host stays exactly codex or claude", async () => {
  const destination = join(tmpdir(), "sce-cli-install-refused");
  for (const command of ["install-skill", "uninstall-skill"] as const) {
    for (const host of ["", "Claude", "claude-code", "any"]) {
      const execution = await runCli([
        command,
        `--host=${host}`,
        "--destination",
        destination,
      ]);
      assert.equal(execution.exitCode, 64);
      assert.deepEqual(JSON.parse(execution.stdout).error, {
        code: "SCE_INVALID_OPTION_VALUE",
        message: "--host must be codex or claude.",
      });
    }
  }
});

test("installer help states the host declaration as optional", async () => {
  const install = await runCli(["install-skill", "--help"]);
  assert.equal(install.exitCode, 0);
  assert.deepEqual(JSON.parse(install.stdout).result, {
    command: "install-skill",
    usage:
      "sce install-skill [--host <codex|claude>] --destination <absolute path> [--dry-run]",
  });
  const uninstall = await runCli(["uninstall-skill", "-h"]);
  assert.equal(uninstall.exitCode, 0);
  assert.deepEqual(JSON.parse(uninstall.stdout).result, {
    command: "uninstall-skill",
    usage:
      "sce uninstall-skill [--host <codex|claude>] --destination <absolute path>",
  });
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
  assert.equal(
    validateCommandRequest({
      ...header,
      command: "claim-provenance-carry",
      options: {
        json: false,
        request: { predecessorRootBeadId: "sce-predecessor" },
      },
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
    {
      ...header,
      command: "claim-provenance-carry",
      options: {
        json: false,
        request: { predecessorRootIssueId: "sce-predecessor" },
      },
    },
    {
      ...header,
      command: "claim-provenance-carry",
      options: {
        json: false,
        request: {
          extra: true,
          predecessorRootBeadId: "sce-predecessor",
        },
      },
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

test("gate-wave rejects caller-supplied adapter observations and carry events", async () => {
  const observation = {
    effectId: "effect-1",
    eventId: "event-1",
    expectedRevision: 0,
    gateEntryId: "gate-1",
    observationHash: HASH,
    unitId: null,
  } as const;
  const forbidden = [
    {
      ...observation,
      effectKind: "materialisation_resolve",
      result: {
        refusal: { code: "source_absent", detailHash: HASH },
        status: "refused",
      },
      type: "materialisation_sources_observed",
    },
    {
      ...observation,
      effectKind: "destination_probe",
      result: {
        refusal: { code: "invalid_destination", detailHash: HASH },
        status: "refused",
      },
      type: "destination_probe_observed",
    },
    {
      ...observation,
      effectKind: "materialise",
      result: {
        refusal: { code: "hard_links_unsupported", detailHash: HASH },
        status: "refused",
      },
      type: "materialise_observed",
    },
    {
      ...observation,
      effectKind: "provenance_commit",
      result: {
        attemptedCommitOid: "a".repeat(40),
        attemptedTreeOid: "b".repeat(40),
        reasonDigest: HASH,
        status: "reproducibility_failed",
      },
      type: "provenance_commit_observed",
    },
    {
      ...observation,
      baseOid: "a".repeat(40),
      effectKind: "verify",
      headOid: "b".repeat(40),
      treeOid: "c".repeat(40),
      type: "verification_observed",
    },
    {
      ...observation,
      baseOid: "a".repeat(40),
      effectKind: "verify",
      headOid: "b".repeat(40),
      treeOid: "c".repeat(40),
      type: "verification_failed",
    },
    {
      claimToken: "carry-key",
      eventId: "carry-event",
      expectedRevision: 0,
      exportId: `sce:carry:${HASH}`,
      idempotencyKey: "carry-key",
      predecessorFinalRevision: 1,
      predecessorJournalCheckpointCommitment: HASH,
      predecessorRootAggregateCommitment: HASH,
      predecessorRootBeadId: "sce-predecessor",
      predecessorRunId: "run-predecessor",
      predecessorWaveId: "wave-predecessor",
      snapshotCommitment: HASH,
      type: "provenance_carry_claim_intent",
    },
  ];
  let calls = 0;
  const runner = createRecoveryCommandRunner(async () => {
    calls += 1;
    return { status: "unavailable" };
  });
  for (const event of forbidden) {
    const execution = await runCli(
      ["gate-wave", "--request", JSON.stringify({ event })],
      { runner },
    );
    assert.equal(execution.exitCode, 64, event.type);
    assert.equal(
      JSON.parse(execution.stdout).error.code,
      "SCE_INVALID_STATE_REQUEST",
      event.type,
    );
  }
  assert.equal(calls, 0);
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
  assert.equal(first.includes(Buffer.from(root)), false);
  assert.doesNotMatch(first.toString("utf8"), /^\/\/ (?:\.\.[/\\])+/mu);
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
  const packetInput = {
    acceptance: ["acceptance-1"],
    baseOid: "a".repeat(40),
    mandatoryVerification: ["npm test"],
    ownedPaths: ["src"],
    role: "worker",
    unitId: "unit-1",
  };
  const packet = createPacket(packetInput);
  assert.equal(packet.ok, true);
  if (!packet.ok) return;
  const packetExecution = spawnSync(
    process.execPath,
    [
      output,
      "harness-packet",
      "--json",
      "--request",
      JSON.stringify(packetInput),
    ],
    { encoding: "utf8" },
  );
  assert.equal(packetExecution.status, 0);
  assert.equal(
    packetExecution.stdout,
    `${JSON.stringify({
      command: "harness-packet",
      ok: true,
      result: {
        hash: packet.hash,
        payload: packet.payload,
        schema: packet.schema,
        version: packet.version,
      },
      schema: "sce.cli.response",
      version: 1,
    })}\n`,
  );
  assert.ok((await stat(output)).mode & 0o111);
});
