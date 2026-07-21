import type { HttpRequestHandler } from "./health.js";

export interface HostedReadinessControl {
  readonly markNotReady: () => void;
}

export interface CloseableResource {
  readonly close: () => Promise<void>;
}

export interface HostedRequestLifecycle extends HttpRequestHandler {
  shutdown(): Promise<void>;
}

export interface HostedRequestLifecycleOptions {
  readonly handler: HttpRequestHandler;
  readonly readiness: HostedReadinessControl;
  readonly drainTimeoutMs: number;
  readonly stopHttpAcceptance: () => Promise<void>;
  readonly closeHttp: () => Promise<void>;
  readonly quotaClient?: CloseableResource;
}

function unavailableResponse(): Response {
  return new Response(JSON.stringify({ error: "service_unavailable" }), {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
}

function attempt(operation: () => Promise<void>): Promise<void> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error("Resource cleanup failed"),
    );
  }
}

async function settleCleanup(
  operations: readonly Promise<void>[],
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
  await Promise.race([Promise.allSettled(operations), deadline]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
}

export function createHostedRequestLifecycle(
  options: HostedRequestLifecycleOptions,
): HostedRequestLifecycle {
  if (
    !Number.isSafeInteger(options.drainTimeoutMs) ||
    options.drainTimeoutMs <= 0 ||
    options.drainTimeoutMs > 60_000
  ) {
    throw new RangeError("Invalid drain timeout");
  }

  let accepting = true;
  let activeRequests = 0;
  let shutdownPromise: Promise<void> | undefined;
  const shutdownController = new AbortController();
  const drainedWaiters = new Set<() => void>();

  function notifyIfDrained(): void {
    if (activeRequests !== 0) {
      return;
    }
    for (const resolve of drainedWaiters) {
      resolve();
    }
    drainedWaiters.clear();
  }

  async function drainToDeadline(): Promise<boolean> {
    if (activeRequests === 0) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (drained: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        drainedWaiters.delete(onDrained);
        resolve(drained);
      };
      const onDrained = () => {
        finish(true);
      };
      const timer = setTimeout(() => {
        finish(false);
      }, options.drainTimeoutMs);
      timer.unref();
      drainedWaiters.add(onDrained);
    });
  }

  async function performShutdown(stoppingHttp: Promise<void>): Promise<void> {
    const drained = await drainToDeadline();
    if (!drained) {
      shutdownController.abort();
    }

    const cleanup = [stoppingHttp, attempt(options.closeHttp)];
    const quotaClient = options.quotaClient;
    if (quotaClient !== undefined) {
      cleanup.push(attempt(quotaClient.close));
    }
    await settleCleanup(cleanup, options.drainTimeoutMs);
  }

  return {
    async handle(request) {
      if (!accepting) {
        return unavailableResponse();
      }

      const signal = AbortSignal.any([
        request.signal,
        shutdownController.signal,
      ]);
      const lifecycleRequest = new Request(request, { signal });
      activeRequests += 1;
      try {
        return await options.handler.handle(lifecycleRequest);
      } finally {
        activeRequests -= 1;
        notifyIfDrained();
      }
    },
    shutdown() {
      if (shutdownPromise !== undefined) {
        return shutdownPromise;
      }

      accepting = false;
      options.readiness.markNotReady();
      const stoppingHttp = attempt(options.stopHttpAcceptance);
      shutdownPromise = performShutdown(stoppingHttp);
      return shutdownPromise;
    },
  };
}
