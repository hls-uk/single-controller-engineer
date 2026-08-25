import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  DoltProjectionPersistence,
  EmbeddedBeadsAdapter,
  isPinnedCloneMergeDelta,
  isPinnedSlotTransitionDelta,
  makeSlotTransitionIntent,
  PinnedBdEmbeddedProcess,
  PROJECTION_INITIALIZATION_AUTHORITY,
} from "../../../src/adapters/beads-embedded/index.js";
import {
  MERGE_SLOT_LABEL,
  MERGE_SLOT_TITLE,
  deriveScopeCommitment,
  deriveSlotReadbackHash,
  makeChildProjection,
  makeRootProjection,
  type MutationBatch,
  validateMutationBatch,
  withBatchCheckpoint,
} from "../../../src/fencing/index.js";
import { reduce } from "../../../src/protocol/reducer.js";
import type { RepositoryRun } from "../../../src/protocol/schemas.js";
import { HASH, event, run as fixtureRun } from "../../protocol/fixtures.js";

const execute = promisify(execFile);
const BD = "/opt/homebrew/bin/bd";
const DOLT = "/opt/homebrew/bin/dolt";
const holder = "run-1/incarnation-1";
const scope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};

function observedSlot(status: "available" | "acquired", slotHolder?: string) {
  const value = {
    actor: slotHolder ?? holder,
    ...(slotHolder === undefined ? {} : { holder: slotHolder }),
    label: MERGE_SLOT_LABEL,
    scope,
    scopeCommitment: deriveScopeCommitment(scope),
    slotId: "sce-merge-slot",
    status,
    title: MERGE_SLOT_TITLE,
    version: 1 as const,
  };
  return { ...value, readbackHash: deriveSlotReadbackHash(value) };
}

function exactSlotDeltaFixture() {
  const before = observedSlot("available");
  const after = observedSlot("acquired", holder);
  const intent = makeSlotTransitionIntent(
    "acquire",
    holder,
    scope,
    { head: "a".repeat(32), slot: before },
    after,
  );
  const issueRow = (
    status: "open" | "in_progress",
    slotHolder: string | undefined,
    startedAt: string | undefined,
  ): Record<string, unknown> => ({
    acceptance_criteria: "",
    actor: "",
    agent_state: "",
    await_id: "",
    await_type: "",
    close_reason: "",
    closed_by_session: "",
    compaction_level: 0,
    content_hash: "a".repeat(64),
    created_at: "2026-08-25 02:03:04",
    created_by: "",
    description: "Exclusive access slot for serialized conflict resolution.",
    design: JSON.stringify(scope),
    ephemeral: 0,
    event_kind: "",
    external_ref: `sce-scope:v1:${deriveScopeCommitment(scope)}`,
    hook_bead: "",
    id: "sce-merge-slot",
    is_blocked: 0,
    is_template: 0,
    issue_type: "task",
    metadata: slotHolder === undefined ? {} : { holder: slotHolder },
    mol_type: "",
    no_history: 0,
    notes: "",
    owner: "",
    payload: "",
    pinned: 0,
    priority: 0,
    rig: "",
    role_bead: "",
    role_type: "",
    sender: "",
    source_repo: "",
    source_system: "",
    spec_id: "",
    ...(startedAt === undefined ? {} : { started_at: startedAt }),
    status,
    target: "",
    timeout_ns: 0,
    title: MERGE_SLOT_TITLE,
    updated_at:
      status === "open" ? "2026-08-25 02:03:04" : "2026-08-25 02:03:05",
    waiters: "",
    wisp_type: "",
    work_type: "",
  });
  const from = issueRow("open", undefined, undefined);
  const to = issueRow("in_progress", holder, "2026-08-25 02:03:05");
  const event = {
    from_row: {},
    to_row: {
      actor: holder,
      created_at: "2026-08-25 03:03:04",
      event_type: "status_changed",
      id: "01a036a8-26c3-76fd-ba82-df31e382054c",
      issue_id: "sce-merge-slot",
      new_value: JSON.stringify({
        metadata: JSON.stringify({ holder }),
        status: "in_progress",
      }),
      old_value: JSON.stringify({
        created_at: "2026-08-25T02:03:04Z",
        description: from.description,
        design: from.design,
        external_ref: from.external_ref,
        id: from.id,
        issue_type: from.issue_type,
        labels: [MERGE_SLOT_LABEL],
        priority: from.priority,
        status: from.status,
        title: from.title,
        updated_at: "2026-08-25T02:03:04Z",
      }),
    },
  };
  return {
    delta: {
      tables: [
        { data_diff: [{ from_row: from, to_row: to }], name: "issues" },
        { data_diff: [event], name: "events" },
      ],
    },
    intent,
  };
}

function pinnedCloneDelta() {
  return {
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
  };
}

