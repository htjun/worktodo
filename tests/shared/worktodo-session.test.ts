import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openWorktodoAtPath, runWorktodoOperation } from "../../src/shared/application/worktodo";
import { parseBackupJson } from "../../src/shared/portability/backup-contract";
import { openWorktodoDatabase } from "../../src/shared/storage/database";
import { applyMigrations, type MigrationResult } from "../../src/shared/storage/schema";

const temporaryDirectories: string[] = [];

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Worktodo application session", () => {
  it("composes persistence and portability at explicit disposable paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worktodo-session-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "store", "worktodo.sqlite");
    const recoveryDirectory = join(directory, "recovery");
    const exportDirectory = join(directory, "exports");
    await mkdir(exportDirectory);
    let nextId = 1;
    const migrations: MigrationResult[] = [];
    const migrate = (database: Parameters<typeof applyMigrations>[0]) => {
      const result = applyMigrations(database);
      migrations.push(result);
      return result;
    };

    const first = openWorktodoAtPath(databasePath, {
      createId: () => id(nextId++),
      migrate,
      now: () => 1_000,
      recoveryDirectory,
    });
    const project = first.service.createProject("Work");
    const label = first.service.createLabel("Next");
    const task = first.service.createTask({
      title: "Protect application wiring",
      projectId: project.id,
      labelIds: [label.id],
    });
    const exported = first.portability.exportTo(exportDirectory);
    first.close();

    expect(parseBackupJson(await readFile(exported.path, "utf8")).tasks).toEqual([task]);
    expect(exported.path.startsWith(`${exportDirectory}/`)).toBe(true);

    const reopened = openWorktodoAtPath(databasePath, {
      createId: () => id(nextId++),
      migrate,
      now: () => 2_000,
      recoveryDirectory,
    });
    try {
      expect(reopened.databasePath).toBe(databasePath);
      expect(reopened.service.getTask(task.id)).toEqual(task);
    } finally {
      reopened.close();
    }

    const inspection = openWorktodoDatabase(databasePath);
    try {
      expect(inspection.prepare("PRAGMA user_version").get()?.user_version).toBe(4);
      expect(migrations).toEqual([
        { applied: true, previousVersion: 0, currentVersion: 4 },
        { applied: false, previousVersion: 4, currentVersion: 4 },
      ]);
    } finally {
      inspection.close();
    }
  });

  it("closes the opened database when session construction fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worktodo-session-failure-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "worktodo.sqlite");
    const database = openWorktodoDatabase(databasePath);
    const close = vi.spyOn(database, "close");

    expect(() =>
      openWorktodoAtPath(databasePath, {
        migrate: () => {
          throw new Error("injected migration failure");
        },
        openDatabase: () => database,
        recoveryDirectory: join(directory, "recovery"),
      }),
    ).toThrow("injected migration failure");
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the construction error when closing the acquired database also fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worktodo-construction-cleanup-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "worktodo.sqlite");
    const database = openWorktodoDatabase(databasePath);
    const closeDatabase = database.close.bind(database);
    const cleanupError = new Error("injected cleanup failure");
    const constructionError = new Error("injected migration failure");
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const close = vi.spyOn(database, "close").mockImplementationOnce(() => {
      closeDatabase();
      throw cleanupError;
    });

    expect(() =>
      openWorktodoAtPath(databasePath, {
        migrate: () => {
          throw constructionError;
        },
        openDatabase: () => database,
      }),
    ).toThrow(constructionError);
    expect(close).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith("Worktodo construction session close failed", cleanupError);
  });

  it("keeps catalog results and read errors after cleanup fails in a real store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "worktodo-catalog-cleanup-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "worktodo.sqlite");
    let nextId = 1;
    const options = { createId: () => id(nextId++), now: () => 1_000 };
    const setup = openWorktodoAtPath(databasePath, options);
    const project = setup.service.createProject("Work");
    const label = setup.service.createLabel("Next");
    setup.close();
    const cleanupError = new Error("injected cleanup failure");
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const close = vi.fn();
    const open = () => {
      const session = openWorktodoAtPath(databasePath, options);
      return {
        service: session.service,
        close: () => {
          close();
          session.close();
          throw cleanupError;
        },
      };
    };

    expect(
      runWorktodoOperation(open, (session) => ({
        projects: session.service.listProjects(),
        labels: session.service.listLabels(),
      })),
    ).toEqual({ projects: [project], labels: [label] });
    const readError = new Error("catalog read failed");
    expect(() =>
      runWorktodoOperation(open, (session) => {
        vi.spyOn(session.service, "listLabels").mockImplementationOnce(() => {
          throw readError;
        });
        return session.service.listLabels();
      }),
    ).toThrow(readError);
    expect(close).toHaveBeenCalledTimes(2);
    expect(diagnostics).toHaveBeenCalledTimes(2);
  });
});

describe("operation-scoped Worktodo sessions", () => {
  it.each([false, true])("keeps the exact result with cleanup failure=%s", (cleanupFails) => {
    const cleanupError = new Error("close failed");
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const close = vi.fn(() => {
      if (cleanupFails) throw cleanupError;
    });
    const session = { close };
    const open = vi.fn(() => session);
    const result = { saved: true };
    const operation = vi.fn(() => result);

    expect(runWorktodoOperation(open, operation)).toBe(result);
    expect(open).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledExactlyOnceWith(session);
    expect(close).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledTimes(cleanupFails ? 1 : 0);
  });

  it.each([false, true])("keeps the original operation error with cleanup failure=%s", (cleanupFails) => {
    const operationError = new Error("write failed");
    const close = vi.fn(() => {
      if (cleanupFails) throw new Error("close failed");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const open = vi.fn(() => ({ close }));
    const operation = vi.fn(() => {
      throw operationError;
    });
    let thrown: unknown;
    try {
      runWorktodoOperation(open, operation);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(operationError);
    expect(open).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not run an operation or cleanup after acquisition fails", () => {
    const acquisitionError = new Error("open failed");
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const open = vi.fn(() => {
      throw acquisitionError;
    });
    const operation = vi.fn();

    expect(() => runWorktodoOperation(open, operation)).toThrow(acquisitionError);
    expect(open).toHaveBeenCalledOnce();
    expect(operation).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalled();
  });
});
