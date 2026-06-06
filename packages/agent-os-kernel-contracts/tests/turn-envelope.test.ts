import { describe, expect, it } from "vitest";

import {
  AGENT_OS_KERNEL_SCHEMA_VERSION,
  createAgentOsTurnEnvelope,
  isAgentOsTurnEnvelope,
} from "../src/index.js";

describe("agent os turn envelope", () => {
  it("normalizes a trusted desktop turn into the kernel envelope", () => {
    const envelope = createAgentOsTurnEnvelope({
      turnId: "turn-desktop-1",
      sessionKey: "desktop:operator:session-1",
      turnKind: "user-message",
      createdAt: "2026-05-08T09:00:00.000Z",
      actor: {
        actorId: "operator:local",
        kind: "user",
        trustLevel: "trusted-local",
      },
      channel: {
        adapterId: "director-desktop",
        channel: "desktop",
        routeKind: "direct",
        sourceId: "local-operator",
        threadId: "desktop-thread-1",
        deliveryTarget: {
          kind: "desktop",
          targetId: "local-operator",
        },
      },
      permissionContext: {
        mode: "ask",
        approvalBoundary: "mutating-tools",
        operatorScopes: ["workspace:write", "tools:execute"],
        remoteUnsafeCommandPolicy: "block",
      },
      memoryScope: {
        lane: "project",
        localOnly: true,
        enabledLayers: ["L0", "L1", "L2"],
        evidenceRequired: true,
      },
      workspaceScope: {
        workspaceId: "director-angel",
        root: "/workspace/director-angel-os",
        writableRoots: ["/workspace/director-angel-os"],
        readonlyRoots: ["/workspace/reference-openclaw"],
        networkPolicy: "limited",
      },
      budget: {
        maxModelCalls: 4,
        maxToolCalls: 12,
        maxCostUsd: 2,
        modelHints: ["reasoning:high", "provider:scripted"],
      },
      queueDirective: {
        lane: "session",
        mode: "enqueue",
        dropPolicy: "summarize",
      },
      policyVerdict: {
        verdict: "allow",
        reason: "trusted local operator may start the turn",
        decidedAt: "2026-05-08T09:00:00.000Z",
      },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-08T09:00:00.000Z",
      },
    });

    expect(envelope.schemaVersion).toBe(AGENT_OS_KERNEL_SCHEMA_VERSION);
    expect(envelope.channel.deliveryTarget.kind).toBe("desktop");
    expect(isAgentOsTurnEnvelope(envelope)).toBe(true);
  });

  it("keeps remote channel trust, delivery, and blocked policy in the same shape", () => {
    const envelope = createAgentOsTurnEnvelope({
      turnId: "turn-weixin-1",
      sessionKey: "weixin:dm:openid-1",
      turnKind: "slash-command",
      createdAt: "2026-05-08T09:05:00.000Z",
      actor: {
        actorId: "weixin:openid-1",
        kind: "user",
        trustLevel: "paired-channel",
      },
      channel: {
        adapterId: "weixin-gateway",
        channel: "weixin",
        routeKind: "direct",
        sourceId: "openid-1",
        threadId: "weixin-thread-1",
        deliveryTarget: {
          kind: "channel",
          channel: "weixin",
          targetId: "openid-1",
        },
      },
      permissionContext: {
        mode: "ask",
        approvalBoundary: "all-tools",
        operatorScopes: ["chat:reply"],
        remoteUnsafeCommandPolicy: "block",
      },
      memoryScope: {
        lane: "user",
        localOnly: true,
        enabledLayers: ["L0", "L1"],
        evidenceRequired: true,
      },
      workspaceScope: {
        workspaceId: "director-angel",
        root: "/workspace/director-angel-os",
        writableRoots: [],
        readonlyRoots: ["/workspace/director-angel-os"],
        networkPolicy: "disabled",
      },
      policyVerdict: {
        verdict: "blocked",
        reason: "remote channel cannot run unsafe slash command",
        decidedAt: "2026-05-08T09:05:01.000Z",
      },
      sandboxPreflight: {
        verdict: "blocked",
        sandboxMode: "disabled",
        checkedAt: "2026-05-08T09:05:01.000Z",
        reason: "unknown remote execution is fail-closed",
      },
    });

    expect(envelope.policyVerdict.verdict).toBe("blocked");
    expect(envelope.sandboxPreflight.verdict).toBe("blocked");
    expect(isAgentOsTurnEnvelope(envelope)).toBe(true);
  });
});
