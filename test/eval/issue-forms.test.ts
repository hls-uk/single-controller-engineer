import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public feedback forms collect bounded actionable fields and existing labels", async () => {
  const [bug, enhancement, configuration] = await Promise.all([
    readFile(".github/ISSUE_TEMPLATE/bug.yml", "utf8"),
    readFile(".github/ISSUE_TEMPLATE/enhancement.yml", "utf8"),
    readFile(".github/ISSUE_TEMPLATE/config.yml", "utf8"),
  ]);
  assert.match(bug, /labels: \[bug\]/u);
  assert.match(
    bug,
    /options: \[adapter, capability, protocol, runtime, topology\]/u,
  );
  assert.match(enhancement, /labels: \[enhancement\]/u);
  assert.doesNotMatch(bug + enhancement, /needs-triage|duplicate-feedback/u);
  assert.match(configuration, /blank_issues_enabled: true/u);
});
