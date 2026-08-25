import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createControllerConfigRunner } from "../src/controller-config.js";
import { run } from "./protocol/fixtures.js";

const repository = {
  commonDir: join(process.cwd(), ".git"),
  cwd: process.cwd(),
  identity: `local:${join(process.cwd(), ".git")}`,
  objectFormat: "sha1",
  remoteUrls: [],
};

function base() {
  return {
    git: { repository },
    initialRun: { ...run(), repositoryIdentity: repository.identity },
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
