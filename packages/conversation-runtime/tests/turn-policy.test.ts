import { describe, expect, it } from "vitest";

import {
  createDirectorConversationRuntimeTools,
  filterConversationRuntimeToolsForExposurePolicy,
  isLearningCollectionAdviceQuestion,
  isLearningConfirmationPrompt,
  isReadOnlyLearningEvidenceFollowup,
  resolveConversationRuntimeToolExposurePolicy,
} from "../src/index.js";

describe("conversation runtime turn policy", () => {
  it("disables all tools only for explicit no-tool instructions", () => {
    expect(
      resolveConversationRuntimeToolExposurePolicy(
        "刚才为什么学习不到？只基于上面这段对话回答，不要调用外部工具。",
      ),
    ).toBe("disable-all");
  });

  it("keeps recent learned-content followups on local evidence instead of external tools", () => {
    expect(
      resolveConversationRuntimeToolExposurePolicy(
        "这条内容最值得保存的三点是什么？只基于刚才的学习内容回答。",
      ),
    ).toBe("local-learning-evidence-only");
  });

  it("leaves ordinary capability questions to the normal model/tool route", () => {
    expect(
      resolveConversationRuntimeToolExposurePolicy(
        "如果我给你接入 HyperFrames 的 CLI，你可以操作吗？",
      ),
    ).toBe("all");
  });

  it("filters local evidence policy down to the candidate evidence tool", () => {
    const tools = createDirectorConversationRuntimeTools();
    const exposed = filterConversationRuntimeToolsForExposurePolicy(
      tools,
      "local-learning-evidence-only",
    );

    expect(exposed.map((tool) => tool.name)).toEqual(["director.experience.candidates.list"]);
  });

  it("separates evidence-field reads from collection value advice", () => {
    expect(
      isReadOnlyLearningEvidenceFollowup(
        "看详情。请只基于刚才的学习结果，列出证据字段：URL、全文字符数、是否二次提取。",
      ),
    ).toBe(true);
    expect(
      isLearningCollectionAdviceQuestion(
        "这条内容最值得保存的三点是什么？只基于刚才的学习内容回答。",
      ),
    ).toBe(true);
    expect(
      isReadOnlyLearningEvidenceFollowup(
        "这条内容最值得保存的三点是什么？只基于刚才的学习内容回答。",
      ),
    ).toBe(false);
  });

  it("keeps capability questions out of learning confirmation", () => {
    expect(isLearningConfirmationPrompt("可以保存为经验库")).toBe(true);
    expect(isLearningConfirmationPrompt("如果我给你接入 HyperFrames 的 CLI，你可以操作吗？")).toBe(
      false,
    );
  });
});
