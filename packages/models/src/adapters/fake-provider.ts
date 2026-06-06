import type { ModelProvider } from "../provider.js";
import type { ProviderStreamEvent } from "../stream-events.js";
import type { ModelGenerateResult, ModelRequest } from "../types.js";

export interface FakeModelProviderOptions {
  id?: string;
  cannedText?: string;
}

function getPromptTail(request: ModelRequest): string {
  const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
  return lastUser?.content ?? "";
}

export class FakeModelProvider implements ModelProvider {
  readonly id: string;
  private readonly cannedText: string | undefined;

  constructor(options: FakeModelProviderOptions = {}) {
    this.id = options.id ?? "fake";
    this.cannedText = options.cannedText;
  }

  async generate(request: ModelRequest): Promise<ModelGenerateResult> {
    const text = this.cannedText ?? `fake:${getPromptTail(request)}`;
    return {
      text,
      finishReason: "stop",
      usage: {
        inputTokens: request.messages.length * 5,
        outputTokens: Math.max(1, text.length / 4),
      },
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ProviderStreamEvent> {
    const text = this.cannedText ?? `fake:${getPromptTail(request)}`;
    yield { type: "response.started" };
    yield { type: "text.delta", text };
    yield { type: "response.completed", finishReason: "stop" };
  }
}
