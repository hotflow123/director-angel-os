import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createFileConversationRuntimeApprovalLedger } from "../src/approval-ledger.js";

describe("conversation runtime approval ledger", () => {
  it("resolves an approval only when the current binding matches", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-approval-ledger-"));
    try {
      const ledger = createFileConversationRuntimeApprovalLedger({
        rootPath: root,
        nowMs: () => 10_000,
      });
      ledger.upsertApproval({
        approval: {
          schemaVersion: "conversation-runtime.approval-ledger-record.v1",
          approvalId: "approval-1",
          status: "pending",
          turnId: "turn-1",
          sessionKey: "desktop:workbench",
          toolCallId: "tool-call-1",
          argsHash: "args-a",
          requestedByChannel: "desktop",
          requestedAtMs: 1_000,
          expiresAtMs: 31_000,
        },
      });

      const mismatch = ledger.resolveApproval({
        approvalId: "approval-1",
        decision: "approved",
        resolvedByChannel: "weixin",
        binding: {
          turnId: "turn-2",
          sessionKey: "desktop:workbench",
          toolCallId: "tool-call-1",
          argsHash: "args-a",
        },
      });
      const matched = ledger.resolveApproval({
        approvalId: "approval-1",
        decision: "approved",
        resolvedByChannel: "weixin",
        binding: {
          turnId: "turn-1",
          sessionKey: "desktop:workbench",
          toolCallId: "tool-call-1",
          argsHash: "args-a",
        },
      });

      expect(mismatch).toMatchObject({
        ok: false,
        reason: "approval-binding-mismatch",
      });
      expect(matched).toMatchObject({
        ok: true,
        approval: {
          approvalId: "approval-1",
          status: "approved",
          resolvedByChannel: "weixin",
          resolvedAtMs: 10_000,
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records automation policy decisions in the same ledger", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-approval-ledger-"));
    try {
      const ledger = createFileConversationRuntimeApprovalLedger({
        rootPath: root,
        nowMs: () => 12_000,
      });

      ledger.upsertApproval({
        approval: {
          schemaVersion: "conversation-runtime.approval-ledger-record.v1",
          approvalId: "approval-auto-1",
          status: "approved",
          turnId: "turn-auto",
          sessionKey: "desktop:workbench",
          toolCallId: "tool-call-auto",
          argsHash: "args-auto",
          requestedByChannel: "runtime",
          requestedAtMs: 12_000,
          expiresAtMs: 42_000,
          resolvedByChannel: "automation-policy",
          resolvedAtMs: 12_000,
          automationPolicyId: "policy-assisted-learning",
          autoResolvedReason: "automation-policy-matched",
        },
      });

      expect(ledger.listApprovals()).toEqual([
        expect.objectContaining({
          approvalId: "approval-auto-1",
          status: "approved",
          automationPolicyId: "policy-assisted-learning",
          autoResolvedReason: "automation-policy-matched",
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("expires stale pending approvals without mutating terminal records", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-approval-ledger-"));
    try {
      const ledger = createFileConversationRuntimeApprovalLedger({
        rootPath: root,
        nowMs: () => 50_000,
      });
      ledger.upsertApproval({
        approval: {
          schemaVersion: "conversation-runtime.approval-ledger-record.v1",
          approvalId: "approval-stale",
          status: "pending",
          turnId: "turn-stale",
          sessionKey: "desktop:workbench",
          toolCallId: "tool-call-stale",
          argsHash: "args-stale",
          requestedByChannel: "desktop",
          requestedAtMs: 1_000,
          expiresAtMs: 10_000,
        },
      });

      const result = ledger.expirePendingApprovals();

      expect(result.expiredApprovalIds).toEqual(["approval-stale"]);
      expect(ledger.listApprovals()).toEqual([
        expect.objectContaining({
          approvalId: "approval-stale",
          status: "expired",
          resolvedAtMs: 50_000,
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("revokes pending approvals while preserving resolved records", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-approval-ledger-"));
    try {
      const ledger = createFileConversationRuntimeApprovalLedger({
        rootPath: root,
        nowMs: () => 60_000,
      });
      ledger.upsertApproval({
        approval: {
          schemaVersion: "conversation-runtime.approval-ledger-record.v1",
          approvalId: "approval-pending",
          status: "pending",
          turnId: "turn-revoke",
          sessionKey: "desktop:workbench",
          toolCallId: "tool-call-revoke",
          argsHash: "args-revoke",
          requestedByChannel: "desktop",
          requestedAtMs: 1_000,
          expiresAtMs: 90_000,
        },
      });
      ledger.upsertApproval({
        approval: {
          schemaVersion: "conversation-runtime.approval-ledger-record.v1",
          approvalId: "approval-approved",
          status: "approved",
          turnId: "turn-approved",
          sessionKey: "desktop:workbench",
          toolCallId: "tool-call-approved",
          argsHash: "args-approved",
          requestedByChannel: "desktop",
          requestedAtMs: 1_000,
          expiresAtMs: 90_000,
          resolvedByChannel: "desktop",
          resolvedAtMs: 2_000,
        },
      });

      const revoked = ledger.revokeApproval({
        approvalId: "approval-pending",
        revokedByChannel: "desktop",
        reason: "operator-cancelled",
      });
      const alreadyResolved = ledger.revokeApproval({
        approvalId: "approval-approved",
        revokedByChannel: "desktop",
        reason: "operator-cancelled",
      });

      expect(revoked).toMatchObject({
        ok: true,
        approval: {
          approvalId: "approval-pending",
          status: "revoked",
          resolvedByChannel: "desktop",
          resolvedAtMs: 60_000,
          failureReason: "operator-cancelled",
        },
      });
      expect(alreadyResolved).toMatchObject({
        ok: false,
        reason: "approval-not-pending",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
