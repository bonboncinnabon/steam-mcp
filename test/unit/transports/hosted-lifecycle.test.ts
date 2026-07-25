import { describe, expect, it, vi } from "vitest";

import {
  createHostedRequestLifecycle,
  type CloseableResource,
} from "../../../src/transports/hosted-lifecycle.js";
import {
  createHealthHttpHandler,
  createHostedHttpRouter,
} from "../../../src/transports/health.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function dependencies() {
  return {
    readiness: { markNotReady: vi.fn() },
    stopHttpAcceptance: vi.fn().mockResolvedValue(undefined),
    closeHttp: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createHostedRequestLifecycle", () => {
  it("marks readiness false synchronously and closes idle resources", async () => {
    const order: string[] = [];
    const readiness = { markNotReady: vi.fn(() => order.push("not-ready")) };
    const stopHttpAcceptance = vi.fn(() => {
      order.push("stop-http");
      return Promise.resolve();
    });
    const closeHttp = vi.fn(() => {
      order.push("close-http");
      return Promise.resolve();
    });
    const quotaClient: CloseableResource = {
      close: vi.fn(() => {
        order.push("close-quota");
        return Promise.resolve();
      }),
    };
    const lifecycle = createHostedRequestLifecycle({
      handler: { handle: vi.fn() },
      readiness,
      drainTimeoutMs: 100,
      stopHttpAcceptance,
      closeHttp,
      quotaClient,
    });

    const shutdown = lifecycle.shutdown();

    expect(readiness.markNotReady).toHaveBeenCalledOnce();
    await shutdown;
    expect(order[0]).toBe("not-ready");
    expect(stopHttpAcceptance).toHaveBeenCalledOnce();
    expect(closeHttp).toHaveBeenCalledOnce();
    expect(quotaClient.close).toHaveBeenCalledOnce();
  });

  it("rejects new work after shutdown begins without invoking MCP", async () => {
    const handler = { handle: vi.fn() };
    const lifecycle = createHostedRequestLifecycle({
      handler,
      drainTimeoutMs: 100,
      ...dependencies(),
    });

    const shutdown = lifecycle.shutdown();
    const response = await lifecycle.handle(
      new Request("https://steam.example/mcp"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "service_unavailable",
    });
    expect(handler.handle).not.toHaveBeenCalled();
    await shutdown;
  });

  it("lets active work drain before the deadline without aborting it", async () => {
    vi.useFakeTimers();
    try {
      const result = deferred<Response>();
      let observedSignal: AbortSignal | undefined;
      const handler = {
        handle: vi.fn((request: Request) => {
          observedSignal = request.signal;
          return result.promise;
        }),
      };
      const lifecycle = createHostedRequestLifecycle({
        handler,
        drainTimeoutMs: 1_000,
        ...dependencies(),
      });
      const active = lifecycle.handle(new Request("https://steam.example/mcp"));

      const shutdown = lifecycle.shutdown();
      result.resolve(new Response("done"));

      await expect(active).resolves.toMatchObject({ status: 200 });
      await shutdown;
      expect(observedSignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts remaining work when the drain deadline expires", async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      const handler = {
        handle: vi.fn((request: Request) => {
          observedSignal = request.signal;
          return new Promise<Response>(() => undefined);
        }),
      };
      const lifecycle = createHostedRequestLifecycle({
        handler,
        drainTimeoutMs: 50,
        ...dependencies(),
      });
      void lifecycle.handle(new Request("https://steam.example/mcp"));

      const shutdown = lifecycle.shutdown();
      await vi.advanceTimersByTimeAsync(50);
      await shutdown;

      expect(observedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("combines client cancellation with the lifecycle signal", async () => {
    const observed = deferred<AbortSignal>();
    const handler = {
      handle: vi.fn((request: Request) => {
        observed.resolve(request.signal);
        return Promise.resolve(new Response());
      }),
    };
    const lifecycle = createHostedRequestLifecycle({
      handler,
      drainTimeoutMs: 100,
      ...dependencies(),
    });
    const client = new AbortController();
    const request = new Request("https://steam.example/mcp", {
      signal: client.signal,
    });

    const handled = lifecycle.handle(request);
    const signal = await observed.promise;
    client.abort();

    expect(signal.aborted).toBe(true);
    await handled;
    await lifecycle.shutdown();
  });

  it("closes every resource even when another close operation fails", async () => {
    const diagnostics: string[] = [];
    const values = dependencies();
    values.stopHttpAcceptance.mockRejectedValue(
      new Error("private stop error"),
    );
    values.closeHttp.mockRejectedValue(new Error("private close error"));
    const quotaClient = {
      close: vi.fn().mockRejectedValue(new Error("private quota error")),
    };
    const lifecycle = createHostedRequestLifecycle({
      handler: { handle: vi.fn() },
      drainTimeoutMs: 100,
      quotaClient,
      reportDiagnostic: (category) => diagnostics.push(category),
      ...values,
    });

    await expect(lifecycle.shutdown()).resolves.toBeUndefined();

    expect(values.stopHttpAcceptance).toHaveBeenCalledOnce();
    expect(values.closeHttp).toHaveBeenCalledOnce();
    expect(quotaClient.close).toHaveBeenCalledOnce();
    expect(diagnostics).toEqual(["shutdown_cleanup_failed"]);
  });

  it("contains synchronous cleanup failures", async () => {
    const failingClose = () => {
      throw new Error("private synchronous error");
    };
    const closeHttp = vi.fn().mockResolvedValue(undefined);
    const quotaClient = { close: vi.fn().mockResolvedValue(undefined) };
    const lifecycle = createHostedRequestLifecycle({
      handler: { handle: vi.fn() },
      readiness: { markNotReady: vi.fn() },
      drainTimeoutMs: 100,
      stopHttpAcceptance: failingClose,
      closeHttp,
      quotaClient,
    });

    await expect(lifecycle.shutdown()).resolves.toBeUndefined();
    expect(closeHttp).toHaveBeenCalledOnce();
    expect(quotaClient.close).toHaveBeenCalledOnce();
  });

  it("waits for every active request before reporting a drain", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const handler = {
      handle: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    };
    const values = dependencies();
    const lifecycle = createHostedRequestLifecycle({
      handler,
      drainTimeoutMs: 1_000,
      ...values,
    });
    const firstRequest = lifecycle.handle(
      new Request("https://steam.example/mcp"),
    );
    const secondRequest = lifecycle.handle(
      new Request("https://steam.example/mcp"),
    );

    const shutdown = lifecycle.shutdown();
    first.resolve(new Response("first"));
    await firstRequest;
    expect(values.closeHttp).not.toHaveBeenCalled();

    second.resolve(new Response("second"));
    await secondRequest;
    await shutdown;
    expect(values.closeHttp).toHaveBeenCalledOnce();
  });

  it("releases failed requests from the active drain count", async () => {
    const lifecycle = createHostedRequestLifecycle({
      handler: {
        handle: vi.fn().mockRejectedValue(new Error("private handler error")),
      },
      drainTimeoutMs: 100,
      ...dependencies(),
    });

    await expect(
      lifecycle.handle(new Request("https://steam.example/mcp")),
    ).rejects.toThrow("private handler error");
    await expect(lifecycle.shutdown()).resolves.toBeUndefined();
  });

  it("shares one shutdown across concurrent and repeated callers", async () => {
    const values = dependencies();
    const lifecycle = createHostedRequestLifecycle({
      handler: { handle: vi.fn() },
      drainTimeoutMs: 100,
      ...values,
    });

    const first = lifecycle.shutdown();
    const second = lifecycle.shutdown();

    expect(second).toBe(first);
    await Promise.all([first, second, lifecycle.shutdown()]);
    expect(values.readiness.markNotReady).toHaveBeenCalledOnce();
    expect(values.stopHttpAcceptance).toHaveBeenCalledOnce();
    expect(values.closeHttp).toHaveBeenCalledOnce();
  });

  it("keeps liveness up while readiness and MCP admission are closed", async () => {
    const health = createHealthHttpHandler({
      dependencies: [{ isReady: vi.fn().mockResolvedValue(true) }],
    });
    const lifecycle = createHostedRequestLifecycle({
      handler: { handle: vi.fn().mockResolvedValue(new Response("mcp")) },
      readiness: health,
      drainTimeoutMs: 100,
      stopHttpAcceptance: vi.fn().mockResolvedValue(undefined),
      closeHttp: vi.fn().mockResolvedValue(undefined),
    });
    const app = createHostedHttpRouter({ health, mcp: lifecycle });

    await lifecycle.shutdown();

    await expect(
      app.handle(new Request("https://steam.example/livez")),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      app.handle(new Request("https://steam.example/readyz")),
    ).resolves.toMatchObject({ status: 503 });
    await expect(
      app.handle(new Request("https://steam.example/mcp")),
    ).resolves.toMatchObject({ status: 503 });
  });

  it("bounds cleanup even when resource close operations never settle", async () => {
    vi.useFakeTimers();
    try {
      const never = () => new Promise<void>(() => undefined);
      const lifecycle = createHostedRequestLifecycle({
        handler: { handle: vi.fn() },
        readiness: { markNotReady: vi.fn() },
        drainTimeoutMs: 50,
        stopHttpAcceptance: never,
        closeHttp: never,
        quotaClient: { close: never },
      });

      const shutdown = lifecycle.shutdown();
      let completed = false;
      void shutdown.then(() => {
        completed = true;
      });

      await vi.advanceTimersByTimeAsync(49);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(shutdown).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([0, -1, 60_001, 1.5])(
    "rejects unsupported drain deadline %s",
    (drainTimeoutMs) => {
      expect(() =>
        createHostedRequestLifecycle({
          handler: { handle: vi.fn() },
          drainTimeoutMs,
          ...dependencies(),
        }),
      ).toThrow("Invalid drain timeout");
    },
  );
});
