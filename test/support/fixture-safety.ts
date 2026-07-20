const FIXTURE_SAFETY_RULES = [
  {
    code: "credential",
    pattern: /(?:[?&]key=|"(?:api_)?key"\s*:)/i,
  },
  { code: "authorization", pattern: /(?:authorization|set-cookie)/i },
  { code: "steam_id", pattern: /7656119\d{10}/ },
  { code: "url", pattern: /https?:\/\//i },
  { code: "email", pattern: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/ },
] as const;

export type FixtureSafetyViolation =
  (typeof FIXTURE_SAFETY_RULES)[number]["code"];

export function findFixtureSafetyViolations(
  fixture: string,
): readonly FixtureSafetyViolation[] {
  return FIXTURE_SAFETY_RULES.filter((rule) => rule.pattern.test(fixture)).map(
    (rule) => rule.code,
  );
}
