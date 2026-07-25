import { describe, expect, it, vi } from "vitest";

import { runSteamMcpCli } from "../../../src/cli/steam-mcp-cli.js";

describe("steam-mcp CLI", () => {
  it("starts stdio when invoked without arguments", async () => {
    const startStdio = vi.fn().mockResolvedValue(undefined);
    const startHttp = vi.fn().mockResolvedValue(undefined);

    await expect(
      runSteamMcpCli([], {
        startStdio,
        startHttp,
        writeDiagnostic: vi.fn(),
      }),
    ).resolves.toBe(0);

    expect(startStdio).toHaveBeenCalledOnce();
    expect(startHttp).not.toHaveBeenCalled();
  });

  it("starts HTTP when invoked with the serve subcommand", async () => {
    const startStdio = vi.fn().mockResolvedValue(undefined);
    const startHttp = vi.fn().mockResolvedValue(undefined);

    await expect(
      runSteamMcpCli(["serve"], {
        startStdio,
        startHttp,
        writeDiagnostic: vi.fn(),
      }),
    ).resolves.toBe(0);

    expect(startHttp).toHaveBeenCalledOnce();
    expect(startStdio).not.toHaveBeenCalled();
  });

  it("rejects unsupported arguments with usage on stderr", async () => {
    const startStdio = vi.fn().mockResolvedValue(undefined);
    const startHttp = vi.fn().mockResolvedValue(undefined);
    const writeDiagnostic = vi.fn();

    await expect(
      runSteamMcpCli(["hosted"], {
        startStdio,
        startHttp,
        writeDiagnostic,
      }),
    ).resolves.toBe(1);

    expect(startStdio).not.toHaveBeenCalled();
    expect(startHttp).not.toHaveBeenCalled();
    expect(writeDiagnostic).toHaveBeenCalledWith("Usage: steam-mcp [serve]\n");
  });

  it("reports a sanitized stdio startup failure", async () => {
    const writeDiagnostic = vi.fn();

    await expect(
      runSteamMcpCli([], {
        startStdio: vi
          .fn()
          .mockRejectedValue(new Error("secret configuration value")),
        startHttp: vi.fn().mockResolvedValue(undefined),
        writeDiagnostic,
      }),
    ).resolves.toBe(1);

    expect(writeDiagnostic).toHaveBeenCalledWith(
      "steam-mcp: stdio startup failed; check configuration\n",
    );
    expect(JSON.stringify(writeDiagnostic.mock.calls)).not.toContain("secret");
  });

  it("reports a sanitized hosted startup failure", async () => {
    const writeDiagnostic = vi.fn();

    await expect(
      runSteamMcpCli(["serve"], {
        startStdio: vi.fn().mockResolvedValue(undefined),
        startHttp: vi
          .fn()
          .mockRejectedValue(new Error("secret hosted configuration")),
        writeDiagnostic,
      }),
    ).resolves.toBe(1);

    expect(writeDiagnostic).toHaveBeenCalledWith(
      "steam-mcp: hosted startup failed; check hosted configuration\n",
    );
    expect(JSON.stringify(writeDiagnostic.mock.calls)).not.toContain("secret");
  });
});
