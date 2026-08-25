import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  isPinnedCloneMergeDelta,
  PinnedBdEmbeddedProcess,
} from "../../src/adapters/beads-embedded/index.js";

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
