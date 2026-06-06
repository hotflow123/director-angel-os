import { describe, expect, it } from "vitest";

import { materializeDirectorReflectionReport } from "../src/reflection.js";
import type { RunOutputExperienceSource } from "../src/run-output-experience.js";
import {
  materializeDirectorSoulCandidateFromReflection,
  materializeDirectorSoulDecision,
  materializeDirectorSoulDocumentFromCandidate,
  renderDirectorSoulMarkdown,
} from "../src/soul.js";

describe("director soul candidate materialization", () => {
  it("turns successful reflection suggestions into a review-gated Soul candidate", () => {
    const reflection = materializeDirectorReflectionReport({
      source: createRunOutputSource(),
      nowMs: 1_777_300_000_000,
    });
    const candidate = materializeDirectorSoulCandidateFromReflection({
      reflection,
      nowMs: 1_777_300_001_000,
    });

    expect(candidate).toMatchObject({
      schemaVersion: "director.soul.candidate.v1",
      sourceReflectionId: reflection.reflectionId,
      sourceKind: "run",
      sourceId: "run-15s",
      status: "pending",
      riskLevel: "low",
      createdAt: "2026-04-27T14:26:41.000Z",
    });
    expect(candidate?.candidateId).toMatch(/^soul_reflection_run-15s_/u);
    expect(candidate?.patchSummary).toContain("生成一个15秒短剧分镜蓝图");
    expect(candidate?.proposedSections.directorPrinciples).toContain("人工审查");
    expect(candidate?.proposedSections.userPreferences).toContain("SoulCandidate");
    expect(candidate?.evidenceRefs).toEqual(reflection.evidenceRefs);
  });

  it("keeps failed reflection candidates review-gated and framed as avoid rules", () => {
    const reflection = materializeDirectorReflectionReport({
      source: createRunOutputSource({
        status: "failed",
        flags: ["has-failures", "external-bridge-failed"],
        summary: ["run status=failed", "assignments total=2 completed=1 failed=1"],
        evidenceText: "Bridge failed because credentials were missing.",
      }),
      nowMs: 1_777_300_000_000,
    });
    const candidate = materializeDirectorSoulCandidateFromReflection({
      reflection,
      nowMs: 1_777_300_001_000,
    });

    expect(candidate).toMatchObject({
      status: "pending",
      riskLevel: "medium",
    });
    expect(candidate?.proposedSections.userBoundaries).toContain("不能自动写入 Soul");
    expect(candidate?.proposedSections.failureLessons).toContain("不能沉淀为正向经验");
  });

  it("does not create a Soul candidate when reflection has no Soul suggestions", () => {
    const reflection = materializeDirectorReflectionReport({
      source: createRunOutputSource({
        status: "created",
        flags: [],
        summary: ["run status=created"],
        evidenceText: "",
      }),
      nowMs: 1_777_300_000_000,
    });

    expect(materializeDirectorSoulCandidateFromReflection({ reflection })).toBeNull();
  });

  it("accepts a Soul candidate into a publishable Soul document and markdown", () => {
    const reflection = materializeDirectorReflectionReport({
      source: createRunOutputSource(),
      nowMs: 1_777_300_000_000,
    });
    const candidate = materializeDirectorSoulCandidateFromReflection({
      reflection,
      nowMs: 1_777_300_001_000,
    });
    if (candidate === null) {
      throw new Error("expected soul candidate");
    }

    const decision = materializeDirectorSoulDecision({
      candidate,
      decision: "accepted",
      actor: "operator",
      note: "用户确认这条偏好可进入 Soul",
      nowMs: 1_777_300_002_000,
    });
    const document = materializeDirectorSoulDocumentFromCandidate({
      candidate,
      decision,
      nowMs: 1_777_300_002_000,
    });
    const markdown = renderDirectorSoulMarkdown(document);

    expect(decision).toMatchObject({
      candidateId: candidate.candidateId,
      decision: "accepted",
      actor: "operator",
      note: "用户确认这条偏好可进入 Soul",
    });
    expect(document).toMatchObject({
      schemaVersion: "director.soul.v1",
      sourceCandidateId: candidate.candidateId,
      updatedAt: "2026-04-27T14:26:42.000Z",
      sections: expect.objectContaining(candidate.proposedSections),
    });
    expect(markdown).toContain("# Director Angel Soul");
    expect(markdown).toContain("## Director Principles");
    expect(markdown).toContain(candidate.proposedSections.directorPrinciples);
  });

  it("reject decisions never materialize a published Soul document", () => {
    const reflection = materializeDirectorReflectionReport({
      source: createRunOutputSource(),
      nowMs: 1_777_300_000_000,
    });
    const candidate = materializeDirectorSoulCandidateFromReflection({
      reflection,
      nowMs: 1_777_300_001_000,
    });
    if (candidate === null) {
      throw new Error("expected soul candidate");
    }
    const decision = materializeDirectorSoulDecision({
      candidate,
      decision: "rejected",
      actor: "operator",
      nowMs: 1_777_300_002_000,
    });

    expect(decision).toMatchObject({
      candidateId: candidate.candidateId,
      decision: "rejected",
    });
    expect(() =>
      materializeDirectorSoulDocumentFromCandidate({
        candidate,
        decision,
        nowMs: 1_777_300_002_000,
      }),
    ).toThrow(/accepted/u);
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
