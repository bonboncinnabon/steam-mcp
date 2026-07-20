import type {
  GameAchievementDefinition,
  GlobalAchievementPercentage,
  PlayerAchievement,
} from "./steam-data.js";

export function enrichPlayerAchievements(
  progress: readonly PlayerAchievement[],
  definitions: readonly GameAchievementDefinition[],
  percentages: readonly GlobalAchievementPercentage[],
): readonly PlayerAchievement[] {
  const definitionByName = new Map(
    definitions.map((definition) => [definition.apiName, definition]),
  );
  const percentageByName = new Map(
    percentages.map((percentage) => [
      percentage.apiName,
      percentage.globalPercent,
    ]),
  );

  return progress.map((achievement) => {
    const definition = definitionByName.get(achievement.apiName);
    const globalPercent = percentageByName.get(achievement.apiName);
    return {
      apiName: achievement.apiName,
      ...(definition?.displayName === undefined
        ? {}
        : { displayName: definition.displayName }),
      ...(definition?.description === undefined
        ? {}
        : { description: definition.description }),
      achieved: achievement.achieved,
      ...(achievement.unlockedAt === undefined
        ? {}
        : { unlockedAt: achievement.unlockedAt }),
      ...(globalPercent === undefined ? {} : { globalPercent }),
    };
  });
}
