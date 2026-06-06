import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createFileConversationRuntimeAutomationPolicyStore,
  evaluateConversationRuntimeAutomationPolicy,
} from "../src/automation-policy.js";

describe("conversation runtime automation policy", () => {
  it("keeps cautious mode manual unless the user enables an automation policy", () => {
    const decision = evaluateConversationRuntimeAutomationPolicy({
      nowMs: 1_000,
      action: {
        kind: "experience.promote",
        riskLevel: "low",
        role: "director",
        sourceUrl: "https://example.com/a",
      },
      policies: [],
    });

    expect(decision).toMatchObject({
      status: "requires_approval",
      reason: "automation-policy-not-configured",
    });
  });

  it("allows low-risk experience promotion only when an assisted policy matches scope", () => {
    const decision = evaluateConversationRuntimeAutomationPolicy({
      nowMs: 2_000,
      action: {
        kind: "experience.promote",
        riskLevel: "low",
        role: "director",
        sourceUrl: "https://learn.example.com/post/1",
        candidateTags: ["prompting", "aigc"],
      },
      policies: [
        {
          schemaVersion: "conversation-runtime.automation-policy.v1",
          policyId: "policy-assisted-learning",
          mode: "assisted",
          enabled: true,
          riskLevelAllowed: "low",
          requiresAudit: true,
          scope: {
            roles: ["director"],
            sourceDomains: ["example.com"],
            candidateTags: ["prompting"],
          },
        },
      ],
    });

    expect(decision).toMatchObject({
      status: "allowed",
      policyId: "policy-assisted-learning",
      requiresAudit: true,
      reason: "automation-policy-matched",
    });
  });

  it("requires approval when a matching policy would exceed media budget", () => {
    const decision = evaluateConversationRuntimeAutomationPolicy({
      nowMs: 3_000,
      action: {
        kind: "media.understand",
        riskLevel: "medium",
        role: "director",
        sourceUrl: "https://example.com/story",
        mediaType: "image",
        estimatedTokens: 21_000,
      },
      policies: [
        {
          schemaVersion: "conversation-runtime.automation-policy.v1",
          policyId: "policy-media-budget",
          mode: "autopilot",
          enabled: true,
          riskLevelAllowed: "medium",
          requiresAudit: true,
          scope: {
            roles: ["director"],
            sourceDomains: ["example.com"],
            mediaTypes: ["image"],
          },
          budget: {
            maxTokens: 12_000,
          },
        },
      ],
    });

    expect(decision).toMatchObject({
      status: "requires_approval",
      reason: "automation-policy-budget-exceeded",
      policyId: "policy-media-budget",
    });
  });

  it("persists policies with revoke support for cross-client reuse", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-automation-policy-"));
    try {
      const store = createFileConversationRuntimeAutomationPolicyStore({
        rootPath: root,
        nowMs: () => 4_000,
      });

      store.upsertPolicy({
        policy: {
          schemaVersion: "conversation-runtime.automation-policy.v1",
          policyId: "policy-cross-client",
          mode: "assisted",
          enabled: true,
          riskLevelAllowed: "low",
          requiresAudit: true,
          scope: { roles: ["director"] },
        },
      });
      store.revokePolicy("policy-cross-client");

      expect(store.listPolicies()).toEqual([
        expect.objectContaining({
          policyId: "policy-cross-client",
          enabled: false,
          revokedAtMs: 4_000,
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
