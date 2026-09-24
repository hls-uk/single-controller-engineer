import assert from "node:assert/strict";
import test from "node:test";

import { isPinnedBdIssueRow } from "../../../src/adapters/beads-embedded/index.js";

// The exact bd 1.1.0 issue row as Dolt 2.2.1 `-r json` prints it: every NULL
// column (assignee, external_ref, started_at, closed_at) is omitted rather
// than printed as null.
const numeric = [
  "compaction_level",
  "ephemeral",
  "is_blocked",
  "is_template",
  "no_history",
  "pinned",
  "priority",
  "timeout_ns",
];
const text = [
  "acceptance_criteria",
  "actor",
  "agent_state",
  "await_id",
  "await_type",
  "close_reason",
  "closed_by_session",
  "content_hash",
  "created_by",
  "description",
  "design",
  "event_kind",
  "hook_bead",
  "mol_type",
  "notes",
  "owner",
  "payload",
  "rig",
  "role_bead",
  "role_type",
  "sender",
  "source_repo",
  "source_system",
  "spec_id",
  "target",
  "waiters",
  "wisp_type",
  "work_type",
];
function row(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...Object.fromEntries(numeric.map((key) => [key, 0])),
    ...Object.fromEntries(text.map((key) => [key, ""])),
    created_at: "2026-09-22 10:00:00",
    id: "sce-unit-1",
    issue_type: "task",
    metadata: {},
    status: "open",
    title: "unit",
    updated_at: "2026-09-22 10:00:01",
    ...extra,
  };
}

test("an open unit bead row is a pinned issue row", () => {
  assert.equal(isPinnedBdIssueRow(row()), true);
});

// sce-296.15: a unit's child projection row is its bead. `bd close` sets the
// nullable `closed_at`, which then appears in every later diff of that row,
// so a landed unit whose bead was closed could never prove its reservation
// release and the run blocked in reservation_release_intent forever.
test("a closed unit bead row keeps its pinned shape", () => {
  assert.equal(
    isPinnedBdIssueRow(
      row({ closed_at: "2026-09-22 19:17:01", status: "closed" }),
    ),
    true,
  );
  assert.equal(
    isPinnedBdIssueRow(
      row({
        closed_at: "2026-09-22 19:17:01",
        started_at: "2026-09-22 11:00:00",
        status: "closed",
      }),
    ),
    true,
  );
});

test("a malformed closed_at or an unknown column is still refused", () => {
  assert.equal(isPinnedBdIssueRow(row({ closed_at: "yesterday" })), false);
  assert.equal(isPinnedBdIssueRow(row({ closed_at: null })), false);
  assert.equal(
    isPinnedBdIssueRow(row({ reopened_at: "2026-09-22 19:17:01" })),
    false,
  );
});

// sce-f63: `bd update --claim` on a unit's bead sets the nullable `assignee`
// beside `started_at` and moves `status` to `in_progress`. Without `assignee`
// in the pinned shape every later checkpoint read-back failed after its rows
// were written, leaving the Dolt working set pending and the run ambiguous.
test("a claimed unit bead row keeps its pinned shape", () => {
  assert.equal(
    isPinnedBdIssueRow(
      row({
        assignee: "adam",
        started_at: "2026-09-22 11:00:00",
        status: "in_progress",
      }),
    ),
    true,
  );
  // A claim that bd recorded without a start, and a claimed bead later closed
  // against a scoped merge slot, are the same pinned row plus their columns.
  assert.equal(isPinnedBdIssueRow(row({ assignee: "adam" })), true);
  assert.equal(
    isPinnedBdIssueRow(
      row({
        assignee: "adam",
        closed_at: "2026-09-22 19:17:01",
        external_ref: "sce-scope:v1:0",
        started_at: "2026-09-22 11:00:00",
        status: "closed",
      }),
    ),
    true,
  );
});

test("an assignee that is not a bd actor string is refused", () => {
  // Dolt omits a NULL column rather than printing it, so a literal null is
  // output this adapter has never observed: it blocks instead of guessing.
  assert.equal(isPinnedBdIssueRow(row({ assignee: null })), false);
  assert.equal(isPinnedBdIssueRow(row({ assignee: 1 })), false);
  assert.equal(
    isPinnedBdIssueRow(row({ assignee: "adam", assigned_at: "2026-09-22" })),
    false,
  );
});
