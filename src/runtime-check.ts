import { showHUD } from "@raycast/api";
import { getRuntimeInfo } from "./shared/runtime-info";

export default async function Command() {
  const info = getRuntimeInfo();
  const sqlite = info.runtime.sqlite ?? "unavailable";

  console.log(`[worktodo-runtime] ${JSON.stringify(info)}`);
  await showHUD(`Worktodo: Node ${info.runtime.node}, SQLite ${sqlite}`);
}
