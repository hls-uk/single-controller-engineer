import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PACKAGE_NAME = "@hls-uk/single-controller-engineer";
const TAG =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SHA = /^[0-9a-f]{40}$/u;

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function packageMetadata() {
  const parsed = JSON.parse(readFileSync("package.json", "utf8"));
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    parsed.name !== PACKAGE_NAME ||
    typeof parsed.version !== "string" ||
    !TAG.test(`v${parsed.version}`)
  )
    fail("invalid package metadata");
  return { name: parsed.name, version: parsed.version };
}

export function expectedTarballName(version) {
  if (!TAG.test(`v${version}`)) fail("invalid package version");
  return `hls-uk-single-controller-engineer-${version}.tgz`;
}

export function releaseArtifactManifest(version, bytes) {
  if (!Buffer.isBuffer(bytes)) fail("artifact must be bytes");
  return {
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    name: PACKAGE_NAME,
    schema: "sce.release-artifact",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    tarball: expectedTarballName(version),
    version,
  };
}

export function validateReleaseArtifactManifest(value) {
  if (
    !exactKeys(value, [
      "integrity",
      "name",
      "schema",
      "sha256",
      "tarball",
      "version",
    ]) ||
    typeof value.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(value.integrity) ||
    value.name !== PACKAGE_NAME ||
    value.schema !== "sce.release-artifact" ||
    typeof value.version !== "string" ||
    typeof value.tarball !== "string" ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256)
  )
    return undefined;
  try {
    return value.tarball === expectedTarballName(value.version)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function verifyReleaseArtifactBytes(manifest, bytes) {
  const valid = validateReleaseArtifactManifest(manifest);
  return (
    valid !== undefined &&
    Buffer.isBuffer(bytes) &&
    createHash("sha256").update(bytes).digest("hex") === valid.sha256 &&
    `sha512-${createHash("sha512").update(bytes).digest("base64")}` ===
      valid.integrity
  );
}

export function validateRegistryReadback(manifest, value) {
  const valid = validateReleaseArtifactManifest(manifest);
  return (
    valid !== undefined &&
    exactKeys(value, [
      "access",
      "integrity",
      "name",
      "provenanceVerified",
      "schema",
      "version",
    ]) &&
    value.schema === "sce.registry-readback" &&
    value.name === PACKAGE_NAME &&
    value.version === valid.version &&
    value.integrity === valid.integrity &&
    value.access === "public" &&
    value.provenanceVerified === true
  );
}

export function versionAtLeast(actual, minimum) {
  const parse = (value) => {
    const match =
      /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\+[0-9A-Za-z.-]+)?$/u.exec(
        value,
      );
    return match === null ? undefined : match.slice(1, 4).map(Number);
  };
  const got = parse(actual);
  const wanted = parse(minimum);
  if (got === undefined || wanted === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    if (got[index] !== wanted[index]) return got[index] > wanted[index];
  }
  return true;
}

export function verifyTagVersion(tag, version) {
  return TAG.test(tag) && tag.slice(1) === version;
}

function verifySource() {
  const { version } = packageMetadata();
  const tag = process.env.GITHUB_REF_NAME;
  const sha = process.env.GITHUB_SHA;
  if (typeof tag !== "string" || !verifyTagVersion(tag, version))
    fail("tag does not match package version");
  if (typeof sha !== "string" || !SHA.test(sha)) fail("invalid release commit");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"], {
      stdio: "ignore",
    });
  } catch {
    fail("release commit is not an ancestor of origin/main");
  }
}

function prepareArtifact(directoryInput) {
  const directory = resolve(directoryInput);
  const { version } = packageMetadata();
  const tarball = expectedTarballName(version);
  const path = join(directory, tarball);
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink())
    fail("invalid release artifact");
  const manifest = releaseArtifactManifest(version, readFileSync(path));
  writeFileSync(
    join(directory, "release-artifact.json"),
    `${JSON.stringify(manifest)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [command, directory] = process.argv.slice(2);
  if (command === "verify-source" && directory === undefined) verifySource();
  else if (command === "prepare-artifact" && directory !== undefined)
    prepareArtifact(directory);
  else fail("expected verify-source or prepare-artifact <directory>");
}
