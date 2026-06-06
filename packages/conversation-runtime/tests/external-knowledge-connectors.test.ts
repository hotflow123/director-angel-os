import { describe, expect, it } from "vitest";

import { PolicyRuntime, decision } from "@hotflow/policy-runtime";

import {
  createExternalKnowledgeTransferPlan,
  createExternalKnowledgeUploadPackagePlan,
  createGovernedExternalKnowledgeTransferPlan,
  resolveExternalKnowledgeConnectorStrategy,
} from "../src/index.js";

describe("external knowledge connectors", () => {
  it("resolves stable targets without platform-specific hardcoding in the caller", () => {
    expect(resolveExternalKnowledgeConnectorStrategy("internal_knowledge")).toMatchObject({
      connectorId: "internal_knowledge",
      targetKind: "internal_knowledge",
      stableApi: true,
    });
    expect(resolveExternalKnowledgeConnectorStrategy("notebooklm")).toMatchObject({
      connectorId: "notebooklm",
      targetKind: "export_package",
      stableApi: false,
      uploadPackageRequired: true,
    });
    expect(resolveExternalKnowledgeConnectorStrategy("notion")).toMatchObject({
      connectorId: "notion",
      targetKind: "external_api",
      stableApi: true,
      requiresAuth: true,
    });
    expect(resolveExternalKnowledgeConnectorStrategy("obsidian")).toMatchObject({
      connectorId: "obsidian",
      targetKind: "export_package",
      stableApi: false,
    });
    expect(resolveExternalKnowledgeConnectorStrategy("notebooklm")).toMatchObject({
      manifest: expect.objectContaining({
        contracts: expect.objectContaining({
          tools: ["external_knowledge.generate_upload_package"],
        }),
        toolMetadata: expect.objectContaining({
          "external_knowledge.generate_upload_package": expect.objectContaining({
            approvalBoundary: "package_only",
          }),
        }),
      }),
    });
  });

  it("builds a connector transfer plan with internal, export package, and external API targets", () => {
    const plan = createExternalKnowledgeTransferPlan({
      connectors: ["internal_knowledge", "notebooklm", "ima", "notion", "obsidian"],
      mode: "sync_clean_text",
      source: {
        title: "媒体学习复盘",
        sourceRef: "https://example.test/post",
        artifactIds: ["web-extract-full-body-example"],
      },
    });

    expect(plan).toMatchObject({
      schemaVersion: "conversation-runtime.external-knowledge-transfer-plan.v1",
      mode: "sync_clean_text",
      source: {
        title: "媒体学习复盘",
        sourceRef: "https://example.test/post",
        artifactIds: ["web-extract-full-body-example"],
      },
      targets: expect.arrayContaining([
        expect.objectContaining({
          connectorId: "internal_knowledge",
          targetKind: "internal_knowledge",
        }),
        expect.objectContaining({ connectorId: "notebooklm", targetKind: "export_package" }),
        expect.objectContaining({ connectorId: "ima", targetKind: "export_package" }),
        expect.objectContaining({ connectorId: "notion", targetKind: "external_api" }),
        expect.objectContaining({ connectorId: "obsidian", targetKind: "export_package" }),
      ]),
    });
    expect(
      plan.targets.find((target) => target.connectorId === "notebooklm")?.operations,
    ).toContain("generate_upload_package");
    expect(plan.targets.find((target) => target.connectorId === "notion")?.operations).toContain(
      "call_external_api",
    );
    expect(plan.summary).toContain("internal=1");
    expect(plan.summary).toContain("export_package=3");
    expect(plan.summary).toContain("external_api=1");
  });

  it("creates upload package plans for connectors without a stable API instead of claiming sync", () => {
    const plan = createExternalKnowledgeTransferPlan({
      connectors: ["notebooklm", "ima", "obsidian", "notion", "feishu"],
      mode: "sync_original_files",
      source: {
        title: "六宫格故事板复盘",
        sourceRef: "https://example.test/post",
        artifactIds: ["web-extract-full-body-example"],
        evidenceRefIds: ["media-evidence-1"],
        textCharacterCount: 12_345,
        mediaUnderstandingStatus: "not_understood",
      },
    });

    for (const connectorId of ["notebooklm", "ima", "obsidian"] as const) {
      const target = plan.targets.find((candidate) => candidate.connectorId === connectorId);
      expect(target).toMatchObject({
        connectorId,
        targetKind: "export_package",
        stableApi: false,
        operations: ["generate_upload_package"],
        uploadPackagePlan: expect.objectContaining({
          syncStatus: "not_synced_pending_user_upload",
          files: expect.arrayContaining([
            expect.objectContaining({ path: "manifest.json" }),
            expect.objectContaining({ path: "index.md" }),
            expect.objectContaining({ path: "evidence/source.md" }),
            expect.objectContaining({ path: "evidence/media.md" }),
          ]),
          operationChecklist: expect.arrayContaining([expect.stringContaining("手动上传")]),
        }),
      });
      expect(target?.operations).not.toContain("call_external_api");
    }

    expect(plan.targets.find((target) => target.connectorId === "notion")).toMatchObject({
      stableApi: true,
      requiresAuth: true,
      operations: ["call_external_api"],
      mode: "sync_summary",
    });
    expect(plan.targets.find((target) => target.connectorId === "notion")).not.toHaveProperty(
      "uploadPackagePlan",
    );
    expect(plan.targets.find((target) => target.connectorId === "feishu")).toMatchObject({
      stableApi: true,
      requiresAuth: true,
      operations: ["call_external_api"],
      mode: "sync_summary",
    });
    expect(plan.targets.find((target) => target.connectorId === "feishu")).not.toHaveProperty(
      "uploadPackagePlan",
    );
  });

  it("builds a deterministic export package manifest from evidence refs and media status", () => {
    const uploadPackage = createExternalKnowledgeUploadPackagePlan({
      connectorId: "notebooklm",
      mode: "sync_clean_text",
      source: {
        title: "媒体学习复盘",
        sourceRef: "https://example.test/post",
        artifactIds: ["artifact-1"],
        evidenceRefIds: ["evidence-1", "evidence-2"],
        textCharacterCount: 8_000,
        mediaUnderstandingStatus: "not_understood",
      },
      operationChecklist: ["上传 index.md 和 evidence 目录。"],
    });

    expect(uploadPackage).toMatchObject({
      schemaVersion: "conversation-runtime.external-knowledge-upload-package.v1",
      connectorId: "notebooklm",
      packageId: "notebooklm-example-test-post",
      syncStatus: "not_synced_pending_user_upload",
      manifest: {
        sourceRef: "https://example.test/post",
        artifactIds: ["artifact-1"],
        evidenceRefIds: ["evidence-1", "evidence-2"],
        textCharacterCount: 8_000,
        mediaUnderstandingStatus: "not_understood",
        mediaContentAdmitted: false,
      },
    });
  });

  it("attaches policy envelopes to external knowledge transfer targets before write or sync", async () => {
    const plan = await createGovernedExternalKnowledgeTransferPlan({
      connectors: ["notebooklm", "notion", "internal_knowledge"],
      mode: "sync_clean_text",
      source: {
        title: "媒体学习复盘",
        sourceRef: "https://example.test/post",
        artifactIds: ["artifact-1"],
        evidenceRefIds: ["source-evidence-1"],
        textCharacterCount: 8_000,
        mediaUnderstandingStatus: "not_understood",
      },
      policyRuntime: new PolicyRuntime({
        rules: [
          {
            id: "allow-export-package",
            matches: (input) => input.action === "external_knowledge.generate_upload_package",
            evaluate: () => decision.allow("Local export package generation is safe"),
          },
          {
            id: "allow-internal-write",
            matches: (input) => input.action === "external_knowledge.write_internal",
            evaluate: () => decision.allow("Internal knowledge write is allowed"),
          },
        ],
        executionPolicy: {
          approvalRequiredAtOrAbove: "high",
          denyByDefault: false,
        },
      }),
      approvalByConnectorId: {
        notion: {
          status: "pending",
        },
      },
      nowMs: () => 1_234,
    });

    const notebooklm = plan.targets.find((target) => target.connectorId === "notebooklm");
    const notion = plan.targets.find((target) => target.connectorId === "notion");
    const internal = plan.targets.find((target) => target.connectorId === "internal_knowledge");

    expect(notebooklm).toMatchObject({
      connectorId: "notebooklm",
      policyEnvelope: expect.objectContaining({
        action: "external_knowledge.generate_upload_package",
        resourceRef: "https://example.test/post",
        decision: expect.objectContaining({
          verdict: "allow",
        }),
        evidence: expect.objectContaining({
          evidenceRefIds: ["source-evidence-1"],
          admission: expect.objectContaining({
            canAdmitResult: true,
          }),
        }),
        audit: expect.objectContaining({
          decidedAtMs: 1_234,
        }),
      }),
      transferAdmission: {
        canExecute: true,
        reason: "policy_decision_allows_transfer",
      },
    });
    expect(notion).toMatchObject({
      connectorId: "notion",
      policyEnvelope: expect.objectContaining({
        action: "external_knowledge.call_external_api",
        decision: expect.objectContaining({
          verdict: "ask",
        }),
        risk: expect.objectContaining({
          level: "high",
          capabilities: ["external_knowledge.external_api", "network.write"],
        }),
      }),
      transferAdmission: {
        canExecute: false,
        reason: "policy_decision_must_be_allow_before_transfer",
      },
    });
    expect(internal).toMatchObject({
      connectorId: "internal_knowledge",
      policyEnvelope: expect.objectContaining({
        action: "external_knowledge.write_internal",
        decision: expect.objectContaining({
          verdict: "allow",
        }),
      }),
      transferAdmission: {
        canExecute: true,
      },
    });
  });
});
