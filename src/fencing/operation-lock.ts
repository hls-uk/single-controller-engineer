import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createConnection, createServer, type Server } from "node:net";

import { canonicalJson, type JsonValue } from "../protocol/canonical.js";
import { validate } from "../protocol/schemas.js";
import { deriveScopeCommitment } from "./projections.js";
import {
  FENCING_SCHEMA_VERSION,
  type FencingScope,
  type OperationLockState,
  OperationLockStateSchema,
} from "./schemas.js";

// macOS has a short Unix-domain socket pathname limit. Keep the on-disk
// protocol directory below commonDir, but make the socket tuple compact.
const LOCK_DIRECTORY = ".sce-op";
const SOCKET_NAME = "l";
const STATE_NAME = "s";
const STATE_MAX_BYTES = 4_096;
const MAX_ACQUIRE_ATTEMPTS = 4;
const utf8 = new TextEncoder();

export type OperationLockAcquire =
  | { readonly status: "acquired"; readonly lock: OperationLock }
  | { readonly status: "held" | "quarantined" | "unavailable" };

export type OperationLockRelease =
  | { readonly status: "released" }
  | { readonly status: "holder_mismatch" | "quarantined" | "unavailable" };

export interface OperationLockInput {
  readonly commonDir: string;
  readonly holder: string;
  /** Deterministic caller-observed nonce; the lock never generates one. */
  readonly nonce: string;
  readonly scope: FencingScope;
}

type PathIdentity = Readonly<{
  dev: number;
  ino: number;
  mode: number;
  uid: number;
}>;
type SocketCapture = Readonly<{ identity: PathIdentity }>;
type StateCapture = Readonly<{
  identity: PathIdentity;
  source: string;
  state: OperationLockState;
}>;
type Capture<T> =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "valid"; value: T }>;
type LockPaths = Readonly<{
  directory: string;
  socket: string;
  state: string;
}>;

function ownerMatches(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

function identity(stat: {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly uid: number;
}): PathIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode & 0o777,
    uid: stat.uid,
  };
}

function sameIdentity(left: PathIdentity, right: PathIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid
  );
}

function absentError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function strictDirectory(path: string, expectedMode?: number): boolean {
  try {
    const stat = lstatSync(path);
    return (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      ownerMatches(stat.uid) &&
      (expectedMode === undefined || (stat.mode & 0o777) === expectedMode)
    );
  } catch {
    return false;
  }
}

function captureSocket(path: string): Capture<SocketCapture> {
  try {
    const stat = lstatSync(path);
    if (
      !stat.isSocket() ||
      stat.isSymbolicLink() ||
      !ownerMatches(stat.uid) ||
      (stat.mode & 0o777) !== 0o600
    )
      return { kind: "invalid" };
    return { kind: "valid", value: { identity: identity(stat) } };
  } catch (error) {
    return absentError(error) ? { kind: "absent" } : { kind: "invalid" };
  }
}

function stateSource(state: OperationLockState): string {
  return canonicalJson(state as JsonValue);
}

/**
 * O_NOFOLLOW plus fstat binds parsing to the inode later rechecked before an
 * unlink. A checked path is never reopened through a symlink.
 */
