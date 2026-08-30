import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { TaskService } from "../domain/task-service";
import { PortabilityService } from "../portability/portability-service";
import { resolveRecoveryDirectory } from "../portability/replace-backup";
import { openProductionDatabase, resolveProductionDatabasePath } from "../storage/database";
import { applyMigrations } from "../storage/schema";
import { SqliteTaskRepository } from "../storage/sqlite-task-repository";

export type WorktodoSession = {
  databasePath: string;
  portability: PortabilityService;
  service: TaskService;
  close: () => void;
};

function createSession(databasePath: string, db: DatabaseSync): WorktodoSession {
  try {
    applyMigrations(db);
    const repository = new SqliteTaskRepository(db);
    return {
      databasePath,
      portability: new PortabilityService(repository, resolveRecoveryDirectory(), Date.now),
      service: new TaskService(repository, { createId: randomUUID, now: Date.now }),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openProductionWorktodo(): WorktodoSession {
  const databasePath = resolveProductionDatabasePath();
  return createSession(databasePath, openProductionDatabase());
}
