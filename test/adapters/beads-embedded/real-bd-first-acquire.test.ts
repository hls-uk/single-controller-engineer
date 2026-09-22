import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  DoltProjectionPersistence,
  EmbeddedBeadsAdapter,
  PinnedBdEmbeddedProcess,
} from "../../../src/adapters/beads-embedded/index.js";
import { runCli } from "../../../src/cli.js";

// Release-tier evidence for sce-59r on the pinned real bd/Dolt: the first
// acquire-controller of a fresh embedded store, driven exactly as
// docs/getting-started.md section 4 describes, must complete although every
// bd write is its own Dolt commit under auto-commit and therefore moves the
// head past the planned slot transition before it executes.

const execute = promisify(execFile);
const BD = "/opt/homebrew/bin/bd";
const DOLT = "/opt/homebrew/bin/dolt";

async function run(cwd: string, command: string, args: readonly string[]) {
  return execute(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      DARWIN_USER_TEMP_DIR: process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
      HOME: process.env.HOME ?? "/private/tmp",
      LANG: "C",
      LC_ALL: "C",
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? "/private/tmp",
      TZ: "UTC",
    },
    maxBuffer: 262_144,
    timeout: 30_000,
  });
}

async function json(cwd: string, args: readonly string[]) {
  const { stdout } = await run(cwd, BD, args);
  return JSON.parse(stdout) as unknown;
}

async function freshRepository(
  root: string,
  remote: string | undefined,
): Promise<string> {
  // Preflight requires at least one Git remote in either mode; `remote`
  // selects the Beads topology only: undefined leaves bd's sync.remote empty
  // (local-only), a path makes that bare repository the Dolt data remote.
  const repository = join(root, "repository");
  const origin = remote ?? join(root, "origin.git");
  await run(root, "git", ["init", "-q", "-b", "main", repository]);
  await run(repository, "git", [
    "config",
    "user.email",
    "test@example.invalid",
  ]);
  await run(repository, "git", ["config", "user.name", "test"]);
  await run(repository, "git", ["commit", "--allow-empty", "-qm", "initial"]);
  await run(root, "git", ["init", "-q", "--bare", "-b", "main", origin]);
  await run(repository, "git", ["remote", "add", "origin", `file://${origin}`]);
  await run(repository, "git", ["push", "-q", "origin", "main"]);
  await run(repository, BD, [
    "init",
    "--non-interactive",
    "--skip-agents",
    "--skip-hooks",
    "-p",
    "sce",
    "--remote",
    remote === undefined ? "" : `file://${remote}`,
  ]);
  await json(repository, ["merge-slot", "create", "--json"]);
  await json(repository, ["create", "--id", "sce-root", "root", "--json"]);
  // One open child with a strict task record becomes the first planned unit.
  await json(repository, [
    "create",
    "--id",
    "sce-unit-1",
    "unit 1",
    "--metadata",
    JSON.stringify({
      sce_task: {
        acceptanceIds: ["sce-unit-1:A1"],
        conflictDomains: ["docs"],
        dependencies: [],
        independence: "proven",
        mandatoryVerification: ["npm run test:fast"],
        ownedPaths: ["docs"],
        priority: 2,
        reservations: [],
        risk: "low",
      },
    }),
    "--json",
  ]);
  await json(repository, [
    "update",
    "sce-unit-1",
    "--parent",
    "sce-root",
    "--json",
  ]);
  return repository;
}

