export const HOSTED_DIAGNOSTIC_CATEGORIES = [
  "request_failed",
  "shutdown_cleanup_failed",
] as const;

export type HostedDiagnosticCategory =
  (typeof HOSTED_DIAGNOSTIC_CATEGORIES)[number];

export type ReportHostedDiagnostic = (
  category: HostedDiagnosticCategory,
) => void;
