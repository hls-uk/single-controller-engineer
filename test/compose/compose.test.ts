import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  classifySlotDocument,
  composeControllerConfig,
  executableVersionProblem,
  knowledgeContractFromManifest,
  type RepositoryObservation,
} from "../../src/compose/index.js";
import { createControllerConfigRunner } from "../../src/controller-config.js";
import { legalActions } from "../../src/protocol/actions.js";
import { canonicalJson } from "../../src/protocol/canonical.js";
import {
  knowledgeContractAwaitsFirstWave,
  reduce,
} from "../../src/protocol/reducer.js";
import { run } from "../protocol/fixtures.js";
import {
  DriveAliasSchema,
  KnowledgeContractSchema,
  type RepositoryRun,
} from "../../src/protocol/schemas.js";
import { deriveScopeCommitment } from "../../src/fencing/index.js";
import type { PreflightEnvelope } from "../../src/preflight/index.js";
import { parseCliArguments, runCli } from "../../src/cli.js";

/** The strict parser realpaths the Git common dir, so the fixture repository is this checkout. */
const TOP = realpathSync(process.cwd());
const STORE = "11111111-2222-4333-8444-555555555555";
const WORKTREE_ROOT = "/srv/sce-provenance";
const DRIVE_ROOT = "/srv/example-drive";
/** The manifest's declared mount variables, resolved as the host would. */
const ENVIRONMENT: Readonly<Record<string, string | undefined>> = {
  EX_DRIVE_ROOT: DRIVE_ROOT,
  EX_PROVENANCE_ROOT: WORKTREE_ROOT,
};

function preflight(
  overrides: Partial<{
    syncRemote: string;
    identity: string;
    mode: "embedded" | "external_server";
  }> = {},
): PreflightEnvelope {
  const sync =
    overrides.syncRemote === undefined
      ? {}
      : { syncRef: "refs/dolt/data", syncRemote: overrides.syncRemote };
  return {
    schema: "sce.preflight",
    version: 1,
    payload: {
      status: "ready",
      beads: {
        beadsDir: `${TOP}/.beads`,
        contextSchemaVersion: 1,
        database: "ex",
        mode: overrides.mode ?? "embedded",
        prefix: "ex",
        projectId: STORE,
        provenance:
          overrides.mode === "external_server"
            ? "external_server_flag"
            : "embedded_config",
        ...(overrides.mode === "external_server"
          ? { server: "db.example:3306" }
          : { storePath: `${TOP}/.beads/embeddeddolt` }),
        toolVersion: "1.1.0",
        ...sync,
      },
      git: {
        commonDir: `${TOP}/.git`,
        identity: overrides.identity ?? `local:${TOP}-remote.git`,
        objectFormat: "sha1",
        topLevel: TOP,
      },
    },
  } as PreflightEnvelope;
}

const manifest = {
  schema: "sce.knowledge-manifest",
  version: 1,
  projectId: "example",
  accessDomainId: "example.domain",
  audience: "example-internal",
  mode: "git-first",
  humanDriver: "Example Driver",
  driveAliases: [
    {
      alias: "example-drive",
      markerFile: ".sce-drive-root",
      mountPolicy: "optional",
      mountPathVariable: "EX_DRIVE_ROOT",
      namespaceControl: "exclusive",
    },
  ],
  artifactHomes: {
    agentInstructions: ["AGENTS.md"],
    knowledge: "knowledge",
    events: "provenance",
    generated: "generated",
    driveIncoming: "example-drive:incoming",
    driveRendered: "example-drive:rendered",
    credentials: "external",
    derivedIndexes: "rebuildable",
  },
  frontmatterSchemaPath: "schemas/page.schema.json",
  boundaryPolicy: {
    allowedWriteRoots: ["knowledge"],
    forbiddenPaths: ["archive"],
    forbiddenMarkers: ["MARKER"],
  },
  verification: {
    fast: [["node", "scripts/gate.mjs"]],
    integration: [["python3", "scripts/lint.py"]],
    release: [["node", "scripts/gate.mjs"]],
  },
  provenance: {
    eventsDirectory: "provenance",
    recordFormatVersion: 1,
    rollupGeneratorCommand: ["node", "scripts/rollup.mjs"],
    reproducibilityCommand: ["node", "scripts/check-generated.mjs"],
    worktreeRootVariable: "EX_PROVENANCE_ROOT",
  },
  materialisationTargets: [
    {
      sourcePattern: "knowledge/current/access-*.md",
      destinationAlias: "example-drive",
      destinationSubpath: "rendered/guidance",
      namingPolicy: "source-basename",
      sidecarRequired: true,
    },
  ],
  minimumVersions: { root: "0.1.0", playbook: "0.1.0", profile: "0.1.0" },
};

