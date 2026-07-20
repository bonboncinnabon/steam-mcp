import { URL } from "node:url";

import { STEAM_HOST_ALLOWLIST } from "./steam-request.js";

export class SteamHttpPolicyError extends Error {}

export function sanitizeSteamUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  return url.href;
}

export function validateSteamRedirect(
  location: string,
  currentUrl?: string,
): string {
  let url: URL;

  try {
    url = new URL(location, currentUrl);
  } catch {
    throw new SteamHttpPolicyError("Blocked Steam redirect");
  }

  if (
    url.protocol !== "https:" ||
    !STEAM_HOST_ALLOWLIST.some((host) => host === url.hostname)
  ) {
    throw new SteamHttpPolicyError("Blocked Steam redirect");
  }

  return url.href;
}
