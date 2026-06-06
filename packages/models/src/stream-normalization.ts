import type { ProviderStreamEvent, StreamEvent } from "./stream-events.js";

export function normalizeProviderStreamEvent(
  providerId: string,
  event: ProviderStreamEvent,
): StreamEvent {
  switch (event.type) {
    case "response.started":
      return {
        type: "response_started",
        providerId,
        ...(event.responseId ? { responseId: event.responseId } : {}),
      };
    case "text.delta":
      return {
        type: "text_delta",
        providerId,
        text: event.text,
        ...(event.responseId ? { responseId: event.responseId } : {}),
      };
    case "status.delta":
      return {
        type: "status_delta",
        providerId,
        status: event.status,
        ...(event.responseId ? { responseId: event.responseId } : {}),
      };
    case "tool.call":
      return {
        type: "tool_boundary",
        providerId,
        toolCall: event.toolCall,
        ...(event.responseId ? { responseId: event.responseId } : {}),
      };
    case "response.paused":
      return {
        type: "response_paused",
        providerId,
        ...(event.responseId ? { responseId: event.responseId } : {}),
        ...(event.reason ? { reason: event.reason } : {}),
      };
    case "response.resumed":
      return {
        type: "response_resumed",
        providerId,
        ...(event.responseId ? { responseId: event.responseId } : {}),
      };
    case "response.completed":
      return {
        type: "response_completed",
        providerId,
        ...(event.responseId ? { responseId: event.responseId } : {}),
        ...(event.finishReason ? { finishReason: event.finishReason } : {}),
      };
    case "response.aborted":
      return {
        type: "response_aborted",
        providerId,
        ...(event.responseId ? { responseId: event.responseId } : {}),
        ...(event.error ? { error: event.error } : {}),
      };
  }
}

export async function* normalizeProviderStream(
  providerId: string,
  stream: AsyncIterable<ProviderStreamEvent>,
): AsyncGenerator<StreamEvent> {
  for await (const providerEvent of stream) {
    yield normalizeProviderStreamEvent(providerId, providerEvent);
  }
}
