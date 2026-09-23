import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  outputBytesFor,
  PinnedBdEmbeddedProcess,
  REMOTE_FAILURE_TAIL_BYTES,
} from "../../../src/adapters/beads-embedded/index.js";

// A checkpoint proof reads the complete data diff of the changed projection
// rows. The projection reader admits 256 KiB per capture and a diff carries
// each changed row twice as base64-wrapped cells, so the 64 KiB budget every
// other capture keeps would report a legitimate delta as exceeded, and an
// exceeded capture is never a proof: the run would block on its own write.
test("a dolt diff capture is budgeted for two copies of the projection bound", () => {
  const projectionCapture = 262_144;
  const base64 = 4 / 3;
  assert.ok(
    outputBytesFor(["diff", "--data", "-r", "json", "HEAD"]) >=
      2 * projectionCapture * base64,
  );
  assert.equal(
    outputBytesFor(["diff", "--data", "-r", "json", "HEAD"]),
    1_048_576,
  );
});

test("every other dolt capture keeps the 64 KiB budget", () => {
  for (const argv of [
    ["sql", "-r", "json", "-q", "SELECT * FROM dolt_status"],
    ["version"],
    ["fetch", "origin"],
    ["log", "--oneline"],
  ])
    assert.equal(outputBytesFor(argv), 65_536);
});

/**
 * A child killed at a budget exits with no code at all, which is exactly the
 * shape a two-minute remote push timeout leaves behind. Both budgets kill the
 * same way and reach the same refusal, so the cheap one proves the expensive
 * one: whatever the child managed to say before the kill is the only account
 * of the stall an operator will ever get.
 */
test("a push killed at its output budget still names what the child said", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-budget-tail-"));
  try {
    const bd = join(root, "bd");
    await writeFile(
      bd,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then printf "bd version 1.1.0\\n"; exit 0; fi',
        'if [ "$1" = "dolt" ] && [ "$2" = "push" ]; then',
        "cat >&2 <<'STDERR'",
        "error: failed to push to origin: Operation timed out",
        "fatal: Could not read from remote repository.",
        "STDERR",
        "i=0",
        "while [ $i -lt 96 ]; do printf '%01024d' 0; i=$((i+1)); done",
        "exit 0",
        "fi",
        "printf '{}\\n'",
      ].join("\n"),
      { mode: 0o700 },
    );
    await chmod(bd, 0o700);
    const observed = await new PinnedBdEmbeddedProcess({
      bdExecutable: bd,
      cwd: root,
      databaseDirectory: root,
      doltExecutable: join(root, "dolt"),
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
      scope: {
        beadsStoreIdentity: "store-1",
        gitRepositoryIdentity: "repo-1",
        integrationBranch: "main",
      },
    }).execute({ kind: "push" });
    assert.ok(observed.kind === "push");
    // The classification is decided by the kill, never by the text below it.
    assert.equal(observed.value, "unavailable");
    const tail = observed.stderrTail;
    assert.ok(tail !== undefined, "the refusal must name its cause");
    assert.ok(tail.text.includes("Operation timed out"));
    assert.ok(
      tail.text.includes("fatal: Could not read from remote repository."),
    );
    assert.equal(tail.schema, "sce.beads-embedded.remote-failure-tail");
    assert.equal(
      Buffer.byteLength(tail.text, "utf8") <= REMOTE_FAILURE_TAIL_BYTES,
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
