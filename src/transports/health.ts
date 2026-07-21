export interface ReadinessDependency {
  readonly isReady: (signal: AbortSignal) => Promise<boolean>;
}

export interface HealthHttpHandlerOptions {
  readonly authorization: ReadinessDependency;
  readonly quota?: ReadinessDependency;
}

export interface HealthHttpHandler {
  handle(request: Request): Promise<Response | undefined>;
  markNotReady(): void;
}

export interface HttpRequestHandler {
  handle(request: Request): Promise<Response>;
}

function healthResponse(status: number, value: "live" | "ready" | "not_ready") {
  return new Response(JSON.stringify({ status: value }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
}

export function createHealthHttpHandler(
  options: HealthHttpHandlerOptions,
): HealthHttpHandler {
  let acceptingTraffic = true;

  return {
    async handle(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname !== "/livez" && pathname !== "/readyz") {
        return undefined;
      }

      if (request.method !== "GET") {
        return new Response(null, {
          status: 405,
          headers: { allow: "GET", "cache-control": "no-store" },
        });
      }

      if (pathname === "/livez") {
        return healthResponse(200, "live");
      }

      if (!acceptingTraffic) {
        return healthResponse(503, "not_ready");
      }

      try {
        const checks = [options.authorization.isReady(request.signal)];
        if (options.quota !== undefined) {
          checks.push(options.quota.isReady(request.signal));
        }
        const ready = (await Promise.all(checks)).every(Boolean);
        return ready
          ? healthResponse(200, "ready")
          : healthResponse(503, "not_ready");
      } catch {
        return healthResponse(503, "not_ready");
      }
    },
    markNotReady() {
      acceptingTraffic = false;
    },
  };
}

export function createHostedHttpRouter(options: {
  readonly health: HealthHttpHandler;
  readonly mcp: HttpRequestHandler;
}): HttpRequestHandler {
  return {
    async handle(request) {
      return (
        (await options.health.handle(request)) ?? options.mcp.handle(request)
      );
    },
  };
}
