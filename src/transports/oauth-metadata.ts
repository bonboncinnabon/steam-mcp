import {
  createProtectedResourceMetadataResponse,
  protectedResourceMetadataUrl,
  type OAuthResourceOptions,
} from "../infrastructure/oauth-resource.js";
import type { HttpRequestHandler } from "./health.js";

export interface OptionalHttpRequestHandler {
  handle(request: Request): Promise<Response | undefined>;
}

export function createOAuthMetadataHttpHandler(
  resource: OAuthResourceOptions,
): OptionalHttpRequestHandler {
  const metadataUrl = protectedResourceMetadataUrl(resource.resourceUri);
  const metadata = createProtectedResourceMetadataResponse(resource);

  return {
    handle(request) {
      if (request.url !== metadataUrl) {
        return Promise.resolve(undefined);
      }
      if (request.method !== "GET") {
        return Promise.resolve(
          new Response(null, {
            status: 405,
            headers: { allow: "GET", "cache-control": "no-store" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(metadata.body), {
          status: metadata.status,
          headers: metadata.headers,
        }),
      );
    },
  };
}

export function createHostedDiscoveryRouter(options: {
  readonly metadata: OptionalHttpRequestHandler;
  readonly next: HttpRequestHandler;
}): HttpRequestHandler {
  return {
    async handle(request) {
      return (
        (await options.metadata.handle(request)) ?? options.next.handle(request)
      );
    },
  };
}
