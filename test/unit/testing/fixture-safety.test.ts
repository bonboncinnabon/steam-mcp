import { describe, expect, it } from "vitest";

import { findFixtureSafetyViolations } from "../../../test/support/fixture-safety.js";

describe("Steam fixture safety", () => {
  it("reports bounded violation codes without echoing unsafe fixture data", () => {
    const unsafe = JSON.stringify({
      key: "0123456789ABCDEF0123456789ABCDEF",
      authorization: "Bearer private-token",
      steamid: "76561198012345678",
      profileurl: "https://steamcommunity.com/id/private-name",
    });

    expect(findFixtureSafetyViolations(unsafe)).toEqual([
      "credential",
      "authorization",
      "steam_id",
      "url",
    ]);
    expect(findFixtureSafetyViolations('{"name":"Synthetic Game"}')).toEqual(
      [],
    );
  });
});
