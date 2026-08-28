import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

export const SPIKE_PROTOCOL_VERSION = 1;
export const SPIKE_SESSION_TTL_MS = 10 * 60 * 1_000;
export const SPIKE_ROOT_DIRECTORY = join(tmpdir(), "worktodo-sqlite-spike");

export type SpikeSession = {
  protocolVersion: number;
  sessionId: string;
  sessionDirectory: string;
  databasePath: string;
  createdAt: string;
  expiresAt: string;
};

export type SpikeRequestAction =
  | "runtime"
  | "read-marker"
  | "write-marker"
  | "hold-write"
  | "migrate"
  | "foreign-key"
  | "rollback-exception"
  | "hold-read"
  | "verify"
  | "verify-backup"
  | "finish";

export type SpikeRequest = {
  protocolVersion: number;
  sessionId: string;
  requestId: string;
  action: SpikeRequestAction;
  parameters: Record<string, string>;
};

export type SpikeResponse = {
  protocolVersion: number;
  sessionId: string;
  requestId: string;
  status: "ok" | "error";
  startedAt: string;
  finishedAt: string;
  output?: Record<string, unknown>;
  error?: {
    message: string;
    code: string | null;
  };
};

export type SpikeCheck = {
  name: string;
  status: "pass" | "fail";
  durationMs: number;
  details: Record<string, unknown>;
};

export type SpikeReport = {
  protocolVersion: number;
  sessionId: string;
  status: "pass" | "fail";
  startedAt: string;
  finishedAt: string;
  runtimes: {
    node24: Record<string, unknown>;
    raycast: Record<string, unknown>;
  };
  checks: SpikeCheck[];
  failure?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string`);
  }
  return value;
}

export function validateSpikeSession(value: unknown, now = Date.now()): SpikeSession {
  if (!isRecord(value)) {
    throw new Error("Invalid SQLite spike session descriptor");
  }

  if (value.protocolVersion !== SPIKE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported SQLite spike protocol: ${String(value.protocolVersion)}`);
  }

  const sessionId = requireString(value, "sessionId");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new Error("Invalid SQLite spike session identifier");
  }

  const sessionDirectory = requireString(value, "sessionDirectory");
  const databasePath = requireString(value, "databasePath");
  const createdAt = requireString(value, "createdAt");
  const expiresAt = requireString(value, "expiresAt");
  const expectedDirectory = resolve(SPIKE_ROOT_DIRECTORY, sessionId);

  if (resolve(sessionDirectory) !== expectedDirectory) {
    throw new Error("SQLite spike session directory is outside the expected temporary root");
  }
  if (resolve(databasePath) !== join(expectedDirectory, "spike.sqlite")) {
    throw new Error("SQLite spike database path does not match its session");
  }

  const createdTime = Date.parse(createdAt);
  const expiryTime = Date.parse(expiresAt);
  if (!Number.isFinite(createdTime) || !Number.isFinite(expiryTime) || expiryTime <= createdTime) {
    throw new Error("Invalid SQLite spike session timestamps");
  }
  if (now >= expiryTime) {
    throw new Error("SQLite spike session has expired");
  }
  if (createdTime > now + 5_000) {
    throw new Error("SQLite spike session starts in the future");
  }

  return {
    protocolVersion: SPIKE_PROTOCOL_VERSION,
    sessionId,
    sessionDirectory: expectedDirectory,
    databasePath: join(expectedDirectory, "spike.sqlite"),
    createdAt,
    expiresAt,
  };
}

export function validateSpikeReport(value: unknown): SpikeReport {
  if (!isRecord(value) || value.protocolVersion !== SPIKE_PROTOCOL_VERSION) {
    throw new Error("Invalid SQLite spike report");
  }

  const sessionId = requireString(value, "sessionId");
  const status = value.status;
  if (status !== "pass" && status !== "fail") {
    throw new Error("Invalid SQLite spike report status");
  }
  if (!isRecord(value.runtimes) || !isRecord(value.runtimes.node24) || !isRecord(value.runtimes.raycast)) {
    throw new Error("Invalid SQLite spike runtime evidence");
  }
  if (!Array.isArray(value.checks)) {
    throw new Error("Invalid SQLite spike checks");
  }

  const checks = value.checks.map((check, index): SpikeCheck => {
    if (!isRecord(check) || (check.status !== "pass" && check.status !== "fail") || !isRecord(check.details)) {
      throw new Error(`Invalid SQLite spike check at index ${index}`);
    }
    const durationMs = check.durationMs;
    if (typeof durationMs !== "number" || durationMs < 0) {
      throw new Error(`Invalid SQLite spike check duration at index ${index}`);
    }
    return {
      name: requireString(check, "name"),
      status: check.status,
      durationMs,
      details: check.details,
    };
  });

  return {
    protocolVersion: SPIKE_PROTOCOL_VERSION,
    sessionId,
    status,
    startedAt: requireString(value, "startedAt"),
    finishedAt: requireString(value, "finishedAt"),
    runtimes: {
      node24: value.runtimes.node24,
      raycast: value.runtimes.raycast,
    },
    checks,
    ...(typeof value.failure === "string" ? { failure: value.failure } : {}),
  };
}

export function activeSessionPath(): string {
  return join(SPIKE_ROOT_DIRECTORY, "active.json");
}

export function sessionDescriptorPath(session: SpikeSession): string {
  return join(session.sessionDirectory, "session.json");
}

export function readyPath(session: SpikeSession): string {
  return join(session.sessionDirectory, "raycast-ready.json");
}

export function requestPath(session: SpikeSession, requestId: string): string {
  return join(session.sessionDirectory, "requests", `${requestId}.json`);
}

