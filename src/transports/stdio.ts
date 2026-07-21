import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

interface StdioServerLike {
  readonly server: { onerror?: (error: Error) => void };
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
}

interface SignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

interface StartStdioServerOptions {
  readonly server: StdioServerLike;
  readonly transport: Transport;
  readonly signals: SignalSource;
  readonly writeDiagnostic?: (message: string) => void;
}

export interface RunningStdioServer {
  stop(): Promise<void>;
}

export async function startStdioServer(
  options: StartStdioServerOptions,
): Promise<RunningStdioServer> {
  const writeDiagnostic =
    options.writeDiagnostic ?? ((message) => process.stderr.write(message));
  options.server.server.onerror = () => {
    writeDiagnostic("steam-mcp: protocol error\n");
  };
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      options.signals.off("SIGINT", onSignal);
      options.signals.off("SIGTERM", onSignal);
      await options.server.close();
    })();
    return stopPromise;
  };
  const onSignal = (): void => {
    void stop();
  };

  options.signals.on("SIGINT", onSignal);
  options.signals.on("SIGTERM", onSignal);
  try {
    await options.server.connect(options.transport);
  } catch (error) {
    options.signals.off("SIGINT", onSignal);
    options.signals.off("SIGTERM", onSignal);
    throw error;
  }
  return { stop };
}
