/** Crash-recoverable, manifest-owned installer for the packaged skill pair. */
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export const INSTALL_MANIFEST = ".sce-skill-install.json";
export const INSTALL_JOURNAL = ".sce-skill-install.transaction.json";
export const INSTALL_LOCK = ".sce-skill-install.lock";
const INSTALL_LOCK_REAPER = ".sce-skill-install.lock-reaper";
export const SKILL_NAMES = [
  "single-controller-engineer",
  "single-controller-feedback",
] as const;

const PACKAGE_NAME = "@hls-uk/single-controller-engineer";
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const HASH = /^[a-f0-9]{64}$/u;
const JOURNAL_PREFIX = ".sce-install-";

export type SkillName = (typeof SKILL_NAMES)[number];
export type InstalledFile = Readonly<{ path: string; sha256: string }>;
export type SkillInstallManifest = Readonly<{
  files: readonly InstalledFile[];
  package: typeof PACKAGE_NAME;
  schema: "sce.skill-install";
  skills: Readonly<Record<SkillName, string>>;
  version: 1;
}>;
export type InstallFaultPhase =
  | "after-backup"
  | "after-new"
  | "after-post-swap-validation"
  | "before-backup"
  | "before-new";
export type InstallOptions = Readonly<{
  destination: string;
  dryRun?: boolean;
  /** Test seam; production callers must not supply it. */
  fault?: (phase: InstallFaultPhase) => void | Promise<void>;
  source: string;
  stagingDirectory?: string;
}>;
export type InstallResult = Readonly<{
  manifest: SkillInstallManifest;
  status: "dry-run" | "installed";
}>;
export type UninstallOptions = Readonly<{
  /** Test seam; production callers must not supply it. */
  fault?: InstallOptions["fault"];
}>;

type Journal = Readonly<{
  backup: string;
  manifest: SkillInstallManifest;
  operation: "install" | "uninstall";
  phase: "backing-up" | "committed" | "staged" | "swapping";
  previous: SkillInstallManifest | null;
  schema: "sce.skill-install.transaction";
  stage: string;
  version: 1;
}>;

export class SkillInstallError extends Error {
  override name = "SkillInstallError";
}

/** Test-only fault type that leaves a durable transaction for the next run. */
export class SimulatedProcessLoss extends Error {
  override name = "SimulatedProcessLoss";
}