/** Replaces one manifest artifact home, leaving every other fact intact. */
function withHomes(homes: Readonly<Record<string, string>>): unknown {
  return {
    ...manifest,
    artifactHomes: { ...manifest.artifactHomes, ...homes },
  };
}

/** Replaces the single declared gate target with one candidate definition. */
function withTarget(target: Readonly<Record<string, unknown>>): unknown {
  return {
    ...manifest,
    materialisationTargets: [
      { ...manifest.materialisationTargets[0], ...target },
    ],
  };
}

/** Replaces the single declared drive alias with one candidate definition. */
function withAlias(alias: Readonly<Record<string, unknown>>): unknown {
  return {
    ...manifest,
    driveAliases: [{ ...manifest.driveAliases[0], ...alias }],
  };
}

/** Declares a second alias beside the one the artifact homes already name. */
function withSecondAlias(alias: Readonly<Record<string, unknown>>): unknown {
  return {
    ...manifest,
    driveAliases: [
      manifest.driveAliases[0],
      {
        ...manifest.driveAliases[0],
        alias: "second-drive",
        mountPathVariable: "EX_SECOND_ROOT",
        ...alias,
      },
    ],
  };
}

/** Declares `count` distinct aliases; the first is the declared home. */
function withAliasCount(count: number): unknown {
  return {
    ...manifest,
    driveAliases: Array.from({ length: count }, (_alias, index) =>
      index === 0
        ? manifest.driveAliases[0]
        : {
            ...manifest.driveAliases[0],
            alias: `extra-${index}`,
            mountPathVariable: `EX_EXTRA_${index}`,
          },
    ),
  };
}

/** The shipped checker, loaded the way a domain repository runs it. */
const checks = (await import(
  pathToFileURL(
    resolve(
      "skills/single-controller-knowledge/references/manifest/checks/lib.mjs",
    ),
  ).href
)) as {
  assertDriveVariables(manifest: unknown): void;
  assertSchema(
    schema: unknown,
    value: unknown,
    at: string,
    rootSchema: unknown,
  ): void;
  manifestSchemaPath: string;
  readSchema(path: string): Record<string, any>;
};

/** Loading the schema also proves it stays inside the checker's subset. */
const manifestSchema = checks.readSchema(checks.manifestSchemaPath);

/**
 * The shipped checker's verdict on a candidate manifest: the strict schema
 * plus the one drive-variable rule no schema keyword can state.  The
 * repository-wide semantics need a checkout and belong to the knowledge
 * example's own gate.
 */
function checkerAccepts(candidate: unknown): boolean {
  try {
    checks.assertSchema(manifestSchema, candidate, "$", manifestSchema);
    checks.assertDriveVariables(candidate);
    return true;
  } catch {
    return false;
  }
}

function observation(
  overrides: Partial<RepositoryObservation> = {},
): RepositoryObservation {
  return {
    bdExecutable: "/opt/bin/bd",
    branchHeads: { main: "a".repeat(40) },
    children: [],
    currentBranch: "main",
    doltExecutable: "/opt/bin/dolt",
    environment: (name) => ENVIRONMENT[name],
    manifest: undefined,
    manifestPath: undefined,
    preflight: preflight(),
    remotes: [],
    ...overrides,
  };
}

const identities = {
  fencingToken: "fence-test",
  incarnationId: "inc-test",
  nonce: "nonce-test",
  runId: "run-test",
};