export function responsePath(session: SpikeSession, requestId: string): string {
  return join(session.sessionDirectory, "responses", `${requestId}.json`);
}

export function eventPath(session: SpikeSession, requestId: string, event: "started" | "release"): string {
  return join(session.sessionDirectory, "events", `${requestId}.${event}.json`);
}

export function gatePath(session: SpikeSession, name: string): string {
  return join(session.sessionDirectory, "gates", `${name}.json`);
}

export function reportPath(session: SpikeSession): string {
  return join(session.sessionDirectory, "report.json");
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function waitForJson(path: string, timeoutMs = 30_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      return await readJson(path);
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }

  throw new Error(`Timed out waiting for ${path}`);
}

export function assertSpikeSessionActive(session: SpikeSession): void {
  if (Date.now() >= Date.parse(session.expiresAt)) {
    throw new Error("SQLite spike session has expired");
  }
}

export async function writeSessionMarker(
  session: SpikeSession,
  path: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  assertSpikeSessionActive(session);
  await writeJsonAtomic(path, {
    ...details,
    protocolVersion: session.protocolVersion,
    sessionId: session.sessionId,
    at: Date.now(),
  });
}

export async function waitForSessionMarker(
  session: SpikeSession,
  path: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  assertSpikeSessionActive(session);
  let value: unknown;
  try {
    value = await waitForJson(path, Math.min(timeoutMs, Date.parse(session.expiresAt) - Date.now()));
  } catch (error) {
    assertSpikeSessionActive(session);
    throw error;
  }
  assertSpikeSessionActive(session);
  if (!isRecord(value) || value.protocolVersion !== session.protocolVersion || value.sessionId !== session.sessionId) {
    throw new Error("Invalid SQLite spike session marker");
  }
  return value;
}

export async function createSpikeSession(now = Date.now(), activate = true): Promise<SpikeSession> {
  const sessionId = randomUUID();
  const sessionDirectory = join(SPIKE_ROOT_DIRECTORY, sessionId);
  const session: SpikeSession = {
    protocolVersion: SPIKE_PROTOCOL_VERSION,
    sessionId,
    sessionDirectory,
    databasePath: join(sessionDirectory, "spike.sqlite"),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SPIKE_SESSION_TTL_MS).toISOString(),
  };

  await mkdir(SPIKE_ROOT_DIRECTORY, { recursive: true });
  await mkdir(sessionDirectory, { recursive: false });
  await writeJsonAtomic(sessionDescriptorPath(session), session);
  if (activate) {
    await writeJsonAtomic(activeSessionPath(), session);
  }
  return session;
}

export async function loadActiveSpikeSession(now = Date.now()): Promise<SpikeSession> {
  const active = validateSpikeSession(await readJson(activeSessionPath()), now);
  const descriptor = validateSpikeSession(await readJson(sessionDescriptorPath(active)), now);
  if (JSON.stringify(active) !== JSON.stringify(descriptor)) {
    throw new Error("Active SQLite spike session does not match its descriptor");
  }
  return active;
}

export async function clearActiveSpikeSession(session: SpikeSession): Promise<void> {
  try {
    const active = validateSpikeSession(await readJson(activeSessionPath()));
    if (active.sessionId === session.sessionId) {
      await rm(activeSessionPath(), { force: true });
    }
  } catch {
    // An absent, stale, or replaced pointer must not cause cleanup to remove another session.
  }
}

export function createSpikeRequest(
  session: SpikeSession,
  action: SpikeRequestAction,
  parameters: Record<string, string> = {},
): SpikeRequest {
  return {
    protocolVersion: SPIKE_PROTOCOL_VERSION,
    sessionId: session.sessionId,
    requestId: randomUUID(),
    action,
    parameters,
  };
}

export function validateSpikeRequest(value: unknown, session: SpikeSession): SpikeRequest {
  if (!isRecord(value) || value.protocolVersion !== SPIKE_PROTOCOL_VERSION || value.sessionId !== session.sessionId) {
    throw new Error("Invalid SQLite spike request envelope");
  }
  const requestId = requireString(value, "requestId");
  const action = value.action;
  const actions: SpikeRequestAction[] = [
    "runtime",
    "read-marker",
    "write-marker",
    "hold-write",
    "migrate",
    "foreign-key",
    "rollback-exception",
    "hold-read",
    "verify",
    "verify-backup",
    "finish",
  ];
  if (typeof action !== "string" || !actions.includes(action as SpikeRequestAction) || !isRecord(value.parameters)) {
    throw new Error("Invalid SQLite spike request body");
  }
  const parameters = Object.fromEntries(
    Object.entries(value.parameters).map(([key, parameter]) => {
      if (typeof parameter !== "string") {
        throw new Error(`Invalid SQLite spike request parameter: ${key}`);
      }
      return [key, parameter];
    }),
  );

  return {
    protocolVersion: SPIKE_PROTOCOL_VERSION,
    sessionId: session.sessionId,
    requestId,
    action: action as SpikeRequestAction,
    parameters,
  };
}

export function validateSpikeResponse(value: unknown, request: SpikeRequest): SpikeResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== SPIKE_PROTOCOL_VERSION ||
    value.sessionId !== request.sessionId ||
    value.requestId !== request.requestId ||
    (value.status !== "ok" && value.status !== "error")
  ) {
    throw new Error("Invalid SQLite spike response envelope");
  }
  if (value.output !== undefined && !isRecord(value.output)) {
    throw new Error("Invalid SQLite spike response output");
  }
  if (value.error !== undefined && !isRecord(value.error)) {
    throw new Error("Invalid SQLite spike response error");
  }

  return value as SpikeResponse;
}
