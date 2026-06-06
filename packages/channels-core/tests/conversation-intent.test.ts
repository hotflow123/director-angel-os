import { describe, expect, it } from "vitest";

import {
  appendRecentChannelContext,
  buildSafeRewriteObjective,
  evaluateProductionContentSafety,
  extractLearningAdmissionText,
  extractNaturalLearningSearchQuery,
  isAgentCapabilityQuestion,
  isChannelNextStepQuestion,
  isChannelRejectIntent,
  isChannelReviewActionIntent,
  isChannelRunApprovalIntent,
  isChannelSearchFollowup,
  isExplicitLearningPersistencePrompt,
  isHighSignalChannelContextLine,
  isLowAdmissionText,
  looksLikeChannelContextOnlyMessage,
  looksLikeNaturalLearningSearchQuery,
  looksLikeProductionSupplement,
  needsHumanTraffickingBoundary,
  needsSafetyDialogue,
  parseChannelActiveSessionIntent,
  parseChannelConfirmation,
  parseChannelExperienceClassificationIntent,
  parseChannelExperienceManagementIntent,
  parseChannelKnowledgeManagementIntent,
  parseChannelNaturalHeartbeatManagementIntent,
  parseChannelNaturalImageGenerationIntent,
  parseChannelNaturalMemoryManagementIntent,
  parseChannelNaturalRunManagementIntent,
  parseChannelNaturalWorkspaceManagementIntent,
  parseExplicitProductionObjective,
  parseNaturalDirectorProductionObjective,
  parseNaturalProductionObjective,
  resolveChannelCapabilityRoute,
  resolveChannelModelAbilityGroups,
  resolveChannelNaturalRunCommandId,
  resolveChannelRunCommandIdFromVerb,
  shouldAdmitNaturalLearningPrompt,
} from "../src/index.js";

