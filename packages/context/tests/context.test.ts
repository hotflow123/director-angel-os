import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RUNTIME_PROMPT_SECTION_CONTRIBUTORS,
  DEFAULT_TURN_STATE_PROMPT_SECTION_CONTRIBUTORS,
  DynamicContextAssembler,
  MultiStepTurnContext,
  PromptSectionRegistry,
  applyTokenBudget,
  compactDynamicSections,
  createRuntimeDegradationGuidanceSections,
  createRuntimePromptSections,
  createSessionGuidanceSections,
  createSessionLatestTurnGuidanceSections,
  createToolRuntimeGuidanceSections,
  createTurnResumeGuidanceSections,
  readSessionLatestTurnPromptState,
  readSessionPromptPreferences,
  renderTaskStatePrompt,
  resolveWorkingMemoryPromptState,
  splitCacheBoundary,
} from "../src/index.js";

describe("PromptSectionRegistry", () => {
  it("registers and clears dynamic sections", () => {
    const registry = new PromptSectionRegistry();
    registry.register({
      id: "system.core",
      content: "core instructions",
      cacheBucket: "static",
    });
    registry.register({
      id: "session.memory",
      content: "memory snapshot",
      cacheBucket: "dynamic",
    });

    registry.clearDynamic();

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("system.core")).toBeDefined();
    expect(registry.get("session.memory")).toBeUndefined();
  });

  it("blocks overwriting protected static sections", () => {
    const registry = new PromptSectionRegistry();
    registry.register({
      id: "system",
      content: "core instructions",
      cacheBucket: "static",
    });

    expect(() =>
      registry.upsert({
        id: "system",
        content: "mutated system prompt",
        cacheBucket: "static",
      }),
    ).toThrow("Protected static section cannot be overwritten: system");
  });

  it("supports custom protected static section ids", () => {
    const registry = new PromptSectionRegistry({
      protectedStaticSectionIds: ["system.identity"],
    });
    registry.register({
      id: "system.identity",
      content: "identity instructions",
      cacheBucket: "static",
    });

    expect(() =>
      registry.upsert({
        id: "system.identity",
        content: "override attempt",
        cacheBucket: "static",
      }),
    ).toThrow("Protected static section cannot be overwritten: system.identity");
  });
});

describe("token budget helpers", () => {
  it("includes higher priority sections first", () => {
    const budgeted = applyTokenBudget(
      [
        { id: "a", content: "low", cacheBucket: "dynamic", tokenCost: 3, priority: 0 },
        { id: "b", content: "high", cacheBucket: "static", tokenCost: 4, priority: 10 },
        { id: "c", content: "middle", cacheBucket: "dynamic", tokenCost: 2, priority: 5 },
      ],
      6,
    );

    expect(budgeted.included.map((section) => section.id)).toEqual(["b", "c"]);
    expect(budgeted.omitted.map((section) => section.id)).toEqual(["a"]);
    expect(budgeted.usedTokens).toBe(6);
    expect(budgeted.remainingTokens).toBe(0);
  });

  it("splits static and dynamic cache boundaries", () => {
    const split = splitCacheBoundary([
      { id: "system", content: "sys", cacheBucket: "static" },
      { id: "session", content: "dyn", cacheBucket: "dynamic" },
    ]);

    expect(split.staticSections.map((section) => section.id)).toEqual(["system"]);
    expect(split.dynamicSections.map((section) => section.id)).toEqual(["session"]);
    expect(split.staticPrompt).toContain("## system");
    expect(split.dynamicPrompt).toContain("## session");
  });
});

