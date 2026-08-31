import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./create-server";

serveStdio(() => createServer());
