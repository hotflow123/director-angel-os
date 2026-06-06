import { describe, expect, it } from "vitest";

import {
  materializeDirectorReflectionReport,
  materializeReflectionExperienceCandidates,
} from "../src/reflection.js";
import type { RunOutputExperienceSource } from "../src/run-output-experience.js";

describe("director reflection materialization", () => {
  it("reflects a successful run and recommends a positive experience candidate", () => {
    const report = materializeDirectorReflectionReport({
      source: createRunOutputSource(),
      nowMs: 1_777_300_000_000,
    });
    const candidates = materializeReflectionExperienceCandidates({
      reflection: report,
      source: createRunOutputSource(),
      nowMs: 1_777_300_000_000,
    });

    expect(report).toMatchObject({
      sourceKind: "run",
      sourceId: "run-15s",
      goal: "生成一个15秒短剧分镜蓝图",
      outcome: "success",
      suggestedExperienceIntent: "positive-experience",
      status: "draft",
      reviewRequired: true,
    });
    expect(report.whatWorked).toEqual(expect.arrayContaining(["运行已完成，且没有失败标记。"]));
    expect(report.whatFailed).toEqual([]);
    expect(report.reusableLessons.join("\n")).toContain("assignments total=4 completed=4");
    expect(candidates.recommended.intent).toBe("positive-experience");
    expect(candidates.recommended.materialized.status).toBe("candidate");
    expect(candidates.blockedPositive).toBeUndefined();
  });

  it("reflects a failed run as a failure lesson and blocks positive experience", () => {
    const source = createRunOutputSource({
      status: "failed",
      flags: ["has-failures", "external-bridge-failed"],
      summary: ["run status=failed", "assignments total=4 completed=2 failed=2 blocked=0"],
      evidenceText:
        "Bridge failure reason: network_timeout. 脚本缺少角色、冲突、镜头参数和验收标准，不能作为成功制作经验。",
    });
    const report = materializeDirectorReflectionReport({ source, nowMs: 1_777_300_000_000 });
    const candidates = materializeReflectionExperienceCandidates({
      reflection: report,
      source,
      nowMs: 1_777_300_000_000,
    });

    expect(report.outcome).toBe("failure");
    expect(report.suggestedExperienceIntent).toBe("failure-lesson");
    expect(report.whatFailed.join("\n")).toContain("has-failures");
    expect(report.failureLessons.join("\n")).toContain("不能沉淀为正向经验");
    expect(candidates.recommended.intent).toBe("failure-lesson");
    expect(candidates.recommended.materialized.status).toBe("candidate");
    expect(candidates.blockedPositive?.status).toBe("quarantined");
  });

  it("treats completed runs with failure flags as mixed and blocks positive experience", () => {
    const source = createRunOutputSource({
      status: "completed",
      flags: ["has-blocked-assignments"],
      summary: ["run status=completed", "assignments total=3 completed=2 failed=0 blocked=1"],
      evidenceText:
        "Two assignments completed, but asset-router was blocked by missing platform credentials. 下次应先检查 adapter 凭证和审批状态。",
    });
    const report = materializeDirectorReflectionReport({ source, nowMs: 1_777_300_000_000 });
    const candidates = materializeReflectionExperienceCandidates({
      reflection: report,
      source,
      nowMs: 1_777_300_000_000,
    });

    expect(report.outcome).toBe("mixed");
    expect(report.suggestedExperienceIntent).toBe("failure-lesson");
    expect(report.whatWorked.join("\n")).toContain("部分步骤完成");
    expect(report.whatFailed.join("\n")).toContain("has-blocked-assignments");
    expect(candidates.recommended.intent).toBe("failure-lesson");
    expect(candidates.recommended.materialized.status).toBe("candidate");
    expect(candidates.blockedPositive?.status).toBe("quarantined");
  });
});

function createRunOutputSource(
  overrides: Partial<RunOutputExperienceSource> = {},
): RunOutputExperienceSource {
  return {
    runId: "run-15s",
    reportId: "report-run-15s",
    status: "completed",
    goal: "生成一个15秒短剧分镜蓝图",
    projectId: "short-drama",
    groupId: "storyboard",
    roles: ["script-planner", "shot-planner"],
    selectedAdapters: ["api-provider:text"],
    anchorIds: ["operator-request"],
    flags: [],
    summary: ["run status=completed", "assignments total=4 completed=4 failed=0 blocked=0"],
    evidenceText:
      "15秒短剧分镜应拆成三段：建立目标、冲突推进、信息揭示。每段需要明确时长、景别、机位、动作和音效。",
    recordedAt: "2026-04-27T16:00:00.000Z",
    ...overrides,
  };
}
