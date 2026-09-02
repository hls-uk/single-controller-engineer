import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const checksDirectory = dirname(fileURLToPath(import.meta.url));
export const manifestSchemaPath = resolve(
  checksDirectory,
  "../knowledge-manifest.schema.json",
);

export function parseArgs(argv) {
  const options = { root: process.cwd(), changedPaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      options.root = requiredValue(argv, ++index, argument);
    } else if (argument === "--manifest") {
      options.manifest = requiredValue(argv, ++index, argument);
    } else if (argument === "--changed-path") {
      options.changedPaths.push(requiredValue(argv, ++index, argument));
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  options.root = realpathSync(resolve(options.root));
  options.manifest ??= join(options.root, "knowledge-manifest.json");
  options.manifest = resolve(options.manifest);
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateManifest(options) {
  const manifest = readJson(options.manifest);
  const schema = readJson(manifestSchemaPath);
  assertSchema(schema, manifest, "$", schema);
  assertManifestSemantics(manifest, options.root);
  return manifest;
}

export function assertSchema(schema, value, at = "$", rootSchema = schema) {
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/")) {
      throw new Error(`${at}: unsupported schema reference ${schema.$ref}`);
    }
    const target = schema.$ref
      .slice(2)
      .split("/")
      .reduce(
        (current, part) =>
          current[part.replaceAll("~1", "/").replaceAll("~0", "~")],
        rootSchema,
      );
    return assertSchema(target, value, at, rootSchema);
  }
  if (Object.hasOwn(schema, "const") && !deepEqual(value, schema.const)) {
    throw new Error(`${at}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (
    schema.enum &&
    !schema.enum.some((candidate) => deepEqual(candidate, value))
  ) {
    throw new Error(`${at}: value is not in enum`);
  }
  if (schema.type) {
    const actual = Array.isArray(value)
      ? "array"
      : value === null
        ? "null"
        : typeof value;
    if (actual !== schema.type) {
      throw new Error(`${at}: expected ${schema.type}, received ${actual}`);
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new Error(`${at}: string is shorter than ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
      throw new Error(`${at}: string does not match ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new Error(`${at}: array has fewer than ${schema.minItems} items`);
    }
    if (schema.uniqueItems) {
      const values = value.map((item) => JSON.stringify(item));
      if (new Set(values).size !== values.length) {
        throw new Error(`${at}: array items must be unique`);
      }
    }
    if (schema.items) {
      value.forEach((item, index) =>
        assertSchema(schema.items, item, `${at}[${index}]`, rootSchema),
      );
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        throw new Error(`${at}: missing required key ${key}`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) {
          throw new Error(`${at}: unknown key ${key}`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        assertSchema(childSchema, value[key], `${at}.${key}`, rootSchema);
      }
    }
  }
}

function assertManifestSemantics(manifest, root) {
  const aliases = manifest.driveAliases.map(({ alias }) => alias);
  assertUnique(aliases, "drive alias");
  for (const target of manifest.materialisationTargets) {
    if (!aliases.includes(target.destinationAlias)) {
      throw new Error(`unknown destination alias: ${target.destinationAlias}`);
    }
    assertRelativePath(target.destinationSubpath, "destination subpath");
  }
  const localPaths = [
    ...manifest.artifactHomes.agentInstructions,
    manifest.artifactHomes.knowledge,
    manifest.artifactHomes.events,
    manifest.artifactHomes.generated,
    manifest.frontmatterSchemaPath,
    ...manifest.boundaryPolicy.allowedWriteRoots,
    ...manifest.boundaryPolicy.forbiddenPaths,
  ];
  for (const path of localPaths) assertRelativePath(path, "manifest path");
  if (manifest.provenance.eventsDirectory !== manifest.artifactHomes.events) {
    throw new Error(
      "provenance eventsDirectory must equal artifactHomes.events",
    );
  }
  const frontmatterPath = containedPath(root, manifest.frontmatterSchemaPath);
  if (!existsSync(frontmatterPath)) {
    throw new Error(
      `frontmatter schema does not exist: ${manifest.frontmatterSchemaPath}`,
    );
  }
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} values must be unique`);
  }
}

export function assertRelativePath(path, label = "path") {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a canonical relative path: ${path}`);
  }
}

export function containedPath(root, path) {
  assertRelativePath(path);
  const target = resolve(root, path);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(prefix)) {
    throw new Error(`path escapes repository root: ${path}`);
  }
  return target;
}

export function walkFiles(root, startPaths, predicate = () => true) {
  const results = [];
  const seen = new Set();
  for (const relativeStart of startPaths) {
    const start = containedPath(root, relativeStart);
    if (!existsSync(start)) continue;
    walk(start, relativeStart.replace(/\/$/u, ""), results, seen, predicate);
  }
  return results.sort((left, right) =>
    left.relative.localeCompare(right.relative),
  );
}

function walk(path, relativePath, results, seen, predicate) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink())
    throw new Error(`symbolic links are not allowed: ${relativePath}`);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path).sort()) {
      walk(
        join(path, entry),
        relativePath ? `${relativePath}/${entry}` : entry,
        results,
        seen,
        predicate,
      );
    }
    return;
  }
  if (!stats.isFile() || !predicate(relativePath)) return;
  const real = realpathSync(path);
  if (seen.has(real))
    throw new Error(`duplicate filesystem entry: ${relativePath}`);
  seen.add(real);
  results.push({ path, relative: relativePath });
}

export function markdownFiles(root, manifest) {
  return walkFiles(
    root,
    [
      ...manifest.artifactHomes.agentInstructions,
      manifest.artifactHomes.knowledge,
      manifest.artifactHomes.generated,
    ],
    (path) => path.endsWith(".md"),
  );
}

export function knowledgePages(root, manifest) {
  return walkFiles(root, [manifest.artifactHomes.knowledge], (path) =>
    path.endsWith(".md"),
  );
}

export function parseFrontmatter(path) {
  const source = readFileSync(path, "utf8");
  const lines = source.split("\n");
  if (lines[0] !== "---")
    throw new Error(`${path}: missing frontmatter opener`);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error(`${path}: missing frontmatter closer`);
  const data = {};
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (!line || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/u.exec(line);
    if (!match)
      throw new Error(`${path}:${index + 1}: unsupported frontmatter syntax`);
    if (Object.hasOwn(data, match[1]))
      throw new Error(`${path}: duplicate frontmatter key ${match[1]}`);
    data[match[1]] = parseScalar(match[2] ?? "");
  }
  return { data, body: lines.slice(end + 1).join("\n") };
}

function parseScalar(source) {
  if (source === "") return "";
  if (source === "true") return true;
  if (source === "false") return false;
  if (source === "null") return null;
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(source)) return Number(source);
  if (
    source.startsWith('"') ||
    source.startsWith("[") ||
    source.startsWith("{")
  ) {
    return JSON.parse(source);
  }
  return source;
}

export function runCheck(name, check) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifest = validateManifest(options);
    check({ manifest, options });
    process.stdout.write(`${name}: ok\n`);
  } catch (error) {
    process.stderr.write(
      `${name}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export function checkMarkdownFormat({ manifest, options }) {
  for (const file of markdownFiles(options.root, manifest)) {
    const source = readFileSync(file.path, "utf8");
    if (source.includes("\r"))
      throw new Error(`${file.relative}: must use LF newlines`);
    if (!source.endsWith("\n") || source.endsWith("\n\n")) {
      throw new Error(`${file.relative}: must have exactly one final newline`);
    }
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (/[ \t]+$/u.test(line))
        throw new Error(`${file.relative}:${index + 1}: trailing whitespace`);
      if (line.includes("\t"))
        throw new Error(`${file.relative}:${index + 1}: tab character`);
    });
  }
}

