#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createLocalMcpServer } from "../infrastructure/local-runtime.js";
import { startStdioServer } from "../transports/stdio.js";

try {
  await startStdioServer({
    server: createLocalMcpServer(process.env),
    transport: new StdioServerTransport(process.stdin, process.stdout),
    signals: process,
  });
} catch {
  process.stderr.write("steam-mcp: startup failed; check configuration\n");
  process.exitCode = 1;
}
