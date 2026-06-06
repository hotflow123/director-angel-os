import { describe, expect, it } from "vitest";

import {
  applyDesktopUiPersistenceSnapshot,
  createDesktopUiPersistenceSnapshot,
} from "./persistence.js";

describe("desktop UI persistence OpenClaw local-storage parity", () => {
  it("serializes only restart-safe UI state", () => {
    const snapshot = createDesktopUiPersistenceSnapshot({
      chat: {
        composer: {
          input: "未发送草稿",
          history: ["上一条", "当前条"],
        },
        queue: [{ text: "不能持久化运行中队列" }],
        runId: "run-1",
        sessionKey: "desktop:workbench:a",
        sessions: [
          { key: "desktop:workbench:a", title: "A 会话", updatedAt: 100 },
          { key: "desktop:workbench:b", title: "B 会话", updatedAt: 90 },
        ],
        sessionTranscripts: {
          "desktop:workbench:a": [
            { role: "user", title: "交给 Angel", body: "学习这个 URL" },
            { role: "angel", title: "Angel 已回复", body: "学到了三点" },
          ],
        },
        lastSubmittedMessage: "当前条",
      },
      taskRuntime: {
        activePanel: "problem",
        tasks: [
          {
            id: "task-running",
            status: "running",
            category: "conversation-runtime",
            label: "Angel 回复",
            lane: "text",
            progress: 35,
            progressMode: "indeterminate",
            cancellable: true,
            createdAt: 100,
            startedAt: 110,
            updatedAt: 120,
            payload: {
              source: "desktop.conversation-runtime",
              turnId: "turn-1",
              promptPreview: "哪些地方最有用？",
            },
            events: [
              {
                type: "conversation.sent",
                message: "正在发送给 Native Bridge",
                occurredAt: "2026-05-23T10:00:00.000Z",
              },
            ],
          },
        ],
      },
      selectedSettingsTab: "externalTools",
    });

    expect(snapshot).toEqual({
      schemaVersion: "director.desktop.ui-state.v1",
      chat: {
        composerDraft: "未发送草稿",
        composerHistory: ["上一条", "当前条"],
        composerAttachments: [],
        lastSubmittedMessage: "当前条",
        sessionKey: "desktop:workbench:a",
        sessions: [
          { key: "desktop:workbench:a", title: "A 会话", updatedAt: 100 },
          { key: "desktop:workbench:b", title: "B 会话", updatedAt: 90 },
        ],
        sessionTranscripts: {
          "desktop:workbench:a": [
            { role: "user", title: "交给 Angel", body: "学习这个 URL" },
            { role: "angel", title: "Angel 已回复", body: "学到了三点" },
          ],
        },
      },
      taskRuntime: {
        activePanel: "problem",
        recentTasks: [
          {
            id: "task-running",
            status: "interrupted",
            category: "conversation-runtime",
            label: "Angel 回复",
            lane: "text",
            progress: 100,
            progressMode: "determinate",
            cancellable: false,
            createdAt: 100,
            startedAt: 110,
            updatedAt: 120,
            completedAt: 120,
            payload: {
              source: "desktop.conversation-runtime",
              turnId: "turn-1",
              promptPreview: "哪些地方最有用？",
              restoredFromUiState: true,
            },
            events: [
              {
                type: "conversation.sent",
                message: "正在发送给 Native Bridge",
                occurredAt: "2026-05-23T10:00:00.000Z",
              },
              {
                type: "desktop.restart",
                title: "桌面端重启后恢复诊断",
                message: "上次运行在桌面端重启前未完成，已作为中断历史保留。",
                occurredAt: 120,
              },
            ],
          },
        ],
      },
      selectedSettingsTab: "externalTools",
    });
    expect(JSON.stringify(snapshot)).not.toContain("run-1");
    expect(JSON.stringify(snapshot)).not.toContain("不能持久化运行中队列");
  });

  it("hydrates draft, history, last message, and right-side panel from a valid snapshot", () => {
    const state = {
      chat: {
        composer: {
          input: "",
          history: [],
          setInput(value) {
            this.input = value;
          },
        },
        lastSubmittedMessage: null,
        sessionKey: "desktop:workbench",
        sessions: [],
      },
      taskRuntime: {
        activePanel: "active",
        tasks: [],
      },
      selectedSettingsTab: "api",
    };

    applyDesktopUiPersistenceSnapshot(state, {
      schemaVersion: "director.desktop.ui-state.v1",
      chat: {
        composerDraft: "恢复草稿",
        composerHistory: ["历史 A"],
        lastSubmittedMessage: "历史 A",
        sessionKey: "desktop:workbench:a",
        sessions: [{ key: "desktop:workbench:a", title: "A 会话", updatedAt: 100 }],
        sessionTranscripts: {
          "desktop:workbench:a": [{ role: "angel", title: "Angel 已回复", body: "恢复回答" }],
        },
      },
      taskRuntime: {
        activePanel: "history",
        recentTasks: [
          {
            id: "task-1",
            status: "completed",
            label: "Angel 回复",
            lane: "text",
            payload: {
              source: "desktop.conversation-runtime",
              promptPreview: "学习这个 URL",
            },
            events: [{ type: "model.final", message: "已整理最终回复" }],
            createdAt: 100,
            startedAt: 100,
            updatedAt: 200,
            completedAt: 200,
          },
        ],
      },
      selectedSettingsTab: "models",
    });

    expect(state.chat.composer.input).toBe("恢复草稿");
    expect(state.chat.composer.history).toStrictEqual(["历史 A"]);
    expect(state.chat.lastSubmittedMessage).toBe("历史 A");
    expect(state.chat.sessionKey).toBe("desktop:workbench:a");
    expect(state.chat.sessions).toStrictEqual([
      { key: "desktop:workbench:a", title: "A 会话", updatedAt: 100 },
    ]);
    expect(state.chat.sessionTranscripts).toStrictEqual({
      "desktop:workbench:a": [{ role: "angel", title: "Angel 已回复", body: "恢复回答" }],
    });
    expect(state.taskRuntime.activePanel).toBe("history");
    expect(state.taskRuntime.tasks).toStrictEqual([
      {
        id: "task-1",
        status: "completed",
        label: "Angel 回复",
        lane: "text",
        payload: {
          source: "desktop.conversation-runtime",
          promptPreview: "学习这个 URL",
        },
        events: [{ type: "model.final", message: "已整理最终回复" }],
        createdAt: 100,
        startedAt: 100,
        updatedAt: 200,
        completedAt: 200,
        progress: 100,
        progressMode: "determinate",
        cancellable: false,
      },
    ]);
    expect(state.selectedSettingsTab).toBe("models");
  });

  it("persists composer attachment metadata without large payload bytes", () => {
    const snapshot = createDesktopUiPersistenceSnapshot({
      chat: {
        composer: {
          input: "分析附件",
          history: [],
          attachments: [
            {
              id: "path-att",
              type: "file",
              path: "/Users/example/Desktop/brief.pdf",
              fileName: "brief.pdf",
              mimeType: "application/pdf",
              sizeBytes: 12,
              dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
              contentEncoding: "base64",
              content: "JVBERi0xLjQK",
            },
            {
              id: "paste-att",
              type: "file",
              fileName: "clipboard-image.png",
              mimeType: "image/png",
              sizeBytes: 5,
              dataUrl: "data:image/png;base64,AQIDBAU=",
            },
          ],
        },
      },
      taskRuntime: {},
    });

    expect(snapshot.chat.composerAttachments).toStrictEqual([
      {
        id: "path-att",
        type: "file",
        path: "/Users/example/Desktop/brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
      },
      {
        id: "paste-att",
        type: "file",
        fileName: "clipboard-image.png",
        mimeType: "image/png",
        sizeBytes: 5,
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("JVBERi0xLjQK");
    expect(JSON.stringify(snapshot)).not.toContain("AQIDBAU=");
  });

  it("hydrates composer attachment metadata for restart-visible chips", () => {
    const state = {
      chat: {
        composer: {
          input: "",
          history: [],
          attachments: [],
          setInput(value) {
            this.input = value;
          },
        },
      },
      taskRuntime: {},
    };

    applyDesktopUiPersistenceSnapshot(state, {
      schemaVersion: "director.desktop.ui-state.v1",
      chat: {
        composerDraft: "继续分析",
        composerAttachments: [
          {
            id: "paste-att",
            type: "file",
            fileName: "clipboard-image.png",
            mimeType: "image/png",
            sizeBytes: 5,
            dataUrl: "data:image/png;base64,AQIDBAU=",
            content: "AQIDBAU=",
          },
        ],
      },
      taskRuntime: {},
    });

    expect(state.chat.composer.attachments).toStrictEqual([
      {
        id: "paste-att",
        type: "file",
        fileName: "clipboard-image.png",
        mimeType: "image/png",
        sizeBytes: 5,
      },
    ]);
  });
});
