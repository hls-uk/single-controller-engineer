#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cpSync,
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
  );

  expectFailure(
    "seeded boundary violation",
    invoke("check-boundary.mjs", [
      "--root",
      root,
      "--changed-path",
      "private/seeded-violation.md",
    ]),
  );

  const driftRoot = join(temporary, "drift-repository");
  cpSync(root, driftRoot, { recursive: true });
  writeFileSync(
    join(driftRoot, "generated/timeline.md"),
    "# Knowledge timeline\n\nSeeded drift.\n",
    "utf8",
  );
  expectFailure(
    "seeded reproducibility drift",
    invoke("check-generated.mjs", ["--root", driftRoot]),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("knowledge example fast gate: pass\n");

function invoke(check, args) {
  return spawnSync(process.execPath, [join(templateRoot, check), ...args], {
    cwd: root,
    encoding: "utf8",
    env: hermeticEnvironment(),
    timeout: 60_000,
  });
}

function expectFailure(name, result) {
  if (result.error) fail(`${name}: ${result.error.message}`);
  if (result.status === 0) fail(`${name}: expected failure, received success`);
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
