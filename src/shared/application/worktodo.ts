import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { TaskService } from "../domain/task-service";
import { PortabilityService } from "../portability/portability-service";
import { resolveRecoveryDirectory } from "../portability/replace-backup";
import { openWorktodoDatabase, resolveProductionDatabasePath } from "../storage/database";
import { applyMigrations } from "../storage/schema";
import { SqliteTaskRepository } from "../storage/sqlite-task-repository";

export type WorktodoSession = {
  databasePath: string;
  portability: PortabilityService;
  service: TaskService;
  close: () => void;
};

export type OpenWorktodoOptions = {
  createId?: () => string;
  migrate?: (db: DatabaseSync) => unknown;
  now?: () => number;
  openDatabase?: (databasePath: string) => DatabaseSync;
  recoveryDirectory?: string;
};

function closeSession(session: Pick<WorktodoSession, "close">, context: string): void {
  try {
    session.close();
  } catch (error) {
    console.error(`Worktodo ${context} session close failed`, error);
  }
}

export function runWorktodoOperation<Session extends Pick<WorktodoSession, "close">, Result>(
  openSession: () => Session,
  operation: (session: Session) => Result,
  context = "operation",
): Result {
  const session = openSession();
  try {
    return operation(session);
  } finally {
    closeSession(session, context);
  }
}

function createSession(databasePath: string, db: DatabaseSync, options: OpenWorktodoOptions): WorktodoSession {
  try {
    (options.migrate ?? applyMigrations)(db);
    const repository = new SqliteTaskRepository(db);
    const now = options.now ?? Date.now;
    return {
      databasePath,
      portability: new PortabilityService(repository, options.recoveryDirectory ?? resolveRecoveryDirectory(), now),
      service: new TaskService(repository, { createId: options.createId ?? randomUUID, now }),
      close: () => db.close(),
    };
  } catch (error) {
    closeSession(db, "construction");
    throw error;
  }
}

export function openWorktodoAtPath(databasePath: string, options: OpenWorktodoOptions = {}): WorktodoSession {
  return createSession(databasePath, (options.openDatabase ?? openWorktodoDatabase)(databasePath), options);
}

export function openProductionWorktodo(): WorktodoSession {
  return openWorktodoAtPath(resolveProductionDatabasePath());
}
