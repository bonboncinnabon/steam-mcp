const MAX_CURSOR_LENGTH = 512;

declare const paginationCursorBrand: unique symbol;

export type PaginationCursor = string & {
  readonly [paginationCursorBrand]: true;
};

export function parsePaginationCursor(input: string): PaginationCursor {
  if (input.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new TypeError("Invalid pagination cursor");
  }

  return input as PaginationCursor;
}