export function checkFrontmatter({ manifest, options }) {
  const schemaPath = containedPath(
    options.root,
    manifest.frontmatterSchemaPath,
  );
  const schema = readJson(schemaPath);
  for (const file of knowledgePages(options.root, manifest)) {
    const { data } = parseFrontmatter(file.path);
    assertSchema(schema, data, file.relative, schema);
  }
}

export function checkRelativeLinks({ manifest, options }) {
  const files = markdownFiles(options.root, manifest);
  const headingsByPath = new Map(
    files.map((file) => [
      file.path,
      markdownHeadings(readFileSync(file.path, "utf8")),
    ]),
  );
  for (const file of files) {
    const source = readFileSync(file.path, "utf8");
    const expression = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
    for (const match of source.matchAll(expression)) {
      const rawTarget = match[1];
      if (/^(?:[a-z]+:|\/)/iu.test(rawTarget)) continue;
      const [encodedPath, encodedAnchor] = rawTarget.split("#", 2);
      const linkPath = decodeURIComponent(encodedPath || basename(file.path));
      const target = resolve(dirname(file.path), linkPath);
      const prefix = `${options.root}${sep}`;
      if (target !== options.root && !target.startsWith(prefix)) {
        throw new Error(
          `${file.relative}: link escapes repository: ${rawTarget}`,
        );
      }
      const candidates = [target, join(target, "README.md")];
      const existing = candidates.find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
      );
      if (!existing)
        throw new Error(`${file.relative}: unresolved link ${rawTarget}`);
      if (encodedAnchor) {
        const headings =
          headingsByPath.get(existing) ??
          markdownHeadings(readFileSync(existing, "utf8"));
        if (!headings.has(decodeURIComponent(encodedAnchor).toLowerCase())) {
          throw new Error(`${file.relative}: unresolved anchor ${rawTarget}`);
        }
      }
    }
  }
}

