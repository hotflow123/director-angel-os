export type ToolKind = "function" | "mcp" | "builtin";

export interface ToolParameterContract {
  readonly name: string;
  readonly type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  readonly required: boolean;
  readonly description?: string;
}

export interface ToolContract {
  readonly name: string;
  readonly version: string;
  readonly kind: ToolKind;
  readonly timeoutMs: number;
  readonly parameters: readonly ToolParameterContract[];
}

export interface ToolCallContract {
  readonly callId: string;
  readonly taskId?: string;
  readonly tool: ToolContract;
  readonly args: Readonly<Record<string, unknown>>;
  readonly startedAtMs: number;
  readonly finishedAtMs?: number;
  readonly success?: boolean;
  readonly errorMessage?: string;
}
