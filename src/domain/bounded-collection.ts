export function createBoundedCollection<T>(
  items: readonly T[],
  limit: number,
): readonly T[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("Invalid collection limit");
  }

  if (items.length > limit) {
    throw new RangeError(`Collection exceeds limit of ${String(limit)}`);
  }

  return Object.freeze([...items]);
}
