import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createControllerConfigRunner } from "../../src/controller-config.js";
import { parseHarnessSupport } from "../../src/harness/index.js";
import { canonicalJson, type JsonValue } from "../../src/protocol/canonical.js";
import { sha256 } from "../../src/protocol/evidence.js";

const CODEX_EXAMPLE = "examples/controller-config.embedded.json";
const CLAUDE_EXAMPLE = "examples/controller-config.claude-embedded.json";

async function readExample(path: string) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

/**
 * Every shipped example is local-only and carries no remote authority. The
 * repository proofs are rebound to this checkout because the parser compares
 * the declared identity against an observed Git repository.
 */
function localOnlyExample(example: any) {
  assert.equal(example.topology.mode, "local-only");
  assert.equal(example.git.remote, undefined);
  assert.equal(example.initialRun.authorityProfile, "local-change-only");
  assert.equal(example.initialRun.completionBoundary, "local-integration");
  assert.equal(example.initialRun.integrationProfile, "local-ff");
  const cwd = process.cwd();
  const commonDir = join(cwd, ".git");
  const identity = `local:${commonDir}`;
  return {
    ...example,
    git: {
      ...example.git,
      repository: { ...example.git.repository, commonDir, cwd, identity },
    },
    initialRun: { ...example.initialRun, repositoryIdentity: identity },
    scope: { ...example.scope, gitRepositoryIdentity: identity },
    topology: {
      ...example.topology,
      preflight: {
        ...example.topology.preflight,
        payload: {
          ...example.topology.preflight.payload,
          git: {
            ...example.topology.preflight.payload.git,
            commonDir,
            identity,
            topLevel: cwd,
          },
        },
      },
    },
  };
}

/** Runs one config through the exact acceptance path the CLI uses. */
async function accepted(example: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "sce-example-config-"));
  try {
    const path = join(directory, "controller.json");
    await writeFile(path, JSON.stringify(example));
    return await createControllerConfigRunner(path, {
      composeEmbedded: () => async () => ({ status: "unavailable" }) as never,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

/** Dotted paths whose values differ, so a mirror can be proven exactly. */
function differingPaths(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
  prefix = "",
): string[] {
  if (left === undefined || right === undefined) return [prefix];
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) ||
    Array.isArray(right)
  )
    return canonicalJson(left) === canonicalJson(right) ? [] : [prefix];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .sort()
    .flatMap((key) =>
      differingPaths(
        left[key],
        right[key],
        prefix === "" ? key : `${prefix}.${key}`,
      ),
    );
}

test("embedded example is accepted by the actual strict controller config parser", async () => {
  const example = localOnlyExample(await readExample(CODEX_EXAMPLE));
  assert.equal(typeof (await accepted(example)), "function");
});

test("the claude embedded example mirrors the codex example except its harness binding", async () => {
  const codex = await readExample(CODEX_EXAMPLE);
  const claude = await readExample(CLAUDE_EXAMPLE);
  // The mirror changes the harness support matrix plus exactly the run fields
  // the parser and the harness adapter bind to it: nothing about topology,
  // scope, git, fencing, or journal state may drift between the examples.
  assert.deepEqual(differingPaths(codex, claude), [
    "harnessSupport.capabilities.family",
    "harnessSupport.capabilities.operations.controllerIdentity",
    "harnessSupport.capabilities.operations.lookupByClientKey",
    "harnessSupport.controller.acceptedReturnedModels",
    "harnessSupport.controller.requestedModel",
    "harnessSupport.frontier.acceptedReturnedModels",
    "harnessSupport.frontier.requestedModel",
    "harnessSupport.workhorse.acceptedReturnedModels",
    "harnessSupport.workhorse.requestedModel",
    "initialRun.controller.requestedModel",
    "initialRun.controller.returnedModel",
    "initialRun.harness.family",
    "initialRun.harness.supportCommitment",
  ]);
  assert.equal(claude.harnessSupport.capabilities.family, "claude");
  assert.equal(claude.initialRun.harness.family, "claude");
  assert.deepEqual(claude.harnessSupport.capabilities.operations, {
    cancel: true,
    collect: true,
    controllerIdentity: false,
    inspect: true,
    launch: true,
    lookupByClientKey: false,
    poll: true,
    returnedModelIdentity: true,
  });
  for (const [tier, requested] of [
    ["controller", "claude-fable-5"],
    ["frontier", "claude-fable-5"],
    ["workhorse", "claude-opus-5"],
  ] as const) {
    assert.equal(claude.harnessSupport[tier].requestedModel, requested);
    assert.deepEqual(claude.harnessSupport[tier].acceptedReturnedModels, [
      requested,
    ]);
  }
  // The controller identity a run records must be the tier the matrix routes,
  // and the durable commitment is the canonical digest of the matrix itself.
  assert.equal(
    claude.initialRun.controller.requestedModel,
    claude.harnessSupport.controller.requestedModel,
  );
  assert.equal(
    claude.initialRun.controller.returnedModel,
    claude.harnessSupport.controller.acceptedReturnedModels[0],
  );
  for (const example of [codex, claude]) {
    assert.equal(
      example.initialRun.harness.supportCommitment,
      sha256(canonicalJson(example.harnessSupport)),
    );
  }
});

test("the claude example is refused fail-closed only for its at-most-once capability profile", async () => {
  const claude = localOnlyExample(await readExample(CLAUDE_EXAMPLE));
  // `parseHarnessSupport` admits one profile: a complete trusted lifecycle.
  // A harness that cannot look a launch up by client key and cannot prove the
  // active controller tier is refused there, so the whole config is refused —
  // the parser never returns a partially trusted runner.
  assert.deepEqual(parseHarnessSupport(claude.harnessSupport), {
    ok: false,
    reason: "harness lacks a complete trusted lifecycle capability",
  });
  assert.equal(await accepted(claude), undefined);
  // Positive control: every other field of the example is already accepted by
  // the same strict parser, so the refusal is caused by exactly those two
  // capability bits and by nothing else in the mirrored config.
  const trusted = {
    ...claude,
    harnessSupport: {
      ...claude.harnessSupport,
      capabilities: {
        ...claude.harnessSupport.capabilities,
        operations: {
          ...claude.harnessSupport.capabilities.operations,
          controllerIdentity: true,
          lookupByClientKey: true,
        },
      },
    },
  };
  assert.equal(parseHarnessSupport(trusted.harnessSupport).ok, true);
  assert.equal(
    typeof (await accepted({
      ...trusted,
      initialRun: {
        ...trusted.initialRun,
        harness: {
          ...trusted.initialRun.harness,
          supportCommitment: sha256(canonicalJson(trusted.harnessSupport)),
        },
      },
    })),
    "function",
  );
});