describe("DynamicContextAssembler", () => {
  it("builds prompt from registry and per-turn dynamic sections", () => {
    const registry = new PromptSectionRegistry();
    registry.register({
      id: "system.base",
      content: "base policy",
      cacheBucket: "static",
      tokenCost: 3,
    });
    registry.register({
      id: "session.history",
      content: "turn history",
      cacheBucket: "dynamic",
      tokenCost: 3,
    });

    const assembler = new DynamicContextAssembler(registry);
    const assembled = assembler.build({
      tokenBudget: 8,
      dynamicSections: [
        {
          id: "tool.latest",
          content: "tool output",
          cacheBucket: "dynamic",
          tokenCost: 2,
          priority: 20,
        },
      ],
    });

    expect(assembled.cacheBoundary.staticSections.map((section) => section.id)).toEqual([
      "system.base",
    ]);
    expect(assembled.cacheBoundary.dynamicSections.map((section) => section.id)).toEqual([
      "tool.latest",
      "session.history",
    ]);
    expect(assembled.prompt).toContain("## system.base");
    expect(assembled.prompt).toContain("## tool.latest");
    expect(assembled.budget.omitted).toHaveLength(0);
  });

  it("does not allow dynamic sections to override static prompt sections", () => {
    const registry = new PromptSectionRegistry();
    registry.register({
      id: "system",
      content: "trusted system prompt",
      cacheBucket: "static",
      tokenCost: 2,
    });

    const assembler = new DynamicContextAssembler(registry);
    const assembled = assembler.build({
      tokenBudget: 32,
      dynamicSections: [
        {
          id: "system",
          content: "plugin override attempt",
          cacheBucket: "dynamic",
          tokenCost: 2,
          priority: 999,
        },
      ],
    });

    expect(assembled.cacheBoundary.staticSections.map((section) => section.id)).toEqual(["system"]);
    expect(assembled.cacheBoundary.dynamicSections.map((section) => section.id)).toEqual([]);
    expect(assembled.cacheBoundary.staticPrompt).toContain("trusted system prompt");
    expect(assembled.prompt).not.toContain("plugin override attempt");
  });
});

