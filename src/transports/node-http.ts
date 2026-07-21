import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import type { HttpRequestHandler } from "./health.js";

export interface StartNodeHttpServerOptions {
  readonly handler: HttpRequestHandler;
  readonly hostname: string;
  readonly port: number;
  readonly publicOrigin: URL;
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

function incomingBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.on("data", (chunk: Buffer) => {
        controller.enqueue(chunk);
      });
      incoming.on("end", () => {
        controller.close();
      });
      incoming.on("error", (error) => {
        controller.error(error);
      });
    },
    cancel() {
      incoming.destroy();
    },
  });
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
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      try {
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
        const init: RequestInitWithDuplex = {
          ...(method === "GET" || method === "HEAD"
            ? {}
            : { body: incomingBody(incoming) }),
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
        if (!outgoing.headersSent) {
          outgoing.statusCode = 500;
        }
        outgoing.end();
      }
    })();
  });

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
