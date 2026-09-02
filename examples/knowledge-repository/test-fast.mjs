#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

const root = resolve(import.meta.dirname);
const templateRoot = resolve(
  root,
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

for (const check of checks) {
  const started = performance.now();
  const result = invoke(check, ["--root", root]);
  const elapsed = Math.round(performance.now() - started);
  if (result.status !== 0)
    fail(`${check} failed:\n${result.stderr || result.stdout}`);
  if (elapsed >= 60_000) fail(`${check} exceeded sixty seconds (${elapsed}ms)`);
  process.stdout.write(`${check}: pass (${elapsed}ms)\n`);
}

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

process.stdout.write("knowledge example fast gate: pass\n");

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

function invoke(check, args) {
  return spawnSync(process.execPath, [join(templateRoot, check), ...args], {
    cwd: root,
    encoding: "utf8",
    env: hermeticEnvironment(),
    timeout: 60_000,
  });
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
