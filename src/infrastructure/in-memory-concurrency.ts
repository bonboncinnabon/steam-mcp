import type {
  ConcurrencyLease,
  ConcurrencyPort,
} from "../application/ports/concurrency.js";

interface InMemoryConcurrencyOptions {
  readonly maxHostConcurrency: number;
  readonly maxOperationConcurrency: number;
  readonly maxQueueSize: number;
}

export class ConcurrencyAcquireError extends Error {
  constructor(readonly kind: "cancelled" | "queue_full") {
    super(
      kind === "cancelled"
        ? "Concurrency acquisition was cancelled"
        : "Concurrency queue is full",
    );
  }
}

interface Waiter {
  readonly host: string;
  readonly operation: string;
  readonly signal: AbortSignal;
  readonly resolve: (lease: ConcurrencyLease) => void;
  readonly onAbort: () => void;
}

export function createInMemoryConcurrency(
  options: InMemoryConcurrencyOptions,
): ConcurrencyPort {
  if (
    !Number.isSafeInteger(options.maxHostConcurrency) ||
    options.maxHostConcurrency <= 0 ||
    !Number.isSafeInteger(options.maxOperationConcurrency) ||
    options.maxOperationConcurrency <= 0 ||
    !Number.isSafeInteger(options.maxQueueSize) ||
    options.maxQueueSize <= 0
  ) {
    throw new RangeError("Invalid in-memory concurrency bounds");
  }

  const activeByHost = new Map<string, number>();
  const activeByOperation = new Map<string, number>();
  const waiters: Waiter[] = [];

  function canAcquire(host: string, operation: string): boolean {
    return (
      (activeByHost.get(host) ?? 0) < options.maxHostConcurrency &&
      (activeByOperation.get(operation) ?? 0) < options.maxOperationConcurrency
    );
  }

  function decrement(counter: Map<string, number>, key: string): void {
    // An idempotent lease can release only after admission created both keys.
    const next = Number(counter.get(key)) - 1;
    if (next === 0) counter.delete(key);
    else counter.set(key, next);
  }

  function drainQueue(): void {
    for (let index = 0; index < waiters.length;) {
      const waiter = waiters[index];
      if (waiter === undefined || !canAcquire(waiter.host, waiter.operation)) {
        index += 1;
        continue;
      }
      waiters.splice(index, 1);
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(admit(waiter.host, waiter.operation));
    }
  }

  function admit(host: string, operation: string): ConcurrencyLease {
    activeByHost.set(host, (activeByHost.get(host) ?? 0) + 1);
    activeByOperation.set(
      operation,
      (activeByOperation.get(operation) ?? 0) + 1,
    );
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        decrement(activeByHost, host);
        decrement(activeByOperation, operation);
        drainQueue();
      },
    };
  }

  return {
    acquire(host, operation, signal) {
      if (host.trim().length === 0 || operation.trim().length === 0) {
        return Promise.reject(
          new RangeError("Concurrency host and operation are required"),
        );
      }
      if (signal.aborted) {
        return Promise.reject(new ConcurrencyAcquireError("cancelled"));
      }
      if (canAcquire(host, operation)) {
        return Promise.resolve(admit(host, operation));
      }
      if (waiters.length >= options.maxQueueSize) {
        return Promise.reject(new ConcurrencyAcquireError("queue_full"));
      }
      return new Promise((resolve, reject) => {
        const waiter: Waiter = {
          host,
          operation,
          signal,
          resolve,
          onAbort: () => {
            const index = waiters.indexOf(waiter);
            if (index === -1) return;
            waiters.splice(index, 1);
            signal.removeEventListener("abort", waiter.onAbort);
            reject(new ConcurrencyAcquireError("cancelled"));
          },
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
        waiters.push(waiter);
        if (signal.aborted) waiter.onAbort();
      });
    },
  };
}
