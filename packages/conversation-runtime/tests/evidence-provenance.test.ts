import { describe, expect, it } from "vitest";

import {
  createConversationRuntimeEvidenceProvenanceEnvelope,
  createConversationRuntimeMediaInventory,
  createGovernedExternalKnowledgeTransferPlan,
  createMediaUnderstandingWorkflow,
} from "../src/index.js";

describe("conversation runtime evidence provenance", () => {
  it("summarizes text-read, media-listed, media-analysis, and knowledge admission in one contract", async () => {
    const inventory = createConversationRuntimeMediaInventory({
      body: [
        "正文已经读取。",
        "![cover](https://cdn.example.test/cover.jpg)",
        "https://cdn.example.test/demo.mp4",
      ].join("\n"),
      sourceUrl: "https://example.test/post",
    });
    const workflow = createMediaUnderstandingWorkflow({
      inventory,
      sourceUrl: "https://example.test/post",
      textRead: true,
      authorization: { mode: "media_inventory" },
      evidencePrefix: "media-evidence-post",
    });
    const knowledgePlan = await createGovernedExternalKnowledgeTransferPlan({
      connectors: ["notebooklm"],
      mode: "sync_clean_text",
      source: {
        title: "导演复盘",
        sourceRef: "https://example.test/post",
        artifactIds: ["artifact-1"],
        evidenceRefIds: ["source-evidence-1", "media-evidence-post-1"],
        textCharacterCount: 8000,
        mediaUnderstandingStatus: "not_understood",
      },
      policyRuntime: {
        decide: async () => ({
          verdict: "allow",
          reason: "unit-test allow",
        }),
      },
      nowMs: () => 123,
    });

    const envelope = createConversationRuntimeEvidenceProvenanceEnvelope({
      source: {
        kind: "web_extract",
        sourceRef: "https://example.test/post",
        sourceSnapshotId: "snapshot-post",
        textRead: true,
        readableCharacterCount: 8000,
        secondPassExtracted: false,
      },
      mediaInventory: inventory,
      mediaUnderstandingWorkflow: workflow,
      knowledgeTransferPlan: knowledgePlan,
      evidenceRefIds: ["source-evidence-1"],
      artifactIds: ["artifact-1"],
      observedAtMs: 456,
    });

    expect(envelope).toMatchObject({
      schemaVersion: "conversation-runtime.evidence-provenance.v1",
      source: {
        kind: "web_extract",
        sourceRef: "https://example.test/post",
        sourceSnapshotId: "snapshot-post",
        textRead: true,
        readableCharacterCount: 8000,
        secondPassExtracted: false,
      },
      media: {
        assetCount: 2,
        listedOnlyCount: 2,
        analyzedCount: 0,
        semanticUnderstanding: false,
        canUseMediaAsConclusion: false,
        disclosure:
          "文本已读；媒体仅完成清单记录，尚未理解图片、视频或音频内容，因此不能把媒体内容当成结论。",
      },
      knowledge: {
        targetCount: 1,
        executableTargetCount: 1,
        admittedTargetCount: 1,
        mediaContentAdmitted: false,
      },
      admission: {
        canAdmitTextEvidence: true,
        canAdmitMediaContent: false,
        canAdmitKnowledgeTransfer: true,
        overall: "text_and_knowledge",
        requiredDisclosure:
          "文本已读；媒体未理解，不能把媒体内容当成结论；知识同步只包含已授权/已准入的文本证据。",
      },
      evidenceRefIds: ["source-evidence-1", "media-evidence-post-1", "media-evidence-post-2"],
      artifactIds: ["artifact-1"],
      observedAtMs: 456,
    });
  });
});
