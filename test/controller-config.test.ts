import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createControllerConfigRunner } from "../src/controller-config.js";
import { createProductionRecoveryEffectAdapter } from "../src/commands/production-recovery.js";
import {
  HARNESS_VERSION,
  createPacket,
  harnessSupportCommitment,
  HarnessToolRequestSchema,
  type HarnessSupport,
  type HarnessToolRequest,
} from "../src/harness/index.js";
import {
  deriveParamsHash,
  type ProtocolEffect,
} from "../src/protocol/reducer.js";
import { validate, type KnowledgeContract } from "../src/protocol/schemas.js";
import { run } from "./protocol/fixtures.js";

const repository = {
  commonDir: join(process.cwd(), ".git"),
  cwd: process.cwd(),
  identity: `local:${join(process.cwd(), ".git")}`,
  objectFormat: "sha1" as const,
  remoteUrls: [],
};

function base() {
  const { harness: _harness, ...legacyRun } = run();
  return {
    git: { repository },
    initialRun: { ...legacyRun, repositoryIdentity: repository.identity },
    nonce: "controller-config-test",
    schema: "sce.controller-config",
    scope: {
      beadsStoreIdentity: "store-1",
      gitRepositoryIdentity: repository.identity,
      integrationBranch: "main",
    },
    version: 1,
  };
}

const harnessSupport: HarnessSupport = {
  capabilities: {
    adapterVersion: HARNESS_VERSION,
    family: "codex",
    harnessVersion: HARNESS_VERSION,
    operations: {
      cancel: true,
      collect: true,
      controllerIdentity: true,
      inspect: true,
      launch: true,
      lookupByClientKey: true,
      poll: true,
      returnedModelIdentity: true,
    },
    schema: "sce.harness-capabilities",
    version: HARNESS_VERSION,
  },
  controller: {
    acceptedReturnedModels: ["frontier-1"],
    requestedModel: "frontier",
  },
  frontier: {
    acceptedReturnedModels: ["frontier-1"],
    requestedModel: "frontier",
  },
  schema: "sce.harness-support",
  version: HARNESS_VERSION,
  workhorse: {
    acceptedReturnedModels: ["workhorse-1"],
    requestedModel: "workhorse",
  },
};

function configuredBase() {
  const commitment = harnessSupportCommitment(harnessSupport);
  assert.equal(commitment.ok, true);
  if (!commitment.ok) throw new Error("invalid harness test support");
  return {
    ...base(),
    initialRun: {
      ...run(),
      harness: {
        adapterVersion: HARNESS_VERSION,
        family: "codex",
        harnessVersion: HARNESS_VERSION,
        supportCommitment: commitment.value,
      },
      repositoryIdentity: repository.identity,
    },
  };
}

const knowledgeContract: KnowledgeContract = {
  aliases: [
    {
      alias: "drive",
      canonicalRoot: "/mnt/knowledge-drive",
      markerFile: ".sce-drive",
      mountPolicy: "required",
      namespaceControl: "exclusive",
    },
  ],
  audience: "knowledge-audience",
  combinedVerificationCommands: [
    ["npm", "test"],
    ["npm", "run", "test:integration"],
  ],
  domainScope: "knowledge",
  gateTargets: [],
  humanDriver: "knowledge-owner",
  projectId: "knowledge-project",
  provenance: {
    eventsDirectory: "knowledge/events",
    generatedDirectory: "knowledge/generated",
    recordFormatVersion: 1,
    reproducibilityCommand: ["npm", "run", "reproduce"],
    rollupGeneratorCommand: ["npm", "run", "rollup"],
  },
  provenanceWorktreeRoot: "/tmp/sce-provenance",
};

function unresolvedKnowledgeContract() {
  return {
    aliases: knowledgeContract.aliases.map(
      ({ canonicalRoot: _canonicalRoot, ...alias }) => ({
        ...alias,
        mountPathVariable: "SCE_DRIVE_ROOT",
      }),
    ),
    audience: knowledgeContract.audience,
    domainScope: knowledgeContract.domainScope,
    gateTargets: knowledgeContract.gateTargets,
    humanDriver: knowledgeContract.humanDriver,
    projectId: knowledgeContract.projectId,
    provenance: {
      ...knowledgeContract.provenance,
      worktreeRootVariable: "SCE_PROVENANCE_ROOT",
    },
    verification: {
      fast: [knowledgeContract.combinedVerificationCommands[0]],
      integration: [["npm", "run", "test:integration"]],
      release: [["npm", "run", "test:release"]],
    },
  };
}

