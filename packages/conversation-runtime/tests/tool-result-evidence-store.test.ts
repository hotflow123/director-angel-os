import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createFileConversationRuntimeToolEvidenceStore,
  createToolResultEvidenceRecord,
} from "../src/index.js";

describe("conversation runtime tool result evidence store", () => {
  it("persists tool evidence and content for cross-process readback", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "conversation-tool-evidence-"));
    const store = createFileConversationRuntimeToolEvidenceStore({
      rootPath,
      nowMs: () => 100,
    });
    const content = "Full tool result body\n".repeat(20);
    const evidence = createToolResultEvidenceRecord({
      turnId: "turn-1",
      turnRunId: "run-1",
      sessionKey: "desktop:workbench",
      toolCallId: "call-web",
      toolName: "web_extract",
      ok: true,
      content,
      metadata: {
        sourceUrl: "https://example.test/page",
        sourceSnapshotId: "snapshot-web-1",
      },
      observedAtMs: 99,
      previewMaxChars: 40,
    });

    const firstWrite = store.upsertToolResultEvidence({ evidence, content });
    const replayWrite = store.upsertToolResultEvidence({ evidence, content });
    const reloaded = createFileConversationRuntimeToolEvidenceStore({ rootPath });
    const listed = reloaded.listToolResultEvidence({ turnRunId: "run-1" });
    const detail = reloaded.readToolResultEvidence(evidence.id);
    const limitedContent = reloaded.readToolResultEvidenceContent(evidence.id, { maxChars: 24 });

    expect(firstWrite.status).toBe("ok");
    expect(replayWrite.status).toBe("ok");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      evidenceId: evidence.id,
      turnRunId: "run-1",
      turnId: "turn-1",
      sessionKey: "desktop:workbench",
      toolName: "web_extract",
      contentSizeBytes: Buffer.byteLength(content, "utf8"),
    });
    expect(detail?.evidence).toMatchObject({
      id: evidence.id,
      sourceKind: "tool-result",
      publishable: false,
      metadata: expect.objectContaining({
        toolName: "web_extract",
        preview: expect.stringContaining("[truncated"),
        contentRef: expect.objectContaining({
          kind: "tool-ledger",
          evidenceId: evidence.id,
          relativePath: listed[0]?.contentRef.relativePath,
          mimeType: "text/plain; charset=utf-8",
          sizeBytes: Buffer.byteLength(content, "utf8"),
        }),
      }),
    });
    expect(limitedContent).toMatchObject({
      evidenceId: evidence.id,
      content: content.slice(0, 24),
      truncated: true,
      contentSizeBytes: Buffer.byteLength(content, "utf8"),
    });
    expect(await readFile(join(rootPath, listed[0]?.contentRef.relativePath ?? ""), "utf8")).toBe(
      content,
    );
  });

  it("keeps evidence content paths rooted and filters by scope", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "conversation-tool-evidence-safe-"));
    const store = createFileConversationRuntimeToolEvidenceStore({
      rootPath,
      nowMs: () => 200,
    });
    const unsafeEvidence = createToolResultEvidenceRecord({
      id: "../escape/tool-evidence",
      turnId: "turn-safe",
      turnRunId: "run-safe",
      sessionKey: "weixin:peer",
      toolCallId: "call-safe",
      toolName: "browser_snapshot",
      ok: false,
      content: "blocked",
      error: "permission_denied",
      metadata: {
        status: "permission_denied",
      },
    });
    const otherEvidence = createToolResultEvidenceRecord({
      turnId: "turn-other",
      turnRunId: "run-other",
      sessionKey: "weixin:peer",
      toolCallId: "call-other",
      toolName: "browser_snapshot",
      ok: true,
      content: "other",
    });

    store.upsertToolResultEvidence({ evidence: unsafeEvidence, content: "blocked" });
    store.upsertToolResultEvidence({ evidence: otherEvidence, content: "other" });

    const listed = store.listToolResultEvidence({
      sessionKey: "weixin:peer",
      turnRunId: "run-safe",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.evidenceId).toBe("../escape/tool-evidence");
    expect(listed[0]?.contentRef.relativePath).not.toContain("..");
    expect(listed[0]?.contentRef.relativePath).toMatch(/^contents\//u);
    expect(store.readToolResultEvidenceContent("../escape/tool-evidence")?.content).toBe("blocked");
  });

  it("applies redaction and prunes expired evidence through a retention policy", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "conversation-tool-evidence-retention-"));
    const store = createFileConversationRuntimeToolEvidenceStore({
      rootPath,
      retentionPolicy: {
        redactContent: ({ content }) => ({
          content: content.replaceAll("secret-token", "[redacted]"),
          notes: ["redacted fixture token"],
        }),
      },
    });
    const oldEvidence = createToolResultEvidenceRecord({
      id: "tool-evidence-old",
      turnId: "turn-retention",
      sessionKey: "desktop:workbench",
      toolCallId: "call-old",
      toolName: "web_extract",
      ok: true,
      content: "old secret-token content",
      observedAtMs: 100,
    });
    const freshEvidence = createToolResultEvidenceRecord({
      id: "tool-evidence-fresh",
      turnId: "turn-retention",
      sessionKey: "desktop:workbench",
      toolCallId: "call-fresh",
      toolName: "web_extract",
      ok: true,
      content: "fresh secret-token content",
      observedAtMs: 190,
    });

    store.upsertToolResultEvidence({ evidence: oldEvidence, content: "old secret-token content" });
    store.upsertToolResultEvidence({
      evidence: freshEvidence,
      content: "fresh secret-token content",
    });

    expect(store.readToolResultEvidenceContent("tool-evidence-fresh")?.content).toBe(
      "fresh [redacted] content",
    );

    const pruned = store.pruneExpiredToolResultEvidence({ nowMs: 200, maxAgeMs: 50 });

    expect(pruned).toMatchObject({
      deletedEvidenceIds: ["tool-evidence-old"],
      retainedEvidenceIds: ["tool-evidence-fresh"],
    });
    expect(store.listToolResultEvidence({ turnId: "turn-retention" })).toEqual([
      expect.objectContaining({ evidenceId: "tool-evidence-fresh" }),
    ]);
    expect(store.readToolResultEvidence("tool-evidence-old")).toBeUndefined();
    expect(store.readToolResultEvidenceContent("tool-evidence-old")).toBeUndefined();
  });
});
