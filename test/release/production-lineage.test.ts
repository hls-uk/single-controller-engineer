import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  isPinnedCloneMergeDelta,
  PinnedBdEmbeddedProcess,
} from "../../src/adapters/beads-embedded/index.js";
import {
  executableVersionProblem,
  findExecutable,
  observeRepository,
} from "../../src/compose/index.js";

const scope = {
  beadsStoreIdentity: "release-lineage-store",
  gitRepositoryIdentity: "release-lineage-repository",
  integrationBranch: "main",
};
const execute = promisify(execFile);

async function executable(
  path: string,
  lines: readonly string[],
): Promise<void> {
  await writeFile(path, lines.join("\n"), { mode: 0o700 });
  await chmod(path, 0o700);
}

test("production clone-lineage proof accepts exactly 64 permitted metadata edges", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-release-lineage-"));
  try {
    const bd = join(root, "bd");
    const dolt = join(root, "dolt");
    const oid = (value: number) => value.toString(16).padStart(32, "0");
    const cloneDelta = Buffer.from(
      JSON.stringify({
        tables: [
          {
            data_diff: [
              {
                from_row: { key: "clone_id", value: "0123456789abcdef" },
                to_row: { key: "clone_id", value: "fedcba9876543210" },
              },
              {
                from_row: {
                  key: "last_import_time",
                  value: "2026-08-25T02:37:07+01:00",
                },
                to_row: {
                  key: "last_import_time",
                  value: "2026-08-25T02:37:10+01:00",
                },
              },
            ],
            name: "metadata",
          },
        ],
      }),
      "utf8",
    ).toString("base64");
    assert.equal(
      isPinnedCloneMergeDelta(
        Buffer.from(cloneDelta, "base64").toString("utf8"),
      ),
      true,
    );
    const remote = oid(164);
    const parents = new Map<string, readonly string[]>();
    const diffs: string[] = [];
    const ancestorCases: string[] = [];
    for (let edge = 64; edge >= 1; edge -= 1) {
      const head = oid(edge);
      const authority = oid(100 + edge);
      const next = edge === 1 ? [] : [oid(edge - 1)];
      parents.set(head, [authority, ...next]);
      ancestorCases.push(
        `    *"parent_hash = '${authority}'"*) printf '{"rows":[{"matches":1}]}' ;;`,
      );
      diffs.push(
        `  if [ "$5" = "${authority}" ] && [ "$6" = "${head}" ]; then printf '%s' '${cloneDelta}' | base64 -D 2>/dev/null || printf '%s' '${cloneDelta}' | base64 -d; exit 0; fi`,
      );
    }
    const parentCases = [...parents.entries()].map(([head, values]) => {
      const encoded = Buffer.from(
        JSON.stringify({
          rows: values.map((parent_hash, parent_index) => ({
            parent_hash,
            parent_index,
          })),
        }),
        "utf8",
      ).toString("base64");
      return `    *"SELECT parent_hash, parent_index FROM dolt_commit_ancestors WHERE commit_hash = '${head}'"*) printf '%s' '${encoded}' | base64 -D 2>/dev/null || printf '%s' '${encoded}' | base64 -d ;;`;
    });
    await executable(bd, ["#!/bin/sh", 'printf "bd version 1.1.0\\n"']);
    await executable(dolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
      'if [ "$1" = "diff" ]; then',
      ...diffs,
      "  exit 1",
      "fi",
      'if [ "$1" = "sql" ]; then',
      '  case "$5" in',
      ...ancestorCases,
      ...parentCases,
      "    *) exit 1 ;;",
      "  esac",
      "  exit 0",
      "fi",
      "exit 1",
    ]);
    const process = new PinnedBdEmbeddedProcess({
      bdExecutable: bd,
      cwd: root,
      databaseDirectory: root,
      doltExecutable: dolt,
      prefix: "sce",
      projections: {
        async discover() {
          return undefined;
        },
        async discoverAt() {
          return undefined;
        },
        matchesBatchDelta() {
          return false;
        },
        async mutate() {
          return { kind: "mutation", value: "quarantined" } as const;
        },
        async readback() {
          return undefined;
        },
      },
      remote: {
        name: "origin",
        ref: "refs/dolt/data",
        url: "git+file://lineage.test/repo",
      },
      scope,
    });
    const proof = process as unknown as {
      exactPinnedCloneDelta(from: string, to: string): Promise<boolean>;
      provePinnedCloneLineage(
        localHead: string,
        authoritativeHead: string,
      ): Promise<boolean>;
    };
    const direct = await execute(dolt, [
      "diff",
      "--data",
      "-r",
      "json",
      oid(101),
      oid(1),
    ]);
    assert.equal(isPinnedCloneMergeDelta(direct.stdout), true, direct.stdout);
    assert.equal(await proof.exactPinnedCloneDelta(oid(101), oid(1)), true);
    assert.equal(await proof.provePinnedCloneLineage(oid(1), oid(101)), true);
    assert.equal(await proof.provePinnedCloneLineage(oid(64), remote), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

/** The environment the engine's own sanitized Git runner pins. */
const sanitizedGit = {
  GIT_ATTR_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
  HOME: "/nonexistent",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
  TZ: "UTC",
  XDG_CONFIG_HOME: "/nonexistent",
};

/** The untracked and modified paths the engine's own Git status would read. */
async function sanitizedStatusPaths(cwd: string): Promise<string[]> {
  const { stdout } = await execute(
    "/usr/bin/git",
    ["status", "--porcelain=v1", "-z"],
    { cwd, encoding: "utf8", env: sanitizedGit, timeout: 15_000 },
  );
  return stdout
    .split("\u0000")
    .filter((record) => record.length > 0)
    .map((record) => record.slice(3));
}

/**
 * sce-296.22 A2. `bd` resolves `~` itself, so a child spawned without HOME
 * writes its configuration into a literal `~` directory under the repository;
 * the engine's sanitized Git status then reports an untracked entry and every
 * integrate refuses until an operator deletes it. This runs the whole
 * host-touching half of `sce compose-config` against the real pinned `bd` in a
 * fresh repository under an isolated home, and reads the result back with the
 * same sanitized status the Git adapter uses.
 *
 * It lives beside the lineage proof because the triage gate claims every suite
 * for exactly one tier by name and `test/release` is the tier that may spawn
 * real tools; a file of its own would have to be triaged in
 * `test/eval/release-manifest.test.ts` as well.
 */
test("compose-config against the pinned bd leaves no literal ~ in the checkout", async (t) => {
  const bd = await findExecutable("bd");
  const dolt = await findExecutable("dolt");
  if (bd === undefined || dolt === undefined) {
    t.skip("the pinned bd and dolt are not on PATH (sce-296.22 A2)");
    return;
  }
  const versions = executableVersionProblem(
    (await execute(bd, ["--version"], { encoding: "utf8" })).stdout,
    (await execute(dolt, ["version"], { encoding: "utf8" })).stdout,
  );
  if (versions !== undefined) {
    t.skip(`tool versions are not the pinned pair: ${versions}`);
    return;
  }

  const root = await mkdtemp("/private/tmp/sce-release-compose-home-");
  const home = join(root, "home");
  const repository = join(root, "repository");
  const control = join(root, "control");
  const originalHome = process.env.HOME;
  const isolated = {
    cwd: repository,
    encoding: "utf8" as const,
    env: { HOME: home, LANG: "C", LC_ALL: "C", PATH: process.env.PATH ?? "" },
    timeout: 60_000,
  };
  try {
    await mkdir(home, { recursive: true });
    await mkdir(repository, { recursive: true });
    await mkdir(control, { recursive: true });
    // `homedir()` reads HOME verbatim on POSIX, so the engine's children land
    // in this temporary home rather than the operator's.
    process.env.HOME = home;
    await execute("/usr/bin/git", ["init", "-q"], isolated);
    await execute(
      bd,
      [
        "init",
        "--non-interactive",
        "--skip-agents",
        "--skip-hooks",
        "-p",
        "sce",
        "--remote",
        "",
      ],
      isolated,
    );

    const observed = await observeRepository(repository);
    assert.equal(observed.ok, true, JSON.stringify(observed));
    const paths = await sanitizedStatusPaths(repository);
    assert.deepEqual(
      paths.filter((path) => path.startsWith("~")),
      [],
      `compose-config dirtied the checkout with a literal ~: ${JSON.stringify(paths)}`,
    );

    // Control: the same pinned `bd` with no HOME does write that directory, so
    // the assertion above is reading a real property and not a `bd` that
    // stopped keeping a config file. A pinned-version bump that changes this
    // is worth seeing.
    await execute("/usr/bin/git", ["init", "-q"], {
      ...isolated,
      cwd: control,
    });
    await execute(bd, ["context", "--json"], {
      cwd: control,
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", PATH: process.env.PATH ?? "" },
      timeout: 60_000,
    }).catch(() => undefined);
    const controlPaths = await sanitizedStatusPaths(control);
    assert.deepEqual(
      controlPaths.filter((path) => path.startsWith("~")),
      ["~/"],
      `the pinned bd no longer writes a literal ~ without HOME: ${JSON.stringify(controlPaths)}`,
    );

    console.log(
      JSON.stringify({
        controlPaths,
        evidence: "sce.release.compose-home.v1",
        paths,
      }),
    );
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(root, { force: true, recursive: true });
  }
});