async function firstAcquireCompletes(remote: string | undefined, root: string) {
  const repository = await freshRepository(root, remote);
  const config = join(root, "controller-config.json");
  const composed = await runCli([
    "compose-config",
    "--harness",
    "claude",
    "--root-bead",
    "sce-root",
    "--output",
    config,
    "--cwd",
    repository,
    "--bd-executable",
    BD,
    "--dolt-executable",
    DOLT,
    "--bind-slot",
    "--json",
  ]);
  assert.equal(composed.response.ok, true, composed.stdout);
  if (!composed.response.ok) throw new Error("unreachable");
  const summary = composed.response.result as Record<string, unknown>;
  assert.equal(summary.slotScope, "bound");
  assert.equal(
    summary.doltSync,
    remote === undefined ? "local-only" : "in-sync",
  );
  // Harness classification warnings are expected; slot binding and Dolt sync
  // must not warn, or the first acquire is quarantined or ambiguous by design.
  assert.deepEqual(
    (summary.warnings as readonly string[]).filter(
      (warning) => warning.includes("merge-slot") || warning.includes("Dolt"),
    ),
    [],
  );
  const first = summary.firstRequest as Record<string, unknown>;
  assert.equal(first.command, "acquire-controller");
  assert.deepEqual(summary.plannedUnits, ["sce-unit-1"]);
  const document = JSON.parse(await readFile(config, "utf8")) as {
    initialRun: { controller: { holder: string } };
    topology: { mode: string };
  } & Record<string, unknown>;
  assert.equal(
    document.topology.mode,
    remote === undefined ? "local-only" : "git-sync",
  );

  const acquired = await runCli([
    "acquire-controller",
    "--controller-config",
    config,
    "--json",
    "--request",
    JSON.stringify(first.request),
  ]);
  assert.equal(acquired.response.ok, true, acquired.stdout);
  if (!acquired.response.ok) throw new Error("unreachable");
  // The bootstrap acquire persists the intent, executes the slot transition,
  // and settles its observation in one call: revision 2, reconciled.
  assert.deepEqual(
    acquired.response.result,
    { revision: 2, status: "reconciled" },
    acquired.stdout,
  );

  // With a planned unit the acquired run's next legal action is the wave.
  const next = await runCli(["next", "--controller-config", config, "--json"]);
  assert.equal(next.response.ok, true, next.stdout);
  if (!next.response.ok) throw new Error("unreachable");
  assert.deepEqual(
    (next.response.result.legalActions as readonly { type: string }[]).map(
      (action) => action.type,
    ),
    ["wave_planned"],
  );

  const status = await runCli([
    "status",
    "--controller-config",
    config,
    "--json",
  ]);
  assert.equal(status.response.ok, true, status.stdout);
  if (!status.response.ok) throw new Error("unreachable");
  assert.equal(status.response.result.state, "active");
  assert.deepEqual(status.response.result.ambiguities, []);
  assert.equal(status.response.result.effectCount, 1);

  const slot = (await json(repository, [
    "show",
    "sce-merge-slot",
    "--long",
    "--json",
  ])) as readonly Record<string, unknown>[];
  assert.equal(slot[0]?.status, "in_progress");
  assert.deepEqual(slot[0]?.metadata, {
    holder: document.initialRun.controller.holder,
  });
  const database = join(repository, ".beads", "embeddeddolt", "sce");
  const pending = await run(database, DOLT, [
    "sql",
    "-r",
    "json",
    "-q",
    "SELECT * FROM dolt_status",
  ]);
  assert.deepEqual(JSON.parse(pending.stdout), {});

  // sce-296.1: journal commits land above the slot commit under auto-commit
  // (an ambiguity record, a checkpoint, an unrelated bd write). The persisted
  // transition must still be provable afterwards, or an ambiguous act can
  // never be reconciled and the run blocks forever.
  await json(repository, [
    "create",
    "--id",
    "sce-after-1",
    "after 1",
    "--json",
  ]);
  await json(repository, [
    "create",
    "--id",
    "sce-after-2",
    "after 2",
    "--json",
  ]);
  if (remote !== undefined) await run(repository, BD, ["dolt", "push"]);
  const shown = (await json(repository, ["show", "sce-root", "--json"])) as
    readonly Record<string, unknown>[] | Record<string, unknown>;
  const rootRow = Array.isArray(shown) ? shown[0] : shown;
  assert.ok(rootRow !== undefined);
  const journal = (
    rootRow.metadata as {
      sce: { projection: { run: { effectJournal: readonly any[] } } };
    }
  ).sce.projection.run.effectJournal;
  assert.equal(journal.length, 1);
  const entry = journal[0];
  assert.ok(entry !== undefined);
  assert.equal(entry.status, "observed");
  const transition = entry.slotTransition;
  const topology = document.topology as unknown as {
    bdExecutable: string;
    databaseDirectory: string;
    doltExecutable: string;
    mode: "local-only" | "git-sync";
    preflight: never;
    prefix: string;
    remote?: { name: string; ref: string; url: string };
    rootBeadId: string;
  };
  const full = document as unknown as {
    git: { repository: { cwd: string } };
    scope: never;
  };
  const process = new PinnedBdEmbeddedProcess({
    bdExecutable: topology.bdExecutable,
    cwd: full.git.repository.cwd,
    databaseDirectory: topology.databaseDirectory,
    doltExecutable: topology.doltExecutable,
    prefix: topology.prefix,
    projections: new DoltProjectionPersistence({
      childIssueId: () => undefined,
      databaseDirectory: topology.databaseDirectory,
      doltExecutable: topology.doltExecutable,
      rootIssueId: topology.rootBeadId,
    }),
    scope: full.scope,
    ...(topology.remote === undefined ? {} : { remote: topology.remote }),
  });
  assert.deepEqual(
    await process.execute({ kind: "slot_transition", intent: transition }),
    { kind: "slot_transition", value: "observed" },
  );
  const adapter = new EmbeddedBeadsAdapter({
    holder: document.initialRun.controller.holder,
    mode: topology.mode,
    prefix: topology.prefix,
    preflight: topology.preflight,
    process,
    rootIssueId: topology.rootBeadId,
    scope: full.scope,
  });
  assert.deepEqual(await adapter.reconcileControllerTransition(transition), {
    status: "observed",
  });
}

test("first acquire-controller completes on a fresh local-only embedded store", async () => {
  const root = await mkdtemp("/private/tmp/sce-first-acquire-local-");
  try {
    await firstAcquireCompletes(undefined, root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("first acquire-controller completes on a fresh git-sync embedded store", async () => {
  const root = await mkdtemp("/private/tmp/sce-first-acquire-sync-");
  try {
    await firstAcquireCompletes(join(root, "remote.git"), root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
