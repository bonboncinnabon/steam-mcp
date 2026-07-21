import { createHash } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AuthorizationContext } from "../application/ports/authorization.js";
import {
  createHttpRequestBoundary,
  type HttpRequestBoundaryOptions,
} from "../infrastructure/http-request-boundary.js";
import {
  createHostedAuthorizationGate,
  type HostedAuthorizationGate,
} from "../infrastructure/hosted-authorization-gate.js";
import type { AccessTokenValidator } from "../infrastructure/oauth-token-validator.js";
import type {
  OAuthHttpResponse,
  OAuthResourceOptions,
} from "../infrastructure/oauth-resource.js";

export interface HostedMcpHttpHandlerOptions extends HttpRequestBoundaryOptions {
  readonly resource: OAuthResourceOptions;
  readonly validator: AccessTokenValidator;
  readonly createServer: (context: AuthorizationContext) => McpServer;
  readonly maxActiveRequests?: number;
}

type JsonRpcRequestId = number | string;

interface McpMessageControl {
  readonly requestId?: JsonRpcRequestId;
  readonly cancellationId?: JsonRpcRequestId;
}

interface ActiveRequestRegistry {
  register(
    clientKey: string,
    requestId: JsonRpcRequestId,
    cancel: () => void,
  ): boolean;
  remove(
    clientKey: string,
    requestId: JsonRpcRequestId,
    cancel: () => void,
  ): void;
  cancel(clientKey: string, requestId: JsonRpcRequestId): void;
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

function oauthResponse(response: OAuthHttpResponse<unknown>): Response {
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

function activeRequestKey(clientKey: string, requestId: JsonRpcRequestId) {
  return `${clientKey}:${typeof requestId}:${String(requestId)}`;
}

function createActiveRequestRegistry(
  maxActiveRequests: number,
): ActiveRequestRegistry {
  const active = new Map<string, Set<() => void>>();
  let activeCount = 0;

  return {
    register(clientKey, requestId, cancel) {
      const key = activeRequestKey(clientKey, requestId);
      if (activeCount >= maxActiveRequests) {
        return false;
      }
      const requests = active.get(key) ?? new Set<() => void>();
      requests.add(cancel);
      active.set(key, requests);
      activeCount += 1;
      return true;
    },
    remove(clientKey, requestId, cancel) {
      const key = activeRequestKey(clientKey, requestId);
      const requests = active.get(key);
      if (requests?.delete(cancel) === true) {
        activeCount -= 1;
      }
      if (requests?.size === 0) {
        active.delete(key);
      }
    },
    cancel(clientKey, requestId) {
      const requests = active.get(activeRequestKey(clientKey, requestId)) ?? [];
      for (const cancel of [...requests]) {
        cancel();
      }
    },
  };
}

async function inspectMcpMessage(request: Request): Promise<McpMessageControl> {
  try {
    const body: unknown = await request.clone().json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return {};
    }

    const message = body as Record<string, unknown>;
    const id = message["id"];
    const method = message["method"];
    if (
      method === "notifications/cancelled" &&
      typeof message["params"] === "object" &&
      message["params"] !== null
    ) {
      const cancellationId = (message["params"] as Record<string, unknown>)[
        "requestId"
      ];
      return typeof cancellationId === "string" ||
        typeof cancellationId === "number"
        ? { cancellationId }
        : {};
    }

    return typeof id === "string" || typeof id === "number"
      ? { requestId: id }
      : {};
  } catch {
    return {};
  }
}

function opaqueClientKey(authorizationHeader: string): string {
  return createHash("sha256").update(authorizationHeader).digest("base64url");
}

async function handleAuthorizedRequest(
  request: Request,
  context: AuthorizationContext,
  createServer: HostedMcpHttpHandlerOptions["createServer"],
  activeRequests: ActiveRequestRegistry,
  clientKey: string,
  requestId: JsonRpcRequestId | undefined,
): Promise<Response> {
  const server = createServer(context);
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

  if (
    requestId !== undefined &&
    !activeRequests.register(clientKey, requestId, cancel)
  ) {
    await close();
    return jsonRpcError(429, -32_029, "Too many active requests", {
      "retry-after": "1",
    });
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
    if (requestId !== undefined) {
      activeRequests.remove(clientKey, requestId, cancel);
    }
    await close();
  }
}

async function authorize(
  gate: HostedAuthorizationGate,
  request: Request,
  createServer: HostedMcpHttpHandlerOptions["createServer"],
  activeRequests: ActiveRequestRegistry,
  inspectedControl?: McpMessageControl,
): Promise<Response> {
  const authorizationHeader = request.headers.get("authorization");
  const result = await gate.run({
    ...(authorizationHeader === null ? {} : { authorizationHeader }),
    signal: request.signal,
    execute: async (context) => {
      const control = inspectedControl ?? (await inspectMcpMessage(request));
      const clientKey = opaqueClientKey(authorizationHeader ?? "");
      if (control.cancellationId !== undefined) {
        activeRequests.cancel(clientKey, control.cancellationId);
        return new Response(null, { status: 202 });
      }
      return handleAuthorizedRequest(
        request,
        context,
        createServer,
        activeRequests,
        clientKey,
        control.requestId,
      );
    },
  });

  return result.authorized ? result.value : oauthResponse(result.response);
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
  const activeRequests = createActiveRequestRegistry(maxActiveRequests);
  const requestBoundary = createHttpRequestBoundary(options);
  const gate = createHostedAuthorizationGate({
    resource: options.resource,
    validator: options.validator,
  });
  let inFlightRequests = 0;
  let inFlightCancellationRequests = 0;

  return {
    async handle(request) {
      const boundaryDecision = requestBoundary.check(request.headers);
      if (!boundaryDecision.allowed) {
        return jsonRpcError(
          boundaryDecision.reason === "malformed_host" ? 400 : 403,
          -32_000,
          "Request boundary rejected",
        );
      }

      if (request.url !== options.resource.resourceUri) {
        return jsonRpcError(404, -32_001, "Not found");
      }

      if (request.method !== "POST") {
        return jsonRpcError(405, -32_000, "Method not allowed", {
          allow: "POST",
        });
      }

      if (inFlightRequests >= maxActiveRequests) {
        if (inFlightCancellationRequests >= 1) {
          return jsonRpcError(429, -32_029, "Too many active requests", {
            "retry-after": "1",
          });
        }
        inFlightCancellationRequests += 1;
        try {
          const control = await inspectMcpMessage(request);
          if (control.cancellationId === undefined) {
            return jsonRpcError(429, -32_029, "Too many active requests", {
              "retry-after": "1",
            });
          }
          return await authorize(
            gate,
            request,
            options.createServer,
            activeRequests,
            control,
          );
        } finally {
          inFlightCancellationRequests -= 1;
        }
      }
      inFlightRequests += 1;
      try {
        return await authorize(
          gate,
          request,
          options.createServer,
          activeRequests,
        );
      } finally {
        inFlightRequests -= 1;
      }
    },
  };
}
