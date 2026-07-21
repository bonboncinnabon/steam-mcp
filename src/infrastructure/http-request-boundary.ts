export type HttpRequestBoundaryDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "malformed_host" | "disallowed_host" | "invalid_origin";
    };

export interface HttpRequestBoundary {
  check(headers: Headers): HttpRequestBoundaryDecision;
}

export interface HttpRequestBoundaryOptions {
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
}

const INVALID_CONFIGURATION = "Invalid HTTP request boundary configuration";

function normalizeHost(value: string): string | undefined {
  if (value.includes(",") || value.trim() !== value) {
    return undefined;
  }

  try {
    const url = new URL(`https://${value}`);
    if (
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return url.host.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizeOrigin(value: string): string | undefined {
  if (value.includes(",") || value === "null" || value.trim() !== value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return undefined;
    }
    return url.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizedAllowlist(
  values: readonly string[],
  normalize: (value: string) => string | undefined,
  allowEmpty: boolean,
): ReadonlySet<string> {
  const normalized = values.map(normalize);
  if (
    (!allowEmpty && normalized.length === 0) ||
    normalized.some((value) => value === undefined)
  ) {
    throw new Error(INVALID_CONFIGURATION);
  }

  const unique = new Set(normalized as string[]);
  if (unique.size !== normalized.length) {
    throw new Error(INVALID_CONFIGURATION);
  }
  return unique;
}

export function createHttpRequestBoundary(
  options: HttpRequestBoundaryOptions,
): HttpRequestBoundary {
  const allowedHosts = normalizedAllowlist(
    options.allowedHosts,
    normalizeHost,
    false,
  );
  const allowedOrigins = normalizedAllowlist(
    options.allowedOrigins,
    normalizeOrigin,
    true,
  );

  return {
    check(headers) {
      const host = headers.get("host");
      const normalizedHost = host === null ? undefined : normalizeHost(host);
      if (normalizedHost === undefined) {
        return { allowed: false, reason: "malformed_host" };
      }
      if (!allowedHosts.has(normalizedHost)) {
        return { allowed: false, reason: "disallowed_host" };
      }

      const origin = headers.get("origin");
      if (
        origin !== null &&
        !allowedOrigins.has(normalizeOrigin(origin) ?? "")
      ) {
        return { allowed: false, reason: "invalid_origin" };
      }

      return { allowed: true };
    },
  };
}