test("cross-clone proof admits only pinned bd pull metadata rows", () => {
  const cloneDelta = pinnedCloneDelta();
  assert.equal(isPinnedCloneMergeDelta(JSON.stringify(cloneDelta)), true);
  const metadataTable = cloneDelta.tables[0];
  if (metadataTable === undefined) throw new Error("unreachable");
  for (const malformed of [
    {
      ...cloneDelta,
      unexpected_root: true,
    },
    {
      tables: [
        {
          ...metadataTable,
          schema_diff: { from_schema: "metadata", to_schema: "metadata" },
        },
      ],
    },
    {
      tables: [
        {
          ...metadataTable,
          data_diff: [
            {
              ...metadataTable.data_diff[0],
              unexpected_diff_key: true,
            },
            metadataTable.data_diff[1],
          ],
        },
      ],
    },
    {
      ...cloneDelta,
      tables: [
        {
          ...metadataTable,
          data_diff: [
            ...metadataTable.data_diff,
            {
              from_row: { key: "other", value: "before" },
              to_row: { key: "other", value: "after" },
            },
          ],
        },
      ],
    },
    {
      tables: [
        ...cloneDelta.tables,
        {
          data_diff: [
            {
              from_row: { id: "sce-unrelated", status: "open" },
              to_row: { id: "sce-unrelated", status: "closed" },
            },
          ],
          name: "issues",
        },
      ],
    },
    {
      tables: [
        ...cloneDelta.tables,
        {
          data_diff: [
            {
              from_row: {},
              to_row: { event_type: "status_changed", issue_id: "sce-other" },
            },
          ],
          name: "events",
        },
      ],
    },
    {
      tables: [
        {
          ...metadataTable,
          data_diff: [
            {
              from_row: { key: "clone_id", value: "0123456789abcdef" },
              to_row: { key: "clone_id", value: "fedcba9876543210" },
            },
            {
              from_row: { key: "clone_id", value: "aaaaaaaaaaaaaaaa" },
              to_row: { key: "clone_id", value: "bbbbbbbbbbbbbbbb" },
            },
          ],
        },
      ],
    },
  ])
    assert.equal(isPinnedCloneMergeDelta(JSON.stringify(malformed)), false);
});

test("authoritative slot delta accepts only the pinned two-row envelope", () => {
  const { delta, intent } = exactSlotDeltaFixture();
  assert.equal(
    isPinnedSlotTransitionDelta(JSON.stringify(delta), "sce", intent),
    true,
  );
  const issues = delta.tables[0];
  const events = delta.tables[1];
  if (issues === undefined || events === undefined)
    throw new Error("unreachable");
  const issueDiff = issues.data_diff[0];
  const eventDiff = events.data_diff[0];
  if (issueDiff === undefined || eventDiff === undefined)
    throw new Error("unreachable");
  const from = issueDiff.from_row;
  const to = issueDiff.to_row;
  const eventTo = eventDiff.to_row;
  for (const malformed of [
    { ...delta, extra_root: true },
    {
      tables: [{ ...issues, schema_diff: { from_schema: "issues" } }, events],
    },
    {
      tables: [
        {
          ...issues,
          data_diff: [{ ...issueDiff, extra_diff: true }],
        },
        events,
      ],
    },
    {
      tables: [
        {
          ...issues,
          data_diff: [
            {
              from_row: { ...from, ignored_but_identical: "same" },
              to_row: { ...to, ignored_but_identical: "same" },
            },
          ],
        },
        events,
      ],
    },
    {
      tables: [
        issues,
        {
          ...events,
          data_diff: [
            {
              ...eventDiff,
              to_row: { ...eventTo, ignored_event_key: "same" },
            },
          ],
        },
      ],
    },
    { tables: [issues] },
    { tables: [issues, issues] },
    {
      tables: [
        {
          ...issues,
          data_diff: [issueDiff, issueDiff],
        },
        events,
      ],
    },
    {
      tables: [
        {
          ...issues,
          data_diff: [
            {
              from_row: { ...from, priority: "0" },
              to_row: { ...to, priority: "0" },
            },
          ],
        },
        events,
      ],
    },
  ])
    assert.equal(
      isPinnedSlotTransitionDelta(JSON.stringify(malformed), "sce", intent),
      false,
    );
});

