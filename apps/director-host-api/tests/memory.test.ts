import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExperienceQualityAssessment,
  createExperienceSourceArtifact,
} from "@hotflow/contracts";
import {
  createFileConversationRuntimeToolEvidenceStore,
  createToolResultEvidenceRecord,
} from "@hotflow/conversation-runtime";
import { FileExperienceStore, FileKnowledgeStore } from "@hotflow/director-knowledge";
import { FileSystemDirectorMemoryStore } from "@hotflow/director-memory";
import { buildDirectorTraceDigest } from "@hotflow/director-memory-contracts";
import { SkillSnapshotFileStore, resolveApprovedSkillSnapshotPath } from "@hotflow/skills";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@hotflow/director-service", async () => {
  const actual = await import("@hotflow/director-service");
  return {
    DirectorService: actual.DirectorService,
  };
});

import { createDirectorHostApiApp } from "../src/server.ts";

describe("director-host-api memory wiring", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
    }
  });

  it("keeps filesystem recall disabled by default even when memory records exist", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-"));
    tempRoots.push(workspaceRoot);
    await writeMemoryRecordFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const payload = await postEvaluateMemorySnapshot(`http://${host}:${port}`);

      expect(payload.summary).not.toContain("Recall matched 1 prior run");
      expect(payload.recommendations).not.toEqual(
        expect.arrayContaining([expect.stringContaining("run-memory-1")]),
      );
    } finally {
      await app.close();
    }
  });

  it("injects filesystem recall only after memory.enabled is turned on without restarting", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-"));
    tempRoots.push(workspaceRoot);
    await writeMemoryRecordFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const disabledPayload = await postEvaluateMemorySnapshot(`http://${host}:${port}`);
      expect(disabledPayload.summary).not.toContain("Recall matched 1 prior run");

      writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
        "memory.enabled": true,
      });
      const enabledPayload = await postEvaluateMemorySnapshot(`http://${host}:${port}`);

      expect(enabledPayload.summary).toContain("Recall matched 1 prior run");
      expect(enabledPayload.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("run-memory-1")]),
      );
    } finally {
      await app.close();
    }
  });

  it("injects compact long-term memory only after memory.enabled is turned on", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-long-memory-"));
    tempRoots.push(workspaceRoot);
    writeLongTermMemoryFilesFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const disabledPayload = await postEvaluateMemorySnapshot(`http://${host}:${port}`);
      expect(disabledPayload.recommendations.join("\n")).not.toContain("long-term-memory");

      writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
        "memory.enabled": true,
      });
      const enabledPayload = await postEvaluateMemorySnapshot(`http://${host}:${port}`);

      expect(enabledPayload.recommendations.join("\n")).toContain("long-term-memory:memory");
      expect(enabledPayload.recommendations.join("\n")).toContain("long-term-memory:user");
    } finally {
      await app.close();
    }
  });

  it("admits explicit user preferences into USER.md but drops casual chatter", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-admit-user-"));
    tempRoots.push(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const casualResponse = await fetch(`http://${host}:${port}/v1/memory/long-term/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "哈哈，我今天学习制作咖啡，挺开心",
          nowMs: 1_776_000_070_000,
        }),
      });
      expect(casualResponse.ok).toBe(true);
      const casualPayload = (await casualResponse.json()) as {
        admitted: boolean;
        decision: { category: string; retention: string; reason: string };
      };
      expect(casualPayload).toMatchObject({
        admitted: false,
        decision: {
          category: "chitchat",
          retention: "none",
          reason: "casual-self-report",
        },
      });

      const preferenceResponse = await fetch(`http://${host}:${port}/v1/memory/long-term/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "记住：我默认喜欢中文回复，脚本要短一点",
          nowMs: 1_776_000_071_000,
        }),
      });
      expect(preferenceResponse.ok).toBe(true);
      const preferencePayload = (await preferenceResponse.json()) as {
        admitted: boolean;
        targetFile: string;
        decision: { category: string; retention: string };
      };
      expect(preferencePayload).toMatchObject({
        admitted: true,
        targetFile: "USER.md",
        decision: {
          category: "user-preference",
          retention: "user",
        },
      });

      const userMemory = readFileSync(
        join(workspaceRoot, ".director-angel", "memory", "USER.md"),
        "utf8",
      );
      expect(userMemory).toContain("# USER");
      expect(userMemory).toContain("偏好：我默认喜欢中文回复，脚本要短一点");
      expect(userMemory).toContain("§");
      expect(existsSync(join(workspaceRoot, ".director-angel", "memory", "MEMORY.md"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("quarantines unsafe long-term memory admission without leaking secrets", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-admit-secret-"));
    tempRoots.push(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const secret = "sk-test-1234567890abcdef1234567890abcdef";
      const response = await fetch(`http://${host}:${port}/v1/memory/long-term/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `记住我的 API key 是 ${secret}`,
          nowMs: 1_776_000_072_000,
        }),
      });
      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        admitted: boolean;
        quarantined: boolean;
        redactedContent: string;
        decision: {
          retention: string;
          safety: { safe: boolean; findings: Array<{ type: string }> };
        };
      };
      expect(payload).toMatchObject({
        admitted: false,
        quarantined: true,
        decision: {
          retention: "quarantine",
          safety: {
            safe: false,
            findings: expect.arrayContaining([expect.objectContaining({ type: "api-key" })]),
          },
        },
      });
      expect(payload.redactedContent).not.toContain(secret);
      expect(JSON.stringify(payload)).not.toContain(secret);
      expect(existsSync(join(workspaceRoot, ".director-angel", "memory", "USER.md"))).toBe(false);
      expect(existsSync(join(workspaceRoot, ".director-angel", "memory", "MEMORY.md"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("admits explicit project rules into MEMORY.md with a compact character budget", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-admit-project-"));
    tempRoots.push(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      for (let index = 0; index < 18; index += 1) {
        const response = await fetch(`http://${host}:${port}/v1/memory/long-term/admit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: `记住：这个项目的固定制作规则 ${index} 是所有短剧分镜都要保留主角身份、场景连续性、镜头风格和审核边界，避免每次从零开始。`,
            target: "memory",
            nowMs: 1_776_000_073_000 + index,
          }),
        });
        expect(response.ok).toBe(true);
      }

      const projectMemory = readFileSync(
        join(workspaceRoot, ".director-angel", "memory", "MEMORY.md"),
        "utf8",
      );
      expect(projectMemory).toContain("# MEMORY");
      expect(projectMemory).toContain("项目记忆：这个项目的固定制作规则 17");
      expect(projectMemory).toContain("§");
      expect(projectMemory.length).toBeLessThanOrEqual(2200);
    } finally {
      await app.close();
    }
  });

  it("exposes compact long-term memory status without leaking full memory files", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-status-"));
    tempRoots.push(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      await fetch(`http://${host}:${port}/v1/memory/long-term/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "记住：我默认喜欢中文回复，脚本要短一点",
          nowMs: 1_776_000_074_000,
        }),
      });
      await fetch(`http://${host}:${port}/v1/memory/long-term/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "记住：固定制作规则是开场要保留连续性锚点 anchor-a，并避免跑题。",
          target: "memory",
          nowMs: 1_776_000_074_001,
        }),
      });

      const disabledResponse = await fetch(`http://${host}:${port}/v1/memory/long-term/status`);
      expect(disabledResponse.ok).toBe(true);
      const disabledPayload = (await disabledResponse.json()) as {
        schemaId: string;
        enabled: boolean;
        status: string;
        files: Array<{
          file: string;
          exists: boolean;
          entryCount: number;
          budget: { maxChars: number; usedChars: number };
          preview: string[];
        }>;
        signals: Array<{ id: string; description: string }>;
      };
      expect(disabledPayload.schemaId).toBe("director.host.long-term-memory-status.v1");
      expect(disabledPayload.enabled).toBe(false);
      expect(disabledPayload.status).toBe("disabled");
      expect(disabledPayload.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "MEMORY.md",
            exists: true,
            entryCount: 1,
            budget: expect.objectContaining({ maxChars: 2200 }),
            preview: expect.arrayContaining([expect.stringContaining("anchor-a")]),
          }),
          expect.objectContaining({
            file: "USER.md",
            exists: true,
            entryCount: 1,
            budget: expect.objectContaining({ maxChars: 1375 }),
            preview: expect.arrayContaining([expect.stringContaining("中文回复")]),
          }),
        ]),
      );
      expect(disabledPayload.signals).toEqual([]);
      expect(JSON.stringify(disabledPayload)).not.toContain("# USER");
      expect(JSON.stringify(disabledPayload)).not.toContain("# MEMORY");

      writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
        "memory.enabled": true,
      });
      const enabledResponse = await fetch(`http://${host}:${port}/v1/memory/long-term/status`);
      expect(enabledResponse.ok).toBe(true);
      const enabledPayload = (await enabledResponse.json()) as {
        enabled: boolean;
        status: string;
        signals: Array<{ id: string; tags: string[] }>;
      };
      expect(enabledPayload.enabled).toBe(true);
      expect(enabledPayload.status).toBe("hit");
      expect(enabledPayload.signals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "long-term-memory:memory",
            tags: expect.arrayContaining(["long-term-memory", "memory"]),
          }),
          expect.objectContaining({
            id: "long-term-memory:user",
            tags: expect.arrayContaining(["long-term-memory", "user"]),
          }),
        ]),
      );

      const methodResponse = await fetch(`http://${host}:${port}/v1/memory/long-term/status`, {
        method: "POST",
      });
      expect(methodResponse.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("exposes unified runtime and long-term memory status", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-unified-status-"));
    tempRoots.push(workspaceRoot);
    await writeMemoryRecordFixture(workspaceRoot);
    writeLongTermMemoryFilesFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const disabledResponse = await fetch(`http://${host}:${port}/v1/memory/status`);
      expect(disabledResponse.ok).toBe(true);
      const disabledPayload = (await disabledResponse.json()) as {
        schemaId: string;
        enabled: boolean;
        status: string;
        runtimeMemory: {
          enabled: boolean;
          storeStatus: string;
          recordCount: number;
          latestRecord: { recordId: string; projectId: string; groupId: string } | null;
        };
        longTerm: {
          enabled: boolean;
          status: string;
          signals: Array<{ id: string }>;
        };
      };

      expect(disabledPayload.schemaId).toBe("director.host.memory-status.v1");
      expect(disabledPayload.enabled).toBe(false);
      expect(disabledPayload.status).toBe("disabled");
      expect(disabledPayload.runtimeMemory).toMatchObject({
        enabled: false,
        storeStatus: "ok",
        recordCount: 1,
        latestRecord: {
          recordId: "memory-1",
          projectId: "project-1",
          groupId: "group-1",
        },
      });
      expect(disabledPayload.longTerm).toMatchObject({
        enabled: false,
        status: "disabled",
        signals: [],
      });

      writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
        "memory.enabled": true,
      });
      const enabledResponse = await fetch(`http://${host}:${port}/v1/memory/status`);
      expect(enabledResponse.ok).toBe(true);
      const enabledPayload = (await enabledResponse.json()) as {
        enabled: boolean;
        status: string;
        runtimeMemory: { enabled: boolean; recordCount: number };
        longTerm: { enabled: boolean; status: string; signals: Array<{ id: string }> };
      };
      expect(enabledPayload.enabled).toBe(true);
      expect(enabledPayload.status).toBe("ok");
      expect(enabledPayload.runtimeMemory).toMatchObject({
        enabled: true,
        recordCount: 1,
      });
      expect(enabledPayload.longTerm).toMatchObject({
        enabled: true,
        status: "hit",
        signals: expect.arrayContaining([
          expect.objectContaining({ id: "long-term-memory:memory" }),
          expect.objectContaining({ id: "long-term-memory:user" }),
        ]),
      });

      const methodResponse = await fetch(`http://${host}:${port}/v1/memory/status`, {
        method: "POST",
      });
      expect(methodResponse.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("previews runtime memory recall through Host API while respecting the memory switch", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-recall-preview-"));
    tempRoots.push(workspaceRoot);
    await writeMemoryRecordFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const request = {
        projectId: "project-1",
        groupId: "group-1",
        anchorIds: ["anchor-a"],
        selectedAdapters: ["scripted"],
        generationType: "new",
        generationStyle: "immersive",
        knowledgeSignalTags: ["continuity"],
        maxHits: 3,
      };
      const disabledResponse = await fetch(`http://${host}:${port}/v1/memory/recall-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      expect(disabledResponse.ok).toBe(true);
      const disabledPayload = (await disabledResponse.json()) as {
        schemaId: string;
        enabled: boolean;
        packet: { status: string; hits: unknown[]; query: { projectId: string } };
      };
      expect(disabledPayload.schemaId).toBe("director.host.memory-recall-preview.v1");
      expect(disabledPayload.enabled).toBe(false);
      expect(disabledPayload.packet).toMatchObject({
        status: "disabled",
        hits: [],
        query: expect.objectContaining({ projectId: "project-1" }),
      });

      writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
        "memory.enabled": true,
      });
      const enabledResponse = await fetch(`http://${host}:${port}/v1/memory/recall-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      expect(enabledResponse.ok).toBe(true);
      const enabledPayload = (await enabledResponse.json()) as {
        enabled: boolean;
        packet: {
          status: string;
          hits: Array<{ recordId: string; provenance: { runId: string } }>;
          truncated: boolean;
        };
      };
      expect(enabledPayload.enabled).toBe(true);
      expect(enabledPayload.packet.status).toBe("ok");
      expect(enabledPayload.packet.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recordId: "memory-1",
            provenance: expect.objectContaining({ runId: "run-memory-1" }),
          }),
        ]),
      );
      expect(enabledPayload.packet.truncated).toBe(false);

      const invalidResponse = await fetch(`http://${host}:${port}/v1/memory/recall-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: "group-1", maxHits: 3 }),
      });
      expect(invalidResponse.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("governs published runtime memory through Host API and reflects it in recall", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-governance-"));
    tempRoots.push(workspaceRoot);
    await writePublishedMemoryCandidateFixture(workspaceRoot);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "memory.enabled": true,
    });

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${host}:${port}`;

    try {
      const demoteResponse = await fetch(`${baseUrl}/v1/memory/publications/memory-1/demote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: "operator",
          note: "来源有用但置信度偏低",
          now: "2026-04-12T12:02:00.000Z",
        }),
      });
      expect(demoteResponse.ok).toBe(true);
      const demotePayload = (await demoteResponse.json()) as {
        schemaId: string;
        action: string;
        recordId: string;
        text: string;
        result: { status: string; governanceStatus: string };
      };
      expect(demotePayload).toMatchObject({
        schemaId: "director.host.memory-publication-governance.v1",
        action: "demote",
        recordId: "memory-1",
        result: {
          status: "ok",
          governanceStatus: "demoted",
        },
      });
      expect(demotePayload.text).toContain("已降权记忆：memory-1");

      const demotedRecall = await postMemoryRecallPreview(baseUrl);
      expect(demotedRecall.packet.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recordId: "memory-1",
            governance: expect.objectContaining({
              status: "demoted",
              audit: expect.arrayContaining([
                expect.objectContaining({
                  actor: "operator",
                  note: "来源有用但置信度偏低",
                  previousStatus: "published",
                  nextStatus: "demoted",
                }),
              ]),
            }),
            reasons: expect.arrayContaining(["memory demoted by governance"]),
          }),
        ]),
      );

      const quarantineResponse = await fetch(
        `${baseUrl}/v1/memory/publications/memory-1/quarantine`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actor: "operator",
            note: "暂时隔离，避免污染召回",
            now: "2026-04-12T12:03:00.000Z",
          }),
        },
      );
      expect(quarantineResponse.ok).toBe(true);
      const quarantinePayload = (await quarantineResponse.json()) as {
        text: string;
        result: { status: string; governanceStatus: string };
      };
      expect(quarantinePayload.result).toMatchObject({
        status: "ok",
        governanceStatus: "quarantined",
      });
      expect(quarantinePayload.text).toContain("已隔离记忆：memory-1");

      const quarantinedRecall = await postMemoryRecallPreview(baseUrl);
      expect(quarantinedRecall.packet.status).toBe("miss");
      expect(quarantinedRecall.packet.hits).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("lists published runtime memory governance state through Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-memory-publications-"));
    tempRoots.push(workspaceRoot);
    await writePublishedMemoryCandidateFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${host}:${port}`;

    try {
      const initialResponse = await fetch(`${baseUrl}/v1/memory/publications`);
      expect(initialResponse.ok).toBe(true);
      const initialPayload = (await initialResponse.json()) as {
        schemaId: string;
        count: number;
        items: Array<{
          recordId: string;
          candidateId: string;
          governanceStatus: string;
          evidenceRefs: Array<{ evidenceId: string; sourceRef: string }>;
          text: string;
        }>;
      };
      expect(initialPayload.schemaId).toBe("director.host.memory-publications.v1");
      expect(initialPayload.count).toBe(1);
      expect(initialPayload.items[0]).toMatchObject({
        recordId: "memory-1",
        candidateId: "candidate-memory-1",
        governanceStatus: "published",
        evidenceRefs: [
          expect.objectContaining({
            evidenceId: "tool-evidence-run-memory-1-browser-read",
            sourceRef: "tool://browser_read/browser-read",
          }),
        ],
      });
      expect(initialPayload.items[0]?.text).toContain("已发布");

      const demoteResponse = await fetch(`${baseUrl}/v1/memory/publications/memory-1/demote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: "operator",
          note: "来源有用但置信度偏低",
          now: "2026-04-12T12:02:00.000Z",
        }),
      });
      expect(demoteResponse.ok).toBe(true);

      const demotedResponse = await fetch(`${baseUrl}/v1/memory/publications?status=demoted`);
      expect(demotedResponse.ok).toBe(true);
      const demotedPayload = (await demotedResponse.json()) as {
        count: number;
        items: Array<{
          recordId: string;
          governanceStatus: string;
          governanceAudit: Array<{ note: string; previousStatus: string; nextStatus: string }>;
          text: string;
        }>;
      };
      expect(demotedPayload.count).toBe(1);
      expect(demotedPayload.items[0]).toMatchObject({
        recordId: "memory-1",
        governanceStatus: "demoted",
        governanceAudit: [
          expect.objectContaining({
            note: "来源有用但置信度偏低",
            previousStatus: "published",
            nextStatus: "demoted",
          }),
        ],
      });
      expect(demotedPayload.items[0]?.text).toContain("已降权");

      const methodResponse = await fetch(`${baseUrl}/v1/memory/publications`, {
        method: "POST",
      });
      expect(methodResponse.status).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("exposes scoped read-only evidence list, detail, and content through Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-evidence-"));
    tempRoots.push(workspaceRoot);
    await writeEvidenceArtifactFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${host}:${port}`;

    try {
      const missingScope = await fetch(`${baseUrl}/v1/evidence`);
      expect(missingScope.status).toBe(400);
      const missingScopePayload = (await missingScope.json()) as {
        code: string;
        message: string;
      };
      expect(missingScopePayload.code).toBe("INVALID_EVIDENCE_SCOPE");
      expect(missingScopePayload.message).toContain("必须带一个范围");

      const listResponse = await fetch(
        `${baseUrl}/v1/evidence?sourceSnapshotId=artifact-evidence-1`,
      );
      expect(listResponse.ok).toBe(true);
      const listPayload = (await listResponse.json()) as {
        schemaId: string;
        count: number;
        items: Array<{
          evidenceId: string;
          sourceSnapshotId: string;
          sourceRef: string;
          preview: string;
          metadata: { artifactId: string };
        }>;
      };
      expect(listPayload.schemaId).toBe("director.host.evidence-list.v1");
      expect(listPayload.count).toBe(1);
      expect(listPayload.items[0]).toMatchObject({
        evidenceId: "source-evidence-444b825dc472",
        sourceSnapshotId: "artifact-evidence-1",
        sourceRef: "https://example.test/evidence",
        preview: expect.stringContaining("证据正文预览"),
        metadata: {
          artifactId: "artifact-evidence-1",
        },
      });

      const detailResponse = await fetch(`${baseUrl}/v1/evidence/source-evidence-444b825dc472`);
      expect(detailResponse.ok).toBe(true);
      const detailPayload = (await detailResponse.json()) as {
        schemaId: string;
        evidence: { evidenceId: string; contentLength: number };
      };
      expect(detailPayload.schemaId).toBe("director.host.evidence-detail.v1");
      expect(detailPayload.evidence.evidenceId).toBe("source-evidence-444b825dc472");
      expect(detailPayload.evidence.contentLength).toBeGreaterThan(10);

      const contentResponse = await fetch(
        `${baseUrl}/v1/evidence/source-evidence-444b825dc472/content?maxChars=11`,
      );
      expect(contentResponse.ok).toBe(true);
      const contentPayload = (await contentResponse.json()) as {
        schemaId: string;
        content: string;
        truncated: boolean;
        contentLength: number;
      };
      expect(contentPayload.schemaId).toBe("director.host.evidence-content.v1");
      expect(contentPayload.content).toBe("证据正文预览，需要保留");
      expect(contentPayload.truncated).toBe(true);
      expect(contentPayload.contentLength).toBeGreaterThan(contentPayload.content.length);
    } finally {
      await app.close();
    }
  });

  it("exposes file-backed conversation tool evidence through Host API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-tool-evidence-"));
    tempRoots.push(workspaceRoot);
    await writeConversationToolEvidenceFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${host}:${port}`;

    try {
      const listResponse = await fetch(`${baseUrl}/v1/evidence?sessionKey=desktop%3Aworkbench`);
      expect(listResponse.ok).toBe(true);
      const listPayload = (await listResponse.json()) as {
        schemaId: string;
        count: number;
        items: Array<{
          evidenceId: string;
          kind: string;
          sourceKind: string;
          sourceRef: string;
          preview: string;
          metadata: { family: string; toolName: string; sessionKey: string };
        }>;
      };
      expect(listPayload.schemaId).toBe("director.host.evidence-list.v1");
      expect(listPayload.count).toBe(1);
      expect(listPayload.items[0]).toMatchObject({
        evidenceId: "tool-evidence-host-api-1",
        kind: "tool-result",
        sourceKind: "tool-result",
        sourceRef: "tool://web_extract/call-host-evidence",
        preview: expect.stringContaining("工具完整正文"),
        metadata: {
          family: "conversation-runtime-tool-result",
          toolName: "web_extract",
          sessionKey: "desktop:workbench",
        },
      });

      const detailResponse = await fetch(`${baseUrl}/v1/evidence/tool-evidence-host-api-1`);
      expect(detailResponse.ok).toBe(true);
      const detailPayload = (await detailResponse.json()) as {
        evidence: { evidenceId: string; contentLength: number };
      };
      expect(detailPayload.evidence.evidenceId).toBe("tool-evidence-host-api-1");
      expect(detailPayload.evidence.contentLength).toBeGreaterThan(20);

      const contentResponse = await fetch(
        `${baseUrl}/v1/evidence/tool-evidence-host-api-1/content?maxChars=12`,
      );
      expect(contentResponse.ok).toBe(true);
      const contentPayload = (await contentResponse.json()) as {
        content: string;
        truncated: boolean;
        contentLength: number;
      };
      expect(contentPayload.content).toBe("status: succ");
      expect(contentPayload.truncated).toBe(true);
      expect(contentPayload.contentLength).toBeGreaterThan(contentPayload.content.length);
    } finally {
      await app.close();
    }
  });

  it("filters file-backed conversation tool evidence by turn, run, and tool name", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-tool-evidence-filter-"));
    tempRoots.push(workspaceRoot);
    await writeConversationToolEvidenceFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${host}:${port}`;

    try {
      const matched = await fetch(
        `${baseUrl}/v1/evidence?turnId=turn-host-evidence&turnRunId=turn-run-host-evidence&toolName=web_extract`,
      );
      expect(matched.ok).toBe(true);
      const matchedPayload = (await matched.json()) as {
        count: number;
        items: Array<{ evidenceId: string }>;
      };
      expect(matchedPayload.count).toBe(1);
      expect(matchedPayload.items[0]?.evidenceId).toBe("tool-evidence-host-api-1");

      const mismatched = await fetch(
        `${baseUrl}/v1/evidence?turnId=turn-host-evidence&toolName=browser_snapshot`,
      );
      expect(mismatched.ok).toBe(true);
      const mismatchedPayload = (await mismatched.json()) as { count: number };
      expect(mismatchedPayload.count).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("uses the latest knowledge recall switch without restarting", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-knowledge-"));
    tempRoots.push(workspaceRoot);
    await writePublishedKnowledgeFixture(workspaceRoot);

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const disabledPayload = await postEvaluateMemorySnapshot(`http://${host}:${port}`);
      expect(disabledPayload.summary).not.toContain("Published knowledge matched 1 pack");

      writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
        "knowledgeRecall.enabled": true,
      });
      const enabledPayload = await postEvaluateMemorySnapshot(`http://${host}:${port}`);

      expect(enabledPayload.summary).toContain("Published knowledge matched 1 pack");
      expect(enabledPayload.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("published knowledge pack")]),
      );
    } finally {
      await app.close();
    }
  });

  it("materializes active recall from runtime memory, published knowledge, long-term memory, and approved Skills into blueprints", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-active-recall-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    await writeMemoryRecordFixture(workspaceRoot);
    await writePublishedKnowledgeFixture(workspaceRoot);
    writeLongTermMemoryFilesFixture(workspaceRoot);
    writeApprovedSkillFixture(dataDir);
    writeRuntimeFeatureSwitchesFixture(workspaceRoot, {
      "memory.enabled": true,
      "knowledgeRecall.enabled": true,
    });

    const app = createDirectorHostApiApp({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createBlueprintMemoryRequest()),
      });

      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        actionGraph: {
          stopConditions: string[];
          nodes: Array<{
            role: string;
            inputs: string[];
            constraints: Array<{ requirement: string }>;
          }>;
        };
        handoff: {
          notes: string[];
        };
        preview: {
          summary: string;
          warnings: string[];
        };
      };
      const auditTrail = [...payload.actionGraph.stopConditions, ...payload.handoff.notes];
      expect(auditTrail).toEqual(
        expect.arrayContaining([
          "recall=hit",
          "published-knowledge=hit",
          "long-term-memory=hit",
          "skills=hit",
          expect.stringContaining("recall-hit=memory-1"),
          expect.stringContaining("recall-run=run-memory-1"),
          expect.stringContaining("published-pack=director-method-continuity-teaser"),
          "skill-hit=continuity-teaser-skill",
        ]),
      );

      const nodeText = payload.actionGraph.nodes
        .flatMap((node) => [
          ...node.inputs,
          ...node.constraints.map((constraint) => constraint.requirement),
        ])
        .join("\n");
      expect(nodeText).toContain("bounded recall brief");
      expect(nodeText).toContain("published knowledge brief");
      expect(nodeText).toContain("long-term memory brief");
      expect(nodeText).toContain("Recall continuity brief");
      expect(nodeText).toContain("Published method brief");
      expect(nodeText).toContain("long-term-memory:memory");
      expect(nodeText).toContain("Keep anchor-a visible");
      expect(nodeText).toContain("Skill continuity-teaser-skill");
      expect(nodeText).toContain("three-shot continuity teaser");
      expect(payload.preview.summary).toContain("Published knowledge matched 1 pack");
      expect(payload.preview.summary).toContain("Matched 1 approved Skill(s)");
      expect(payload.preview.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("run-memory-1"),
          expect.stringContaining("published knowledge pack"),
          expect.stringContaining("long-term-memory:memory"),
          expect.stringContaining("continuity-teaser-skill"),
        ]),
      );
    } finally {
      await app.close();
    }
  });
});

