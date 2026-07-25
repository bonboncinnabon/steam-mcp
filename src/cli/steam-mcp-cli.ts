export interface SteamMcpCliRunners {
  readonly startStdio: () => Promise<void>;
  readonly startHttp: () => Promise<void>;
  readonly writeDiagnostic: (message: string) => void;
}

export async function runSteamMcpCli(
  args: readonly string[],
  runners: SteamMcpCliRunners,
): Promise<number> {
  if (args.length === 0) {
    try {
      await runners.startStdio();
      return 0;
    } catch {
      runners.writeDiagnostic(
        "steam-mcp: stdio startup failed; check configuration\n",
      );
      return 1;
    }
  }

  if (args.length === 1 && args[0] === "serve") {
    try {
      await runners.startHttp();
      return 0;
    } catch {
      runners.writeDiagnostic(
        "steam-mcp: hosted startup failed; check hosted configuration\n",
      );
      return 1;
    }
  }

  runners.writeDiagnostic("Usage: steam-mcp [serve]\n");
  return 1;
}
