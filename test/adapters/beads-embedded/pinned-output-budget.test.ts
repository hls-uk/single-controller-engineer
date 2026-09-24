import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { failureTail } from "../../../src/adapters/beads-embedded/pinned-bd-process.js";
import {
  outputBytesFor,
  PinnedBdEmbeddedProcess,
  REMOTE_FAILURE_TAIL_BYTES,
  type EmbeddedAncestryProof,
  type EmbeddedPendingWorkingSet,
  type EmbeddedReadback,
} from "../../../src/adapters/beads-embedded/index.js";
import { makeRootProjection } from "../../../src/fencing/index.js";
import { run as fixtureRun } from "../../protocol/fixtures.js";

const projections = {
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
};

const scope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};

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
      projections,
      scope,
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

/**
 * Runs the pinned ancestry probe against a synthetic `dolt` whose one SQL
 * capture is written by `body`. No `bd` is involved: the probe is a local
 * read of this clone's own commit graph, and nothing it does can reach the
 * network.
 */
async function ancestryProof(body: string): Promise<EmbeddedAncestryProof> {
  const root = await mkdtemp(join(tmpdir(), "sce-ancestry-"));
  try {
    const dolt = join(root, "dolt");
    await writeFile(
      dolt,
      [
        "#!/bin/sh",
        'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
        body,
        "exit 0",
      ].join("\n"),
      { mode: 0o700 },
    );
    await chmod(dolt, 0o700);
    const observed = await new PinnedBdEmbeddedProcess({
      bdExecutable: join(root, "bd"),
      cwd: root,
      databaseDirectory: root,
      doltExecutable: dolt,
      prefix: "sce",
      projections,
      scope,
    }).ancestry({
      ancestor: "a".repeat(40),
      descendant: "b".repeat(40),
      kind: "ancestry",
    });
    assert.equal(observed.kind, "ancestry");
    return observed.value;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

/**
 * Re-pushing a locally-ahead head may act on nothing but an exact proof, so
 * the probe admits one single-row count of exactly 0 or 1 and refuses every
 * other shape. A coercible string, a second row, and engine noise each prove
 * nothing, which leaves the pull to classify the store exactly as before.
 */
test("the ancestry probe admits only an exact single count row", async () => {
  assert.equal(
    await ancestryProof(`printf '{"rows":[{"matches":1}]}\\n'`),
    "observed",
  );
  assert.equal(
    await ancestryProof(`printf '{"rows":[{"matches":0}]}\\n'`),
    "absent",
  );
  assert.equal(
    await ancestryProof(`printf '{"rows":[{"matches":"1"}]}\\n'`),
    "ambiguous",
  );
  assert.equal(
    await ancestryProof(`printf '{"rows":[{"matches":1},{"matches":1}]}\\n'`),
    "ambiguous",
  );
  assert.equal(
    await ancestryProof(`printf 'panic: runtime error\\n'`),
    "ambiguous",
  );
});

/**
 * The probe keeps the ordinary 64 KiB capture budget. A child killed at it
 * exits with no code, and an exceeded capture is never a proof: the push is
 * not attempted, and the pull decides.
 */
test("an ancestry capture killed at its 64 KiB budget proves nothing", async () => {
  assert.equal(
    await ancestryProof(
      [
        `printf '{"rows":[{"matches":1}]}'`,
        "i=0",
        "while [ $i -lt 96 ]; do printf '%01024d' 0; i=$((i+1)); done",
      ].join("\n"),
    ),
    "ambiguous",
  );
});

/**
 * The kill decides the refusal, not the exit code: a child that finished
 * writing and exited 0 an instant before SIGKILL landed still exceeded its
 * budget, and the tail it left is the only account of the stall (sce-ul2.7).
 */
test("a budget-killed capture keeps its tail even when the child exited 0", () => {
  const stderrTail = {
    schema: "sce.beads-embedded.remote-failure-tail" as const,
    text: "error: failed to push to origin: Operation timed out",
    truncated: false,
    version: 1 as const,
  };
  assert.deepEqual(
    failureTail({ code: 0, exceeded: true, stderrTail, timedOut: false }),
    { stderrTail },
  );
  assert.deepEqual(
    failureTail({ code: 0, exceeded: false, stderrTail, timedOut: true }),
    { stderrTail },
  );
  assert.deepEqual(
    failureTail({ code: 0, exceeded: false, stderrTail, timedOut: false }),
    {},
  );
  assert.deepEqual(
    failureTail({ code: null, exceeded: true, timedOut: false }),
    {},
  );
});

const PROBE_HEAD = "c".repeat(40);

function unitlessProjection(): EmbeddedReadback {
  return { children: [], root: makeRootProjection(fixtureRun([])) };
}

/**
 * Runs the pinned pending-delta probe against a synthetic `dolt`. No `bd` is
 * involved and no branch of the script may commit: the probe is a read, and a
 * process that cannot read its delta must say so rather than claim a step.
 */
async function pendingProbe(
  options: Readonly<{
    decodes?: boolean;
    diffExits?: number;
    matches?: boolean;
    pending: boolean;
  }>,
): Promise<Readonly<{ diffed: boolean; value: EmbeddedPendingWorkingSet }>> {
  const root = await mkdtemp(join(tmpdir(), "sce-pending-"));
  try {
    const dolt = join(root, "dolt");
    const diffed = join(root, "diffed");
    const status = options.pending
      ? '{"rows":[{"staged":0,"status":"modified","table_name":"issues"}]}'
      : '{"rows":[]}';
    await writeFile(
      dolt,
      [
        "#!/bin/sh",
        'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\n"; exit 0; fi',
        'if [ "$1" = "sql" ]; then',
        '  case "$5" in',
        `    *'DOLT_HASHOF("HEAD")'*) printf '{"rows":[{"head":"${PROBE_HEAD}"}]}' ;;`,
        `    *'SELECT * FROM dolt_status'*) printf '${status}' ;;`,
        "    *) exit 1 ;;",
        "  esac",
        "  exit 0",
        "fi",
        'if [ "$1" = "diff" ]; then',
        `  touch '${diffed}'`,
        `  printf '{"tables":[]}'`,
        `  exit ${options.diffExits ?? 0}`,
        "fi",
        "exit 1",
      ].join("\n"),
      { mode: 0o700 },
    );
    await chmod(dolt, 0o700);
    const decoding = {
      async load() {
        return { status: "observed" as const, value: unitlessProjection() };
      },
      matchesProjectionStepDelta() {
        return options.matches ?? true;
      },
    };
    const observed = await new PinnedBdEmbeddedProcess({
      bdExecutable: join(root, "bd"),
      cwd: root,
      databaseDirectory: root,
      doltExecutable: dolt,
      prefix: "sce",
      projections:
        options.decodes === false
          ? projections
          : { ...projections, ...decoding },
      scope,
    }).pendingWorkingSet();
    assert.equal(observed.kind, "pending_working_set");
    return {
      diffed: await access(diffed).then(
        () => true,
        () => false,
      ),
      value: observed.value,
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

/**
 * The probe decides one thing: whether the uncommitted delta is exactly the
 * engine's own next checkpoint. A clean store never reads a diff at all, an
 * unreadable diff is `unproven`, and a process whose projection port cannot
 * decode a delta reports that rather than a status it did not establish.
 */
test("the pending-delta probe proves a step only from a readable exact diff", async () => {
  const clean = await pendingProbe({ pending: false });
  assert.deepEqual(clean.value, { status: "clean" });
  assert.equal(clean.diffed, false, "a clean store reads no diff");

  const step = await pendingProbe({ pending: true });
  assert.deepEqual(step.value, {
    delta: "projection_step",
    head: PROBE_HEAD,
    pending: unitlessProjection(),
    status: "pending",
  });

  const foreign = await pendingProbe({ matches: false, pending: true });
  assert.equal(
    foreign.value.status === "pending" ? foreign.value.delta : undefined,
    "unproven",
    "a delta the projection port does not match is never a step",
  );

  const unreadable = await pendingProbe({ diffExits: 1, pending: true });
  assert.equal(
    unreadable.value.status === "pending" ? unreadable.value.delta : undefined,
    "unproven",
    "a diff capture that failed proves nothing",
  );

  const undecodable = await pendingProbe({ decodes: false, pending: true });
  assert.deepEqual(undecodable.value, { status: "unavailable" });
  assert.equal(undecodable.diffed, false, "an undecodable port reads no diff");
});
