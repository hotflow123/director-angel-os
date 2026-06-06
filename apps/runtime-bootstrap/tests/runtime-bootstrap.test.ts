import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileKnowledgeStore } from "@hotflow/director-knowledge";
import type { ModelGenerateResult, ModelProvider, ModelRequest } from "@hotflow/models";
import { FakeModelProvider } from "@hotflow/models";
import {
  SkillManagementStore,
  SkillSnapshotFileStore,
  resolveSkillManagementPath,
} from "@hotflow/skills";
import { TaskBoard } from "@hotflow/tasks-core";
import { describe, expect, test, vi } from "vitest";

import {
  DEFAULT_RUNTIME_PROMPT_SECTION_IDS,
  bootstrapRuntime,
  createDefaultRuntimeContextAssembler,
  createDefaultRuntimeMemory,
  createDefaultRuntimePromptRegistry,
  createDefaultRuntimePromptSectionContributors,
  createDefaultRuntimePromptSections,
  createDefaultRuntimeToolRegistry,
  createRuntimeDoctorMempalaceProbe,
} from "../src/index.js";

describe("bootstrapRuntime", () => {
  test("assembles runtime with plugin registrar and skill repository wiring", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-runtime-bootstrap-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    const sessionDbPath = join(dataDir, "sessions", "runtime.sqlite");

    const captured: {
      providerEnv?: NodeJS.ProcessEnv;
      providerFetchImpl?: typeof fetch;
      telemetry?: { readonly scope: string };
      controlPlaneSessionStoreSeen?: boolean;
      controlPlaneMemorySeen?: boolean;
    } = {};
    const controlPlane = {
      dispatch() {
        return { ok: true };
      },
    };

    try {
      const runtime = bootstrapRuntime({
        approvedSkills: [
          {
            id: "skill.react-loop",
            version: "1.0.0",
            title: "ReAct Loop",
            content: "Call tools, observe results, then respond.",
            updatedAtMs: Date.now(),
          },
        ],
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: dataDir,
          HOTFLOW_SESSION_DB_PATH: sessionDbPath,
        },
        fetchImpl: globalThis.fetch,
        registerProviders(registry, options) {
          captured.providerEnv = options.env;
          captured.providerFetchImpl = options.fetchImpl;
          registry.register(new FakeModelProvider({ id: "fake-live" }));
          return ["fake-live"];
        },
        createTelemetry({ config }) {
          return { scope: config.workspaceRoot };
        },
        createControlPlane({ config, memory, sessionStore, telemetry }) {
          captured.telemetry = telemetry;
          captured.controlPlaneSessionStoreSeen = Boolean(sessionStore);
          captured.controlPlaneMemorySeen = Boolean(memory);
          expect(config.workspaceRoot).toBe(workspaceRoot);
          return controlPlane;
        },
      });

      expect(runtime.config.workspaceRoot).toBe(workspaceRoot);
      expect(runtime.providerIds).toContain("scripted");
      expect(runtime.providerIds).toContain("fake-live");
      expect(runtime.providerIds.filter((providerId) => providerId === "scripted")).toHaveLength(1);
      expect(runtime.internalPluginIds).toEqual(["provider.scripted", "tool.filesystem-read"]);
      expect(runtime.pluginRegistrar.listManifests().map((manifest) => manifest.id)).toEqual(
        runtime.internalPluginIds,
      );
      expect(
        runtime.contextAssembler
          .getRegistry()
          .list()
          .map((section) => section.id),
      ).toEqual([...DEFAULT_RUNTIME_PROMPT_SECTION_IDS]);
      expect(runtime.skillRepository.listApproved()).toHaveLength(1);
      expect(runtime.controlPlane).toBe(controlPlane);
      expect(runtime.telemetry).toEqual({ scope: workspaceRoot });
      expect(runtime.engine).toBeDefined();
      expect(captured.providerEnv?.HOTFLOW_WORKSPACE_ROOT).toBe(workspaceRoot);
      expect(captured.providerFetchImpl).toBe(globalThis.fetch);
      expect(captured.telemetry).toEqual({ scope: workspaceRoot });
      expect(captured.controlPlaneSessionStoreSeen).toBe(true);
      expect(captured.controlPlaneMemorySeen).toBe(true);
      runtime.sessionStore.close();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("registers output-style aware prompt sections through runtime bootstrap wiring", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-runtime-bootstrap-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    const sessionDbPath = join(dataDir, "sessions", "runtime.sqlite");

    try {
      const runtime = bootstrapRuntime({
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: dataDir,
          HOTFLOW_SESSION_DB_PATH: sessionDbPath,
          HOTFLOW_OUTPUT_STYLE: "verbose",
          HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
        },
        registerProviders(registry) {
          registry.register(new FakeModelProvider({ id: "fake-live" }));
          return ["fake-live"];
        },
        createTelemetry() {
          return { scope: "test" };
        },
        createControlPlane() {
          return { dispatch() {} };
        },
      });

      const outputStyleSection = runtime.contextAssembler.getRegistry().get("system.output-style");
      const permissionModeSection = runtime.contextAssembler
        .getRegistry()
        .get("system.permission-mode");
      const responseLanguageSection = runtime.contextAssembler
        .getRegistry()
        .get("system.response-language");
      const runtimeSection = runtime.contextAssembler.getRegistry().get("system.runtime");
      expect(outputStyleSection?.content).toContain("Current output style: verbose");
      expect(outputStyleSection?.content).toContain("Provide fuller explanations");
      expect(permissionModeSection?.content).toContain("Default permission mode: ask");
      expect(permissionModeSection?.content).toContain(
        "Treat side-effectful tool actions as approval-gated",
      );
      expect(responseLanguageSection?.content).toContain("Default response language: zh-CN");
      expect(responseLanguageSection?.content).toContain(
        "Default response language policy: answer in zh-CN unless session guidance overrides this turn.",
      );
      expect(responseLanguageSection?.content).toContain(
        "Apply this default only when no session override is active for the current turn.",
      );
      expect(runtimeSection?.content).toContain("Runtime shell:");
      expect(runtimeSection?.content).not.toContain("- Permission mode: ask");
      expect(runtimeSection?.content).not.toContain("- Response language: zh-CN");
      expect(runtimeSection?.metadata).toBeUndefined();
      runtime.sessionStore.close();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("creates skill-backed prompt section contributors", () => {
    const buildSections = vi.fn(() => [
      {
        id: "skill.react-loop",
        cacheBucket: "dynamic" as const,
        owner: "skill" as const,
        content: "Call tools, observe results, then respond.",
      },
    ]);
    const contextualRecallBuild = vi.fn(() => ({
      knowledgeEnabled: true,
      knowledgeDocuments: [],
      longTermMemorySignals: [
        {
          id: "memory:user-preference",
          description: "Prefer concise answers.",
        },
      ],
    }));

    const contributors = createDefaultRuntimePromptSectionContributors({
      contextualRecall: {
        build: contextualRecallBuild,
      },
      skillPromptIndex: {
        buildSections,
      },
    });

    expect(contributors).toHaveLength(1);
    const sections = contributors[0]?.buildSections({
      userInput: "react plan",
      taskState: {
        items: [{ id: "todo_1", content: "Ship beta", status: "todo" }],
      },
      toolResults: [{ toolName: "tasks.todo_write", ok: true }],
    });

    expect(sections).toEqual([
      expect.objectContaining({
        id: "director.contextual-recall",
        cacheBucket: "dynamic",
        owner: "runtime",
        content: expect.stringContaining("Director Angel contextual recall"),
        metadata: expect.objectContaining({
          visibleSummary: "已参考：Skill 1 个、记忆 1 条。",
          knowledgeHits: 0,
          skillHits: 1,
          recallTrace: 2,
          capabilityPlan: 3,
          policy: "production",
        }),
      }),
    ]);
    expect(buildSections).toHaveBeenCalledWith({
      userText: "react plan",
      taskState: {
        items: [{ id: "todo_1", content: "Ship beta", status: "todo" }],
      },
      toolResults: [{ toolName: "tasks.todo_write", ok: true }],
    });
    expect(contextualRecallBuild).toHaveBeenCalledWith({
      userText: "react plan",
      skillSections: [
        {
          id: "skill.react-loop",
          cacheBucket: "dynamic",
          owner: "skill",
          content: "Call tools, observe results, then respond.",
        },
      ],
    });
  });

  test("injects published knowledge, enabled skills, and compact memory into engine turns", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-runtime-bootstrap-context-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    const sessionDbPath = join(dataDir, "sessions", "runtime.sqlite");
    const provider = new CapturingModelProvider();

    try {
      await new FileKnowledgeStore({
        knowledgeDir: join(workspaceRoot, ".director-angel", "knowledge"),
      }).publish({
        schemaVersion: "director.knowledge.pack.v1",
        metadata: {
          id: "director-experience-comfyui-scenes",
          title: "ComfyUI scene split experience",
          tags: ["experience", "self-learning", "comfyui", "script"],
          createdAt: "2026-05-03T00:00:00.000Z",
          version: 1,
        },
        stage: "published",
        method: {
          sourceProposalId: "proposal-runtime-context",
          sourceRecordId: "record-runtime-context",
          sourceDigestId: "digest-runtime-context",
          projectId: "experience-learning",
          groupId: "runtime",
          goal: "Use published ComfyUI scene splitting lessons.",
          trigger: "Use when creating ComfyUI script workflows.",
          summary: "Keep each scene prompt independent before tool handoff.",
          explanation: "Do not put every scene into one media prompt.",
          evidenceSummary: "verified desktop ComfyUI draft behavior",
          roles: ["script-planner"],
          preferredAdapters: [],
          anchorIds: ["runtime-context"],
          generationType: "self-learning",
          generationStyle: "runtime",
        },
        audit: {
          publishedAt: "2026-05-03T00:01:00.000Z",
        },
      });
      new SkillSnapshotFileStore(join(dataDir, "skills", "approved-skills.json"), {
        now: () => 200,
      }).writeApproved([
        {
          id: "skill.comfyui-scene-workflow",
          version: "1.0.0",
          title: "ComfyUI scene workflow",
          content: "Split script, image, and video parameters per scene before building nodes.",
          tags: ["comfyui", "script", "workflow"],
          updatedAtMs: 100,
        },
      ]);
      new SkillManagementStore(resolveSkillManagementPath({ dataDir })).setSkillEnabled(
        "skill.comfyui-scene-workflow",
        true,
        { reason: "test" },
      );
      mkdirSync(join(workspaceRoot, ".director-angel", "memory"), { recursive: true });
      mkdirSync(join(workspaceRoot, ".director-angel", "runtime"), { recursive: true });
      writeFileSync(
        join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
        `${JSON.stringify(
          {
            schemaId: "director.switches.v1",
            features: {
              "knowledgeRecall.enabled": true,
              "memory.enabled": true,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(
          join(workspaceRoot, ".director-angel", "memory", "MEMORY.md"),
          "# Memory\n每个场景都要独立连接脚本、图片和视频参数。",
          "utf8",
        ),
      );

      const runtime = bootstrapRuntime({
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: dataDir,
          HOTFLOW_SESSION_DB_PATH: sessionDbPath,
        },
        registerProviders(registry) {
          registry.register(provider);
          return [provider.id];
        },
        createTelemetry() {
          return { scope: "test" };
        },
        createControlPlane() {
          return { dispatch() {} };
        },
      });

      await runtime.engine.runTurn({
        userText: "创建 ComfyUI 脚本工作流：一个小猪学习游泳的30秒故事",
        providerId: provider.id,
        model: "capture-model",
        turnId: "turn-runtime-contextual-recall",
        maxSteps: 1,
      });

      const dynamicPrompt = provider.lastRequest?.messages.find(
        (message) => message.role === "user",
      )?.content;
      expect(dynamicPrompt).toContain("Director Angel contextual recall");
      expect(dynamicPrompt).toContain("ComfyUI scene split experience");
      expect(dynamicPrompt).toContain("ComfyUI scene workflow");
      expect(dynamicPrompt).toContain("每个场景都要独立连接脚本");
      runtime.sessionStore.close();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("loads approved skills from the default snapshot file on bootstrap", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-runtime-bootstrap-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    const sessionDbPath = join(dataDir, "sessions", "runtime.sqlite");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });

    try {
      new SkillSnapshotFileStore(join(dataDir, "skills", "approved-skills.json"), {
        now: () => 200,
      }).writeApproved([
        {
          id: "skill.readme-summary",
          version: "1.0.0",
          title: "README Summary",
          content: "Read README, then summarize it.",
          updatedAtMs: 100,
        },
      ]);

      const runtime = bootstrapRuntime({
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: dataDir,
          HOTFLOW_SESSION_DB_PATH: sessionDbPath,
        },
        registerProviders(registry) {
          registry.register(new FakeModelProvider({ id: "fake-live" }));
          return ["fake-live"];
        },
        createTelemetry() {
          return { scope: "test" };
        },
        createControlPlane() {
          return { dispatch() {} };
        },
      });

      expect(runtime.skillRepository.getApproved("skill.readme-summary")?.title).toBe(
        "README Summary",
      );
      runtime.sessionStore.close();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("creates mempalace-aware runtime helpers when optional mode is enabled", () => {
    const memory = createDefaultRuntimeMemory({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
      },
    });
    const probe = createRuntimeDoctorMempalaceProbe({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
      },
    });

    expect("probeMempalaceHealth" in memory).toBe(true);
    expect(probe()).toMatchObject({
      status: "warn",
      mode: "optional",
      configured: false,
      reachable: false,
    });
  });

  test("preserves mempalace retrieval metadata in working-memory recall items", () => {
    const memory = createDefaultRuntimeMemory({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
        HOTFLOW_MEMPALACE_COMMAND: "node",
        HOTFLOW_MEMPALACE_PALACE_PATH: "/repo/palace",
      },
      runCommand: () => ({
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          results: [
            {
              id: "seedance-note",
              content: "Seedance 2.0 latest workflow summary.",
              text: "Seedance 2.0 latest workflow keeps one scene per shot.",
              verbatim:
                "Seedance 2.0 latest workflow keeps one scene per shot.\nScene prompts stay per shot.",
              similarity: 0.88,
              wing: "research",
              room: "seedance",
              matched_via: "drawer+closet",
              bm25_score: 0.62,
              distance: 0.2,
              effective_distance: 0.08,
              closet_boost: 0.12,
              drawer_index: 2,
              total_drawers: 5,
              memory_layer: "L3",
              source_file: "seedance.md",
            },
          ],
        }),
        stderr: "",
        timedOut: false,
      }),
      now: () => 1_777_000,
    });

    const block = memory.recallWorkingMemory({
      blockId: "runtime-memory",
      scope: { sessionId: "desktop:workbench" },
      query: "seedance 最新经验",
      limit: 2,
    });

    expect(block.items[0]).toMatchObject({
      id: "mempalace:seedance-note",
      metadata: {
        source: "mempalace",
        retrievalEngine: "mempalace",
        matchMode: "drawer+closet",
        vectorSimilarity: 0.88,
        bm25Score: 0.62,
        distance: 0.2,
        effectiveDistance: 0.08,
        closetBoost: 0.12,
        drawerIndex: 2,
        totalDrawers: 5,
        wing: "research",
        room: "seedance",
        sourceFile: "seedance.md",
        memoryLayer: "L3",
        layerLabel: "L3 Deep Search",
        verbatim:
          "Seedance 2.0 latest workflow keeps one scene per shot.\nScene prompts stay per shot.",
        drawerContent:
          "Seedance 2.0 latest workflow keeps one scene per shot.\nScene prompts stay per shot.",
        query: "seedance 最新经验",
        provenance: {
          engine: "mempalace",
          sourceFile: "seedance.md",
          wing: "research",
          room: "seedance",
          drawerIndex: 2,
          totalDrawers: 5,
          memoryLayer: "L3",
        },
      },
    });
  });

  test("uses mempalace as the primary long-term recall backend when primary mode is enabled", () => {
    const memory = createDefaultRuntimeMemory({
      env: {
        HOTFLOW_MEMPALACE_MODE: "primary",
        HOTFLOW_MEMPALACE_COMMAND: "node",
        HOTFLOW_MEMPALACE_PALACE_PATH: "/repo/palace",
      },
      runCommand: () => ({
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          results: [
            {
              id: "primary-seedance-note",
              text: "Use the newest Seedance notes from verified sources.",
              similarity: 0.91,
              matched_via: "drawer+closet",
              source_file: "seedance-primary.md",
            },
          ],
        }),
        stderr: "",
        timedOut: false,
      }),
      now: () => 1_777_001,
    });
    memory.writeLayer1({
      id: "local-older-note",
      content: "Older local Seedance note.",
      scope: { sessionId: "desktop:workbench" },
      timestamp: 1,
    });

    const block = memory.recallWorkingMemory({
      blockId: "runtime-memory",
      scope: { sessionId: "desktop:workbench" },
      query: "seedance 最新经验",
      limit: 2,
    });

    expect(block.degraded).toBeUndefined();
    expect(block.items.map((item) => item.id)).toEqual([
      "mempalace:primary-seedance-note",
      "local-older-note",
    ]);
    expect(block.items[0]?.metadata).toMatchObject({
      source: "mempalace",
      memoryBackend: "mempalace",
      memoryBackendMode: "primary",
      retrievalEngine: "mempalace",
      matchMode: "drawer+closet",
      sourceFile: "seedance-primary.md",
    });
    expect(block.items[1]?.metadata).toMatchObject({
      source: "working-memory",
      memoryBackend: "local",
      memoryBackendMode: "primary-fallback",
    });
  });

  test("keeps local fallback visible when primary mempalace recall degrades", () => {
    const memory = createDefaultRuntimeMemory({
      env: {
        HOTFLOW_MEMPALACE_MODE: "primary",
        HOTFLOW_MEMPALACE_COMMAND: "node",
        HOTFLOW_MEMPALACE_PALACE_PATH: "/repo/palace",
      },
      runCommand: () => ({
        status: 1,
        signal: null,
        stdout: "",
        stderr: "search failed",
        timedOut: false,
      }),
    });
    memory.writeLayer1({
      id: "local-fallback-note",
      content: "Local fallback note for Seedance.",
      scope: { sessionId: "desktop:workbench" },
      timestamp: 1,
    });

    const block = memory.recallWorkingMemory({
      blockId: "runtime-memory",
      scope: { sessionId: "desktop:workbench" },
      query: "seedance 最新经验",
      limit: 2,
    });

    expect(block.degraded?.reason).toBe("mempalace-recall-degraded");
    expect(block.items[0]).toMatchObject({
      id: "local-fallback-note",
      metadata: {
        source: "working-memory",
        memoryBackend: "local",
        memoryBackendMode: "primary-fallback",
      },
    });
  });

  test("wires runtime dispatcher with managed tool journal closure", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-runtime-bootstrap-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    const sessionDbPath = join(dataDir, "sessions", "runtime.sqlite");

    try {
      const runtime = bootstrapRuntime({
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: dataDir,
          HOTFLOW_SESSION_DB_PATH: sessionDbPath,
        },
        registerProviders(registry) {
          registry.register(new FakeModelProvider({ id: "fake-live" }));
          return ["fake-live"];
        },
        createTelemetry() {
          return { scope: "test" };
        },
        createControlPlane() {
          return { dispatch() {} };
        },
      });

      const createDispatcher = Reflect.get(runtime.engine, "createDispatcher") as (
        board: TaskBoard,
      ) => { managesJournalClosure?: boolean };
      const dispatcher = createDispatcher(new TaskBoard());

      expect(dispatcher.managesJournalClosure).toBe(true);
      runtime.sessionStore.close();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("creates a reusable runtime tool registry with toolset-aware schema surface", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-runtime-bootstrap-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    const sessionDbPath = join(dataDir, "sessions", "runtime.sqlite");

    try {
      const runtime = bootstrapRuntime({
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: dataDir,
          HOTFLOW_SESSION_DB_PATH: sessionDbPath,
        },
        registerProviders(registry) {
          registry.register(new FakeModelProvider({ id: "fake-live" }));
          return ["fake-live"];
        },
        createTelemetry() {
          return { scope: "test" };
        },
        createControlPlane() {
          return { dispatch() {} };
        },
      });

      const registry = createDefaultRuntimeToolRegistry({
        board: new TaskBoard(),
        config: runtime.config,
        pluginRegistrar: runtime.pluginRegistrar,
      });

      expect(registry.listToolsets()).toEqual([
        {
          name: "filesystem",
          description: "Workspace-scoped file reading tools.",
          tools: ["filesystem.read_text"],
          enabledByDefault: true,
        },
        {
          name: "tasks",
          description: "Task board mutation tools.",
          tools: ["tasks.todo_write"],
          enabledByDefault: true,
        },
      ]);
      expect(registry.getSchemas().map((entry) => entry.name)).toEqual([
        "filesystem.read_text",
        "tasks.todo_write",
      ]);
      runtime.sessionStore.close();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

class CapturingModelProvider implements ModelProvider {
  readonly id = "capture-context";
  lastRequest: ModelRequest | undefined;

  async generate(request: ModelRequest): Promise<ModelGenerateResult> {
    this.lastRequest = request;
    return {
      text: "captured",
      finishReason: "stop",
    };
  }

  async *stream(): AsyncIterable<never> {}
}

describe("createDefaultRuntimePromptSections", () => {
  test("returns stable section ids and runtime-specific prompt content", () => {
    const sections = createDefaultRuntimePromptSections({
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
      outputStyle: "concise",
      permissionMode: "ask",
      responseLanguage: "follow-user",
      workspaceRoot: "/workspace/hotflow",
    });

    expect(sections.map((section) => section.id)).toEqual([...DEFAULT_RUNTIME_PROMPT_SECTION_IDS]);
    expect(sections.find((section) => section.id === "system.identity")?.content).toContain(
      "Director Angel",
    );
    expect(sections.find((section) => section.id === "system.director-role")?.content).toContain(
      "Act like a director",
    );
    expect(
      sections.find((section) => section.id === "system.execution-boundary")?.content,
    ).toContain("worker-only path");
    expect(sections.find((section) => section.id === "system.runtime")?.content).toContain(
      "- Provider: scripted",
    );
    expect(sections.find((section) => section.id === "system.runtime")?.content).toContain(
      "Runtime shell:",
    );
    expect(sections.find((section) => section.id === "system.runtime")?.content).not.toContain(
      "- Permission mode: ask",
    );
    expect(sections.find((section) => section.id === "system.runtime")?.content).not.toContain(
      "- Response language: follow-user",
    );
    expect(sections.find((section) => section.id === "system.runtime")?.metadata).toBeUndefined();
    expect(sections.find((section) => section.id === "system.permission-mode")?.content).toContain(
      "Default permission mode: ask",
    );
    expect(sections.find((section) => section.id === "system.permission-mode")?.content).toContain(
      "Treat side-effectful tool actions as approval-gated",
    );
    expect(
      sections.find((section) => section.id === "system.permission-mode")?.metadata,
    ).toMatchObject({
      permissionMode: "ask",
      source: "runtime-default",
    });
    expect(
      sections.find((section) => section.id === "system.response-language")?.content,
    ).toContain("Default response language: follow-user");
    expect(
      sections.find((section) => section.id === "system.response-language")?.content,
    ).toContain(
      "Default response language policy: follow the user's language unless session guidance overrides this turn.",
    );
    expect(
      sections.find((section) => section.id === "system.response-language")?.content,
    ).toContain("Apply this default only when no session override is active");
    expect(
      sections.find((section) => section.id === "system.response-language")?.metadata,
    ).toMatchObject({
      responseLanguage: "follow-user",
      source: "runtime-default",
    });
    expect(sections.find((section) => section.id === "system.output-style")?.content).toContain(
      "Current output style: concise",
    );
    expect(
      sections.find((section) => section.id === "system.output-style")?.metadata,
    ).toMatchObject({
      outputStyle: "concise",
      source: "runtime-default",
    });
  });

  test("assembles a director-anchored static prompt boundary", () => {
    const assembler = createDefaultRuntimeContextAssembler({
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
      outputStyle: "balanced",
      permissionMode: "ask",
      responseLanguage: "follow-user",
      workspaceRoot: "/workspace/hotflow",
    });

    const assembled = assembler.build({ tokenBudget: 4_000 });

    expect(assembled.cacheBoundary.staticSections.map((section) => section.id)).toEqual([
      ...DEFAULT_RUNTIME_PROMPT_SECTION_IDS,
    ]);
    expect(assembled.cacheBoundary.staticPrompt).toContain("Director Angel");
    expect(assembled.cacheBoundary.staticPrompt).toContain("Act like a director");
    expect(assembled.cacheBoundary.staticPrompt).toContain("worker-only path");
    expect(assembled.cacheBoundary.staticPrompt).toContain("Runtime shell:");
    expect(assembled.cacheBoundary.staticPrompt).toContain("Default permission mode: ask");
    expect(assembled.cacheBoundary.staticPrompt).toContain(
      "Default response language: follow-user",
    );
    expect(assembled.cacheBoundary.staticPrompt).toContain(
      "Default response language policy: follow the user's language unless session guidance overrides this turn.",
    );
    expect(assembled.cacheBoundary.staticPrompt).not.toContain("- Response language: follow-user");
  });

  test("protects all default static runtime prompt sections from overwrite", () => {
    const registry = createDefaultRuntimePromptRegistry({
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
      outputStyle: "balanced",
      permissionMode: "ask",
      responseLanguage: "follow-user",
      workspaceRoot: "/workspace/hotflow",
    });

    expect(() =>
      registry.upsert({
        id: "system.execution-boundary",
        cacheBucket: "static",
        owner: "system",
        content: "override",
      }),
    ).toThrow("Protected static section cannot be overwritten: system.execution-boundary");
  });
});