describe("channel conversation intent parsing", () => {
  it("parses explicit and natural production objectives without treating confirmations as new tasks", () => {
    expect(parseExplicitProductionObjective("/制作 生成一个15秒短剧分镜蓝图")).toBe(
      "生成一个15秒短剧分镜蓝图",
    );
    expect(parseExplicitProductionObjective("/production 生成一个15秒短剧分镜蓝图")).toBe(
      "生成一个15秒短剧分镜蓝图",
    );
    expect(parseNaturalProductionObjective("我制作一个小猫旅游记")).toBe("制作一个小猫旅游记");
    expect(parseNaturalProductionObjective("确认执行，内容是：小猫去公园")).toBeNull();
    expect(parseNaturalDirectorProductionObjective("我制作一个小猫旅游记")).toBe(
      "制作一个小猫旅游记",
    );
    expect(parseNaturalDirectorProductionObjective("请帮我写一个15秒短剧脚本")).toBe(
      "写一个15秒短剧脚本",
    );
    expect(parseNaturalDirectorProductionObjective("帮我写一句导演 Angel 的开场白")).toBeNull();
  });

  it("keeps production consultation questions out of natural production objectives", () => {
    const consultationQuestions = [
      "做AI短剧时先生成分镜图再生视频应该优先比较哪些能力维度？",
      "生成分镜图和视频哪个更难？",
      "做短剧用什么模型好？",
      "生成视频一般要多久？",
      "做分镜脚本有什么技巧吗",
      "设计分镜需要注意哪些问题",
      "出一版广告片大概多少钱",
      "制作短剧前要不要先写脚本",
      "2026年做AI短剧时，先生成分镜图再生视频，应该优先比较哪些能力维度？只用三点回答。",
    ];

    for (const text of consultationQuestions) {
      expect(parseNaturalProductionObjective(text)).toBeNull();
      expect(parseNaturalDirectorProductionObjective(text)).toBeNull();
    }
  });

  it("keeps production requests that mention expected content in the production lane", () => {
    expect(parseNaturalProductionObjective("帮我写一个短剧，主角应该有反转")).toBe(
      "写一个短剧，主角应该有反转",
    );
    expect(
      parseNaturalDirectorProductionObjective("请帮我制作一条广告片，结尾应该有行动号召"),
    ).toBe("制作一条广告片，结尾应该有行动号召");
  });

  it("keeps casual chatter and diary-like learning text out of learning and production lanes", () => {
    expect(isLowAdmissionText("你好")).toBe(true);
    expect(isLowAdmissionText("今天天气不错，随便聊聊")).toBe(true);
    expect(isLowAdmissionText("我今天学习制作咖啡，挺开心")).toBe(true);
    expect(isLowAdmissionText("/learn https://example.com/director-notes")).toBe(false);
    expect(isLowAdmissionText("去学习这个 https://example.com/director-notes")).toBe(false);
    expect(isLowAdmissionText("请帮我写一个15秒短剧脚本")).toBe(false);
    expect(isLowAdmissionText("Create a launch brief.")).toBe(false);
    expect(isLowAdmissionText("Continue the existing story.")).toBe(false);
    expect(extractLearningAdmissionText("学习以下：短剧镜头语言资料")).toBe("短剧镜头语言资料");
  });

  it("detects natural source/search learning queries for every channel", () => {
    expect(looksLikeNaturalLearningSearchQuery("去公众号找一下有没有最新学习内容")).toBe(true);
    expect(looksLikeNaturalLearningSearchQuery("请去互联网搜索 cola is 更多信息，再做判断")).toBe(
      true,
    );
    expect(
      looksLikeNaturalLearningSearchQuery(
        "你现在去微信公众号看一下有没有 seedance2.0 最新的玩法，学习下来",
      ),
    ).toBe(true);
    expect(
      looksLikeNaturalLearningSearchQuery(
        "/学习 你现在去微信公众号看一下有没有seedance2.0最新的玩法，学习下来",
      ),
    ).toBe(true);
    expect(looksLikeNaturalLearningSearchQuery("去学习推特学习最新的seedance 2.0经验")).toBe(true);
    expect(extractNaturalLearningSearchQuery("去学习推特学习最新的seedance 2.0经验")).toBe(
      "最新的seedance 2.0经验",
    );
    expect(looksLikeNaturalLearningSearchQuery("微信公众号的 seedance2.0 短剧制作经验")).toBe(
      false,
    );
    expect(looksLikeNaturalLearningSearchQuery("我今天学习制作咖啡，挺开心")).toBe(false);
    expect(extractNaturalLearningSearchQuery("去公众号找一下有没有最新学习内容")).toBe(
      "最新学习内容",
    );
    expect(extractNaturalLearningSearchQuery("请去互联网搜索 cola is 更多信息，再做判断")).toBe(
      "cola is 更多信息，再做判断",
    );
    expect(
      extractNaturalLearningSearchQuery(
        "你现在去微信公众号看一下有没有 seedance2.0 最新的玩法，学习下来",
      ),
    ).toBe("seedance2.0 最新的玩法");
    expect(
      extractNaturalLearningSearchQuery(
        "/学习 你现在去微信公众号看一下有没有seedance2.0最新的玩法，学习下来",
      ),
    ).toBe("seedance2.0最新的玩法");
  });

  it("keeps natural learning admission behind explicit persistence intent", () => {
    expect(shouldAdmitNaturalLearningPrompt("去学习这个 https://example.com/a")).toBe(false);
    expect(shouldAdmitNaturalLearningPrompt("去学习这个链接，里面图片也要看。")).toBe(false);
    expect(isExplicitLearningPersistencePrompt("读到了就存起来，以后做 Seedance 过审用。")).toBe(
      true,
    );
    expect(shouldAdmitNaturalLearningPrompt("读到了就存起来，以后做 Seedance 过审用。")).toBe(
      false,
    );
    expect(shouldAdmitNaturalLearningPrompt("这个页面都是按钮残渣，别当经验。")).toBe(false);
    expect(
      isExplicitLearningPersistencePrompt("把刚才那条当成 Moyin 以后生成视频时的避坑规则。"),
    ).toBe(true);
    expect(
      shouldAdmitNaturalLearningPrompt("把刚才那条当成 Moyin 以后生成视频时的避坑规则。"),
    ).toBe(false);
    expect(
      shouldAdmitNaturalLearningPrompt("把刚才那条当成 Moyin 以后生成视频时的避坑规则。", {
        hasAdditionalLearningSource: true,
      }),
    ).toBe(true);
    expect(
      shouldAdmitNaturalLearningPrompt("读取这个链接 https://example.com/a，然后告诉我讲了什么"),
    ).toBe(false);
    expect(
      shouldAdmitNaturalLearningPrompt(
        "学习这个 https://example.com/a，但不要创建候选，只告诉我结果",
      ),
    ).toBe(false);
    expect(shouldAdmitNaturalLearningPrompt("把这个链接沉淀成经验 https://example.com/a")).toBe(
      true,
    );
    expect(shouldAdmitNaturalLearningPrompt("收录到经验库 https://example.com/a")).toBe(true);
    expect(shouldAdmitNaturalLearningPrompt("学习以下：短剧镜头语言资料")).toBe(true);
    expect(
      shouldAdmitNaturalLearningPrompt("学习以下：短剧镜头语言资料", {
        hasAdditionalLearningSource: true,
      }),
    ).toBe(true);
    expect(shouldAdmitNaturalLearningPrompt("学习制作咖啡挺开心")).toBe(false);
    expect(shouldAdmitNaturalLearningPrompt("请帮我写一个15秒短剧脚本")).toBe(false);
  });

  it("detects agent identity and capability questions without treating them as low-value chatter", () => {
    expect(isAgentCapabilityQuestion("你好，你会什么")).toBe(true);
    expect(isAgentCapabilityQuestion("你是谁呀？你的功能是什么？")).toBe(true);
    expect(isAgentCapabilityQuestion("你不能说全面一点吗？")).toBe(true);
    expect(isAgentCapabilityQuestion("你只会发这几句吗")).toBe(true);
    expect(isAgentCapabilityQuestion("你是大模型吗")).toBe(true);
    expect(isLowAdmissionText("你具备什么能力?")).toBe(false);
  });

  it("parses confirmation supplements and production follow-up turns", () => {
    expect(parseChannelConfirmation("确认执行，内容是：小猫从家走到公园")).toEqual({
      supplement: "小猫从家走到公园",
    });
    expect(parseChannelConfirmation("确认执行")).toEqual({});
    expect(looksLikeProductionSupplement("然后补充一下，小猫遇到很多朋友")).toBe(true);
  });

  it("normalizes active-session turns for every channel", () => {
    expect(parseChannelActiveSessionIntent("确认执行，内容是：小猫从家走到公园")).toEqual({
      kind: "confirm-current",
      supplement: "小猫从家走到公园",
    });
    expect(parseChannelActiveSessionIntent("然后补充一下，小猫遇到很多朋友")).toEqual({
      kind: "supplement-current",
      supplement: "然后补充一下，小猫遇到很多朋友",
    });
    expect(parseChannelActiveSessionIntent("/运行 暂停 run-1")).toMatchObject({
      kind: "interrupt-current",
      commandId: "run.pause",
      args: "run-1",
    });
    expect(parseChannelActiveSessionIntent("/运行 状态 run-1")).toMatchObject({
      kind: "status-current",
      commandId: "run.status",
      args: "run-1",
    });
    expect(parseChannelActiveSessionIntent("/制作 新任务")).toMatchObject({
      kind: "execute-now",
      commandId: "production.start",
      args: "新任务",
    });
    expect(parseChannelActiveSessionIntent("再去搜索看")).toEqual({ kind: "none" });
    expect(parseChannelActiveSessionIntent("你好")).toEqual({ kind: "none" });
  });

  it("keeps channel context-only messages as short-term context and reuses them for follow-up turns", () => {
    expect(looksLikeChannelContextOnlyMessage("我最近在研究 seedance2.0 的短剧制作经验")).toBe(
      true,
    );
    expect(looksLikeChannelContextOnlyMessage("去公众号搜索 seedance2.0 的短剧制作经验")).toBe(
      false,
    );
    expect(looksLikeChannelContextOnlyMessage("制作一个 seedance2.0 短剧脚本")).toBe(false);
    expect(looksLikeChannelContextOnlyMessage("学习这段短剧镜头语言")).toBe(false);
    expect(looksLikeChannelContextOnlyMessage("保存这段短剧镜头语言经验")).toBe(false);
    expect(looksLikeChannelContextOnlyMessage("我不是让你搜索，我给的是 URL，直接打开。")).toBe(
      false,
    );
    expect(looksLikeChannelContextOnlyMessage("你刚才说看到图片，是真的看图了吗？")).toBe(false);
    expect(looksLikeChannelContextOnlyMessage("这个跟导演岗位没关系，别放进长期经验。")).toBe(
      false,
    );
    expect(looksLikeChannelContextOnlyMessage("这个以后做短剧分镜时用得上，保存到导演经验。")).toBe(
      false,
    );
    expect(looksLikeChannelContextOnlyMessage("学习制作咖啡挺开心")).toBe(false);
    expect(isHighSignalChannelContextLine("我最近在研究 ComfyUI 图生视频工作流")).toBe(true);
    expect(
      appendRecentChannelContext({
        text: "找一下这方面有没有最新资料",
        contextLines: ["你好", "我最近在研究 seedance2.0 的短剧制作经验"],
      }),
    ).toBe("找一下这方面有没有最新资料。近期对话上下文：我最近在研究 seedance2.0 的短剧制作经验");
    expect(
      appendRecentChannelContext({
        text: "那就执行",
        contextLines: [
          "去微信公众号搜索相关seedance2.0的教程",
          "微信公众号搜索文章需要去搜狗里找的",
        ],
      }),
    ).toBe(
      "那就执行。近期对话上下文：去微信公众号搜索相关seedance2.0的教程；微信公众号搜索文章需要去搜狗里找的",
    );
    expect(isChannelSearchFollowup("再去搜索看")).toBe(true);
    expect(isChannelSearchFollowup("你去了解搜狗的地址，再去搜索")).toBe(true);
    expect(isChannelSearchFollowup("再加一个反转结尾")).toBe(false);
    expect(
      appendRecentChannelContext({
        text: "再去搜索看",
        contextLines: [
          "去微信公众号搜索相关seedance2.0的教程",
          "微信公众号搜索文章需要去搜狗里找的",
        ],
      }),
    ).toBe(
      "再去搜索看。近期对话上下文：去微信公众号搜索相关seedance2.0的教程；微信公众号搜索文章需要去搜狗里找的",
    );
  });

  it("detects channel-neutral review, next-step, approval, and reject intents", () => {
    expect(isChannelReviewActionIntent("继续")).toBe(true);
    expect(isChannelReviewActionIntent("发布")).toBe(true);
    expect(isChannelReviewActionIntent("随便聊聊")).toBe(false);
    expect(isChannelNextStepQuestion("我该做什么")).toBe(true);
    expect(isChannelNextStepQuestion("下一步呢")).toBe(true);
    expect(isChannelRunApprovalIntent("把当前待审任务都通过")).toBe(true);
    expect(isChannelRunApprovalIntent("运行批准")).toBe(true);
    expect(isChannelRunApprovalIntent("我通过公园")).toBe(false);
    expect(isChannelRejectIntent("拒绝")).toBe(true);
    expect(isChannelRejectIntent("不要")).toBe(true);
    expect(isChannelRejectIntent("刚才那条别存，图片没看懂。")).toBe(true);
    expect(isChannelRejectIntent("收录第 1 条，但图片部分标低置信。")).toBe(false);
    expect(isChannelRejectIntent("不要回复太长")).toBe(false);
    expect(isChannelRejectIntent("不要入库，只回答完整学到了什么")).toBe(false);
    expect(isChannelRejectIntent("先别保存，只总结这个链接")).toBe(false);
    expect(isChannelRejectIntent("如果我觉得你学习到的内容不对，入库有什么用？")).toBe(false);
    expect(isChannelRejectIntent("如果内容不对，别入库")).toBe(true);
  });

  it("maps channel-neutral run command wording to canonical run commands", () => {
    expect(resolveChannelRunCommandIdFromVerb("状态")).toBe("run.status");
    expect(resolveChannelRunCommandIdFromVerb("继续推进")).toBe("run.continue");
    expect(resolveChannelRunCommandIdFromVerb("协作")).toBe("run.delegations");
    expect(resolveChannelRunCommandIdFromVerb("批准全部")).toBe("run.approvePending");
    expect(resolveChannelRunCommandIdFromVerb("切换")).toBe("run.reroute");
    expect(resolveChannelRunCommandIdFromVerb("未知")).toBeNull();
    expect(resolveChannelNaturalRunCommandId("看一下 run-1 的状态")).toBe("run.status");
    expect(resolveChannelNaturalRunCommandId("跑一轮 run-1")).toBe("run.once");
    expect(resolveChannelNaturalRunCommandId("审计 run-1")).toBe("run.audit");
    expect(resolveChannelNaturalRunCommandId("停止 run-1")).toBe("run.abort");
    expect(resolveChannelNaturalRunCommandId("重试 run-1")).toBeNull();
  });

  it("parses channel-neutral natural run management wording", () => {
    expect(parseChannelNaturalRunManagementIntent("重试 run-1 的 assignment-2")).toEqual({
      kind: "assignment.retry",
      runId: "run-1",
      assignmentId: "assignment-2",
    });
    expect(parseChannelNaturalRunManagementIntent("批准 run-1 assignment-2")).toEqual({
      kind: "assignment.approve",
      runId: "run-1",
      assignmentId: "assignment-2",
    });
    expect(parseChannelNaturalRunManagementIntent("把 run-1 待审任务批准全部")).toEqual({
      kind: "run.approvePending",
      runId: "run-1",
    });
    expect(parseChannelNaturalRunManagementIntent("复盘 run-1")).toEqual({
      kind: "run.reflect",
      runId: "run-1",
    });
    expect(parseChannelNaturalRunManagementIntent("看一下 run-1 的状态")).toEqual({
      kind: "run.command",
      runId: "run-1",
      commandId: "run.status",
    });
    expect(parseChannelNaturalRunManagementIntent("停止 run-1")).toEqual({
      kind: "run.command",
      runId: "run-1",
      commandId: "run.abort",
    });
    expect(parseChannelNaturalRunManagementIntent("继续 run-1")).toEqual({
      kind: "run.command",
      runId: "run-1",
      commandId: "run.continue",
    });
    expect(parseChannelNaturalRunManagementIntent("看一下状态")).toBeNull();
  });

  it("parses channel-neutral heartbeat and memory management wording", () => {
    expect(parseChannelNaturalHeartbeatManagementIntent("开启心跳模式")).toEqual({
      kind: "heartbeat.enable",
    });
    expect(parseChannelNaturalHeartbeatManagementIntent("关闭 heartbeat")).toEqual({
      kind: "heartbeat.disable",
    });
    expect(parseChannelNaturalHeartbeatManagementIntent("查看心跳")).toEqual({
      kind: "heartbeat.status",
    });
    expect(parseChannelNaturalHeartbeatManagementIntent("查看运行状态")).toBeNull();

    expect(parseChannelNaturalMemoryManagementIntent("查看 session-1 的记忆")).toEqual({
      kind: "session.inspect",
      sessionId: "session-1",
    });
    expect(parseChannelNaturalMemoryManagementIntent("清理 session-1 的记忆")).toEqual({
      kind: "session.clearWorking",
      sessionId: "session-1",
    });
    expect(parseChannelNaturalMemoryManagementIntent("记忆状态")).toEqual({
      kind: "memory.status",
    });
    expect(parseChannelNaturalMemoryManagementIntent("查看状态")).toBeNull();
  });

  it("only treats explicit workspace management wording as deterministic management intent", () => {
    expect(parseChannelNaturalWorkspaceManagementIntent("查看 Skills")).toEqual({
      kind: "skills.list",
    });
    expect(parseChannelNaturalWorkspaceManagementIntent("外部工具状态")).toEqual({
      kind: "tools.list",
    });
    expect(parseChannelNaturalWorkspaceManagementIntent("查看 API 供应方")).toEqual({
      kind: "providers.list",
    });
    expect(parseChannelNaturalWorkspaceManagementIntent("打开设置")).toEqual({
      kind: "settings.list",
    });
    expect(parseChannelNaturalWorkspaceManagementIntent("检查工作区状态")).toEqual({
      kind: "workspace.status",
    });
    expect(parseChannelNaturalWorkspaceManagementIntent("运行诊断")).toEqual({
      kind: "workspace.doctor",
    });
    expect(parseChannelNaturalWorkspaceManagementIntent("查看审查队列")).toEqual({
      kind: "review.list",
    });
    expect(parseChannelNaturalWorkspaceManagementIntent("skill 会怎么被调用")).toBeNull();
    expect(
      parseChannelNaturalWorkspaceManagementIntent("api模型本身就配置好了，为什么不做完整"),
    ).toBeNull();
    expect(parseChannelNaturalWorkspaceManagementIntent("设置这块为什么看起来很复杂")).toBeNull();
    expect(parseChannelNaturalWorkspaceManagementIntent("当前状态看起来不像在对话")).toBeNull();
    expect(
      parseChannelNaturalWorkspaceManagementIntent("能不能查看 skill 是怎么被调用的？"),
    ).toBeNull();
    expect(parseChannelNaturalWorkspaceManagementIntent("外部工具应该怎么连接？")).toBeNull();
    expect(
      parseChannelNaturalWorkspaceManagementIntent("为什么 API 供应方已经配置但没有效果？"),
    ).toBeNull();
  });

  it("parses channel-neutral image generation intent without swallowing image questions", () => {
    expect(parseChannelNaturalImageGenerationIntent("生成图片：电影感导演工作台")).toEqual({
      prompt: "电影感导演工作台",
    });
    expect(parseChannelNaturalImageGenerationIntent("帮我做一张海报 赛博朋克导演 Angel")).toEqual({
      prompt: "赛博朋克导演 Angel",
    });
    expect(parseChannelNaturalImageGenerationIntent("draw an image of a cinematic cat")).toEqual({
      prompt: "draw an image of a cinematic cat",
    });
    expect(parseChannelNaturalImageGenerationIntent("怎么生成图片？")).toBeNull();
    expect(parseChannelNaturalImageGenerationIntent("图片生成能力是怎么接入的")).toBeNull();
    expect(parseChannelNaturalImageGenerationIntent("我想了解图生视频工作流")).toBeNull();
  });

  it("routes conversation-time capabilities without confusing image model questions with generation", () => {
    expect(
      resolveChannelCapabilityRoute(
        "这是什么时间了？你去互联网看看最近生成图片分镜图哪个模型最厉害",
      ),
    ).toMatchObject({
      abilityGroup: "text",
      intentKind: "text_chat",
      explicitGeneration: false,
      requiresMediaUnderstanding: false,
    });
    expect(resolveChannelCapabilityRoute("@生成图片 电影感导演工作台")).toMatchObject({
      abilityGroup: "image_generation",
      intentKind: "image_generation",
      outputModality: "image",
      explicitGeneration: true,
    });
    expect(resolveChannelCapabilityRoute("@生成视频 电影感导演工作台开场")).toMatchObject({
      abilityGroup: "video_generation",
      intentKind: "video_generation",
      outputModality: "video",
      explicitGeneration: true,
    });
  });

  it("routes media understanding through the text model when possible and vision when necessary", () => {
    expect(
      resolveChannelCapabilityRoute("看一下这张图适合做什么分镜", {
        attachments: [{ kind: "image", mimeType: "image/png" }],
        textModelCapabilities: { text: true, vision: true },
      }),
    ).toMatchObject({
      abilityGroup: "text",
      requiresMediaUnderstanding: true,
      textModelCanHandleVision: true,
      inputModalities: ["text", "image"],
    });
    expect(
      resolveChannelCapabilityRoute("看一下这张图适合做什么分镜", {
        attachments: [{ kind: "image", mimeType: "image/png" }],
        textModelCapabilities: { text: true, vision: false },
      }),
    ).toMatchObject({
      abilityGroup: "vision",
      requiresMediaUnderstanding: true,
      textModelCanHandleVision: false,
      inputModalities: ["text", "image"],
    });
  });

  it("keeps pure generation models out of the text ability group", () => {
    expect(
      resolveChannelModelAbilityGroups({
        capabilities: ["image_generation"],
      }),
    ).toEqual(["image_generation"]);
    expect(
      resolveChannelModelAbilityGroups({
        capabilities: ["video_generation"],
      }),
    ).toEqual(["video_generation"]);
    expect(
      resolveChannelModelAbilityGroups({
        capabilities: ["text", "vision"],
      }),
    ).toEqual(["text", "vision"]);
  });

  it("parses channel-neutral experience classification and tags", () => {
    expect(
      parseChannelExperienceClassificationIntent(
        "给经验 candidate-42 分类 director-production 标签 shot-language lighting",
      ),
    ).toEqual({
      candidateId: "candidate-42",
      categoryId: "director-production",
      tagIds: ["shot-language", "lighting"],
    });
    expect(
      parseChannelExperienceClassificationIntent(
        "把经验 candidate-42 分类 director-production 标签 shot-language,lighting",
      ),
    ).toMatchObject({
      tagIds: ["shot-language", "lighting"],
    });
    expect(parseChannelExperienceClassificationIntent("给知识 pack-1 分类 director")).toBeNull();
  });

  it("parses channel-neutral experience management wording without executing desktop actions", () => {
    expect(parseChannelExperienceManagementIntent("新建经验分类 镜头语言")).toEqual({
      kind: "category.create",
      name: "镜头语言",
    });
    expect(parseChannelExperienceManagementIntent("创建经验标签 运镜")).toEqual({
      kind: "tag.create",
      name: "运镜",
    });
    expect(parseChannelExperienceManagementIntent("查看经验 candidate-42 详情")).toEqual({
      kind: "candidate.explain",
      candidateId: "candidate-42",
    });
    expect(parseChannelExperienceManagementIntent("通过经验 candidate-42")).toEqual({
      kind: "candidate.accept",
      candidateId: "candidate-42",
    });
    expect(parseChannelExperienceManagementIntent("拒绝经验 candidate-42")).toEqual({
      kind: "candidate.reject",
      candidateId: "candidate-42",
    });
    expect(parseChannelExperienceManagementIntent("把经验 candidate-42 晋升知识")).toEqual({
      kind: "candidate.promote",
      candidateId: "candidate-42",
    });
    expect(parseChannelExperienceManagementIntent("查看经验候选")).toEqual({
      kind: "candidate.list",
    });
    expect(parseChannelExperienceManagementIntent("查看知识候选")).toBeNull();
  });

  it("parses channel-neutral knowledge management wording without executing desktop actions", () => {
    expect(parseChannelKnowledgeManagementIntent("查看知识候选 pack-1 详情")).toEqual({
      kind: "candidate.explain",
      packId: "pack-1",
    });
    expect(parseChannelKnowledgeManagementIntent("查看知识 pack-1 diff")).toEqual({
      kind: "candidate.diff",
      packId: "pack-1",
    });
    expect(parseChannelKnowledgeManagementIntent("审查知识 pack-1")).toEqual({
      kind: "candidate.review",
      packId: "pack-1",
    });
    expect(parseChannelKnowledgeManagementIntent("解释知识包 pack-1")).toEqual({
      kind: "pack.explain",
      packId: "pack-1",
    });
    expect(parseChannelKnowledgeManagementIntent("接受知识 pack-1")).toEqual({
      kind: "candidate.accept",
      packId: "pack-1",
    });
    expect(parseChannelKnowledgeManagementIntent("发布知识 pack-1")).toEqual({
      kind: "candidate.publish",
      packId: "pack-1",
    });
    expect(parseChannelKnowledgeManagementIntent("拒绝知识 pack-1")).toEqual({
      kind: "candidate.reject",
      packId: "pack-1",
    });
    expect(parseChannelKnowledgeManagementIntent("知识状态")).toEqual({ kind: "status" });
    expect(parseChannelKnowledgeManagementIntent("已发布知识")).toEqual({
      kind: "published.list",
    });
    expect(parseChannelKnowledgeManagementIntent("待审知识")).toEqual({ kind: "candidate.list" });
    expect(parseChannelKnowledgeManagementIntent("知识召回")).toEqual({
      kind: "recall.preview",
    });
    expect(parseChannelKnowledgeManagementIntent("查看经验候选")).toBeNull();
  });

  it("detects unsafe romanticized trafficking framing and offers a critical rewrite objective", () => {
    const objective = "生成一个15秒短剧分镜蓝图，主题：山村拐卖婚姻，最终爱情美满";

    expect(needsHumanTraffickingBoundary(objective)).toBe(true);
    expect(needsSafetyDialogue(objective)).toBe(true);
    expect(buildSafeRewriteObjective(objective)).toContain("脱困与追责");
    expect(buildSafeRewriteObjective(objective)).toContain("不美化施害者");
    expect(evaluateProductionContentSafety(objective)).toMatchObject({
      verdict: "rewrite-required",
      floor: "hard",
      severity: "blocked",
      canOverride: false,
      requiresApproval: false,
      ruleId: "content.humanTrafficking.romanticized",
      auditEvent: "content-policy.rewrite-required.hard-floor",
    });
    expect(
      evaluateProductionContentSafety(objective, { mode: "developer-debug" }).debugNotes,
    ).toEqual(expect.arrayContaining([expect.stringContaining("硬底线")]));
    expect(
      evaluateProductionContentSafety(objective, { mode: "developer-debug" }).debugNotes,
    ).toEqual(expect.arrayContaining([expect.stringContaining("canOverride: false")]));
  });
});
