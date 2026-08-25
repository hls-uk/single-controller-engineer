import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package metadata pins the immutable feedback target and has no postinstall", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
    sceRelease?: { feedbackTarget?: Record<string, string> };
  };
  assert.equal(packageJson.scripts?.postinstall, undefined);
  assert.deepEqual(packageJson.sceRelease?.feedbackTarget, {
    canonicalName: "hls-uk/single-controller-engineer",
    repositoryNodeId: "R_kgDOUCvUmw",
  });
});
