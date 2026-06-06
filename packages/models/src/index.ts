export { FakeModelProvider } from "./adapters/fake-provider.js";
export {
  OpenAICompatibleProvider,
  adaptOpenAIChunkToProviderEvents,
} from "./adapters/openai-compatible.js";
export type {
  OpenAICompatibleChunk,
  OpenAICompatibleProviderOptions,
} from "./adapters/openai-compatible.js";
export {
  createOpenAICompatibleProviderFromEnv,
  resolveOpenAICompatibleProviderEnv,
} from "./provider-env.js";
export type {
  CreateOpenAICompatibleProviderFromEnvOptions,
  OpenAICompatibleProviderEnvConfig,
  ResolveOpenAICompatibleProviderEnvOptions,
} from "./provider-env.js";
export {
  adaptStreamEventToContractEvent,
  adaptStreamToContractEventEnvelopes,
  adaptStreamToContractEvents,
  createContractFailureEventEnvelopes,
  observeContractStreamEvent,
  summarizeContractStreamEvents,
} from "./contract-stream-events.js";
export type {
  AdaptStreamEventToContractEventInput,
  AdaptStreamEventToContractEventResult,
  AdaptStreamToContractEventsOptions,
  ContractStreamEvent,
  ContractStreamEventEnvelope,
  ContractStreamEventKind,
  ContractStreamObservation,
  ContractStreamEventPayloadMap,
  ContractStreamError,
  ContractStreamErrorCode,
  ContractStreamSourceType,
  ContractRuntimeDegradeSurface,
  ContractRuntimeFailureSurface,
  ContractToolCall,
  ContractFailureEnvelopeInput,
} from "./contract-stream-events.js";
export {
  ModelProviderError,
  classifyModelProviderFailure,
  createHttpModelProviderError,
  createNetworkModelProviderError,
  planModelProviderFallback,
  toModelProviderFailureSurface,
  toModelProviderRuntimeFailureSurface,
} from "./provider-errors.js";
export type {
  ModelProviderFailureCode,
  ModelProviderFailureClass,
  ModelProviderFailureSurface,
  ModelProviderFallbackAttempt,
  ModelProviderFallbackFailurePlan,
  ModelProviderFallbackPlan,
  ModelProviderFallbackPlanInput,
  ModelProviderRuntimeFailureSurface,
  ModelProviderUnhealthyState,
} from "./provider-errors.js";

export type { ModelProvider } from "./provider.js";
export { InMemoryModelProviderRegistry, ModelRuntime } from "./runtime.js";
export type {
  ModelProviderRegistry,
  ModelRunContractStreamRequest,
  ModelRunRequest,
} from "./runtime.js";

export { normalizeProviderStream, normalizeProviderStreamEvent } from "./stream-normalization.js";
export type { ProviderStreamEvent, StreamEvent, StreamEventType } from "./stream-events.js";

export type {
  ModelGenerateResult,
  ModelMessage,
  ModelRequest,
  ModelRole,
  ModelToolDefinition,
  ModelToolSchema,
  ModelToolSchemaScalar,
  ToolCall,
} from "./types.js";
