const MAX_UNSIGNED_32_BIT = 4_294_967_295;

declare const appIdBrand: unique symbol;

export type AppId = number & { readonly [appIdBrand]: true };

export function parseAppId(input: number): AppId {
  if (!Number.isInteger(input) || input <= 0 || input > MAX_UNSIGNED_32_BIT) {
    throw new TypeError("Invalid Steam app ID");
  }

  return input as AppId;
}
