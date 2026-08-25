import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createControllerConfigRunner } from "../../src/controller-config.js";

test("embedded example is accepted by the actual strict controller config parser", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sce-example-config-"));
  try {
    const path = join(directory, "controller.json");
    const example = JSON.parse(
      await readFile(
        resolve("examples/controller-config.embedded.json"),
        "utf8",
      ),
    );
    assert.equal(example.topology.mode, "local-only");
    assert.equal(example.git.remote, undefined);
    assert.equal(example.initialRun.authorityProfile, "local-change-only");
    assert.equal(example.initialRun.completionBoundary, "local-integration");
    assert.equal(example.initialRun.integrationProfile, "local-ff");
    const cwd = process.cwd();
    const commonDir = join(cwd, ".git");
    const identity = `local:${commonDir}`;
    example.git.repository = {
      ...example.git.repository,
      commonDir,
      cwd,
      identity,
    };
    example.scope = { ...example.scope, gitRepositoryIdentity: identity };
    example.initialRun = {
      ...example.initialRun,
      repositoryIdentity: identity,
    };
    example.topology.preflight.payload.git = {
      ...example.topology.preflight.payload.git,
      commonDir,
      identity,
      topLevel: cwd,
    };
    await writeFile(path, JSON.stringify(example));
    const runner = await createControllerConfigRunner(path, {
      composeEmbedded: () => async () => ({ status: "unavailable" }) as never,
    });
    assert.equal(typeof runner, "function");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
