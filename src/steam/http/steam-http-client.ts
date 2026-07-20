import type { SteamHttpRequest } from "./steam-request.js";
import {
  sanitizeSteamUrl,
  SteamHttpPolicyError,
  validateSteamRedirect,
} from "./steam-http-policy.js";
import {
  calculateSteamRetryDelay,
  classifySteamHttpStatus,
  classifySteamNetworkFailure,
  SteamUpstreamError,
} from "./steam-retry-policy.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SteamHttpExecutionOptions {
  readonly fetchImpl?: typeof fetch;
  readonly deadlineMs: number;
  readonly maxResponseBytes: number;
  readonly maxRetryAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly random?: () => number;
  readonly signal?: AbortSignal;
  readonly sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export interface SteamHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
  readonly finalUrl: string;
}

export async function executeSteamRequest(
  request: SteamHttpRequest,
  options: SteamHttpExecutionOptions,
): Promise<SteamHttpResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => {
    deadlineController.abort();
  }, options.deadlineMs);
  const signal =
    options.signal === undefined
      ? deadlineController.signal
      : AbortSignal.any([deadlineController.signal, options.signal]);

  try {
    const maxRetryAttempts = options.maxRetryAttempts ?? 0;
    const sleep = options.sleep ?? sleepWithSignal;

    for (let attempt = 0; ; attempt += 1) {
      let response: SteamHttpResponse;
      try {
        response = await executeWithRedirects(
          request,
          options,
          fetchImpl,
          signal,
        );
      } catch (error) {
        const decision = classifySteamNetworkFailure(error);
        if (error instanceof SteamHttpPolicyError || !decision.retryable) {
          throw error;
        }
        if (attempt >= maxRetryAttempts) {
          throw new SteamUpstreamError(decision);
        }

        await sleep(
          calculateSteamRetryDelay({
            attempt,
            baseDelayMs: options.retryBaseDelayMs ?? 250,
            maxDelayMs: options.retryMaxDelayMs ?? 5_000,
            random: options.random ?? Math.random,
          }),
          signal,
        );
        continue;
      }
      if (response.status < 400) {
        return response;
      }

      const decision = classifySteamHttpStatus(
        response.status,
        response.headers,
      );
      if (!decision.retryable || attempt >= maxRetryAttempts) {
        throw new SteamUpstreamError(decision);
      }

      await sleep(
        calculateSteamRetryDelay({
          attempt,
          baseDelayMs: options.retryBaseDelayMs ?? 250,
          maxDelayMs: options.retryMaxDelayMs ?? 5_000,
          ...(decision.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: decision.retryAfterMs }),
          random: options.random ?? Math.random,
        }),
        signal,
      );
    }
  } catch (error) {
    if (deadlineController.signal.aborted) {
      // Abort reasons may contain caller or credential data and must not be retained.
      // eslint-disable-next-line preserve-caught-error
      throw new Error("Steam request deadline exceeded");
    }
    if (options.signal?.aborted === true) {
      // Abort reasons may contain caller or credential data and must not be retained.
      // eslint-disable-next-line preserve-caught-error
      throw new Error("Steam request cancelled");
    }
    if (
      error instanceof SteamHttpPolicyError ||
      error instanceof SteamUpstreamError
    ) {
      throw error;
    }
    // Upstream errors may embed credential-bearing URLs and must not be retained.
    // eslint-disable-next-line preserve-caught-error
    throw new Error("Steam network request failed");
  } finally {
    clearTimeout(deadlineTimer);
  }
}

function sleepWithSignal(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new Error("Retry wait aborted"));
  }

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("Retry wait aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function executeWithRedirects(
  request: SteamHttpRequest,
  options: SteamHttpExecutionOptions,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<SteamHttpResponse> {
  let currentUrl = request.url;
  let redirectCount = 0;

  for (;;) {
    const response = await fetchImpl(currentUrl, {
      method: request.method,
      headers: request.headers,
      redirect: request.redirect,
      signal,
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      const declaredSize = response.headers.get("content-length");
      if (
        declaredSize !== null &&
        Number.parseInt(declaredSize, 10) > options.maxResponseBytes
      ) {
        throw new SteamHttpPolicyError("Steam response exceeded size limit");
      }

      return {
        status: response.status,
        headers: response.headers,
        body: await readBoundedBody(response, options.maxResponseBytes),
        finalUrl: sanitizeSteamUrl(currentUrl),
      };
    }

    const location = response.headers.get("location");
    if (location === null || redirectCount >= 5) {
      throw new SteamHttpPolicyError("Blocked Steam redirect");
    }

    redirectCount += 1;
    currentUrl = validateSteamRedirect(location, currentUrl);
  }
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<Uint8Array> {
  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader() as {
    read(): Promise<
      | { readonly done: true; readonly value?: undefined }
      | { readonly done: false; readonly value: Uint8Array }
    >;
    cancel(): Promise<void>;
  };
  const chunks: Uint8Array[] = [];
  let byteCount = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    byteCount += value.byteLength;
    if (byteCount > maxResponseBytes) {
      await reader.cancel();
      throw new SteamHttpPolicyError("Steam response exceeded size limit");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
