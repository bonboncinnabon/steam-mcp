#!/usr/bin/env node

import { createHostedApplication } from "../infrastructure/hosted-runtime.js";
import { createHostedRequestLifecycle } from "../transports/hosted-lifecycle.js";
import {
  startNodeHttpServer,
  type RunningNodeHttpServer,
} from "../transports/node-http.js";

try {
  const application = createHostedApplication(process.env);
  const serverReference: { current?: RunningNodeHttpServer } = {};
  const lifecycle = createHostedRequestLifecycle({
    handler: application.handler,
    readiness: application.readiness,
    drainTimeoutMs: application.config.shutdownDrainTimeoutMs,
    stopHttpAcceptance: () =>
      serverReference.current?.stop() ?? Promise.resolve(),
    closeHttp: () => serverReference.current?.close() ?? Promise.resolve(),
  });
  serverReference.current = await startNodeHttpServer({
    handler: lifecycle,
    hostname: application.config.listenHost,
    port: application.config.port,
    publicOrigin: new URL("/", application.config.resourceUri),
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void lifecycle.shutdown();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  process.stderr.write(
    "steam-mcp-hosted: startup failed; check hosted configuration\n",
  );
  process.exitCode = 1;
}
