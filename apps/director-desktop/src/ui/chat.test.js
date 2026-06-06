import { describe, expect, it } from "vitest";

import {
  clearDesktopChatQueueItemsForRun,
  createDesktopChatSession,
  createDesktopChatState,
  deleteDesktopChatSession,
  handleDesktopChatSubmit,
  ensureDesktopChatSessions,
  isDesktopChatRetryCommand,
  isDesktopChatResetCommand,
  isChatStopCommand,
  renameDesktopChatSession,
  reconcileDesktopChatRunLifecycle,
  selectDesktopChatSession,
  updateDesktopChatSessionFromPrompt,
} from "./chat.js";

describe("desktop chat OpenClaw parity", () => {
  it("treats stop aliases as abort commands", () => {
    expect(isChatStopCommand("/stop")).toBe(true);
    expect(isChatStopCommand("stop")).toBe(true);
    expect(isChatStopCommand("abort")).toBe(true);
    expect(isChatStopCommand("继续")).toBe(false);
  });

  it("treats new conversation aliases as reset commands", () => {
    expect(isDesktopChatResetCommand("/new")).toBe(true);
    expect(isDesktopChatResetCommand("/reset")).toBe(true);
    expect(isDesktopChatResetCommand("new")).toBe(false);
    expect(isDesktopChatResetCommand("继续")).toBe(false);
  });

  it("treats retry aliases as a local resend command", () => {
    expect(isDesktopChatRetryCommand("/retry")).toBe(true);
    expect(isDesktopChatRetryCommand("retry")).toBe(true);
    expect(isDesktopChatRetryCommand("重试")).toBe(true);
    expect(isDesktopChatRetryCommand("再试一次")).toBe(true);
    expect(isDesktopChatRetryCommand("继续")).toBe(false);
  });

  it("sends idle messages immediately and clears the composer draft", async () => {
    const chat = createDesktopChatState();
    chat.composer.setInput("测试：只回复 OK");
    const sent = [];

    const result = await handleDesktopChatSubmit(chat, {
      send: async (message) => {
        sent.push(message);
        return { ok: true };
      },
    });

    expect(result).toMatchObject({ action: "sent", message: "测试：只回复 OK" });
    expect(sent).toStrictEqual(["测试：只回复 OK"]);
    expect(chat.lastSubmittedMessage).toBe("测试：只回复 OK");
    expect(chat.composer.input).toBe("");
    expect(chat.queue).toStrictEqual([]);
  });

  it("snapshots attachments when sending and clears them from the composer", async () => {
    const chat = createDesktopChatState();
    chat.composer.setInput("分析这个截图");
    chat.composer.attachments = [
      {
        id: "att-1",
        type: "file",
        path: "/Users/example/Desktop/capture.png",
        fileName: "capture.png",
      },
    ];
    const sent = [];

    const result = await handleDesktopChatSubmit(chat, {
      send: async (message, options) => {
        sent.push({ message, options });
        return { ok: true };
      },
    });

    expect(result).toMatchObject({ action: "sent", message: "分析这个截图" });
    expect(sent).toStrictEqual([
      {
        message: "分析这个截图",
        options: {
          attachments: [
            {
              id: "att-1",
              type: "file",
              path: "/Users/example/Desktop/capture.png",
              fileName: "capture.png",
            },
          ],
        },
      },
    ]);
    expect(chat.composer.input).toBe("");
    expect(chat.composer.attachments).toStrictEqual([]);
  });

  it("materializes snapshotted attachment payloads before sending", async () => {
    const chat = createDesktopChatState();
    chat.composer.setInput("分析这个附件");
    chat.composer.attachments = [
      {
        id: "att-1",
        type: "file",
        path: "/Users/example/Desktop/brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      },
    ];
    const sent = [];

    await handleDesktopChatSubmit(chat, {
      send: async (message, options) => {
        sent.push({ message, options });
        return { ok: true };
      },
    });

    expect(sent[0].options.attachments).toStrictEqual([
      {
        id: "att-1",
        type: "file",
        path: "/Users/example/Desktop/brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        contentEncoding: "base64",
        content: "JVBERi0xLjQK",
      },
    ]);
  });

  it("sends pasted payload-backed attachments that do not have desktop paths", async () => {
    const chat = createDesktopChatState();
    chat.composer.setInput("看这张剪贴板图片");
    chat.composer.attachments = [
      {
        id: "composer-paste-1onnx1x",
        type: "file",
        fileName: "clipboard-image.png",
        mimeType: "image/png",
        sizeBytes: 5,
        dataUrl: "data:image/png;base64,AQIDBAU=",
      },
    ];
    const sent = [];

    await handleDesktopChatSubmit(chat, {
      send: async (message, options) => {
        sent.push({ message, options });
        return { ok: true };
      },
    });

    expect(sent).toStrictEqual([
      {
        message: "看这张剪贴板图片",
        options: {
          attachments: [
            {
              id: "composer-paste-1onnx1x",
              type: "file",
              fileName: "clipboard-image.png",
              mimeType: "image/png",
              sizeBytes: 5,
              contentEncoding: "base64",
              content: "AQIDBAU=",
            },
          ],
        },
      },
    ]);
    expect(chat.composer.attachments).toStrictEqual([]);
  });


  it("restores attachments when send fails", async () => {
    const chat = createDesktopChatState();
    chat.composer.setInput("分析这个截图");
    chat.composer.attachments = [
      {
        id: "att-1",
        type: "file",
        path: "/Users/example/Desktop/capture.png",
        fileName: "capture.png",
      },
    ];
    const restored = [];

    await expect(
      handleDesktopChatSubmit(chat, {
        send: async () => {
          throw new Error("bridge failed");
        },
        onInputRestored: (message, options) => {
          restored.push({ message, options });
        },
      }),
    ).rejects.toThrow("bridge failed");

    expect(chat.composer.input).toBe("分析这个截图");
    expect(chat.composer.attachments).toStrictEqual([
      {
        id: "att-1",
        type: "file",
        path: "/Users/example/Desktop/capture.png",
        fileName: "capture.png",
      },
    ]);
    expect(restored).toStrictEqual([
      {
        message: "分析这个截图",
        options: {
          attachments: [
            {
              id: "att-1",
              type: "file",
              path: "/Users/example/Desktop/capture.png",
              fileName: "capture.png",
            },
          ],
        },
      },
    ]);
  });

  it("queues normal messages while a run is busy and keeps them recallable", async () => {
    const chat = createDesktopChatState({ runId: "run-1" });
    chat.composer.setInput("哪些地方最有用？");

    const result = await handleDesktopChatSubmit(chat, {
      send: async () => {
        throw new Error("should not send while busy");
      },
    });

    expect(result).toMatchObject({ action: "queued", message: "哪些地方最有用？" });
    expect(chat.queue).toHaveLength(1);
    expect(chat.queue[0].text).toBe("哪些地方最有用？");
    expect(chat.queue[0].pendingRunId).toBeUndefined();
    expect(chat.composer.input).toBe("");
    expect(chat.composer.navigateHistory("up")).toBe(true);
    expect(chat.composer.input).toBe("哪些地方最有用？");
  });

  it("marks a run busy before the slow send resolves so follow-up input queues", async () => {
    const chat = createDesktopChatState();
    chat.composer.setInput("学习这个 https://example.com/a");
    let releaseSend;
    const sendPromise = new Promise((resolve) => {
      releaseSend = () => resolve({ ok: true });
    });
    const sent = [];

    const firstSubmit = handleDesktopChatSubmit(chat, {
      send: async (message) => {
        sent.push(message);
        return sendPromise;
      },
    });

    expect(chat.runId).toMatch(/^desktop-chat-run-/u);
    chat.composer.setInput("哪些地方最有用？");
    const queued = await handleDesktopChatSubmit(chat, {
      send: async () => {
        throw new Error("follow-up should queue while first send is unresolved");
      },
    });

    expect(queued).toMatchObject({ action: "queued", message: "哪些地方最有用？" });
    expect(sent).toStrictEqual(["学习这个 https://example.com/a"]);
    releaseSend();
    await firstSubmit;
  });

  it("coalesces duplicate in-flight submits before the bridge acknowledges them", async () => {
    const chat = createDesktopChatState();
    chat.composer.setInput("same prompt");
    let releaseSend;
    const sendPromise = new Promise((resolve) => {
      releaseSend = () => resolve({ ok: true });
    });
    const sent = [];

    const first = handleDesktopChatSubmit(chat, {
      send: async (message) => {
        sent.push(message);
        return sendPromise;
      },
    });
    chat.composer.setInput("same prompt");
    const second = handleDesktopChatSubmit(chat, {
      send: async (message) => {
        sent.push(message);
        return sendPromise;
      },
    });

    expect(sent).toStrictEqual(["same prompt"]);
    expect(chat.queue).toStrictEqual([]);
    releaseSend();
    await Promise.all([first, second]);
  });

  it("restores the submitted draft when send fails", async () => {
    const chat = createDesktopChatState();
    chat.composer.setInput("不要丢掉这段输入");
    const restored = [];

    await expect(
      handleDesktopChatSubmit(chat, {
        send: async () => {
          throw new Error("bridge failed");
        },
        onInputRestored: (message) => {
          restored.push(message);
        },
      }),
    ).rejects.toThrow("bridge failed");

    expect(chat.runId).toBeNull();
    expect(chat.composer.input).toBe("不要丢掉这段输入");
    expect(restored).toStrictEqual(["不要丢掉这段输入"]);
  });

  it("clears typed stop commands after aborting the active run", async () => {
    const chat = createDesktopChatState({ runId: "run-1" });
    chat.composer.setInput("/stop");
    const aborts = [];

    const result = await handleDesktopChatSubmit(chat, {
      abort: async (runId) => {
        aborts.push(runId);
      },
      send: async () => ({ ok: true }),
    });

    expect(result).toMatchObject({ action: "aborted", message: "/stop" });
    expect(aborts).toStrictEqual(["run-1"]);
    expect(chat.composer.input).toBe("");
    expect(chat.queue).toStrictEqual([]);
  });

  it("runs typed /new immediately instead of queueing it behind an active run", async () => {
    const chat = createDesktopChatState({ runId: "run-1" });
    chat.queue = [{ id: "queued-1", text: "旧追问", createdAt: 1 }];
    chat.composer.setInput("/new");
    const resets = [];

    const result = await handleDesktopChatSubmit(chat, {
      resetConversation: async (message) => {
        resets.push(message);
      },
      send: async () => {
        throw new Error("/new should not be sent to the model");
      },
    });

    expect(result).toMatchObject({ action: "reset", message: "/new" });
    expect(resets).toStrictEqual(["/new"]);
    expect(chat.runId).toBe("run-1");
    expect(chat.queue).toStrictEqual([]);
    expect(chat.composer.input).toBe("");
  });

  it("resends the last submitted message for typed /retry without sending the command text", async () => {
    const chat = createDesktopChatState({ lastSubmittedMessage: "学习这个 https://example.com/a" });
    chat.composer.setInput("/retry");
    const sent = [];

    const result = await handleDesktopChatSubmit(chat, {
      send: async (message) => {
        sent.push(message);
        return { ok: true };
      },
    });

    expect(result).toMatchObject({
      action: "retried",
      message: "学习这个 https://example.com/a",
    });
    expect(sent).toStrictEqual(["学习这个 https://example.com/a"]);
    expect(chat.lastSubmittedMessage).toBe("学习这个 https://example.com/a");
    expect(chat.composer.input).toBe("");
  });

  it("clears only queue items bound to a completed run", () => {
    const chat = createDesktopChatState({ runId: "run-1" });
    chat.queue = [
      { id: "pending-run-1", text: "run 1 follow-up", createdAt: 1, pendingRunId: "run-1" },
      { id: "pending-run-2", text: "run 2 follow-up", createdAt: 2, pendingRunId: "run-2" },
      { id: "next", text: "fresh queued prompt", createdAt: 3 },
    ];

    const removed = clearDesktopChatQueueItemsForRun(chat, "run-1");

    expect(removed.map((item) => item.id)).toStrictEqual(["pending-run-1"]);
    expect(chat.queue.map((item) => item.id)).toStrictEqual(["pending-run-2", "next"]);
  });

  it("reconciles terminal run lifecycle only for the active desktop session", () => {
    const chat = createDesktopChatState({
      runId: "run-1",
      sessionKey: "desktop:workbench",
    });
    chat.queue = [
      { id: "pending-run-1", text: "steered follow-up", createdAt: 1, pendingRunId: "run-1" },
      { id: "next", text: "fresh queued prompt", createdAt: 2 },
    ];

    expect(
      reconcileDesktopChatRunLifecycle(chat, {
        outcome: "completed",
        runId: "run-other",
        sessionKey: "desktop:other",
      }),
    ).toBe(false);
    expect(chat.runId).toBe("run-1");
    expect(chat.queue).toHaveLength(2);

    expect(
      reconcileDesktopChatRunLifecycle(chat, {
        outcome: "completed",
        runId: "run-1",
        sessionKey: "desktop:workbench",
      }),
    ).toBe(true);
    expect(chat.runId).toBeNull();
    expect(chat.runStatus).toMatchObject({
      phase: "completed",
      runId: "run-1",
      sessionKey: "desktop:workbench",
    });
    expect(chat.queue.map((item) => item.id)).toStrictEqual(["next"]);
  });

  it("keeps a visible current session row even when no sessions were persisted", () => {
    const chat = createDesktopChatState({ sessionKey: "desktop:workbench" });

    const sessions = ensureDesktopChatSessions(chat, { now: 1000 });

    expect(sessions).toStrictEqual([
      {
        key: "desktop:workbench",
        title: "工作台",
        updatedAt: 1000,
      },
    ]);
    expect(chat.sessions).toStrictEqual(sessions);
  });

  it("creates a new desktop workbench session and drops stale local run state", () => {
    const chat = createDesktopChatState({
      runId: "run-old",
      sessionKey: "desktop:workbench",
      sessions: [{ key: "desktop:workbench", title: "工作台", updatedAt: 1 }],
    });
    chat.queue = [{ id: "queued", text: "旧追问", createdAt: 2 }];

    const created = createDesktopChatSession(chat, {
      key: "desktop:workbench:test",
      now: 3000,
    });

    expect(created).toStrictEqual({
      key: "desktop:workbench:test",
      title: "新会话",
      updatedAt: 3000,
    });
    expect(chat.sessionKey).toBe("desktop:workbench:test");
    expect(chat.runId).toBeNull();
    expect(chat.queue).toStrictEqual([]);
    expect(chat.sessions.map((session) => session.key)).toStrictEqual([
      "desktop:workbench:test",
      "desktop:workbench",
    ]);
  });

  it("switches desktop sessions without carrying the previous run or queue", () => {
    const chat = createDesktopChatState({
      runId: "run-a",
      sessionKey: "desktop:workbench:a",
      sessions: [
        { key: "desktop:workbench:a", title: "A", updatedAt: 1 },
        { key: "desktop:workbench:b", title: "B", updatedAt: 2 },
      ],
    });
    chat.queue = [{ id: "queued", text: "A 的追问", createdAt: 3 }];

    const selected = selectDesktopChatSession(chat, "desktop:workbench:b", { now: 4000 });

    expect(selected).toBe(true);
    expect(chat.sessionKey).toBe("desktop:workbench:b");
    expect(chat.runId).toBeNull();
    expect(chat.queue).toStrictEqual([]);
    expect(chat.sessions[0]).toMatchObject({
      key: "desktop:workbench:b",
      updatedAt: 4000,
    });
  });

  it("updates the active session title from the submitted prompt", () => {
    const chat = createDesktopChatState({
      sessionKey: "desktop:workbench:a",
      sessions: [{ key: "desktop:workbench:a", title: "新会话", updatedAt: 1 }],
    });

    updateDesktopChatSessionFromPrompt(chat, "学习这个 https://example.com/very-long-source", {
      now: 5000,
    });

    expect(chat.sessions[0]).toStrictEqual({
      key: "desktop:workbench:a",
      title: "学习这个 https://example.com/very...",
      updatedAt: 5000,
    });
  });

  it("renames an existing desktop session with a bounded title", () => {
    const chat = createDesktopChatState({
      sessionKey: "desktop:workbench:a",
      sessions: [{ key: "desktop:workbench:a", title: "旧标题", updatedAt: 1 }],
    });

    const renamed = renameDesktopChatSession(
      chat,
      "desktop:workbench:a",
      "  这是一个非常非常非常非常非常长的新标题  ",
      { now: 6000 },
    );

    expect(renamed).toBe(true);
    expect(chat.sessions[0]).toStrictEqual({
      key: "desktop:workbench:a",
      title: "这是一个非常非常非常非常非常长的新标题",
      updatedAt: 6000,
    });
  });

  it("deletes a non-current desktop session without disturbing the active one", () => {
    const chat = createDesktopChatState({
      sessionKey: "desktop:workbench:a",
      sessions: [
        { key: "desktop:workbench:a", title: "A", updatedAt: 1 },
        { key: "desktop:workbench:b", title: "B", updatedAt: 2 },
      ],
    });

    const deleted = deleteDesktopChatSession(chat, "desktop:workbench:b", { now: 7000 });

    expect(deleted).toBe(true);
    expect(chat.sessionKey).toBe("desktop:workbench:a");
    expect(chat.sessions.map((session) => session.key)).toStrictEqual(["desktop:workbench:a"]);
  });

  it("deletes the current desktop session by selecting the next available session", () => {
    const chat = createDesktopChatState({
      runId: "run-a",
      sessionKey: "desktop:workbench:a",
      sessions: [
        { key: "desktop:workbench:a", title: "A", updatedAt: 3 },
        { key: "desktop:workbench:b", title: "B", updatedAt: 2 },
      ],
    });
    chat.queue = [{ id: "queued", text: "A 的追问", createdAt: 4 }];

    const deleted = deleteDesktopChatSession(chat, "desktop:workbench:a", { now: 8000 });

    expect(deleted).toBe(true);
    expect(chat.sessionKey).toBe("desktop:workbench:b");
    expect(chat.runId).toBeNull();
    expect(chat.queue).toStrictEqual([]);
    expect(chat.sessions).toStrictEqual([
      {
        key: "desktop:workbench:b",
        title: "B",
        updatedAt: 8000,
      },
    ]);
  });

  it("keeps one fallback session when deleting the only desktop session", () => {
    const chat = createDesktopChatState({
      sessionKey: "desktop:workbench:only",
      sessions: [{ key: "desktop:workbench:only", title: "Only", updatedAt: 1 }],
    });

    const deleted = deleteDesktopChatSession(chat, "desktop:workbench:only", { now: 9000 });

    expect(deleted).toBe(true);
    expect(chat.sessionKey).toBe("desktop:workbench");
    expect(chat.sessions).toStrictEqual([
      {
        key: "desktop:workbench",
        title: "工作台",
        updatedAt: 9000,
      },
    ]);
  });
});