function captureState(path: string): Capture<StateCapture> {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !ownerMatches(before.uid) ||
      (before.mode & 0o777) !== 0o600 ||
      constants.O_NOFOLLOW === undefined
    )
      return { kind: "invalid" };
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      !ownerMatches(opened.uid) ||
      (opened.mode & 0o777) !== 0o600 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > STATE_MAX_BYTES
    )
      return { kind: "invalid" };
    const source = readFileSync(descriptor, "utf8");
    if (utf8.encode(source).byteLength > STATE_MAX_BYTES)
      return { kind: "invalid" };
    const input = JSON.parse(source) as unknown;
    const parsed = validate<OperationLockState>(
      OperationLockStateSchema,
      input,
    );
    if (
      !parsed.ok ||
      parsed.value === undefined ||
      stateSource(parsed.value) !== source
    )
      return { kind: "invalid" };
    return {
      kind: "valid",
      value: { identity: identity(opened), source, state: parsed.value },
    };
  } catch (error) {
    return absentError(error) ? { kind: "absent" } : { kind: "invalid" };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writeState(
  path: string,
  state: OperationLockState,
): Capture<StateCapture> {
  let descriptor: number | undefined;
  try {
    if (constants.O_NOFOLLOW === undefined) return { kind: "invalid" };
    descriptor = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, stateSource(state), "utf8");
  } catch (error) {
    return absentError(error) ? { kind: "absent" } : { kind: "invalid" };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return captureState(path);
}

function paths(commonDir: string): LockPaths | undefined {
  try {
    if (realpathSync(commonDir) !== commonDir || !strictDirectory(commonDir))
      return undefined;
    const directory = join(commonDir, LOCK_DIRECTORY);
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return undefined;
    }
    if (!strictDirectory(directory, 0o700)) return undefined;
    if (statSync(commonDir).dev !== statSync(directory).dev) return undefined;
    return {
      directory,
      socket: join(directory, SOCKET_NAME),
      state: join(directory, STATE_NAME),
    };
  } catch {
    return undefined;
  }
}

function listen(
  socket: string,
): Promise<{ readonly server?: Server; readonly code?: string }> {
  return new Promise((resolve) => {
    const server = createServer((connection) => connection.destroy());
    const fail = (error: NodeJS.ErrnoException): void => {
      resolve({ code: error.code ?? "UNKNOWN" });
    };
    server.once("error", fail);
    server.listen(socket, () => {
      server.removeListener("error", fail);
      resolve({ server });
    });
  });
}

function socketIsLive(socketPath: string): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT")
        resolve(false);
      else resolve(undefined);
    });
  });
}

async function closeServer(server: Server): Promise<boolean> {
  return new Promise((resolve) => {
    server.close((error) => resolve(error === undefined));
  });
}

/** Immediate revalidation narrows deletion to the observed inode. */
function removeSocket(
  path: string,
  expected: SocketCapture,
): "removed" | "absent" | "changed" | "invalid" {
  const current = captureSocket(path);
  if (current.kind === "absent") return "absent";
  if (current.kind === "invalid") return "invalid";
  if (!sameIdentity(current.value.identity, expected.identity))
    return "changed";
  try {
    unlinkSync(path);
  } catch (error) {
    return absentError(error) ? "absent" : "changed";
  }
  return captureSocket(path).kind === "absent" ? "removed" : "changed";
}

function removeState(
  path: string,
  expected: StateCapture,
): "removed" | "absent" | "changed" | "invalid" {
  const current = captureState(path);
  if (current.kind === "absent") return "absent";
  if (current.kind === "invalid") return "invalid";
  if (
    !sameIdentity(current.value.identity, expected.identity) ||
    current.value.source !== expected.source
  )
    return "changed";
  try {
    unlinkSync(path);
  } catch (error) {
    return absentError(error) ? "absent" : "changed";
  }
  return captureState(path).kind === "absent" ? "removed" : "changed";
}

function cleanupStatus(
  result: "removed" | "absent" | "changed" | "invalid",
): "retry" | "quarantined" | "unavailable" {
  if (result === "removed" || result === "absent") return "retry";
  return result === "invalid" ? "quarantined" : "unavailable";
}

/** Kernel-backed Unix-socket operation lease beneath canonical Git commonDir. */
export class OperationLock {
  readonly #paths: LockPaths;
  readonly #server: Server;
  readonly #socket: SocketCapture;
  readonly #state: StateCapture;

  private constructor(
    pathsInput: LockPaths,
    server: Server,
    socket: SocketCapture,
    state: StateCapture,
  ) {
    this.#paths = pathsInput;
    this.#server = server;
    this.#socket = socket;
    this.#state = state;
  }

