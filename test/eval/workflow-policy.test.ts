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
  const uses = [...source.matchAll(/^[ \t]*(?:- )?uses: ([^\s#]+)/gmu)].map(
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

async function workflow(name: string) {
  return readFile(`.github/workflows/${name}.yml`, "utf8");
}

function immutableActions(source: string, expected: readonly string[]) {
  const uses = [...source.matchAll(/^[ \t]*(?:- )?uses: ([^\s#]+)/gmu)].map(
    (match) => match[1]!,
  );
  assert.deepEqual([...new Set(uses)].sort(), [...expected].sort());
  assert.ok(
    uses.every((action) => /@[0-9a-f]{40}$/u.test(action)),
    `mutable action reference: ${uses.join(", ")}`,
  );
}

test("publish workflow separates build authority from an explicitly disabled OIDC publish job", async () => {
  const source = await workflow("publish");
  assert.match(source, /^on:\n  push:\n    tags: \["v\*"\]$/mu);
  assert.match(source, /^  group: publish-\$\{\{ github\.ref \}\}$/mu);
  assert.match(source, /^  cancel-in-progress: false$/mu);
  assert.match(source, /^  build:\n/mu);
  assert.match(source, /^  publish:\n/mu);
  const jobs = source.slice(source.indexOf("jobs:\n"));
  const build = jobs.slice(0, jobs.indexOf("\n  publish:\n"));
  const publish = source.slice(source.indexOf("\n  publish:\n"));
  assert.equal((jobs.match(/^  [a-z-]+:\n/gmu) ?? []).length, 2);
  for (const job of [build, publish]) {
    assert.match(
      job,
      /if: \$\{\{ github\.repository == 'hls-uk\/single-controller-engineer' && github\.ref_type == 'tag' && github\.ref_protected && vars\.SCE_NPM_RELEASE_ENABLED == 'true' \}\}/u,
    );
  }
  assert.match(source, /vars\.SCE_NPM_RELEASE_ENABLED == 'true'/u);
  assert.match(
    source,
    /github\.repository == 'hls-uk\/single-controller-engineer'/u,
  );
  assert.match(source, /github\.ref_type == 'tag'/u);
  assert.match(source, /github\.ref_protected/u);
  assert.match(source, /actions: read\n      contents: read/u);
  assert.match(source, /environment_name: "npm-release"/u);
  assert.match(source, /protected_branches !== true/u);
  assert.match(source, /rule\.type === "wait_timer" && rule\.wait_timer > 0/u);
  assert.match(source, /hasProtectionRule/u);
  assert.match(source, /environment: npm-release/u);
  assert.match(source, /id-token: write/u);
  assert.equal((source.match(/node-version: 24\.19\.0/gmu) ?? []).length, 2);
  assert.equal((source.match(/npm --version/gmu) ?? []).length, 2);
  assert.match(source, /npm ci --ignore-scripts/u);
  assert.match(
    source,
    /npm pack --ignore-scripts --pack-destination release-artifact/u,
  );
  assert.match(source, /node scripts\/release-gates\.mjs verify-source/u);
  assert.match(source, /git fetch --no-tags origin main/u);
  assert.match(source, /path: "package\.json"/u);
  assert.match(source, /git diff --exit-code/u);
  assert.match(source, /name: sce-release-artifact/u);
  assert.match(
    source,
    /actions\/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0/u,
  );
  assert.match(
    source,
    /npm publish "release-artifact\/hls-uk-single-controller-engineer-\$\{GITHUB_REF_NAME#v\}\.tgz" --access public --ignore-scripts --provenance/u,
  );
  assert.match(source, /--registry=https:\/\/registry\.npmjs\.org/u);
  assert.match(source, /--userconfig=\/dev\/null/u);
  assert.match(source, /value\.dist\?\.attestations/u);
  assert.match(source, /"provenance\|url"/u);
  assert.match(source, /attestations\.provenance\.predicateType/u);
  assert.match(source, /https:\/\/registry\.npmjs\.org/u);
  assert.match(source, /await fetch\(attestationUrl/u);
  assert.match(source, /redirect: "error"/u);
  assert.match(source, /Buffer\.byteLength\(raw, "utf8"\) > 262_144/u);
  assert.match(
    source,
    /https:\/\/github\.com\/npm\/attestation\/tree\/main\/specs\/publish\/v0\.1/u,
  );
  assert.match(source, /https:\/\/slsa\.dev\/provenance\/v1/u);
  assert.doesNotMatch(
    source,
    /NPM_TOKEN|NODE_AUTH_TOKEN|cache:|self-hosted|pull_request_target/u,
  );
  assert.doesNotMatch(publish, /npm (ci|run build|pack)\b/u);
  immutableActions(source, [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0",
    "actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  ]);
});

test("feedback workflow is disabled, pinned, serialized, and acts only on a revalidated deterministic plan", async () => {
  const source = await workflow("feedback-triage");
  const triageSource = await readFile("scripts/feedback-triage.mjs", "utf8");
  assert.match(source, /^on:\n  issues:\n    types: \[opened\]$/mu);
  assert.match(source, /^  group: feedback-triage$/mu);
  assert.match(source, /^  cancel-in-progress: false$/mu);
  assert.match(source, /vars\.SCE_FEEDBACK_TRIAGE_ENABLED == 'true'/u);
  assert.match(
    source,
    /github\.repository == 'hls-uk\/single-controller-engineer'/u,
  );
  assert.match(source, /ref: main/u);
  assert.match(source, /persist-credentials: false/u);
  assert.match(source, /github-token: \$\{\{ github\.token \}\}/u);
  const checkout = source.slice(0, source.indexOf("actions/github-script"));
  assert.doesNotMatch(checkout, /\btoken:/u);
  assert.match(source, /contents: read\n      issues: write/u);
  assert.match(
    source,
    /await github\.paginate\(github\.rest\.issues\.listForRepo/u,
  );
  assert.match(source, /state: "open"/u);
  assert.match(source, /issue\.pull_request === undefined/u);
  assert.match(source, /await github\.rest\.issues\.get/u);
  assert.match(source, /current\.data\.state !== "open"/u);
  assert.match(source, /return triagePlan\(/u);
  assert.match(source, /discovery\.issues\[row\] =/u);
  assert.match(source, /let plan = await currentPlan\(\);/u);
  assert.match(source, /plan = await currentPlan\(\);/u);
  assert.match(source, /labels: \["duplicate"\]/u);
  assert.match(
    triageSource,
    /Duplicate feedback report; canonical issue: https:\/\/github\.com\/\$\{REPOSITORY\}\/issues\/\$\{canonical\}/u,
  );
  assert.match(
    source,
    /await github\.paginate\(github\.rest\.issues\.listComments/u,
  );
  assert.match(source, /comment\.user\?\.login === "github-actions\[bot\]"/u);
  assert.match(source, /comment\.body === plan\.comment/u);
  assert.match(source, /if \(!alreadyCommented\)/u);
  assert.doesNotMatch(source, /\$\{[^}]*issue\.(?:body|title)/u);
  assert.doesNotMatch(
    source,
    /close\(|state:\s*["']closed|pull_request_target|self-hosted|\$\{\{ github\.event\.issue\.(title|body)/u,
  );
  immutableActions(source, [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd",
  ]);
});
