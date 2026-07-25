import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  createRemoteBearerGate,
  type RemoteBearerGate,
} from "../infrastructure/remote-bearer-gate.js";

export interface HostedMcpHttpHandlerOptions {
  readonly resourceUri: string;
  readonly accessToken: string;
  readonly createServer: () => McpServer;
  readonly maxActiveRequests?: number;
}

export interface HostedMcpHttpHandler {
  handle(request: Request): Promise<Response>;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Readonly<Record<string, string>>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      ...headers,
    },
  });
}

function authenticationResponse(response: {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}): Response {
  return jsonResponse(response.status, response.body, response.headers);
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers?: Readonly<Record<string, string>>,
): Response {
  return jsonResponse(
    status,
    {
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    },
    headers,
  );
}

function withoutAuthorization(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  return new Request(request, { headers, signal: request.signal });
}

async function handleAuthorizedRequest(
  request: Request,
  createServer: HostedMcpHttpHandlerOptions["createServer"],
): Promise<Response> {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      await transport.close();
      await server.close();
    })();
    return closing;
  };
  let resolveCancellation: ((response: Response) => void) | undefined;
  const cancellation = new Promise<Response>((resolve) => {
    resolveCancellation = resolve;
  });
  const cancel = () => {
    void close();
    resolveCancellation?.(jsonRpcError(499, -32_800, "Request cancelled"));
  };

  if (request.signal.aborted) {
    await close();
    return jsonRpcError(499, -32_800, "Request cancelled");
  }

  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    await server.connect(transport);
    return await Promise.race([
      transport.handleRequest(withoutAuthorization(request)),
      cancellation,
    ]);
  } catch {
    return jsonRpcError(500, -32_603, "Internal server error");
  } finally {
    request.signal.removeEventListener("abort", cancel);
    await close();
  }
}

async function authorize(
  gate: RemoteBearerGate,
  request: Request,
  createServer: HostedMcpHttpHandlerOptions["createServer"],
): Promise<Response> {
  const authorizationHeader = request.headers.get("authorization");
  const rejection = gate.authenticate(authorizationHeader ?? undefined);
  return rejection === undefined
    ? handleAuthorizedRequest(request, createServer)
    : authenticationResponse(rejection);
}

export function createHostedMcpHttpHandler(
  options: HostedMcpHttpHandlerOptions,
): HostedMcpHttpHandler {
  const maxActiveRequests = options.maxActiveRequests ?? 64;
  if (
    !Number.isSafeInteger(maxActiveRequests) ||
    maxActiveRequests <= 0 ||
    maxActiveRequests > 1_024
  ) {
    throw new RangeError("maxActiveRequests is outside the supported range");
  }
  const gate = createRemoteBearerGate({ accessToken: options.accessToken });
  let inFlightRequests = 0;

  return {
    async handle(request) {
      if (request.url !== options.resourceUri) {
        return jsonRpcError(404, -32_001, "Not found");
      }

      if (request.method !== "POST") {
        return jsonRpcError(405, -32_000, "Method not allowed", {
          allow: "POST",
        });
      }

      if (inFlightRequests >= maxActiveRequests) {
        return jsonRpcError(429, -32_029, "Too many active requests", {
          "retry-after": "1",
        });
      }
      inFlightRequests += 1;
      try {
        return await authorize(gate, request, options.createServer);
      } finally {
        inFlightRequests -= 1;
      }
    },
  };
}