function writeRuntimeFeatureSwitchesFixture(
  workspaceRoot: string,
  features: Record<string, boolean>,
) {
  const runtimeRoot = join(workspaceRoot, ".director-angel", "runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    join(runtimeRoot, "switches.json"),
    `${JSON.stringify(
      {
        schemaId: "director.switches.v1",
        features,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function writeLongTermMemoryFilesFixture(workspaceRoot: string) {
  const memoryDir = join(workspaceRoot, ".director-angel", "memory");
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(
    join(memoryDir, "MEMORY.md"),
    [
      "# Project Memory",
      "",
      "- Keep anchor-a visible in the opening shot.",
      "- Avoid comic timing for continuity-safe teasers.",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(memoryDir, "USER.md"),
    [
      "# User Memory",
      "",
      "- Prefers concise production plans.",
      "- Dislikes loose visual drift.",
    ].join("\n"),
    "utf8",
  );
}

async function writeMemoryRecordFixture(workspaceRoot: string) {
  const memoryStore = new FileSystemDirectorMemoryStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "memory"),
    clock: () => "2026-04-12T12:00:00.000Z",
  });
  const writeResult = await memoryStore.writeRecord(
    createMemoryRecord({
      recordId: "memory-1",
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-a"],
      selectedAdapters: ["scripted"],
    }),
  );
  expect(writeResult.status).toBe("ok");
}

async function writePublishedMemoryCandidateFixture(workspaceRoot: string) {
  const memoryStore = new FileSystemDirectorMemoryStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "memory"),
    clock: () => "2026-04-12T12:00:00.000Z",
  });
  const candidateWrite = await memoryStore.writeCandidate({
    candidateId: "candidate-memory-1",
    record: createMemoryRecord({
      recordId: "memory-1",
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-a"],
      selectedAdapters: ["scripted"],
    }),
    evidenceRefs: [
      {
        evidenceId: "tool-evidence-run-memory-1-browser-read",
        sourceKind: "tool-result",
        sourceRef: "tool://browser_read/browser-read",
        sourceSnapshotId: "artifact-browser-read-1",
        summary: "已审核的工具结果证据。",
      },
    ],
    summary: "发布后的运行记忆，可被后续召回。",
    createdAt: "2026-04-12T12:00:00.000Z",
  });
  expect(candidateWrite.status).toBe("ok");
  const publish = await memoryStore.publishCandidate("candidate-memory-1", {
    actor: "operator",
    note: "accepted after evidence review",
    publishedAt: "2026-04-12T12:01:00.000Z",
  });
  expect(publish.status).toBe("ok");
}

async function writeEvidenceArtifactFixture(workspaceRoot: string) {
  const store = new FileExperienceStore({
    experienceDir: join(workspaceRoot, ".director-angel", "knowledge", "experience"),
  });
  await store.writeSourceArtifact(
    createExperienceSourceArtifact({
      artifactId: "artifact-evidence-1",
      sourceKind: "web-page",
      sourceRef: "https://example.test/evidence",
      title: "Evidence fixture",
      contentType: "text/plain; charset=utf-8",
      digest: "sha256:evidence-fixture",
      bytes: 64,
      textPreview: "证据正文预览，需要保留给跨端查看。",
      rawContent: "证据正文预览，需要保留给跨端查看。完整内容用于只读 content 端点。",
      quality: createExperienceQualityAssessment({
        score: 88,
        verdict: "usable",
        reasons: ["fixture source is readable"],
      }),
      privacy: "public",
      provenance: "director-host-api-test",
      capturedAtMs: 1_776_000_075_000,
    }),
  );
}

async function writeConversationToolEvidenceFixture(workspaceRoot: string) {
  const store = createFileConversationRuntimeToolEvidenceStore({
    rootPath: join(workspaceRoot, ".hotflow", "conversation-runtime", "tool-evidence"),
    nowMs: () => 1_776_000_085_000,
  });
  const content = [
    "status: success",
    "url: https://example.test/tool-evidence",
    `body: ${"工具完整正文。".repeat(20)}`,
  ].join("\n");
  const evidence = createToolResultEvidenceRecord({
    id: "tool-evidence-host-api-1",
    turnId: "turn-host-evidence",
    turnRunId: "turn-run-host-evidence",
    sessionKey: "desktop:workbench",
    toolCallId: "call-host-evidence",
    toolName: "web_extract",
    ok: true,
    content,
    metadata: {
      sourceUrl: "https://example.test/tool-evidence",
    },
    observedAtMs: 1_776_000_084_000,
  });
  store.upsertToolResultEvidence({ evidence, content });
}

async function writePublishedKnowledgeFixture(workspaceRoot: string) {
  await new FileKnowledgeStore({
    knowledgeDir: join(workspaceRoot, ".director-angel", "knowledge"),
  }).publish({
    schemaVersion: "director.knowledge.pack.v1",
    metadata: {
      id: "director-method-continuity-teaser",
      title: "Director method: continuity-safe teaser",
      description: "Use the previously approved continuity-safe route.",
      tags: ["continuity", "teaser"],
      createdAt: "2026-04-13T03:00:00.000Z",
      version: 1,
    },
    stage: "published",
    method: {
      sourceProposalId: "proposal-published-1",
      sourceRecordId: "record-published-1",
      sourceDigestId: "digest-published-1",
      projectId: "project-1",
      groupId: "group-1",
      goal: "Create a continuity-safe teaser.",
      trigger: "When planning a continuity-safe teaser for the same project group.",
      summary: "Use the previously approved continuity-safe route.",
      explanation: "Preserve anchor continuity and keep the immersive teaser tone.",
      evidenceSummary: "completed run with stable teaser continuity",
      roles: ["researcher", "script-planner"],
      preferredAdapters: ["binding-a"],
      anchorIds: ["anchor-a"],
      generationType: "new",
      generationStyle: "immersive",
    },
    audit: {
      publishedAt: "2026-04-13T03:01:00.000Z",
      author: "director-host-api-test",
    },
  });
}

function writeApprovedSkillFixture(dataDir: string) {
  new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }), {
    now: () => 1_776_000_001_000,
  }).writeApproved([
    {
      id: "continuity-teaser-skill",
      version: "1.0.0",
      title: "Continuity teaser Skill",
      description: "Use for continuity-safe teaser storyboards.",
      content:
        "Build a three-shot continuity teaser: keep anchor-a visible in the first shot, preserve the immersive tone, and verify continuity before handoff.",
      tags: ["continuity", "teaser", "immersive"],
      toolNames: ["director.blueprint"],
      updatedAtMs: 1_776_000_000_000,
    },
  ]);
}

async function postEvaluateMemorySnapshot(baseUrl: string): Promise<{
  readonly summary: string;
  readonly recommendations: readonly string[];
}> {
  const response = await fetch(`${baseUrl}/v1/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiVersion: "director-host-api.v1",
      snapshot: createEvaluateSnapshot(),
    }),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as {
    summary: string;
    recommendations: readonly string[];
  };
}

