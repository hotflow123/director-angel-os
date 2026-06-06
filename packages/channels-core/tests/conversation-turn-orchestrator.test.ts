import { describe, expect, it } from "vitest";

import { orchestrateConversationTurn } from "../src/index.js";

describe("conversation turn orchestrator", () => {
  it("routes explicit production commands into a result-first production turn", () => {
    const result = orchestrateConversationTurn({
      text: "/制作 生成一个15秒短剧分镜蓝图",
      surface: "desktop",
      channel: "desktop",
      agentId: "director-angel",
      peerId: "operator",
    });

    expect(result.intent).toMatchObject({
      kind: "production-start",
      objective: "生成一个15秒短剧分镜蓝图",
      command: {
        commandId: "production.start",
      },
      safety: {
        verdict: "allow",
      },
    });
    expect(result.responsePolicy).toBe("result-first");
    expect(result.shouldCreateRun).toBe(true);
    expect(result.shouldInvokeRecall).toBe(true);
    expect(result.memoryDecision.action).toBe("store-result-only");
  });

  it("carries the Angel role profile into intent and operator trace without changing routing", () => {
    const angelRoleProfile = {
      roleId: "director-angel",
      title: "导演 Angel",
      domain: "影视制作",
      responsibilities: ["持续学习影视制作经验", "输出分镜和制作方案"],
      learningScope: ["短剧制作", "AI 影像生成"],
      controllableSystems: ["moyin"],
    };

    const result = orchestrateConversationTurn({
      text: "/制作 生成一个15秒短剧分镜蓝图",
      surface: "desktop",
      channel: "desktop",
      agentId: "director-angel",
      peerId: "operator",
      angelRoleProfile,
    });

    expect(result.intent.kind).toBe("production-start");
    expect(result.intent.metadata).toMatchObject({
      angelRoleProfile,
    });
    expect(result.operatorTrace[0]?.metadata).toMatchObject({
      angelRoleProfile,
    });
  });

  it("routes natural production requests through the same production lane", () => {
    const result = orchestrateConversationTurn({
      text: "我制作一个小猫旅游记",
      surface: "weixin",
      channel: "weixin",
      activeSession: { hasActiveSession: false },
    });

    expect(result.intent).toMatchObject({
      kind: "production-start",
      objective: "制作一个小猫旅游记",
    });
    expect(result.shouldCreateRun).toBe(true);
    expect(result.shouldInvokeRecall).toBe(true);
  });

  it("keeps natural production consultation questions as chat without creating runs", () => {
    const consultationQuestions = [
      "做AI短剧时先生成分镜图再生视频应该优先比较哪些能力维度？",
      "生成分镜图和视频哪个更难？",
      "做短剧用什么模型好？",
      "生成视频一般要多久？",
      "做分镜脚本有什么技巧吗",
      "设计分镜需要注意哪些问题",
      "出一版广告片大概多少钱",
      "制作短剧前要不要先写脚本",
    ];

    for (const text of consultationQuestions) {
      const result = orchestrateConversationTurn({
        text,
        surface: "desktop",
        channel: "desktop",
        activeSession: { hasActiveSession: false },
      });

      expect(result.intent.kind).toBe("chat");
      expect(result.shouldCreateRun).toBe(false);
      expect(result.shouldAttachToActiveSession).toBe(false);
    }
  });

  it("binds confirmation supplements to the active task instead of creating a new task", () => {
    const result = orchestrateConversationTurn({
      text: "确认执行，内容是：一个山村题材但必须批判拐卖并完成救助追责",
      surface: "weixin",
      channel: "weixin",
      activeSession: {
        hasActiveSession: true,
        sessionKey: "agent:director-angel:direct:user-1",
        objective: "生成一个15秒短剧分镜蓝图",
        runId: "run-1",
        awaitingConfirmation: true,
      },
    });

    expect(result.intent).toMatchObject({
      kind: "production-confirm",
      supplement: "一个山村题材但必须批判拐卖并完成救助追责",
    });
    expect(result.shouldCreateRun).toBe(false);
    expect(result.shouldAttachToActiveSession).toBe(true);
    expect(result.memoryDecision.action).toBe("transient");
  });

  it("keeps confirmation words as ordinary chat when no active session is pending", () => {
    for (const text of ["确认", "执行", "继续", "确认执行，内容是：小猫从家里走到公园"]) {
      const result = orchestrateConversationTurn({
        text,
        surface: "weixin",
        channel: "weixin",
        activeSession: { hasActiveSession: false },
      });

      expect(result.intent.kind).toBe("chat");
      expect(result.shouldCreateRun).toBe(false);
      expect(result.shouldAttachToActiveSession).toBe(false);
      expect(result.responsePolicy).toBe("result-first");
    }
  });

  it("binds natural follow-up turns to the active production task", () => {
    const result = orchestrateConversationTurn({
      text: "然后补充一下，小猫从家走到公园，遇见很多朋友",
      surface: "desktop",
      activeSession: {
        hasActiveSession: true,
        objective: "制作一个小猫旅游记",
      },
    });

    expect(result.intent).toMatchObject({
      kind: "production-supplement",
      supplement: "然后补充一下，小猫从家走到公园，遇见很多朋友",
    });
    expect(result.shouldCreateRun).toBe(false);
    expect(result.shouldAttachToActiveSession).toBe(true);
  });

  it("routes learning save confirmations away from active production tasks", () => {
    const result = orchestrateConversationTurn({
      text: "把刚才学到的经验收录",
      surface: "desktop",
      channel: "desktop",
      activeSession: {
        hasActiveSession: true,
        objective: "制作一个小猫旅游记",
        runId: "run-active-production",
      },
    });

    expect(result.intent.kind).toBe("learning-confirmation");
    expect(result.shouldCreateRun).toBe(false);
    expect(result.shouldAttachToActiveSession).toBe(false);
    expect(result.memoryDecision.action).toBe("transient");
  });

  it("does not treat generic current/approval wording as learning confirmation", () => {
    const modelPath = orchestrateConversationTurn({
      text: "请通过当前已配置的模型供应方真实回答：用一行中文回复“真实模型回执 DA-ROUTE-REAL”，不要调用工具，不要解释。",
      surface: "desktop",
      channel: "desktop",
      activeSession: { hasActiveSession: false },
    });

    expect(modelPath.intent.kind).toBe("chat");

    const activeRunApproval = orchestrateConversationTurn({
      text: "把当前待审任务都通过",
      surface: "desktop",
      channel: "desktop",
      activeSession: {
        hasActiveSession: true,
        objective: "制作一个短剧",
        runId: "run-approval",
        awaitingConfirmation: true,
      },
    });

    expect(activeRunApproval.intent.kind).not.toBe("learning-confirmation");
    expect(activeRunApproval.shouldAttachToActiveSession).toBe(true);
  });

  it("keeps slash learning/status commands out of learning confirmation routing", () => {
    for (const [text, commandId] of [
      ["/学习 状态", "heartbeat.status"],
      ["/知识 候选", "knowledge.candidates"],
      ["/学习链接 https://example.com/shot-guide", "learning.url"],
    ] as const) {
      const result = orchestrateConversationTurn({
        text,
        surface: "weixin",
        channel: "weixin",
        activeSession: { hasActiveSession: true, objective: "制作一个短剧", runId: "run-1" },
      });

      expect(result.intent.kind).not.toBe("learning-confirmation");
      expect(result.intent.command?.commandId).toBe(commandId);
    }
  });

  it("distinguishes new URL learning from learning-save confirmation", () => {
    const explicitUrlLearning = orchestrateConversationTurn({
      text: "学习这个 https://example.test/learnable",
      surface: "weixin",
      channel: "weixin",
    });

    expect(explicitUrlLearning.intent.kind).toBe("learning-admit");
    expect(explicitUrlLearning.intent.metadata).toMatchObject({
      sourceKind: "url",
      url: "https://example.test/learnable",
      directReadPreferred: true,
    });

    const conversationalUrlRead = orchestrateConversationTurn({
      text: "那你去学习这个呀，https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      surface: "weixin",
      channel: "weixin",
    });

    expect(conversationalUrlRead.intent.kind).toBe("chat");
    expect(conversationalUrlRead.intent.metadata).toMatchObject({
      sourceKind: "url",
      directReadPreferred: true,
    });
  });

  it("keeps source-first learning searches in chat tooling instead of confirmation", () => {
    const result = orchestrateConversationTurn({
      text: "去微信公众号找一下有没有seedance2.0的最新学习内容",
      surface: "weixin",
      channel: "weixin",
      activeSession: { hasActiveSession: true, objective: "制作一个短剧", runId: "run-1" },
    });

    expect(result.intent.kind).toBe("chat");
    expect(result.memoryDecision.action).toBe("candidate-review");
    expect(result.shouldAttachToActiveSession).toBe(false);
  });

  it("keeps search follow-ups out of stale active production runs", () => {
    const result = orchestrateConversationTurn({
      text: "再去搜索看",
      surface: "desktop",
      channel: "desktop",
      activeSession: {
        hasActiveSession: true,
        objective: "制作一个小猫旅游记",
        runId: "run-stale-production",
      },
    });

    expect(result.intent.kind).toBe("chat");
    expect(result.shouldCreateRun).toBe(false);
    expect(result.shouldAttachToActiveSession).toBe(false);
    expect(result.shouldInvokeRecall).toBe(true);
  });

  it("attaches a shared capability route to ordinary text and media turns", () => {
    const textResult = orchestrateConversationTurn({
      text: "你去互联网看看最近生成图片分镜图哪个模型最厉害",
      surface: "desktop",
      channel: "desktop",
    });

    expect(textResult.intent.kind).toBe("chat");
    expect(textResult.capabilityRoute).toMatchObject({
      abilityGroup: "text",
      intentKind: "text_chat",
    });
    expect(textResult.intent.metadata).toMatchObject({
      capabilityRoute: textResult.capabilityRoute,
    });

    const imageResult = orchestrateConversationTurn({
      text: "看一下这张图适合做什么分镜",
      surface: "weixin",
      channel: "weixin",
      attachments: [{ kind: "image", mimeType: "image/png" }],
      textModelCapabilities: { text: true, vision: false },
    });

    expect(imageResult.intent.kind).toBe("chat");
    expect(imageResult.capabilityRoute).toMatchObject({
      abilityGroup: "vision",
      inputModalities: ["text", "image"],
      requiresMediaUnderstanding: true,
    });
    expect(imageResult.operatorTrace.map((event) => event.stage)).toContain(
      "capability-route-decided",
    );
  });

  it("does not admit low-signal chat into memory or learning", () => {
    const result = orchestrateConversationTurn({
      text: "你好",
      surface: "weixin",
      channel: "weixin",
    });

    expect(result.intent.kind).toBe("chat");
    expect(result.shouldCreateRun).toBe(false);
    expect(result.shouldInvokeRecall).toBe(false);
    expect(result.memoryDecision).toMatchObject({
      action: "never-store",
    });
  });

  it("routes identity and capability questions to dynamic capability intro without memory", () => {
    const result = orchestrateConversationTurn({
      text: "你具备什么能力？",
      surface: "weixin",
      channel: "weixin",
    });

    expect(result.intent.kind).toBe("capability-intro");
    expect(result.userText).toContain("Director Angel");
    expect(result.userText).toContain("制作");
    expect(result.userText).toContain("学习");
    expect(result.shouldCreateRun).toBe(false);
    expect(result.shouldInvokeRecall).toBe(true);
    expect(result.memoryDecision.action).toBe("never-store");
  });

  it("keeps explicit persistence learning as a review-gated candidate lane", () => {
    const result = orchestrateConversationTurn({
      text: "把这个链接沉淀成经验 https://example.com/director-guide",
      surface: "desktop",
    });

    expect(result.intent.kind).toBe("learning-admit");
    expect(result.responsePolicy).toBe("review-gated");
    expect(result.memoryDecision.action).toBe("candidate-review");
    expect(result.shouldCreateRun).toBe(false);
    expect(result.intent.metadata).toMatchObject({
      sourceKind: "url",
      url: "https://example.com/director-guide",
      directReadPreferred: true,
    });
  });

  it("routes conversational URL reading through model/tool chat instead of learning candidates", () => {
    const result = orchestrateConversationTurn({
      text: "那你去学习这个呀，https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      surface: "weixin",
      channel: "weixin",
    });

    expect(result.intent.kind).toBe("chat");
    expect(result.responsePolicy).toBe("result-first");
    expect(result.memoryDecision.action).toBe("candidate-review");
    expect(result.shouldInvokeRecall).toBe(true);
  });

  it("routes ComfyUI commands to tool workflow planning with recall enabled", () => {
    const result = orchestrateConversationTurn({
      text: "/ComfyUI 脚本+图片+视频：一个小猪学习游泳的30秒故事",
      surface: "desktop",
    });

    expect(result.intent).toMatchObject({
      kind: "comfyui-run",
      objective: "脚本+图片+视频：一个小猪学习游泳的30秒故事",
      command: {
        commandId: "media.comfyui.run",
      },
    });
    expect(result.shouldInvokeRecall).toBe(true);
    expect(result.shouldCreateRun).toBe(false);
    expect(result.memoryDecision.action).toBe("never-store");
  });

  it("blocks romanticized trafficking production before creating a run", () => {
    const result = orchestrateConversationTurn({
      text: "/制作 生成一个15秒短剧分镜蓝图，主题：山村拐卖婚姻，最终爱情美满",
      surface: "weixin",
      contentSafetyMode: "developer-debug",
    });

    expect(result.intent).toMatchObject({
      kind: "production-start",
      command: {
        commandId: "production.start",
      },
      safety: {
        verdict: "rewrite-required",
        ruleId: "content.humanTrafficking.romanticized",
      },
    });
    expect(result.userText).toContain("不能按美化处理");
    expect(result.shouldCreateRun).toBe(false);
    expect(result.shouldInvokeRecall).toBe(false);
    expect(result.memoryDecision.action).toBe("never-store");
  });

  it("routes management commands without invoking production recall", () => {
    const result = orchestrateConversationTurn({
      text: "/经验 列表",
      surface: "desktop",
    });

    expect(result.intent).toMatchObject({
      kind: "management-command",
      command: {
        commandId: "experience.list",
      },
    });
    expect(result.responsePolicy).toBe("status-first");
    expect(result.shouldInvokeRecall).toBe(false);
    expect(result.shouldCreateRun).toBe(false);
    expect(result.memoryDecision.action).toBe("never-store");
  });

  it("keeps management slash commands out of active run control while a run is active", () => {
    const result = orchestrateConversationTurn({
      text: "/工具",
      surface: "desktop",
      channel: "desktop",
      activeSession: {
        hasActiveSession: true,
        runId: "run-1",
        objective: "制作一个小猫旅游记",
      },
    });

    expect(result.intent).toMatchObject({
      kind: "management-command",
      command: {
        commandId: "tools.list",
      },
    });
    expect(result.shouldAttachToActiveSession).toBe(false);
    expect(result.operatorTrace.map((event) => event.stage)).not.toContain(
      "active-session-intent-detected",
    );
  });

  it("attaches active run control commands to the current production session", () => {
    const result = orchestrateConversationTurn({
      text: "/运行 恢复",
      surface: "weixin",
      activeSession: {
        hasActiveSession: true,
        runId: "run-1",
        objective: "制作一个小猫旅游记",
      },
    });

    expect(result.intent).toMatchObject({
      kind: "run-control",
      command: {
        commandId: "run.resume",
      },
    });
    expect(result.shouldCreateRun).toBe(false);
    expect(result.shouldInvokeRecall).toBe(false);
    expect(result.shouldAttachToActiveSession).toBe(true);
  });
});
