import { describe, expect, it } from "vitest";

import {
  classifyConversationRuntimeFailure,
  createConversationRuntimeFailureProjection,
  createConversationRuntimeLearningArtifactProjection,
  createConversationRuntimeUserFacingProjection,
  renderConversationRuntimeResultUserFacingText,
  renderConversationRuntimeUserFacingFailureReply,
} from "../src/index.js";

describe("conversation runtime user-facing reply renderer", () => {
  it("renders model provider failures as Chinese fail-closed guidance", () => {
    const reply = renderConversationRuntimeUserFacingFailureReply({
      error: new Error("provider offline"),
      surface: "weixin",
    });

    expect(reply.kind).toBe("model_unavailable");
    expect(reply.text).toContain("模型不可用");
    expect(reply.text).toContain("没有用假数据冒充结果");
    expect(reply.text).toContain("下一步：检查模型供应方");
    expect(reply.text).not.toContain("provider offline");
  });

  it("renders missing provider keys separately from generic model failures", () => {
    const failure = classifyConversationRuntimeFailure({
      message: "no api key configured for memefast provider",
    });
    const reply = renderConversationRuntimeUserFacingFailureReply({ failure });

    expect(failure.kind).toBe("provider_missing_key");
    expect(reply.text).toContain("模型 Key 未配置");
    expect(reply.text).toContain("不能假装调用成功");
  });

  it("renders upstream provider HTTP failures separately from missing model configuration", () => {
    const failure = classifyConversationRuntimeFailure({
      code: "model_unavailable",
      message: "模型调用失败：HTTP 503 Service Unavailable",
    });
    const reply = renderConversationRuntimeUserFacingFailureReply({ failure });

    expect(failure.kind).toBe("provider_upstream_failed");
    expect(reply.text).toContain("模型供应方暂时不可用");
    expect(reply.text).toContain("已经找到并调用了模型供应方");
    expect(reply.text).toContain("不是没有配置模型");
    expect(reply.text).not.toContain("当前没有可用的模型供应方");
  });

  it("renders network provider failures separately from missing model configuration", () => {
    const failure = classifyConversationRuntimeFailure({
      code: "model_unavailable",
      message: "模型调用失败：fetch failed。",
    });
    const reply = renderConversationRuntimeUserFacingFailureReply({ failure });

    expect(failure.kind).toBe("provider_upstream_failed");
    expect(reply.text).toContain("模型供应方暂时不可用");
    expect(reply.text).toContain("已经找到并调用了模型供应方");
    expect(reply.text).toContain("不是没有配置模型");
    expect(reply.text).toContain("重试本轮");
    expect(reply.text).toContain("切换模型");
    expect(reply.text).not.toContain("当前没有可用的模型供应方");
  });

  it("renders channel delivery failures without claiming the task failed", () => {
    const reply = renderConversationRuntimeUserFacingFailureReply({
      error: new Error("iLink sendmessage failed: ret=-2 errcode=0"),
      surface: "weixin",
    });

    expect(reply.kind).toBe("channel_delivery_failed");
    expect(reply.text).toContain("微信发送失败");
    expect(reply.text).toContain("任务本身不一定失败");
    expect(reply.text).not.toContain("iLink sendmessage failed");
  });

  it("renders source access limits as unverifiable source failures", () => {
    const reply = renderConversationRuntimeUserFacingFailureReply({
      code: "source_access_limited",
      message: "环境异常，完成验证后即可继续访问。",
    });

    expect(reply.kind).toBe("source_access_limited");
    expect(reply.text).toContain("来源读取受限");
    expect(reply.text).toContain("没有拿到可信正文");
    expect(reply.text).toContain("不会把验证页当成学习内容");
  });

  it("derives a user-facing message from runtime error events", () => {
    const text = renderConversationRuntimeResultUserFacingText({
      replySource: "degraded-error",
      events: [
        {
          id: "turn-1:error",
          kind: "runtime.error",
          turnId: "turn-1",
          sessionKey: "session-1",
          occurredAtMs: 1,
          payload: {
            code: "model_unavailable",
            message: "provider not configured",
            recoverable: true,
          },
        },
      ],
    });

    expect(text).toContain("模型不可用");
    expect(text).toContain("没有用假数据冒充结果");
    expect(text).not.toContain("provider not configured");
  });

  it("derives upstream provider failures from runtime error events", () => {
    const text = renderConversationRuntimeResultUserFacingText({
      replySource: "degraded-error",
      events: [
        {
          id: "turn-1:error",
          kind: "runtime.error",
          turnId: "turn-1",
          sessionKey: "session-1",
          occurredAtMs: 1,
          payload: {
            code: "model_unavailable",
            message: "模型调用失败：HTTP 503 Service Unavailable",
            recoverable: true,
          },
        },
      ],
    });

    expect(text).toContain("模型供应方暂时不可用");
    expect(text).toContain("不是没有配置模型");
    expect(text).not.toContain("当前没有可用的模型供应方");
  });

  it("creates a reusable client failure projection without endpoint or zero-latency leaks", () => {
    const projection = createConversationRuntimeFailureProjection({
      surface: "moyin-panel",
      code: "runtime_failed",
      message: "模型调用失败\n接口：undefined\n耗时：0ms",
      traceRef: "runtime:turn-1",
    });

    expect(projection.userText).toContain("运行失败");
    expect(projection.userText).toContain("下一步：");
    expect(projection.userText).not.toContain("接口：undefined");
    expect(projection.userText).not.toContain("耗时：0ms");
    expect(projection.userText).not.toContain("undefined");
    expect(projection.developerTraceRef).toBe("runtime:turn-1");
    expect(projection.metadata).toMatchObject({
      surface: "moyin-panel",
      failureKind: "runtime_failed",
    });
  });

  it("prefers user-facing projection and filters runtime-shaped fields", () => {
    const projection = createConversationRuntimeUserFacingProjection({
      userText: [
        "status: candidate-created",
        "这个链接我看过了",
        "可用要点：",
        "1. 用首帧锁定主体。",
        "next_actions: 内部下一步",
      ].join("\n"),
      status: "learning-candidate",
      canRetry: false,
    });

    const text = renderConversationRuntimeResultUserFacingText({
      replySource: "model",
      finalText: "模型原文",
      userFacingProjection: projection,
      events: [],
    });

    expect(text).toContain("这个链接我看过了");
    expect(text).toContain("用首帧锁定主体");
    expect(text).not.toContain("status:");
    expect(text).not.toContain("next_actions:");
    expect(text).not.toBe("模型原文");
  });

  it("filters tool-observation fields from final text when no explicit projection exists", () => {
    const text = renderConversationRuntimeResultUserFacingText({
      replySource: "tool-loop",
      finalText: [
        "status: success",
        "summary: Found source candidates.",
        "我查到 2 个候选，最有用的是 Seedance 分镜流程。",
        "next_actions: extract with web_extract",
        "endpoint: undefined",
      ].join("\n"),
      events: [],
    });

    expect(text).toContain("我查到 2 个候选");
    expect(text).toContain("Seedance 分镜流程");
    expect(text).not.toContain("status:");
    expect(text).not.toContain("summary:");
    expect(text).not.toContain("next_actions:");
    expect(text).not.toContain("endpoint:");
    expect(text).not.toContain("undefined");
  });

  it("scrubs bridge and trace-shaped internals from user-visible projections", () => {
    const projection = createConversationRuntimeUserFacingProjection({
      userText: [
        "Native Bridge 暂无回包，继续等待工具或模型结果",
        "runId: run-123",
        "trace: runtime.tool_loop",
        "endpoint: http://127.0.0.1:9999",
        "这条经验已经整理好，可以判断是否收录。",
      ].join("\n"),
      status: "learning-candidate",
    });

    expect(projection.userText).toContain("这条经验已经整理好");
    expect(projection.userText).not.toContain("Native Bridge");
    expect(projection.userText).not.toContain("runId");
    expect(projection.userText).not.toContain("trace:");
    expect(projection.userText).not.toContain("endpoint:");
  });

  it("projects learning artifacts as result-first text without exposing candidate plumbing", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://mp.weixin.qq.com/s/example",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "exp-1",
          title: "Seedance 分镜经验",
          summary: "先拆脚本，再按镜头目的生成画面提示词。",
        },
      ],
    });

    expect(projection.userText).toContain("看完了。核心是：");
    expect(projection.userText).toContain("要收录吗？");
    expect(projection.userText).toContain("Seedance 分镜经验");
    expect(projection.userText).toContain("先拆脚本");
    expect(projection.userText).toContain("来源：https://mp.weixin.qq.com/s/example");
    expect(projection.userText).not.toContain("可用要点：");
    expect(projection.userText).not.toContain("已生成 1 条待审经验候选");
    expect(projection.userText).not.toContain("下一步：");
    expect(projection.userText).not.toContain("status:");
    expect(projection.userText).not.toContain("next_actions:");
    expect(projection.metadata).toMatchObject({
      source: "url",
      candidateCount: 1,
      failureCount: 0,
    });
  });

  it("renders enough first-pass learning detail for users to judge saved candidates", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://x.com/liyue_ai/status/2056947629548843481",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "exp-gpt-image-2-safety",
          title: "GPT Image 2 美女提示词安全写法",
          summary:
            "99%的人都写错了，GPT Image 2 生成美女，千万别直接写“性感”。场景过于私密是高风险写法，安全稳定写法是可以有卧室，但不要让卧室变成暧昧场景。GPT Image 2 不是不能生成性感好看的图片，而是不适合用低俗直白的词去生成，提示词整体要求提倡信雅达。红黄绿提示词分层很重要：红色是高风险词，黄色是容易误判的暧昧词，绿色是可以稳定表达气质、服装、光线、构图和审美的词。",
        },
      ],
    });

    expect(projection.userText).toContain("看完了。核心是：");
    expect(projection.userText).toContain("学到的要点：");
    expect(projection.userText).toContain("1. 99%的人都写错了");
    expect(projection.userText).toContain("2. 场景过于私密是高风险写法");
    expect(projection.userText).toContain("3. GPT Image 2 不是不能生成性感好看的图片");
    expect(projection.userText).toContain("4. 红黄绿提示词分层很重要");
    expect(projection.userText).toContain("要收录吗？");
    expect(projection.userText).not.toContain("红黄绿提...");
    expect(projection.userText).not.toContain("\n2. ；");
    expect(projection.userText).not.toContain("\n3. ；");
    expect(projection.userText).not.toContain("...");
  });

  it("builds learning bullets from the full cleaned summary before truncating the core line", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://x.com/liyue_ai/status/2056947629548843481",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "exp-gpt-image-2-semicolon",
          title: "GPT Image 2 美女提示词安全写法",
          summary:
            "场景过于私密 高风险写法：直接写性感、床上、挑逗姿势、暧昧互动、过度暴露和私密暗示。安全稳定写法：可以有卧室，但不要让卧室变成暧昧场景，要写成居家写真、柔和晨光、自然姿态、精致服装、克制镜头和明确审美语境；GPT Image 2 不是不能生成性感好看的图片，而是不适合用低俗直白的词去生成，提示词整体要求提倡信雅达；红黄绿提示词：红色禁用低俗词，黄色谨慎处理私密场景，绿色改成高级、优雅、电影感、服装、光线和构图。",
        },
      ],
    });

    expect(projection.userText).toContain("学到的要点：");
    expect(projection.userText).toContain("红黄绿提示词：红色禁用低俗词");
    expect(projection.userText).not.toContain("红黄绿提...");
    expect(projection.userText).not.toContain("\n2. ；");
    expect(projection.userText).not.toContain("\n3. ；");
    expect(projection.userText).not.toContain("...");
  });

  it("filters author chatter and surfaces actionable Chinese font prompt lessons", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://x.com/AdrianPunk115/status/2056655062865490112",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "exp-chinese-font-prompts",
          title: "2026 文字类提示词设计指南（上册）",
          summary:
            "2天时间，肝爆Chatgpt生图功能上限2次，达到长文图片上限，也挡不住我想分享的心。那么就分两次发吧👇。很多人用 AI 做中文字体图，第一句提示词就是：“帮我生成 XX 几个字”。然后出来的图，经常像 PPT 艺术字，字可能是对的，但没有设计感，能看，但不能当封面。问题不一定在 AI，更多时候是提示词太空了。好看、高级、有设计感不是指令。AI 真正需要的是更具体的描述：这个字是什么字体、笔画粗细、结构、边缘、材质和背景。中文字体提示词最好按公式写，不是让 AI 写字，而是设计一组字。",
        },
      ],
    });

    expect(projection.userText).toContain("学到的要点：");
    expect(projection.userText).toContain("问题不一定在 AI，更多时候是提示词太空了");
    expect(projection.userText).toContain("好看、高级、有设计感不是指令");
    expect(projection.userText).toContain("字体、笔画粗细、结构、边缘、材质和背景");
    expect(projection.userText).toContain("不要只写“帮我生成 XX 几个字”");
    expect(projection.userText).toContain("不是让 AI 写几个字，而是让 AI 设计一组字");
    expect(projection.userText).toContain("要收录吗？");
    expect(projection.userText).not.toContain("肝爆");
    expect(projection.userText).not.toContain("挡不住我想分享");
    expect(projection.userText).not.toContain("分两次发");
    expect(projection.userText).not.toContain("PPT 艺术字");
  });

  it("merges fragmented real desktop Chinese font prompt summaries", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://x.com/AdrianPunk115/status/2056655062865490112",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "exp-chinese-font-prompts-real",
          title: "2026 文字类提示词设计指南（上册）",
          summary: [
            "经验提炼：AI 真正需要的是更具体的描述： 这个字是什么字体？；# 0个中文字体提示方案 ## 01｜时尚体 方案1：潮流品牌字 方案 2：高级杂志字 方案 3：都市潮流字。",
            "“好看”不是指令。“高级”不是指令。“有设计感”也不是指令。",
            "AI 真正需要的是更具体的描述：这个字是什么字体？ 笔画是粗还是细？ 结构是紧凑还是舒展？ 边缘是锋利还是圆润？ 材质是金属、玻璃、贴纸，还是旧印刷？ 背景是科技界面、复古拼贴，还是手账纸张？",
            "中文字体提示词，最好按这个公式写：这就不是让 AI “写几个字”。这是让 AI “设计一组字”。",
          ].join(" "),
        },
      ],
    });

    expect(projection.userText).toContain("好看、高级、有设计感不是指令");
    expect(projection.userText).toContain("字体、笔画粗细、结构、边缘、材质和背景");
    expect(projection.userText).toContain("中文字体提示词，最好按公式写");
    expect(projection.userText).toContain("不是让 AI 写几个字，而是让 AI 设计一组字");
    expect(projection.userText).not.toContain("方案1");
    expect(projection.userText).not.toContain("0个中文字体提示方案");
    expect(projection.userText).not.toContain("\n3. 笔画是粗还是细");
    expect(projection.userText).not.toContain("\n4. 结构是紧凑还是舒展");
    expect(projection.userText).not.toContain("\n4. 这是让 AI");
    expect(projection.userText.match(/这个字是什么字体/gu)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("cleans X note metadata and avoids broken-word learning summaries", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://x.com/sha_zdiii/status/2057320295179141542",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "exp-x-note",
          title: "(Note Tweet)",
          summary:
            "(Note Tweet)。Use the exact character design board image as the reference. Keep everything elegant and photorealistic while preserving the same outfit, expression, and proportions.",
        },
      ],
    });

    expect(projection.userText).toContain("看完了。核心是：");
    expect(projection.userText).toContain("Use the exact character design board image");
    expect(projection.userText).toContain("要收录吗？");
    expect(projection.userText).not.toContain("(Note Tweet)");
    expect(projection.userText).not.toContain("photorealisti...");
  });

  it("uses the first real takeaway as the core when X only provides an internal note title", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://x.com/MrLarus/status/2058431541655572649",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "exp-mrlarus-food-standee",
          title: "Pasted lesson: (Note Tweet)",
          summary:
            "经验提炼：爆辣夜市风：酸辣粉 / 拌面适合餐饮新品上市、套餐促销、门店引流，餐饮老板学会又能省一笔。用 ChatGPT-Image2 生成《餐饮异形展架/立牌》，门店物料满分。山野自然风：菌汤锅 / 云南风味。",
        },
      ],
    });

    expect(projection.userText).toContain(
      "看完了。核心是：爆辣夜市风：酸辣粉 / 拌面适合餐饮新品上市",
    );
    expect(projection.userText).toContain("学到的要点：");
    expect(projection.userText).not.toContain("核心是：整理出 1 条待确认经验候选");
    expect(projection.userText).not.toContain("(Note Tweet)");
  });

  it("marks extractive English learning summaries as evidence-held instead of polished understanding", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://x.com/sha_zdiii/status/2057320295179141542",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "exp-english-extract",
          title: "角色设计板参考图",
          summary:
            "Use the exact character design board image as the reference. Keep everything elegant and photorealistic while preserving the same outfit, expression, and proportions. Match the lighting, camera angle, and lens language from the source.",
        },
      ],
    });

    expect(projection.userText).toContain("看完了。核心是：");
    expect(projection.userText).toContain("要收录吗？");
    expect(projection.userText).toContain(
      "这条更像原文摘录，我先按证据保留；需要的话可以再精炼成中文。",
    );
    expect(projection.metadata).toMatchObject({
      extractiveEnglishSummary: true,
    });
  });

  it("projects unreadable learning artifacts as access-limited next steps", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://mp.weixin.qq.com/s/blocked",
      candidateCount: 0,
      failures: [
        {
          title: "mp.weixin.qq.com",
          reason: "source_access_limited",
          detail: "status: blocked\nnext_actions: complete verification",
        },
      ],
    });

    expect(projection.userText).toContain("这次还没有学到可信正文");
    expect(projection.userText).toContain("访问受限");
    expect(projection.userText).toContain("换成可公开访问的链接");
    expect(projection.userText).not.toContain("status:");
    expect(projection.userText).not.toContain("next_actions:");
    expect(projection.canRetry).toBe(true);
  });

  it("treats access-limited evidence as unreadable even if stale candidates exist", () => {
    const projection = createConversationRuntimeLearningArtifactProjection({
      source: "url",
      query: "https://x.com/bmx_ai13/status/2054021743467970934?s=46",
      candidateCount: 1,
      candidates: [
        {
          candidateId: "stale-x-shell",
          title: "Web lesson: x.com",
          summary: "JavaScript is not available. window.__SCRIPTS_LOADED__ = {};",
        },
      ],
      sourceEvidenceRefs: [
        {
          sourceRef: "https://x.com/bmx_ai13/status/2054021743467970934?s=46",
          sourceAccessStatus: "source_access_limited",
          sourceAccessError: "dynamic application shell rather than source content",
          publishable: false,
        },
      ],
    });

    expect(projection.userText).toContain("这次还没有学到可信正文");
    expect(projection.userText).toContain("访问受限");
    expect(projection.userText).not.toContain("这个链接我看过了");
    expect(projection.userText).not.toContain("Web lesson: x.com");
    expect(projection.userText).not.toContain("JavaScript is not available");
    expect(projection.briefStatus).toBe("source-not-readable");
    expect(projection.canRetry).toBe(true);
    expect(projection.metadata).toMatchObject({
      sourceAccessStatus: "source_access_limited",
      candidateCount: 1,
    });
  });
});