function markdownHeadings(source) {
  const headings = new Set();
  for (const line of source.split("\n")) {
    const match = /^#{1,6} +(.+?) *#*$/u.exec(line);
    if (!match) continue;
    const slug = match[1]
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number} _-]/gu, "")
      .replace(/[ _]+/gu, "-")
      .replace(/-+/gu, "-");
    headings.add(slug);
  }
  return headings;
}

export function checkBoundary({ manifest, options }) {
  const policy = manifest.boundaryPolicy;
  for (const path of options.changedPaths) {
    assertRelativePath(path, "changed path");
    if (matchesAny(path, policy.forbiddenPaths)) {
      throw new Error(`changed path is forbidden: ${path}`);
    }
    if (!matchesAny(path, policy.allowedWriteRoots)) {
      throw new Error(`changed path is outside allowed write roots: ${path}`);
    }
  }
  const markerFiles = walkFiles(
    options.root,
    [...policy.allowedWriteRoots],
    (path) => !path.startsWith(".git/") && !path.startsWith(".beads/"),
  );
  for (const file of markerFiles) {
    const source = readFileSync(file.path, "utf8");
    for (const marker of policy.forbiddenMarkers) {
      if (source.includes(marker))
        throw new Error(`${file.relative}: forbidden marker ${marker}`);
    }
  }
}

function matchesAny(path, roots) {
  return roots.some((root) => {
    const normalized = root.replace(/\/$/u, "");
    return path === normalized || path.startsWith(`${normalized}/`);
  });
}

export function checkSecrets({ manifest, options }) {
  const files = walkFiles(
    options.root,
    [
      ...manifest.artifactHomes.agentInstructions,
      manifest.artifactHomes.knowledge,
      manifest.artifactHomes.events,
      manifest.artifactHomes.generated,
    ],
    (path) =>
      !path.endsWith(".png") &&
      !path.endsWith(".jpg") &&
      !path.endsWith(".pdf"),
  );
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\bAKIA[0-9A-Z]{16}\b/u,
    /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/u,
    /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{16,}/iu,
  ];
  for (const file of files) {
    const source = readFileSync(file.path, "utf8");
    if (patterns.some((pattern) => pattern.test(source))) {
      throw new Error(`${file.relative}: possible credential material`);
    }
  }
}

