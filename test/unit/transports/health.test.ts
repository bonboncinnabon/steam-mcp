import { describe, expect, it, vi } from "vitest";

import {
  createHealthHttpHandler,
  createHostedHttpRouter,
  type ReadinessDependency,
} from "../../../src/transports/health.js";

const baseUri = "https://steam.example";

function dependency(result: boolean): ReadinessDependency {
  return { isReady: vi.fn().mockResolvedValue(result) };
}

describe("createHealthHttpHandler", () => {
  it("is ready without an external authentication dependency", async () => {
    const handler = createHealthHttpHandler({});

    const response = await handler.handle(new Request(`${baseUri}/readyz`));

    expect(response?.status).toBe(200);
  });

  it("reports liveness without probing authorization or quota", async () => {
    const authorization = dependency(false);
    const quota = dependency(false);
    const handler = createHealthHttpHandler({
      dependencies: [authorization, quota],
    });

    const response = await handler.handle(new Request(`${baseUri}/livez`));

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ status: "live" });
    expect(authorization.isReady).not.toHaveBeenCalled();
    expect(quota.isReady).not.toHaveBeenCalled();
  });

  it("reports ready when every required dependency is available", async () => {
    const authorization = dependency(true);
    const quota = dependency(true);
    const handler = createHealthHttpHandler({
      dependencies: [authorization, quota],
    });
    const request = new Request(`${baseUri}/readyz`);

    const response = await handler.handle(request);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ status: "ready" });
    expect(authorization.isReady).toHaveBeenCalledWith(request.signal);
    expect(quota.isReady).toHaveBeenCalledWith(request.signal);
  });

  it("does not require an unconfigured external quota dependency", async () => {
    const handler = createHealthHttpHandler({
      dependencies: [dependency(true)],
    });

    const response = await handler.handle(new Request(`${baseUri}/readyz`));

    expect(response?.status).toBe(200);
  });

  it.each([
    ["authorization is unavailable", dependency(false), dependency(true)],
    ["quota is unavailable", dependency(true), dependency(false)],
  ])("reports not ready when %s", async (_name, authorization, quota) => {
    const handler = createHealthHttpHandler({
      dependencies: [authorization, quota],
    });

    const response = await handler.handle(new Request(`${baseUri}/readyz`));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ status: "not_ready" });
  });

  it("sanitizes dependency failures", async () => {
    const authorization: ReadinessDependency = {
      isReady: vi.fn().mockRejectedValue(new Error("private provider detail")),
    };
    const handler = createHealthHttpHandler({ dependencies: [authorization] });

    const response = await handler.handle(new Request(`${baseUri}/readyz`));
    const body = await response?.text();

    expect(response?.status).toBe(503);
    expect(body).toBe('{"status":"not_ready"}');
    expect(body).not.toContain("private provider detail");
  });

  it("marks readiness false without probing dependencies again", async () => {
    const authorization = dependency(true);
    const quota = dependency(true);
    const handler = createHealthHttpHandler({
      dependencies: [authorization, quota],
    });

    handler.markNotReady();
    const response = await handler.handle(new Request(`${baseUri}/readyz`));

    expect(response?.status).toBe(503);
    expect(authorization.isReady).not.toHaveBeenCalled();
    expect(quota.isReady).not.toHaveBeenCalled();
  });

  it.each(["/livez", "/readyz"])("allows only GET for %s", async (pathname) => {
    const authorization = dependency(true);
    const handler = createHealthHttpHandler({ dependencies: [authorization] });

    const response = await handler.handle(
      new Request(`${baseUri}${pathname}`, { method: "POST" }),
    );

    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("GET");
    expect(authorization.isReady).not.toHaveBeenCalled();
  });

  it("leaves unrelated routes to the hosted MCP router", async () => {
    const handler = createHealthHttpHandler({
      dependencies: [dependency(true)],
    });

    await expect(
      handler.handle(new Request(`${baseUri}/mcp`)),
    ).resolves.toBeUndefined();
  });

  it("uses fixed no-store JSON responses", async () => {
    const handler = createHealthHttpHandler({
      dependencies: [dependency(true)],
    });

    const response = await handler.handle(new Request(`${baseUri}/livez`));

    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("content-type")).toContain("application/json");
  });

  it("exposes health routes separately and delegates all other traffic", async () => {
    const mcpResponse = new Response("mcp");
    const mcp = { handle: vi.fn().mockResolvedValue(mcpResponse) };
    const health = createHealthHttpHandler({
      dependencies: [dependency(true)],
    });
    const router = createHostedHttpRouter({ health, mcp });
    const healthRequest = new Request(`${baseUri}/livez`);
    const mcpRequest = new Request(`${baseUri}/mcp`);

    await expect(router.handle(healthRequest)).resolves.toMatchObject({
      status: 200,
    });
    await expect(router.handle(mcpRequest)).resolves.toBe(mcpResponse);
    expect(mcp.handle).toHaveBeenCalledOnce();
    expect(mcp.handle).toHaveBeenCalledWith(mcpRequest);
  });
});
