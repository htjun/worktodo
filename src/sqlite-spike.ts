import { showHUD } from "@raycast/api";
import { runRaycastSqliteSpike } from "./shared/sqlite-spike/raycast-peer";

export default async function Command() {
  try {
    await runRaycastSqliteSpike();
    await showHUD("Worktodo SQLite validation finished");
  } catch (error) {
    console.error("[worktodo-sqlite-spike]", error);
    await showHUD("Worktodo SQLite validation failed");
    throw error;
  }
}
