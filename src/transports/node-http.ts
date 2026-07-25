import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import type { HttpRequestHandler } from "./health.js";
import type { ReportHostedDiagnostic } from "./hosted-diagnostics.js";

export interface StartNodeHttpServerOptions {
  readonly handler: HttpRequestHandler;
  readonly headersTimeoutMs: number;
  readonly hostname: string;
  readonly maxRequestBytes: number;
  readonly port: number;
  readonly publicOrigin: URL;
  readonly reportDiagnostic?: ReportHostedDiagnostic;
  readonly requestTimeoutMs: number;
}

export interface RunningNodeHttpServer {
  readonly origin: URL;
  stop(): Promise<void>;
  close(): Promise<void>;
}

interface RequestInitWithDuplex extends RequestInit {
  readonly duplex: "half";
}

function incomingHeaders(rawHeaders: readonly string[]): Headers {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) {
      headers.append(name, value);
    }
  }
  return headers;
}

function hasDeclaredOversizedBody(
  incoming: IncomingMessage,
  maxRequestBytes: number,
): boolean {
  const contentLength = incoming.headers["content-length"];
  return contentLength !== undefined && Number(contentLength) > maxRequestBytes;
}

type IncomingBodyResult =
  | { readonly kind: "body"; readonly value: Buffer }
  | { readonly kind: "too_large" };

function readIncomingBody(
  incoming: IncomingMessage,
  maxRequestBytes: number,
): Promise<IncomingBodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    const cleanup = (): void => {
      incoming.off("data", onData);
      incoming.off("end", onEnd);
      incoming.off("error", onError);
    };
    const onData = (chunk: Buffer): void => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxRequestBytes) {
        cleanup();
        incoming.pause();
        resolve({ kind: "too_large" });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      cleanup();
      resolve({ kind: "body", value: Buffer.concat(chunks, receivedBytes) });
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    incoming.on("data", onData);
    incoming.once("end", onEnd);
    incoming.once("error", onError);
  });
}

function rejectPayloadTooLarge(outgoing: ServerResponse): void {
  outgoing.statusCode = 413;
  outgoing.setHeader("connection", "close");
  outgoing.end();
}

function waitForDrain(outgoing: ServerResponse): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      outgoing.off("close", onClose);
      outgoing.off("drain", onDrain);
      outgoing.off("error", onError);
    };
    const onClose = (): void => {
      cleanup();
      resolve(false);
    };
    const onDrain = (): void => {
      cleanup();
      resolve(true);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    outgoing.once("close", onClose);
    outgoing.once("drain", onDrain);
    outgoing.once("error", onError);
  });
}

async function writeResponseBody(
  response: Response,
  outgoing: ServerResponse,
): Promise<void> {
  if (response.body === null) {
    outgoing.end();
    return;
  }

  const reader = response.body.getReader();
  const cancelReader = (): void => {
    void reader.cancel().catch(() => {
      // A disconnected client cannot receive a body cancellation failure.
    });
  };
  outgoing.once("close", cancelReader);
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      if (!outgoing.write(chunk.value) && !(await waitForDrain(outgoing))) {
        return;
      }
      chunk = await reader.read();
    }
    outgoing.end();
  } finally {
    outgoing.off("close", cancelReader);
    reader.releaseLock();
  }
}

export async function startNodeHttpServer(
  options: StartNodeHttpServerOptions,
): Promise<RunningNodeHttpServer> {
  const server = createServer(
    {
      connectionsCheckingInterval: Math.min(
        options.headersTimeoutMs,
        options.requestTimeoutMs,
      ),
      headersTimeout: options.headersTimeoutMs,
      requestTimeout: options.requestTimeoutMs,
    },
    (incoming, outgoing) => {
      void (async () => {
        try {
          if (hasDeclaredOversizedBody(incoming, options.maxRequestBytes)) {
            incoming.pause();
            rejectPayloadTooLarge(outgoing);
            return;
          }
          const abortController = new AbortController();
          incoming.once("aborted", () => {
            abortController.abort();
          });
          outgoing.once("close", () => {
            if (!outgoing.writableFinished) {
              abortController.abort();
            }
          });
          const requestTarget = new URL(
            incoming.url ?? "/",
            "http://node.invalid",
          );
          const url = new URL(
            `${requestTarget.pathname}${requestTarget.search}`,
            options.publicOrigin,
          );
          const method = incoming.method ?? "GET";
          const body =
            method === "GET" || method === "HEAD"
              ? undefined
              : await readIncomingBody(incoming, options.maxRequestBytes);
          if (body?.kind === "too_large") {
            rejectPayloadTooLarge(outgoing);
            return;
          }
          const init: RequestInitWithDuplex = {
            ...(body === undefined ? {} : { body: body.value }),
            duplex: "half",
            headers: incomingHeaders(incoming.rawHeaders),
            method,
            signal: abortController.signal,
          };
          const request = new Request(url, init);
          const response = await options.handler.handle(request);
          outgoing.statusCode = response.status;
          for (const [name, value] of response.headers) {
            if (name !== "set-cookie") {
              outgoing.setHeader(name, value);
            }
          }
          const cookies = response.headers.getSetCookie();
          if (cookies.length > 0) {
            outgoing.setHeader("set-cookie", cookies);
          }
          await writeResponseBody(response, outgoing);
        } catch {
          options.reportDiagnostic?.("request_failed");
          if (!outgoing.headersSent) {
            outgoing.statusCode = 500;
          }
          outgoing.end();
        }
      })();
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP server did not bind to a TCP address");
  }
  const origin = new URL(`http://${options.hostname}:${String(address.port)}`);
  let stopPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    return stopPromise;
  };
  const close = (): Promise<void> => {
    closePromise ??= (() => {
      const stopping = stop();
      server.closeAllConnections();
      return stopping;
    })();
    return closePromise;
  };

  return {
    close,
    origin,
    stop,
  };
}
