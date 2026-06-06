import type { ToolCall } from "./types.js";

export type StreamEventType =
  | "response_started"
  | "text_delta"
  | "status_delta"
  | "tool_boundary"
  | "response_paused"
  | "response_resumed"
  | "response_completed"
  | "response_aborted";

export interface StreamEventBase {
  type: StreamEventType;
  providerId: string;
  responseId?: string;
}

export interface ResponseStartedEvent extends StreamEventBase {
  type: "response_started";
}

export interface TextDeltaEvent extends StreamEventBase {
  type: "text_delta";
  text: string;
}

export interface StatusDeltaEvent extends StreamEventBase {
  type: "status_delta";
  status: string;
}

export interface ToolBoundaryEvent extends StreamEventBase {
  type: "tool_boundary";
  toolCall: ToolCall;
}

export interface ResponsePausedEvent extends StreamEventBase {
  type: "response_paused";
  reason?: string;
}

export interface ResponseResumedEvent extends StreamEventBase {
  type: "response_resumed";
}

export interface ResponseCompletedEvent extends StreamEventBase {
  type: "response_completed";
  finishReason?: string;
}

export interface ResponseAbortedEvent extends StreamEventBase {
  type: "response_aborted";
  error?: string;
}

export type StreamEvent =
  | ResponseStartedEvent
  | TextDeltaEvent
  | StatusDeltaEvent
  | ToolBoundaryEvent
  | ResponsePausedEvent
  | ResponseResumedEvent
  | ResponseCompletedEvent
  | ResponseAbortedEvent;

export type ProviderStreamEvent =
  | { type: "response.started"; responseId?: string }
  | { type: "text.delta"; text: string; responseId?: string }
  | { type: "status.delta"; status: string; responseId?: string }
  | { type: "tool.call"; toolCall: ToolCall; responseId?: string }
  | { type: "response.paused"; reason?: string; responseId?: string }
  | { type: "response.resumed"; responseId?: string }
  | { type: "response.completed"; finishReason?: string; responseId?: string }
  | { type: "response.aborted"; error?: string; responseId?: string };
