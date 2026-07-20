import { describe, expect, it } from "vitest";

import { createBoundedCollection } from "../../../src/domain/bounded-collection.js";

describe("createBoundedCollection", () => {
  it("accepts a collection at its declared size limit", () => {
    expect(createBoundedCollection([10, 20], 2)).toEqual([10, 20]);
  });

  it("rejects a collection above its declared size limit", () => {
    expect(() => createBoundedCollection([10, 20, 30], 2)).toThrow(
      "Collection exceeds limit of 2",
    );
  });

  it("rejects a negative collection limit", () => {
    expect(() => createBoundedCollection([], -1)).toThrow(
      "Invalid collection limit",
    );
  });

  it("rejects a fractional collection limit", () => {
    expect(() => createBoundedCollection([], 1.5)).toThrow(
      "Invalid collection limit",
    );
  });

  it("is not changed by later mutation of the input array", () => {
    const input = [10];
    const bounded = createBoundedCollection(input, 2);

    input.push(20);

    expect(bounded).toEqual([10]);
  });
});