describe("session guidance helpers", () => {
  it("reads prompt preferences from session metadata", () => {
    expect(
      readSessionPromptPreferences({
        preferences: {
          outputStyle: "verbose",
          permissionMode: "ask",
          responseLanguage: "zh-CN",
        },
      }),
    ).toEqual({
      outputStyle: "verbose",
      permissionMode: "ask",
      responseLanguage: "zh-CN",
    });
  });

  it("creates dynamic prompt sections for session-specific preferences", () => {
    const sections = createSessionGuidanceSections({
      preferences: {
        outputStyle: "concise",
        permissionMode: "deny",
        responseLanguage: "zh-CN",
      },
    });

    expect(sections.map((section) => section.id)).toEqual([
      "session.output-style",
      "session.permission-mode",
      "session.response-language",
    ]);
    expect(sections[0]?.content).toContain("Output style: concise");
    expect(sections[0]?.content).toContain("Keep the answer brief");
    expect(sections[0]?.metadata).toMatchObject({
      outputStyle: "concise",
      source: "session-override",
    });
    expect(sections[1]?.content).toContain("Permission mode: deny");
    expect(sections[1]?.content).toContain("Do not attempt side-effectful tool actions");
    expect(sections[1]?.metadata).toMatchObject({
      permissionMode: "deny",
      source: "session-override",
    });
    expect(sections[2]?.content).toContain("Response language: zh-CN");
    expect(sections[2]?.content).toContain("Respond in zh-CN");
    expect(sections[2]?.metadata).toMatchObject({
      responseLanguage: "zh-CN",
      source: "session-override",
    });
  });

  it("creates dynamic prompt sections for resumed turns", () => {
    const sections = createTurnResumeGuidanceSections({
      resumed: true,
      resumeAction: "start-next-step",
      nextStepIndex: 2,
      replayWindow: {
        fromSeqExclusive: 4,
        toSeqInclusive: 9,
      },
      recoveredToolResults: 1,
      lastStepEventType: "step.tool_result",
    });

    expect(sections.map((section) => section.id)).toEqual(["runtime.turn-resume"]);
    expect(sections[0]?.content).toContain("Resume action: start-next-step");
    expect(sections[0]?.content).toContain("Next step index: 2");
    expect(sections[0]?.content).toContain("Replay window: seq>4..9");
    expect(sections[0]?.content).toContain("Recovered tool results: 1");
    expect(sections[0]?.content).toContain("Last step event: step.tool_result");
    expect(sections[0]?.content).toContain("reuse them before planning duplicate calls");
  });

  it("reads latest turn prompt state from session metadata", () => {
    expect(
      readSessionLatestTurnPromptState({
        runtime: {
          latestTurn: {
            turnId: "turn-42",
            runtimeStatus: "degraded",
            turnBranch: "tool-degraded",
            finishReason: "length",
            completedSteps: 4,
            lastStepEventType: "step.tool_result",
            resumeAction: "start-next-step",
            nextStepIndex: 4,
            toolCount: 1,
            toolOutcomes: {
              total: 1,
              executed: 0,
              denied: 0,
              approvalRequired: 0,
              degraded: 1,
              failed: 0,
              missing: 0,
              unknown: 0,
            },
            reasoning: {
              strategy: "plan-execute",
              confidence: 0.9,
              rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
              suggestedAction: "tool",
            },
            toolRuntimeGuidance: {
              status: "degraded",
              impactedTools: 1,
              previewedTools: 1,
              toolPreview: "filesystem.read_text:missing",
              metaImpactedTools: 1,
              metaPreviewedTools: 1,
              toolMetaPreview: "filesystem.read_text[availability=missing-env,env=OPENAI_API_KEY]",
            },
            runtimeDegradationSummaries: [
              "budget trim [warn]",
              "tool replay trim (filesystem.read_text) [warn]",
            ],
          },
        },
      }),
    ).toEqual({
      turnId: "turn-42",
      runtimeStatus: "degraded",
      turnBranch: "tool-degraded",
      finishReason: "length",
      completedSteps: 4,
      lastStepEventType: "step.tool_result",
      resumeAction: "start-next-step",
      nextStepIndex: 4,
      toolCount: 1,
      toolOutcomes: {
        total: 1,
        executed: 0,
        denied: 0,
        approvalRequired: 0,
        degraded: 1,
        failed: 0,
        missing: 0,
        unknown: 0,
      },
      reasoning: {
        strategy: "plan-execute",
        confidence: 0.9,
        rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
        suggestedAction: "tool",
      },
      toolRuntimeGuidance: {
        status: "degraded",
        impactedTools: 1,
        previewedTools: 1,
        toolPreview: "filesystem.read_text:missing",
        metaImpactedTools: 1,
        metaPreviewedTools: 1,
        toolMetaPreview: "filesystem.read_text[availability=missing-env,env=OPENAI_API_KEY]",
      },
      runtimeDegradationSummaries: [
        "budget trim [warn]",
        "tool replay trim (filesystem.read_text) [warn]",
      ],
    });
  });

  it("creates dynamic prompt sections for latest known turn state", () => {
    const sections = createSessionLatestTurnGuidanceSections({
      runtime: {
        latestTurn: {
          turnId: "turn-42",
          runtimeStatus: "blocked",
          turnBranch: "approval-required",
          finishReason: "stop",
          completedSteps: 1,
          lastStepEventType: "step.final_output",
          toolCount: 1,
          toolOutcomes: {
            total: 1,
            executed: 0,
            denied: 0,
            approvalRequired: 1,
            degraded: 0,
            failed: 0,
            missing: 0,
            unknown: 0,
          },
          reasoning: {
            strategy: "plan-execute",
            confidence: 1,
            rationale: "forceStrategy was provided by caller",
            suggestedAction: "model",
          },
          toolRuntimeGuidance: {
            status: "blocked",
            impactedTools: 2,
            previewedTools: 2,
            toolPreview: "filesystem.read_text:missing|tasks.todo_write:approval_required",
            metaImpactedTools: 2,
            metaPreviewedTools: 2,
            toolMetaPreview:
              "filesystem.read_text[availability=missing-env,env=OPENAI_API_KEY]|tasks.todo_write[approval=pending]",
          },
          runtimeDegradationSummaries: [
            "budget trim [warn]",
            "tool replay trim (filesystem.read_text) [warn]",
          ],
        },
      },
    });

    expect(sections.map((section) => section.id)).toEqual(["session.latest-turn"]);
    expect(sections[0]?.content).toContain("Turn ID: turn-42");
    expect(sections[0]?.content).toContain("Runtime status: blocked");
    expect(sections[0]?.content).toContain("Turn branch: approval-required");
    expect(sections[0]?.content).toContain("Finish reason: stop");
    expect(sections[0]?.content).toContain("Completed steps: 1");
    expect(sections[0]?.content).toContain("Last step event: step.final_output");
    expect(sections[0]?.content).toContain("Tool count: 1");
    expect(sections[0]?.content).toContain(
      "Tool outcomes: executed=0, denied=0, approval_required=1, degraded=0, failed=0, missing=0, unknown=0",
    );
    expect(sections[0]?.content).toContain("Latest reasoning strategy: plan-execute");
    expect(sections[0]?.content).toContain("Latest reasoning confidence: 1");
    expect(sections[0]?.content).toContain(
      "Latest reasoning rationale: forceStrategy was provided by caller",
    );
    expect(sections[0]?.content).toContain("Latest suggested reasoning action: model");
    expect(sections[0]?.content).toContain(
      "Latest tool runtime guidance: blocked (2 impacted tools)",
    );
    expect(sections[0]?.content).toContain(
      "Latest tool runtime details: filesystem.read_text: missing, tasks.todo_write: approval required",
    );
    expect(sections[0]?.content).toContain(
      "Latest tool runtime metadata: filesystem.read_text [availability=missing-env,env=OPENAI_API_KEY], tasks.todo_write [approval=pending]",
    );
    expect(sections[0]?.content).toContain(
      "Latest prompt degradations: budget trim [warn], tool replay trim (filesystem.read_text) [warn]",
    );
    expect(sections[0]?.content).toContain(
      "Unfinished work: Surface the blocked action plus the required approval or policy change before retrying anything.",
    );
    expect(sections[0]?.content).toContain("The last turn was blocked by approval or policy");
    expect(sections[0]?.metadata).toMatchObject({
      reasoningStrategy: "plan-execute",
      reasoningConfidence: 1,
      reasoningRationale: "forceStrategy was provided by caller",
      reasoningSuggestedAction: "model",
    });
  });

  it("does not inject latest turn guidance when it points to the current turn", () => {
    const sections = createSessionLatestTurnGuidanceSections(
      {
        runtime: {
          latestTurn: {
            turnId: "turn-current",
            runtimeStatus: "degraded",
            turnBranch: "tool-degraded",
          },
        },
      },
      {
        currentTurnId: "turn-current",
      },
    );

    expect(sections).toEqual([]);
  });

  it("uses step-budget guidance when the latest turn ended by length", () => {
    const sections = createSessionLatestTurnGuidanceSections({
      runtime: {
        latestTurn: {
          turnId: "turn-budget",
          runtimeStatus: "healthy",
          turnBranch: "normal",
          finishReason: "length",
          completedSteps: 4,
          lastStepEventType: "step.tool_result",
          resumeAction: "start-next-step",
          nextStepIndex: 4,
        },
      },
    });

    expect(sections[0]?.content).toContain("Finish reason: length");
    expect(sections[0]?.content).toContain("Completed steps: 4");
    expect(sections[0]?.content).toContain("Last step event: step.tool_result");
    expect(sections[0]?.content).toContain("Suggested resume action: start-next-step");
    expect(sections[0]?.content).toContain("Suggested next step index: 4");
    expect(sections[0]?.content).toContain(
      "Unfinished work: Start at step 4 and turn the recorded tool results into the next reasoning/output step before planning duplicate tool calls.",
    );
    expect(sections[0]?.content).toContain("Continue from step 4 using those results");
  });

  it("uses failure resume guidance when the latest turn failed mid-step", () => {
    const sections = createSessionLatestTurnGuidanceSections({
      runtime: {
        latestTurn: {
          turnId: "turn-failed",
          runtimeStatus: "failed",
          turnBranch: "model-runtime-failed",
          finishReason: "failed",
          lastStepEventType: "step.context_built",
          resumeAction: "continue-current-step",
          nextStepIndex: 0,
        },
      },
    });

    expect(sections[0]?.content).toContain("Finish reason: failed");
    expect(sections[0]?.content).toContain("Last step event: step.context_built");
    expect(sections[0]?.content).toContain("Suggested resume action: continue-current-step");
    expect(sections[0]?.content).toContain("Suggested next step index: 0");
    expect(sections[0]?.content).toContain(
      "Unfinished work: Rebuild step 0 from confirmed state and treat the interrupted step as incomplete until it succeeds.",
    );
    expect(sections[0]?.content).toContain("Resume from step 0");
  });

  it("creates runtime degradation guidance sections", () => {
    const sections = createRuntimeDegradationGuidanceSections([
      {
        stage: "runtime",
        category: "memory",
        action: "degrade",
        severity: "minor",
        reason: "fallback",
        message: "recall backend timeout",
        recoverable: true,
      },
    ]);

    expect(sections.map((section) => section.id)).toEqual(["runtime.degradations"]);
    expect(sections[0]?.content).toContain("category=memory");
    expect(sections[0]?.content).toContain("message=recall backend timeout");
    expect(sections[0]?.content).toContain("Memory recall may be partial or skipped");
  });

  it("includes replay trim metadata in runtime degradation guidance sections", () => {
    const sections = createRuntimeDegradationGuidanceSections([
      {
        stage: "runtime",
        category: "runtime",
        action: "degrade",
        severity: "minor",
        reason: "context-pressure",
        message:
          'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
        recoverable: true,
        metadata: {
          toolName: "filesystem.read_text",
          toolCallId: "call-1",
          replayChars: 512,
          originalChars: 4096,
        },
      },
    ]);

    expect(sections[0]?.content).toContain("reason=context-pressure");
    expect(sections[0]?.content).toContain("metadata=toolName=filesystem.read_text");
    expect(sections[0]?.content).toContain("toolCallId=call-1");
    expect(sections[0]?.content).toContain("replayChars=512");
    expect(sections[0]?.content).toContain("originalChars=4096");
    expect(sections[0]?.content).toContain("Some tool result replay was truncated to fit context.");
  });

  it("creates tool runtime guidance sections for degraded observations", () => {
    const sections = createToolRuntimeGuidanceSections([
      {
        toolName: "degraded_tool",
        ok: true,
        resolution: "degraded",
        metadataPreview: {
          timeout: "1200ms",
          degraded: "filesystem.write",
        },
        degradation: {
          stage: "tool",
          category: "tool",
          action: "degrade",
          severity: "minor",
          reason: "fallback",
          message: "fallback response",
          recoverable: true,
        },
      },
    ]);

    expect(sections.map((section) => section.id)).toEqual(["runtime.tool-status"]);
    expect(sections[0]?.content).toContain("Current tool runtime status: degraded");
    expect(sections[0]?.content).toContain("tool=degraded_tool");
    expect(sections[0]?.content).toContain("reason=fallback response");
    expect(sections[0]?.content).toContain("metadata=timeout=1200ms,degraded=filesystem.write");
    expect(sections[0]?.content).toContain("Treat degraded tool outputs as partial evidence");
    expect(sections[0]?.metadata).toMatchObject({
      impactedTools: 1,
      status: "degraded",
      previewedTools: 1,
      toolPreview: "degraded_tool:degraded",
      metaImpactedTools: 1,
      metaPreviewedTools: 1,
      toolMetaPreview: "degraded_tool[timeout=1200ms,degraded=filesystem.write]",
    });
  });

  it("assembles runtime prompt sections in stable guidance order", () => {
    const sections = createRuntimePromptSections({
      sessionMetadata: {
        preferences: {
          outputStyle: "concise",
        },
        runtime: {
          latestTurn: {
            turnId: "turn-prev",
            runtimeStatus: "degraded",
            turnBranch: "tool-degraded",
          },
        },
      },
      currentTurnId: "turn-current",
      turnResumeState: {
        resumed: true,
        resumeAction: "continue-current-step",
        nextStepIndex: 1,
      },
      runtimeDegradations: [
        {
          stage: "runtime",
          category: "memory",
          action: "degrade",
          severity: "minor",
          reason: "fallback",
          recoverable: true,
        },
      ],
      toolObservations: [
        {
          toolName: "degraded_tool",
          ok: true,
          resolution: "degraded",
          degradation: {
            stage: "tool",
            category: "tool",
            action: "degrade",
            severity: "minor",
            reason: "fallback",
            recoverable: true,
          },
        },
      ],
      extraSections: [
        {
          id: "skill.match",
          cacheBucket: "dynamic",
          owner: "skill",
          content: "Matched one skill section",
        },
      ],
    });

    expect(sections.map((section) => section.id)).toEqual([
      "runtime.turn-resume",
      "runtime.degradations",
      "session.output-style",
      "session.latest-turn",
      "runtime.tool-status",
      "skill.match",
    ]);
  });

  it("exposes default runtime prompt contributors in stable order", () => {
    expect(
      DEFAULT_RUNTIME_PROMPT_SECTION_CONTRIBUTORS.map((contributor) => contributor.id),
    ).toEqual([
      "runtime.turn-resume",
      "runtime.degradations",
      "session.output-style",
      "session.permission-mode",
      "session.response-language",
      "session.latest-turn",
      "runtime.tool-status",
    ]);
  });

  it("exposes default turn-state prompt contributors in stable order", () => {
    expect(
      DEFAULT_TURN_STATE_PROMPT_SECTION_CONTRIBUTORS.map((contributor) => contributor.id),
    ).toEqual(["turn.user-input", "turn.tool-results", "turn.task-state", "turn.recall"]);
  });

  it("resolves prompt section contributors through the turn context cache", () => {
    const turnContext = new MultiStepTurnContext();
    const contributor = {
      id: "skills.approved-index",
      resolveFingerprint: vi.fn(({ userInput }: { userInput?: string }) => userInput ?? "none"),
      buildSections: vi.fn(() => [
        {
          id: "skill.match",
          cacheBucket: "dynamic" as const,
          owner: "skill" as const,
          content: "Matched one skill section",
        },
      ]),
    };

    const first = createRuntimePromptSections({
      sessionMetadata: {},
      turnContext,
      contributors: [contributor],
      contributorInput: {
        userInput: "continue beta",
      },
    });
    const second = createRuntimePromptSections({
      sessionMetadata: {},
      turnContext,
      contributors: [contributor],
      contributorInput: {
        userInput: "continue beta",
      },
    });
    const third = createRuntimePromptSections({
      sessionMetadata: {},
      turnContext,
      contributors: [contributor],
      contributorInput: {
        userInput: "continue gamma",
      },
    });

    expect(first.map((section) => section.id)).toEqual(["skill.match"]);
    expect(second.map((section) => section.id)).toEqual(["skill.match"]);
    expect(third.map((section) => section.id)).toEqual(["skill.match"]);
    expect(contributor.resolveFingerprint).toHaveBeenCalledTimes(3);
    expect(contributor.buildSections).toHaveBeenCalledTimes(2);
  });

  it("invalidates runtime degradation contributor cache when replay metadata changes", () => {
    const turnContext = new MultiStepTurnContext();

    const first = createRuntimePromptSections({
      sessionMetadata: {},
      turnContext,
      runtimeDegradations: [
        {
          stage: "runtime",
          category: "runtime",
          action: "degrade",
          severity: "minor",
          reason: "context-pressure",
          message:
            'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
          recoverable: true,
          metadata: {
            toolName: "filesystem.read_text",
            replayChars: 512,
            originalChars: 4096,
          },
        },
      ],
    });
    const second = createRuntimePromptSections({
      sessionMetadata: {},
      turnContext,
      runtimeDegradations: [
        {
          stage: "runtime",
          category: "runtime",
          action: "degrade",
          severity: "minor",
          reason: "context-pressure",
          message:
            'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
          recoverable: true,
          metadata: {
            toolName: "filesystem.read_text",
            replayChars: 640,
            originalChars: 4096,
          },
        },
      ],
    });

    expect(first[0]?.id).toBe("runtime.degradations");
    expect(second[0]?.id).toBe("runtime.degradations");
    expect(first[0]?.content).toContain("replayChars=512");
    expect(second[0]?.content).toContain("replayChars=640");
    expect(second[0]?.content).not.toBe(first[0]?.content);
  });

  it("invalidates tool runtime contributor cache when metadata preview changes", () => {
    const turnContext = new MultiStepTurnContext();

    const first = createRuntimePromptSections({
      sessionMetadata: {},
      turnContext,
      toolObservations: [
        {
          toolName: "filesystem.read_text",
          ok: false,
          resolution: "missing",
          metadataPreview: {
            availability: "missing-env",
            env: "OPENAI_API_KEY",
          },
        },
      ],
    });
    const second = createRuntimePromptSections({
      sessionMetadata: {},
      turnContext,
      toolObservations: [
        {
          toolName: "filesystem.read_text",
          ok: false,
          resolution: "missing",
          metadataPreview: {
            availability: "missing-env",
            env: "HOTFLOW_TOKEN",
          },
        },
      ],
    });

    expect(first[0]?.id).toBe("runtime.tool-status");
    expect(second[0]?.id).toBe("runtime.tool-status");
    expect(first[0]?.content).toContain("env=OPENAI_API_KEY");
    expect(second[0]?.content).toContain("env=HOTFLOW_TOKEN");
    expect(second[0]?.content).not.toBe(first[0]?.content);
  });

  it("renders task-state prompt content from task items", () => {
    expect(
      renderTaskStatePrompt({
        items: [
          {
            id: "todo_1",
            content: "Ship beta",
            status: "todo",
          },
        ],
      }),
    ).toBe("Current todo list:\n1. [todo] Ship beta");
    expect(renderTaskStatePrompt({ items: [] })).toBeUndefined();
  });

  it("resolves working-memory recall block and degrade surfaces for prompt assembly", () => {
    const state = resolveWorkingMemoryPromptState({
      recallWorkingMemory: () => ({
        blockId: "working-memory",
        source: "working-memory",
        scope: { sessionId: "session-test" },
        items: [
          {
            id: "l0_1",
            layer: "layer0",
            content: "User already approved the beta outline",
            score: 0.91,
            updatedAt: 1,
          },
        ],
        degraded: {
          reason: "memory-timeout",
          message: "secondary recall skipped",
        },
      }),
      options: {
        blockId: "working-memory",
        scope: { sessionId: "session-test" },
        query: "continue beta rollout",
      },
    });

    expect(state.recallBlock?.blockId).toBe("working-memory");
    expect(state.runtimeDegradations).toHaveLength(1);
    expect(state.runtimeDegradations[0]?.message).toBe("secondary recall skipped");
  });

  it("degrades working-memory recall exceptions into runtime surfaces", () => {
    const state = resolveWorkingMemoryPromptState({
      recallWorkingMemory: () => {
        throw new Error("recall backend timeout");
      },
      options: {
        blockId: "working-memory",
        scope: { sessionId: "session-test" },
        query: "continue beta rollout",
      },
    });

    expect(state.recallBlock).toBeUndefined();
    expect(state.runtimeDegradations).toHaveLength(1);
    expect(state.runtimeDegradations[0]?.message).toContain("recall backend timeout");
  });
});

