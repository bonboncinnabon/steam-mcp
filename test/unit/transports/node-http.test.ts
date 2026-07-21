import { request as nodeRequest, type IncomingHttpHeaders } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { startNodeHttpServer } from "../../../src/transports/node-http.js";

interface ClientRequestOptions {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: string;
}

function send(
  url: URL,
  options: ClientRequestOptions = {},
): Promise<{
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly status: number;
}> {
  return new Promise((resolve, reject) => {
    const request = nodeRequest(
      url,
      { headers: options.headers, method: options.method },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

describe("Node HTTP adapter", () => {
  it("starts on an ephemeral port and delegates requests", async () => {
    const handler = { handle: vi.fn().mockResolvedValue(new Response("ok")) };
    const server = await startNodeHttpServer({
      handler,
      hostname: "127.0.0.1",
      port: 0,
      publicOrigin: new URL("https://steam.example"),
    });

    try {
      const response = await send(new URL("/livez", server.origin));
      expect({ body: response.body, status: response.status }).toEqual({
        body: "ok",
        status: 200,
      });
      expect(handler.handle).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });

  it("translates response status, headers, and body", async () => {
    const server = await startNodeHttpServer({
      handler: {
        handle: vi.fn().mockResolvedValue(
          new Response("accepted", {
            headers: {
              "cache-control": "no-store",
              "content-type": "text/plain;charset=UTF-8",
              "x-request-id": "request-1",
            },
            status: 202,
          }),
        ),
      },
      hostname: "127.0.0.1",
      port: 0,
      publicOrigin: new URL("https://steam.example"),
    });

    try {
      const response = await send(server.origin);

      expect({
        body: response.body,
        cacheControl: response.headers["cache-control"],
        contentType: response.headers["content-type"],
        requestId: response.headers["x-request-id"],
        status: response.status,
      }).toEqual({
        body: "accepted",
        cacheControl: "no-store",
        contentType: "text/plain;charset=UTF-8",
        requestId: "request-1",
        status: 202,
      });
    } finally {
      await server.close();
    }
  });

  it("streams response body chunks without waiting for completion", async () => {
    const encoder = new TextEncoder();
    let finishBody: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("first"));
        finishBody = () => {
          controller.enqueue(encoder.encode("second"));
          controller.close();
        };
      },
    });
    const server = await startNodeHttpServer({
      handler: { handle: vi.fn().mockResolvedValue(new Response(body)) },
      hostname: "127.0.0.1",
      port: 0,
      publicOrigin: new URL("https://steam.example"),
    });

    try {
      const completed = new Promise<void>((resolve, reject) => {
        const request = nodeRequest(server.origin, (response) => {
          response.once("data", (chunk: Buffer) => {
            expect(chunk.toString("utf8")).toBe("first");
            const finish = finishBody;
            finishBody = undefined;
            finish?.();
          });
          response.once("end", resolve);
        });
        request.once("error", reject);
        request.end();
      });

      await expect(completed).resolves.toBeUndefined();
    } finally {
      finishBody?.();
      await server.close();
    }
  });

  it("preserves method, public URL, headers, and body", async () => {
    let received: Request | undefined;
    const server = await startNodeHttpServer({
      handler: {
        handle(request) {
          received = request;
          return Promise.resolve(new Response(null, { status: 204 }));
        },
      },
      hostname: "127.0.0.1",
      port: 0,
      publicOrigin: new URL("https://steam.example"),
    });

    try {
      await send(new URL("/mcp?session=abc", server.origin), {
        body: '{"jsonrpc":"2.0"}',
        headers: {
          authorization: "Bearer opaque",
          "content-type": "application/json",
          host: "public.example:8443",
        },
        method: "POST",
      });

      expect({
        authorization: received?.headers.get("authorization"),
        body: await received?.text(),
        contentType: received?.headers.get("content-type"),
        host: received?.headers.get("host"),
        method: received?.method,
        url: received?.url,
      }).toEqual({
        authorization: "Bearer opaque",
        body: '{"jsonrpc":"2.0"}',
        contentType: "application/json",
        host: "public.example:8443",
        method: "POST",
        url: "https://steam.example/mcp?session=abc",
      });
    } finally {
      await server.close();
    }
  });

  it("aborts the web request when the client disconnects", async () => {
    let signal: AbortSignal | undefined;
    const handler = {
      handle: vi.fn((request: Request) => {
        signal = request.signal;
        return new Promise<Response>((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              resolve(new Response(null, { status: 499 }));
            },
            { once: true },
          );
        });
      }),
    };
    const server = await startNodeHttpServer({
      handler,
      hostname: "127.0.0.1",
      port: 0,
      publicOrigin: new URL("https://steam.example"),
    });

    try {
      const request = nodeRequest(new URL("/mcp", server.origin));
      request.on("error", () => {
        // Expected when the client deliberately disconnects.
      });
      request.end();
      await vi.waitFor(() => {
        expect(handler.handle).toHaveBeenCalledOnce();
      });

      request.destroy();

      await vi.waitFor(() => {
        expect(signal?.aborted).toBe(true);
      });
    } finally {
      await server.close();
    }
  });

  it("makes graceful stop and forced close idempotent", async () => {
    const first = await startNodeHttpServer({
      handler: { handle: vi.fn().mockResolvedValue(new Response()) },
      hostname: "127.0.0.1",
      port: 0,
      publicOrigin: new URL("https://steam.example"),
    });
    const second = await startNodeHttpServer({
      handler: { handle: vi.fn().mockResolvedValue(new Response()) },
      hostname: "127.0.0.1",
      port: 0,
      publicOrigin: new URL("https://steam.example"),
    });

    const firstStop = first.stop();
    const secondClose = second.close();

    expect({
      close: second.close() === secondClose,
      stop: first.stop() === firstStop,
    }).toEqual({ close: true, stop: true });
    await Promise.all([firstStop, secondClose]);
  });
});
