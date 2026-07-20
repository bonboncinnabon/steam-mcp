declare const currencyCodeBrand: unique symbol;

export type CurrencyCode = string & {
  readonly [currencyCodeBrand]: true;
};

export function parseCurrencyCode(input: string): CurrencyCode {
  if (!/^[A-Z]{3}$/.test(input)) {
    throw new TypeError("Invalid ISO currency code");
  }

  return input as CurrencyCode;
}
