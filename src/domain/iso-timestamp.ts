declare const isoTimestampBrand: unique symbol;

export type IsoTimestamp = string & {
  readonly [isoTimestampBrand]: true;
};

export function parseIsoTimestamp(input: string): IsoTimestamp {
  const parsed = new Date(input);

  if (
    !input.endsWith("Z") ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== input
  ) {
    throw new TypeError("Invalid ISO 8601 UTC timestamp");
  }

  return input as IsoTimestamp;
}
