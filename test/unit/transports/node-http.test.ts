import { request as nodeRequest, type IncomingHttpHeaders } from "node:http";
import { connect, type Socket } from "node:net";

import { describe, expect, it, vi } from "vitest";

import { startNodeHttpServer } from "../../../src/transports/node-http.js";

interface ClientRequestOptions {
  readonly body?: string;
  readonly bodyChunks?: readonly string[];
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
    for (const chunk of options.bodyChunks ?? []) {
      request.write(chunk);
    }
    request.end(options.body);
  });
}

function openSocket(url: URL): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

function readSocketToClose(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("error", reject);
    socket.once("close", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

describe("Node HTTP adapter", () => {
  it("starts on an ephemeral port and delegates requests", async () => {
    const handler = { handle: vi.fn().mockResolvedValue(new Response("ok")) };
    const server = await startNodeHttpServer({
      handler,
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
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
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
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
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
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
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
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

  it("rejects a declared oversized body without invoking the handler", async () => {
    const handler = {
      handle: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    };
    const server = await startNodeHttpServer({
      handler,
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 4,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
    });

    try {
      const response = await send(server.origin, {
        body: "12345",
        headers: { "content-length": "5" },
        method: "POST",
      });

      expect({
        handlerCalls: handler.handle.mock.calls.length,
        status: response.status,
      }).toEqual({ handlerCalls: 0, status: 413 });
    } finally {
      await server.close();
    }
  });

  it("rejects a streamed oversized body without invoking the handler", async () => {
    const handler = {
      handle: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    };
    const server = await startNodeHttpServer({
      handler,
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 4,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
    });

    try {
      const response = await send(server.origin, {
        bodyChunks: ["123", "45"],
        method: "POST",
      });

      expect({
        handlerCalls: handler.handle.mock.calls.length,
        status: response.status,
      }).toEqual({ handlerCalls: 0, status: 413 });
    } finally {
      await server.close();
    }
  });

  it("times out incomplete request headers without invoking the handler", async () => {
    const handler = {
      handle: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    };
    const server = await startNodeHttpServer({
      handler,
      headersTimeoutMs: 25,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 1_000,
    });

    try {
      const socket = await openSocket(server.origin);
      const response = await readSocketToClose(socket);

      expect({
        handlerCalls: handler.handle.mock.calls.length,
        statusLine: response.split("\r\n")[0],
      }).toEqual({
        handlerCalls: 0,
        statusLine: "HTTP/1.1 408 Request Timeout",
      });
    } finally {
      await server.close();
    }
  });

  it("times out an incomplete request body without invoking the handler", async () => {
    const handler = {
      handle: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    };
    const server = await startNodeHttpServer({
      handler,
      headersTimeoutMs: 25,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 25,
    });

    try {
      const socket = await openSocket(server.origin);
      socket.write(
        "POST /mcp HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\n\r\n123",
      );
      const response = await readSocketToClose(socket);

      expect({
        handlerCalls: handler.handle.mock.calls.length,
        statusLine: response.split("\r\n")[0],
      }).toEqual({
        handlerCalls: 0,
        statusLine: "HTTP/1.1 408 Request Timeout",
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
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
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

  it("reports a fixed category when request handling fails", async () => {
    const diagnostics: string[] = [];
    const server = await startNodeHttpServer({
      handler: {
        handle: vi
          .fn()
          .mockRejectedValue(new Error("private request and credential data")),
      },
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      reportDiagnostic: (category) => diagnostics.push(category),
      requestTimeoutMs: 30_000,
    });

    try {
      const response = await send(server.origin);

      expect(response.status).toBe(500);
      expect(response.body).not.toContain("private request");
      expect(diagnostics).toEqual(["request_failed"]);
    } finally {
      await server.close();
    }
  });

  it("makes graceful stop and forced close idempotent", async () => {
    const first = await startNodeHttpServer({
      handler: { handle: vi.fn().mockResolvedValue(new Response()) },
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
    });
    const second = await startNodeHttpServer({
      handler: { handle: vi.fn().mockResolvedValue(new Response()) },
      headersTimeoutMs: 15_000,
      hostname: "127.0.0.1",
      maxRequestBytes: 1_048_576,
      port: 0,
      publicOrigin: new URL("https://steam.example"),
      requestTimeoutMs: 30_000,
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
