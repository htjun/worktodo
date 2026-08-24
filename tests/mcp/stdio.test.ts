import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

describe("Worktodo MCP stdio server", () => {
  it("discovers and calls the ping tool", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("dist/mcp/server.js")],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    const client = new Client({ name: "worktodo-test", version: "0.0.0" });

    try {
      await client.connect(transport);

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: "ping",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });

      const result = await client.callTool({ name: "ping", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Worktodo MCP is ready." }]);
      expect(result.structuredContent).toMatchObject({
        status: "ok",
        app: "Worktodo",
        version: "0.0.0",
        runtime: { node: process.versions.node },
      });
    } finally {
      await client.close();
    }
  });
});
