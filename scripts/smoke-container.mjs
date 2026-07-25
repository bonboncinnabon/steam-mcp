import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const [image, ...unexpectedArguments] = process.argv.slice(2);
if (image === undefined || unexpectedArguments.length > 0) {
  throw new Error("Usage: node scripts/smoke-container.mjs <image>");
}

const containerName = `steam-mcp-health-${String(process.pid)}`;
const accessToken = "ci-only-token-00000000000000000000";
const docker = (...args) =>
  spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

function initializeMcp(port) {
  return new Promise((resolvePromise, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "container-smoke", version: "1.0.0" },
      },
    });
    const outgoing = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${accessToken}`,
          "content-length": Buffer.byteLength(body),
          "content-type": "application/json",
          host: "localhost:3000",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolvePromise({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch {
            reject(new Error("Container MCP smoke returned invalid JSON"));
          }
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

const started = docker(
  "run",
  "--detach",
  "--name",
  containerName,
  "--publish",
  "127.0.0.1::3000",
  "--env",
  "STEAM_API_KEY=ci-placeholder",
  "--env",
  `MCP_ACCESS_TOKEN=${accessToken}`,
  "--env",
  "MCP_RESOURCE_URI=https://localhost:3000/mcp",
  "--env",
  "ALLOWED_HOSTS=localhost:3000",
  image,
);

if (started.status !== 0) {
  throw new Error("Container health smoke could not start the image");
}

try {
  let lastStatus = "starting";
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const inspected = docker(
      "inspect",
      "--format={{.State.Status}}|{{.State.Health.Status}}",
      containerName,
    );
    if (inspected.status !== 0) {
      throw new Error("Container health smoke could not inspect the image");
    }

    const [processStatus, healthStatus] = inspected.stdout.trim().split("|");
    lastStatus = healthStatus ?? "missing";
    if (processStatus !== "running") {
      throw new Error("Container exited before becoming healthy");
    }
    if (healthStatus === "healthy") {
      process.stdout.write("Container health smoke passed\n");
      process.exitCode = 0;
      break;
    }
    if (healthStatus === "unhealthy") {
      throw new Error("Container reported an unhealthy status");
    }

    await delay(1_000);
  }

  if (lastStatus !== "healthy") {
    throw new Error("Container did not become healthy before the deadline");
  }

  const publishedPort = docker("port", containerName, "3000/tcp");
  const portMatch = /:(\d+)\s*$/u.exec(publishedPort.stdout);
  if (publishedPort.status !== 0 || portMatch?.[1] === undefined) {
    throw new Error("Container health smoke could not resolve its HTTP port");
  }

  const response = await initializeMcp(portMatch[1]);
  const body = /** @type {unknown} */ (response.body);
  if (
    response.status !== 200 ||
    typeof body !== "object" ||
    body === null ||
    !("result" in body)
  ) {
    throw new Error("Container MCP initialization smoke failed");
  }
  process.stdout.write("Container MCP initialization smoke passed\n");
} finally {
  docker("rm", "--force", containerName);
}
