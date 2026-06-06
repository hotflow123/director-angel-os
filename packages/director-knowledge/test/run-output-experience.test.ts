import { describe, expect, it } from "vitest";

import { materializeRunOutputExperience } from "../src/run-output-experience.js";

describe("run output experience materialization", () => {
  it("turns a completed production output into a review-gated experience candidate", () => {
    const result = materializeRunOutputExperience({
      source: createRunOutputSource({
        evidenceText:
          "15秒短剧分镜应先建立目标，再推进冲突，最后用特写揭示信息。每个镜头必须标注时长、景别、机位、动作和音效，方便后续制作复用。",
      }),
      intent: "positive-experience",
      privacy: "confidential",
      nowMs: 1_777_290_000_000,
    });

    expect(result.status).toBe("candidate");
    expect(result.artifact.rawContent).toContain("15秒短剧分镜");
    expect(result.admission.status).toBe("admitted");
    expect(result.candidate?.status).toBe("candidate");
    expect(result.candidate?.runtimeInjection).toBe("disabled");
    expect(result.candidate).toMatchObject({
      candidateId: expect.stringMatching(/^experience_run_run-15s_/u),
      title: "Run lesson: 生成一个15秒短剧分镜蓝图",
      sourceAdapter: expect.objectContaining({
        sourceKind: "session-trajectory",
        sourceRef: "director-run://run-15s/report/report-run-15s",
      }),
      sourceArtifactId: result.artifact.artifactId,
      sourceDigest: result.artifact.digest,
      privacy: "confidential",
    });
    expect(result.candidate?.tags).toEqual(
      expect.arrayContaining([
        "source:director-run",
        "run-output",
        "status:completed",
        "quality:claim-usable",
      ]),
    );
    expect(result.candidate?.evidence[0]?.attributes).toMatchObject({
      runId: "run-15s",
      reportId: "report-run-15s",
      projectId: "short-drama",
      groupId: "storyboard",
      sourceQualityScore: expect.any(Number),
      claimQualityScore: expect.any(Number),
    });
  });

  it("marks which execution modules a media production lesson can influence", () => {
    const result = materializeRunOutputExperience({
      source: createRunOutputSource({
        selectedAdapters: ["moyin:video", "comfyui:image", "api-provider:text"],
        evidenceText:
          "Moyin 生成视频前应先把分镜拆成镜头级提示词；ComfyUI 只负责首帧和风格参考；API provider 文本模型负责脚本、分镜和提示词参数，避免把图片生成模型放进日常文本对话。",
      }),
      intent: "positive-experience",
      privacy: "confidential",
      nowMs: 1_777_290_000_000,
    });

    expect(result.status).toBe("candidate");
    expect(result.candidate?.tags).toEqual(
      expect.arrayContaining([
        "execution-module:moyin",
        "execution-module:comfyui",
        "execution-module:api-provider",
        "execution-module:script",
        "execution-module:storyboard",
        "execution-module:media-generation",
        "execution-impact:workflow-execution",
        "execution-impact:prompt-generation",
      ]),
    );
    expect(result.candidate?.evidence[0]?.attributes).toMatchObject({
      executionModules: expect.arrayContaining([
        "moyin",
        "comfyui",
        "api-provider",
        "script",
        "storyboard",
        "media-generation",
      ]),
      executionImpacts: expect.arrayContaining(["workflow-execution", "prompt-generation"]),
    });
  });

  it("quarantines failed output when asked to become positive experience", () => {
    const result = materializeRunOutputExperience({
      source: createRunOutputSource({
        status: "failed",
        flags: ["has-failures", "external-bridge-failed"],
        evidenceText: "模型返回了空泛脚本，没有镜头细节，也没有可复用的制作判断。",
      }),
      intent: "positive-experience",
      privacy: "confidential",
      nowMs: 1_777_290_000_000,
    });

    expect(result.status).toBe("quarantined");
    expect(result.candidate).toBeUndefined();
    expect(result.quarantine?.reason).toContain("cannot become positive experience");
    expect(result.quarantine?.artifact.artifactId).toBe(result.artifact.artifactId);
  });

  it("quarantines generic low-value completed output instead of making it experience", () => {
    const result = materializeRunOutputExperience({
      source: createRunOutputSource({
        evidenceText:
          "这是一个无经验、无 Skill 的通用初稿，内容为通用情境模拟。后续需要补充学习剧本、镜头语言和音效设计后再细化。",
      }),
      intent: "positive-experience",
      privacy: "confidential",
      nowMs: 1_777_290_000_000,
    });

    expect(result.status).toBe("quarantined");
    expect(result.candidate).toBeUndefined();
    expect(result.admission.reasons.join("\n")).toContain("generic low-value production draft");
  });

  it("quarantines completed casual chat output before it can become experience", () => {
    const result = materializeRunOutputExperience({
      source: createRunOutputSource({
        goal: "今天天气不错，随便聊聊",
        evidenceText:
          "用户只是随便聊今天的天气和心情，没有明确制作目标、学习来源、审查反馈或可复用的导演工作方法。这类输出不能沉淀为经验。",
      }),
      intent: "positive-experience",
      privacy: "confidential",
      nowMs: 1_777_290_000_000,
    });

    expect(result.status).toBe("quarantined");
    expect(result.candidate).toBeUndefined();
    expect(result.admission.reasons.join("\n")).toContain("low-signal casual run");
  });

  it("keeps completed preview-only output review-gated instead of quarantining it by default", () => {
    const result = materializeRunOutputExperience({
      source: createRunOutputSource({
        flags: ["preview-only"],
        evidenceText:
          "本地预览产物可作为待审经验：15秒短剧分镜先用中景建立目标，再用近景推进冲突，最后用特写揭示线索；审核者必须核对是否真的比旧经验更可复用。",
      }),
      intent: "positive-experience",
      privacy: "confidential",
      nowMs: 1_777_290_000_000,
    });

    expect(result.status).toBe("candidate");
    expect(result.candidate?.runtimeInjection).toBe("disabled");
    expect(result.candidate?.risks).toEqual(
      expect.arrayContaining([expect.stringContaining("Run flags: preview-only")]),
    );
    expect(result.candidate?.quality?.verdict).toBe("usable");
  });

  it("keeps failed output as an explicit failure lesson candidate", () => {
    const result = materializeRunOutputExperience({
      source: createRunOutputSource({
        status: "failed",
        flags: ["has-failures", "external-bridge-failed"],
        evidenceText:
          "失败原因：脚本只有通用场景，没有具体角色、冲突和镜头参数。下次应要求主题、人物关系、镜头数量和质量标准后再生成。",
      }),
      intent: "failure-lesson",
      privacy: "confidential",
      nowMs: 1_777_290_000_000,
    });

    expect(result.status).toBe("candidate");
    expect(result.candidate?.summary).toContain("失败教训");
    expect(result.candidate?.tags).toEqual(
      expect.arrayContaining([
        "source:director-run",
        "run-output",
        "failure-lesson",
        "negative-experience",
        "status:failed",
      ]),
    );
    expect(result.candidate?.applicability).toContain("Avoid repeating");
    expect(result.candidate?.quality?.verdict).toBe("usable");
  });
});

function createRunOutputSource(overrides = {}) {
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
