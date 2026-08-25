import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  INSTALL_MANIFEST,
  INSTALL_JOURNAL,
  INSTALL_LOCK,
  SimulatedProcessLoss,
  SkillInstallError,
  installSkills,
  uninstallSkills,
} from "../../src/install/index.js";

async function fixture(root: string, version = "0.1.0") {
  for (const name of [
    "single-controller-engineer",
    "single-controller-feedback",
  ]) {
    const skill = join(root, name);
    await mkdir(join(skill, "references"), { recursive: true });
    await writeFile(
      join(skill, "SKILL.md"),
      `---\nname: ${name}\ndescription: test\n---\n\n<!-- sce-skill-version: ${version} -->\n`,
    );
    await writeFile(
      join(skill, "references", "contract.md"),
      `${name}-${version}\n`,
    );
  }
}

async function inTemporaryDirectory(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sce-install-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("installs a version-matched, manifest-verified skill pair and supports dry-run", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "host");
    await fixture(source);
    const dryRun = await installSkills({ destination, dryRun: true, source });
    assert.equal(dryRun.status, "dry-run");
    await assert.rejects(readFile(join(destination, INSTALL_MANIFEST)), {
      code: "ENOENT",
    });
    const result = await installSkills({ destination, source });
    assert.equal(result.status, "installed");
    assert.equal(
      JSON.parse(await readFile(join(destination, INSTALL_MANIFEST), "utf8"))
        .skills["single-controller-engineer"],
      "0.1.0",
    );
  });
});

test("refuses unmanaged collisions, partial pairs, and changed installed files", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "host");
    await fixture(source);
    await mkdir(join(destination, "single-controller-engineer"), {
      recursive: true,
    });
    await assert.rejects(
      installSkills({ destination, source }),
      SkillInstallError,
    );
    await rm(destination, { force: true, recursive: true });
    await installSkills({ destination, source });
    await writeFile(
      join(destination, "single-controller-engineer", "SKILL.md"),
      "tampered",
    );
    await assert.rejects(
      installSkills({ destination, source }),
      /invalid skill version|installed tree differs/,
    );
  });
});

test("refuses source pairs with different declared versions", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    await fixture(source);
    await writeFile(
      join(source, "single-controller-feedback", "SKILL.md"),
      "---\nname: single-controller-feedback\ndescription: test\n---\n\n<!-- sce-skill-version: 0.2.0 -->\n",
    );
    await assert.rejects(
      installSkills({ destination: join(root, "host"), source }),
      /paired skills must declare the same version/,
    );
  });
});

test("uninstall is manifest-driven and will not remove changed files", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "host");
    await fixture(source);
    await installSkills({ destination, source });
    await uninstallSkills(destination);
    await assert.rejects(readFile(join(destination, INSTALL_MANIFEST)), {
      code: "ENOENT",
    });
  });
});

test("upgrade recovers a process loss after partial backup and preserves the exact old pair", async () => {
  await inTemporaryDirectory(async (root) => {
    const original = join(root, "original");
    const replacement = join(root, "replacement");
    const destination = join(root, "host");
    await fixture(original, "0.1.0");
    await fixture(replacement, "0.2.0");
    await installSkills({ destination, source: original });
    await assert.rejects(
      installSkills({
        destination,
        fault: (phase) => {
          if (phase === "after-backup") throw new SimulatedProcessLoss();
        },
        source: replacement,
      }),
      SimulatedProcessLoss,
    );
    assert.ok((await readdir(destination)).includes(INSTALL_JOURNAL));
    const result = await installSkills({ destination, source: replacement });
    assert.equal(result.status, "installed");
    assert.match(
      await readFile(
        join(destination, "single-controller-engineer", "SKILL.md"),
        "utf8",
      ),
      /0\.2\.0/u,
    );
  });
});

test("upgrade retry restores an intact backup after the first new skill rename", async () => {
  await inTemporaryDirectory(async (root) => {
    const original = join(root, "original");
    const replacement = join(root, "replacement");
    const destination = join(root, "host");
    await fixture(original, "0.1.0");
    await fixture(replacement, "0.2.0");
    await installSkills({ destination, source: original });
    let newMoves = 0;
    await assert.rejects(
      installSkills({
        destination,
        fault: (phase) => {
          if (phase === "after-new" && ++newMoves === 1)
            throw new SimulatedProcessLoss();
        },
        source: replacement,
      }),
      SimulatedProcessLoss,
    );
    assert.ok((await readdir(destination)).includes(INSTALL_JOURNAL));
    const result = await installSkills({ destination, source: replacement });
    assert.equal(result.status, "installed");
    for (const name of [
      "single-controller-engineer",
      "single-controller-feedback",
    ])
      assert.match(
        await readFile(join(destination, name, "SKILL.md"), "utf8"),
        /0\.2\.0/u,
      );
    await assert.rejects(readFile(join(destination, INSTALL_JOURNAL)), {
      code: "ENOENT",
    });
  });
});

