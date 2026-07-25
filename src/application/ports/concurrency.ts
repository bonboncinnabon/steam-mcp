export interface ConcurrencyLease {
  release(): void;
}

export interface ConcurrencyPort {
  acquire(
    host: string,
    operation: string,
    signal: AbortSignal,
  ): Promise<ConcurrencyLease>;
}