test("a software repository composes a local-only embedded configuration the strict parser accepts", async () => {
  const result = composeControllerConfig(observation(), {
    harnessFamily: "claude",
    identities,
    rootBeadId: "ex-root",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const config = result.config as Record<string, any>;
  assert.equal(config.schema, "sce.controller-config");
  assert.equal(config.knowledgeContract, undefined);
  assert.equal(config.topology.mode, "local-only");
  assert.equal(config.topology.remote, undefined);
  assert.equal(
    config.topology.databaseDirectory,
    `${TOP}/.beads/embeddeddolt/ex`,
  );
  assert.equal(config.scope.beadsStoreIdentity, STORE);
  assert.equal(config.initialRun.state, "initializing");
  assert.equal(config.initialRun.controller.state, "unacquired");
  assert.equal(config.initialRun.controller.holder, "run-test/inc-test");
  assert.equal(config.initialRun.harness.family, "claude");
  assert.equal(config.git.remote, undefined);
  assert.deepEqual(result.summary.classification, {
    dispatchRecovery: "at-most-once-manual",
    tierEnforcement: "unavailable",
  });
  assert.equal(result.summary.firstRequest.command, "acquire-controller");
  assert.match(
    result.summary.firstRequest.request.event.idempotencyKey,
    /^sce:[0-9a-f]{64}$/u,
  );
  const again = composeControllerConfig(observation(), {
    harnessFamily: "claude",
    identities,
    rootBeadId: "ex-root",
  });
  assert.equal(again.ok, true);
  if (again.ok)
    assert.equal(canonicalJson(again.config), canonicalJson(result.config));
  const directory = await mkdtemp(join(tmpdir(), "sce-compose-"));
  try {
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(result.config));
    let composed = false;
    const runner = await createControllerConfigRunner(path, {
      composeEmbedded() {
        composed = true;
        return async () => ({ status: "unavailable" }) as never;
      },
    });
    assert.equal(typeof runner, "function");
    assert.equal(composed, true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a knowledge repository composes git-sync with the manifest contract and the matching remote", async () => {
  const result = composeControllerConfig(
    observation({
      manifest,
      manifestPath: `${TOP}/knowledge-manifest.json`,
      preflight: preflight({
        identity: "github.example/org/repo",
        syncRemote: "github.example/org/repo",
      }),
      remotes: [
        {
          name: "origin",
          normalized: "github.example/org/repo",
          url: "git@github.example:org/repo.git",
        },
      ],
    }),
    { harnessFamily: "codex", identities, rootBeadId: "ex-root" },
  );
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) return;
  const config = result.config as Record<string, any>;
  assert.equal(result.summary.knowledge, true);
  assert.equal(config.topology.mode, "git-sync");
  assert.deepEqual(config.topology.remote, {
    name: "origin",
    ref: "refs/dolt/data",
    url: "github.example/org/repo",
  });
  assert.deepEqual(config.git.repository.remoteUrls, [
    "git@github.example:org/repo.git",
  ]);
  assert.equal(config.knowledgeContract.domainScope, "example.domain");
  assert.equal(
    config.knowledgeContract.provenance.generatedDirectory,
    "generated",
  );
  assert.equal(
    config.knowledgeContract.provenance.worktreeRootVariable,
    "EX_PROVENANCE_ROOT",
  );
  assert.deepEqual(config.knowledgeContract.verification.fast, [
    ["node", "scripts/gate.mjs"],
  ]);
  assert.equal(config.initialRun.knowledgeContract, undefined);
  const directory = await mkdtemp(join(tmpdir(), "sce-compose-"));
  try {
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(result.config));
    const runner = await createControllerConfigRunner(path, {
      composeEmbedded() {
        return async () => ({ status: "unavailable" }) as never;
      },
      environment: (name) => ENVIRONMENT[name],
    });
    assert.equal(typeof runner, "function");
    const withoutEnvironment = await createControllerConfigRunner(path, {
      composeEmbedded() {
        return async () => ({ status: "unavailable" }) as never;
      },
      environment: () => undefined,
    });
    assert.equal(withoutEnvironment, undefined);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("composition refuses every ambiguous or unsupported observation with a named code", () => {
  const base = {
    harnessFamily: "claude" as const,
    identities,
    rootBeadId: "ex-root",
  };
  const cases: readonly [
    string,
    RepositoryObservation,
    Parameters<typeof composeControllerConfig>[1],
  ][] = [
    [
      "SCE_COMPOSE_PREFLIGHT_REFUSED",
      observation({
        preflight: {
          schema: "sce.preflight",
          version: 1,
          payload: { code: "PF_BD_UNAVAILABLE", status: "refused" },
        },
      }),
      base,
    ],
    [
      "SCE_COMPOSE_TOPOLOGY_UNSUPPORTED",
      observation({ preflight: preflight({ mode: "external_server" }) }),
      base,
    ],
    [
      "SCE_COMPOSE_OPTION_INVALID",
      observation(),
      { ...base, rootBeadId: "other-1" },
    ],
    [
      "SCE_COMPOSE_BRANCH_MISSING",
      observation({ currentBranch: undefined }),
      base,
    ],
    [
      "SCE_COMPOSE_SYNC_MODE_MISMATCH",
      observation(),
      { ...base, beadsMode: "git-sync" },
    ],
    [
      "SCE_COMPOSE_SYNC_MODE_MISMATCH",
      observation({
        preflight: preflight({ syncRemote: "github.example/org/repo" }),
      }),
      { ...base, beadsMode: "local-only" },
    ],
    [
      "SCE_COMPOSE_REMOTE_MISSING",
      observation({
        preflight: preflight({ syncRemote: "github.example/org/repo" }),
      }),
      base,
    ],
    [
      "SCE_COMPOSE_REMOTE_MISSING",
      observation(),
      { ...base, authorityProfile: "push-branch" },
    ],
    [
      "SCE_COMPOSE_MANIFEST_MISSING",
      observation(),
      { ...base, knowledge: true },
    ],
    [
      "SCE_COMPOSE_MANIFEST_INVALID",
      observation({ manifest: { schema: "other" }, manifestPath: "x" }),
      base,
    ],
    [
      "SCE_COMPOSE_ENVIRONMENT_MISSING",
      observation({
        manifest,
        manifestPath: "x",
        environment: () => undefined,
      }),
      base,
    ],
    [
      "SCE_COMPOSE_HARNESS_INVALID",
      observation(),
      {
        ...base,
        models: { controller: "same", frontier: "same", workhorse: "same" },
      },
    ],
  ];
  for (const [code, input, options] of cases) {
    const result = composeControllerConfig(input, options);
    assert.equal(result.ok, false, code);
    if (!result.ok) assert.equal(result.code, code);
  }
  const ignored = composeControllerConfig(
    observation({ manifest, manifestPath: "x" }),
    { ...base, knowledge: false },
  );
  assert.equal(ignored.ok, true);
  if (ignored.ok) {
    assert.equal(ignored.summary.knowledge, false);
    assert.equal(
      ignored.summary.warnings.some((warning) => warning.includes("ignored")),
      true,
    );
  }
});

test("manifest projection carries variable names, not resolved paths", () => {
  const projected = knowledgeContractFromManifest(manifest);
  assert.notEqual(projected, undefined);
  assert.deepEqual(projected?.variables, [
    "EX_DRIVE_ROOT",
    "EX_PROVENANCE_ROOT",
  ]);
  const contract = projected?.contract as Record<string, any>;
  assert.equal(contract.projectId, "example");
  assert.equal(contract.audience, "example-internal");
  assert.deepEqual(contract.gateTargets, manifest.materialisationTargets);
  assert.equal(contract.provenanceWorktreeRoot, undefined);
  assert.equal(
    knowledgeContractFromManifest({ ...manifest, version: 2 }),
    undefined,
  );
  assert.equal(
    knowledgeContractFromManifest({
      ...manifest,
      driveAliases: [{ alias: "drive", mountPathVariable: "lower-case" }],
    }),
    undefined,
  );
});

test("manifest projection refuses uncontained targets and undeclared drive homes", () => {
  const refused: readonly [string, unknown][] = [
    [
      "escaping source pattern",
      withTarget({ sourcePattern: "../outside/*.md" }),
    ],
    ["absolute source pattern", withTarget({ sourcePattern: "/etc/*.md" })],
    ["recursive source pattern", withTarget({ sourcePattern: "know/**/x.md" })],
    [
      "dot-segment source pattern",
      withTarget({ sourcePattern: "know/./x.md" }),
    ],
    ["backslash source pattern", withTarget({ sourcePattern: "know\\x.md" })],
    [
      "empty-segment source pattern",
      withTarget({ sourcePattern: "know//x.md" }),
    ],
    [
      "oversize source pattern",
      withTarget({ sourcePattern: `knowledge/${"a".repeat(200)}.md` }),
    ],
    ["undeclared destination alias", withTarget({ destinationAlias: "other" })],
    [
      "escaping destination subpath",
      withTarget({ destinationSubpath: "../rendered" }),
    ],
    ["unqualified drive home", withHomes({ driveIncoming: "archive" })],
    [
      "undeclared drive alias",
      withHomes({ driveIncoming: "other-drive:incoming" }),
    ],
    [
      "escaping drive subpath",
      withHomes({ driveIncoming: "example-drive:../escape" }),
    ],
    ["empty drive subpath", withHomes({ driveRendered: "example-drive:" })],
    [
      "identical drive homes",
      withHomes({ driveRendered: "example-drive:incoming" }),
    ],
    [
      "nested drive homes",
      withHomes({ driveRendered: "example-drive:incoming/rendered" }),
    ],
    [
      "case-folded drive homes",
      withHomes({ driveRendered: "example-drive:Incoming" }),
    ],
    [
      "case-folded nested drive homes",
      withHomes({ driveIncoming: "example-drive:RENDERED/queue" }),
    ],
    [
      "duplicate drive alias",
      {
        ...manifest,
        driveAliases: [...manifest.driveAliases, manifest.driveAliases[0]],
      },
    ],
  ];
  for (const [label, candidate] of refused)
    assert.equal(knowledgeContractFromManifest(candidate), undefined, label);
  const accepted = knowledgeContractFromManifest(
    withHomes({ driveIncoming: "example-drive:incoming/queue" }),
  );
  assert.notEqual(accepted, undefined, "a distinct contained home is accepted");
  // A Drive mount is case-insensitive, so the overlap comparison folds case:
  // it refuses a collision the mount would create, never a distinct pair.
  assert.notEqual(
    knowledgeContractFromManifest(
      withHomes({ driveIncoming: "example-drive:Incoming" }),
    ),
    undefined,
    "mixed case that stays distinct under the fold is accepted",
  );
});

test("the shipped manifest schema carries the engine's contract bounds", () => {
  const properties = manifestSchema.properties as Record<string, any>;
  const declared = properties.driveAliases.items.properties as Record<
    string,
    any
  >;
  const contract = KnowledgeContractSchema.properties as Record<string, any>;
  const drive = DriveAliasSchema.properties as Record<string, any>;
  assert.deepEqual(
    {
      aliasMaxLength: declared.alias.maxLength,
      aliasMinLength: declared.alias.minLength,
      aliasPattern: declared.alias.pattern,
      aliasesMaxItems: properties.driveAliases.maxItems,
      gateTargetsMaxItems: properties.materialisationTargets.maxItems,
      humanDriverMaxLength: properties.humanDriver.maxLength,
      humanDriverMaxUtf8Bytes: properties.humanDriver.maxUtf8Bytes,
      humanDriverMinLength: properties.humanDriver.minLength,
      markerMaxLength: declared.markerFile.maxLength,
      markerMaxUtf8Bytes: declared.markerFile.maxUtf8Bytes,
      markerMinLength: declared.markerFile.minLength,
    },
    {
      aliasMaxLength: drive.alias.maxLength,
      aliasMinLength: drive.alias.minLength,
      aliasPattern: drive.alias.pattern,
      aliasesMaxItems: contract.aliases.maxItems,
      gateTargetsMaxItems: contract.gateTargets.maxItems,
      humanDriverMaxLength: contract.humanDriver.maxLength,
      humanDriverMaxUtf8Bytes: contract.humanDriver.maxUtf8Bytes,
      humanDriverMinLength: contract.humanDriver.minLength,
      markerMaxLength: drive.markerFile.maxLength,
      markerMaxUtf8Bytes: drive.markerFile.maxUtf8Bytes,
      markerMinLength: drive.markerFile.minLength,
    },
  );
  /** The manifest's marker grammar is the engine's without its dot segments. */
  const engineMarker = new RegExp(drive.markerFile.pattern as string, "u");
  const manifestMarker = new RegExp(declared.markerFile.pattern as string, "u");
  for (const candidate of [".sce-drive-root", "MARKER", ".", "..", "-x", "a/b"])
    assert.equal(
      !manifestMarker.test(candidate) || engineMarker.test(candidate),
      true,
      candidate,
    );
  assert.deepEqual(
    [manifestMarker.test(".."), engineMarker.test("..")],
    [false, true],
  );
});

test("the manifest schema and the projection accept and refuse the same bounds", () => {
  const cases: readonly (readonly [string, unknown, boolean])[] = [
    ["the shipped fixture", manifest, true],
    ["an empty human driver", { ...manifest, humanDriver: "" }, false],
    ["a non-string human driver", { ...manifest, humanDriver: 5 }, false],
    [
      "a human driver at the bound",
      { ...manifest, humanDriver: "a".repeat(8_192) },
      true,
    ],
    [
      "a human driver one unit over",
      { ...manifest, humanDriver: "a".repeat(8_193) },
      false,
    ],
    [
      "a multibyte human driver at the byte bound",
      { ...manifest, humanDriver: "\u00e9".repeat(4_096) },
      true,
    ],
    [
      "a multibyte human driver over the byte bound",
      { ...manifest, humanDriver: "\u00e9".repeat(4_097) },
      false,
    ],
    ["sixty-four drive aliases", withAliasCount(64), true],
    ["sixty-five drive aliases", withAliasCount(65), false],
    ["a single-character alias", withSecondAlias({ alias: "d" }), true],
    ["a dash-leading alias", withSecondAlias({ alias: "-drive" }), false],
    ["a plain marker basename", withAlias({ markerFile: "MARKER" }), true],
    [
      "a marker at the basename bound",
      withAlias({ markerFile: "a".repeat(255) }),
      true,
    ],
    [
      "a marker one byte over",
      withAlias({ markerFile: "a".repeat(256) }),
      false,
    ],
    ["an empty marker", withAlias({ markerFile: "" }), false],
    ["an absent marker", withAlias({ markerFile: undefined }), false],
    ["a current-directory marker", withAlias({ markerFile: "." }), false],
    ["a parent-directory marker", withAlias({ markerFile: ".." }), false],
    ["a separated marker", withAlias({ markerFile: "nested/marker" }), false],
    ["a dash-leading marker", withAlias({ markerFile: "-marker" }), false],
    ["a spaced marker", withAlias({ markerFile: "drive marker" }), false],
    [
      "an underscore-leading mount variable",
      withAlias({ mountPathVariable: "_EX_DRIVE_ROOT" }),
      true,
    ],
    [
      "a single-character mount variable",
      withAlias({ mountPathVariable: "X" }),
      true,
    ],
    [
      "a mount variable at the bound",
      withAlias({ mountPathVariable: `A${"B".repeat(159)}` }),
      true,
    ],
    [
      "a mount variable one character over",
      withAlias({ mountPathVariable: `A${"B".repeat(160)}` }),
      false,
    ],
    [
      "a lower-case mount variable",
      withAlias({ mountPathVariable: "ex_drive_root" }),
      false,
    ],
    [
      "a shared mount variable",
      withSecondAlias({ mountPathVariable: "EX_DRIVE_ROOT" }),
      false,
    ],
    [
      "a worktree variable that also mounts an alias",
      {
        ...manifest,
        provenance: {
          ...manifest.provenance,
          worktreeRootVariable: "EX_DRIVE_ROOT",
        },
      },
      false,
    ],
    [
      "an underscore-leading worktree variable",
      {
        ...manifest,
        provenance: {
          ...manifest.provenance,
          worktreeRootVariable: "_EX_PROVENANCE_ROOT",
        },
      },
      true,
    ],
  ];
  for (const [label, candidate, accepted] of cases) {
    assert.equal(checkerAccepts(candidate), accepted, `checker: ${label}`);
    assert.equal(
      knowledgeContractFromManifest(candidate) !== undefined,
      accepted,
      `projection: ${label}`,
    );
  }
});

test("slot documents classify as unbound, bound, foreign or unreadable", () => {
  const scope = {
    beadsStoreIdentity: STORE,
    gitRepositoryIdentity: `local:${TOP}-remote.git`,
    integrationBranch: "main",
  };
  const slot = (extra: Record<string, unknown>) =>
    JSON.stringify([
      {
        id: "ex-merge-slot",
        labels: ["gt:slot"],
        title: "Merge Slot",
        ...extra,
      },
    ]);
  assert.equal(classifySlotDocument(slot({}), "ex", scope), "unbound");
  assert.equal(
    classifySlotDocument(slot({ design: "", external_ref: null }), "ex", scope),
    "unbound",
  );
  assert.equal(
    classifySlotDocument(
      slot({
        design: canonicalJson(scope),
        external_ref: `sce-scope:v1:${deriveScopeCommitment(scope)}`,
      }),
      "ex",
      scope,
    ),
    "bound",
  );
  assert.equal(
    classifySlotDocument(
      slot({ design: "{}", external_ref: "sce-scope:v1:other" }),
      "ex",
      scope,
    ),
    "foreign",
  );
  assert.equal(classifySlotDocument("not json", "ex", scope), "unreadable");
  assert.equal(
    classifySlotDocument(slot({ labels: [] }), "ex", scope),
    "unreadable",
  );
});

test("pinned tool versions are named exactly when they do not match", () => {
  assert.equal(
    executableVersionProblem(
      "bd version 1.1.0 (Homebrew)\n",
      "dolt version 2.2.1\n",
    ),
    undefined,
  );
  assert.equal(
    executableVersionProblem("bd version 1.1.0\n", "dolt version 2.2.1"),
    undefined,
  );
  const problem = executableVersionProblem(
    "bd version 1.0.9\n",
    "dolt version 2.1.10\nWarning\n",
  );
  assert.match(
    problem ?? "",
    /bd reports "bd version 1\.0\.9" but the engine pins 1\.1\.0/u,
  );
  assert.match(
    problem ?? "",
    /dolt reports "dolt version 2\.1\.10" but the engine pins 2\.2\.1/u,
  );
});

test("the compose-config CLI surface parses strictly and is listed in help", async () => {
  const parsed = parseCliArguments([
    "compose-config",
    "--harness",
    "claude",
    "--root-bead",
    "ex-root",
    "--output",
    "/srv/out/config.json",
    "--cwd",
    "/srv/example",
    "--authority",
    "push-branch",
    "--beads-mode",
    "git-sync",
    "--workhorse-model",
    "claude-opus-5",
    "--no-knowledge",
    "--bind-slot",
    "--overwrite",
    "--json",
  ]);
  assert.equal(parsed.kind, "compose");
  if (parsed.kind !== "compose") return;
  assert.equal(parsed.output, "/srv/out/config.json");
  assert.equal(parsed.cwd, "/srv/example");
  assert.equal(parsed.bindSlot, true);
  assert.equal(parsed.overwrite, true);
  assert.deepEqual(parsed.compose, {
    authorityProfile: "push-branch",
    beadsMode: "git-sync",
    harnessFamily: "claude",
    knowledge: false,
    models: { workhorse: "claude-opus-5" },
    rootBeadId: "ex-root",
  });
  for (const [argv, code] of [
    [
      ["compose-config", "--root-bead", "x", "--output", "/o.json"],
      "SCE_INVALID_OPTION_VALUE",
    ],
    [
      ["compose-config", "--harness", "claude", "--output", "/o.json"],
      "SCE_MISSING_OPTION_VALUE",
    ],
    [
      ["compose-config", "--harness", "claude", "--root-bead", "x"],
      "SCE_MISSING_OPTION_VALUE",
    ],
    [
      [
        "compose-config",
        "--harness",
        "claude",
        "--root-bead",
        "x",
        "--output",
        "relative.json",
      ],
      "SCE_INVALID_OPTION_VALUE",
    ],
    [
      [
        "compose-config",
        "--harness",
        "claude",
        "--root-bead",
        "x",
        "--output",
        "/o.json",
        "--knowledge",
        "--no-knowledge",
      ],
      "SCE_INVALID_OPTION_VALUE",
    ],
    [
      [
        "compose-config",
        "--harness",
        "claude",
        "--root-bead",
        "x",
        "--output",
        "/o.json",
        "--bogus",
      ],
      "SCE_UNKNOWN_OPTION",
    ],
    [["compose-config", "positional"], "SCE_UNEXPECTED_ARGUMENT"],
  ] as const) {
    const execution = await runCli([...argv]);
    assert.equal(execution.exitCode, 64, argv.join(" "));
    assert.equal(JSON.parse(execution.stdout).error.code, code, argv.join(" "));
  }
  const help = await runCli(["--help"]);
  assert.equal(
    JSON.parse(help.stdout).result.commands.includes("compose-config"),
    true,
  );
  const commandHelp = await runCli(["compose-config", "--help"]);
  assert.match(JSON.parse(commandHelp.stdout).result.usage, /--bind-slot/u);
});

const taskRecord = {
  acceptanceIds: ["ex-1:A1"],
  conflictDomains: ["preflight-tests"],
  dependencies: [],
  independence: "proven" as const,
  mandatoryVerification: ["npm run test:fast"],
  ownedPaths: ["test/preflight"],
  priority: 2,
  reservations: [],
  risk: "low" as const,
};

test("open children with strict $.sce_task records become planned initial units the reducer can wave", async () => {
  const result = composeControllerConfig(
    observation({
      children: [
        {
          id: "ex-2",
          issueType: "bug",
          status: "open",
          // Unsorted on purpose: the stored unit must be the canonical form.
          task: {
            ...taskRecord,
            mandatoryVerification: ["npm run typecheck", "npm run test:fast"],
            ownedPaths: ["test/preflight", "src/preflight"],
          },
        },
        {
          id: "ex-1",
          issueType: "task",
          status: "open",
          task: { ...taskRecord, dependencies: ["ex-2"] },
        },
        { id: "ex-3", issueType: "task", status: "closed", task: taskRecord },
        { id: "ex-4", issueType: "task", status: "open", task: undefined },
        { id: "ex-5", issueType: "epic", status: "open", task: taskRecord },
      ],
    }),
    { harnessFamily: "claude", identities, rootBeadId: "ex-root" },
  );
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) return;
  assert.deepEqual(result.summary.plannedUnits, ["ex-1", "ex-2"]);
  assert.deepEqual(
    result.summary.warnings.filter((warning) => warning.includes("ex-4")),
    ["ex-4 carries no $.sce_task record and is not planned as a unit."],
  );
  const run = (result.config as Record<string, any>)
    .initialRun as RepositoryRun;
  assert.deepEqual(Object.keys(run.units), ["ex-1", "ex-2"]);
  assert.equal(run.units["ex-1"]?.ordinal, 0);
  assert.equal(run.units["ex-2"]?.ordinal, 1);
  assert.equal(run.units["ex-1"]?.baseOid, "a".repeat(40));
  assert.equal(run.units["ex-1"]?.state, "planned");
  assert.deepEqual(run.units["ex-2"]?.taskMetadata, {
    ...taskRecord,
    mandatoryVerification: ["npm run test:fast", "npm run typecheck"],
    ownedPaths: ["src/preflight", "test/preflight"],
    unitId: "ex-2",
  });

  // The composed units survive the controller acquisition and form the first
  // wave: this is the path a fresh repository takes before any worktree.
  const first = result.summary.firstRequest.request.event;
  const acquired = reduce(run, first as never);
  assert.equal(acquired.ok, true);
  if (!acquired.ok) return;
  const effect = acquired.effects[0];
  assert.ok(effect !== undefined);
  const settled = reduce(acquired.nextState, {
    eventId: "acquired",
    expectedRevision: acquired.nextState.revision,
    effectId: effect.effectId,
    effectKind: "controller_acquire",
    holder: acquired.nextState.controller.holder,
    controllerFencingToken: acquired.nextState.controllerFencingToken,
    observationHash: "e".repeat(64),
    type: "controller_acquired",
  });
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  assert.deepEqual(
    legalActions(settled.nextState).map((action) => action.type),
    ["wave_planned"],
  );
  const waved = reduce(settled.nextState, {
    eventId: "wave",
    expectedRevision: settled.nextState.revision,
    type: "wave_planned",
    waveId: "wave-1",
    tasks: Object.values(settled.nextState.units).map(
      (unit) => unit.taskMetadata!,
    ),
  });
  assert.equal(waved.ok, true, waved.ok ? "" : JSON.stringify(waved));
  if (!waved.ok) return;
  assert.deepEqual(waved.nextState.wave.unitIds, ["ex-2"]);
  // Planning rewrites nothing: every composed unit is already canonical, so
  // the wave checkpoint carries no child row whose revision did not advance.
  assert.deepEqual(waved.nextState.units, settled.nextState.units);
});

test("an invalid or dangling $.sce_task record refuses the composition", async () => {
  const invalid = composeControllerConfig(
    observation({
      children: [
        {
          id: "ex-1",
          issueType: "task",
          status: "open",
          task: { ...taskRecord, risk: "unknown" },
        },
      ],
    }),
    { harnessFamily: "claude", identities, rootBeadId: "ex-root" },
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "SCE_COMPOSE_UNIT_INVALID");
  const dangling = composeControllerConfig(
    observation({
      children: [
        {
          id: "ex-1",
          issueType: "task",
          status: "open",
          task: { ...taskRecord, dependencies: ["ex-9"] },
        },
      ],
    }),
    { harnessFamily: "claude", identities, rootBeadId: "ex-root" },
  );
  assert.equal(dangling.ok, false);
  if (!dangling.ok) assert.match(dangling.message, /ex-9/u);
  const unbased = composeControllerConfig(
    observation({
      branchHeads: {},
      children: [
        { id: "ex-1", issueType: "task", status: "open", task: taskRecord },
      ],
    }),
    { harnessFamily: "claude", identities, rootBeadId: "ex-root" },
  );
  assert.equal(unbased.ok, false);
  if (!unbased.ok) assert.equal(unbased.code, "SCE_COMPOSE_UNIT_INVALID");
});

test("a knowledge contract may accompany any run that has not planned its first wave", () => {
  const pristine = {
    ...run([]),
    revision: 0,
    state: "initializing" as const,
    wave: { id: "w", unitIds: [] },
  };
  pristine.controller = { ...pristine.controller, state: "unacquired" };
  assert.equal(knowledgeContractAwaitsFirstWave(pristine), true);
  assert.equal(knowledgeContractAwaitsFirstWave(run([])), true);
  const plannedOnly = { ...run(), wave: { id: "w", unitIds: [] } };
  assert.equal(knowledgeContractAwaitsFirstWave(plannedOnly), true);
  assert.equal(knowledgeContractAwaitsFirstWave(run()), false);
});