test("refuses active lock, malformed manifests, symlinked parents, and unowned extra bytes", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "host");
    await fixture(source);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, INSTALL_LOCK), `pid=${process.pid}\n`);
    await assert.rejects(
      installSkills({ destination, source }),
      /another skill installation/u,
    );
    await rm(join(destination, INSTALL_LOCK));
    await writeFile(join(destination, INSTALL_MANIFEST), "{");
    await assert.rejects(
      installSkills({ destination, source }),
      /invalid existing/u,
    );
    await rm(join(destination, INSTALL_MANIFEST));
    await installSkills({ destination, source });
    const extra = join(
      destination,
      "single-controller-engineer",
      "unowned.txt",
    );
    await writeFile(extra, "keep me");
    await assert.rejects(
      uninstallSkills(destination),
      /installed tree differs/u,
    );
    assert.equal(await readFile(extra, "utf8"), "keep me");
    const linkedParent = join(root, "linked-parent");
    await symlink(destination, linkedParent);
    await assert.rejects(
      installSkills({ destination: join(linkedParent, "next"), source }),
      /symlinked install parent/u,
    );
  });
});

test("requires destination-local staging so recovery never depends on caller memory", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const staging = join(root, "separate-staging");
    await fixture(source);
    await mkdir(staging);
    await assert.rejects(
      installSkills({
        destination: join(root, "host"),
        source,
        stagingDirectory: staging,
      }),
      /destination-local/u,
    );
  });
});

test("corrupt backup leaves a durable recovery-needed journal rather than deleting evidence", async () => {
  await inTemporaryDirectory(async (root) => {
    const original = join(root, "original");
    const replacement = join(root, "replacement");
    const destination = join(root, "host");
    await fixture(original, "0.1.0");
    await fixture(replacement, "0.2.0");
    await installSkills({ destination, source: original });
    await assert.rejects(
      installSkills({
        destination,
        fault: (phase) => {
          if (phase === "after-new") throw new SimulatedProcessLoss();
        },
        source: replacement,
      }),
      SimulatedProcessLoss,
    );
    const journal = JSON.parse(
      await readFile(join(destination, INSTALL_JOURNAL), "utf8"),
    ) as { backup: string };
    await rm(join(destination, journal.backup, "single-controller-feedback"), {
      force: true,
      recursive: true,
    });
    await assert.rejects(
      installSkills({ destination, source: replacement }),
      /recovery-needed/u,
    );
    assert.ok((await readdir(destination)).includes(INSTALL_JOURNAL));
  });
});

test("interrupted uninstall recovers through the same uninstall entry point", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "host");
    await fixture(source);
    await installSkills({ destination, source });
    await assert.rejects(
      uninstallSkills(destination, {
        fault: (phase) => {
          if (phase === "after-backup") throw new SimulatedProcessLoss();
        },
      }),
      SimulatedProcessLoss,
    );
    await uninstallSkills(destination);
    await assert.rejects(readFile(join(destination, INSTALL_MANIFEST)), {
      code: "ENOENT",
    });
  });
});

test("ordinary partial uninstall failure rolls back the exact owned pair", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "host");
    await fixture(source);
    await installSkills({ destination, source });
    await assert.rejects(
      uninstallSkills(destination, {
        fault: (phase) => {
          if (phase === "after-backup") throw new Error("ordinary failure");
        },
      }),
      /ordinary failure/u,
    );
    assert.match(
      await readFile(join(destination, INSTALL_MANIFEST), "utf8"),
      /sce\.skill-install/u,
    );
    await assert.rejects(readFile(join(destination, INSTALL_JOURNAL)), {
      code: "ENOENT",
    });
  });
});

test("a stale operation lock is reclaimed while a live contender remains refused", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "host");
    await fixture(source);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, INSTALL_LOCK), "pid=999999\n");
    assert.equal(
      (await installSkills({ destination, source })).status,
      "installed",
    );
    await writeFile(join(destination, INSTALL_LOCK), `pid=${process.pid}\n`);
    await assert.rejects(
      uninstallSkills(destination),
      /another skill installation/u,
    );
  });
});

test("two stale-lock contenders never overlap or remove the acquired replacement", async () => {
  await inTemporaryDirectory(async (root) => {
    const source = join(root, "source");
    const destination = join(root, "destination");
    await fixture(source);
    await mkdir(destination);
    await writeFile(join(destination, INSTALL_LOCK), "pid=999999\n");
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => (firstEntered = resolve));
    const release = new Promise<void>((resolve) => (releaseFirst = resolve));
    let held = false;
    const first = installSkills({
      destination,
      source,
      fault: async (phase) => {
        if (phase !== "before-new" || held) return;
        held = true;
        firstEntered();
        await release;
      },
    });
    await entered;
    await assert.rejects(
      installSkills({ destination, source }),
      SkillInstallError,
    );
    releaseFirst();
    const result = await first;
    assert.deepEqual(
      JSON.parse(await readFile(join(destination, INSTALL_MANIFEST), "utf8")),
      result.manifest,
    );
    await assert.rejects(readFile(join(destination, INSTALL_LOCK)), {
      code: "ENOENT",
    });
  });
});
