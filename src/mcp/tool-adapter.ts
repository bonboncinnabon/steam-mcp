import {
  ERROR_CODES,
  failure,
  type ErrorCode,
  type FailureResult,
  type ToolResult,
} from "../domain/result.js";

const PUBLIC_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  INVALID_INPUT: "The Steam tool input is invalid.",
  IDENTITY_NOT_LINKED: "No default Steam identity is linked.",
  PROFILE_PRIVATE: "The requested Steam profile data is private.",
  NOT_FOUND: "The requested Steam data was not found.",
  STEAM_AUTH_FAILED:
    "Steam authentication failed. Local users should set STEAM_API_KEY; hosted users should contact the server operator.",
  STEAM_RATE_LIMITED: "Steam rate limit reached.",
  UPSTREAM_UNAVAILABLE: "Steam is currently unavailable.",
  BEST_EFFORT_SOURCE_CHANGED: "A best-effort Steam source changed.",
  USER_QUOTA_EXCEEDED: "The Steam tool quota is exhausted.",
  INTERNAL_ERROR: "The Steam tool could not complete.",
};

interface McpToolHandlerOptions<Input, Output> {
  readonly execute: (
    input: Input,
    signal: AbortSignal,
  ) => Promise<ToolResult<Output>>;
  readonly renderSuccess: (data: Output) => string;
}

interface McpToolHandlerExtra {
  readonly signal: AbortSignal;
}

export function createMcpToolHandler<Input, Output>(
  options: McpToolHandlerOptions<Input, Output>,
) {
  return async (input: Input, extra: McpToolHandlerExtra) => {
    try {
      const result: ToolResult<Output> = await options.execute(
        input,
        extra.signal,
      );
      if (!result.ok) {
        return renderFailure(result);
      }
      return {
        content: [
          { type: "text" as const, text: options.renderSuccess(result.data) },
        ],
        structuredContent: result,
      };
    } catch (error) {
      return renderFailure(
        expectedExceptionFailure(error) ??
          failure(
            "INTERNAL_ERROR",
            PUBLIC_ERROR_MESSAGES.INTERNAL_ERROR,
            false,
          ),
      );
    }
  };
}

function expectedExceptionFailure(error: unknown): FailureResult | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !ERROR_CODES.includes(error.code as ErrorCode) ||
    !("retryable" in error) ||
    typeof error.retryable !== "boolean"
  ) {
    return undefined;
  }
  const code = error.code as ErrorCode;
  return failure(code, PUBLIC_ERROR_MESSAGES[code], error.retryable);
}

function renderFailure(result: FailureResult) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: result.error.message }],
    structuredContent: result,
  };
}
