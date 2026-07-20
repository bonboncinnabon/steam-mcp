import { describe, expect, it } from "vitest";

import { enrichPlayerAchievements } from "../../../src/domain/achievement-enrichment.js";

describe("achievement enrichment", () => {
  it("enriches by exact stable ID while leaving unavailable rarity omitted", () => {
    expect(
      enrichPlayerAchievements(
        [
          { apiName: "ACH.WAKE_UP", achieved: true },
          { apiName: "ACH.SECRET", achieved: false },
        ],
        [
          {
            apiName: "ACH.SECRET",
            displayName: "Secret",
            hidden: true,
          },
          {
            apiName: "ACH.WAKE_UP",
            displayName: "Wake Up Call",
            description: "Survive the manual override.",
            hidden: false,
          },
        ],
        [
          { apiName: "ACH.WAKE_UP", globalPercent: 87.5 },
          { apiName: "ACH.EXTRA", globalPercent: 1 },
        ],
      ),
    ).toEqual([
      {
        apiName: "ACH.WAKE_UP",
        displayName: "Wake Up Call",
        description: "Survive the manual override.",
        achieved: true,
        globalPercent: 87.5,
      },
      {
        apiName: "ACH.SECRET",
        displayName: "Secret",
        achieved: false,
      },
    ]);
  });
});
