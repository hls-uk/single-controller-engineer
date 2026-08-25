import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installSkills } from "../../src/install/index.js";

test("installer smoke proves both public skill directories arrive together", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-installer-smoke-"));
  try {
    const source = join(root, "source");
    for (const name of [
      "single-controller-engineer",
      "single-controller-feedback",
    ]) {
      await mkdir(join(source, name), { recursive: true });
      await writeFile(
        join(source, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: smoke\n---\n\n<!-- sce-skill-version: 0.1.0 -->\n`,
      );
    }
    const result = await installSkills({
      destination: join(root, "destination"),
      source,
    });
    assert.equal(result.status, "installed");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
