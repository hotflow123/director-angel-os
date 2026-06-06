import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDesktopUiStateFileStore,
  repairDesktopTranscriptFromRuntimeRuns,
  resolveConversationRuntimeRunsFilePath,
  resolveDesktopUiStateFilePath,
} from "./desktop-ui-state-store.js";

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("desktop UI state file store", () => {
  it("persists and reloads renderer UI state from the desktop data dir", () => {
    const root = mkdtempSync(join(tmpdir(), "director-ui-state-"));
    tempRoots.push(root);
    const store = createDesktopUiStateFileStore({ dataDir: root });

    store.write({
      schemaVersion: "director.desktop.ui-state.v1",
      chat: {
        composerDraft: "草稿",
        composerHistory: ["历史"],
        lastSubmittedMessage: "历史",
      },
      taskRuntime: {
        activePanel: "problem",
      },
      selectedSettingsTab: "externalTools",
    });

    expect(createDesktopUiStateFileStore({ dataDir: root }).read()).toMatchObject({
      chat: {
        composerDraft: "草稿",
        composerHistory: ["历史"],
      },
      taskRuntime: {
        activePanel: "problem",
      },
    });
    expect(resolveDesktopUiStateFilePath(root)).toContain(".hotflow");
  });

  it("fails soft when the persisted file is corrupted", () => {
    const root = mkdtempSync(join(tmpdir(), "director-ui-state-corrupt-"));
    tempRoots.push(root);
    const store = createDesktopUiStateFileStore({ dataDir: root });
    store.writeRaw("{not valid json");

    expect(store.read()).toBeNull();
  });

  it("repairs stale runtime shell transcript messages from conversation runtime runs", () => {
    const root = mkdtempSync(join(tmpdir(), "director-ui-state-repair-"));
    tempRoots.push(root);
    const store = createDesktopUiStateFileStore({ dataDir: root });
    const runsPath = resolveConversationRuntimeRunsFilePath(root);
    mkdirSync(join(root, ".hotflow", "conversation-runtime"), { recursive: true });

    store.write({
      schemaVersion: "director.desktop.ui-state.v1",
      chat: {
        sessionTranscripts: {
          "desktop:workbench:session-a": [
            { role: "user", title: "交给 Angel", body: "为什么失败？" },
            { role: "angel", title: "Angel 已回复", body: "模型调用完成。" },
          ],
        },
      },
    });
    writeFileSync(
      runsPath,
      JSON.stringify(
        {
          runs: [
            {
              sessionKey: "desktop:workbench:session-a",
              status: "failed",
              startedAtMs: 100,
              userVisibleSummary: "模型不可用：真实失败原因。",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(store.read().chat.sessionTranscripts["desktop:workbench:session-a"][1]).toMatchObject({
      role: "system",
      title: "Angel 没有回复成功",
      body: "模型不可用：真实失败原因。",
    });
    expect(readFileSync(resolveDesktopUiStateFilePath(root), "utf8")).toContain("真实失败原因");
  });

  it("does not invent transcript text when runtime has no user-visible final", () => {
    const snapshot = {
      chat: {
        sessionTranscripts: {
          "desktop:workbench:session-a": [
            { role: "user", title: "交给 Angel", body: "继续" },
            { role: "angel", title: "Angel 已回复", body: "模型调用完成。" },
          ],
        },
      },
    };

    expect(
      repairDesktopTranscriptFromRuntimeRuns(snapshot, [
        { sessionKey: "desktop:workbench:session-a", status: "completed", startedAtMs: 1 },
      ]),
    ).toMatchObject({
      changed: false,
      snapshot,
    });
  });

  it("repairs raw empty experience candidate tool output in transcripts", () => {
    const snapshot = {
      chat: {
        sessionTranscripts: {
          "desktop:workbench:session-a": [
            { role: "user", title: "交给 Angel", body: "刚才学到了什么？" },
            {
              role: "angel",
              title: "Angel 已回复",
              body: [
                "status: success",
                "summary: 当前没有匹配的待审经验候选。",
                "filter: pending",
                "total_candidates: 102",
                "pending_learning_confirmations: 0",
                "next_actions: 如果用户问刚才学到了什么，但这里为空，要明确说还没有可展示候选。",
              ].join("\n"),
            },
          ],
        },
      },
    };

    const repaired = repairDesktopTranscriptFromRuntimeRuns(snapshot, []);

    expect(repaired.changed).toBe(true);
    const body = snapshot.chat.sessionTranscripts["desktop:workbench:session-a"][1].body;
    expect(body).toContain("当前没有可展示的待审经验候选");
    expect(body).toContain("当前经验候选总数 102");
    expect(body).not.toContain("status: success");
    expect(body).not.toContain("next_actions");
  });

  it("repairs stale pending transcript messages from matching runtime runs", () => {
    const snapshot = {
      chat: {
        composerDraft: "学习这个https://x.com/example/status/1",
        sessionTranscripts: {
          "desktop:workbench:session-a": [
            { role: "user", title: "交给 Angel", body: "学习这个https://x.com/example/status/1" },
            { role: "angel", title: "Angel 正在处理", body: "正在等待工具或模型结果..." },
          ],
        },
      },
      taskRuntime: {
        recentTasks: [{ status: "completed" }],
      },
    };

    const repaired = repairDesktopTranscriptFromRuntimeRuns(snapshot, [
      {
        sessionKey: "desktop:workbench",
        status: "completed",
        startedAtMs: 1,
        finalText: "已读取这条 X 内容，核心是提示词模板。",
        metadata: { sourceUrl: "https://x.com/example/status/1" },
      },
    ]);

    expect(repaired.changed).toBe(true);
    expect(snapshot.chat.composerDraft).toBe("");
    expect(snapshot.chat.sessionTranscripts["desktop:workbench:session-a"][1]).toMatchObject({
      role: "angel",
      title: "Angel 已回复",
      body: "已读取这条 X 内容，核心是提示词模板。",
    });
  });

  it("closes stale pending transcript messages when no runtime final exists", () => {
    const snapshot = {
      chat: {
        sessionTranscripts: {
          "desktop:workbench:session-a": [
            { role: "user", title: "交给 Angel", body: "继续" },
            { role: "angel", title: "等待已结束", body: "正在等待工具或模型结果..." },
          ],
        },
      },
    };

    const repaired = repairDesktopTranscriptFromRuntimeRuns(snapshot, []);

    expect(repaired.changed).toBe(true);
    expect(snapshot.chat.sessionTranscripts["desktop:workbench:session-a"][1]).toMatchObject({
      role: "system",
      title: "Angel 没有回复成功",
      body: expect.stringContaining("没有收到可展示的最终回复"),
    });
  });

  it("collapses duplicate adjacent user and assistant transcript turns", () => {
    const snapshot = {
      chat: {
        sessionTranscripts: {
          "desktop:workbench:session-a": [
            { role: "user", title: "交给 Angel", body: "学习这个https://x.com/example/status/1" },
            { role: "angel", title: "Angel 已回复", body: "已读取这条内容。" },
            { role: "user", title: "交给 Angel", body: "学习这个https://x.com/example/status/1" },
            { role: "angel", title: "Angel 已回复", body: "已读取这条内容。" },
          ],
        },
      },
    };

    const repaired = repairDesktopTranscriptFromRuntimeRuns(snapshot, []);

    expect(repaired.changed).toBe(true);
    expect(snapshot.chat.sessionTranscripts["desktop:workbench:session-a"]).toHaveLength(2);
  });

  it("matches stale transcript replies by response order when some user turns have no reply", () => {
    const snapshot = {
      chat: {
        sessionTranscripts: {
          "desktop:workbench:session-a": [
            { role: "user", title: "交给 Angel", body: "学习这个链接" },
            { role: "user", title: "交给 Angel", body: "继续" },
            { role: "angel", title: "Angel 已回复", body: "前一次真实回答" },
            { role: "user", title: "交给 Angel", body: "为什么失败？" },
            { role: "angel", title: "Angel 已回复", body: "模型调用完成。" },
          ],
        },
      },
    };

    const repaired = repairDesktopTranscriptFromRuntimeRuns(snapshot, [
      {
        sessionKey: "desktop:workbench:session-a",
        status: "completed",
        startedAtMs: 1,
        userVisibleSummary: "前一次真实回答",
      },
      {
        sessionKey: "desktop:workbench:session-a",
        status: "failed",
        startedAtMs: 2,
        userVisibleSummary: "模型不可用：失败已真实收口。",
      },
    ]);

    expect(repaired.changed).toBe(true);
    expect(snapshot.chat.sessionTranscripts["desktop:workbench:session-a"][4]).toMatchObject({
      role: "system",
      title: "Angel 没有回复成功",
      body: "模型不可用：失败已真实收口。",
    });
  });
});