function knowledgeConfiguredBase() {
  const value = configuredBase();
  return {
    ...value,
    initialRun: { ...value.initialRun, knowledgeContract },
    knowledgeContract: unresolvedKnowledgeContract(),
    harnessSupport,
    topology: embedded(),
  };
}

function embedded() {
  return {
    bdExecutable: "/opt/sce/bd",
    childBeadIds: { "unit-1": "sce-1" },
    databaseDirectory: "/var/lib/sce/dolt/sce",
    doltExecutable: "/opt/sce/dolt",
    kind: "embedded",
    mode: "local-only",
    prefix: "sce",
    preflight: {
      payload: {
        beads: {
          contextSchemaVersion: 1,
          mode: "embedded",
          prefix: "sce",
          provenance: "embedded_config",
          toolVersion: "1.1.0",
        },
        git: {
          commonDir: repository.commonDir,
          identity: repository.identity,
          objectFormat: repository.objectFormat,
          topLevel: repository.cwd,
        },
        status: "ready",
      },
      schema: "sce.preflight",
      version: 1,
    },
    rootBeadId: "sce-root",
  };
}

function identity(topology: "external_server" | "managed_local_shared_server") {
  return {
    autoCommitPolicy: "off",
    credentialProvenance:
      topology === "external_server" ? "environment" : "managed_local_runtime",
    credentialReference: "writer-ref",
    database: "beads",
    endpoint: "127.0.0.1:3306",
    prefix: "sce",
    schema: "beads",
    topology,
    transportSecurity: "loopback_plaintext",
    workerCredentialReference: "worker-ref",
  };
}

function shared(topology: "external_server" | "managed_local_shared_server") {
  const common = {
    bdExecutable: "/opt/sce/bd",
    doltExecutable: "/opt/sce/dolt",
    identity: identity(topology),
    kind: "shared-server",
    rows: { childBeadIds: { "unit-1": "sce-1" }, rootBeadId: "sce-root" },
    workerEnvironment: "SCE_TEST_WORKER_PASSWORD",
    workerUser: "worker",
    workspace: "/controller",
    writerEnvironment: "SCE_TEST_WRITER_PASSWORD",
    writerUser: "writer",
  };
  return topology === "external_server"
    ? common
    : {
        ...common,
        dataDirectory: "/var/lib/sce/server",
        runtimeConfigHome: "/var/lib/sce/runtime/config",
        runtimeHome: "/var/lib/sce/runtime/home",
      };
}

