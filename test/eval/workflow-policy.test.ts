import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("validation workflow is read-only, immutable-action, and runs the accelerated beta gates", async () => {
  const source = await readFile(".github/workflows/validate.yml", "utf8");
  assert.match(source, /^permissions:\n  contents: read$/mu);
  assert.match(source, /persist-credentials: false/u);
  assert.doesNotMatch(
    source,
    /pull_request_target|self-hosted|id-token:\s*write|issues:\s*write|npm publish/u,
  );
  const uses = [...source.matchAll(/^\s*- uses: ([^\s#]+)/gmu)].map(
    (match) => match[1]!,
  );
  assert.ok(uses.length >= 2);
  assert.ok(
    uses.every((action) => /@[0-9a-f]{40}$/u.test(action)),
    `mutable action reference: ${uses.join(", ")}`,
  );
  for (const command of [
    "npm ci --ignore-scripts",
    "npm run check:format",
    "npm run typecheck",
    "npm run test:fast",
    "npm run test:integration",
    "npm run build",
    "npm run test:package",
    "git diff --exit-code",
  ])
    assert.ok(source.includes(command), `missing validation gate: ${command}`);
});
