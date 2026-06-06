import { describe, expect, it } from "vitest";

import { createProductionResultSystemPrompt, humanizeProductionResultText } from "../src/index.js";

describe("production output policy", () => {
  it("creates a result-first system prompt for channel production replies", () => {
    const prompt = createProductionResultSystemPrompt("desktop");

    expect(prompt).toContain("用户只要结果，不要过程");
    expect(prompt).toContain("不要暴露 Director run、蓝图 ID、assignment");
    expect(prompt).toContain("如果用户要 15 秒分镜，直接给 3-5 个镜头");
  });

  it("removes internal process noise from model production text", () => {
    const text = [
      "好的 Director Angel！我理解了。这是一只小猫的治愈系旅行故事。",
      "先给一版制作草案，您可以直接参考：",
      "",
      "片名：《咪咪的公园奇遇记》",
      "分镜：1. 出门；2. 到公园；3. 回家。",
      "",
      "**待审查项**",
      "- assignment-snapshot-desktop-1-script-planner",
      "**下一步**",
      "到运行与审查里批准。",
    ].join("\n");

    const cleaned = humanizeProductionResultText(text);

    expect(cleaned).toContain("这是一只小猫的治愈系旅行故事。");
    expect(cleaned).toContain("片名：《咪咪的公园奇遇记》");
    expect(cleaned).not.toContain("Director Angel");
    expect(cleaned).not.toContain("先给一版");
    expect(cleaned).not.toContain("您可以直接参考");
    expect(cleaned).not.toContain("待审查项");
    expect(cleaned).not.toContain("assignment");
    expect(cleaned).not.toContain("下一步");
  });

  it("drops command echoes that only mirror the user objective", () => {
    const cleaned = humanizeProductionResultText(
      [
        "/制作 生成一个15秒短剧分镜蓝图 needs operator review before execution handoff.",
        "生成一个15秒短剧分镜蓝图，主题：小猫旅游记",
        "补充内容：小猫去公园",
      ].join("\n"),
    );

    expect(cleaned).toBe("");
  });

  it("keeps real production judgment lines while dropping objective echoes", () => {
    const cleaned = humanizeProductionResultText(
      [
        "生成一个15秒短剧分镜蓝图，主题：小猫旅游记",
        "制作判断：可以先做15秒三镜头短剧初稿。",
        "分镜蓝图：1 建立人物；2 推进冲突；3 留下钩子。",
      ].join("\n"),
    );

    expect(cleaned).toContain("制作判断：可以先做15秒三镜头短剧初稿。");
    expect(cleaned).toContain("分镜蓝图：1 建立人物");
    expect(cleaned).not.toContain("主题：小猫旅游记");
  });
});
