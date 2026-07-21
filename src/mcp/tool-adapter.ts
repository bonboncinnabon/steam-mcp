import {
  failure,
  type FailureResult,
  type ToolResult,
} from "../domain/result.js";

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
    } catch {
      return renderFailure(
        failure("INTERNAL_ERROR", "The Steam tool could not complete.", false),
      );
    }
  };
}

function renderFailure(result: FailureResult) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: result.error.message }],
    structuredContent: result,
  };
}
