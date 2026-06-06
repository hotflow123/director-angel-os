export type ModelRole = "system" | "user" | "assistant" | "tool";

export interface ModelMessage {
  role: ModelRole;
  content: string;
  name?: string;
  toolCalls?: readonly ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export type ModelToolSchemaScalar = string | number | boolean | null;

export interface ModelToolSchema {
  readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, ModelToolSchema>>;
  readonly items?: ModelToolSchema | readonly ModelToolSchema[];
  readonly required?: readonly string[];
  readonly enum?: readonly ModelToolSchemaScalar[];
  readonly additionalProperties?: boolean | ModelToolSchema;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ModelToolSchema;
  readonly toolset?: string;
  readonly readOnly?: boolean;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  tools?: readonly ModelToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ModelGenerateResult {
  text: string;
  finishReason?: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}
