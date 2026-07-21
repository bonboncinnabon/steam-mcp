import { describe, expect, it, vi } from "vitest";

import { failure, success } from "../../../src/domain/result.js";
import { createMcpToolHandler } from "../../../src/mcp/tool-adapter.js";
import { SteamUpstreamError } from "../../../src/steam/http/steam-retry-policy.js";

describe("MCP tool adapter", () => {
  it("returns concise text and the exact structured success result", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue(success({ totalCount: 1 }, ["supported"]));
    const handler = createMcpToolHandler({
      execute,
      renderSuccess: (data: { readonly totalCount: number }) =>
        `Found ${String(data.totalCount)} item.`,
    });
    const signal = new AbortController().signal;

    await expect(handler({ limit: 1 }, { signal })).resolves.toEqual({
      content: [{ type: "text", text: "Found 1 item." }],
      structuredContent: success({ totalCount: 1 }, ["supported"]),
    });
    expect(execute).toHaveBeenCalledWith({ limit: 1 }, signal);
  });

  it("maps an expected service failure to an MCP tool error", async () => {
    const result = failure(
      "PROFILE_PRIVATE",
      "This Steam profile is private.",
      false,
    );
    const handler = createMcpToolHandler({
      execute: vi.fn().mockResolvedValue(result),
      renderSuccess: () => "unused",
    });

    await expect(
      handler({}, { signal: new AbortController().signal }),
    ).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: "This Steam profile is private." }],
      structuredContent: result,
    });
  });

  it("sanitizes an unexpected exception as a stable internal error", async () => {
    const handler = createMcpToolHandler({
      execute: vi
        .fn()
        .mockRejectedValue(new Error("secret upstream implementation detail")),
      renderSuccess: () => "unused",
    });

    const result = await handler(
      { user: "agent" },
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "The Steam tool could not complete." }],
      structuredContent: failure(
        "INTERNAL_ERROR",
        "The Steam tool could not complete.",
        false,
      ),
    });
    expect(JSON.stringify(result)).not.toContain("secret upstream");
  });

  it("sanitizes an unexpected success-rendering exception", async () => {
    const handler = createMcpToolHandler({
      execute: vi.fn().mockResolvedValue(success({ value: 1 }, ["supported"])),
      renderSuccess: () => {
        throw new Error("private renderer detail");
      },
    });

    await expect(
      handler({}, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      },
    });
  });

  it("maps a typed Steam upstream exception to its stable public error", async () => {
    const handler = createMcpToolHandler({
      execute: vi.fn().mockRejectedValue(
        new SteamUpstreamError({
          code: "STEAM_AUTH_FAILED",
          retryable: false,
        }),
      ),
      renderSuccess: () => "unused",
    });

    await expect(
      handler({}, { signal: new AbortController().signal }),
    ).resolves.toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Steam authentication failed. Local users should set STEAM_API_KEY; hosted users should contact the server operator.",
        },
      ],
      structuredContent: failure(
        "STEAM_AUTH_FAILED",
        "Steam authentication failed. Local users should set STEAM_API_KEY; hosted users should contact the server operator.",
        false,
      ),
    });
  });

  it("guides missing identity callers without suggesting account linking", async () => {
    const handler = createMcpToolHandler({
      execute: vi.fn().mockRejectedValue({
        code: "IDENTITY_NOT_LINKED",
        retryable: false,
      }),
      renderSuccess: () => "unused",
    });

    await expect(
      handler({}, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      content: [{ text: "Provide a Steam user for this request." }],
      structuredContent: {
        error: {
          code: "IDENTITY_NOT_LINKED",
          message: "Provide a Steam user for this request.",
        },
      },
    });
  });
});
