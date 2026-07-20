export interface CancellationScope {
  readonly signal: AbortSignal;
  dispose(): void;
}

export interface CancellationPort {
  withDeadline(parent: AbortSignal, deadlineMs: number): CancellationScope;
}
