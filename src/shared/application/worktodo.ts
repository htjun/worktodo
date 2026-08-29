import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { TaskService } from "../domain/task-service";
import { openProductionDatabase, resolveProductionDatabasePath } from "../storage/database";
import { applyMigrations } from "../storage/schema";
import { SqliteTaskRepository } from "../storage/sqlite-task-repository";

export type WorktodoSession = {
  databasePath: string;
  service: TaskService;
  close: () => void;
};

function createSession(databasePath: string, db: DatabaseSync): WorktodoSession {
  try {
    applyMigrations(db);
    const repository = new SqliteTaskRepository(db);
    return {
      databasePath,
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
