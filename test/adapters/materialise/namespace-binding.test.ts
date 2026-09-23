import assert from "node:assert/strict";
import { readFile, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createMaterialisationAdapter,
  type MaterialisationProcessPort,
} from "../../../src/adapters/materialise/index.js";
import { canonicalJson } from "../../../src/protocol/canonical.js";
import { sha256 } from "../../../src/protocol/evidence.js";
import {
  adapterFor,
  materialisationFixture,
  replaceHelperSource,
  transformHelper,
  type MaterialisationFixture,
} from "../../integration/materialise/fixture.js";

/**
 * Publication binds to the admitted directory object, so the deterministic
 * seam for namespace interference is the instant between the helper's identity
 * check and its publication syscall. Interfering exactly once leaves every
 * later act of the same helper call running in the relocated namespace, which
 * is the stronger assertion: the whole publication, not one syscall, resolves
 * through the held directory. DEC-20260922-018.
 */
function interfereBeforeFirstLink(
  statements: string,
): MaterialisationProcessPort {
  return transformHelper((source) =>
    replaceHelperSource(
      source,
      "try { fs.linkSync(tempName, finalName); }",
      `try { if (!globalThis.__sceNamespaceInterference) { globalThis.__sceNamespaceInterference = true; ${statements} } fs.linkSync(tempName, finalName); }`,
    ),
  );
}

function publishedPair(fixture: MaterialisationFixture): readonly string[] {
  return [
    fixture.effect.params.artifactName,
    fixture.effect.params.sidecarName,
  ].sort();
}

test("a same-user rename of an ancestor cannot redirect the publication syscall", async () => {
  const fixture = await materialisationFixture();
  try {
    const admitted = await stat(fixture.destinationDirectory, { bigint: true });
    const movedRoot = `${fixture.destinationRoot}-moved`;
    const port = interfereBeforeFirstLink(
      `fs.renameSync(${JSON.stringify(fixture.destinationRoot)}, ${JSON.stringify(movedRoot)});`,
    );

    const result = await createMaterialisationAdapter(
      fixture.repository,
      "sha1",
      port,
    ).materialise(fixture.effect);

    assert.equal(
      result.status,
      "observed",
      "an ancestor rename must not turn a correctly bound publication into drift",
    );
    if (result.status === "observed") {
      assert.equal(result.observation.sidecarStatus, "published");
      assert.equal(result.observation.artifactStatus, "published");
    }
    const held = join(movedRoot, "published");
    assert.deepEqual(
      (await readdir(held)).sort(),
      publishedPair(fixture),
      "both files land in the admitted directory at its new path",
    );
    const relocated = await stat(held, { bigint: true });
    assert.equal(relocated.dev, admitted.dev);
    assert.equal(relocated.ino, admitted.ino);
    await assert.rejects(
      async () => await readdir(fixture.destinationRoot),
      "nothing is recreated at the vacated admitted path",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("a sync-client style directory swap publishes into the admitted inode and clobbers nothing", async () => {
  const fixture = await materialisationFixture();
  try {
    const admitted = await stat(fixture.destinationDirectory, { bigint: true });
    const relocated = `${fixture.destinationDirectory}-relocated`;
    const decoyBytes = "a foreign file that must survive untouched\n";
    const port = interfereBeforeFirstLink(
      [
        `fs.renameSync(${JSON.stringify(fixture.destinationDirectory)}, ${JSON.stringify(relocated)});`,
        `fs.mkdirSync(${JSON.stringify(fixture.destinationDirectory)});`,
        `fs.writeFileSync(path.join(${JSON.stringify(fixture.destinationDirectory)}, ${JSON.stringify(fixture.effect.params.artifactName)}), ${JSON.stringify(decoyBytes)});`,
      ].join(" "),
    );

    const result = await createMaterialisationAdapter(
      fixture.repository,
      "sha1",
      port,
    ).materialise(fixture.effect);

    assert.equal(result.status, "observed");
    if (result.status === "observed") {
      assert.equal(result.observation.sidecarStatus, "published");
      assert.equal(result.observation.artifactStatus, "published");
    }
    assert.deepEqual(
      (await readdir(relocated)).sort(),
      publishedPair(fixture),
      "publication follows the admitted inode, not the admitted name",
    );
    const survivor = await stat(relocated, { bigint: true });
    assert.equal(survivor.dev, admitted.dev);
    assert.equal(survivor.ino, admitted.ino);
    assert.deepEqual(
      (await readdir(fixture.destinationDirectory)).sort(),
      [fixture.effect.params.artifactName],
      "the substituted directory receives nothing",
    );
    assert.equal(
      await readFile(
        join(fixture.destinationDirectory, fixture.effect.params.artifactName),
        "utf8",
      ),
      decoyBytes,
      "a final name that already exists elsewhere is never overwritten",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("binding the act does not weaken pre-act containment on the next act", async () => {
  const fixture = await materialisationFixture();
  try {
    assert.equal(
      (await adapterFor(fixture).materialise(fixture.effect)).status,
      "observed",
    );
    const movedRoot = `${fixture.destinationRoot}-moved`;
    await rename(fixture.destinationRoot, movedRoot);

    const next = await adapterFor(fixture).materialise(fixture.effect);

    assert.equal(
      next.status,
      "ambiguous",
      "a durable relocation still blocks the next admission",
    );
    assert.deepEqual(
      (await readdir(join(movedRoot, "published"))).sort(),
      publishedPair(fixture),
      "the already published pair is preserved exactly",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("a platform without recorded binding evidence refuses before any act", async () => {
  const fixture = await materialisationFixture();
  try {
    const calls: string[] = [];
    const recordingPort: MaterialisationProcessPort = {
      run: async (executable, argv) => {
        calls.push(`${executable} ${argv.join(" ")}`);
        throw new Error("the unsupported-platform gate must precede every act");
      },
    };

    const result = await createMaterialisationAdapter(
      fixture.repository,
      "sha1",
      recordingPort,
      "win32",
    ).materialise(fixture.effect);

    assert.equal(
      result.status,
      "refused",
      "an absent platform guarantee is a durable fact, not an unresolved one",
    );
    if (result.status === "refused") {
      assert.equal(result.refusal.code, "publication_platform_unsupported");
      assert.equal(
        result.refusal.detailHash,
        sha256(
          canonicalJson({
            domain: "sce.materialisation-refusal.v1",
            facts: { platform: "win32" },
          }),
        ),
        "the detail binds the exact platform that was refused",
      );
    }
    assert.deepEqual(
      calls,
      [],
      "no subprocess runs on an unsupported platform",
    );
    assert.deepEqual(
      await readdir(fixture.destinationDirectory),
      [],
      "nothing is written before the gate",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("read-only discovery stays available on an unsupported platform", async () => {
  const fixture = await materialisationFixture();
  try {
    assert.equal(
      (await adapterFor(fixture).materialise(fixture.effect)).status,
      "observed",
    );

    const unsupported = createMaterialisationAdapter(
      fixture.repository,
      "sha1",
      undefined,
      "win32",
    );
    const discovered = await unsupported.discoverMaterialise(fixture.effect);

    assert.equal(
      discovered.status,
      "observed",
      "recovery must still read a published pair anywhere",
    );
    const republished = await unsupported.materialise(fixture.effect);
    assert.equal(
      republished.status,
      "refused",
      "the refusal governs publication only, never the read-only recovery",
    );
  } finally {
    await fixture.cleanup();
  }
});
