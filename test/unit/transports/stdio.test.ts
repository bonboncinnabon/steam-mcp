import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { startStdioServer } from "../../../src/transports/stdio.js";

describe("stdio transport lifecycle", () => {
  it("connects once and closes idempotently while removing signal listeners", async () => {
    const signals = new EventEmitter();
    const server = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      server: {},
    };
    const transport = {
      start: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    };

    const running = await startStdioServer({ server, transport, signals });
    await Promise.all([running.stop(), running.stop()]);

    expect(server.connect).toHaveBeenCalledOnce();
    expect(server.connect).toHaveBeenCalledWith(transport);
    expect(server.close).toHaveBeenCalledOnce();
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("reports protocol errors with a fixed redacted diagnostic", async () => {
    const diagnostics: string[] = [];
    const server = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      server: {} as { onerror?: (error: Error) => void },
    };
    const running = await startStdioServer({
      server,
      transport: { start: vi.fn(), send: vi.fn(), close: vi.fn() },
      signals: new EventEmitter(),
      writeDiagnostic: (message) => diagnostics.push(message),
    });

    server.server.onerror?.(new Error("secret-key-and-url"));
    await running.stop();

    expect(diagnostics).toEqual(["steam-mcp: protocol error\n"]);
    expect(diagnostics.join("")).not.toContain("secret-key-and-url");
  });

  it("shuts down when the process emits a termination signal", async () => {
    const signals = new EventEmitter();
    const close = vi.fn().mockResolvedValue(undefined);
    const running = await startStdioServer({
      server: {
        connect: vi.fn().mockResolvedValue(undefined),
        close,
        server: {},
      },
      transport: { start: vi.fn(), send: vi.fn(), close: vi.fn() },
      signals,
    });

    signals.emit("SIGTERM");

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
    await running.stop();
  });

  it("removes signal listeners when connection fails", async () => {
    const signals = new EventEmitter();

    await expect(
      startStdioServer({
        server: {
          connect: vi.fn().mockRejectedValue(new Error("connection failed")),
          close: vi.fn(),
          server: {},
        },
        transport: { start: vi.fn(), send: vi.fn(), close: vi.fn() },
        signals,
      }),
    ).rejects.toThrow("connection failed");
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("writes redacted diagnostics to stderr by default", async () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const server = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      server: {} as { onerror?: (error: Error) => void },
    };
    const running = await startStdioServer({
      server,
      transport: { start: vi.fn(), send: vi.fn(), close: vi.fn() },
      signals: new EventEmitter(),
    });

    server.server.onerror?.(new Error("credential-bearing-url"));
    await running.stop();

    expect(write).toHaveBeenCalledWith("steam-mcp: protocol error\n");
  });
});
