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

export async function withConcurrencyLease<T>(
  concurrency: ConcurrencyPort,
  host: string,
  operation: string,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  const lease = await concurrency.acquire(host, operation, signal);
  try {
    return await work();
  } finally {
    lease.release();
  }
}
