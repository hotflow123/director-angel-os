import {
  createHttpModelProviderError,
  createNetworkModelProviderError,
} from "../provider-errors.js";
import type { ModelProvider } from "../provider.js";
import type { ProviderStreamEvent } from "../stream-events.js";
import type {
  ModelGenerateResult,
  ModelMessage,
  ModelRequest,
  ModelToolDefinition,
  ToolCall,
} from "../types.js";

interface OpenAICompatibleRequestBody {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: ModelToolDefinition["inputSchema"];
    };
  }>;
  tool_choice?: "auto";
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface OpenAICompatibleResponseBody {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface OpenAICompatibleChunk {
  id?: string;
  choices: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export interface OpenAICompatibleProviderOptions {
  id?: string;
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function toOpenAIToolCall(toolCall: ToolCall): {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
} {
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: toolCall.argumentsJson,
    },
  };
}

function toOpenAIMessage(message: ModelMessage): {
  role: string;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
} {
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls && message.toolCalls.length > 0
      ? { tool_calls: message.toolCalls.map(toOpenAIToolCall) }
      : {}),
  };
}

function toRequestBody(request: ModelRequest): OpenAICompatibleRequestBody {
  return {
    model: request.model,
    messages: request.messages.map(toOpenAIMessage),
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
          tool_choice: "auto" as const,
        }
      : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
  };
}

function normalizeToolCalls(
  toolCalls:
    | Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>
    | undefined,
): ToolCall[] {
  return (toolCalls ?? [])
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id ?? `tool-call-${index}`,
      name: call.function?.name ?? "unknown_tool",
      argumentsJson: call.function?.arguments ?? "{}",
    }));
}

function isOpenAICompatibleChunk(value: unknown): value is OpenAICompatibleChunk {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as OpenAICompatibleChunk).choices)
  );
}

function parseOpenAICompatibleSseBlock(block: string): OpenAICompatibleChunk | undefined {
  const payload = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
    .trim();
  if (!payload || payload === "[DONE]") {
    return undefined;
  }
  const parsed = JSON.parse(payload) as unknown;
  if (!isOpenAICompatibleChunk(parsed)) {
    throw new Error("OpenAI-compatible SSE chunk is missing choices.");
  }
  return parsed;
}

function drainOpenAICompatibleSseBuffer(bufferState: { buffer: string }): OpenAICompatibleChunk[] {
  const chunks: OpenAICompatibleChunk[] = [];
  bufferState.buffer = bufferState.buffer.replace(/\r\n/g, "\n");
  while (true) {
    const boundary = bufferState.buffer.indexOf("\n\n");
    if (boundary < 0) {
      break;
    }
    const block = bufferState.buffer.slice(0, boundary);
    bufferState.buffer = bufferState.buffer.slice(boundary + 2);
    const parsed = parseOpenAICompatibleSseBlock(block);
    if (parsed) {
      chunks.push(parsed);
    }
  }
  return chunks;
}

async function* readOpenAICompatibleSseChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<OpenAICompatibleChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const bufferState = { buffer: "" };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bufferState.buffer += decoder.decode(value, { stream: true });
      yield* drainOpenAICompatibleSseBuffer(bufferState);
    }
    bufferState.buffer += decoder.decode();
    yield* drainOpenAICompatibleSseBuffer(bufferState);
  } finally {
    reader.releaseLock();
  }
}

function parseOpenAICompatibleJsonChunk(text: string): OpenAICompatibleChunk | undefined {
  const payload = text.trim();
  if (!payload) {
    return undefined;
  }
  const parsed = JSON.parse(payload) as unknown;
  if (!isOpenAICompatibleChunk(parsed)) {
    return undefined;
  }
  return parsed;
}

async function* iterateOpenAICompatibleResponseChunks(
  response: Response,
): AsyncGenerator<OpenAICompatibleChunk> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.body && /event-stream/i.test(contentType)) {
    yield* readOpenAICompatibleSseChunks(response.body);
    return;
  }
  const text = await response.text();
  const sseChunks = drainOpenAICompatibleSseBuffer({ buffer: text });
  if (sseChunks.length > 0) {
    yield* sseChunks;
    return;
  }
  const jsonChunk = parseOpenAICompatibleJsonChunk(text);
  if (jsonChunk) {
    yield jsonChunk;
  }
}

export function adaptOpenAIChunkToProviderEvents(
  chunk: OpenAICompatibleChunk,
): ProviderStreamEvent[] {
  const events: ProviderStreamEvent[] = [];
  for (const choice of chunk.choices) {
    const text = choice.delta?.content;
    if (text) {
      events.push({
        type: "text.delta",
        text,
        ...(chunk.id ? { responseId: chunk.id } : {}),
      });
    }

    for (const toolCall of normalizeToolCalls(choice.delta?.tool_calls)) {
      events.push({
        type: "tool.call",
        toolCall,
        ...(chunk.id ? { responseId: chunk.id } : {}),
      });
    }

    if (choice.finish_reason) {
      events.push({
        type: "response.completed",
        finishReason: choice.finish_reason,
        ...(chunk.id ? { responseId: chunk.id } : {}),
      });
    }
  }
  return events;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.id = options.id ?? "openai-compatible";
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async generate(request: ModelRequest): Promise<ModelGenerateResult> {
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation available for OpenAICompatibleProvider.");
    }

    const endpoint = `${this.baseUrl}/chat/completions`;
    const body = toRequestBody(request);

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw createNetworkModelProviderError({
        providerId: this.id,
        stage: "generate",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      throw createHttpModelProviderError({
        providerId: this.id,
        stage: "generate",
        statusCode: response.status,
        message: `OpenAI-compatible request failed with status ${response.status}.`,
      });
    }

    const payload = (await response.json()) as OpenAICompatibleResponseBody;
    const firstChoice = payload.choices?.[0];
    const text = firstChoice?.message?.content ?? "";

    return {
      text,
      ...(firstChoice?.finish_reason ? { finishReason: firstChoice.finish_reason } : {}),
      ...(firstChoice?.message?.tool_calls
        ? { toolCalls: normalizeToolCalls(firstChoice.message.tool_calls) }
        : {}),
      ...(payload.usage?.prompt_tokens !== undefined ||
      payload.usage?.completion_tokens !== undefined
        ? {
            usage: {
              ...(payload.usage?.prompt_tokens !== undefined
                ? { inputTokens: payload.usage.prompt_tokens }
                : {}),
              ...(payload.usage?.completion_tokens !== undefined
                ? { outputTokens: payload.usage.completion_tokens }
                : {}),
            },
          }
        : {}),
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ProviderStreamEvent> {
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation available for OpenAICompatibleProvider.");
    }

    const endpoint = `${this.baseUrl}/chat/completions`;
    const body = { ...toRequestBody(request), stream: true };

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw createNetworkModelProviderError({
        providerId: this.id,
        stage: "stream",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      throw createHttpModelProviderError({
        providerId: this.id,
        stage: "stream",
        statusCode: response.status,
        message: `OpenAI-compatible stream request failed with status ${response.status}.`,
      });
    }

    yield { type: "response.started" };

    let sawCompleted = false;
    for await (const chunk of iterateOpenAICompatibleResponseChunks(response)) {
      for (const event of adaptOpenAIChunkToProviderEvents(chunk)) {
        if (event.type === "response.completed") {
          sawCompleted = true;
        }
        yield event;
      }
    }

    if (!sawCompleted) {
      yield { type: "response.completed" };
    }
  }
}
