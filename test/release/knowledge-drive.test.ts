import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  adapterFor,
  materialisationFixture,
} from "../integration/materialise/fixture.js";

/**
 * Release-tier evidence for K6-AC3: the no-clobber materialise adapter against
 * a real Drive for Desktop folder. It runs only when SCE_RELEASE_DRIVE_ROOT
 * names an existing synced directory that carries the fixture marker; the
 * evidence line it prints is recorded with the release decision record.
 */
test("materialisation into a real synced Drive folder publishes by hard link and reads back exactly", async (t) => {
  const driveRoot = process.env.SCE_RELEASE_DRIVE_ROOT;
  if (driveRoot === undefined || driveRoot.length === 0) {
    t.skip(
      "external evidence not supplied: set SCE_RELEASE_DRIVE_ROOT to a real Drive for Desktop folder (K6-AC3)",
    );
    return;
  }
  const fixture = await materialisationFixture();
  const root = await realpath(driveRoot);
  const destinationDirectory = await mkdtemp(join(root, "sce-release-"));
  try {
    await writeFile(join(root, ".sce-drive-marker"), "release evidence\n", {
      flag: "a",
    });
    await mkdir(destinationDirectory, { recursive: true });
    const identity = await stat(destinationDirectory, { bigint: true });
    const effect = {
      ...fixture.effect,
      params: {
        ...fixture.effect.params,
        destination: {
          ...fixture.effect.params.destination,
          canonicalRoot: root,
        },
        destinationIdentity: {
          canonicalPath: destinationDirectory,
          device: String(identity.dev),
          inode: String(identity.ino),
        },
        destinationSubpath: destinationDirectory.slice(root.length + 1),
      },
    };
    const started = performance.now();
    const published = await adapterFor(fixture).materialise(effect);
    const publishMs = Math.round(performance.now() - started);
    assert.equal(published.status, "observed", JSON.stringify(published));
    const artifact = join(destinationDirectory, effect.params.artifactName);
    const sidecar = join(destinationDirectory, effect.params.sidecarName);
    assert.deepEqual(await readFile(artifact), fixture.artifact);
    assert.deepEqual(await readFile(sidecar), fixture.sidecar);
    const artifactStat = await stat(artifact);
    const sidecarStat = await stat(sidecar);
    const again = await adapterFor(fixture).materialise(effect);
    assert.equal(again.status, "observed");
    const discovered = await adapterFor(fixture).discoverMaterialise(effect);
    assert.equal(discovered.status, "observed");
    console.log(
      JSON.stringify({
        artifactLinks: artifactStat.nlink,
        destinationDirectory,
        evidence: "sce.release.knowledge-drive.v1",
        publishMs,
        sidecarLinks: sidecarStat.nlink,
      }),
    );
  } finally {
    await rm(destinationDirectory, { force: true, recursive: true });
    await fixture.cleanup();
  }
});
