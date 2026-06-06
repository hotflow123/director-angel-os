import {
  type AdaptStreamToContractEventsOptions,
  type ContractStreamEvent,
  type ContractStreamEventEnvelope,
  adaptStreamEventToContractEvent,
  adaptStreamToContractEventEnvelopes,
} from "./contract-stream-events.js";
import type { ModelProvider } from "./provider.js";
import type { ProviderStreamEvent, StreamEvent } from "./stream-events.js";
import { normalizeProviderStream, normalizeProviderStreamEvent } from "./stream-normalization.js";
import type { ModelGenerateResult, ModelRequest } from "./types.js";

export interface ModelRunRequest {
  providerId: string;
  request: ModelRequest;
}

export interface ModelRunContractStreamRequest extends ModelRunRequest {
  turnId: string;
}

export interface ModelProviderRegistry {
  get(providerId: string): ModelProvider | undefined;
}

export class InMemoryModelProviderRegistry implements ModelProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }
}

export class ModelRuntime {
  constructor(private readonly registry: ModelProviderRegistry) {}

  async generate(input: ModelRunRequest): Promise<ModelGenerateResult> {
    const provider = this.resolveProvider(input.providerId);
    return provider.generate(input.request);
  }

  async *stream(input: ModelRunRequest): AsyncGenerator<ProviderStreamEvent> {
    const provider = this.resolveProvider(input.providerId);
    for await (const event of provider.stream(input.request)) {
      yield event;
    }
  }

  async *streamNormalized(input: ModelRunRequest): AsyncGenerator<StreamEvent> {
    const provider = this.resolveProvider(input.providerId);
    yield* normalizeProviderStream(provider.id, provider.stream(input.request));
  }

  normalizeEvent(providerId: string, event: ProviderStreamEvent): StreamEvent {
    return normalizeProviderStreamEvent(providerId, event);
  }

  adaptToContractStream(
    turnId: string,
    event: StreamEvent,
    options: {
      sequence: number;
      chunkIndex: number;
      occurredAtMs?: number;
      eventId?: string;
    },
  ): { event: ContractStreamEvent; nextChunkIndex: number } {
    return adaptStreamEventToContractEvent({
      turnId,
      source: event,
      sequence: options.sequence,
      chunkIndex: options.chunkIndex,
      ...(options.occurredAtMs !== undefined ? { occurredAtMs: options.occurredAtMs } : {}),
      ...(options.eventId !== undefined ? { eventId: options.eventId } : {}),
    });
  }

  async *streamAsContractEvents(
    input: ModelRunContractStreamRequest,
    options: AdaptStreamToContractEventsOptions = {},
  ): AsyncGenerator<ContractStreamEvent> {
    for await (const envelope of this.streamAsContractEventEnvelopes(input, options)) {
      yield envelope.event;
    }
  }

  async *streamAsContractEventEnvelopes(
    input: ModelRunContractStreamRequest,
    options: AdaptStreamToContractEventsOptions = {},
  ): AsyncGenerator<ContractStreamEventEnvelope> {
    const provider = this.resolveProvider(input.providerId);
    const stream = normalizeProviderStream(provider.id, provider.stream(input.request));
    yield* adaptStreamToContractEventEnvelopes(input.turnId, stream, options);
  }

  private resolveProvider(providerId: string): ModelProvider {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new Error(`Model provider "${providerId}" is not registered.`);
    }
    return provider;
  }
}
