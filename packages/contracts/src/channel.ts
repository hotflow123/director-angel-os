import { CONTRACTS_SCHEMA_VERSION, type ContractsSchemaVersion } from "./schema-version.js";

export type ChannelRouteKind = "direct" | "thread";

export type ChannelDeliveryStatus = "accepted" | "ignored" | "failed" | "deferred";

export interface ChannelRoutingHint {
  readonly agentId: string;
  readonly channel: string;
  readonly routeKind: ChannelRouteKind;
  readonly peerId: string;
  readonly threadId?: string;
  readonly baseSessionId?: string;
}

export interface ChannelTransportEnvelope {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly channel: string;
  readonly agentId: string;
  readonly peerId: string;
  readonly messageId: string;
  readonly receivedAtMs: number;
  readonly text?: string;
  readonly routingHint: ChannelRoutingHint;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ChannelCapability {
  readonly channel: string;
  readonly supportsDirect: boolean;
  readonly supportsThreads: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsAttachments: boolean;
}

export interface ChannelSessionOwnership {
  readonly agentId: string;
  readonly channel: string;
  readonly routeKind: ChannelRouteKind;
  readonly peerId: string;
  readonly threadId?: string;
  readonly baseSessionId?: string;
}

export interface ChannelSessionTarget {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly sessionKey: string;
  readonly ownership: ChannelSessionOwnership;
}

export interface ChannelDeliveryResult {
  readonly schemaVersion: ContractsSchemaVersion;
  readonly channel: string;
  readonly status: ChannelDeliveryStatus;
  readonly processedAtMs: number;
  readonly sessionKey?: string;
  readonly routeKind?: ChannelRouteKind;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createChannelTransportEnvelope(
  input: Omit<ChannelTransportEnvelope, "schemaVersion">,
): ChannelTransportEnvelope {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...input,
  };
}

export function createChannelSessionTarget(
  input: Omit<ChannelSessionTarget, "schemaVersion">,
): ChannelSessionTarget {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...input,
  };
}

export function createChannelDeliveryResult(
  input: Omit<ChannelDeliveryResult, "schemaVersion">,
): ChannelDeliveryResult {
  return {
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...input,
  };
}
