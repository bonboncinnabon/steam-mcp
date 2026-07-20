import type { ErrorCode, SourceTier } from "../../domain/result.js";

export interface ToolOutcomeMetric {
  readonly tool: string;
  readonly durationMs: number;
  readonly errorCode?: ErrorCode;
  readonly sourceTiers: readonly SourceTier[];
  readonly statusClass?: "2xx" | "4xx" | "5xx";
}

export interface ObservabilityPort {
  recordToolOutcome(metric: ToolOutcomeMetric): void;
  recordBestEffortDrift(adapter: string): void;
  recordEvent(
    name: string,
    attributes: Readonly<Record<string, string | number | boolean>>,
  ): void;
}
