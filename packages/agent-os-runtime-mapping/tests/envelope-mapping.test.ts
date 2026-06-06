import { describe, expect, it } from "vitest";

import { createChannelTransportEnvelope } from "@hotflow/contracts";

import {
  createAgentOsTurnEnvelopeFromChannelTransport,
  createAgentOsTurnEnvelopeFromRuntimeInput,
} from "../src/index.js";

describe("Agent OS runtime envelope mapping", () => {
  it("maps a Weixin channel message into a paired-channel Agent OS turn envelope", () => {
    const envelope = createAgentOsTurnEnvelopeFromChannelTransport({
      hostId: "director-host",
      surface: "weixin",
      message: createChannelTransportEnvelope({
        channel: "weixin",
        agentId: "director",
        peerId: "openid-1",
        messageId: "msg-1",
        receivedAtMs: 1_778_220_000_000,
        text: "/run status",
        routingHint: {
          agentId: "director",
          channel: "weixin",
          routeKind: "direct",
          peerId: "openid-1",
        },
        metadata: {
          source: "director-weixin-gateway",
        },
      }),
      workspaceRoot: "/repo",
      dataDir: "/repo/.hotflow",
    });

    expect(envelope.turnId).toBe("weixin:msg-1");
    expect(envelope.sessionKey).toBe("agent:director:direct:openid-1");
    expect(envelope.turnKind).toBe("slash-command");
    expect(envelope.actor).toMatchObject({
      actorId: "weixin:openid-1",
      kind: "user",
      trustLevel: "paired-channel",
    });
    expect(envelope.channel.deliveryTarget).toMatchObject({
      kind: "channel",
      channel: "weixin",
      targetId: "openid-1",
    });
    expect(envelope.permissionContext.remoteUnsafeCommandPolicy).toBe("block");
    expect(envelope.workspaceScope.writableRoots).toEqual([]);
    expect(envelope.policyVerdict.verdict).toBe("needs_approval");
    expect(envelope.sandboxPreflight.verdict).toBe("blocked");
  });

  it("maps a desktop runtime input into a trusted-local Agent OS turn envelope", () => {
    const envelope = createAgentOsTurnEnvelopeFromRuntimeInput({
      turnId: "desktop-turn-1",
      input: {
        surface: "desktop",
        channel: "desktop",
        messageId: "msg-desktop-1",
        sessionKey: "desktop:local:session-1",
        text: "继续推进上一条任务",
        receivedAtMs: 1_778_220_001_000,
        sender: {
          id: "operator-local",
          role: "operator",
        },
        trustedContext: {
          workspaceRoot: "/repo",
          dataDir: "/repo/.hotflow",
        },
      },
    });

    expect(envelope.turnId).toBe("desktop-turn-1");
    expect(envelope.turnKind).toBe("user-message");
    expect(envelope.actor.trustLevel).toBe("trusted-local");
    expect(envelope.channel.deliveryTarget.kind).toBe("desktop");
    expect(envelope.workspaceScope.writableRoots).toEqual(["/repo"]);
    expect(envelope.policyVerdict.verdict).toBe("allow");
    expect(envelope.sandboxPreflight.sandboxMode).toBe("workspace-write");
  });

  it("maps Host API runtime input as a trusted local host target", () => {
    const envelope = createAgentOsTurnEnvelopeFromRuntimeInput({
      input: {
        surface: "host-api",
        channel: "host-api",
        messageId: "host-msg-1",
        sessionKey: "agent:director:direct:host-user",
        text: "生成执行蓝图",
        receivedAtMs: 1_778_220_002_000,
        sender: {
          id: "host-user",
          role: "operator",
        },
        trustedContext: {
          workspaceRoot: "/repo",
          dataDir: "/repo/.hotflow",
        },
      },
    });

    expect(envelope.turnId).toBe("host-api:host-msg-1");
    expect(envelope.channel.deliveryTarget.kind).toBe("host");
    expect(envelope.actor.trustLevel).toBe("trusted-local");
    expect(envelope.permissionContext.operatorScopes).toContain("workspace:write");
  });

  it("treats generic API runtime input as untrusted unless it uses the explicit host-api surface", () => {
    const envelope = createAgentOsTurnEnvelopeFromRuntimeInput({
      input: {
        surface: "api",
        channel: "api",
        messageId: "api-msg-1",
        sessionKey: "api:remote:session-1",
        text: "/run sandbox-run --job job-1",
        receivedAtMs: 1_778_220_002_500,
        sender: {
          id: "remote-api-client",
          role: "operator",
        },
        trustedContext: {
          workspaceRoot: "/repo",
          dataDir: "/repo/.hotflow",
        },
      },
    });

    expect(envelope.actor.trustLevel).toBe("untrusted-remote");
    expect(envelope.permissionContext.remoteUnsafeCommandPolicy).toBe("block");
    expect(envelope.workspaceScope.writableRoots).toEqual([]);
    expect(envelope.sandboxPreflight).toMatchObject({
      verdict: "blocked",
      sandboxMode: "disabled",
    });
  });

  it("does not promote paired-channel runtime input to trusted-local when route metadata is present", () => {
    const envelope = createAgentOsTurnEnvelopeFromRuntimeInput({
      turnId: "weixin-runtime-turn-1",
      input: {
        surface: "weixin",
        channel: "weixin",
        messageId: "wx-msg-1",
        sessionKey: "weixin:account-1:openid-1",
        text: "/run sandbox-run --job job-1",
        receivedAtMs: 1_778_220_003_000,
        accountId: "account-1",
        sender: {
          id: "openid-1",
          role: "operator",
        },
        trustedContext: {
          accountId: "account-1",
          workspaceRoot: "/repo",
          dataDir: "/repo/.hotflow",
          metadata: {
            route: {
              sessionKey: "weixin:account-1:openid-1",
              routeKind: "direct",
            },
          },
        },
        untrustedChannelContext: {
          channel: "weixin",
          rawMessageId: "wx-msg-1",
          rawSenderId: "openid-1",
          payload: {
            metadata: {
              source: "director-weixin-gateway",
            },
          },
        },
      },
    });

    expect(envelope.actor.trustLevel).toBe("paired-channel");
    expect(envelope.permissionContext.remoteUnsafeCommandPolicy).toBe("block");
    expect(envelope.permissionContext.operatorScopes).toEqual(["chat:reply"]);
    expect(envelope.workspaceScope.writableRoots).toEqual([]);
    expect(envelope.workspaceScope.networkPolicy).toBe("disabled");
    expect(envelope.policyVerdict.verdict).toBe("needs_approval");
    expect(envelope.sandboxPreflight).toMatchObject({
      verdict: "blocked",
      sandboxMode: "disabled",
    });
  });
});
