export function assertSteamStorefrontPolicy(
  countryCode: string,
  language: string,
): void {
  if (!/^[A-Z]{2}$/.test(countryCode) || !/^[a-z]+$/.test(language)) {
    throw new RangeError("Invalid Steam storefront policy");
  }
}
