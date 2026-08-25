import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { prepareFeedback } from "../../src/feedback/index.js";

const triage = (await import(
  pathToFileURL(resolve("scripts/feedback-triage.mjs")).href
)) as {
  triagePlan(event: unknown, discovery: unknown): unknown;
};
const release = (await import(
  pathToFileURL(resolve("scripts/release-gates.mjs")).href
)) as {
  releaseArtifactManifest(version: string, bytes: Buffer): unknown;
  validateRegistryReadback(manifest: unknown, value: unknown): boolean;
  validateReleaseArtifactManifest(value: unknown): unknown;
  verifyReleaseArtifactBytes(manifest: unknown, bytes: Buffer): boolean;
  versionAtLeast(actual: string, minimum: string): boolean;
};

const telemetry = {
  capabilityId: "feedback.submit" as const,
  component: "runtime" as const,
  kind: "bug" as const,
  protocolState: "failed" as const,
  requestedModelTier: "workhorse" as const,
  stableErrorCode: "SCE_TRIAGE_TEST",
  toolVersion: "0.1.0",
  toolchain: "node-22" as const,
};

function packet(narrative?: { readonly observed: string }) {
  const result = prepareFeedback(telemetry, narrative);
  assert.ok(result);
  if (result === undefined) throw new Error("expected feedback packet");
  return result;
}

function event(number: number, body: string, repositoryId = "R_kgDOUCvUmw") {
  return {
    issue: { body, number, state: "open" },
    repository: { node_id: repositoryId },
  };
}

function discovery(
  rows: readonly { body: string; number: number; open: boolean }[],
) {
  return {
    issues: rows,
    paginationComplete: true,
    repositoryId: "R_kgDOUCvUmw",
    schema: "sce.feedback-discovery",
    version: 1,
  };
}

test("triage chooses the canonical lowest exact fingerprint and emits only the existing label/comment", () => {
  const value = packet();
  assert.deepEqual(
    triage.triagePlan(
      event(20, value.body),
      discovery([
        { body: value.body, number: 20, open: true },
        { body: value.body, number: 10, open: true },
      ]),
    ),
    {
      action: "apply",
      canonicalIssueNumber: 10,
      comment:
        "Duplicate feedback report; canonical issue: https://github.com/hls-uk/single-controller-engineer/issues/10",
      issueNumber: 20,
      label: "duplicate",
    },
  );
});

test("triage leaves ordinary, unmarked, ambiguous, forged, and wrong-target events untouched", () => {
  const value = packet();
  const noOp = { action: "none" };
  assert.deepEqual(
    triage.triagePlan(event(20, "ordinary user issue"), discovery([])),
    noOp,
  );
  assert.deepEqual(
    triage.triagePlan(
      event(20, value.body),
      discovery([
        { body: value.body, number: 20, open: true },
        { body: value.body, number: 20, open: true },
      ]),
    ),
    noOp,
  );
  assert.deepEqual(
    triage.triagePlan(
      event(20, value.body.replace(/[0-9a-f](?= -->$)/u, "f")),
      discovery([{ body: value.body, number: 20, open: true }]),
    ),
    noOp,
  );
  assert.deepEqual(
    triage.triagePlan(
      event(20, value.body, "R_untrusted_target"),
      discovery([{ body: value.body, number: 20, open: true }]),
    ),
    noOp,
  );
});

test("triage accepts bounded safe reviewed narratives but refuses hostile narrative bytes", () => {
  const safe = packet({ observed: "A bounded, generic observed behavior." });
  const secondSafe = packet({ observed: "The same generic observation." });
  assert.deepEqual(
    triage.triagePlan(
      event(8, safe.body),
      discovery([
        { body: secondSafe.body, number: 3, open: true },
        { body: safe.body, number: 8, open: true },
      ]),
    ),
    {
      action: "apply",
      canonicalIssueNumber: 3,
      comment:
        "Duplicate feedback report; canonical issue: https://github.com/hls-uk/single-controller-engineer/issues/3",
      issueNumber: 8,
      label: "duplicate",
    },
  );
  const hostile = packet({ observed: "See https://example.test/private" });
  assert.deepEqual(
    triage.triagePlan(
      event(8, hostile.body),
      discovery([{ body: hostile.body, number: 8, open: true }]),
    ),
    { action: "none" },
  );
});

test("release artifact and exact registry-readback validators reject substitutions", () => {
  const bytes = Buffer.from("release artifact", "utf8");
  const manifest = release.releaseArtifactManifest("0.1.0", bytes) as {
    integrity: string;
    name: string;
    schema: string;
    sha256: string;
    tarball: string;
    version: string;
  };
  assert.ok(release.validateReleaseArtifactManifest(manifest));
  assert.equal(release.verifyReleaseArtifactBytes(manifest, bytes), true);
  assert.equal(
    release.verifyReleaseArtifactBytes(manifest, Buffer.from("substitute")),
    false,
  );
  const readback = {
    access: "public",
    integrity: manifest.integrity,
    name: "@hls-uk/single-controller-engineer",
    provenanceVerified: true,
    schema: "sce.registry-readback",
    version: "0.1.0",
  };
  assert.equal(release.validateRegistryReadback(manifest, readback), true);
  for (const substitution of [
    { ...readback, access: "restricted" },
    { ...readback, integrity: "sha512-substitute" },
    { ...readback, name: "@foreign/package" },
    { ...readback, provenanceVerified: false },
    { ...readback, version: "0.1.1" },
    { ...readback, extra: true },
  ])
    assert.equal(
      release.validateRegistryReadback(manifest, substitution),
      false,
    );
  assert.equal(
    release.validateReleaseArtifactManifest({ ...manifest, extra: true }),
    undefined,
  );
  assert.equal(release.versionAtLeast("22.14.0", "22.14.0"), true);
  assert.equal(release.versionAtLeast("22.15.0", "22.14.0"), true);
  assert.equal(release.versionAtLeast("22.13.99", "22.14.0"), false);
  assert.equal(release.versionAtLeast("not-a-version", "22.14.0"), false);
});
