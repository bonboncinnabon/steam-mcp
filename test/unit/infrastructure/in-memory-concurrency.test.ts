import { describe, expect, it, vi } from "vitest";

import { type ConcurrencyLease } from "../../../src/application/ports/concurrency.js";
import {
  createInMemoryConcurrency,
  type ConcurrencyAcquireError,
} from "../../../src/infrastructure/in-memory-concurrency.js";

async function expectLease(
  promise: Promise<ConcurrencyLease>,
): Promise<ConcurrencyLease> {
  const lease = await promise;
  expect(typeof lease.release).toBe("function");
  return lease;
}

type AbortListener = Parameters<AbortSignal["addEventListener"]>[1];

function asCallback(listener: AbortListener): () => void {
  return typeof listener === "function"
    ? () => {
        listener(new Event("abort"));
      }
    : () => {
        listener.handleEvent(new Event("abort"));
      };
}

describe("in-memory concurrency", () => {
  it("rejects invalid concurrency bounds at construction", () => {
    const baseline = {
      maxHostConcurrency: 2,
      maxOperationConcurrency: 1,
      maxQueueSize: 4,
    };

    expect(() =>
      createInMemoryConcurrency({ ...baseline, maxHostConcurrency: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      createInMemoryConcurrency({ ...baseline, maxOperationConcurrency: 1.5 }),
    ).toThrow(RangeError);
    expect(() =>
      createInMemoryConcurrency({ ...baseline, maxQueueSize: 0 }),
    ).toThrow(RangeError);
  });

  it("rejects blank concurrency keys before consuming capacity", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });
    const signal = new AbortController().signal;

    await expect(
      concurrency.acquire("", "get-player", signal),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      concurrency.acquire("api.steampowered.com", "", signal),
    ).rejects.toBeInstanceOf(RangeError);
    await expectLease(
      concurrency.acquire("api.steampowered.com", "get-player", signal),
    );
  });

  it("acquires immediately under both limits and release restores capacity", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });

    const first = await concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      new AbortController().signal,
    );
    first.release();

    await expectLease(
      concurrency.acquire(
        "api.steampowered.com",
        "get-player",
        new AbortController().signal,
      ),
    );
  });

  it("queues a different operation when its host is at capacity", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 2,
      maxQueueSize: 1,
    });
    const first = await concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      new AbortController().signal,
    );
    const acquired = vi.fn();
    const pending = concurrency
      .acquire(
        "api.steampowered.com",
        "get-library",
        new AbortController().signal,
      )
      .then(acquired);

    await Promise.resolve();
    expect(acquired).not.toHaveBeenCalled();
    first.release();

    await expect(pending).resolves.toBeUndefined();
    expect(acquired).toHaveBeenCalledOnce();
  });

  it("queues a different host when its operation is at capacity", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 2,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });
    const first = await concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      new AbortController().signal,
    );
    const acquired = vi.fn();
    const pending = concurrency
      .acquire(
        "store.steampowered.com",
        "get-player",
        new AbortController().signal,
      )
      .then(acquired);

    await Promise.resolve();
    expect(acquired).not.toHaveBeenCalled();
    first.release();

    await pending;
    expect(acquired).toHaveBeenCalledOnce();
  });

  it("rejects backpressure when the bounded queue is full", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });
    await concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      new AbortController().signal,
    );
    void concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      new AbortController().signal,
    );
    const rejected = vi.fn();

    void concurrency
      .acquire(
        "api.steampowered.com",
        "get-player",
        new AbortController().signal,
      )
      .catch(rejected);
    await Promise.resolve();

    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining<Partial<ConcurrencyAcquireError>>({
        kind: "queue_full",
      }),
    );
  });

  it("rejects an already-aborted acquisition without consuming capacity", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });
    const controller = new AbortController();
    controller.abort(new Error("private abort reason"));

    await expect(
      concurrency.acquire(
        "api.steampowered.com",
        "get-player",
        controller.signal,
      ),
    ).rejects.toMatchObject({ kind: "cancelled" });
    await expectLease(
      concurrency.acquire(
        "api.steampowered.com",
        "get-player",
        new AbortController().signal,
      ),
    );
  });

  it("removes an aborted waiter and reuses its queue capacity", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });
    const active = await concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      new AbortController().signal,
    );
    const controller = new AbortController();
    const aborted = concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      controller.signal,
    );

    controller.abort(new Error("private abort reason"));
    await expect(aborted).rejects.toMatchObject({
      kind: "cancelled",
      message: "Concurrency acquisition was cancelled",
    });

    const replacement = concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      new AbortController().signal,
    );
    active.release();
    await expectLease(replacement);
  });

  it("treats a queued deadline signal as cancellation", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });
    await concurrency.acquire(
      "api.steampowered.com",
      "get-player",
      new AbortController().signal,
    );

    await expect(
      concurrency.acquire(
        "api.steampowered.com",
        "get-player",
        AbortSignal.timeout(5),
      ),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("does not let a blocked waiter consume the other concurrency dimension", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 2,
    });
    const signal = new AbortController().signal;
    const active = await concurrency.acquire("host-a", "operation-a", signal);
    const blocked = concurrency.acquire("host-a", "operation-b", signal);

    const unrelated = await concurrency.acquire(
      "host-b",
      "operation-b",
      signal,
    );
    unrelated.release();
    active.release();

    await expectLease(blocked);
  });

  it("makes lease release idempotent", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 2,
    });
    const signal = new AbortController().signal;
    const active = await concurrency.acquire("host", "operation", signal);
    const next = concurrency.acquire("host", "operation", signal);

    active.release();
    active.release();
    const nextLease = await next;
    const third = concurrency.acquire("host", "operation", signal);
    await Promise.resolve();

    const thirdAcquired = vi.fn();
    void third.then(thirdAcquired);
    await Promise.resolve();
    expect(thirdAcquired).not.toHaveBeenCalled();
    nextLease.release();
    await expectLease(third);
  });

  it("keeps shared-key counts correct while multiple leases are active", async () => {
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 2,
      maxOperationConcurrency: 2,
      maxQueueSize: 1,
    });
    const signal = new AbortController().signal;
    const first = await concurrency.acquire("host", "operation", signal);
    const second = await concurrency.acquire("host", "operation", signal);
    const third = concurrency.acquire("host", "operation", signal);

    first.release();
    const thirdLease = await third;
    const fourth = concurrency.acquire("host", "operation", signal);
    const fourthAcquired = vi.fn();
    void fourth.then(fourthAcquired);
    await Promise.resolve();
    expect(fourthAcquired).not.toHaveBeenCalled();

    second.release();
    await expectLease(fourth);
    thirdLease.release();
  });

  it("ignores a stale abort callback after its waiter was admitted", async () => {
    let staleAbort: (() => void) | undefined;
    const faultSignal = {
      aborted: false,
      addEventListener: (_type: string, listener: AbortListener) => {
        staleAbort = asCallback(listener);
      },
      removeEventListener: () => undefined,
    } as unknown as AbortSignal;
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });
    const active = await concurrency.acquire(
      "host",
      "operation",
      new AbortController().signal,
    );
    const admitted = concurrency.acquire("host", "operation", faultSignal);

    active.release();
    const admittedLease = await admitted;
    const next = concurrency.acquire(
      "host",
      "operation",
      new AbortController().signal,
    );
    staleAbort?.();
    admittedLease.release();

    await expectLease(next);
  });

  it("cleans up when abort wins immediately after queue insertion", async () => {
    let abortedReads = 0;
    let abortAfterInsert: (() => void) | undefined;
    const faultSignal = {
      get aborted() {
        abortedReads += 1;
        return abortedReads > 1;
      },
      addEventListener: (_type: string, listener: AbortListener) => {
        abortAfterInsert = asCallback(listener);
      },
      removeEventListener: () => undefined,
    } as unknown as AbortSignal;
    const concurrency = createInMemoryConcurrency({
      maxHostConcurrency: 1,
      maxOperationConcurrency: 1,
      maxQueueSize: 1,
    });
    await concurrency.acquire(
      "host",
      "operation",
      new AbortController().signal,
    );

    await expect(
      concurrency.acquire("host", "operation", faultSignal),
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(abortAfterInsert).toBeDefined();
  });
});
