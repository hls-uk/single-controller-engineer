#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceRoot = resolve(import.meta.dirname);
const root = requestedRoot(process.argv.slice(2));
const templateRoot = resolve(
  sourceRoot,
  "../../skills/single-controller-knowledge/references/manifest/checks",
);
const checks = [
  "validate-manifest.mjs",
  "check-markdown-format.mjs",
  "check-frontmatter.mjs",
  "check-relative-links.mjs",
  "check-boundary.mjs",
  "check-secrets.mjs",
  "check-generated.mjs",
  "check-provenance.mjs",
  "check-supersession.mjs",
];
const candidatePaths = candidateChangedPaths(root);

for (const check of checks) {
  const started = performance.now();
  const result = invoke(check, [
    "--root",
    root,
    ...(check === "check-boundary.mjs"
      ? candidatePaths.flatMap((path) => ["--changed-path", path])
      : []),
  ]);
  const elapsed = Math.round(performance.now() - started);
  if (result.status !== 0)
    fail(`${check} failed:\n${result.stderr || result.stdout}`);
  if (elapsed >= 60_000) fail(`${check} exceeded sixty seconds (${elapsed}ms)`);
  process.stdout.write(`${check}: pass (${elapsed}ms)\n`);
}

if (process.env.SCE_FAST_GATE_SELF_TEST !== "0") runSelfTests();

process.stdout.write("knowledge example fast gate: pass\n");

function runSelfTests() {
  const temporary = mkdtempSync(join(tmpdir(), "sce-knowledge-example-"));
  try {
    const unknownManifest = JSON.parse(
      readFileSync(join(root, "knowledge-manifest.json"), "utf8"),
    );
    unknownManifest.unexpected = true;
    const unknownPath = join(temporary, "unknown-manifest.json");
    writeFileSync(
      unknownPath,
      `${JSON.stringify(unknownManifest, null, 2)}\n`,
      "utf8",
    );
    expectFailure(
      "unknown manifest key",
      invoke("validate-manifest.mjs", [
        "--root",
        root,
        "--manifest",
        unknownPath,
      ]),
      "unknown key unexpected",
    );

    const nestedUnknownManifest = JSON.parse(
      readFileSync(join(root, "knowledge-manifest.json"), "utf8"),
    );
    nestedUnknownManifest.boundaryPolicy.unexpected = true;
    const nestedUnknownPath = join(temporary, "nested-unknown-manifest.json");
    writeFileSync(
      nestedUnknownPath,
      `${JSON.stringify(nestedUnknownManifest, null, 2)}\n`,
      "utf8",
    );
    expectFailure(
      "nested unknown manifest key",
      invoke("validate-manifest.mjs", [
        "--root",
        root,
        "--manifest",
        nestedUnknownPath,
      ]),
      "unknown key unexpected",
    );

    const boundaryRoot = join(temporary, "boundary-repository");
    copyRepositoryFixture(boundaryRoot);
    mkdirSync(join(boundaryRoot, "private"));
    writeFileSync(
      join(boundaryRoot, "private/seeded-violation.md"),
      "# Must not pass the complete gate\n",
      "utf8",
    );
    expectFailure(
      "seeded boundary violation",
      invoke("check-boundary.mjs", ["--root", boundaryRoot]),
      "no declared artifact home",
    );

    const changedBoundaryRoot = join(temporary, "changed-boundary-repository");
    copyCandidateFixture(changedBoundaryRoot);
    const baseline = commitFixture(changedBoundaryRoot, "baseline");
    writeFileSync(
      join(changedBoundaryRoot, "AGENTS.md"),
      `${readFileSync(join(changedBoundaryRoot, "AGENTS.md"), "utf8")}\nOut-of-scope candidate change.\n`,
      "utf8",
    );
    const candidate = commitFixture(changedBoundaryRoot, "candidate");
    expectFailure(
      "seeded changed-path boundary violation through complete gate",
      invokeFastGate(changedBoundaryRoot, baseline, candidate),
      "changed path is outside allowed write roots: AGENTS.md",
    );

    const allowedBoundaryRoot = join(temporary, "allowed-boundary-repository");
    copyCandidateFixture(allowedBoundaryRoot);
    const allowedBaseline = commitFixture(allowedBoundaryRoot, "baseline");
    const allowedPage = join(
      allowedBoundaryRoot,
      "knowledge/current/access-guide.md",
    );
    writeFileSync(
      allowedPage,
      readFileSync(allowedPage, "utf8").replace(
        "Use the repository copy as the current source.",
        "Use the reviewed repository copy as the current source.",
      ),
      "utf8",
    );
    const allowedCandidate = commitFixture(allowedBoundaryRoot, "candidate");
    expectSuccess(
      "seeded allowed changed path through complete gate",
      invokeFastGate(allowedBoundaryRoot, allowedBaseline, allowedCandidate),
    );

    const referenceRoot = join(temporary, "reference-repository");
    copyRepositoryFixture(referenceRoot);
    writeFileSync(
      join(referenceRoot, "knowledge/current/broken-reference.md"),
      "# Broken reference\n\n[Missing page][missing]\n\n[missing]: ../missing.md\n",
      "utf8",
    );
    expectFailure(
      "seeded broken reference link",
      invoke("check-relative-links.mjs", ["--root", referenceRoot]),
      "unresolved link",
    );

    const provenanceRoot = join(temporary, "provenance-repository");
    copyRepositoryFixture(provenanceRoot);
    writeFileSync(
      join(provenanceRoot, "events/deficient.md"),
      "---\nschema: sce.knowledge-provenance\nversion: 1\nid: deficient\n---\n\n# Provenance record\n",
      "utf8",
    );
    expectFailure(
      "seeded deficient provenance record",
      invoke("check-provenance.mjs", ["--root", provenanceRoot]),
      "missing required key",
    );

    const driftRoot = join(temporary, "drift-repository");
    copyRepositoryFixture(driftRoot);
    writeFileSync(
      join(driftRoot, "generated/timeline.md"),
      "# Knowledge timeline\n\nSeeded drift.\n",
      "utf8",
    );
    expectFailure(
      "seeded reproducibility drift",
      invoke("check-generated.mjs", ["--root", driftRoot]),
      "generated output drift",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function copyRepositoryFixture(destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of [
    "AGENTS.md",
    "CLAUDE.md",
    "events",
    "generated",
    "knowledge",
    "knowledge-manifest.json",
    "schemas",
    "scripts",
    "test-fast.mjs",
  ]) {
    cpSync(join(root, entry), join(destination, entry), { recursive: true });
  }
}

function copyCandidateFixture(destination) {
  copyRepositoryFixture(destination);
  rmSync(join(destination, "events/example-event.md"), { force: true });
  const rebuilt = join(destination, ".generated-rebuild");
  execFileSync(
    process.execPath,
    [join(destination, "scripts/generate-rollup.mjs"), "--output", rebuilt],
    { cwd: destination, env: hermeticEnvironment() },
  );
  rmSync(join(destination, "generated"), { force: true, recursive: true });
  cpSync(rebuilt, join(destination, "generated"), { recursive: true });
  rmSync(rebuilt, { force: true, recursive: true });
}

function invoke(check, args) {
  return spawnSync(process.execPath, [join(templateRoot, check), ...args], {
    cwd: root,
    encoding: "utf8",
    env: hermeticEnvironment(),
    timeout: 60_000,
  });
}

function invokeFastGate(repository, baseOid) {
  return spawnSync(process.execPath, [process.argv[1], "--root", repository], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...hermeticEnvironment(),
      SCE_CANDIDATE_BASE_OID: baseOid,
      SCE_FAST_GATE_SELF_TEST: "0",
    },
    timeout: 60_000,
  });
}

