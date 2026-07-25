import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createLocalMcpServer } from "../infrastructure/local-runtime.js";
import { startStdioServer } from "../transports/stdio.js";

type Environment = Readonly<Record<string, string | undefined>>;

export async function startStdioMode(environment: Environment): Promise<void> {
  await startStdioServer({
    server: createLocalMcpServer(environment),
    transport: new StdioServerTransport(process.stdin, process.stdout),
    signals: process,
  });
}