describe("MultiStepTurnContext", () => {
  it("rebuilds dynamic context repeatedly as turn state evolves", () => {
    const registry = new PromptSectionRegistry();
    registry.register({
      id: "system.base",
      content: "base policy",
      cacheBucket: "static",
      tokenCost: 3,
    });

    const turnContext = new MultiStepTurnContext(new DynamicContextAssembler(registry));
    turnContext.setUserInput("Plan the rollout");

    const first = turnContext.rebuild({ tokenBudget: 32 });
    expect(first.cacheBoundary.dynamicSections.map((section) => section.id)).toEqual([
      "user-input",
    ]);

    turnContext.appendToolResult({
      toolName: "tasks.todo_write",
      ok: true,
      output: { items: ["Ship alpha"] },
    });
    turnContext.setTaskState("Current todo list:\n1. [todo] Ship alpha");
    turnContext.replaceRecall([
      {
        layer: "layer0",
        content: "User asked for 3 milestones",
        score: 0.91,
      },
    ]);

    const second = turnContext.rebuild({ tokenBudget: 64 });
    expect(second.cacheBoundary.dynamicSections.map((section) => section.id)).toEqual([
      "user-input",
      "tool-result-1",
      "task-state",
      "memory-recall-1",
    ]);
    expect(second.prompt).toContain("Tool: tasks.todo_write");
    expect(second.prompt).toContain("Current todo list:");
    expect(second.prompt).toContain("User asked for 3 milestones");
  });

  it("recomputes token budget with pluggable compaction", () => {
    const turnContext = new MultiStepTurnContext();
    turnContext.setUserInput("plan");
    turnContext.setCustomDynamicSections([
      { id: "dup", cacheBucket: "dynamic", content: "old", tokenCost: 2, priority: 60 },
      { id: "dup", cacheBucket: "dynamic", content: "new", tokenCost: 2, priority: 60 },
    ]);

    const compacted = turnContext.rebuild({
      tokenBudget: 3,
      compactor: compactDynamicSections,
    });
    expect(compacted.cacheBoundary.dynamicSections.map((section) => section.id)).toEqual([
      "user-input",
      "dup",
    ]);
    expect(compacted.cacheBoundary.dynamicSections[1]?.content).toBe("new");
  });

  it("accepts recall blocks and surfaces degraded recall state in dynamic sections", () => {
    const turnContext = new MultiStepTurnContext();
    turnContext.setUserInput("continue");
    turnContext.replaceRecallBlock({
      blockId: "working-memory",
      items: [
        {
          layer: "layer1",
          content: "Milestone 1 already drafted",
          score: 0.82,
        },
      ],
      degraded: {
        reason: "memory-timeout",
        message: "external recall skipped",
      },
    });

    const rebuilt = turnContext.rebuild({ tokenBudget: 64 });
    expect(rebuilt.cacheBoundary.dynamicSections.map((section) => section.id)).toEqual([
      "user-input",
      "working-memory.degraded",
      "working-memory.recall-1",
    ]);
    expect(rebuilt.prompt).toContain("Recall degraded: memory-timeout");
    expect(rebuilt.prompt).toContain("Milestone 1 already drafted");
  });

  it("records omitted sections when budget is tight", () => {
    const turnContext = new MultiStepTurnContext();
    turnContext.setUserInput("plan");
    turnContext.appendToolResult({
      toolName: "tasks.todo_write",
      ok: true,
      output: {
        items: [{ id: "todo_overflow", content: "a".repeat(400), status: "todo" }],
      },
    });

    const assembled = turnContext.rebuild({ tokenBudget: 2 });
    const lastBudget = turnContext.getLastBudget();

    expect(lastBudget).toBeDefined();
    expect(lastBudget?.omitted.some((section) => section.id.startsWith("tool-result"))).toBe(true);
    expect(assembled.budget.omitted).toEqual(lastBudget?.omitted);
  });

  it("replaces full turn state through a single context API", () => {
    const turnContext = new MultiStepTurnContext();

    turnContext.replaceState({
      userInput: "Continue the rollout",
      taskState: "Current todo list:\n1. [todo] Ship beta",
      toolResults: [
        {
          toolName: "tasks.todo_write",
          ok: true,
          output: {
            items: [{ id: "todo_beta", content: "Ship beta", status: "todo" }],
          },
        },
      ],
      recallBlock: {
        blockId: "working-memory",
        items: [
          {
            layer: "layer0",
            content: "Beta launch is the current milestone",
          },
        ],
      },
      customDynamicSections: [
        {
          id: "runtime.turn-resume",
          cacheBucket: "dynamic",
          owner: "runtime",
          content: "Resume step 1",
        },
      ],
    });

    const rebuilt = turnContext.rebuild({ tokenBudget: 64 });
    expect(rebuilt.cacheBoundary.dynamicSections.map((section) => section.id)).toEqual([
      "user-input",
      "tool-result-1",
      "task-state",
      "working-memory.recall-1",
      "runtime.turn-resume",
    ]);
    expect(rebuilt.prompt).toContain("Continue the rollout");
    expect(rebuilt.prompt).toContain("Ship beta");
    expect(rebuilt.prompt).toContain("Beta launch is the current milestone");
    expect(rebuilt.prompt).toContain("Resume step 1");
  });

  it("caches per-turn computed values until the fingerprint changes", () => {
    const turnContext = new MultiStepTurnContext();
    const compute = vi.fn(() => ({ recall: "working-memory" }));

    const first = turnContext.resolveCachedTurnValue("working-memory", "fingerprint-a", compute);
    const second = turnContext.resolveCachedTurnValue("working-memory", "fingerprint-a", compute);
    const third = turnContext.resolveCachedTurnValue("working-memory", "fingerprint-b", compute);

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("reuses the last assembled context when state and budget stay unchanged", () => {
    const assembler = {
      build: vi.fn(
        ({
          tokenBudget,
          dynamicSections,
        }: { tokenBudget: number; dynamicSections?: unknown[] }) => ({
          prompt: "cached prompt",
          cacheBoundary: {
            staticSections: [],
            dynamicSections: (dynamicSections ?? []) as never[],
            staticPrompt: "",
            dynamicPrompt: "cached prompt",
          },
          budget: {
            included: (dynamicSections ?? []) as never[],
            omitted: [],
            usedTokens: tokenBudget,
            remainingTokens: 0,
          },
        }),
      ),
    };
    const turnContext = new MultiStepTurnContext(assembler);
    turnContext.setUserInput("plan");

    const first = turnContext.rebuild({ tokenBudget: 32 });
    const second = turnContext.rebuild({ tokenBudget: 32 });

    expect(first).toBe(second);
    expect(assembler.build).toHaveBeenCalledTimes(1);

    turnContext.setTaskState("Current todo list:\n1. [todo] Ship beta");
    turnContext.rebuild({ tokenBudget: 32 });

    expect(assembler.build).toHaveBeenCalledTimes(2);
  });
});