test("remote slot-transition proof fails closed on every malformed delta layer", async () => {
  const root = await mkdtemp("/private/tmp/sce-remote-delta-");
  const fakeBd = join(root, "bd");
  const fakeDolt = join(root, "dolt");
  const beforeHead = "a".repeat(32);
  const effectHead = "b".repeat(32);
  try {
    const { delta, intent: localIntent } = exactSlotDeltaFixture();
    const intent = makeSlotTransitionIntent(
      "acquire",
      holder,
      scope,
      {
        head: beforeHead,
        remoteHead: beforeHead,
        slot: localIntent.before.slot,
      },
      localIntent.after,
    );
    const issues = delta.tables[0];
    const events = delta.tables[1];
    if (issues === undefined || events === undefined)
      throw new Error("unreachable");
    const issueDiff = issues.data_diff[0];
    const eventDiff = events.data_diff[0];
    if (issueDiff === undefined || eventDiff === undefined)
      throw new Error("unreachable");
    const malformedDeltas = [
      { ...delta, extra_root: true },
      {
        tables: [{ ...issues, schema_diff: { from_schema: "issues" } }, events],
      },
      {
        tables: [
          {
            ...issues,
            data_diff: [{ ...issueDiff, extra_diff: true }],
          },
          events,
        ],
      },
      {
        tables: [
          {
            ...issues,
            data_diff: [
              {
                from_row: {
                  ...issueDiff.from_row,
                  ignored_but_identical: "same",
                },
                to_row: {
                  ...issueDiff.to_row,
                  ignored_but_identical: "same",
                },
              },
            ],
          },
          events,
        ],
      },
      {
        tables: [
          issues,
          {
            ...events,
            data_diff: [
              {
                ...eventDiff,
                to_row: { ...eventDiff.to_row, ignored_event_key: "same" },
              },
            ],
          },
        ],
      },
    ];
    const remoteIssue = Buffer.from(
      JSON.stringify({
        rows: [
          {
            design: JSON.stringify(scope),
            external_ref: `sce-scope:v1:${deriveScopeCommitment(scope)}`,
            id: "sce-merge-slot",
            metadata: { holder },
            status: "in_progress",
            title: MERGE_SLOT_TITLE,
          },
        ],
      }),
      "utf8",
    ).toString("base64");
    const remoteLabels = Buffer.from(
      JSON.stringify({ rows: [{ label: MERGE_SLOT_LABEL }] }),
      "utf8",
    ).toString("base64");
    for (const [index, malformed] of malformedDeltas.entries()) {
      const mutationMarker = join(root, `mutation-${index}`);
      const diff = Buffer.from(JSON.stringify(malformed), "utf8").toString(
        "base64",
      );
      await executable(fakeBd, [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then printf "bd version 1.1.0\\n"; exit 0; fi',
        `touch '${mutationMarker}'`,
        "exit 1",
      ]);
      await executable(fakeDolt, [
        "#!/bin/sh",
        'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
        'if [ "$1" = "remote" ]; then printf "origin git+file://sync.test/repo\\n"; exit 0; fi',
        'if [ "$1" = "fetch" ]; then exit 0; fi',
        'if [ "$1" = "diff" ]; then',
        `  printf '%s' '${diff}' | base64 -D 2>/dev/null || printf '%s' '${diff}' | base64 -d`,
        "  exit 0",
        "fi",
        'if [ "$1" = "sql" ]; then',
        '  case "$5" in',
        `    *'DOLT_HASHOF("HEAD")'*) printf '{"rows":[{"head":"${effectHead}"}]}' ;;`,
        `    *"DOLT_HASHOF('origin/main')"*) printf '{"rows":[{"head":"${effectHead}"}]}' ;;`,
        "    *'SELECT * FROM dolt_status'*) printf '{}' ;;",
        `    *'dolt_commit_ancestors'*) printf '{"rows":[{"parent_hash":"${beforeHead}","parent_index":0}]}' ;;`,
        `    *'FROM issues AS OF'*) printf '%s' '${remoteIssue}' | base64 -D 2>/dev/null || printf '%s' '${remoteIssue}' | base64 -d ;;`,
        `    *'FROM labels AS OF'*) printf '%s' '${remoteLabels}' | base64 -D 2>/dev/null || printf '%s' '${remoteLabels}' | base64 -d ;;`,
        `    *) touch '${mutationMarker}'; exit 1 ;;`,
        "  esac",
        "  exit 0",
        "fi",
        `touch '${mutationMarker}'`,
        "exit 1",
      ]);
      const process = new PinnedBdEmbeddedProcess({
        bdExecutable: fakeBd,
        cwd: root,
        databaseDirectory: root,
        doltExecutable: fakeDolt,
        prefix: "sce",
        projections: {
          async discover() {
            return undefined;
          },
          async discoverAt() {
            return undefined;
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
          url: "git+file://sync.test/repo",
        },
        scope,
      });
      assert.deepEqual(
        await process.execute({ kind: "remote_slot_transition", intent }),
        {
          kind: "remote_slot_transition",
          value: {
            schema: "sce.beads-embedded.remote-slot-transition-proof",
            status: "ambiguous",
            version: 1,
          },
        },
      );
      await assert.rejects(access(mutationMarker));
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("remote clone merge binds its non-remote parent to the exact pre-effect lineage", async () => {
  const root = await mkdtemp("/private/tmp/sce-remote-lineage-");
  const fakeBd = join(root, "bd");
  const fakeDolt = join(root, "dolt");
  const beforeHead = "a".repeat(32);
  const effectHead = "b".repeat(32);
  const localHead = "c".repeat(32);
  const otherParent = "d".repeat(32);
  try {
    const { delta, intent: localIntent } = exactSlotDeltaFixture();
    const intent = makeSlotTransitionIntent(
      "acquire",
      holder,
      scope,
      {
        head: beforeHead,
        remoteHead: beforeHead,
        slot: localIntent.before.slot,
      },
      localIntent.after,
    );
    const cloneDelta = pinnedCloneDelta();
    const invalidCloneDelta = {
      tables: [
        ...cloneDelta.tables,
        {
          data_diff: [
            {
              from_row: { id: "sce-unrelated", status: "open" },
              to_row: { id: "sce-unrelated", status: "closed" },
            },
          ],
          name: "issues",
        },
      ],
    };
    const remoteIssue = Buffer.from(
      JSON.stringify({
        rows: [
          {
            design: JSON.stringify(scope),
            external_ref: `sce-scope:v1:${deriveScopeCommitment(scope)}`,
            id: "sce-merge-slot",
            metadata: { holder },
            status: "in_progress",
            title: MERGE_SLOT_TITLE,
          },
        ],
      }),
      "utf8",
    ).toString("base64");
    const remoteLabels = Buffer.from(
      JSON.stringify({ rows: [{ label: MERGE_SLOT_LABEL }] }),
      "utf8",
    ).toString("base64");
    const remoteEffect = Buffer.from(JSON.stringify(delta), "utf8").toString(
      "base64",
    );
    const localMerge = Buffer.from(JSON.stringify(cloneDelta), "utf8").toString(
      "base64",
    );
    for (const [name, ancestry, parentDelta, expected] of [
      ["valid", { rows: [{ matches: 1 }] }, cloneDelta, "observed"],
      ["non-ancestor", { rows: [{ matches: 0 }] }, cloneDelta, "ambiguous"],
      [
        "ambiguous-output",
        { rows: [{ matches: 1, unexpected: true }] },
        cloneDelta,
        "ambiguous",
      ],
      [
        "extra-delta",
        { rows: [{ matches: 1 }] },
        invalidCloneDelta,
        "ambiguous",
      ],
    ] as const) {
      const mutationMarker = join(root, `lineage-mutation-${name}`);
      const otherDelta = Buffer.from(
        JSON.stringify(parentDelta),
        "utf8",
      ).toString("base64");
      const ancestor = Buffer.from(JSON.stringify(ancestry), "utf8").toString(
        "base64",
      );
      await executable(fakeBd, [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then printf "bd version 1.1.0\\n"; exit 0; fi',
        `touch '${mutationMarker}'`,
        "exit 1",
      ]);
      await executable(fakeDolt, [
        "#!/bin/sh",
        'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
        'if [ "$1" = "remote" ]; then printf "origin git+file://sync.test/repo\\n"; exit 0; fi',
        'if [ "$1" = "fetch" ]; then exit 0; fi',
        'if [ "$1" = "diff" ]; then',
        `  if [ "$5" = "${beforeHead}" ] && [ "$6" = "${effectHead}" ]; then printf '%s' '${remoteEffect}' | base64 -D 2>/dev/null || printf '%s' '${remoteEffect}' | base64 -d; exit 0; fi`,
        `  if [ "$5" = "${effectHead}" ] && [ "$6" = "${localHead}" ]; then printf '%s' '${localMerge}' | base64 -D 2>/dev/null || printf '%s' '${localMerge}' | base64 -d; exit 0; fi`,
        `  if [ "$5" = "${beforeHead}" ] && [ "$6" = "${otherParent}" ]; then printf '%s' '${otherDelta}' | base64 -D 2>/dev/null || printf '%s' '${otherDelta}' | base64 -d; exit 0; fi`,
        `  touch '${mutationMarker}'; exit 1`,
        "fi",
        'if [ "$1" = "sql" ]; then',
        '  case "$5" in',
        `    *'DOLT_HASHOF("HEAD")'*) printf '{"rows":[{"head":"${localHead}"}]}' ;;`,
        `    *"DOLT_HASHOF('origin/main')"*) printf '{"rows":[{"head":"${effectHead}"}]}' ;;`,
        "    *'SELECT * FROM dolt_status'*) printf '{}' ;;",
        `    *"commit_hash = '${effectHead}'"*) printf '{"rows":[{"parent_hash":"${beforeHead}","parent_index":0}]}' ;;`,
        `    *"commit_hash = '${localHead}'"*) printf '{"rows":[{"parent_hash":"${effectHead}","parent_index":0},{"parent_hash":"${otherParent}","parent_index":1}]}' ;;`,
        `    *'WITH RECURSIVE ancestry'*) printf '%s' '${ancestor}' | base64 -D 2>/dev/null || printf '%s' '${ancestor}' | base64 -d ;;`,
        `    *'FROM issues AS OF'*) printf '%s' '${remoteIssue}' | base64 -D 2>/dev/null || printf '%s' '${remoteIssue}' | base64 -d ;;`,
        `    *'FROM labels AS OF'*) printf '%s' '${remoteLabels}' | base64 -D 2>/dev/null || printf '%s' '${remoteLabels}' | base64 -d ;;`,
        `    *) touch '${mutationMarker}'; exit 1 ;;`,
        "  esac",
        "  exit 0",
        "fi",
        `touch '${mutationMarker}'`,
        "exit 1",
      ]);
      const process = new PinnedBdEmbeddedProcess({
        bdExecutable: fakeBd,
        cwd: root,
        databaseDirectory: root,
        doltExecutable: fakeDolt,
        prefix: "sce",
        projections: {
          async discover() {
            return undefined;
          },
          async discoverAt() {
            return undefined;
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
          url: "git+file://sync.test/repo",
        },
        scope,
      });
      const actual = await process.execute({
        kind: "remote_slot_transition",
        intent,
      });
      assert.equal(actual.kind, "remote_slot_transition");
      assert.equal(actual.value.status, expected);
      await assert.rejects(access(mutationMarker));
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function run(cwd: string, command: string, args: readonly string[]) {
  return execute(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      DARWIN_USER_TEMP_DIR: process.env.DARWIN_USER_TEMP_DIR ?? "/private/tmp",
      LANG: "C",
      LC_ALL: "C",
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? "/private/tmp",
      TZ: "UTC",
    },
    maxBuffer: 262_144,
    timeout: 20_000,
  });
}

async function json(cwd: string, args: readonly string[]) {
  const { stdout } = await run(cwd, BD, args);
  return JSON.parse(stdout) as unknown;
}

function reduced(
  state: RepositoryRun,
  type: Parameters<typeof event>[1],
  fields: Record<string, unknown>,
): RepositoryRun {
  const result = reduce(state, event(state, type, fields));
  assert.equal(result.ok, true, `expected ${type} to reduce`);
  if (!result.ok) throw new Error("unreachable");
  return result.nextState;
}

/** Construct the exact root/one-child batch the controller journal retains. */
function batch(
  beforeState: RepositoryRun,
  nextState: RepositoryRun,
): MutationBatch {
  const before = makeRootProjection(beforeState);
  const nextBase = makeRootProjection(nextState);
  const beforeChild = before.childRows.find(
    (child) => child.unitId === "unit-1",
  );
  const nextChild = makeChildProjection(nextBase, "unit-1");
  assert.ok(beforeChild);
  assert.ok(nextChild);
  const changedRows = [
    {
      expectedCommitment: beforeChild.commitment,
      expectedRevision: beforeChild.revision,
      nextCommitment: nextChild.commitment,
      nextRevision: nextChild.revision,
      unitId: nextChild.unitId,
    },
  ];
  const root = withBatchCheckpoint(nextBase, changedRows);
  const value: MutationBatch = {
    changedRows,
    checkpoint: root.checkpoint,
    expectedAggregateCommitment: before.aggregateCommitment,
    expectedAggregateRevision: before.aggregateRevision,
    expectedChildren: [
      {
        expectedCommitment: beforeChild.commitment,
        expectedRevision: beforeChild.revision,
        unitId: beforeChild.unitId,
      },
    ],
    expectedHolder: holder,
    holder,
    next: { children: [nextChild], root },
    schema: "sce.fencing.batch",
    scope,
    version: 1,
  };
  assert.equal(validateMutationBatch(value).ok, true);
  return value;
}

function preflight(cwd: string) {
  return {
    payload: {
      beads: {
        beadsDir: join(cwd, ".beads"),
        contextSchemaVersion: 1 as const,
        database: "sce",
        mode: "embedded" as const,
        prefix: "sce",
        projectId: "store-1",
        provenance: "embedded_config" as const,
        storePath: join(cwd, ".beads", "embeddeddolt"),
        toolVersion: "1.1.0" as const,
      },
      git: {
        commonDir: join(cwd, ".git"),
        identity: "repo-1",
        objectFormat: "sha1" as const,
        topLevel: cwd,
      },
      status: "ready" as const,
    },
    schema: "sce.preflight" as const,
    version: 1 as const,
  };
}

function localProcess(
  cwd: string,
  database: string,
  projections: DoltProjectionPersistence,
) {
  return new PinnedBdEmbeddedProcess({
    bdExecutable: BD,
    cwd,
    databaseDirectory: database,
    doltExecutable: DOLT,
    prefix: "sce",
    projections,
    scope,
  });
}

function localAdapter(cwd: string, process: PinnedBdEmbeddedProcess) {
  return new EmbeddedBeadsAdapter({
    holder,
    mode: "local-only",
    prefix: "sce",
    preflight: preflight(cwd),
    process,
    scope,
  });
}

async function executable(
  path: string,
  body: readonly string[],
): Promise<void> {
  await writeFile(path, body.join("\n"), { mode: 0o700 });
  await chmod(path, 0o700);
}

test("concrete embedded matrix atomically persists root and child, recovers crashes, and blocks unrelated pending work", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-matrix-");
  try {
    await run(root, "git", ["init", "-q"]);
    await run(root, BD, [
      "init",
      "--non-interactive",
      "--skip-agents",
      "--skip-hooks",
      "-p",
      "sce",
      "--remote",
      "",
    ]);
    await json(root, ["merge-slot", "create", "--json"]);
    await json(root, ["create", "--id", "sce-root", "root", "--json"]);
    await json(root, ["create", "--id", "sce-child", "child", "--json"]);
    await json(root, [
      "update",
      "sce-merge-slot",
      "--external-ref",
      `sce-scope:v1:${deriveScopeCommitment(scope)}`,
      "--design",
      JSON.stringify(scope),
      "--json",
    ]);
    const database = join(root, ".beads", "embeddeddolt", "sce");
    const state0 = fixtureRun();
    const state1 = reduced(state0, "reservation_intent", {
      reservations: [
        { id: "reservation-1", namespace: "branch", resource: "main" },
      ],
    });
    const bootstrap = batch(state0, state1);
    const persistence = new DoltProjectionPersistence({
      childIssueId: (unitId) => (unitId === "unit-1" ? "sce-child" : undefined),
      databaseDirectory: database,
      doltExecutable: DOLT,
      rootIssueId: "sce-root",
    });
    assert.equal(
      (
        await persistence.initialize(
          PROJECTION_INITIALIZATION_AUTHORITY,
          bootstrap,
        )
      ).value,
      "applied",
    );
    assert.deepEqual(await persistence.readback(bootstrap), bootstrap.next);
    await run(root, BD, ["dolt", "commit", "--json"]);

    const state2 = reduced(state1, "reservation_observed", {
      effectId: "event-1:reservation_acquire",
      effectKind: "reservation_acquire",
      observationHash: HASH,
    });
    const state3 = reduced(state2, "branch_intent", {
      branchRef: "sce/unit-1",
    });
    const state4 = reduced(state3, "branch_observed", {
      branchRef: "sce/unit-1",
      effectId: "event-3:branch_create",
      effectKind: "branch_create",
      observationHash: HASH,
    });
    const process = localProcess(root, database, persistence);
    const adapter = localAdapter(root, process);
    const acquireIntent = await adapter.prepareAcquireTransition();
    assert.ok("idempotencyKey" in acquireIntent);
    assert.equal(
      (await adapter.acquire({ transition: acquireIntent })).code,
      "applied",
    );
    const policyBatches = [
      ["off", batch(state1, state2)],
      ["on", batch(state2, state3)],
      ["batch", batch(state3, state4)],
    ] as const;
    for (const [policy, controllerBatch] of policyBatches) {
      await run(root, BD, ["config", "set", "dolt.auto-commit", policy]);
      await run(root, BD, ["dolt", "commit", "--json"]);
      const before = await process.execute({ kind: "state" });
      assert.equal(before.kind, "state");
      assert.equal(before.value.autoCommit, policy);
      assert.equal(before.value.workingSet, "clean");
      const applied = await adapter.compareAndSet(controllerBatch);
      assert.equal(applied.status, "applied");
      assert.deepEqual(applied.children, controllerBatch.next.children);
      assert.deepEqual(applied.root, controllerBatch.next.root);
      const after = await process.execute({ kind: "state" });
      assert.equal(after.kind, "state");
      assert.equal(after.value.autoCommit, policy);
      assert.equal(after.value.workingSet, "clean");
    }
    const atomic = policyBatches[2][1];

    const stableBefore = await persistence.discover({
      batch: atomic,
      kind: "discover",
      point: "after_commit",
    });
    const staleRoot: MutationBatch = {
      ...atomic,
      expectedAggregateCommitment: "0".repeat(64),
    };
    const staleChildRows = atomic.changedRows.map((row) => ({
      ...row,
      expectedCommitment: "f".repeat(64),
    }));
    const staleChildRoot = withBatchCheckpoint(
      atomic.next.root,
      staleChildRows,
    );
    const staleChild: MutationBatch = {
      ...atomic,
      changedRows: staleChildRows,
      checkpoint: staleChildRoot.checkpoint,
      expectedChildren: atomic.expectedChildren.map((child) => ({
        ...child,
        expectedCommitment: "f".repeat(64),
      })),
      next: { ...atomic.next, root: staleChildRoot },
    };
    assert.equal(validateMutationBatch(staleRoot).ok, true);
    const staleChildValidation = validateMutationBatch(staleChild);
    assert.equal(
      staleChildValidation.ok,
      true,
      staleChildValidation.ok ? "" : staleChildValidation.reason,
    );
    assert.equal((await persistence.mutate(staleRoot)).value, "stale");
    assert.equal((await persistence.mutate(staleChild)).value, "stale");
    assert.deepEqual(
      await persistence.discover({
        batch: atomic,
        kind: "discover",
        point: "after_commit",
      }),
      stableBefore,
    );

    // Simulate termination after the atomic write but before commit. A fresh
    // process has only the controller batch as authority and must resume once.
    const state5 = reduced(state4, "worktree_intent", {
      worktreePath: "/private/tmp/sce-unit-1",
    });
    const beforeCommit = batch(state4, state5);
    assert.equal((await persistence.mutate(beforeCommit)).value, "applied");
    const restartedBeforeCommit = localAdapter(
      root,
      localProcess(
        root,
        database,
        new DoltProjectionPersistence({
          childIssueId: (unitId) =>
            unitId === "unit-1" ? "sce-child" : undefined,
          databaseDirectory: database,
          doltExecutable: DOLT,
          rootIssueId: "sce-root",
        }),
      ),
    );
    assert.equal(
      (await restartedBeforeCommit.compareAndSet(beforeCommit)).status,
      "applied",
    );
    assert.equal(
      (
        await persistence.discover({
          batch: beforeCommit,
          kind: "discover",
          point: "after_commit",
        })
      )?.status,
      "observed",
    );

    // Simulate a crash after commit. The replacement process finds the exact
    // batch rather than reissuing a write, and still returns its durable row.
    const state6 = reduced(state5, "worktree_observed", {
      effectId: "event-5:worktree_create",
      effectKind: "worktree_create",
      observationHash: HASH,
      worktreePath: "/private/tmp/sce-unit-1",
    });
    const afterCommit = batch(state5, state6);
    assert.equal((await persistence.mutate(afterCommit)).value, "applied");
    assert.equal((await process.execute({ kind: "commit" })).value, "applied");
    const restartedAfterCommit = localAdapter(
      root,
      localProcess(root, database, persistence),
    );
    assert.equal(
      (await restartedAfterCommit.compareAndSet(afterCommit)).status,
      "applied",
    );

    const baseline = await restartedAfterCommit.workerBaseline();
    assert.ok(baseline);
    const state7 = reduced(state6, "dispatch_intent", {});
    const unrelated = batch(state6, state7);
    await json(root, [
      "create",
      "--id",
      "sce-unrelated",
      "unrelated",
      "--json",
    ]);
    assert.equal(
      (await restartedAfterCommit.verifyWorkerBaseline(baseline)).code,
      "worker_mutation",
    );
    // An unrelated pending row is not treated as proof of a controller batch;
    // recovery does not commit, pull, or rewrite it.
    const pendingBefore = await process.execute({ kind: "state" });
    assert.equal(pendingBefore.kind, "state");
    assert.equal(pendingBefore.value.workingSet, "pending");
    assert.equal(
      (await restartedAfterCommit.compareAndSet(unrelated)).status,
      "ambiguous",
    );
    const pendingAfter = await process.execute({ kind: "state" });
    assert.deepEqual(pendingAfter, pendingBefore);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("pinned process refuses schema skew without surfacing subprocess secrets", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-schema-");
  const fakeBd = join(root, "bd");
  try {
    await writeFile(
      fakeBd,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo \'bd version 1.1.0\'; exit 0; fi',
        'if [ "$1" = "dolt" ] && [ "$2" = "show" ]; then',
        '  echo \'{"backend":"dolt","embedded":true,"schema_version":2,"data_dir":"/secret/never-returned","database":"sce"}\'',
        "  echo 'token=never-returned' >&2",
        "  exit 0",
        "fi",
        "echo '{}'",
      ].join("\n"),
      { mode: 0o700 },
    );
    await chmod(fakeBd, 0o700);
    const process = new PinnedBdEmbeddedProcess({
      bdExecutable: fakeBd,
      cwd: root,
      databaseDirectory: root,
      doltExecutable: DOLT,
      prefix: "sce",
      projections: {
        async discover() {
          return undefined;
        },
        async discoverAt() {
          return undefined;
        },
        async mutate() {
          return { kind: "mutation", value: "quarantined" } as const;
        },
        async readback() {
          return undefined;
        },
      },
      scope,
    });
    const observed = await process.execute({ kind: "state" });
    assert.deepEqual(observed, {
      kind: "state",
      value: { autoCommit: "off", reachable: false, workingSet: "unknown" },
    });
    const adapter = new EmbeddedBeadsAdapter({
      holder,
      mode: "local-only",
      prefix: "sce",
      preflight: preflight(root),
      process,
      scope,
    });
    const result = await adapter.acquire();
    assert.equal(result.code, "quarantined");
    assert.equal(JSON.stringify(result).includes("never-returned"), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("projection reads reject swapped, duplicate, extra, skewed, and wrong commitment rows", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-rows-");
  const fakeDolt = join(root, "dolt");
  try {
    const state0 = fixtureRun();
    const state1 = reduced(state0, "reservation_intent", {
      reservations: [
        { id: "reservation-rows", namespace: "branch", resource: "main" },
      ],
    });
    const controllerBatch = batch(state0, state1);
    const rootRow = {
      id: "sce-root",
      sce: {
        commitment: controllerBatch.next.root.aggregateCommitment,
        projection: controllerBatch.next.root,
      },
    };
    const child = controllerBatch.next.children[0];
    assert.ok(child);
    const childRow = {
      id: "sce-child",
      sce: { commitment: child.commitment, projection: child },
    };
    const malformedRows: readonly unknown[][] = [
      [
        { ...rootRow, id: "sce-child" },
        { ...childRow, id: "sce-root" },
      ],
      [rootRow, rootRow],
      [rootRow, childRow, { ...childRow, id: "sce-extra" }],
      [
        { ...rootRow, sce: { ...rootRow.sce, commitment: "0".repeat(64) } },
        childRow,
      ],
      [{ ...rootRow, extra: true }, childRow],
      [{ ...rootRow, sce: { ...rootRow.sce, extra: true } }, childRow],
    ];
    for (const rows of malformedRows) {
      const output = Buffer.from(JSON.stringify({ rows }), "utf8").toString(
        "base64",
      );
      await executable(fakeDolt, [
        "#!/bin/sh",
        'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
        `printf '%s' '${output}' | base64 -D 2>/dev/null || printf '%s' '${output}' | base64 -d`,
      ]);
      const persistence = new DoltProjectionPersistence({
        childIssueId: (unitId) =>
          unitId === "unit-1" ? "sce-child" : undefined,
        databaseDirectory: root,
        doltExecutable: fakeDolt,
        rootIssueId: "sce-root",
      });
      assert.equal(await persistence.readback(controllerBatch), undefined);
      assert.equal(
        await persistence.discover({
          batch: controllerBatch,
          kind: "discover",
          point: "after_commit",
        }),
        undefined,
      );
      assert.equal(
        await persistence.discoverAt(
          {
            batch: controllerBatch,
            kind: "discover",
            point: "after_push",
          },
          "origin/main",
        ),
        undefined,
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("projection executor bounds malformed, oversized, timed-out, replaced, and secret subprocess output", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-exec-");
  const fakeDolt = join(root, "dolt");
  const marker = join(root, "sql-ran");
  try {
    const state0 = fixtureRun();
    const state1 = reduced(state0, "reservation_intent", {
      reservations: [
        { id: "reservation-boundary", namespace: "branch", resource: "main" },
      ],
    });
    const controllerBatch = batch(state0, state1);
    const persistence = new DoltProjectionPersistence({
      childIssueId: (unitId) => (unitId === "unit-1" ? "sce-child" : undefined),
      databaseDirectory: root,
      doltExecutable: fakeDolt,
      rootIssueId: "sce-root",
    });

    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
      "printf 'not-json'",
      "printf 'credential=never-leaves-subprocess' >&2",
    ]);
    assert.equal(await persistence.readback(controllerBatch), undefined);

    // A realpath/stat replacement must invalidate the former version proof.
    // The SQL side effect would expose stale cached authorization.
    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 9.9.9\\n"; exit 0; fi',
      'touch "$PWD/sql-ran"',
      "printf '{\"rows\":[]}'",
      "# different fingerprint",
    ]);
    assert.equal(await persistence.readback(controllerBatch), undefined);
    await assert.rejects(access(marker));

    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
      "yes x | head -c 262145",
      "# oversized output",
    ]);
    assert.equal(await persistence.readback(controllerBatch), undefined);

    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then printf "dolt version 2.2.1\\n"; exit 0; fi',
      "sleep 16",
      "# timeout",
    ]);
    const started = Date.now();
    assert.equal(await persistence.readback(controllerBatch), undefined);
    assert.ok(Date.now() - started >= 14_000);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("post-version executable replacement never reaches projection Dolt, pinned bd, or process Dolt", async () => {
  const root = await mkdtemp("/private/tmp/sce-real-self-replace-");
  const fakeDolt = join(root, "dolt");
  const fakeBd = join(root, "bd");
  const replacement = join(root, "replacement");
  const marker = join(root, "replacement-ran");
  try {
    const state0 = fixtureRun();
    const state1 = reduced(state0, "reservation_intent", {
      reservations: [
        {
          id: "reservation-self-replace",
          namespace: "branch",
          resource: "main",
        },
      ],
    });
    const controllerBatch = batch(state0, state1);
    await executable(replacement, ["#!/bin/sh", `touch '${marker}'`, "exit 0"]);

    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then',
      '  printf "dolt version 2.2.1\\n"',
      `  cp -f '${replacement}' "$0"`,
      '  chmod 700 "$0"',
      "  exit 0",
      "fi",
      `touch '${marker}'`,
    ]);
    const projection = new DoltProjectionPersistence({
      childIssueId: (unitId) => (unitId === "unit-1" ? "sce-child" : undefined),
      databaseDirectory: root,
      doltExecutable: fakeDolt,
      rootIssueId: "sce-root",
    });
    assert.equal(await projection.readback(controllerBatch), undefined);
    await assert.rejects(access(marker));

    await executable(fakeBd, [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then',
      "  printf 'bd version 1.1.0\\n'",
      `  cp -f '${replacement}' "$0"`,
      '  chmod 700 "$0"',
      "  exit 0",
      "fi",
      `touch '${marker}'`,
    ]);
    const bdReplacement = new PinnedBdEmbeddedProcess({
      bdExecutable: fakeBd,
      cwd: root,
      databaseDirectory: root,
      doltExecutable: DOLT,
      prefix: "sce",
      projections: {
        async discover() {
          return undefined;
        },
        async discoverAt() {
          return undefined;
        },
        async mutate() {
          return { kind: "mutation", value: "quarantined" } as const;
        },
        async readback() {
          return undefined;
        },
      },
      scope,
    });
    const bdState = await bdReplacement.execute({ kind: "state" });
    assert.equal(bdState.kind, "state");
    assert.equal(bdState.value.reachable, false);
    await assert.rejects(access(marker));

    await mkdir(join(root, "database"));
    await executable(fakeBd, [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then printf "bd version 1.1.0\\n"; exit 0; fi',
      'if [ "$1" = "dolt" ] && [ "$2" = "status" ]; then',
      `  printf '{"mode":"embedded","schema_version":1,"data_dir_exists":true,"data_dir":"${root}","server_running":false}'`,
      "  exit 0",
      "fi",
      'if [ "$1" = "dolt" ] && [ "$2" = "show" ]; then',
      `  printf '{"backend":"dolt","embedded":true,"schema_version":1,"data_dir":"${root}","database":"database"}'`,
      "  exit 0",
      "fi",
      'if [ "$1" = "config" ]; then',
      '  printf \'{"key":"dolt.auto-commit","schema_version":1,"value":"on"}\'',
      "  exit 0",
      "fi",
      "exit 1",
    ]);
    await executable(fakeDolt, [
      "#!/bin/sh",
      'if [ "$1" = "version" ]; then',
      '  printf "dolt version 2.2.1\\n"',
      `  cp -f '${replacement}' "$0"`,
      '  chmod 700 "$0"',
      "  exit 0",
      "fi",
      `touch '${marker}'`,
    ]);
    const doltReplacement = new PinnedBdEmbeddedProcess({
      bdExecutable: fakeBd,
      cwd: root,
      databaseDirectory: join(root, "database"),
      doltExecutable: fakeDolt,
      prefix: "sce",
      projections: {
        async discover() {
          return undefined;
        },
        async discoverAt() {
          return undefined;
        },
        async mutate() {
          return { kind: "mutation", value: "quarantined" } as const;
        },
        async readback() {
          return undefined;
        },
      },
      scope,
    });
    const doltState = await doltReplacement.execute({ kind: "state" });
    assert.equal(doltState.kind, "state");
    assert.equal(doltState.value.reachable, false);
    await assert.rejects(access(marker));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
