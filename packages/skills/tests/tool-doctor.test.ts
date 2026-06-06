import { describe, expect, it } from "vitest";

import { summarizeSkillRuntimeStatuses } from "../src/index.js";

describe("summarizeSkillRuntimeStatuses", () => {
  it("summarizes Skill runtime availability for shared control surfaces", () => {
    const summary = summarizeSkillRuntimeStatuses([
      {
        id: "skill.ready",
        runtimeStatus: "ready",
        doctorStatus: "ready",
        modelVisible: true,
        eligible: true,
      },
      {
        id: "skill.needs-setup",
        runtimeStatus: "needs-setup",
        doctorStatus: "needs-setup",
        modelVisible: false,
        eligible: false,
        missingToolNames: ["x_search"],
      },
      {
        id: "skill.operator-only",
        runtimeStatus: "model-invocation-disabled",
        doctorStatus: "model-invocation-disabled",
        modelVisible: false,
        eligible: false,
      },
      {
        id: "skill.old",
        runtimeStatus: "missing-skill",
        doctorStatus: "missing-skill",
        modelVisible: false,
        eligible: false,
        uncheckedToolNames: ["legacy_tool"],
      },
    ]);

    expect(summary).toMatchObject({
      total: 4,
      readyCount: 1,
      needsSetupCount: 1,
      modelInvocationDisabledCount: 1,
      missingSkillCount: 1,
      modelVisibleCount: 1,
      eligibleCount: 1,
      blockedCount: 3,
      uncheckedToolCount: 1,
      missingToolNames: ["x_search"],
      uncheckedToolNames: ["legacy_tool"],
      status: "needs-attention",
      statusCounts: {
        ready: 1,
        "needs-setup": 1,
        "model-invocation-disabled": 1,
        "missing-skill": 1,
      },
    });
    expect(summary.nextActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("刷新 Skill 索引"),
        expect.stringContaining("外部工具 provider"),
        expect.stringContaining("模型调用权限"),
        expect.stringContaining("provider manifest"),
      ]),
    );
  });
});