function fail(message: string): never {
  throw new SkillInstallError(message);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function skillPath(path: string): boolean {
  const segments = path.split("/");
  return (
    segments.length >= 2 &&
    (segments[0] === SKILL_NAMES[0] || segments[0] === SKILL_NAMES[1]) &&
    segments.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function canonicalRelative(path: string): string {
  if (path.startsWith("/") || path.includes("\\") || !skillPath(path))
    fail(`unsafe manifest path: ${path}`);
  return path;
}

function parseManifest(value: unknown): SkillInstallManifest {
  const root = asRecord(value);
  if (
    root === undefined ||
    !hasExactKeys(root, ["files", "package", "schema", "skills", "version"]) ||
    root.schema !== "sce.skill-install" ||
    root.version !== 1 ||
    root.package !== PACKAGE_NAME ||
    !Array.isArray(root.files)
  )
    fail("invalid skill-install manifest");
  const skills = asRecord(root.skills);
  if (skills === undefined || !hasExactKeys(skills, SKILL_NAMES))
    fail("invalid skill-install manifest skill versions");
  const parsedSkills = {} as Record<SkillName, string>;
  for (const name of SKILL_NAMES) {
    const version = skills[name];
    if (typeof version !== "string" || !SEMVER.test(version))
      fail("invalid skill-install manifest skill version");
    parsedSkills[name] = version;
  }
  if (parsedSkills[SKILL_NAMES[0]] !== parsedSkills[SKILL_NAMES[1]])
    fail("paired skills must declare the same version");
  const files: InstalledFile[] = [];
  const seen = new Set<string>();
  for (const candidate of root.files) {
    const file = asRecord(candidate);
    if (
      file === undefined ||
      !hasExactKeys(file, ["path", "sha256"]) ||
      typeof file.path !== "string" ||
      typeof file.sha256 !== "string" ||
      !HASH.test(file.sha256)
    )
      fail("invalid skill-install manifest file");
    const path = canonicalRelative(file.path);
    if (seen.has(path)) fail("duplicate skill-install manifest path");
    seen.add(path);
    files.push({ path, sha256: file.sha256 });
  }
  if (
    files.length === 0 ||
    SKILL_NAMES.some((name) => !seen.has(`${name}/SKILL.md`))
  )
    fail("skill-install manifest lacks a complete pair");
  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    package: PACKAGE_NAME,
    schema: "sce.skill-install",
    skills: parsedSkills,
    version: 1,
  };
}

function parseJournal(value: unknown): Journal {
  const journal = asRecord(value);
  if (
    journal === undefined ||
    !hasExactKeys(journal, [
      "backup",
      "manifest",
      "operation",
      "phase",
      "previous",
      "schema",
      "stage",
      "version",
    ]) ||
    journal.schema !== "sce.skill-install.transaction" ||
    journal.version !== 1 ||
    (journal.operation !== "install" && journal.operation !== "uninstall") ||
    (journal.phase !== "staged" &&
      journal.phase !== "backing-up" &&
      journal.phase !== "swapping" &&
      journal.phase !== "committed") ||
    typeof journal.stage !== "string" ||
    typeof journal.backup !== "string" ||
    !journal.stage.startsWith(JOURNAL_PREFIX) ||
    !journal.stage.endsWith(".stage") ||
    !journal.backup.startsWith(JOURNAL_PREFIX) ||
    !journal.backup.endsWith(".backup")
  )
    fail("invalid skill-install transaction journal");
  return {
    backup: journal.backup,
    manifest: parseManifest(journal.manifest),
    operation: journal.operation,
    phase: journal.phase,
    previous:
      journal.previous === null ? null : parseManifest(journal.previous),
    schema: "sce.skill-install.transaction",
    stage: journal.stage,
    version: 1,
  };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function fsync(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncTree(root: string): Promise<void> {
  const entry = await lstat(root);
  if (entry.isSymbolicLink())
    fail(`symbolic links are not installable: ${root}`);
  if (entry.isFile()) return await fsync(root);
  if (!entry.isDirectory()) fail(`unsupported install entry: ${root}`);
  for (const child of await readdir(root)) await fsyncTree(join(root, child));
  await fsync(root);
}

async function assertSafeExistingAncestors(path: string): Promise<void> {
  let current = resolve(path);
  while (true) {
    const entry = await lstat(current).catch(() => undefined);
    // macOS exposes its writable temp root through /var -> /private/var.
    // Permit only that platform-owned alias; every caller-provided parent is
    // still checked with lstat and rejected when it is a symlink.
    if (entry?.isSymbolicLink() && current !== "/var" && current !== "/tmp")
      fail(`refusing symlinked install parent: ${current}`);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function assertDirectory(path: string, create = false): Promise<void> {
  await assertSafeExistingAncestors(path);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const entry = await lstat(path).catch(() => undefined);
  if (!entry?.isDirectory() || entry.isSymbolicLink())
    fail(`refusing non-directory install path: ${path}`);
}

async function filesAt(root: string, prefix = ""): Promise<InstalledFile[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const result: InstalledFile[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(root, entry.name);
    if (entry.isSymbolicLink())
      fail(`symbolic links are not installable: ${relativePath}`);
    if (entry.isDirectory())
      result.push(...(await filesAt(fullPath, relativePath)));
    else if (entry.isFile())
      result.push({
        path: canonicalRelative(relativePath),
        sha256: await sha256(fullPath),
      });
    else fail(`unsupported install entry: ${relativePath}`);
  }
  return result;
}

async function skillVersion(path: string): Promise<string> {
  const text = await readFile(join(path, "SKILL.md"), "utf8").catch(() =>
    fail(`missing SKILL.md in ${basename(path)}`),
  );
  const match = /^<!--\s*sce-skill-version:\s*([^\s#]+)\s*-->\s*$/mu.exec(text);
  if (!match?.[1] || !SEMVER.test(match[1]))
    fail(`invalid skill version in ${basename(path)}`);
  return match[1];
}

export async function createSkillInstallManifest(
  source: string,
): Promise<SkillInstallManifest> {
  const resolved = resolve(source);
  await assertDirectory(resolved);
  const skills = {} as Record<SkillName, string>;
  const files: InstalledFile[] = [];
  for (const name of SKILL_NAMES) {
    const skillRoot = join(resolved, name);
    const entry = await lstat(skillRoot).catch(() => undefined);
    if (!entry?.isDirectory() || entry.isSymbolicLink())
      fail(`missing regular skill directory: ${name}`);
    skills[name] = await skillVersion(skillRoot);
    files.push(...(await filesAt(skillRoot, name)));
  }
  return parseManifest({
    files,
    package: PACKAGE_NAME,
    schema: "sce.skill-install",
    skills,
    version: 1,
  });
}

function stable(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeDurable(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, stable(value), { mode: 0o600 });
  await fsync(temporary);
  await rename(temporary, path);
  await fsync(dirname(path));
}

async function readManifest(
  destination: string,
): Promise<SkillInstallManifest | undefined> {
  const path = join(destination, INSTALL_MANIFEST);
  const entry = await lstat(path).catch(() => undefined);
  if (entry === undefined) return undefined;
  if (!entry.isFile() || entry.isSymbolicLink())
    fail("invalid existing skill-install manifest");
  try {
    return parseManifest(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof SkillInstallError) throw error;
    fail("invalid existing skill-install manifest");
  }
}

async function readJournal(destination: string): Promise<Journal | undefined> {
  const path = join(destination, INSTALL_JOURNAL);
  const entry = await lstat(path).catch(() => undefined);
  if (entry === undefined) return undefined;
  if (!entry.isFile() || entry.isSymbolicLink())
    fail("invalid skill-install transaction journal");
  try {
    return parseJournal(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof SkillInstallError) throw error;
    fail("invalid skill-install transaction journal");
  }
}

function localTransactionPath(parent: string, name: string): string {
  if (basename(name) !== name || !name.startsWith(JOURNAL_PREFIX))
    fail("unsafe skill-install transaction path");
  return join(parent, name);
}

async function validateTree(
  root: string,
  manifest: SkillInstallManifest,
): Promise<void> {
  for (const name of SKILL_NAMES) {
    const directory = join(root, name);
    const entry = await lstat(directory).catch(() => undefined);
    if (!entry?.isDirectory() || entry.isSymbolicLink())
      fail(`installed skill missing: ${name}`);
    if ((await skillVersion(directory)) !== manifest.skills[name])
      fail(`installed skill version differs: ${name}`);
  }
  const actual = (
    await Promise.all(
      SKILL_NAMES.map((name) => filesAt(join(root, name), name)),
    )
  )
    .flat()
    .sort((left, right) => left.path.localeCompare(right.path));
  const expected = manifest.files;
  if (actual.length !== expected.length)
    fail("installed tree differs from manifest");
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const found = actual[index];
    if (
      wanted === undefined ||
      found === undefined ||
      wanted.path !== found.path ||
      wanted.sha256 !== found.sha256
    )
      fail("installed tree differs from manifest");
  }
}

async function validateInstalled(
  destination: string,
  manifest: SkillInstallManifest,
): Promise<void> {
  const recorded = await readManifest(destination);
  if (recorded === undefined || stable(recorded) !== stable(manifest))
    fail("installed manifest differs from expected manifest");
  await validateTree(destination, manifest);
}

async function assertOwnedOrAbsent(
  destination: string,
  manifest: SkillInstallManifest | undefined,
): Promise<void> {
  const entries = await Promise.all(
    SKILL_NAMES.map(
      async (name) =>
        [
          name,
          await lstat(join(destination, name)).catch(() => undefined),
        ] as const,
    ),
  );
  const anySkill = entries.some(([, entry]) => entry !== undefined);
  if (manifest === undefined) {
    if (
      anySkill ||
      (await lstat(join(destination, INSTALL_MANIFEST)).catch(() => undefined))
    )
      fail("refusing unrelated skill collision");
    return;
  }
  await validateInstalled(destination, manifest);
}

async function move(
  from: string,
  to: string,
  phase: "backup" | "new",
  fault?: InstallOptions["fault"],
): Promise<void> {
  await fault?.(`before-${phase}` as InstallFaultPhase);
  await rename(from, to);
  await fsync(dirname(from));
  if (dirname(to) !== dirname(from)) await fsync(dirname(to));
  await fault?.(`after-${phase}` as InstallFaultPhase);
}

async function movePresent(
  from: string,
  to: string,
  phase: "backup" | "new",
  fault?: InstallOptions["fault"],
): Promise<boolean> {
  if (!(await lstat(from).catch(() => undefined))) return false;
  await move(from, to, phase, fault);
  return true;
}

async function removeJournal(destination: string): Promise<void> {
  await unlink(join(destination, INSTALL_JOURNAL));
  await fsync(destination);
}

async function cleanCommitted(
  destination: string,
  parent: string,
  journal: Journal,
): Promise<void> {
  const stage = localTransactionPath(parent, journal.stage);
  const backup = localTransactionPath(parent, journal.backup);
  if (journal.operation === "install")
    await validateInstalled(destination, journal.manifest);
  else {
    if (await readManifest(destination))
      fail("uninstall transaction did not remove manifest");
    for (const name of SKILL_NAMES) {
      if (await lstat(join(destination, name)).catch(() => undefined))
        fail("uninstall transaction did not remove skill pair");
    }
  }
  await rm(stage, { force: true, recursive: true });
  await rm(backup, { force: true, recursive: true });
  await fsync(parent);
  await removeJournal(destination);
}

async function preserveForRecovery(
  parent: string,
  source: string,
): Promise<void> {
  const entry = await lstat(source).catch(() => undefined);
  if (!entry) return;
  const preserved = join(
    parent,
    `.sce-recovery-${randomUUID()}-${basename(source)}`,
  );
  await rename(source, preserved);
  await fsync(parent);
}

async function restoreBackup(
  destination: string,
  parent: string,
  journal: Journal,
): Promise<void> {
  const backup = localTransactionPath(parent, journal.backup);
  try {
    // A crash while moving the old pair can leave some old entries in place
    // and some in backup. Reassemble that exact old pair before quarantining
    // anything; this avoids treating still-owned bytes as disposable.
    if (journal.previous !== null) {
      for (const name of [...SKILL_NAMES, INSTALL_MANIFEST]) {
        const target = join(destination, name);
        const source = join(backup, name);
        if (
          !(await lstat(target).catch(() => undefined)) &&
          (await lstat(source).catch(() => undefined))
        )
          await rename(source, target);
      }
      try {
        await validatePrior(destination, journal);
        await writeDurable(join(destination, INSTALL_JOURNAL), {
          ...journal,
          phase: "committed",
        });
        return;
      } catch {
        // The destination now contains a mixed/new tree; preserve it below.
      }
    }
    for (const name of [...SKILL_NAMES, INSTALL_MANIFEST])
      await preserveForRecovery(parent, join(destination, name));
    for (const name of [...SKILL_NAMES, INSTALL_MANIFEST]) {
      const source = join(backup, name);
      if (await lstat(source).catch(() => undefined))
        await rename(source, join(destination, name));
    }
    await fsync(destination);
    if (journal.previous === null) {
      for (const name of [...SKILL_NAMES, INSTALL_MANIFEST]) {
        if (await lstat(join(destination, name)).catch(() => undefined))
          fail(
            "recovery-needed: prior empty installation could not be restored",
          );
      }
    } else await validateInstalled(destination, journal.previous);
    await writeDurable(join(destination, INSTALL_JOURNAL), {
      ...journal,
      phase: "committed",
    });
  } catch {
    fail("recovery-needed: rollback failed; backup was preserved");
  }
}

async function validatePrior(
  destination: string,
  journal: Journal,
): Promise<void> {
  if (journal.previous === null) {
    for (const name of [...SKILL_NAMES, INSTALL_MANIFEST]) {
      if (await lstat(join(destination, name)).catch(() => undefined))
        fail("recovery-needed: prior empty installation could not be restored");
    }
  } else await validateInstalled(destination, journal.previous);
}

async function cleanRollback(
  destination: string,
  parent: string,
  journal: Journal,
): Promise<void> {
  await validatePrior(destination, journal);
  await rm(localTransactionPath(parent, journal.stage), {
    force: true,
    recursive: true,
  });
  await rm(localTransactionPath(parent, journal.backup), {
    force: true,
    recursive: true,
  });
  await fsync(parent);
  await removeJournal(destination);
}

async function recover(destination: string, parent: string): Promise<void> {
  const journal = await readJournal(destination);
  if (!journal) return;
  if (journal.operation === "install") {
    try {
      await validateInstalled(destination, journal.manifest);
      await writeDurable(join(destination, INSTALL_JOURNAL), {
        ...journal,
        phase: "committed",
      });
      await cleanCommitted(destination, parent, {
        ...journal,
        phase: "committed",
      });
      return;
    } catch (error) {
      if (journal.phase === "staged") {
        await cleanRollback(destination, parent, journal);
        return;
      }
      await restoreBackup(destination, parent, journal);
      await cleanRollback(destination, parent, journal);
      return;
    }
  }
  if (journal.phase === "committed") {
    await cleanCommitted(destination, parent, journal);
    return;
  }
  await restoreBackup(destination, parent, journal);
  await cleanRollback(destination, parent, journal);
}

async function acquireLock(destination: string): Promise<() => Promise<void>> {
  const path = join(destination, INSTALL_LOCK);
  const reaper = join(destination, INSTALL_LOCK_REAPER);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      await mkdir(reaper, { mode: 0o700 });
    } catch (guard: unknown) {
      if ((guard as NodeJS.ErrnoException).code === "EEXIST")
        fail("another skill installation is active");
      throw guard;
    }
    try {
      // Re-read only after winning the reap guard. This prevents two stale
      // observers from unlinking each other's replacement lock.
      const text = await readFile(path, "utf8").catch(() => "");
      const pid = /^pid=(\d+)(?:\ntoken=[0-9a-f-]+)?\n?$/u.exec(text)?.[1];
      if (!pid) fail("another skill installation is active");
      try {
        process.kill(Number(pid), 0);
        fail("another skill installation is active");
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH")
          fail("another skill installation is active");
      }
      await unlink(path);
      handle = await open(path, "wx", 0o600);
    } finally {
      await rm(reaper, { recursive: true }).catch(() => undefined);
      await fsync(destination);
    }
  }
  // A stale-lock reaper may have removed the previous lock immediately before
  // this process created its own. It holds the guard until its replacement is
  // installed, so a normal acquirer that observes the guard must stand down.
  if (await lstat(reaper).catch(() => undefined)) {
    await handle.close();
    await unlink(path).catch(() => undefined);
    fail("another skill installation is active");
  }
  const token = randomUUID();
  await handle.writeFile(`pid=${process.pid}\ntoken=${token}\n`, "utf8");
  await handle.sync();
  const acquired = await handle.stat();
  await handle.close();
  await fsync(destination);
  return async () => {
    const current = await lstat(path).catch(() => undefined);
    const text = await readFile(path, "utf8").catch(() => undefined);
    if (
      current?.dev === acquired.dev &&
      current.ino === acquired.ino &&
      text === `pid=${process.pid}\ntoken=${token}\n`
    )
      await unlink(path);
    await fsync(destination);
  };
}

async function withLock<T>(
  destination: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireLock(destination);
  try {
    return await operation();
  } finally {
    await release();
  }
}

/** Install or upgrade both skills as one durable, recoverable set. */
export async function installSkills(
  options: InstallOptions,
): Promise<InstallResult> {
  const source = resolve(options.source);
  const destination = resolve(options.destination);
  const manifest = await createSkillInstallManifest(source);
  if (options.dryRun) {
    const entry = await lstat(destination).catch(() => undefined);
    if (entry !== undefined) {
      await assertDirectory(destination);
      await assertOwnedOrAbsent(destination, await readManifest(destination));
    }
    return { manifest, status: "dry-run" };
  }
  await assertDirectory(destination, true);
  if (
    options.stagingDirectory !== undefined &&
    resolve(options.stagingDirectory) !== destination
  )
    fail("staging must be destination-local for deterministic recovery");
  // Stage beside the installed pair. A later retry needs no remembered caller
  // option to find its journal, backup, or staged bytes, and rename is always
  // same-filesystem by construction.
  const parent = destination;
  return await withLock(destination, async () => {
    await recover(destination, parent);
    const previous = await readManifest(destination);
    await assertOwnedOrAbsent(destination, previous);
    const transaction = `${JOURNAL_PREFIX}${randomUUID()}`;
    const stage = `${transaction}.stage`;
    const backup = `${transaction}.backup`;
    const stagePath = localTransactionPath(parent, stage);
    const backupPath = localTransactionPath(parent, backup);
    await mkdir(stagePath, { mode: 0o700 });
    for (const name of SKILL_NAMES)
      await cp(join(source, name), join(stagePath, name), {
        recursive: true,
        verbatimSymlinks: true,
      });
    await writeDurable(join(stagePath, INSTALL_MANIFEST), manifest);
    await fsyncTree(stagePath);
    await mkdir(backupPath, { mode: 0o700 });
    let journal: Journal = {
      backup,
      manifest,
      operation: "install",
      phase: "staged",
      previous: previous ?? null,
      schema: "sce.skill-install.transaction",
      stage,
      version: 1,
    };
    await writeDurable(join(destination, INSTALL_JOURNAL), journal);
    try {
      journal = { ...journal, phase: "backing-up" };
      await writeDurable(join(destination, INSTALL_JOURNAL), journal);
      for (const name of [...SKILL_NAMES, INSTALL_MANIFEST])
        await movePresent(
          join(destination, name),
          join(backupPath, name),
          "backup",
          options.fault,
        );
      journal = { ...journal, phase: "swapping" };
      await writeDurable(join(destination, INSTALL_JOURNAL), journal);
      for (const name of [...SKILL_NAMES, INSTALL_MANIFEST])
        await move(
          join(stagePath, name),
          join(destination, name),
          "new",
          options.fault,
        );
      await validateInstalled(destination, manifest);
      await options.fault?.("after-post-swap-validation");
      journal = { ...journal, phase: "committed" };
      await writeDurable(join(destination, INSTALL_JOURNAL), journal);
      await cleanCommitted(destination, parent, journal);
      return { manifest, status: "installed" };
    } catch (error) {
      if (error instanceof SimulatedProcessLoss) throw error;
      try {
        if (journal.phase === "staged")
          await cleanRollback(destination, parent, journal);
        else {
          await restoreBackup(destination, parent, journal);
          await cleanRollback(destination, parent, journal);
        }
      } catch (rollback) {
        throw rollback;
      }
      throw error;
    }
  });
}

/** Uninstall only a complete, exact manifest-owned pair. */
export async function uninstallSkills(
  destinationInput: string,
  options: UninstallOptions = {},
): Promise<void> {
  const destination = resolve(destinationInput);
  await assertDirectory(destination);
  await withLock(destination, async () => {
    await recover(destination, destination);
    const manifest = await readManifest(destination);
    if (!manifest) fail("no recorded skill installation to remove");
    await validateInstalled(destination, manifest);
    const transaction = `${JOURNAL_PREFIX}${randomUUID()}`;
    const backup = `${transaction}.backup`;
    const backupPath = localTransactionPath(destination, backup);
    await mkdir(backupPath, { mode: 0o700 });
    const journal: Journal = {
      backup,
      manifest,
      operation: "uninstall",
      phase: "backing-up",
      previous: manifest,
      schema: "sce.skill-install.transaction",
      stage: `${transaction}.stage`,
      version: 1,
    };
    await writeDurable(join(destination, INSTALL_JOURNAL), journal);
    try {
      for (const name of [...SKILL_NAMES, INSTALL_MANIFEST])
        await move(
          join(destination, name),
          join(backupPath, name),
          "backup",
          options.fault,
        );
      await fsync(destination);
      const committed = {
        ...journal,
        phase: "committed",
      } as const;
      await writeDurable(join(destination, INSTALL_JOURNAL), committed);
      await cleanCommitted(destination, destination, committed);
    } catch (error) {
      if (error instanceof SimulatedProcessLoss) throw error;
      try {
        await recover(destination, destination);
      } catch (rollback) {
        throw rollback;
      }
      throw error;
    }
  });
}
