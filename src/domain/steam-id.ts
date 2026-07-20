const MAX_UNSIGNED_64_BIT = 18_446_744_073_709_551_615n;

declare const steamId64Brand: unique symbol;

export type SteamId64 = string & { readonly [steamId64Brand]: true };

export function parseSteamId64(input: string): SteamId64 {
  if (!/^\d+$/.test(input) || BigInt(input) > MAX_UNSIGNED_64_BIT) {
    throw new TypeError("Invalid SteamID64");
  }

  return input as SteamId64;
}
