import { describe, expect, test } from "vitest";

import {
  InvalidChannelRoutingHintError,
  buildChannelSessionKey,
  createChannelDeliveryResult,
  createChannelTransportEnvelope,
  resolveChannelSessionTarget,
  validateChannelRoutingHint,
} from "../src/index.js";

describe("channels-core routing", () => {
  test("builds deterministic direct session keys", () => {
    const hint = {
      agentId: "Agent-Main",
      channel: "webchat",
      routeKind: "direct" as const,
      peerId: "User_1",
    };

    validateChannelRoutingHint(hint);
    expect(buildChannelSessionKey(hint)).toBe("agent:agent-main:direct:user_1");
    expect(resolveChannelSessionTarget(hint)).toMatchObject({
      sessionKey: "agent:agent-main:direct:user_1",
      ownership: {
        agentId: "agent-main",
        channel: "webchat",
        routeKind: "direct",
        peerId: "user_1",
      },
    });
  });

  test("builds deterministic thread session keys", () => {
    const hint = {
      agentId: "agent-main",
      channel: "webchat",
      routeKind: "thread" as const,
      peerId: "user_1",
      baseSessionId: "sess_base-001",
      threadId: "Thread 7",
    };

    expect(buildChannelSessionKey(hint)).toBe(
      "agent:agent-main:thread:sess_base-001:thread-7:user_1",
    );
    expect(resolveChannelSessionTarget(hint)).toMatchObject({
      sessionKey: "agent:agent-main:thread:sess_base-001:thread-7:user_1",
      ownership: {
        routeKind: "thread",
        peerId: "user_1",
        baseSessionId: "sess_base-001",
        threadId: "thread-7",
      },
    });
  });

  test("keeps thread sessions isolated across peers sharing the same thread coordinates", () => {
    const firstPeerHint = {
      agentId: "agent-main",
      channel: "webchat",
      routeKind: "thread" as const,
      peerId: "user_1",
      baseSessionId: "sess_base-001",
      threadId: "Thread 7",
    };
    const secondPeerHint = {
      ...firstPeerHint,
      peerId: "user_2",
    };

    const firstTarget = resolveChannelSessionTarget(firstPeerHint);
    const secondTarget = resolveChannelSessionTarget(secondPeerHint);

    expect(firstTarget.sessionKey).toBe("agent:agent-main:thread:sess_base-001:thread-7:user_1");
    expect(secondTarget.sessionKey).toBe("agent:agent-main:thread:sess_base-001:thread-7:user_2");
    expect(firstTarget.sessionKey).not.toBe(secondTarget.sessionKey);
    expect(firstTarget.ownership).toMatchObject({
      agentId: "agent-main",
      peerId: "user_1",
      baseSessionId: "sess_base-001",
      threadId: "thread-7",
    });
    expect(secondTarget.ownership).toMatchObject({
      agentId: "agent-main",
      peerId: "user_2",
      baseSessionId: "sess_base-001",
      threadId: "thread-7",
    });
  });

  test("rejects invalid thread hints with structured error", () => {
    expect(() =>
      validateChannelRoutingHint({
        agentId: "agent-main",
        channel: "webchat",
        routeKind: "thread",
        peerId: "user_1",
        threadId: "thread-1",
      }),
    ).toThrowError(InvalidChannelRoutingHintError);

    expect(() =>
      validateChannelRoutingHint({
        agentId: "agent-main",
        channel: "webchat",
        routeKind: "direct",
        peerId: "user_1",
        baseSessionId: "sess_base-001",
      }),
    ).toThrowError('Direct routing does not allow "baseSessionId".');
  });

  test("creates transport envelope and delivery result with schema version", () => {
    const routingHint = {
      agentId: "agent-main",
      channel: "webchat",
      routeKind: "direct" as const,
      peerId: "user_1",
    };

    const envelope = createChannelTransportEnvelope({
      channel: "webchat",
      agentId: "agent-main",
      peerId: "user_1",
      messageId: "msg_1",
      receivedAtMs: 10,
      text: "hello",
      routingHint,
    });
    const delivery = createChannelDeliveryResult({
      channel: "webchat",
      status: "accepted",
      processedAtMs: 20,
      routeKind: "direct",
      sessionKey: "agent:agent-main:direct:user_1",
    });

    expect(envelope.schemaVersion).toBe("0.1.0");
    expect(delivery.schemaVersion).toBe("0.1.0");
    expect(delivery.status).toBe("accepted");
  });
});
