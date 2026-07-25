import { createHostedApplication } from "../infrastructure/hosted-runtime.js";
import type { HostedDiagnosticCategory } from "../transports/hosted-diagnostics.js";
import { createHostedRequestLifecycle } from "../transports/hosted-lifecycle.js";
import {
  startNodeHttpServer,
  type RunningNodeHttpServer,
} from "../transports/node-http.js";

type Environment = Readonly<Record<string, string | undefined>>;

interface SignalSource {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

const HOSTED_DIAGNOSTIC_MESSAGES: Readonly<
  Record<HostedDiagnosticCategory, string>
> = {
  request_failed: "steam-mcp: hosted request failed\n",
  shutdown_cleanup_failed: "steam-mcp: shutdown cleanup failed\n",
};

export async function startHostedMode(
  environment: Environment,
  signals: SignalSource,
  writeDiagnostic: (message: string) => void = (message) =>
    process.stderr.write(message),
): Promise<void> {
  const reportDiagnostic = (category: HostedDiagnosticCategory): void => {
    writeDiagnostic(HOSTED_DIAGNOSTIC_MESSAGES[category]);
  };
  const application = createHostedApplication(environment);
  const serverReference: { current?: RunningNodeHttpServer } = {};
  const lifecycle = createHostedRequestLifecycle({
    handler: application.handler,
    readiness: application.readiness,
    drainTimeoutMs: application.config.shutdownDrainTimeoutMs,
    stopHttpAcceptance: () =>
      serverReference.current?.stop() ?? Promise.resolve(),
    closeHttp: () => serverReference.current?.close() ?? Promise.resolve(),
    reportDiagnostic,
  });
  serverReference.current = await startNodeHttpServer({
    handler: lifecycle,
    hostname: application.config.listenHost,
    headersTimeoutMs: 15_000,
    maxRequestBytes: application.config.maxRequestBytes,
    port: application.config.port,
    publicOrigin: new URL("/", application.config.resourceUri),
    reportDiagnostic,
    requestTimeoutMs: 30_000,
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void lifecycle.shutdown();
  };
  signals.once("SIGINT", shutdown);
  signals.once("SIGTERM", shutdown);
}
