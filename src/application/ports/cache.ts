export type CacheDataClass = "public_game" | "public_store";

declare const cacheValueType: unique symbol;

export interface CacheKey<T> {
  readonly namespace: CacheDataClass;
  readonly value: string;
  readonly [cacheValueType]?: T;
}

export interface CachePort {
  get<T>(key: CacheKey<T>): Promise<T | undefined>;
  set<T>(key: CacheKey<T>, value: T, ttlSeconds: number): Promise<void>;
}

export interface CoalescerPort {
  run<T>(key: CacheKey<T>, operation: () => Promise<T>): Promise<T>;
}