function requestedRoot(argv) {
  if (argv.length === 0) return resolve(import.meta.dirname);
  if (argv.length !== 2 || argv[0] !== "--root" || !argv[1])
    fail("usage: test-fast.mjs [--root <repository>]");
  return resolve(argv[1]);
}

function commitFixture(repository, message) {
  if (message === "baseline") {
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    execFileSync("git", ["config", "user.name", "Knowledge Fixture"], {
      cwd: repository,
    });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], {
      cwd: repository,
    });
  }
  execFileSync("git", ["add", "--all"], { cwd: repository });
  execFileSync("git", ["commit", "--quiet", "-m", message], {
    cwd: repository,
  });
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}

function candidateChangedPaths(repository) {
  if (process.env.SCE_KNOWLEDGE_BASELINE === "1") {
    if (process.env.SCE_CANDIDATE_BASE_OID)
      fail("baseline validation cannot also bind a candidate base OID");
    return [];
  }
  if (process.env.SCE_KNOWLEDGE_BASELINE)
    fail("SCE_KNOWLEDGE_BASELINE must be exactly 1 when present");
  const baseOid = exactOid("SCE_CANDIDATE_BASE_OID");
  const headOid = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
    env: hermeticEnvironment(),
  }).trim();
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", baseOid, headOid],
    { cwd: repository, env: hermeticEnvironment(), stdio: "ignore" },
  );
  if (ancestor.status !== 0)
    fail(`candidate base is not an ancestor of head: ${baseOid}..${headOid}`);
  const output = execFileSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-renames",
      "--relative",
      "--name-only",
      "-z",
      `${baseOid}..${headOid}`,
      "--",
      ".",
    ],
    { cwd: repository, env: hermeticEnvironment() },
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path);
}

function exactOid(name) {
  const value = process.env[name];
  if (!value || !/^[0-9a-f]{40}$/u.test(value))
    fail(`${name} must be an exact 40-character lowercase commit OID`);
  return value;
}

function expectSuccess(name, result) {
  if (result.error) fail(`${name}: ${result.error.message}`);
  if (result.status !== 0)
    fail(
      `${name}: expected success, received ${result.stderr || result.stdout}`,
    );
  process.stdout.write(`${name}: passed as expected\n`);
}

function expectFailure(name, result, expectedFragment) {
  if (result.error) fail(`${name}: ${result.error.message}`);
  if (result.status === 0) fail(`${name}: expected failure, received success`);
  if (!result.stderr.includes(expectedFragment))
    fail(
      `${name}: expected ${JSON.stringify(expectedFragment)}, received ${result.stderr}`,
    );
  process.stdout.write(`${name}: rejected as expected\n`);
}

function hermeticEnvironment() {
  const allowed = ["PATH", "SystemRoot", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP"];
  return Object.fromEntries(
    allowed
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