export function checkGenerated({ manifest, options }) {
  const command = manifest.provenance.rollupGeneratorCommand;
  const temporary = mkdtempSync(join(tmpdir(), "sce-knowledge-generated-"));
  const output = join(temporary, "output");
  try {
    const result = spawnSync(
      command[0],
      [...command.slice(1), "--output", output],
      {
        cwd: options.root,
        encoding: "utf8",
        env: hermeticEnvironment(),
        timeout: 55_000,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `generator failed (${result.status}): ${(result.stderr || result.stdout).trim()}`,
      );
    }
    const committed = treeDigest(
      containedPath(options.root, manifest.artifactHomes.generated),
    );
    const rebuilt = treeDigest(output);
    if (committed !== rebuilt) {
      throw new Error(
        `generated output drift: committed ${committed}, rebuilt ${rebuilt}`,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function hermeticEnvironment() {
  const allowed = ["PATH", "SystemRoot", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP"];
  return Object.fromEntries(
    allowed
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
}

function treeDigest(root) {
  if (!existsSync(root)) return "missing";
  const hash = createHash("sha256");
  for (const file of walkFiles(dirname(root), [basename(root)])) {
    hash.update(`${relative(root, file.path).split(sep).join("/")}\0`);
    hash.update(readFileSync(file.path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function checkProvenance({ manifest, options }) {
  const files = walkFiles(
    options.root,
    [manifest.artifactHomes.events],
    (path) => path.endsWith(".json"),
  );
  const ids = new Set();
  const records = [];
  for (const file of files) {
    const record = readJson(file.path);
    assertProvenanceRecord(record, file.relative);
    if (ids.has(record.id))
      throw new Error(`${file.relative}: duplicate provenance id ${record.id}`);
    ids.add(record.id);
    records.push({ record, path: file.relative });
    assertAncestor(options.root, record.landedOid, file.relative);
  }
  for (const { record, path } of records) {
    for (const target of [...record.supersedes, ...record.tombstones]) {
      if (!ids.has(target))
        throw new Error(`${path}: missing provenance target ${target}`);
      if (target === record.id)
        throw new Error(`${path}: record cannot target itself`);
    }
  }
}

function assertProvenanceRecord(record, path) {
  const keys = [
    "schema",
    "version",
    "id",
    "unitId",
    "landedOid",
    "acceptanceIds",
    "ownedPaths",
    "supersedes",
    "tombstones",
  ];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${path}: provenance record must be an object`);
  }
  const actual = Object.keys(record).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${path}: provenance record keys are not exact`);
  }
  if (record.schema !== "sce.knowledge-provenance" || record.version !== 1) {
    throw new Error(`${path}: unsupported provenance envelope`);
  }
  for (const key of ["id", "unitId"]) {
    if (typeof record[key] !== "string" || record[key].length === 0) {
      throw new Error(`${path}: ${key} must be a non-empty string`);
    }
  }
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(record.landedOid)) {
    throw new Error(`${path}: landedOid must be a full Git object id`);
  }
  for (const key of [
    "acceptanceIds",
    "ownedPaths",
    "supersedes",
    "tombstones",
  ]) {
    if (
      !Array.isArray(record[key]) ||
      record[key].some((value) => typeof value !== "string" || !value)
    ) {
      throw new Error(`${path}: ${key} must contain non-empty strings`);
    }
    assertUnique(record[key], `${path} ${key}`);
  }
}

function assertAncestor(root, oid, path) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", oid, "HEAD"], {
      cwd: root,
      env: hermeticEnvironment(),
      stdio: "ignore",
      timeout: 10_000,
    });
  } catch {
    throw new Error(`${path}: landedOid is not an ancestor of HEAD`);
  }
}

export function checkSupersession({ manifest, options }) {
  const pages = knowledgePages(options.root, manifest).map((file) => ({
    ...file,
    frontmatter: parseFrontmatter(file.path).data,
  }));
  const byId = new Map();
  for (const page of pages) {
    if (byId.has(page.frontmatter.id))
      throw new Error(`duplicate page id: ${page.frontmatter.id}`);
    byId.set(page.frontmatter.id, page);
  }
  for (const page of pages) {
    const metadata = page.frontmatter;
    if (metadata.status === "superseded") {
      const successor = byId.get(metadata.successor);
      if (!successor)
        throw new Error(
          `${page.relative}: missing successor ${metadata.successor}`,
        );
      if (!successor.frontmatter.supersedes.includes(metadata.id)) {
        throw new Error(
          `${page.relative}: successor does not link back to ${metadata.id}`,
        );
      }
    } else if (metadata.successor !== null) {
      throw new Error(
        `${page.relative}: current page must have a null successor`,
      );
    }
    for (const oldId of metadata.supersedes) {
      const oldPage = byId.get(oldId);
      if (!oldPage)
        throw new Error(`${page.relative}: missing superseded page ${oldId}`);
      if (
        oldPage.frontmatter.status !== "superseded" ||
        oldPage.frontmatter.successor !== metadata.id
      ) {
        throw new Error(
          `${page.relative}: supersession link is not reciprocal for ${oldId}`,
        );
      }
    }
  }
}