  static async acquire(
    input: OperationLockInput,
  ): Promise<OperationLockAcquire> {
    const lockPaths = paths(input.commonDir);
    if (lockPaths === undefined) return { status: "quarantined" };
    const desired: OperationLockState = {
      holder: input.holder,
      nonce: input.nonce,
      scopeCommitment: deriveScopeCommitment(input.scope),
      version: FENCING_SCHEMA_VERSION,
    };
    if (!validate<OperationLockState>(OperationLockStateSchema, desired).ok)
      return { status: "quarantined" };

    for (
      let attemptNumber = 0;
      attemptNumber < MAX_ACQUIRE_ATTEMPTS;
      attemptNumber += 1
    ) {
      const socket = captureSocket(lockPaths.socket);
      const state = captureState(lockPaths.state);
      if (socket.kind === "invalid" || state.kind === "invalid")
        return { status: "quarantined" };

      // Crash after socket close but before state removal.
      if (socket.kind === "absent" && state.kind === "valid") {
        const cleaned = cleanupStatus(
          removeState(lockPaths.state, state.value),
        );
        if (cleaned === "retry") continue;
        return { status: cleaned };
      }

      // Crash after bind but before state creation: kernel refusal is required.
      if (socket.kind === "valid" && state.kind === "absent") {
        const live = await socketIsLive(lockPaths.socket);
        if (live === true) return { status: "held" };
        if (live === undefined) return { status: "unavailable" };
        const cleaned = cleanupStatus(
          removeSocket(lockPaths.socket, socket.value),
        );
        if (cleaned === "retry") continue;
        return { status: cleaned };
      }

      if (socket.kind === "valid" && state.kind === "valid") {
        const live = await socketIsLive(lockPaths.socket);
        if (live === true) return { status: "held" };
        if (live === undefined) return { status: "unavailable" };
        const removedSocket = cleanupStatus(
          removeSocket(lockPaths.socket, socket.value),
        );
        if (removedSocket !== "retry") return { status: removedSocket };
        const removedState = cleanupStatus(
          removeState(lockPaths.state, state.value),
        );
        if (removedState !== "retry") return { status: removedState };
        continue;
      }

      const listened = await listen(lockPaths.socket);
      if (listened.server === undefined) {
        if (listened.code === "EADDRINUSE") continue;
        return { status: "unavailable" };
      }
      try {
        chmodSync(lockPaths.socket, 0o600);
      } catch {
        await closeServer(listened.server);
        return { status: "quarantined" };
      }
      const ownedSocket = captureSocket(lockPaths.socket);
      if (ownedSocket.kind !== "valid") {
        await closeServer(listened.server);
        return { status: "quarantined" };
      }
      const written = writeState(lockPaths.state, desired);
      if (written.kind !== "valid") {
        await closeServer(listened.server);
        const cleanup = cleanupStatus(
          removeSocket(lockPaths.socket, ownedSocket.value),
        );
        return {
          status: cleanup === "quarantined" ? "quarantined" : "unavailable",
        };
      }
      return {
        status: "acquired",
        lock: new OperationLock(
          lockPaths,
          listened.server,
          ownedSocket.value,
          written.value,
        ),
      };
    }
    return { status: "unavailable" };
  }

  async release(): Promise<OperationLockRelease> {
    const currentSocket = captureSocket(this.#paths.socket);
    const currentState = captureState(this.#paths.state);
    if (currentSocket.kind === "invalid" || currentState.kind === "invalid")
      return { status: "quarantined" };
    if (currentSocket.kind !== "valid" || currentState.kind !== "valid")
      return { status: "holder_mismatch" };
    if (
      !sameIdentity(currentSocket.value.identity, this.#socket.identity) ||
      !sameIdentity(currentState.value.identity, this.#state.identity) ||
      currentState.value.source !== this.#state.source
    )
      return { status: "holder_mismatch" };
    if (!(await closeServer(this.#server))) return { status: "unavailable" };
    const socketResult = removeSocket(this.#paths.socket, this.#socket);
    if (socketResult === "invalid") return { status: "quarantined" };
    if (socketResult === "changed") return { status: "holder_mismatch" };
    const stateResult = removeState(this.#paths.state, this.#state);
    if (stateResult === "invalid") return { status: "quarantined" };
    if (stateResult === "changed") return { status: "holder_mismatch" };
    return { status: "released" };
  }
}
