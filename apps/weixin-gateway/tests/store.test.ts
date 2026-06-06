import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireWeixinGatewayLock,
  appendPeerConversationTurn,
  expireWeixinRuntimeToolApprovals,
  findPendingWeixinRuntimeToolApproval,
  getContextToken,
  listWeixinAccountIds,
  loadDeliveredWeixinSubagentAnnounceIds,
  loadPeerConversationTurns,
  loadPeerSession,
  loadSelectedWeixinAccountId,
  loadSyncBuf,
  loadWeixinAccount,
  loadWeixinRuntimeToolApprovals,
  markWeixinSubagentAnnouncesDelivered,
  saveContextToken,
  savePeerSession,
  saveSyncBuf,
  saveWeixinAccount,
  saveWeixinRuntimeToolApproval,
  selectWeixinAccount,
  updateWeixinRuntimeToolApproval,
} from "../src/store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("weixin account store", () => {
  it("keeps only one active gateway lock per account and releases it safely", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "abc@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });

    const first = acquireWeixinGatewayLock(home, account.normalizedAccountId, {
      workspaceRoot: "/tmp/director-one",
    });
    try {
      expect(() =>
        acquireWeixinGatewayLock(home, account.normalizedAccountId, {
          workspaceRoot: "/tmp/director-two",
        }),
      ).toThrow(/already running/iu);
    } finally {
      first.release();
    }

    const second = acquireWeixinGatewayLock(home, account.normalizedAccountId, {
      workspaceRoot: "/tmp/director-two",
    });
    second.release();
  });

  it("saves accounts, sync cursors, and context tokens under the Director workspace", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);

    const saved = saveWeixinAccount(home, {
      accountId: "abc@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
      userId: "user@im.wechat",
    });

    expect(saved.normalizedAccountId).toBe("abc-im.bot");
    expect(listWeixinAccountIds(home)).toEqual(["abc-im.bot"]);
    expect(loadWeixinAccount(home, "abc@im.bot")?.token).toBe("token-1");

    saveSyncBuf(home, saved.normalizedAccountId, "sync-1");
    expect(loadSyncBuf(home, saved.normalizedAccountId)).toBe("sync-1");

    saveContextToken(home, saved.normalizedAccountId, "friend@im.wechat", "ctx-1");
    expect(getContextToken(home, saved.normalizedAccountId, "friend@im.wechat")).toBe("ctx-1");
  });

  it("uses the most recently saved account as the default account", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);

    saveWeixinAccount(home, {
      accountId: "old@im.bot",
      token: "old-token",
      baseUrl: "https://ilink.example.com",
      userId: "old-user@im.wechat",
    });
    saveWeixinAccount(home, {
      accountId: "new@im.bot",
      token: "new-token",
      baseUrl: "https://ilink.example.com",
      userId: "new-user@im.wechat",
    });

    expect(listWeixinAccountIds(home)).toEqual(["new-im.bot", "old-im.bot"]);
    expect(loadWeixinAccount(home)?.token).toBe("new-token");
    expect(loadSelectedWeixinAccountId(home)).toBe("new-im.bot");
    expect(loadWeixinAccount(home, "old@im.bot")?.token).toBe("old-token");
  });

  it("keeps an explicitly selected older account until the user switches again", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);

    saveWeixinAccount(home, {
      accountId: "old@im.bot",
      token: "old-token",
      baseUrl: "https://ilink.example.com",
      userId: "old-user@im.wechat",
    });
    saveWeixinAccount(home, {
      accountId: "new@im.bot",
      token: "new-token",
      baseUrl: "https://ilink.example.com",
      userId: "new-user@im.wechat",
    });
    const selected = selectWeixinAccount(home, "old@im.bot");

    expect(selected.normalizedAccountId).toBe("old-im.bot");
    expect(loadSelectedWeixinAccountId(home)).toBe("old-im.bot");
    expect(loadWeixinAccount(home)?.token).toBe("old-token");
    expect(listWeixinAccountIds(home)).toEqual(["new-im.bot", "old-im.bot"]);
  });

  it("persists per-peer Director session state for follow-up confirmations", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);

    const account = saveWeixinAccount(home, {
      accountId: "abc@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });

    savePeerSession(home, account.normalizedAccountId, "friend@im.wechat", {
      peerId: "friend@im.wechat",
      entrySessionId: "entry-1",
      blueprintId: "blueprint-1",
      runId: "run-1",
      lastObjective: "生成一个15秒短剧分镜蓝图",
      pendingApprovalAssignmentIds: ["assignment-script", "assignment-shot"],
      updatedAt: "2026-04-29T00:00:00.000Z",
    });

    expect(loadPeerSession(home, account.normalizedAccountId, "friend@im.wechat")).toMatchObject({
      peerId: "friend@im.wechat",
      entrySessionId: "entry-1",
      blueprintId: "blueprint-1",
      runId: "run-1",
      lastObjective: "生成一个15秒短剧分镜蓝图",
      pendingApprovalAssignmentIds: ["assignment-script", "assignment-shot"],
    });
  });

  it("keeps a bounded short-term per-peer conversation transcript separate from run state", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "abc@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });

    for (let index = 0; index < 9; index += 1) {
      appendPeerConversationTurn(home, account.normalizedAccountId, "friend@im.wechat", {
        role: "user",
        text: `第 ${index} 条对话`,
        messageId: `msg-${index}`,
        createdAt: `2026-05-03T00:00:0${index}.000Z`,
      });
    }

    const turns = loadPeerConversationTurns(home, account.normalizedAccountId, "friend@im.wechat");
    expect(turns).toHaveLength(8);
    expect(turns[0]?.text).toBe("第 1 条对话");
    expect(turns.at(-1)).toMatchObject({
      role: "user",
      text: "第 8 条对话",
      messageId: "msg-8",
    });
    expect(loadPeerSession(home, account.normalizedAccountId, "friend@im.wechat")).toBeNull();
  });

  it("persists rich runtime transcript messages for per-peer follow-up turns", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "abc@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });

    appendPeerConversationTurn(home, account.normalizedAccountId, "friend@im.wechat", {
      role: "assistant",
      text: "已搜索。",
      createdAt: "2026-05-03T00:00:00.000Z",
      transcriptMessages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-search",
              name: "web_search",
              args: { query: "Seedance 2.0" },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call-search",
          content: "provider: sogou-weixin\nresult_count: 1",
        },
      ],
    });

    const turns = loadPeerConversationTurns(home, account.normalizedAccountId, "friend@im.wechat");
    expect(turns.at(-1)?.transcriptMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        toolCalls: [
          expect.objectContaining({
            id: "call-search",
            name: "web_search",
            args: { query: "Seedance 2.0" },
          }),
        ],
      }),
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-search",
        content: "provider: sogou-weixin\nresult_count: 1",
      }),
    ]);
  });

  it("persists delivered subagent announce ids per peer", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "abc@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });

    expect(
      loadDeliveredWeixinSubagentAnnounceIds(home, account.normalizedAccountId, "friend@im.wechat"),
    ).toEqual([]);
    markWeixinSubagentAnnouncesDelivered(home, account.normalizedAccountId, "friend@im.wechat", [
      "announce-a",
      "announce-b",
    ]);
    markWeixinSubagentAnnouncesDelivered(home, account.normalizedAccountId, "friend@im.wechat", [
      "announce-a",
      "announce-c",
    ]);

    expect(
      loadDeliveredWeixinSubagentAnnounceIds(home, account.normalizedAccountId, "friend@im.wechat"),
    ).toEqual(["announce-a", "announce-b", "announce-c"]);
    expect(
      loadDeliveredWeixinSubagentAnnounceIds(home, account.normalizedAccountId, "other@im.wechat"),
    ).toEqual([]);
  });

  it("persists runtime tool approvals by account and returns the latest pending item", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "abc@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });

    saveWeixinRuntimeToolApproval(home, account.normalizedAccountId, {
      schemaVersion: "director.weixin.runtime-tool-approval.v1",
      approvalId: "tool:old",
      status: "pending",
      peerId: "friend@im.wechat",
      title: "确认使用旧工具",
      summary: "旧工具等待确认。",
      toolName: "director.skills.set_enabled",
      toolCall: {
        id: "old",
        name: "director.skills.set_enabled",
        args: { skillId: "skill.old", enabled: true },
      },
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
    });
    saveWeixinRuntimeToolApproval(home, account.normalizedAccountId, {
      schemaVersion: "director.weixin.runtime-tool-approval.v1",
      approvalId: "tool:new",
      status: "pending",
      peerId: "owner@im.wechat",
      requestedByPeerId: "stranger@im.wechat",
      title: "确认使用新工具",
      summary: "新工具等待确认。",
      toolName: "director.skills.set_enabled",
      toolCall: {
        id: "new",
        name: "director.skills.set_enabled",
        args: { skillId: "skill.web", enabled: true },
      },
      createdAt: "2026-05-04T00:00:01.000Z",
      updatedAt: "2026-05-04T00:00:01.000Z",
    });

    expect(loadWeixinRuntimeToolApprovals(home, account.normalizedAccountId)).toHaveLength(2);
    expect(
      findPendingWeixinRuntimeToolApproval(home, account.normalizedAccountId, undefined, {
        now: "2026-05-04T00:00:02.000Z",
      })?.approvalId,
    ).toBe("tool:new");
    expect(
      findPendingWeixinRuntimeToolApproval(
        home,
        account.normalizedAccountId,
        "stranger@im.wechat",
        { now: "2026-05-04T00:00:02.000Z" },
      )?.approvalId,
    ).toBe("tool:new");

    const updated = updateWeixinRuntimeToolApproval(
      home,
      account.normalizedAccountId,
      "tool:new",
      (approval) => ({
        ...approval,
        status: "approved",
        updatedAt: "2026-05-04T00:00:02.000Z",
      }),
    );
    expect(updated?.status).toBe("approved");
    expect(
      findPendingWeixinRuntimeToolApproval(home, account.normalizedAccountId, undefined, {
        now: "2026-05-04T00:00:03.000Z",
      })?.approvalId,
    ).toBe("tool:old");
  });

  it("expires stale pending runtime tool approvals before lookup", () => {
    const home = mkdtempSync(join(tmpdir(), "director-weixin-store-"));
    roots.push(home);
    const account = saveWeixinAccount(home, {
      accountId: "abc@im.bot",
      token: "token-1",
      baseUrl: "https://ilink.example.com",
    });

    saveWeixinRuntimeToolApproval(home, account.normalizedAccountId, {
      schemaVersion: "director.weixin.runtime-tool-approval.v1",
      approvalId: "tool:stale",
      status: "pending",
      peerId: "friend@im.wechat",
      title: "确认使用旧工具",
      summary: "旧工具等待确认。",
      toolName: "director.skills.set_enabled",
      toolCall: {
        id: "stale",
        name: "director.skills.set_enabled",
        args: { skillId: "skill.old", enabled: true },
      },
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
    });
    saveWeixinRuntimeToolApproval(home, account.normalizedAccountId, {
      schemaVersion: "director.weixin.runtime-tool-approval.v1",
      approvalId: "tool:fresh",
      status: "pending",
      peerId: "friend@im.wechat",
      title: "确认使用新工具",
      summary: "新工具等待确认。",
      toolName: "director.skills.set_enabled",
      toolCall: {
        id: "fresh",
        name: "director.skills.set_enabled",
        args: { skillId: "skill.web", enabled: true },
      },
      createdAt: "2026-05-04T00:35:00.000Z",
      updatedAt: "2026-05-04T00:35:00.000Z",
    });

    const result = expireWeixinRuntimeToolApprovals(home, account.normalizedAccountId, {
      now: "2026-05-04T01:00:00.000Z",
      maxAgeMs: 30 * 60 * 1000,
    });

    expect(result.expiredCount).toBe(1);
    expect(loadWeixinRuntimeToolApprovals(home, account.normalizedAccountId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          approvalId: "tool:stale",
          status: "expired",
          decidedAt: "2026-05-04T01:00:00.000Z",
        }),
        expect.objectContaining({
          approvalId: "tool:fresh",
          status: "pending",
        }),
      ]),
    );
    expect(
      findPendingWeixinRuntimeToolApproval(home, account.normalizedAccountId, undefined, {
        now: "2026-05-04T01:00:00.000Z",
        maxAgeMs: 30 * 60 * 1000,
      })?.approvalId,
    ).toBe("tool:fresh");
  });
});
