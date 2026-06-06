import { describe, expect, it } from "vitest";

import { PolicyRuntime, decision } from "@hotflow/policy-runtime";

import {
  createConversationRuntimePolicyEnvelope,
  createConversationRuntimePolicyEnvelopeRef,
  createExternalKnowledgeTransferPolicyEnvelope,
  createMediaUnderstandingPolicyEnvelope,
} from "../src/index.js";

describe("conversation runtime policy envelope", () => {
  it("normalizes media understanding execution into one auditable policy decision envelope", async () => {
    const envelope = await createMediaUnderstandingPolicyEnvelope({
      actionId: "media.understand_image",
      resourceRef: "https://cdn.example.test/frame.png",
      actor: "desktop-user",
      mode: "low_cost",
      toolName: "media-understanding.local",
      riskLevel: "high",
      budget: {
        tokenLimit: 8_000,
        fileCountLimit: 1,
        videoMinuteLimit: 0,
        estimatedCostTier: "medium",
      },
      evidenceRefIds: ["media-evidence-1"],
      approval: {
        status: "pending",
      },
      policyRuntime: new PolicyRuntime({
        executionPolicy: {
          approvalRequiredAtOrAbove: "high",
          denyByDefault: false,
        },
      }),
      nowMs: () => 123,
    });

    expect(envelope).toMatchObject({
      schemaVersion: "conversation-runtime.policy-decision-envelope.v1",
      action: "media.understand_image",
      resourceRef: "https://cdn.example.test/frame.png",
      actor: "desktop-user",
      risk: {
        level: "high",
        capabilities: ["media.understanding", "media.semantic-extraction"],
      },
      budget: {
        tokenLimit: 8_000,
        fileCountLimit: 1,
        videoMinuteLimit: 0,
        estimatedCostTier: "medium",
      },
      evidence: {
        evidenceRefIds: ["media-evidence-1"],
        admission: {
          canAdmitResult: false,
          reason: "policy_decision_must_be_allow_before_admission",
        },
      },
      decision: {
        verdict: "ask",
        reason: "Tool execution requires approval",
      },
      audit: {
        decidedAtMs: 123,
        policyInput: expect.objectContaining({
          action: "media.understand_image",
          resource: "https://cdn.example.test/frame.png",
        }),
      },
    });
    expect(envelope.decision.metadata?.policyRuntime).toMatchObject({
      eligibility: {
        canDispatch: false,
        requiresApproval: true,
        terminal: true,
      },
    });
  });

  it("uses the same envelope for external knowledge export packages and external API sync", async () => {
    const runtime = new PolicyRuntime({
      rules: [
        {
          id: "allow-package-generation",
          matches: (input) => input.action === "external_knowledge.generate_upload_package",
          evaluate: () => decision.allow("Local export package generation is safe"),
        },
      ],
      executionPolicy: {
        approvalRequiredAtOrAbove: "high",
        denyByDefault: false,
      },
    });

    const packageEnvelope = await createExternalKnowledgeTransferPolicyEnvelope({
      connectorId: "notebooklm",
      targetKind: "export_package",
      operation: "external_knowledge.generate_upload_package",
      resourceRef: "https://example.test/source",
      mode: "sync_clean_text",
      evidenceRefIds: ["source-evidence-1"],
      policyRuntime: runtime,
      nowMs: () => 456,
    });
    const apiEnvelope = await createExternalKnowledgeTransferPolicyEnvelope({
      connectorId: "notion",
      targetKind: "external_api",
      operation: "external_knowledge.call_external_api",
      resourceRef: "https://example.test/source",
      mode: "sync_clean_text",
      evidenceRefIds: ["source-evidence-1"],
      approval: {
        status: "pending",
      },
      policyRuntime: runtime,
      nowMs: () => 789,
    });

    expect(packageEnvelope).toMatchObject({
      action: "external_knowledge.generate_upload_package",
      resourceRef: "https://example.test/source",
      risk: {
        level: "low",
        capabilities: ["external_knowledge.export_package"],
      },
      decision: {
        verdict: "allow",
        reason: "Local export package generation is safe",
      },
      evidence: {
        evidenceRefIds: ["source-evidence-1"],
        admission: {
          canAdmitResult: true,
        },
      },
      audit: {
        decidedAtMs: 456,
      },
    });
    expect(apiEnvelope).toMatchObject({
      action: "external_knowledge.call_external_api",
      risk: {
        level: "high",
        capabilities: ["external_knowledge.external_api", "network.write"],
      },
      decision: {
        verdict: "ask",
      },
      evidence: {
        admission: {
          canAdmitResult: false,
        },
      },
      audit: {
        decidedAtMs: 789,
      },
    });
  });

  it("fails closed without a policy runtime", async () => {
    const envelope = await createConversationRuntimePolicyEnvelope({
      action: "tool.dispatch",
      resourceRef: "tool://unknown",
      risk: {
        level: "medium",
        capabilities: ["external.execute"],
      },
      evidenceRefIds: [],
    });

    expect(envelope.decision).toMatchObject({
      verdict: "deny",
      reason: "policy_runtime_not_configured",
    });
    expect(envelope.evidence.admission).toMatchObject({
      canAdmitResult: false,
      reason: "policy_decision_must_be_allow_before_admission",
    });
  });

  it("creates stable policy envelope refs for run, tool, and evidence persistence", async () => {
    const envelope = await createConversationRuntimePolicyEnvelope({
      action: "external_tool.dispatch",
      resourceRef: "external-tool://media_analyzer/media.inspect",
      actor: "desktop:main",
      risk: {
        level: "high",
        capabilities: ["media.semantic-extraction", "external_tool.read"],
      },
      budget: {
        tokenLimit: 4_000,
        fileCountLimit: 1,
        estimatedCostTier: "low",
      },
      evidenceRefIds: ["media-evidence-1"],
      sourceRefs: ["https://cdn.example.test/frame.png"],
      approval: {
        status: "approved",
        approver: "operator-1",
      },
      policyRuntime: new PolicyRuntime({
        executionPolicy: {
          approvalRequiredAtOrAbove: "high",
          denyByDefault: false,
        },
      }),
      nowMs: () => 1_234,
    });

    const ref = createConversationRuntimePolicyEnvelopeRef(envelope, {
      scope: "tool",
      ownerId: "exec-1",
    });

    expect(ref).toMatchObject({
      schemaVersion: "conversation-runtime.policy-envelope-ref.v1",
      id: "policy-ref-tool-exec-1-external-tool-dispatch-external-tool-media-analyzer-media-inspect",
      scope: "tool",
      ownerId: "exec-1",
      action: "external_tool.dispatch",
      resourceRef: "external-tool://media_analyzer/media.inspect",
      verdict: "allow",
      reason: "No matching policy rule, allow by execution policy",
      decidedAtMs: 1_234,
      evidenceRefIds: ["media-evidence-1"],
      sourceRefs: ["https://cdn.example.test/frame.png"],
      admission: {
        canAdmitResult: true,
      },
    });
  });
});
