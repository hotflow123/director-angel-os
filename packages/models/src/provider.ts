import type { ProviderStreamEvent } from "./stream-events.js";
import type { ModelGenerateResult, ModelRequest } from "./types.js";

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelGenerateResult>;
  stream(request: ModelRequest): AsyncIterable<ProviderStreamEvent>;
}
