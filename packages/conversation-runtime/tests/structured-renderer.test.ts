import { describe, expect, it } from "vitest";

import {
  renderConversationRuntimeApprovalDecisionText,
  renderConversationRuntimeApprovalText,
  renderConversationRuntimeStructuredStatusText,
} from "../src/index.js";

describe("conversation runtime structured renderer", () => {
  it("renders deterministic status text from typed status fields", () => {
    expect(
      renderConversationRuntimeStructuredStatusText({
        title: "Director run control:",
        status: "not-found",
        reason: "no active or requested run id was available",
        nextAction: "provide a production objective to create a new run",
        runId: "run-1234567890abcdef",
      }),
    ).toBe(
      [
        "Director run control:",
        "  status: not-found",
        "  reason: no active or requested run id was available",
        "  run id: run-1234567890abcdef",
        "  next action: provide a production objective to create a new run",
      ].join("\n"),
    );
  });

  it("renders pending tool approval events without adapter-owned prose", () => {
    const text = renderConversationRuntimeApprovalText(
      {
        turnId: "turn-approval",
        sessionKey: "session-1",
        replySource: "structured-renderer",
        events: [
          {
            id: "event-approval",
            kind: "runtime.approval",
            turnId: "turn-approval",
            sessionKey: "session-1",
            occurredAtMs: 1,
            payload: {
              approval: {
                id: "tool:call-skill-enable",
                title: "确认使用 director.skills.set_enabled",
                status: "pending",
                summary:
                  "director.skills.set_enabled 需要确认后才能执行。当前请求者不是可信操作员。",
                metadata: {
                  permissionStatus: "ask",
                  toolName: "director.skills.set_enabled",
                },
              },
            },
          },
        ],
        operatorTrace: { items: [] },
      },
      {
        trustedOperatorApproveText: "确认",
        trustedOperatorRejectText: "拒绝",
        desktopFallback: true,
      },
    );

    expect(text).toContain("Runtime tool approval:");
    expect(text).toContain("status: pending");
    expect(text).toContain("tool: director.skills.set_enabled");
    expect(text).toContain("桌面端确认");
    expect(text).toContain("回复「确认」继续执行");
    expect(text).toContain("回复「拒绝」取消");
    expect(text).not.toContain("可信操作员");
  });

  it("renders Agent OS process ledger evidence on pending approval cards", () => {
    const text = renderConversationRuntimeApprovalText(
      {
        turnId: "turn-approval-ledger",
        sessionKey: "session-1",
        replySource: "structured-renderer",
        events: [
          {
            id: "event-approval-ledger",
            kind: "runtime.approval",
            turnId: "turn-approval-ledger",
            sessionKey: "session-1",
            occurredAtMs: 1,
            payload: {
              approval: {
                id: "tool:call-host-command",
                title: "确认使用 host.exec",
                status: "pending",
                summary: "host.exec 需要确认后才能执行。",
                metadata: {
                  permissionStatus: "ask",
                  toolName: "host.exec",
                  decisionMetadata: {
                    agentOsProcessCapabilityLedger: {
                      generatedAt: "2026-05-08T00:00:00.000Z",
                      totalEntries: 1,
                      riskyHostEntries: 1,
                      entries: [
                        {
                          owner: "director-host-api",
                          runnerKind: "exec-file",
                          backend: "host",
                          status: "completed",
                          command: "echo ok",
                          operationId: "host-ledger-smoke",
                          process: { pid: 4242, ownedProcess: true },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
        operatorTrace: { items: [] },
      },
      {
        trustedOperatorApproveText: "确认",
        trustedOperatorRejectText: "拒绝",
        compact: true,
      },
    );

    expect(text).toContain("Agent OS 进程账本：total=1 host=1");
    expect(text).toContain(
      "exec-file backend=host status=completed command=echo ok operation=host-ledger-smoke pid=4242",
    );
  });

  it("renders human-first approval decisions while keeping machine status visible", () => {
    const text = renderConversationRuntimeApprovalDecisionText({
      title: "微信工具确认",
      status: "approved",
      actorKind: "trusted-operator",
      detail:
        "tool: director.skills.set_enabled\nresult: status: success\nsummary: Skill 已开启：Web Browser Skill。",
    });

    expect(text).toContain("微信工具确认");
    expect(text).toContain("status: approved");
    expect(text).toContain("可信操作员已确认，工具已执行。");
    expect(text).toContain("工具：director.skills.set_enabled");
    expect(text).toContain("结果：status: success");
    expect(text).not.toContain("trusted operator approved");
  });

  it("renders user-facing approval decisions without machine result fields", () => {
    const text = renderConversationRuntimeApprovalDecisionText({
      title: "微信工具确认",
      status: "approved",
      actorKind: "requester",
      includeMachineStatus: false,
      userFacing: true,
      detail: [
        "tool: director.skills.set_enabled",
        "result: status: success",
        "summary: Skill 已开启：Web Browser Skill。",
        "skill_id: skill.web-browser",
        "next_actions: 能力快照会在下一轮刷新。",
      ].join("\n"),
    });

    expect(text).toContain("微信工具确认");
    expect(text).toContain("已确认，工具已执行。");
    expect(text).toContain("工具：director.skills.set_enabled");
    expect(text).toContain("结果：Skill 已开启：Web Browser Skill。");
    expect(text).not.toContain("status:");
    expect(text).not.toContain("skill_id:");
    expect(text).not.toContain("next_actions:");
  });
});