async function withConfig(
  value: unknown,
  runTest: (path: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sce-controller-config-"));
  const path = join(directory, "controller.json");
  try {
    await writeFile(path, JSON.stringify(value), "utf8");
    await runTest(path);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("strict file loader composes explicit embedded and both shared-server variants", async () => {
  let embeddedPrefix: string | undefined;
  await withConfig({ ...base(), topology: embedded() }, async (path) => {
    const result = await createControllerConfigRunner(path, {
      composeEmbedded(_config, topology) {
        embeddedPrefix = topology.prefix;
        return async () => ({ status: "unavailable" }) as never;
      },
    });
    assert.equal(typeof result, "function");
  });
  assert.equal(embeddedPrefix, "sce");

  for (const topologyName of [
    "external_server",
    "managed_local_shared_server",
  ] as const) {
    let observed:
      { managed: boolean; passwords: readonly string[] } | undefined;
    await withConfig(
      { ...base(), topology: shared(topologyName) },
      async (path) => {
        const result = await createControllerConfigRunner(path, {
          composeShared(_config, topology, credentials) {
            observed = {
              managed: topology.managed,
              passwords: [
                credentials.writerPassword,
                credentials.workerPassword,
              ],
            };
            return Promise.resolve(
              async () => ({ status: "unavailable" }) as never,
            );
          },
          environment(name) {
            return name === "SCE_TEST_WRITER_PASSWORD"
              ? "writer-value"
              : "worker-value";
          },
        });
        assert.equal(typeof result, "function");
      },
    );
    assert.deepEqual(observed, {
      managed: topologyName === "managed_local_shared_server",
      passwords: ["writer-value", "worker-value"],
    });
  }
});

test("strict file loader refuses malformed, secret, identity, prefix, common-dir, and missing-env config", async () => {
  const cases: readonly unknown[] = [
    { ...base(), topology: { ...embedded(), prefix: "other" } },
    {
      ...base(),
      git: { repository: { ...repository, commonDir: "relative/.git" } },
      topology: embedded(),
    },
    {
      ...base(),
      topology: {
        ...shared("external_server"),
        identity: identity("managed_local_shared_server"),
      },
    },
    { ...base(), secret: "must-not-be-accepted", topology: embedded() },
  ];
  for (const value of cases) {
    await withConfig(value, async (path) => {
      assert.equal(await createControllerConfigRunner(path), undefined);
    });
  }
  await withConfig(
    { ...base(), topology: shared("external_server") },
    async (path) => {
      assert.equal(
        await createControllerConfigRunner(path, {
          environment: () => undefined,
          composeShared: async () => {
            throw new Error("missing environment must not compose");
          },
        }),
        undefined,
      );
    },
  );
});

test("configured harness support is strict, committed, and reaches composition", async () => {
  let received: HarnessSupport | undefined;
  await withConfig(
    {
      ...configuredBase(),
      harnessSupport,
      topology: embedded(),
    },
    async (path) => {
      const runner = await createControllerConfigRunner(path, {
        composeEmbedded(config) {
          received = config.harnessSupport;
          return async () => ({ status: "unavailable" }) as never;
        },
      });
      assert.equal(typeof runner, "function");
    },
  );
  assert.deepEqual(received, harnessSupport);

  const packet = createPacket({
    acceptance: ["acceptance-1"],
    baseOid: "a".repeat(40),
    mandatoryVerification: ["npm test"],
    ownedPaths: ["src"],
    role: "worker",
    unitId: "unit-1",
  });
  assert.equal(packet.ok, true);
  if (!packet.ok || received === undefined)
    throw new Error("missing configured harness support");
  const binding = {
    hash: packet.hash,
    payload: packet.payload,
    schema: packet.schema,
    version: packet.version,
  };
  const params = {
    branchRef: "sce/unit-1",
    packet: binding,
    promptHash: binding.hash,
    requestedModel: "workhorse",
    worktreePath: "/tmp/sce-worker",
  };
  const effect: ProtocolEffect = {
    effectId: "dispatch-effect",
    idempotencyKey: "dispatch-key",
    kind: "dispatch",
    params,
    paramsHash: deriveParamsHash("dispatch", params),
    schemaVersion: 1,
    unitId: "unit-1",
  };
  const configuredRun = configuredBase().initialRun;
  const adapter = createProductionRecoveryEffectAdapter({
    git: {
      repository,
      runner: async () => ({ exitCode: 1, signal: null, stdout: "" }),
    },
    harness: { support: received },
  });
  const tool = await adapter.execute(effect, {
    ...configuredRun,
    units: {
      ...configuredRun.units,
      "unit-1": {
        ...configuredRun.units["unit-1"]!,
        branchRef: "sce/unit-1",
        worktreePath: "/tmp/sce-worker",
      },
    },
  });
  assert.equal(tool.status, "tool_request");
  if (tool.status === "tool_request") {
    const request = validate<HarnessToolRequest>(
      HarnessToolRequestSchema,
      tool.toolRequest,
    );
    assert.equal(request.ok, true);
    if (!request.ok || request.value === undefined)
      throw new Error("missing harness tool request");
    assert.equal(request.value.operation, "launch");
    assert.deepEqual(request.value.request?.packet, binding);
    assert.equal(request.value.request?.promptHash, binding.hash);
  }

  await withConfig(
    { ...configuredBase(), topology: embedded() },
    async (path) => {
      assert.equal(await createControllerConfigRunner(path), undefined);
    },
  );
  await withConfig(
    {
      ...configuredBase(),
      harnessSupport: {
        ...harnessSupport,
        capabilities: {
          ...harnessSupport.capabilities,
          operations: {
            ...harnessSupport.capabilities.operations,
            collect: false,
          },
        },
      },
      topology: embedded(),
    },
    async (path) => {
      assert.equal(await createControllerConfigRunner(path), undefined);
    },
  );
});

test("knowledge authority resolves exact environment roots once and strips variable names", async () => {
  const calls: string[] = [];
  let received: KnowledgeContract | undefined;
  await withConfig(knowledgeConfiguredBase(), async (path) => {
    const runner = await createControllerConfigRunner(path, {
      composeEmbedded(config) {
        received = config.knowledgeContract;
        return async () => ({ status: "unavailable" }) as never;
      },
      environment(name) {
        calls.push(name);
        return name === "SCE_DRIVE_ROOT"
          ? knowledgeContract.aliases[0]!.canonicalRoot
          : name === "SCE_PROVENANCE_ROOT"
            ? knowledgeContract.provenanceWorktreeRoot
            : undefined;
      },
    });
    assert.equal(typeof runner, "function");
  });
  assert.deepEqual(received, knowledgeContract);
  assert.deepEqual(calls, ["SCE_DRIVE_ROOT", "SCE_PROVENANCE_ROOT"]);
  assert.equal(JSON.stringify(received).includes("mountPathVariable"), false);
  assert.equal(
    JSON.stringify(received).includes("worktreeRootVariable"),
    false,
  );
});

test("knowledge verification tiers concatenate fast then integration and exclude release", async () => {
  const value = knowledgeConfiguredBase();
  const expected = [
    ["npm", "test"],
    ["npm", "test"],
    ["npm", "run", "test:integration"],
  ];
  value.knowledgeContract.verification = {
    fast: [
      ["npm", "test"],
      ["npm", "test"],
    ],
    integration: [["npm", "run", "test:integration"]],
    release: [["npm", "run", "test:release"]],
  };
  value.initialRun.knowledgeContract = {
    ...knowledgeContract,
    combinedVerificationCommands: expected,
  };
  let received: KnowledgeContract | undefined;
  await withConfig(value, async (path) => {
    const runner = await createControllerConfigRunner(path, {
      composeEmbedded(config) {
        received = config.knowledgeContract;
        return async () => ({ status: "unavailable" }) as never;
      },
      environment: (name) =>
        name === "SCE_DRIVE_ROOT"
          ? "/mnt/knowledge-drive"
          : name === "SCE_PROVENANCE_ROOT"
            ? "/tmp/sce-provenance"
            : undefined,
    });
    assert.equal(typeof runner, "function");
  });
  assert.deepEqual(received?.combinedVerificationCommands, expected);
});

test("knowledge authority rejects resolved roots, bad environment, overlap, and contract drift", async () => {
  const validEnvironment = (name: string) =>
    name === "SCE_DRIVE_ROOT"
      ? "/mnt/knowledge-drive"
      : name === "SCE_PROVENANCE_ROOT"
        ? "/tmp/sce-provenance"
        : undefined;
  const directRoot = knowledgeConfiguredBase();
  const directAlias = {
    ...directRoot.knowledgeContract.aliases[0],
    canonicalRoot: "/mnt/knowledge-drive",
  };
  delete (directAlias as { mountPathVariable?: string }).mountPathVariable;
  const cases: readonly Readonly<{
    environment?: (name: string) => string | undefined;
    value: unknown;
  }>[] = [
    {
      value: {
        ...directRoot,
        knowledgeContract: {
          ...directRoot.knowledgeContract,
          aliases: [directAlias],
        },
      },
    },
    { environment: () => undefined, value: knowledgeConfiguredBase() },
    {
      environment: (name) =>
        name === "SCE_DRIVE_ROOT" ? "relative/drive" : "/tmp/provenance",
      value: knowledgeConfiguredBase(),
    },
    {
      environment: (name) =>
        name === "SCE_DRIVE_ROOT" ? "/" : "/tmp/provenance",
      value: knowledgeConfiguredBase(),
    },
    {
      environment: (name) =>
        name === "SCE_DRIVE_ROOT" ? "/mnt/drive/../drive" : "/tmp/provenance",
      value: knowledgeConfiguredBase(),
    },
    {
      environment: (name) =>
        name === "SCE_DRIVE_ROOT" ? "/tmp/secret_canary" : "/tmp/provenance",
      value: knowledgeConfiguredBase(),
    },
    {
      environment: (name) =>
        name === "SCE_DRIVE_ROOT"
          ? "/mnt/knowledge"
          : "/mnt/knowledge/provenance",
      value: knowledgeConfiguredBase(),
    },
    {
      value: {
        ...knowledgeConfiguredBase(),
        initialRun: {
          ...knowledgeConfiguredBase().initialRun,
          knowledgeContract: {
            ...knowledgeContract,
            combinedVerificationCommands: [["npm", "check"]],
          },
        },
      },
    },
    {
      value: {
        ...knowledgeConfiguredBase(),
        knowledgeContract: {
          ...unresolvedKnowledgeContract(),
          aliases: [
            ...unresolvedKnowledgeContract().aliases,
            unresolvedKnowledgeContract().aliases[0],
          ],
        },
      },
    },
    {
      value: {
        ...knowledgeConfiguredBase(),
        knowledgeContract: {
          ...unresolvedKnowledgeContract(),
          provenance: {
            ...unresolvedKnowledgeContract().provenance,
            worktreeRootVariable: "SCE_DRIVE_ROOT",
          },
        },
      },
    },
    {
      value: {
        ...knowledgeConfiguredBase(),
        knowledgeContract: {
          ...unresolvedKnowledgeContract(),
          unknown: true,
        },
      },
    },
  ];
  for (const [index, entry] of cases.entries())
    await withConfig(entry.value, async (path) => {
      assert.equal(
        await createControllerConfigRunner(path, {
          composeEmbedded: () => {
            throw new Error(`invalid case ${index} composed`);
          },
          environment: entry.environment ?? validEnvironment,
        }),
        undefined,
        `case ${index}`,
      );
    });
});
