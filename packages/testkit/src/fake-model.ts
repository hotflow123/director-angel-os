import type { ModelLike, ModelRequest, ModelResponse } from "./contracts.js";

export type ModelResponder =
  | ModelResponse
  | ((request: ModelRequest) => Promise<ModelResponse> | ModelResponse);

export interface FakeModelOptions {
  readonly responders?: readonly ModelResponder[];
  readonly fallback?: ModelResponse;
}

function cloneResponse(response: ModelResponse): ModelResponse {
  return {
    output: response.output,
    ...(response.toolCalls !== undefined ? { toolCalls: [...response.toolCalls] } : {}),
    ...(response.metadata !== undefined ? { metadata: { ...response.metadata } } : {}),
  };
}

export class FakeModel implements ModelLike {
  readonly requests: ModelRequest[] = [];

  private readonly queue: ModelResponder[];
  private readonly fallback: ModelResponse;

  constructor(options: FakeModelOptions = {}) {
    this.queue = [...(options.responders ?? [])];
    this.fallback = options.fallback ?? { output: "" };
  }

  enqueue(responder: ModelResponder): void {
    this.queue.push(responder);
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);

    const responder = this.queue.shift();
    if (!responder) {
      return cloneResponse(this.fallback);
    }
    if (typeof responder === "function") {
      return cloneResponse(await responder(request));
    }
    return cloneResponse(responder);
  }
}
