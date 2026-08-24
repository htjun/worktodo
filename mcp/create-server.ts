import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getRuntimeInfo } from "../src/shared/runtime-info";

const pingOutputSchema = z.object({
  status: z.literal("ok"),
  app: z.string(),
  version: z.string(),
  runtime: z.object({
    node: z.string(),
    sqlite: z.string().nullable(),
  }),
});

export function createServer() {
  const runtimeInfo = getRuntimeInfo();
  const server = new McpServer({ name: "worktodo", version: runtimeInfo.version });

  server.registerTool(
    "ping",
    {
      title: "Ping Worktodo",
      description: "Check that the local Worktodo MCP server is ready.",
      inputSchema: z.object({}).strict(),
      outputSchema: pingOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const output = { status: "ok" as const, ...getRuntimeInfo() };

      return {
        content: [{ type: "text" as const, text: `${output.app} MCP is ready.` }],
        structuredContent: output,
      };
    },
  );

  return server;
}
