import { describe, expect, it } from "vitest";

import {
  buildChannelRuntimeToolApprovalReply,
  expireChannelRuntimeToolApprovalRecords,
  parseChannelRuntimeToolApprovalIntent,
} from "../src/runtime-tool-approval.js";
import type { ChannelRuntimeToolApprovalRecord } from "../src/runtime-tool-approval.js";

function approval(
  overrides: Partial<ChannelRuntimeToolApprovalRecord> = {},
): ChannelRuntimeToolApprovalRecord {
  return {
    schemaVersion: "director.channel.runtime-tool-approval.v1",
    approvalId: "tool:one",
    status: "pending",
    channel: "personal-weixin",
    peerId: "friend@im.wechat",
    requestedByPeerId: "stranger@im.wechat",
    title: "确认使用 director.skills.set_enabled",
    summary: "启用浏览 Skill。",
    toolName: "director.skills.set_enabled",
    toolCall: {
      id: "call-1",
      name: "director.skills.set_enabled",
      args: { skillId: "skill.web-browser", enabled: true },
    },
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("channel runtime tool approvals", () => {
  it("parses concise approve and reject wording across chat channels", () => {
    expect(parseChannelRuntimeToolApprovalIntent("确认")).toEqual({ decision: "approve" });
    expect(parseChannelRuntimeToolApprovalIntent("确认工具")).toEqual({ decision: "approve" });
    expect(parseChannelRuntimeToolApprovalIntent("继续这个操作")).toEqual({
      decision: "approve",
    });
    expect(parseChannelRuntimeToolApprovalIntent("拒绝")).toEqual({ decision: "reject" });
    expect(parseChannelRuntimeToolApprovalIntent("拒绝工具")).toEqual({ decision: "reject" });
    expect(parseChannelRuntimeToolApprovalIntent("不要执行")).toEqual({ decision: "reject" });
    expect(parseChannelRuntimeToolApprovalIntent("我想聊聊")).toBeNull();
  });

  it("expires stale pending records while preserving audit history", () => {
    const result = expireChannelRuntimeToolApprovalRecords(
      [
        approval({ approvalId: "tool:old", updatedAt: "2026-05-04T00:00:00.000Z" }),
        approval({ approvalId: "tool:fresh", updatedAt: "2026-05-04T00:40:00.000Z" }),
        approval({
          approvalId: "tool:done",
          status: "approved",
          updatedAt: "2026-05-04T00:00:00.000Z",
        }),
      ],
      {
        now: "2026-05-04T01:00:00.000Z",
        maxAgeMs: 30 * 60 * 1000,
      },
    );

    expect(result.expiredCount).toBe(1);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          approvalId: "tool:old",
          status: "expired",
          decidedAt: "2026-05-04T01:00:00.000Z",
        }),
        expect.objectContaining({ approvalId: "tool:fresh", status: "pending" }),
        expect.objectContaining({ approvalId: "tool:done", status: "approved" }),
      ]),
    );
    expect(JSON.stringify(result.records)).toContain("runtime-tool-approval-timeout");
  });

  it("creates result-first channel replies without leaking tool args", () => {
    const reply = buildChannelRuntimeToolApprovalReply({
      permissionStatus: "ask",
      toolName: "director.skills.set_enabled",
      summary: "启用浏览互联网能力需要确认。",
      untrustedRequester: true,
      desktopFallback: true,
    });

    expect(reply).toContain("已先停住");
    expect(reply).toContain("确认");
    expect(reply).toContain("拒绝");
    expect(reply).toContain("桌面端");
    expect(reply).not.toContain("可信操作员");
    expect(reply).not.toContain("skill.web-browser");
  });
});
