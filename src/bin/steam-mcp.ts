#!/usr/bin/env node

import { runSteamMcpCli } from "../cli/steam-mcp-cli.js";
import { startHostedMode } from "../cli/start-hosted.js";
import { startStdioMode } from "../cli/start-stdio.js";

process.exitCode = await runSteamMcpCli(process.argv.slice(2), {
  startStdio: () => startStdioMode(process.env),
  startHttp: () =>
    startHostedMode(process.env, process, (message) =>
      process.stderr.write(message),
    ),
  writeDiagnostic: (message) => process.stderr.write(message),
});