function createEvaluateSnapshot() {
  return {
    apiVersion: "director-host-api.v1",
    schemaId: "director.host.snapshot.v1",
    snapshotId: "snapshot-memory-1",
    createdAt: "2026-04-11T12:00:00.000Z",
    host: {
      hostId: "host-1",
      triggerSource: "cli",
    },
    project: {
      projectId: "project-1",
      title: "Director Host API",
      outline: "做一个导演预检蓝图。",
    },
    group: {
      groupId: "group-1",
      generationStyle: "immersive",
      generationType: "new",
      sceneCount: 1,
      anchorIds: ["anchor-a"],
    },
    runtime: {
      runtimeId: "runtime-1",
      status: "ready",
      availableBindings: ["binding-a"],
      maxPromptChars: 4096,
      supportsVideo: true,
    },
    intent: {
      bindingPolicy: "prefer",
      preferredImageBinding: "binding-a",
    },
  };
}

async function postMemoryRecallPreview(baseUrl: string): Promise<{
  readonly packet: {
    readonly status: string;
    readonly hits: readonly {
      readonly recordId: string;
      readonly reasons?: readonly string[];
      readonly governance?: {
        readonly status: string;
        readonly audit: readonly Record<string, unknown>[];
      };
    }[];
  };
}> {
  const response = await fetch(`${baseUrl}/v1/memory/recall-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-a"],
      selectedAdapters: ["scripted"],
      generationType: "new",
      generationStyle: "immersive",
      knowledgeSignalTags: ["continuity"],
      maxHits: 3,
    }),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as {
    packet: {
      status: string;
      hits: readonly {
        recordId: string;
        reasons?: readonly string[];
        governance?: {
          status: string;
          audit: readonly Record<string, unknown>[];
        };
      }[];
    };
  };
}

function createBlueprintMemoryRequest() {
  const snapshot = createEvaluateSnapshot();
  const intake = {
    intakeId: "intake-memory-blueprint-1",
    submittedAt: snapshot.createdAt,
    objective: "Create a continuity-safe teaser with an immersive three-shot storyboard.",
    desiredOutcome: "A continuity-safe teaser storyboard.",
    deliverables: ["storyboard"],
  };

  return {
    apiVersion: "director-host-api.v1",
    snapshot: {
      ...snapshot,
      project: {
        ...snapshot.project,
        outline: intake.objective,
      },
    },
    intake,
    alignmentLock: {
      lockId: "alignment-lock-memory-blueprint-1",
      sourceIntakeId: intake.intakeId,
      state: "locked",
      lockedAt: snapshot.createdAt,
      objective: intake.objective,
      desiredOutcome: intake.desiredOutcome,
      deliverables: [...intake.deliverables],
      lockedConstraints: [],
      lockedFields: [],
    },
  };
}

function createMemoryRecord(input: {
  recordId: string;
  projectId: string;
  groupId: string;
  anchorIds: readonly string[];
  selectedAdapters: readonly string[];
}) {
  const digest = buildDirectorTraceDigest({
    digestId: `digest-${input.recordId}`,
    recordedAt: "2026-04-12T10:00:00.000Z",
    report: createExecutionRunReport(input),
    projectId: input.projectId,
    groupId: input.groupId,
    anchorIds: input.anchorIds,
    selectedAdapters: input.selectedAdapters,
    generationType: "new",
    generationStyle: "immersive",
    knowledgeSignalTags: ["continuity"],
  });

  return {
    schemaVersion: "director.memory.record.v1" as const,
    recordId: input.recordId,
    digestId: digest.digestId,
    projectId: digest.projectId,
    groupId: digest.groupId,
    anchorIds: digest.anchorIds,
    selectedAdapters: digest.selectedAdapters,
    status: digest.status,
    recordedAt: digest.recordedAt,
    digest,
  };
}

function createExecutionRunReport(input: {
  recordId: string;
  selectedAdapters: readonly string[];
}) {
  return {
    schemaVersion: "director.execution.run.v1" as const,
    reportId: `report-${input.recordId}`,
    flags: [],
    notes: [],
    run: {
      schemaVersion: "director.execution.run.v1" as const,
      runId: `run-${input.recordId}`,
      snapshotId: `snapshot-${input.recordId}`,
      runtimeId: "runtime-1",
      blueprintId: `blueprint-${input.recordId}`,
      handoffId: `handoff-${input.recordId}`,
      actionGraphId: `graph-${input.recordId}`,
      goal: "Create a continuity-safe teaser.",
      previewSummary: "Preview-safe run completed successfully.",
      createdAt: "2026-04-12T09:50:00.000Z",
      startedAt: "2026-04-12T09:51:00.000Z",
      updatedAt: "2026-04-12T09:59:00.000Z",
      completedAt: "2026-04-12T09:59:00.000Z",
      status: "completed" as const,
      assignments: [
        {
          runId: `run-${input.recordId}`,
          assignmentId: "assignment-router",
          role: "asset-router" as const,
          objective: "Select the best adapter route.",
          deliverable: "Adapter route",
          actionClass: "route" as const,
          approvalMode: "operator_approve" as const,
          dependsOn: [],
          status: "completed" as const,
          selectedAdapter: input.selectedAdapters[0] ?? null,
          createdAt: "2026-04-12T09:50:00.000Z",
          startedAt: "2026-04-12T09:52:00.000Z",
          completedAt: "2026-04-12T09:54:00.000Z",
          attempts: 1,
          result: {
            artifactIds: ["artifact-route"],
            notes: ["Selected a continuity-safe adapter route."],
            adapterId: input.selectedAdapters[0] ?? "scripted",
          },
        },
      ],
      events: [
        {
          eventId: `event-${input.recordId}`,
          runId: `run-${input.recordId}`,
          assignmentId: "assignment-router",
          type: "assignment.completed" as const,
          timestamp: "2026-04-12T09:54:00.000Z",
          payload: {
            adapterId: input.selectedAdapters[0] ?? "scripted",
          },
        },
      ],
    },
  };
}
