import { applySyntheticMigration, openSpikeDatabase, SPIKE_BUSY_TIMEOUT_MS } from "./database";
import { gatePath, SpikeSession, waitForSessionMarker, writeSessionMarker } from "./protocol";

type MigrationRole = "holder" | "waiter";

export function migrationMarkerPath(session: SpikeSession, role: MigrationRole, event: string): string {
  return gatePath(session, `migration-${role}-${event}`);
}

export async function runMigrationContender(session: SpikeSession, actor: string, role: MigrationRole) {
  const db = openSpikeDatabase(session.databasePath);
  const marker = (event: string) => migrationMarkerPath(session, role, event);
  try {
    await writeSessionMarker(session, marker("ready"));
    await waitForSessionMarker(session, marker("start"));
    return await applySyntheticMigration(db, actor, {
      beforeBegin: () => writeSessionMarker(session, marker("attempted")),
      afterLock: async () => {
        await writeSessionMarker(session, marker("acquired"));
        if (role === "holder") {
          await waitForSessionMarker(session, marker("release"));
        }
      },
    });
  } finally {
    db.close();
  }
}

export async function coordinateMigrationRace(session: SpikeSession, timeoutMs = 5_000) {
  const holder = (event: string) => migrationMarkerPath(session, "holder", event);
  const waiter = (event: string) => migrationMarkerPath(session, "waiter", event);
  const ready = await Promise.all([
    waitForSessionMarker(session, holder("ready"), timeoutMs),
    waitForSessionMarker(session, waiter("ready"), timeoutMs),
  ]);
  await writeSessionMarker(session, holder("start"));
  const acquired = await waitForSessionMarker(session, holder("acquired"), timeoutMs);
  await writeSessionMarker(session, waiter("start"));
  const attempted = await waitForSessionMarker(session, waiter("attempted"), timeoutMs);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  await writeSessionMarker(session, holder("release"));
  const released = await waitForSessionMarker(session, holder("release"), timeoutMs);
  return { ready, acquired, attempted, released };
}

export function validateMigrationContention(
  holder: Record<string, unknown>,
  waiter: Record<string, unknown>,
  release: Record<string, unknown>,
): void {
  for (const result of [holder, waiter]) {
    for (const key of ["attemptedAt", "acquiredAt", "committedAt", "lockWaitMs"]) {
      if (typeof result[key] !== "number" || !Number.isFinite(result[key])) {
        throw new Error(`Invalid migration timing: ${key}`);
      }
    }
    if (result.userVersion !== 1 || result.migrationAuditCount !== 1) {
      throw new Error("Migration did not produce exactly one audit row and user_version 1");
    }
  }
  if (
    holder.applied !== true ||
    holder.versionAfterLock !== 0 ||
    waiter.applied !== false ||
    waiter.versionAfterLock !== 1
  ) {
    throw new Error("Migration waiter did not re-read version 1 inside its acquired transaction");
  }
  if (
    typeof release.at !== "number" ||
    !Number.isFinite(release.at) ||
    Number(holder.acquiredAt) > Number(waiter.attemptedAt) ||
    Number(waiter.attemptedAt) >= release.at ||
    release.at > Number(holder.committedAt) ||
    Number(holder.committedAt) > Number(waiter.acquiredAt) ||
    Number(waiter.lockWaitMs) < 200 ||
    Number(waiter.lockWaitMs) >= SPIKE_BUSY_TIMEOUT_MS
  ) {
    throw new Error("Migration did not demonstrate overlapping lock contention within the busy timeout");
  }
}
