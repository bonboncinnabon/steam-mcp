import { parseSteamId64, type SteamId64 } from "../domain/steam-id.js";

declare const steamVanityNameBrand: unique symbol;

export type SteamVanityName = string & {
  readonly [steamVanityNameBrand]: true;
};

export type SteamUserReference =
  | { readonly kind: "steam_id"; readonly steamId: SteamId64 }
  | { readonly kind: "vanity"; readonly vanity: SteamVanityName };

export function parseSteamUserReference(input: string): SteamUserReference {
  if (input.includes("://")) {
    return parseSteamCommunityUrl(input);
  }

  if (/^\d{17}$/.test(input)) {
    return { kind: "steam_id", steamId: parseSteamId64(input) };
  }

  return { kind: "vanity", vanity: parseSteamVanityName(input) };
}

function parseSteamCommunityUrl(input: string): SteamUserReference {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError("Invalid Steam user reference");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "steamcommunity.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("Invalid Steam user reference");
  }

  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (
    segments.length === 2 &&
    segments[0] === "profiles" &&
    /^\d{17}$/.test(segments[1] ?? "")
  ) {
    return { kind: "steam_id", steamId: parseSteamId64(segments[1] ?? "") };
  }
  if (segments.length === 2 && segments[0] === "id") {
    return {
      kind: "vanity",
      vanity: parseSteamVanityName(segments[1] ?? ""),
    };
  }

  throw new TypeError("Invalid Steam user reference");
}

function parseSteamVanityName(input: string): SteamVanityName {
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(input)) {
    throw new TypeError("Invalid Steam user reference");
  }
  return input as SteamVanityName;
}
