import {
  type ChannelRoutingHint,
  type ChannelSessionTarget,
  createChannelSessionTarget,
} from "@hotflow/contracts";
import { assertSessionId } from "@hotflow/sessions";

import { InvalidChannelRoutingHintError } from "./errors.js";

const ROUTE_KINDS = new Set(["direct", "thread"]);
const SEGMENT_SANITIZER = /[^a-z0-9._-]/gu;

interface NormalizedChannelRoutingHint {
  readonly agentId: string;
  readonly channel: string;
  readonly routeKind: "direct" | "thread";
  readonly peerId: string;
  readonly threadId?: string;
  readonly baseSessionId?: string;
}

export function validateChannelRoutingHint(hint: ChannelRoutingHint): void {
  normalizeChannelRoutingHint(hint);
}

export function buildChannelSessionKey(hint: ChannelRoutingHint): string {
  const normalized = normalizeChannelRoutingHint(hint);

  if (normalized.routeKind === "direct") {
    return `agent:${normalized.agentId}:direct:${normalized.peerId}`;
  }

  return `agent:${normalized.agentId}:thread:${normalized.baseSessionId}:${normalized.threadId}:${normalized.peerId}`;
}

export function resolveChannelSessionTarget(hint: ChannelRoutingHint): ChannelSessionTarget {
  const normalized = normalizeChannelRoutingHint(hint);

  return createChannelSessionTarget({
    sessionKey: buildChannelSessionKey(normalized),
    ownership: {
      agentId: normalized.agentId,
      channel: normalized.channel,
      routeKind: normalized.routeKind,
      peerId: normalized.peerId,
      ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
      ...(normalized.baseSessionId ? { baseSessionId: normalized.baseSessionId } : {}),
    },
  });
}

function normalizeChannelRoutingHint(hint: ChannelRoutingHint): NormalizedChannelRoutingHint {
  if (!isRecord(hint)) {
    throw new InvalidChannelRoutingHintError("Channel routing hint must be an object.");
  }

  const routeKind = normalizeRouteKind(hint.routeKind);
  const agentId = normalizeSegment(hint.agentId, "agentId");
  const channel = normalizeSegment(hint.channel, "channel");
  const peerId = normalizeSegment(hint.peerId, "peerId");

  if (routeKind === "direct") {
    if (hint.threadId !== undefined) {
      throw new InvalidChannelRoutingHintError('Direct routing does not allow "threadId".', {
        hint,
      });
    }
    if (hint.baseSessionId !== undefined) {
      throw new InvalidChannelRoutingHintError('Direct routing does not allow "baseSessionId".', {
        hint,
      });
    }

    return {
      agentId,
      channel,
      routeKind,
      peerId,
    };
  }

  const threadId = normalizeSegment(hint.threadId, "threadId");
  const baseSessionId = requireBaseSessionId(hint.baseSessionId, hint);

  return {
    agentId,
    channel,
    routeKind,
    peerId,
    threadId,
    baseSessionId,
  };
}

function normalizeRouteKind(value: unknown): "direct" | "thread" {
  if (typeof value !== "string") {
    throw new InvalidChannelRoutingHintError('Channel routing hint must include "routeKind".');
  }

  const normalized = value.trim().toLowerCase();
  if (!ROUTE_KINDS.has(normalized)) {
    throw new InvalidChannelRoutingHintError(
      `Unsupported routeKind "${value}". Expected "direct" or "thread".`,
      { routeKind: value },
    );
  }

  return normalized as "direct" | "thread";
}

function normalizeSegment(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new InvalidChannelRoutingHintError(
      `Channel routing hint must include "${field}" as a string.`,
    );
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(SEGMENT_SANITIZER, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");

  if (normalized.length === 0) {
    throw new InvalidChannelRoutingHintError(
      `Channel routing hint field "${field}" cannot be empty.`,
      { field },
    );
  }

  return normalized;
}

function requireBaseSessionId(value: unknown, hint: ChannelRoutingHint): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidChannelRoutingHintError('Thread routing requires "baseSessionId".', { hint });
  }

  const baseSessionId = value.trim();
  try {
    assertSessionId(baseSessionId);
  } catch (error) {
    throw new InvalidChannelRoutingHintError(
      `Thread routing baseSessionId is invalid: ${String((error as Error).message)}`,
      { hint, baseSessionId },
    );
  }

  return baseSessionId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
