import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

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
  const document = JSON.parse(await readFile(config, "utf8")) as {
    initialRun: { controller: { holder: string } };
    topology: { mode: string };
  };
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
