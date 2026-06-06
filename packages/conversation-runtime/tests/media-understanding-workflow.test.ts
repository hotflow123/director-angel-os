import { describe, expect, it } from "vitest";

import { PolicyRuntime } from "@hotflow/policy-runtime";

import {
  createAdmittedMediaUnderstandingEvidence,
  createConversationRuntimeMediaInventory,
  createExternalToolMediaUnderstandingInvoker,
  createMediaUnderstandingWorkflow,
  createSemanticMediaUnderstandingProviderInvoker,
  runMediaUnderstandingExecutionPlan,
} from "../src/index.js";

describe("media understanding workflow", () => {
  it("fails closed with clear authorization choices and budget before media understanding", () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/thread/1",
      body: [
        "正文已经读取。",
        "![cover](https://cdn.example.test/cover.jpg)",
        "https://cdn.example.test/demo.mp4",
        "https://cdn.example.test/audio.m4a",
      ].join("\n"),
      structuredContent: {
        media: [
          {
            url: "blob:https://example.test/opaque-video",
            kind: "video",
            durationSeconds: 121,
            poster: "https://cdn.example.test/poster.webp",
          },
        ],
      },
    });

    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/thread/1",
      textRead: true,
      authorization: { mode: "media_inventory" },
    });

    expect(workflow.status).toBe("authorization_required");
    expect(workflow.textEvidenceStatus).toBe("read");
    expect(workflow.mediaUnderstandingStatus).toBe("not_understood");
    expect(workflow.authorization.question).toContain("只记录媒体清单");
    expect(workflow.authorization.question).toContain("低成本视觉理解");
    expect(workflow.authorization.question).toContain("深度视频理解");
    expect(workflow.authorization.request).toMatchObject({
      required: true,
      assetCount: 5,
      imageCount: 1,
      videoCount: 2,
      audioCount: 1,
      budget: {
        fileCountLimit: 5,
        videoMinuteLimit: 3,
        audioMinuteLimit: 1,
        estimatedCostTier: "high",
      },
    });
    expect(workflow.unauthorizedDisclosure).toBe(
      "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
    );
    expect(workflow.executionPlan).toEqual([]);
    expect(workflow.admission).toMatchObject({
      status: "text_admissible_media_list_only",
      reason: "media_not_understood_without_user_authorization",
      canAdmitTextEvidence: true,
      canAdmitMediaContent: false,
      requiredNextAction: "request_user_authorization",
      budget: expect.objectContaining({
        fileCountLimit: 5,
        videoMinuteLimit: 3,
        audioMinuteLimit: 1,
      }),
      evidenceRefIds: expect.arrayContaining(["media-evidence-1"]),
    });
    expect(workflow.evidenceBackfill).toMatchObject({
      admissible: true,
      mediaPublishable: false,
      evidenceRefs: expect.arrayContaining([
        expect.objectContaining({
          status: "listed_only",
          publishable: false,
          realVisualUnderstanding: false,
        }),
      ]),
    });
  });

  it("creates a bounded media understanding execution plan after explicit authorization", () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/case",
      structuredContent: {
        media: [
          {
            url: "https://cdn.example.test/frame.jpg",
            kind: "image",
            width: 1280,
            height: 720,
          },
          {
            url: "https://cdn.example.test/clip.mp4",
            kind: "video",
            durationSeconds: 42,
          },
        ],
      },
    });

    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/case",
      textRead: true,
      authorization: {
        mode: "low_cost",
        authorized: true,
        tokenLimit: 8_000,
        fileCountLimit: 1,
        videoMinuteLimit: 1,
      },
    });

    expect(workflow.status).toBe("authorized");
    expect(workflow.mediaUnderstandingStatus).toBe("scheduled");
    expect(workflow.unauthorizedDisclosure).toBeUndefined();
    expect(workflow.executionPlan).toEqual([
      expect.objectContaining({
        stepId: "media-understanding-1",
        sourceRef: "https://cdn.example.test/frame.jpg",
        mode: "low_cost",
        toolName: "media_understanding",
        evidenceBackfillStatus: "pending",
      }),
    ]);
    expect(workflow.authorization.budget).toMatchObject({
      tokenLimit: 8_000,
      fileCountLimit: 1,
      videoMinuteLimit: 1,
    });
    expect(workflow.executionPlan[0]?.budget).toMatchObject({
      tokenLimit: 8_000,
      estimatedCostTier: "medium",
    });
    expect(workflow.admission).toMatchObject({
      status: "media_understanding_pending",
      reason: "authorized_media_understanding_must_backfill_evidence_before_admission",
      canAdmitTextEvidence: true,
      canAdmitMediaContent: false,
      requiredNextAction: "run_media_understanding_plan",
      evidenceRefIds: ["media-evidence-1", "media-evidence-2"],
    });
    expect(workflow.evidenceBackfill).toMatchObject({
      admissible: false,
      mediaPublishable: false,
      pendingUnderstandingCount: 1,
    });
  });

  it("projects provider pricing into media understanding budget estimates without hardcoded providers", () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/priced-media",
      structuredContent: {
        media: [
          { url: "https://cdn.example.test/frame.jpg", kind: "image" },
          { url: "https://cdn.example.test/clip.mp4", kind: "video", durationSeconds: 95 },
          { url: "https://cdn.example.test/audio.mp3", kind: "audio", durationSeconds: 61 },
        ],
      },
    });

    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/priced-media",
      textRead: true,
      authorization: { mode: "deep_multimodal", authorized: true },
      providerCostProfile: {
        providerId: "semantic-provider-fixture",
        currency: "USD",
        pricingSource: "test-rate-card",
        lowCost: {
          imageMinorUnits: 4,
          videoMinuteMinorUnits: 30,
          audioMinuteMinorUnits: 12,
        },
        deepMultimodal: {
          imageMinorUnits: 12,
          videoMinuteMinorUnits: 90,
          audioMinuteMinorUnits: 35,
        },
      },
    });

    expect(workflow.authorization.budget.costEstimate).toMatchObject({
      providerId: "semantic-provider-fixture",
      currency: "USD",
      pricingSource: "test-rate-card",
      estimatedMinorUnits: 262,
    });
    expect(workflow.executionPlan[0]?.budget.costEstimate).toMatchObject({
      providerId: "semantic-provider-fixture",
      estimatedMinorUnits: 262,
    });
  });

  it("runs authorized media understanding steps and backfills evidence without admitting semantic media claims", async () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/case",
      structuredContent: {
        media: [
          {
            url: "https://cdn.example.test/frame.png",
            kind: "image",
            width: 1280,
            height: 720,
            mimeType: "image/png",
          },
          {
            url: "blob:https://example.test/opaque-video",
            kind: "video",
            durationSeconds: 12,
          },
        ],
      },
    });
    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/case",
      textRead: true,
      authorization: {
        mode: "low_cost",
        authorized: true,
        fileCountLimit: 2,
        videoMinuteLimit: 1,
      },
    });

    const calls: unknown[] = [];
    const result = await runMediaUnderstandingExecutionPlan({
      workflow,
      inventory,
      invokeTool: async ({ step, artifact }) => {
        calls.push({ step, artifact });
        return {
          ok: true,
          status: "success",
          summary: "metadata-only image analysis",
          output: {
            observations: [
              {
                id: "media.dimensions",
                summary: "1280 x 720 pixels",
                confidence: 1,
              },
            ],
            sandbox: {
              mode: "metadata-only",
              pathContentRead: false,
            },
          },
          metadata: {
            runnerMode: "local-metadata",
          },
        };
      },
      nowMs: () => 123,
    });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({
      schemaVersion: "conversation-runtime.media-understanding-backfill.v1",
      status: "partial",
      canAdmitMediaContent: false,
      understoodCount: 1,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        stepId: "media-understanding-1",
        status: "understood_metadata_only",
        evidenceRef: expect.objectContaining({
          id: "media-evidence-1",
          sourceRef: "https://cdn.example.test/frame.png",
          status: "vision_analyzed",
          realVisualUnderstanding: true,
          publishable: false,
          observedAtMs: 123,
          metadata: expect.objectContaining({
            mediaUnderstandingMode: "low_cost",
            semanticUnderstanding: false,
            observations: expect.arrayContaining([
              expect.objectContaining({ id: "media.dimensions" }),
            ]),
          }),
        }),
      }),
      expect.objectContaining({
        stepId: "media-understanding-2",
        status: "skipped",
        reason: "blob_reference_requires_browser_capture_before_media_understanding",
        evidenceRef: expect.objectContaining({
          id: "media-evidence-2",
          status: "blocked",
          realVisualUnderstanding: false,
          publishable: false,
        }),
      }),
    ]);
  });

  it("admits semantic media evidence only when provider output, policy, and provenance are complete", async () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/case",
      structuredContent: {
        media: [
          {
            url: "https://cdn.example.test/frame.png",
            kind: "image",
            width: 1280,
            height: 720,
            mimeType: "image/png",
          },
        ],
      },
    });
    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/case",
      textRead: true,
      authorization: {
        mode: "low_cost",
        authorized: true,
      },
    });
    const semantic = await runMediaUnderstandingExecutionPlan({
      workflow,
      inventory,
      invokeTool: async () => ({
        ok: true,
        status: "success",
        summary: "画面中有一把红伞。",
        output: {
          semanticUnderstanding: true,
          understandingKind: "ocr_visual_summary",
          observations: [
            {
              id: "visual.red-umbrella",
              summary: "画面中人物手持红伞。",
              confidence: 0.92,
              evidenceRefIds: ["media-evidence-1"],
              sourceRefs: ["https://cdn.example.test/frame.png"],
            },
          ],
        },
        metadata: {
          providerId: "semantic-vision",
          policyEnvelope: {
            decision: { verdict: "allow", reason: "approved" },
            evidence: {
              evidenceRefIds: ["media-evidence-1"],
              sourceRefs: ["https://cdn.example.test/frame.png"],
              admission: { canAdmitResult: true },
            },
          },
        },
      }),
      nowMs: () => 789,
    });

    const admitted = createAdmittedMediaUnderstandingEvidence(semantic);

    expect(admitted).toMatchObject({
      schemaVersion: "conversation-runtime.media-understanding-admission.v1",
      canAdmitMediaContent: true,
      admittedCount: 1,
      blockedCount: 0,
      requiredDisclosure: "媒体已在授权、预算和策略准入后完成语义理解，可引用对应媒体证据。",
      admittedEvidenceRefIds: ["media-evidence-1"],
      blocked: [],
    });
    expect(semantic).toMatchObject({
      canAdmitMediaContent: true,
      understoodCount: 1,
      results: [
        expect.objectContaining({
          status: "understood_semantic",
          evidenceRef: expect.objectContaining({
            publishable: true,
            realVisualUnderstanding: true,
            metadata: expect.objectContaining({
              semanticUnderstanding: true,
              understandingKind: "ocr_visual_summary",
            }),
          }),
        }),
      ],
    });
  });

  it("blocks semantic-looking media output when policy or provenance is missing", async () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/case",
      structuredContent: {
        media: [{ url: "https://cdn.example.test/frame.png", kind: "image" }],
      },
    });
    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/case",
      authorization: {
        mode: "low_cost",
        authorized: true,
      },
    });
    const result = await runMediaUnderstandingExecutionPlan({
      workflow,
      inventory,
      invokeTool: async () => ({
        ok: true,
        status: "success",
        summary: "画面中有一把红伞。",
        output: {
          semanticUnderstanding: true,
          observations: [{ id: "visual.red-umbrella", summary: "画面中人物手持红伞。" }],
        },
        metadata: {
          providerId: "semantic-vision",
        },
      }),
    });

    const admitted = createAdmittedMediaUnderstandingEvidence(result);

    expect(result).toMatchObject({
      canAdmitMediaContent: false,
      results: [
        expect.objectContaining({
          status: "understood_semantic",
          evidenceRef: expect.objectContaining({
            publishable: false,
            metadata: expect.objectContaining({
              semanticUnderstanding: true,
            }),
          }),
        }),
      ],
    });
    expect(admitted).toMatchObject({
      canAdmitMediaContent: false,
      admittedCount: 0,
      blockedCount: 1,
      requiredDisclosure:
        "媒体工具返回了语义内容，但缺少策略准入或来源证据，不能把媒体内容当成结论。",
      blocked: [
        expect.objectContaining({
          evidenceRefId: "media-evidence-1",
          reasons: expect.arrayContaining(["policy_admission_missing", "source_refs_missing"]),
        }),
      ],
    });
  });

  it("adapts the media understanding plan to the external tool control plane", async () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/case",
      structuredContent: {
        media: [
          {
            url: "https://cdn.example.test/frame.png",
            kind: "image",
            width: 1280,
            height: 720,
            mimeType: "image/png",
          },
        ],
      },
    });
    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/case",
      authorization: {
        mode: "low_cost",
        authorized: true,
      },
    });
    const invocations: unknown[] = [];
    const invokeTool = createExternalToolMediaUnderstandingInvoker({
      invoke: async (request) => {
        invocations.push(request);
        return {
          ok: true,
          status: "success",
          toolId: request.toolId,
          operationId: request.operationId,
          content: "metadata-only image analysis",
          output: {
            observations: [{ id: "media.dimensions", summary: "1280 x 720 pixels" }],
          },
          trace: [],
        };
      },
      sandboxRuntimePolicy: {
        enabledBackends: ["readonly"],
        readableRoots: ["/workspace"],
        networkPolicy: "none",
      },
    });

    const result = await runMediaUnderstandingExecutionPlan({
      workflow,
      inventory,
      invokeTool,
      nowMs: () => 456,
    });

    expect(invocations).toEqual([
      expect.objectContaining({
        toolId: "media-understanding.local",
        operationId: "media.understand_image",
        requestedNetworkPolicy: "none",
        args: {
          artifact: expect.objectContaining({
            id: "media-1",
            kind: "image",
            url: "https://cdn.example.test/frame.png",
            mimeType: "image/png",
          }),
        },
      }),
    ]);
    expect(result.results[0]).toMatchObject({
      status: "understood_metadata_only",
      evidenceRef: expect.objectContaining({
        observedAtMs: 456,
        metadata: expect.objectContaining({
          semanticUnderstanding: false,
        }),
      }),
    });
  });

  it("gates external media understanding through the policy envelope before invoking tools", async () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/case",
      structuredContent: {
        media: [
          {
            url: "https://cdn.example.test/frame.png",
            kind: "image",
            width: 1280,
            height: 720,
            mimeType: "image/png",
          },
        ],
      },
    });
    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/case",
      authorization: {
        mode: "low_cost",
        authorized: true,
      },
    });
    const blockedInvocations: unknown[] = [];
    const blockedInvokeTool = createExternalToolMediaUnderstandingInvoker({
      invoke: async (request) => {
        blockedInvocations.push(request);
        return {
          ok: true,
          status: "success",
          toolId: request.toolId,
          operationId: request.operationId,
          content: "should not run",
          trace: [],
        };
      },
      policyRuntime: new PolicyRuntime({
        executionPolicy: {
          approvalRequiredAtOrAbove: "high",
          denyByDefault: false,
        },
      }),
      approval: {
        status: "pending",
      },
      nowMs: () => 1_000,
    });

    const blocked = await runMediaUnderstandingExecutionPlan({
      workflow,
      inventory,
      invokeTool: blockedInvokeTool,
      nowMs: () => 1_001,
    });

    expect(blockedInvocations).toHaveLength(0);
    expect(blocked.results[0]).toMatchObject({
      status: "failed",
      reason: "policy_verdict_ask",
      summary: "Media understanding blocked by policy: Tool execution requires approval",
      metadata: expect.objectContaining({
        policyEnvelope: expect.objectContaining({
          decision: expect.objectContaining({
            verdict: "ask",
          }),
          evidence: expect.objectContaining({
            admission: expect.objectContaining({
              canAdmitResult: false,
            }),
          }),
        }),
      }),
    });

    const allowedInvocations: unknown[] = [];
    const allowedInvokeTool = createExternalToolMediaUnderstandingInvoker({
      invoke: async (request) => {
        allowedInvocations.push(request);
        return {
          ok: true,
          status: "success",
          toolId: request.toolId,
          operationId: request.operationId,
          content: "metadata-only image analysis",
          output: {
            observations: [{ id: "media.dimensions", summary: "1280 x 720 pixels" }],
          },
          trace: [],
          metadata: {
            runnerMode: "external-tool",
          },
        };
      },
      policyRuntime: new PolicyRuntime({
        executionPolicy: {
          approvalRequiredAtOrAbove: "high",
          denyByDefault: false,
        },
      }),
      approval: {
        status: "approved",
        approver: "operator",
      },
      nowMs: () => 2_000,
    });

    const allowed = await runMediaUnderstandingExecutionPlan({
      workflow,
      inventory,
      invokeTool: allowedInvokeTool,
      nowMs: () => 2_001,
    });

    expect(allowedInvocations).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          policyEnvelope: expect.objectContaining({
            decision: expect.objectContaining({
              verdict: "allow",
            }),
            evidence: expect.objectContaining({
              admission: expect.objectContaining({
                canAdmitResult: true,
              }),
            }),
          }),
        }),
      }),
    ]);
    expect(allowed.results[0]).toMatchObject({
      status: "understood_metadata_only",
      metadata: expect.objectContaining({
        runnerMode: "external-tool",
        policyEnvelope: expect.objectContaining({
          decision: expect.objectContaining({
            verdict: "allow",
          }),
        }),
      }),
      evidenceRef: expect.objectContaining({
        metadata: expect.objectContaining({
          runnerMetadata: expect.objectContaining({
            policyEnvelope: expect.objectContaining({
              decision: expect.objectContaining({
                verdict: "allow",
              }),
            }),
          }),
        }),
      }),
    });
  });

  it("runs concrete semantic media provider adapters for OCR, keyframes, transcription, and multimodal summary", async () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/story",
      structuredContent: {
        media: [
          {
            url: "https://cdn.example.test/poster.png",
            kind: "image",
            width: 1280,
            height: 720,
            mimeType: "image/png",
          },
          {
            url: "https://cdn.example.test/clip.mp4",
            kind: "video",
            durationSeconds: 32,
            mimeType: "video/mp4",
          },
          {
            url: "https://cdn.example.test/dialogue.m4a",
            kind: "audio",
            durationSeconds: 18,
            mimeType: "audio/mp4",
          },
        ],
      },
    });
    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/story",
      authorization: {
        mode: "deep_multimodal",
        authorized: true,
        fileCountLimit: 3,
        videoMinuteLimit: 1,
        audioMinuteLimit: 1,
      },
    });
    const calls: string[] = [];
    const invokeTool = createSemanticMediaUnderstandingProviderInvoker({
      providerId: "semantic-fixture",
      policyRuntime: new PolicyRuntime({
        executionPolicy: {
          approvalRequiredAtOrAbove: "high",
          denyByDefault: false,
        },
      }),
      approval: {
        status: "approved",
        approver: "operator",
      },
      adapters: {
        ocr: async ({ artifact, operation }) => {
          calls.push(`${operation}:${artifact.kind}`);
          return {
            ok: true,
            summary: "OCR 读取到海报标题。",
            text: "雨夜重逢",
            observations: [{ id: "ocr.title", summary: "海报文字：雨夜重逢", confidence: 0.96 }],
          };
        },
        keyframes: async ({ artifact, operation }) => {
          calls.push(`${operation}:${artifact.kind}`);
          return {
            ok: true,
            summary: "抽取 2 个关键帧。",
            keyframes: [
              { timeMs: 0, summary: "雨夜街道建立镜头。" },
              { timeMs: 12_000, summary: "两位角色在伞下对视。" },
            ],
          };
        },
        transcription: async ({ artifact, operation }) => {
          calls.push(`${operation}:${artifact.kind}`);
          return {
            ok: true,
            summary: "音频转写完成。",
            transcript: "你终于回来了。",
            segments: [{ startMs: 0, endMs: 1800, text: "你终于回来了。" }],
          };
        },
        multimodalSummary: async ({ artifact, operation }) => {
          calls.push(`${operation}:${artifact.kind}`);
          return {
            ok: true,
            summary: `${artifact.kind} 多模态摘要完成。`,
            observations: [
              {
                id: `${artifact.kind}.summary`,
                summary: `${artifact.kind} 内容围绕雨夜重逢展开。`,
                confidence: 0.88,
              },
            ],
          };
        },
      },
      nowMs: () => 3_000,
    });

    const result = await runMediaUnderstandingExecutionPlan({
      workflow,
      inventory,
      invokeTool,
      nowMs: () => 3_001,
    });
    const admitted = createAdmittedMediaUnderstandingEvidence(result);

    expect(calls).toEqual([
      "ocr:image",
      "multimodal_summary:image",
      "keyframes:video",
      "multimodal_summary:video",
      "transcription:audio",
    ]);
    expect(result).toMatchObject({
      status: "complete",
      canAdmitMediaContent: true,
      understoodCount: 3,
      failedCount: 0,
      results: [
        expect.objectContaining({
          status: "understood_semantic",
          evidenceRef: expect.objectContaining({
            publishable: true,
            metadata: expect.objectContaining({
              semanticUnderstanding: true,
              understandingKind: "ocr_multimodal_summary",
            }),
          }),
        }),
        expect.objectContaining({
          status: "understood_semantic",
          evidenceRef: expect.objectContaining({
            publishable: true,
            metadata: expect.objectContaining({
              semanticUnderstanding: true,
              understandingKind: "keyframes_multimodal_summary",
            }),
          }),
        }),
        expect.objectContaining({
          status: "understood_semantic",
          evidenceRef: expect.objectContaining({
            publishable: true,
            metadata: expect.objectContaining({
              semanticUnderstanding: true,
              understandingKind: "transcription",
            }),
          }),
        }),
      ],
    });
    expect(result.results[0]?.toolOutput).toMatchObject({
      semanticUnderstanding: true,
      providerId: "semantic-fixture",
      sourceRefs: ["https://cdn.example.test/poster.png"],
      evidenceRefIds: ["media-evidence-1"],
      ocrText: "雨夜重逢",
    });
    expect(result.results[1]?.toolOutput).toMatchObject({
      keyframes: expect.arrayContaining([
        expect.objectContaining({ timeMs: 0, summary: "雨夜街道建立镜头。" }),
      ]),
    });
    expect(result.results[2]?.toolOutput).toMatchObject({
      transcript: "你终于回来了。",
      segments: expect.arrayContaining([expect.objectContaining({ text: "你终于回来了。" })]),
    });
    expect(admitted).toMatchObject({
      canAdmitMediaContent: true,
      admittedCount: 3,
      blockedCount: 0,
      admittedEvidenceRefIds: ["media-evidence-1", "media-evidence-2", "media-evidence-3"],
    });
  });

  it("fails closed when a required semantic media provider adapter is missing", async () => {
    const inventory = createConversationRuntimeMediaInventory({
      sourceUrl: "https://example.test/audio",
      structuredContent: {
        media: [
          {
            url: "https://cdn.example.test/dialogue.m4a",
            kind: "audio",
            durationSeconds: 18,
            mimeType: "audio/mp4",
          },
        ],
      },
    });
    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/audio",
      authorization: {
        mode: "deep_multimodal",
        authorized: true,
      },
    });
    const invokeTool = createSemanticMediaUnderstandingProviderInvoker({
      providerId: "semantic-fixture",
      adapters: {},
    });

    const result = await runMediaUnderstandingExecutionPlan({
      workflow,
      inventory,
      invokeTool,
      nowMs: () => 4_001,
    });

    expect(result).toMatchObject({
      status: "failed",
      canAdmitMediaContent: false,
      understoodCount: 0,
      failedCount: 1,
      results: [
        expect.objectContaining({
          status: "failed",
          reason: "semantic_provider_adapter_missing:transcription",
          evidenceRef: expect.objectContaining({
            publishable: false,
            metadata: expect.objectContaining({
              semanticUnderstanding: false,
              error: "semantic_provider_adapter_missing:transcription",
            }),
          }),
        }),
      ],
    });
  });
});
