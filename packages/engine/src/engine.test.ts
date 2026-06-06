import {
  DynamicContextAssembler,
  MultiStepTurnContext,
  PromptSectionRegistry,
} from "@hotflow/context";
import { ContractError } from "@hotflow/contracts";
import {
  type ModelGenerateResult,
  type ModelMessage,
  ModelProviderError,
  type ModelToolDefinition,
} from "@hotflow/models";
import { createToolCallPlannedJournalEvent, createToolResultJournalEvent } from "@hotflow/tools";
import { describe, expect, it, vi } from "vitest";

import { PhaseOneEngine } from "./engine.js";
import { isEngineRunFailure } from "./run-failure.js";
import type { EngineDependencies, EngineToolDispatcher } from "./types.js";

function createSessionStoreMock(options: {
  recover?: unknown;
  recoverStep?: unknown;
}) {
  const journalEntries: Array<{ eventType: string; turnId?: string; payload?: unknown }> = [];
  const runtimeEvidenceEntries: Array<{ kind: string; turnId?: string; payload?: unknown }> = [];
  const stepJournalEntries: Array<{ stepIndex: number; eventType: string; payload?: unknown }> = [];
  const streamJournalEntries: Array<{
    turnId?: string;
    event: {
      id: string;
      kind: string;
      schemaVersion: string;
      occurredAtMs: number;
      payload: unknown;
    };
  }> = [];
  const checkpoints: unknown[] = [];
  const stepCheckpoints: Array<{ stepIndex: number; eventType: string }> = [];
  const handoffSummaries: unknown[] = [];
  let currentSession: {
    sessionId: string;
    metadata: Record<string, unknown>;
    status: "active";
    schemaVersion: string;
    createdAtMs: number;
    updatedAtMs: number;
    archivedAtMs: null;
    archiveReason: null;
  } | null = null;

  const sessionStore = {
    getSession: vi.fn(() => currentSession),
    createSession: vi.fn(() => {
      currentSession = {
        sessionId: "session-test",
        metadata: {},
        status: "active" as const,
        schemaVersion: "1",
        createdAtMs: 1,
        updatedAtMs: 1,
        archivedAtMs: null,
        archiveReason: null,
      };
      return currentSession;
    }),
    updateMetadata: vi.fn((_sessionId: string, metadata: Record<string, unknown>) => {
      if (currentSession === null) {
        currentSession = {
          sessionId: "session-test",
          metadata,
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        };
        return currentSession;
      }

      currentSession = {
        ...currentSession,
        metadata,
      };
      return currentSession;
    }),
    recover:
      (options.recover as EngineDependencies["sessionStore"]["recover"]) ??
      vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
      })),
    recoverStep: options.recoverStep as EngineDependencies["sessionStore"]["recoverStep"],
    appendJournal: vi.fn(
      (
        _sessionId: string,
        input: {
          eventType: string;
          turnId?: string;
          payload?: unknown;
        },
      ) => {
        journalEntries.push({
          eventType: input.eventType,
          payload: input.payload,
          ...(input.turnId ? { turnId: input.turnId } : {}),
        });
      },
    ),
    recordRuntimeEvidence: vi.fn(
      (
        _sessionId: string,
        input: {
          kind: string;
          turnId?: string;
          payload?: unknown;
        },
      ) => {
        runtimeEvidenceEntries.push({
          kind: input.kind,
          payload: input.payload,
          ...(input.turnId ? { turnId: input.turnId } : {}),
        });
      },
    ),
    appendStepJournal: vi.fn(
      (
        _sessionId: string,
        input: {
          stepIndex: number;
          eventType: string;
          payload?: unknown;
        },
      ) => {
        stepJournalEntries.push({
          stepIndex: input.stepIndex,
          eventType: input.eventType,
          payload: input.payload,
        });
        return null;
      },
    ),
    appendStreamEvent: vi.fn(
      (
        _sessionId: string,
        input: {
          turnId?: string;
          event: {
            id: string;
            kind: string;
            schemaVersion: string;
            occurredAtMs: number;
            payload: unknown;
          };
        },
      ) => {
        streamJournalEntries.push({
          ...(input.turnId ? { turnId: input.turnId } : {}),
          event: input.event,
        });
        return null;
      },
    ),
    listStreamEvents: vi.fn(
      (
        _sessionId: string,
        input?: {
          turnId?: string;
        },
      ) =>
        streamJournalEntries
          .filter((entry) => (input?.turnId ? entry.turnId === input.turnId : true))
          .map((entry, index) => ({
            entry: {
              rowId: index + 1,
              sessionId: "session-test",
              seq: index + 1,
              eventType: "stream.event",
              turnId: entry.turnId ?? null,
              payload: entry.event,
              schemaVersion: entry.event.schemaVersion,
              createdAtMs: entry.event.occurredAtMs,
            },
            event: entry.event,
          })),
    ),
    createCheckpoint: vi.fn((_sessionId: string, input: { state: unknown }) => {
      checkpoints.push(input.state);
      return null;
    }),
    createStepCheckpoint: vi.fn(
      (
        _sessionId: string,
        input: {
          stepIndex: number;
          eventType: string;
        },
      ) => {
        stepCheckpoints.push({
          stepIndex: input.stepIndex,
          eventType: input.eventType,
        });
        return null;
      },
    ),
    createHandoffSummary: vi.fn((_sessionId: string, input: unknown) => {
      handoffSummaries.push(input);
      return null;
    }),
  } as unknown as EngineDependencies["sessionStore"];

  return {
    sessionStore,
    journalEntries,
    runtimeEvidenceEntries,
    stepJournalEntries,
    streamJournalEntries,
    checkpoints,
    stepCheckpoints,
    handoffSummaries,
  };
}

function getMessageContent(messages: readonly ModelMessage[], role: ModelMessage["role"]): string {
  const message = messages.find((candidate) => candidate.role === role);
  return typeof message?.content === "string" ? message.content : "";
}

describe("PhaseOneEngine prompt contributor cache", () => {
  it("reuses working-memory and skill prompt contributors when the same turn state is rebuilt", () => {
    const { sessionStore } = createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [
          {
            id: "memory-1",
            layer: "layer0",
            content: "Remember the beta launch checklist",
            score: 0.92,
          },
        ],
      })),
    } as unknown as EngineDependencies["memory"];
    const promptSectionContributor = {
      id: "skills.approved-index",
      buildSections: vi.fn(() => [
        {
          id: "skill.beta-launch",
          cacheBucket: "dynamic" as const,
          owner: "skill" as const,
          priority: 65,
          content: "Skill: Beta launch checklist",
        },
      ]),
    };
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch: vi.fn(),
        }) as EngineToolDispatcher,
      memory,
      modelRuntime: {
        generate: vi.fn(),
      },
      promptSectionContributors: [promptSectionContributor],
      sessionStore,
      workspaceRoot: "/workspace",
    });
    const turnContext = new MultiStepTurnContext(new DynamicContextAssembler());
    const buildPrompt = (
      Reflect.get(engine, "buildPrompt") as (
        context: {
          turnId: string;
          providerId: string;
          model: string;
          sessionId: string;
          tokenBudget: number;
          maxSteps: number;
        },
        userText: string,
        taskState: { items: { id: string; content: string; status: "todo" }[] },
        toolResults: readonly [],
        runtimeDegradations: readonly [],
        availableTools: readonly [],
        turnContext: MultiStepTurnContext,
        sessionMetadata: Record<string, unknown>,
        turnResumeState: undefined,
        turnReasoningSection: undefined,
      ) => { prompt: string }
    ).bind(engine) as (
      context: {
        turnId: string;
        providerId: string;
        model: string;
        sessionId: string;
        tokenBudget: number;
        maxSteps: number;
      },
      userText: string,
      taskState: { items: { id: string; content: string; status: "todo" }[] },
      toolResults: readonly [],
      runtimeDegradations: readonly [],
      availableTools: readonly [],
      turnContext: MultiStepTurnContext,
      sessionMetadata: Record<string, unknown>,
      turnResumeState: undefined,
      turnReasoningSection: undefined,
    ) => { prompt: string };

    const context = {
      turnId: "turn-cache",
      providerId: "mock-provider",
      model: "mock-model",
      sessionId: "session-test",
      tokenBudget: 256,
      maxSteps: 4,
    };
    const emptyTaskState = { items: [] as { id: string; content: string; status: "todo" }[] };

    const first = buildPrompt(
      context,
      "continue the beta launch",
      emptyTaskState,
      [],
      [],
      [],
      turnContext,
      {},
      undefined,
      undefined,
    );
    const second = buildPrompt(
      context,
      "continue the beta launch",
      emptyTaskState,
      [],
      [],
      [],
      turnContext,
      {},
      undefined,
      undefined,
    );

    expect(first.prompt).toBe(second.prompt);
    expect(memory.recallWorkingMemory).toHaveBeenCalledTimes(1);
    expect(promptSectionContributor.buildSections).toHaveBeenCalledTimes(1);

    buildPrompt(
      context,
      "continue the beta launch",
      {
        items: [{ id: "todo-1", content: "Lock shot list", status: "todo" }],
      },
      [],
      [],
      [],
      turnContext,
      {},
      undefined,
      undefined,
    );

    expect(memory.recallWorkingMemory).toHaveBeenCalledTimes(1);
    expect(promptSectionContributor.buildSections).toHaveBeenCalledTimes(2);
  });

  it("passes available model tools and toolsets into prompt contributors", () => {
    const { sessionStore } = createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const promptSectionContributor = {
      id: "skills.approved-index",
      buildSections: vi.fn(() => []),
    };
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch: vi.fn(),
        }) as EngineToolDispatcher,
      memory,
      modelRuntime: {
        generate: vi.fn(),
      },
      promptSectionContributors: [promptSectionContributor],
      sessionStore,
      workspaceRoot: "/workspace",
    });
    const buildPrompt = (
      Reflect.get(engine, "buildPrompt") as (
        context: {
          turnId: string;
          providerId: string;
          model: string;
          sessionId: string;
          tokenBudget: number;
          maxSteps: number;
        },
        userText: string,
        taskState: { items: [] },
        toolResults: readonly [],
        runtimeDegradations: readonly [],
        availableTools: readonly {
          name: string;
          description: string;
          inputSchema: { type: "object" };
          toolset?: string;
        }[],
        turnContext: MultiStepTurnContext,
        sessionMetadata: Record<string, unknown>,
        turnResumeState: undefined,
        turnReasoningSection: undefined,
      ) => { prompt: string }
    ).bind(engine);

    buildPrompt(
      {
        turnId: "turn-tools",
        providerId: "mock-provider",
        model: "mock-model",
        sessionId: "session-test",
        tokenBudget: 256,
        maxSteps: 4,
      },
      "browse this page",
      { items: [] },
      [],
      [],
      [
        {
          name: "browser_snapshot",
          description: "Inspect the current browser page.",
          inputSchema: { type: "object" },
          toolset: "browser",
        },
      ],
      new MultiStepTurnContext(new DynamicContextAssembler()),
      {},
      undefined,
      undefined,
    );

    expect(promptSectionContributor.buildSections).toHaveBeenCalledWith(
      expect.objectContaining({
        availableTools: ["browser_snapshot"],
        availableToolsets: ["browser"],
      }),
    );
  });
});

describe("PhaseOneEngine step loop integration", () => {
  it("records explicit step runtime events and checkpoints", async () => {
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "calling tool",
        toolCalls: [
          {
            id: "call-1",
            name: "demo_tool",
            argumentsJson: '{"topic":"todo"}',
          },
        ],
      },
      {
        text: "短剧脚本最终答案",
      },
    ];
    const generate = vi.fn(async () => {
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-1",
      toolName: "demo_tool",
      ok: true,
      output: { ok: true },
      resolution: "executed" as const,
    }));
    const {
      sessionStore,
      journalEntries,
      stepJournalEntries,
      streamJournalEntries,
      checkpoints,
      stepCheckpoints,
      handoffSummaries,
    } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-test",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });

    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];

    const deps: EngineDependencies = {
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch,
        }) as EngineToolDispatcher,
      memory,
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    };
    const engine = new PhaseOneEngine(deps);

    const result = await engine.runTurn({
      userText: "生成一个短剧脚本",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-test",
      maxSteps: 4,
    });

    expect(result.output).toBe("短剧脚本最终答案");
    expect(result.toolResults).toHaveLength(1);
    expect(result.sessionId).toBe("session-test");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(memory.writeLayer0).toHaveBeenCalledTimes(2);
    expect(memory.recallWorkingMemory).toHaveBeenCalled();
    expect(checkpoints).toHaveLength(1);
    const checkpointState = checkpoints[0] as Record<string, unknown>;
    expect(Object.keys(checkpointState).sort()).toEqual(["lastAssistantOutput", "tasks"]);
    expect(checkpointState.tasks).toBeTypeOf("object");
    expect((checkpointState.tasks as Record<string, unknown>).delegation).toBeUndefined();
    expect((checkpointState.tasks as Record<string, unknown>).verification).toBeUndefined();
    expect((checkpointState.tasks as Record<string, unknown>).proposalQueue).toBeUndefined();
    expect((checkpointState.tasks as Record<string, unknown>).proposalOutbox).toBeUndefined();
    const journalEvents = journalEntries.map((entry) => entry.eventType);
    expect(journalEvents).toContain("user.input");
    expect(journalEvents).toContain("tool.call_planned");
    expect(journalEvents).toContain("tool.result");
    expect(journalEvents).toContain("assistant.output");
    expect(journalEntries.every((entry) => entry.turnId === "turn-test")).toBe(true);
    expect(stepJournalEntries.map((entry) => entry.eventType)).toEqual([
      "step.context_built",
      "step.model_output",
      "step.tools_planned",
      "step.tool_result",
      "step.context_built",
      "step.model_output",
      "step.final_output",
    ]);
    expect(stepJournalEntries[0]?.stepIndex).toBe(0);
    expect(stepJournalEntries.at(-1)?.stepIndex).toBe(1);
    expect(stepCheckpoints).toHaveLength(stepJournalEntries.length);
    expect(streamJournalEntries.map((entry) => entry.event.kind)).toEqual([
      "stream.started",
      "stream.chunk",
      "stream.tool-call",
      "stream.interrupted",
      "stream.resumed",
      "stream.chunk",
      "stream.completed",
    ]);
    expect(streamJournalEntries[1]?.event.payload).toMatchObject({
      turnId: "turn-test",
      index: 0,
      delta: "calling tool",
    });
    expect(streamJournalEntries[2]?.event.payload).toMatchObject({
      turnId: "turn-test",
      call: {
        callId: "call-1",
        tool: {
          name: "demo_tool",
        },
        args: {
          topic: "todo",
        },
      },
    });
    expect(streamJournalEntries[3]?.event.payload).toMatchObject({
      turnId: "turn-test",
      reason: "tool_boundary",
      resumable: true,
    });
    expect(streamJournalEntries[4]?.event.payload).toMatchObject({
      turnId: "turn-test",
      reason: "tool boundary cleared",
    });
    expect(streamJournalEntries.at(-1)?.event.payload).toMatchObject({
      turnId: "turn-test",
      finishReason: "stop",
    });
    expect(handoffSummaries).toHaveLength(1);
    expect(handoffSummaries[0]).toMatchObject({
      latestTurnId: "turn-test",
      currentState: "Turn completed with 1 tool result(s).",
      task: "生成一个短剧脚本",
      workflow: expect.arrayContaining(["Model loop completed after 2 step(s)."]),
      keyResults: expect.arrayContaining(["短剧脚本最终答案"]),
      nextActions: expect.arrayContaining(["Use durable transcript or journal for exact replay."]),
    });

    const rebuiltEvents = stepJournalEntries.filter(
      (entry) => entry.eventType === "step.context_built",
    );
    expect(rebuiltEvents).toHaveLength(2);
    expect(rebuiltEvents[0]?.payload).toMatchObject({
      dynamicSections: [
        expect.objectContaining({
          id: "user-input",
          cacheBucket: "dynamic",
        }),
      ],
      dynamicSectionIds: ["user-input"],
      omittedSectionIds: [],
    });
    expect(rebuiltEvents[1]?.payload).toMatchObject({
      dynamicSections: [
        expect.objectContaining({
          id: "user-input",
          cacheBucket: "dynamic",
        }),
        expect.objectContaining({
          id: "tool-result-1",
          cacheBucket: "dynamic",
        }),
      ],
      dynamicSectionIds: ["user-input", "tool-result-1"],
      omittedSectionIds: [],
    });
  });

  it("filters low-value user chatter before writing working memory", async () => {
    const { sessionStore } = createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      writeLayer1: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const generate: EngineDependencies["modelRuntime"]["generate"] = vi.fn(async () => ({
      text: "我在。",
    }));
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch: vi.fn(),
        }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      userText: "哈哈，我今天学习制作咖啡，挺开心",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-chitchat",
      maxSteps: 1,
    });

    expect(memory.writeLayer1).not.toHaveBeenCalled();
    expect(memory.writeLayer0).not.toHaveBeenCalled();
  });

  it("stores explicit user preferences in the categorized user memory layer", async () => {
    const { sessionStore } = createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      writeLayer1: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const generate: EngineDependencies["modelRuntime"]["generate"] = vi.fn(async () => ({
      text: "已记住。",
    }));
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch: vi.fn(),
        }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      userText: "记住：我默认喜欢中文回复，脚本要短一点",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-preference",
      maxSteps: 1,
    });

    expect(memory.writeLayer1).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "记住：我默认喜欢中文回复，脚本要短一点",
        scope: { sessionId: "session-test", namespace: "user-memory:preference" },
        tags: expect.arrayContaining(["memory:user", "memory:preference"]),
        metadata: expect.objectContaining({
          memoryAdmission: expect.objectContaining({
            category: "user-preference",
            retention: "user",
          }),
        }),
      }),
    );
  });

  it("quarantines unsafe user memory without writing raw secrets to durable memory", async () => {
    const { sessionStore } = createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      writeLayer1: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const generate: EngineDependencies["modelRuntime"]["generate"] = vi.fn(async () => ({
      text: "我不会保存原始密钥。",
    }));
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch: vi.fn(),
        }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const secret = "sk-test-1234567890abcdef1234567890abcdef";
    await engine.runTurn({
      userText: `记住我的 API key 是 ${secret}`,
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-secret",
      maxSteps: 1,
    });

    expect(memory.writeLayer1).not.toHaveBeenCalled();
    expect(memory.writeLayer0).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.not.stringContaining(secret),
        scope: { sessionId: "session-test", namespace: "memory:quarantine" },
        metadata: expect.objectContaining({
          memoryAdmission: expect.objectContaining({
            retention: "quarantine",
            safety: expect.objectContaining({
              safe: false,
              findings: expect.arrayContaining([expect.objectContaining({ type: "api-key" })]),
            }),
          }),
        }),
      }),
    );
  });

  it("quarantines unsafe assistant output before it enters working memory", async () => {
    const { sessionStore } = createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      writeLayer1: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const secret = "sk-test-1234567890abcdef1234567890abcdef";
    const generate: EngineDependencies["modelRuntime"]["generate"] = vi.fn(async () => ({
      text: `误输出 API key 是 ${secret}`,
    }));
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch: vi.fn(),
        }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      userText: "开始",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-assistant-secret",
      maxSteps: 1,
    });

    expect(memory.writeLayer0).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.not.stringContaining(secret),
        scope: { sessionId: "session-test", namespace: "memory:quarantine" },
        tags: expect.arrayContaining(["memory:assistant-output", "memory:quarantine"]),
        metadata: expect.objectContaining({
          memoryAdmission: expect.objectContaining({
            retention: "quarantine",
            reason: "system:assistant-output-quarantine",
          }),
        }),
      }),
    );
  });

  it("skips manual tool journal writes when dispatcher manages journal closure", async () => {
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "calling managed tool",
        toolCalls: [
          {
            id: "call-managed",
            name: "demo_tool",
            argumentsJson: '{"topic":"journal"}',
          },
        ],
      },
      {
        text: "final answer",
      },
    ];
    const generate = vi.fn(async () => {
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const { sessionStore, journalEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-managed",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const dispatch = vi.fn(async (call, context) => {
      const plannedEvent = createToolCallPlannedJournalEvent(call);
      sessionStore.appendJournal(context.sessionId, {
        eventType: plannedEvent.eventType,
        payload: plannedEvent.payload as never,
        ...(context.turnId ? { turnId: context.turnId } : {}),
      });

      const result = {
        toolCallId: call.id,
        toolName: call.name,
        ok: true,
        output: { ok: true },
        resolution: "executed" as const,
      };
      const resultEvent = createToolResultJournalEvent(result);
      sessionStore.appendJournal(context.sessionId, {
        eventType: resultEvent.eventType,
        payload: resultEvent.payload as never,
        ...(context.turnId ? { turnId: context.turnId } : {}),
      });

      return result;
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch,
          managesJournalClosure: true,
        }) satisfies EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      userText: "help me",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-managed",
      maxSteps: 4,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(journalEntries.filter((entry) => entry.eventType === "tool.call_planned")).toHaveLength(
      1,
    );
    expect(journalEntries.filter((entry) => entry.eventType === "tool.result")).toHaveLength(1);
    expect(
      journalEntries.find((entry) => entry.eventType === "tool.result")?.payload,
    ).toMatchObject({
      toolCallId: "call-managed",
      toolName: "demo_tool",
      ok: true,
      resolution: "executed",
    });
  });

  it("injects session-specific output style and permission guidance into the prompt", async () => {
    const capturedRequests: Array<{
      model: string;
      messages: readonly ModelMessage[];
    }> = [];
    const generate = vi.fn(
      async ({ request }: { request: { model: string; messages: ModelMessage[] } }) => {
        capturedRequests.push({
          model: request.model,
          messages: request.messages,
        });
        return {
          text: "final answer",
        } satisfies ModelGenerateResult;
      },
    );
    const dispatch = vi.fn();
    const { sessionStore } = createSessionStoreMock({});
    Object.assign(sessionStore as Record<string, unknown>, {
      getSession: vi.fn(() => ({
        sessionId: "session-test",
        metadata: {
          preferences: {
            outputStyle: "verbose",
            permissionMode: "ask",
          },
        },
        status: "active" as const,
        schemaVersion: "1",
        createdAtMs: 1,
        updatedAtMs: 1,
        archivedAtMs: null,
        archiveReason: null,
      })),
    });

    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () => ({ dispatch }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Summarize the rollout state.",
      providerId: "fake",
      model: "fake-model",
    });

    expect(capturedRequests).toHaveLength(1);
    const dynamicPrompt = getMessageContent(capturedRequests[0]?.messages ?? [], "user");
    expect(dynamicPrompt).toContain("## user-input");
    expect(dynamicPrompt).toContain("## session.output-style");
    expect(dynamicPrompt).toContain("Output style: verbose");
    expect(dynamicPrompt).toContain("Provide fuller explanations");
    expect(dynamicPrompt).toContain("## session.permission-mode");
    expect(dynamicPrompt).toContain("Permission mode: ask");
    expect(dynamicPrompt).toContain("approval-gated");
  });

  it("passes current visible tool schemas into the model request", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
      tools?: readonly ModelToolDefinition[];
    }> = [];
    const generate = vi.fn(
      async ({
        request,
      }: {
        request: {
          messages: ModelMessage[];
          tools?: readonly ModelToolDefinition[];
        };
      }) => {
        capturedRequests.push({
          messages: request.messages,
          ...(request.tools === undefined ? {} : { tools: request.tools }),
        });
        return {
          text: "final answer",
        } satisfies ModelGenerateResult;
      },
    );
    const dispatch = vi.fn();
    const { sessionStore } = createSessionStoreMock({});
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () =>
        ({
          dispatch,
          getSchemas: () => [
            {
              name: "filesystem.read_text",
              description: "Read a UTF-8 text file from the workspace.",
              toolset: "filesystem",
              readOnly: true,
              inputSchema: {
                type: "object",
                properties: {
                  path: {
                    type: "string",
                  },
                },
                required: ["path"],
              },
            },
          ],
        }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Read the release note.",
      providerId: "fake",
      model: "fake-model",
      turnId: "turn-tools-visible",
      maxSteps: 2,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.tools).toEqual([
      {
        name: "filesystem.read_text",
        description: "Read a UTF-8 text file from the workspace.",
        toolset: "filesystem",
        readOnly: true,
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
            },
          },
          required: ["path"],
        },
      },
    ]);
  });

  it("surfaces an explicit turn reasoning strategy into prompt, journal, and stream evidence", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
    }> = [];
    const generate = vi.fn(
      async ({
        request,
      }: {
        request: {
          messages: ModelMessage[];
        };
      }) => {
        capturedRequests.push({
          messages: request.messages,
        });
        return {
          text: "final answer",
        } satisfies ModelGenerateResult;
      },
    );
    const { sessionStore, journalEntries, streamJournalEntries } = createSessionStoreMock({});
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () =>
        ({
          dispatch: vi.fn(),
        }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      sessionId: "session-test",
      turnId: "turn-reasoning-surface",
      userText: "Figure out the rollout plan and then execute the next step.",
      providerId: "fake",
      model: "fake-model",
      requiresTools: true,
    });

    expect(result.reasoningDecision).toMatchObject({
      strategy: "plan-execute",
    });
    expect(capturedRequests).toHaveLength(1);
    const dynamicPrompt = getMessageContent(capturedRequests[0]?.messages ?? [], "user");
    expect(dynamicPrompt).toContain("## runtime.reasoning-strategy");
    expect(dynamicPrompt).toContain("Reasoning strategy: plan-execute");
    expect(dynamicPrompt).toContain("Keep planning, tool use, and synthesis visibly separated.");
    expect(journalEntries).toContainEqual(
      expect.objectContaining({
        eventType: "turn.reasoning_strategy_selected",
        turnId: "turn-reasoning-surface",
        payload: expect.objectContaining({
          strategy: "plan-execute",
        }),
      }),
    );
    expect(streamJournalEntries.map((entry) => entry.event.kind)).toEqual([
      "stream.started",
      "stream.reasoning",
      "stream.chunk",
      "stream.completed",
    ]);
    expect(streamJournalEntries[1]?.event.payload).toMatchObject({
      turnId: "turn-reasoning-surface",
      decision: {
        strategy: "plan-execute",
      },
    });
    expect(sessionStore.getSession("session-test")?.metadata).toMatchObject({
      runtime: {
        latestTurn: {
          turnId: "turn-reasoning-surface",
          reasoning: {
            strategy: "plan-execute",
            confidence: 0.9,
            rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
            suggestedAction: "tool",
          },
        },
      },
    });
  });

  it("keeps session guidance stable across prompt rebuilds in the same turn", async () => {
    const capturedRequests: Array<{
      model: string;
      messages: readonly ModelMessage[];
    }> = [];
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "calling tool",
        toolCalls: [
          {
            id: "call-1",
            name: "demo_tool",
            argumentsJson: '{"topic":"rollout"}',
          },
        ],
      },
      {
        text: "final answer",
      },
    ];
    const generate = vi.fn(
      async ({ request }: { request: { model: string; messages: ModelMessage[] } }) => {
        capturedRequests.push({
          model: request.model,
          messages: request.messages,
        });
        const output = modelOutputs.shift();
        if (!output) {
          throw new Error("missing model output");
        }
        return output;
      },
    );
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-1",
      toolName: "demo_tool",
      ok: true,
      output: { ok: true },
      resolution: "executed" as const,
    }));
    const { sessionStore, stepJournalEntries } = createSessionStoreMock({});
    Object.assign(sessionStore as Record<string, unknown>, {
      getSession: vi.fn(() => ({
        sessionId: "session-test",
        metadata: {
          preferences: {
            outputStyle: "concise",
            permissionMode: "deny",
          },
        },
        status: "active" as const,
        schemaVersion: "1",
        createdAtMs: 1,
        updatedAtMs: 1,
        archivedAtMs: null,
        archiveReason: null,
      })),
    });

    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () => ({ dispatch }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Continue the rollout.",
      providerId: "fake",
      model: "fake-model",
      maxSteps: 2,
    });

    expect(capturedRequests).toHaveLength(2);

    const firstDynamicPrompt = getMessageContent(capturedRequests[0]?.messages ?? [], "user");
    const secondDynamicPrompt = getMessageContent(capturedRequests[1]?.messages ?? [], "user");

    expect(firstDynamicPrompt).toContain("Output style: concise");
    expect(firstDynamicPrompt).toContain("Permission mode: deny");
    expect(secondDynamicPrompt).toContain("Output style: concise");
    expect(secondDynamicPrompt).toContain("Permission mode: deny");
    expect(secondDynamicPrompt).toContain("Tool: demo_tool");
    expect(secondDynamicPrompt).toContain("Success: true");
  });

  it("adds structured assistant/tool continuation messages after tool execution", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
    }> = [];
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "I need to inspect the file first.",
        toolCalls: [
          {
            id: "call-1",
            name: "demo_tool",
            argumentsJson: '{"topic":"runtime"}',
          },
        ],
      },
      {
        text: "final answer",
      },
    ];
    const generate = vi.fn(async ({ request }: { request: { messages: ModelMessage[] } }) => {
      capturedRequests.push({
        messages: request.messages,
      });
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-1",
      toolName: "demo_tool",
      ok: true,
      output: { summary: "Agent OS repository details..." },
      resolution: "executed" as const,
    }));
    const { sessionStore } = createSessionStoreMock({});
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () => ({ dispatch }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Inspect the repository.",
      providerId: "fake",
      model: "fake-model",
      maxSteps: 2,
    });

    expect(capturedRequests).toHaveLength(2);
    expect(capturedRequests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "I need to inspect the file first.",
          toolCalls: [
            {
              id: "call-1",
              name: "demo_tool",
              argumentsJson: '{"topic":"runtime"}',
            },
          ],
        }),
        expect.objectContaining({
          role: "tool",
          name: "demo_tool",
          toolCallId: "call-1",
          content:
            '{"ok":true,"resolution":"executed","output":{"summary":"Agent OS repository details..."}}',
        }),
      ]),
    );
  });

  it("truncates oversized structured tool continuation messages to the remaining replay budget", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
    }> = [];
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "I need to inspect the huge file first.",
        toolCalls: [
          {
            id: "call-huge",
            name: "demo_tool",
            argumentsJson: '{"topic":"budget"}',
          },
        ],
      },
      {
        text: "final answer",
      },
    ];
    const generate = vi.fn(async ({ request }: { request: { messages: ModelMessage[] } }) => {
      capturedRequests.push({
        messages: request.messages,
      });
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-huge",
      toolName: "demo_tool",
      ok: true,
      output: {
        blob: "A".repeat(3_000),
      },
      resolution: "executed" as const,
    }));
    const { sessionStore } = createSessionStoreMock({});
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () => ({ dispatch }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Inspect the repository with a tight continuation budget.",
      providerId: "fake",
      model: "fake-model",
      tokenBudget: 80,
      maxSteps: 2,
    });

    expect(capturedRequests).toHaveLength(2);
    const toolMessage = capturedRequests[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage).toMatchObject({
      role: "tool",
      name: "demo_tool",
      toolCallId: "call-huge",
    });
    expect(toolMessage?.content.length ?? 0).toBeLessThan(260);
    expect(JSON.parse(toolMessage?.content ?? "{}")).toMatchObject({
      ok: true,
      resolution: "executed",
      truncated: true,
      outputPreview: expect.any(String),
    });
  });

  it("records replay truncation as runtime.degraded and surfaces it in later step prompts", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
    }> = [];
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "I need to inspect the huge file first.",
        toolCalls: [
          {
            id: "call-huge",
            name: "demo_tool",
            argumentsJson: '{"topic":"budget"}',
          },
        ],
      },
      {
        text: "I need a follow-up tool after the replay trim.",
        toolCalls: [
          {
            id: "call-follow",
            name: "followup_tool",
            argumentsJson: "{}",
          },
        ],
      },
      {
        text: "final answer after replay degrade",
      },
    ];
    const generate = vi.fn(async ({ request }: { request: { messages: ModelMessage[] } }) => {
      capturedRequests.push({
        messages: request.messages,
      });
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const dispatch = vi.fn(async (call: { id: string; name: string }) => {
      if (call.name === "demo_tool") {
        return {
          toolCallId: "call-huge",
          toolName: "demo_tool",
          ok: true,
          output: {
            blob: "A".repeat(3_000),
          },
          resolution: "executed" as const,
        };
      }
      return {
        toolCallId: "call-follow",
        toolName: "followup_tool",
        ok: true,
        output: { ok: true },
        resolution: "executed" as const,
      };
    });
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({});
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () => ({ dispatch }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      sessionId: "session-test",
      userText: "Inspect the repository and keep going after any replay trimming.",
      providerId: "fake",
      model: "fake-model",
      tokenBudget: 400,
      maxSteps: 3,
    });

    expect(capturedRequests).toHaveLength(3);
    const thirdDynamicPrompt = getMessageContent(capturedRequests[2]?.messages ?? [], "user");
    expect(thirdDynamicPrompt).toContain("## runtime.degradations");
    expect(thirdDynamicPrompt).toContain("reason=context-pressure");
    expect(thirdDynamicPrompt).toContain(
      'Tool result replay for "demo_tool" was truncated to fit the remaining context budget.',
    );
    expect(thirdDynamicPrompt).toContain("toolName=demo_tool");
    expect(thirdDynamicPrompt).toContain("toolCallId=call-huge");
    expect(thirdDynamicPrompt).toContain("replayChars=");
    expect(thirdDynamicPrompt).toContain("originalChars=");
    expect(thirdDynamicPrompt).toContain("Some tool result replay was truncated to fit context.");
    expect(result.output).toBe("final answer after replay degrade");
    expect(journalEntries.map((entry) => entry.eventType)).toContain("runtime.degraded");
    expect(
      journalEntries.find((entry) => entry.eventType === "runtime.degraded")?.payload,
    ).toMatchObject({
      stage: "runtime",
      category: "runtime",
      action: "degrade",
      reason: "context-pressure",
      recoverable: true,
      metadata: {
        toolCallId: "call-huge",
        toolName: "demo_tool",
      },
    });
    expect(runtimeEvidenceEntries).toContainEqual(
      expect.objectContaining({
        kind: "runtime.degraded",
        turnId: expect.any(String),
        payload: expect.objectContaining({
          stage: "runtime",
          category: "runtime",
          reason: "context-pressure",
        }),
      }),
    );
    expect(sessionStore.getSession("session-test")?.metadata).toMatchObject({
      runtime: {
        latestTurn: {
          runtimeStatus: "degraded",
          runtimeDegradationSummaries: ["tool replay trim (demo_tool) [minor]"],
        },
      },
    });
  });

  it("persists latest turn runtime status into session metadata and injects it on the next turn", async () => {
    const capturedRequests: Array<{
      turn: number;
      messages: readonly ModelMessage[];
    }> = [];
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "call degraded tool",
        toolCalls: [
          {
            id: "call-degraded",
            name: "degraded_tool",
            argumentsJson: "{}",
          },
        ],
      },
      {
        text: "first turn complete",
      },
      {
        text: "second turn complete",
      },
    ];
    const generate = vi.fn(async ({ request }: { request: { messages: ModelMessage[] } }) => {
      capturedRequests.push({
        turn: capturedRequests.length + 1,
        messages: request.messages,
      });
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-degraded",
      toolName: "degraded_tool",
      ok: true,
      output: { degraded: true },
      resolution: "degraded" as const,
      metadata: {
        timeoutMs: 1200,
        degradedCapabilities: ["filesystem.write"],
      },
      degradation: {
        stage: "tool" as const,
        category: "tool" as const,
        action: "degrade" as const,
        severity: "minor" as const,
        reason: "fallback",
        message: "fallback response",
        recoverable: true,
      },
    }));
    const { sessionStore } = createSessionStoreMock({});
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () => ({ dispatch }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Use the degraded tool.",
      providerId: "fake",
      model: "fake-model",
      turnId: "turn-one",
      maxSteps: 2,
    });

    expect(sessionStore.getSession("session-test")?.metadata).toMatchObject({
      runtime: {
        latestTurn: {
          turnId: "turn-one",
          providerId: "fake",
          model: "fake-model",
          runtimeStatus: "degraded",
          turnBranch: "tool-degraded",
          finishReason: "stop",
          completedSteps: 2,
          lastStepEventType: "step.final_output",
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
        },
      },
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Continue from the last run.",
      providerId: "fake",
      model: "fake-model",
      turnId: "turn-two",
      maxSteps: 1,
    });

    const secondTurnPrompt = getMessageContent(capturedRequests.at(-1)?.messages ?? [], "user");
    expect(secondTurnPrompt).toContain("## session.latest-turn");
    expect(secondTurnPrompt).toContain("Turn ID: turn-one");
    expect(secondTurnPrompt).toContain("Runtime status: degraded");
    expect(secondTurnPrompt).toContain("Turn branch: tool-degraded");
    expect(secondTurnPrompt).toContain("Finish reason: stop");
    expect(secondTurnPrompt).toContain("Completed steps: 2");
    expect(secondTurnPrompt).toContain("Last step event: step.final_output");
    expect(secondTurnPrompt).toContain("Tool count: 1");
    expect(secondTurnPrompt).toContain(
      "Tool outcomes: executed=0, denied=0, approval_required=0, degraded=1, failed=0, missing=0, unknown=0",
    );
  });

  it("persists step-budget finish reason into session metadata and injects it on the next turn", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
    }> = [];
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "call tool and continue later",
        toolCalls: [
          {
            id: "call-budget",
            name: "demo_tool",
            argumentsJson: "{}",
          },
        ],
      },
      {
        text: "next turn after length stop",
      },
    ];
    const generate = vi.fn(async ({ request }: { request: { messages: ModelMessage[] } }) => {
      capturedRequests.push({
        messages: request.messages,
      });
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-budget",
      toolName: "demo_tool",
      ok: true,
      output: { ok: true },
      resolution: "executed" as const,
    }));
    const { sessionStore } = createSessionStoreMock({});
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(new PromptSectionRegistry()),
      createDispatcher: () => ({ dispatch }) satisfies EngineToolDispatcher,
      memory: {
        recallWorkingMemory: vi.fn(() => undefined),
        writeLayer0: vi.fn(),
      },
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Hit the step budget.",
      providerId: "fake",
      model: "fake-model",
      turnId: "turn-budget-one",
      maxSteps: 1,
    });

    expect(sessionStore.getSession("session-test")?.metadata).toMatchObject({
      runtime: {
        latestTurn: {
          turnId: "turn-budget-one",
          providerId: "fake",
          model: "fake-model",
          runtimeStatus: "healthy",
          turnBranch: "normal",
          finishReason: "length",
          completedSteps: 1,
          lastStepEventType: "step.tool_result",
          resumeAction: "start-next-step",
          nextStepIndex: 1,
          toolCount: 1,
          toolOutcomes: {
            total: 1,
            executed: 1,
            denied: 0,
            approvalRequired: 0,
            degraded: 0,
            failed: 0,
            missing: 0,
            unknown: 0,
          },
        },
      },
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "Continue after step budget stop.",
      providerId: "fake",
      model: "fake-model",
      turnId: "turn-budget-two",
      maxSteps: 1,
    });

    const secondTurnPrompt = getMessageContent(capturedRequests.at(-1)?.messages ?? [], "user");
    expect(secondTurnPrompt).toContain("## session.latest-turn");
    expect(secondTurnPrompt).toContain("Finish reason: length");
    expect(secondTurnPrompt).toContain("Completed steps: 1");
    expect(secondTurnPrompt).toContain("Last step event: step.tool_result");
    expect(secondTurnPrompt).toContain("Suggested resume action: start-next-step");
    expect(secondTurnPrompt).toContain("Suggested next step index: 1");
    expect(secondTurnPrompt).toContain(
      "Unfinished work: Start at step 1 and turn the recorded tool results into the next reasoning/output step before planning duplicate tool calls.",
    );
    expect(secondTurnPrompt).toContain("Continue from step 1 using those results");
  });

  it("replays wrapped todo payload during recovery without expanding checkpoint scope", async () => {
    const generate = vi.fn(async () => ({
      text: "final after wrapped recovery",
    }));
    const dispatch = vi.fn();
    const recover = vi.fn(
      (
        _sessionId: string,
        input: {
          initialState: { tasks: { items: unknown[] } };
          reducer: (
            state: { tasks: { items: unknown[] } },
            event: { eventType: string; payload: unknown },
          ) => { tasks: { items: unknown[] } };
        },
      ) => {
        const reducedState = input.reducer(input.initialState, {
          eventType: "tasks.todo_write",
          payload: {
            todos: {
              items: [
                {
                  id: "todo_wrapped",
                  content: "wrapped recovery todo",
                  status: "todo",
                },
              ],
              updatedAtMs: 42,
            },
            updatedAtMs: 42,
          },
        });
        return {
          session: {
            sessionId: "session-test",
            metadata: {},
            status: "active" as const,
            schemaVersion: "1",
            createdAtMs: 1,
            updatedAtMs: 1,
            archivedAtMs: null,
            archiveReason: null,
          },
          checkpoint: null,
          journal: [],
          state: reducedState,
          lastAppliedSeq: 1,
        };
      },
    );
    const { sessionStore, checkpoints } = createSessionStoreMock({
      recover,
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [
              {
                id: "todo_wrapped",
                content: "wrapped recovery todo",
                status: "todo",
              },
            ],
            updatedAtMs: 42,
          },
        },
        lastAppliedSeq: 1,
        turnId: "turn-replay-wrapped",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 1,
          toSeqInclusive: 1,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      userText: "resume wrapped",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-replay-wrapped",
      maxSteps: 2,
    });

    expect(result.taskState.items[0]?.content).toBe("wrapped recovery todo");
    expect(checkpoints).toHaveLength(1);
    const checkpointState = checkpoints[0] as Record<string, unknown>;
    expect(Object.keys(checkpointState).sort()).toEqual(["lastAssistantOutput", "tasks"]);
    expect((checkpointState.tasks as Record<string, unknown>).delegation).toBeUndefined();
    expect((checkpointState.tasks as Record<string, unknown>).verification).toBeUndefined();
  });

  it("records structured runtime failure and rethrows EngineRunFailure when model generate fails", async () => {
    const generate = vi.fn(async () => {
      throw new ModelProviderError({
        providerId: "openai-live",
        stage: "generate",
        code: "HTTP_429",
        message: "rate limited",
        statusCode: 429,
        retryable: true,
      });
    });
    const dispatch = vi.fn();
    const {
      sessionStore,
      journalEntries,
      runtimeEvidenceEntries,
      streamJournalEntries,
      checkpoints,
    } = createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await expect(
      engine.runTurn({
        userText: "生成一个短剧脚本时触发模型失败",
        providerId: "openai-live",
        model: "gpt-test",
        turnId: "turn-model-failure",
        maxSteps: 1,
      }),
    ).rejects.toMatchObject({
      name: "EngineRunFailure",
      message: "rate limited",
      sessionId: "session-test",
      turnId: "turn-model-failure",
      model: "gpt-test",
      selectedProviderId: "openai-live",
      failure: {
        kind: "provider-transient",
        action: "failover",
        providerId: "openai-live",
        providerStage: "generate",
        providerCode: "HTTP_429",
        retryable: true,
        recoverable: true,
      },
    });

    expect(memory.writeLayer0).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(checkpoints).toHaveLength(0);
    expect(journalEntries.map((entry) => entry.eventType)).toEqual([
      "user.input",
      "runtime.failed",
    ]);
    expect(journalEntries.find((entry) => entry.eventType === "assistant.output")).toBeUndefined();
    expect(
      journalEntries.find((entry) => entry.eventType === "runtime.failed")?.payload,
    ).toMatchObject({
      stage: "model",
      kind: "provider-transient",
      action: "failover",
      recoverable: true,
      providerId: "openai-live",
      providerStage: "generate",
      providerCode: "HTTP_429",
      retryable: true,
      statusCode: 429,
      error: {
        code: "PROVIDER_TRANSIENT_ERROR",
        defaultAction: "failover",
        retryable: true,
        metadata: {
          kind: "provider-transient",
          action: "failover",
          recoverable: true,
          providerId: "openai-live",
          providerStage: "generate",
          providerCode: "HTTP_429",
          retryable: true,
          statusCode: 429,
          operatorVisible: false,
        },
      },
    });
    expect(runtimeEvidenceEntries).toHaveLength(1);
    expect(runtimeEvidenceEntries[0]).toMatchObject({
      kind: "runtime.failed",
      turnId: "turn-model-failure",
      payload: {
        stage: "model",
        kind: "provider-transient",
        action: "failover",
        recoverable: true,
      },
    });
    expect(streamJournalEntries.map((entry) => entry.event.kind)).toEqual([
      "stream.started",
      "stream.error",
      "stream.aborted",
    ]);
    expect(streamJournalEntries[1]?.event.payload).toMatchObject({
      turnId: "turn-model-failure",
      error: {
        code: "PROVIDER_TRANSIENT_ERROR",
        message: "rate limited",
        retryable: true,
      },
    });
    expect(streamJournalEntries[2]?.event.payload).toMatchObject({
      turnId: "turn-model-failure",
      failure: {
        stage: "model",
        kind: "provider-transient",
        action: "failover",
        recoverable: true,
      },
    });
    expect(sessionStore.getSession("session-test")?.metadata).toMatchObject({
      runtime: {
        latestTurn: {
          turnId: "turn-model-failure",
          providerId: "openai-live",
          model: "gpt-test",
          runtimeStatus: "failed",
          turnBranch: "model-runtime-failed",
          finishReason: "failed",
          lastStepEventType: "step.context_built",
          resumeAction: "continue-current-step",
          nextStepIndex: 0,
        },
      },
    });
  });

  it("injects unfinished-work guidance on the next turn after a model runtime failure", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
    }> = [];
    const generate = vi.fn(async ({ request }: { request: { messages: ModelMessage[] } }) => {
      capturedRequests.push({
        messages: request.messages,
      });

      if (capturedRequests.length === 1) {
        throw new ModelProviderError({
          providerId: "openai-live",
          stage: "generate",
          code: "HTTP_429",
          message: "rate limited",
          statusCode: 429,
          retryable: true,
        });
      }

      return {
        text: "recovered after failure",
      };
    });
    const dispatch = vi.fn();
    const { sessionStore } = createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await expect(
      engine.runTurn({
        sessionId: "session-test",
        userText: "trigger model failure",
        providerId: "openai-live",
        model: "gpt-test",
        turnId: "turn-model-failure-one",
        maxSteps: 1,
      }),
    ).rejects.toMatchObject({
      name: "EngineRunFailure",
    });

    await engine.runTurn({
      sessionId: "session-test",
      userText: "continue after runtime failure",
      providerId: "openai-live",
      model: "gpt-test",
      turnId: "turn-model-failure-two",
      maxSteps: 1,
    });

    const secondTurnPrompt = getMessageContent(capturedRequests.at(-1)?.messages ?? [], "user");
    expect(secondTurnPrompt).toContain("## session.latest-turn");
    expect(secondTurnPrompt).toContain("Finish reason: failed");
    expect(secondTurnPrompt).toContain("Last step event: step.context_built");
    expect(secondTurnPrompt).toContain("Suggested resume action: continue-current-step");
    expect(secondTurnPrompt).toContain("Suggested next step index: 0");
    expect(secondTurnPrompt).toContain(
      "Unfinished work: Rebuild step 0 from confirmed state and treat the interrupted step as incomplete until it succeeds.",
    );
    expect(secondTurnPrompt).toContain("Resume from step 0");
  });

  it("persists step.context_built before rethrowing a pre-model provider failure", async () => {
    const generate = vi.fn(async () => {
      throw new ModelProviderError({
        providerId: "openai-live",
        stage: "generate",
        code: "HTTP_429",
        message: "rate limited",
        statusCode: 429,
        retryable: true,
      });
    });
    const dispatch = vi.fn();
    const {
      sessionStore,
      journalEntries,
      runtimeEvidenceEntries,
      stepJournalEntries,
      stepCheckpoints,
    } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-pre-model-anchor",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await expect(
      engine.runTurn({
        userText: "persist the recovery anchor before the provider fails",
        providerId: "openai-live",
        model: "gpt-test",
        turnId: "turn-pre-model-anchor",
        maxSteps: 1,
      }),
    ).rejects.toMatchObject({
      name: "EngineRunFailure",
      message: "rate limited",
      turnId: "turn-pre-model-anchor",
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(stepJournalEntries.map((entry) => entry.eventType)).toEqual(["step.context_built"]);
    expect(stepJournalEntries[0]).toMatchObject({
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        dynamicSectionIds: ["user-input"],
        omittedSectionIds: [],
      },
    });
    expect(stepCheckpoints).toEqual([
      {
        stepIndex: 0,
        eventType: "step.context_built",
      },
    ]);
    expect(journalEntries.map((entry) => entry.eventType)).toEqual([
      "user.input",
      "runtime.failed",
    ]);
    expect(runtimeEvidenceEntries).toContainEqual(
      expect.objectContaining({
        kind: "runtime.failed",
        turnId: "turn-pre-model-anchor",
      }),
    );
  });

  it("keeps internal pre-model checkpoint errors as internal errors", async () => {
    const generate = vi.fn(async () => ({
      text: "this model call should never run",
    }));
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-internal-pre-model-error",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const appendStepJournal = vi.fn(() => {
      throw new Error("step journal write failed");
    });
    Object.assign(sessionStore as Record<string, unknown>, {
      appendStepJournal,
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch: vi.fn() }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    let thrown: unknown;
    try {
      await engine.runTurn({
        userText: "trigger checkpoint failure before the model call",
        providerId: "openai-live",
        model: "gpt-test",
        turnId: "turn-internal-pre-model-error",
        maxSteps: 1,
      });
    } catch (error) {
      thrown = error;
    }

    expect(isEngineRunFailure(thrown)).toBe(false);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("step journal write failed");
    expect(generate).not.toHaveBeenCalled();
    expect(appendStepJournal).toHaveBeenCalledTimes(1);
    expect(journalEntries.map((entry) => entry.eventType)).toEqual(["user.input"]);
    expect(runtimeEvidenceEntries).toHaveLength(0);
  });

  it("preserves prompt-time memory degradation evidence before rethrowing model runtime failure", async () => {
    const generate = vi.fn(async () => {
      throw new ModelProviderError({
        providerId: "openai-live",
        stage: "generate",
        code: "HTTP_429",
        message: "rate limited",
        statusCode: 429,
        retryable: true,
      });
    });
    const dispatch = vi.fn();
    const { sessionStore, journalEntries, runtimeEvidenceEntries, checkpoints } =
      createSessionStoreMock({});
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => {
        throw new Error("recall backend timeout");
      }),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await expect(
      engine.runTurn({
        userText: "trigger model failure after memory degrade",
        providerId: "openai-live",
        model: "gpt-test",
        turnId: "turn-memory-then-model-failure",
        maxSteps: 1,
      }),
    ).rejects.toMatchObject({
      name: "EngineRunFailure",
      message: "rate limited",
      turnId: "turn-memory-then-model-failure",
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(checkpoints).toHaveLength(0);
    expect(journalEntries.map((entry) => entry.eventType)).toEqual([
      "user.input",
      "runtime.degraded",
      "runtime.failed",
    ]);
    expect(
      journalEntries.find((entry) => entry.eventType === "runtime.degraded")?.payload,
    ).toMatchObject({
      stage: "runtime",
      category: "memory",
      action: "degrade",
      recoverable: true,
      error: {
        code: "MEMORY_DEGRADED",
        message: "Working-memory recall degraded: recall backend timeout",
        retryable: true,
      },
    });
    expect(
      journalEntries.find((entry) => entry.eventType === "runtime.failed")?.payload,
    ).toMatchObject({
      stage: "model",
      kind: "provider-transient",
      action: "failover",
      providerId: "openai-live",
      providerStage: "generate",
      providerCode: "HTTP_429",
    });
    expect(runtimeEvidenceEntries).toHaveLength(2);
    expect(runtimeEvidenceEntries[0]).toMatchObject({
      kind: "runtime.degraded",
      turnId: "turn-memory-then-model-failure",
      payload: {
        stage: "runtime",
        category: "memory",
        action: "degrade",
      },
    });
    expect(runtimeEvidenceEntries[1]).toMatchObject({
      kind: "runtime.failed",
      turnId: "turn-memory-then-model-failure",
      payload: {
        stage: "model",
        kind: "provider-transient",
        action: "failover",
      },
    });
  });

  it("writes canonical flat todo payload when tool output uses wrapped shape", async () => {
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "write todo",
        toolCalls: [
          {
            id: "todo-call",
            name: "tasks.todo_write",
            argumentsJson: "{}",
          },
        ],
      },
      {
        text: "todo persisted",
      },
    ];
    const generate = vi.fn(async () => {
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const dispatch = vi.fn(async () => ({
      toolCallId: "todo-call",
      toolName: "tasks.todo_write",
      ok: true,
      output: {
        todos: {
          items: [{ id: "todo_wrapped", content: "wrapped tool output", status: "doing" }],
          updatedAtMs: 55,
        },
        updatedAtMs: 55,
      },
      resolution: "executed" as const,
    }));
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-todo-compat",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      userText: "persist todo",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-todo-compat",
      maxSteps: 4,
    });

    const todoEntry = journalEntries.find((entry) => entry.eventType === "tasks.todo_write");
    expect(todoEntry).toBeDefined();
    const payload = (todoEntry as { payload: unknown }).payload as Record<string, unknown>;
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.todos).toBeUndefined();
  });

  it("consumes recoverStep resumeAction and continues from recovered step", async () => {
    const generate = vi.fn(async () => ({
      text: "短剧恢复后最终输出",
    }));
    const dispatch = vi.fn();
    const recoverStep = vi.fn(() => ({
      session: {
        sessionId: "session-test",
        metadata: {},
        status: "active" as const,
        schemaVersion: "1",
        createdAtMs: 1,
        updatedAtMs: 1,
        archivedAtMs: null,
        archiveReason: null,
      },
      checkpoint: null,
      journal: [],
      state: {
        tasks: {
          items: [],
        },
        lastAssistantOutput: "partial output",
      },
      lastAppliedSeq: 6,
      turnId: "turn-recover",
      stepCheckpoint: null,
      stepJournal: [],
      replay: {
        modelOutput: [],
        plannedTools: [],
        toolResults: [],
        finalOutput: [],
      },
      replayWindow: {
        fromSeqExclusive: 2,
        toSeqInclusive: 6,
      },
      lastStepEvent: {
        eventType: "step.tool_result",
        stepIndex: 0,
        payload: {
          turnBranch: "normal",
          results: [
            {
              toolCallId: "call-recovered",
              toolName: "demo_tool",
              ok: true,
              resolution: "executed",
            },
          ],
        },
        entry: {
          seq: 5,
          sessionId: "session-test",
          eventType: "step.tool_result",
          turnId: "turn-recover-context",
          payload: {
            stepIndex: 0,
            data: {
              turnBranch: "normal",
              results: [
                {
                  toolCallId: "call-recovered",
                  toolName: "demo_tool",
                  ok: true,
                  resolution: "executed",
                },
              ],
            },
          },
          schemaVersion: "sessions/v1",
          createdAtMs: 1,
        },
      },
      resumeAction: "start-next-step" as const,
      nextStepIndex: 1,
    })) as unknown as EngineDependencies["sessionStore"]["recoverStep"];
    const { sessionStore, journalEntries, stepJournalEntries, streamJournalEntries } =
      createSessionStoreMock({
        recoverStep,
      });
    streamJournalEntries.push(
      {
        turnId: "turn-recover",
        event: {
          id: "stream_turn-recover_stream.started_0",
          kind: "stream.started",
          schemaVersion: "0.1.0",
          occurredAtMs: 1,
          payload: {
            turnId: "turn-recover",
          },
        },
      },
      {
        turnId: "turn-recover",
        event: {
          id: "stream_turn-recover_stream.chunk_1",
          kind: "stream.chunk",
          schemaVersion: "0.1.0",
          occurredAtMs: 2,
          payload: {
            turnId: "turn-recover",
            index: 0,
            delta: "partial output",
          },
        },
      },
      {
        turnId: "turn-recover",
        event: {
          id: "stream_turn-recover_stream.interrupted_2",
          kind: "stream.interrupted",
          schemaVersion: "0.1.0",
          occurredAtMs: 3,
          payload: {
            turnId: "turn-recover",
            reason: "tool_boundary",
            resumable: true,
          },
        },
      },
    );
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];

    const deps: EngineDependencies = {
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () =>
        ({
          dispatch,
        }) as EngineToolDispatcher,
      memory,
      modelRuntime: {
        generate,
      },
      sessionStore,
      workspaceRoot: "/workspace",
    };
    const engine = new PhaseOneEngine(deps);

    const result = await engine.runTurn({
      userText: "resume this turn",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-recover",
      maxSteps: 4,
    });

    expect(recoverStep).toHaveBeenCalledWith(
      "session-test",
      expect.objectContaining({
        turnId: "turn-recover",
      }),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(journalEntries.map((entry) => entry.eventType)).not.toContain("user.input");
    expect(journalEntries.every((entry) => entry.turnId === "turn-recover")).toBe(true);
    expect(stepJournalEntries[0]?.stepIndex).toBe(1);
    expect(streamJournalEntries.map((entry) => entry.event.kind)).toEqual([
      "stream.started",
      "stream.chunk",
      "stream.interrupted",
      "stream.resumed",
      "stream.chunk",
      "stream.completed",
    ]);
    expect(
      streamJournalEntries.filter((entry) => entry.event.kind === "stream.started"),
    ).toHaveLength(1);
    expect(streamJournalEntries[3]?.event.payload).toMatchObject({
      turnId: "turn-recover",
      reason: "resuming interrupted turn",
    });
    expect(result.output).toBe("短剧恢复后最终输出");
    expect(memory.writeLayer0).toHaveBeenCalledTimes(1);
  });

  it("rebuilds resumed prompt with recovered tool results from current turn journal", async () => {
    let lastDynamicPrompt = "";
    const generate: EngineDependencies["modelRuntime"]["generate"] = vi.fn(async (input) => {
      lastDynamicPrompt =
        input.request.messages.findLast((message: ModelMessage) => message.role === "user")
          ?.content ?? "";
      return {
        text: "final after recovered context",
      };
    });
    const dispatch = vi.fn();
    const recoverStep = vi.fn(() => ({
      session: {
        sessionId: "session-test",
        metadata: {},
        status: "active" as const,
        schemaVersion: "1",
        createdAtMs: 1,
        updatedAtMs: 1,
        archivedAtMs: null,
        archiveReason: null,
      },
      checkpoint: null,
      journal: [
        {
          rowId: 1,
          sessionId: "session-test",
          seq: 5,
          eventType: "tool.result",
          turnId: "turn-recover-context",
          payload: {
            toolName: "demo_tool",
            ok: true,
            output: {
              restored: true,
            },
            error: null,
          },
          schemaVersion: "sessions/v1",
          createdAtMs: 1,
        },
      ],
      state: {
        tasks: {
          items: [],
        },
        lastAssistantOutput: "calling tool",
      },
      lastAppliedSeq: 5,
      turnId: "turn-recover-context",
      stepCheckpoint: null,
      stepJournal: [],
      replay: {
        contextBuilt: [],
        modelOutput: [],
        plannedTools: [],
        toolResults: [],
        finalOutput: [],
      },
      replayWindow: {
        fromSeqExclusive: 2,
        toSeqInclusive: 5,
      },
      lastStepEvent: {
        eventType: "step.tool_result",
        stepIndex: 0,
        payload: {
          turnBranch: "normal",
          results: [
            {
              toolCallId: "call-recovered",
              toolName: "demo_tool",
              ok: true,
              resolution: "executed",
            },
          ],
        },
        entry: {
          seq: 5,
          sessionId: "session-test",
          eventType: "step.tool_result",
          turnId: "turn-recover-context",
          payload: {
            stepIndex: 0,
            data: {
              turnBranch: "normal",
              results: [
                {
                  toolCallId: "call-recovered",
                  toolName: "demo_tool",
                  ok: true,
                  resolution: "executed",
                },
              ],
            },
          },
          schemaVersion: "sessions/v1",
          createdAtMs: 1,
        },
      },
      resumeAction: "start-next-step" as const,
      nextStepIndex: 1,
    })) as unknown as EngineDependencies["sessionStore"]["recoverStep"];
    const { sessionStore } = createSessionStoreMock({
      recoverStep,
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      userText: "resume this turn",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-recover-context",
      maxSteps: 4,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(lastDynamicPrompt).toContain("## tool-result-1");
    expect(lastDynamicPrompt).toContain("## runtime.turn-resume");
    expect(lastDynamicPrompt).toContain("Resume action: start-next-step");
    expect(lastDynamicPrompt).toContain("Replay window: seq>2..5");
    expect(lastDynamicPrompt).toContain("Recovered tool results: 1");
    expect(lastDynamicPrompt).toContain("Last step event: step.tool_result");
    expect(lastDynamicPrompt).toContain("reuse them before planning duplicate calls");
    expect(lastDynamicPrompt).toContain("Tool: demo_tool");
    expect(lastDynamicPrompt).toContain('"restored":true');
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      toolName: "demo_tool",
      ok: true,
      output: {
        restored: true,
      },
    });
  });

  it("stops turn when tool execution is denied by policy and records branch", async () => {
    const generate = vi.fn(async () => ({
      text: "call restricted tool",
      toolCalls: [
        {
          id: "call-denied",
          name: "restricted_tool",
          argumentsJson: "{}",
        },
      ],
    }));
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-denied",
      toolName: "restricted_tool",
      ok: false,
      error: "policy blocked",
      resolution: "denied" as const,
      policyDecision: {
        verdict: "deny" as const,
        reason: "blocked capability",
      },
    }));
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-denied",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      userText: "use restricted tool",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-denied",
      maxSteps: 4,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.output).toContain("denied by policy");
    expect(journalEntries.map((entry) => entry.eventType)).toContain("turn.branch");
    const branchEntry = journalEntries.find((entry) => entry.eventType === "turn.branch");
    expect(branchEntry?.payload).toMatchObject({
      turnBranch: "policy-denied",
    });
  });

  it("stops turn when tool execution requires approval and records branch", async () => {
    const generate = vi.fn(async () => ({
      text: "call approval tool",
      toolCalls: [
        {
          id: "call-approval",
          name: "approval_tool",
          argumentsJson: "{}",
        },
      ],
    }));
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-approval",
      toolName: "approval_tool",
      ok: false,
      resolution: "approval_required" as const,
      policyDecision: {
        verdict: "ask" as const,
        reason: "human approval needed",
      },
    }));
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-approval",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      userText: "use approval tool",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-approval",
      maxSteps: 4,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.output).toContain("requires approval");
    const branchEntry = journalEntries.find((entry) => entry.eventType === "turn.branch");
    expect(branchEntry?.payload).toMatchObject({
      turnBranch: "approval-required",
    });
  });

  it("continues turn after degraded tool results and records runtime.degraded", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
    }> = [];
    const modelOutputs: ModelGenerateResult[] = [
      {
        text: "call degraded tool",
        toolCalls: [
          {
            id: "call-degraded",
            name: "degraded_tool",
            argumentsJson: "{}",
          },
        ],
      },
      {
        text: "final after degrade",
      },
    ];
    const generate = vi.fn(async ({ request }: { request: { messages: ModelMessage[] } }) => {
      capturedRequests.push({
        messages: request.messages,
      });
      const output = modelOutputs.shift();
      if (!output) {
        throw new Error("missing model output");
      }
      return output;
    });
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-degraded",
      toolName: "degraded_tool",
      ok: true,
      output: { degraded: true },
      resolution: "degraded" as const,
      metadata: {
        timeoutMs: 1200,
        degradedCapabilities: ["filesystem.write"],
      },
      degradation: {
        stage: "tool" as const,
        category: "tool" as const,
        action: "degrade" as const,
        severity: "minor" as const,
        reason: "fallback",
        message: "fallback response",
        recoverable: true,
      },
    }));
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-degraded",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      userText: "use degraded tool",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-degraded",
      maxSteps: 4,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    const secondDynamicPrompt = getMessageContent(capturedRequests[1]?.messages ?? [], "user");
    expect(secondDynamicPrompt).toContain("## runtime.tool-status");
    expect(secondDynamicPrompt).toContain("Current tool runtime status: degraded");
    expect(secondDynamicPrompt).toContain("tool=degraded_tool");
    expect(secondDynamicPrompt).toContain("reason=fallback response");
    expect(secondDynamicPrompt).toContain("metadata=timeout=1200ms,degraded=filesystem.write");
    expect(result.output).toBe("final after degrade");
    expect(journalEntries.map((entry) => entry.eventType)).toContain("runtime.degraded");
    const degradedEntry = journalEntries.find((entry) => entry.eventType === "runtime.degraded");
    expect(degradedEntry?.payload).toMatchObject({
      stage: "tool",
      category: "tool",
      action: "degrade",
      recoverable: true,
    });
    expect(runtimeEvidenceEntries).toContainEqual(
      expect.objectContaining({
        kind: "runtime.degraded",
        turnId: "turn-degraded",
        payload: expect.objectContaining({
          stage: "tool",
          category: "tool",
          action: "degrade",
        }),
      }),
    );
    expect(sessionStore.getSession("session-test")?.metadata).toMatchObject({
      runtime: {
        latestTurn: {
          turnId: "turn-degraded",
          runtimeStatus: "degraded",
          turnBranch: "tool-degraded",
          toolRuntimeGuidance: {
            status: "degraded",
            impactedTools: 1,
            previewedTools: 1,
            toolPreview: "degraded_tool:degraded",
            metaImpactedTools: 1,
            metaPreviewedTools: 1,
            toolMetaPreview: "degraded_tool[timeout=1200ms,degraded=filesystem.write]",
          },
        },
      },
    });
    const branchEntry = journalEntries.find((entry) => entry.eventType === "turn.branch");
    expect(branchEntry?.payload).toMatchObject({
      turnBranch: "tool-degraded",
    });
  });

  it("stops turn on failed tool execution and records runtime.failed", async () => {
    const generate = vi.fn(async () => ({
      text: "call failing tool",
      toolCalls: [
        {
          id: "call-failed",
          name: "failing_tool",
          argumentsJson: "{}",
        },
      ],
    }));
    const dispatch = vi.fn(async () => ({
      toolCallId: "call-failed",
      toolName: "failing_tool",
      ok: false,
      error: "tool crashed",
      resolution: "failed" as const,
    }));
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-failed",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      userText: "use failing tool",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-failed",
      maxSteps: 4,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.output).toContain("failed");
    expect(journalEntries.map((entry) => entry.eventType)).toContain("runtime.failed");
    const failedEntry = journalEntries.find((entry) => entry.eventType === "runtime.failed");
    expect(failedEntry?.payload).toMatchObject({
      stage: "tool",
      kind: "tool",
      action: "abort",
      recoverable: false,
      error: {
        code: "TOOL_FAILURE",
        message: "tool crashed",
        retryable: false,
      },
    });
    expect(runtimeEvidenceEntries).toContainEqual(
      expect.objectContaining({
        kind: "runtime.failed",
        turnId: "turn-failed",
        payload: expect.objectContaining({
          stage: "tool",
          kind: "tool",
          action: "abort",
        }),
      }),
    );
    const branchEntry = journalEntries.find((entry) => entry.eventType === "turn.branch");
    expect(branchEntry?.payload).toMatchObject({
      turnBranch: "tool-failed",
    });
  });

  it("records transient provider failures in runtime.failed evidence before rethrowing", async () => {
    const generate = vi.fn(async () => {
      throw new ModelProviderError({
        providerId: "openai-live",
        stage: "generate",
        code: "HTTP_429",
        message: "rate limited",
        statusCode: 429,
        retryable: true,
      });
    });
    const dispatch = vi.fn();
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-provider-transient",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    let thrown: unknown;
    try {
      await engine.runTurn({
        userText: "trigger transient provider failure",
        providerId: "openai-live",
        model: "mock-model",
        turnId: "turn-provider-transient",
        maxSteps: 1,
      });
    } catch (error) {
      thrown = error;
    }

    expect(isEngineRunFailure(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("rate limited");

    const failedEntry = journalEntries.find((entry) => entry.eventType === "runtime.failed");
    expect(failedEntry?.payload).toMatchObject({
      stage: "model",
      kind: "provider-transient",
      action: "failover",
      recoverable: true,
      providerId: "openai-live",
      providerStage: "generate",
      providerCode: "HTTP_429",
      retryable: true,
      statusCode: 429,
      error: {
        code: "PROVIDER_TRANSIENT_ERROR",
        message: "rate limited",
        retryable: true,
      },
    });
    expect(runtimeEvidenceEntries).toContainEqual(
      expect.objectContaining({
        kind: "runtime.failed",
        turnId: "turn-provider-transient",
        payload: expect.objectContaining({
          kind: "provider-transient",
          action: "failover",
          providerId: "openai-live",
        }),
      }),
    );
  });

  it("records fatal provider failures in runtime.failed evidence before rethrowing", async () => {
    const generate = vi.fn(async () => {
      throw new ModelProviderError({
        providerId: "openai-live",
        stage: "generate",
        code: "HTTP_4XX",
        message: "unauthorized",
        statusCode: 401,
        retryable: false,
      });
    });
    const dispatch = vi.fn();
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-provider-fatal",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [],
      })),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await expect(
      engine.runTurn({
        userText: "trigger fatal provider failure",
        providerId: "openai-live",
        model: "mock-model",
        turnId: "turn-provider-fatal",
        maxSteps: 1,
      }),
    ).rejects.toThrow("unauthorized");

    const failedEntry = journalEntries.find((entry) => entry.eventType === "runtime.failed");
    expect(failedEntry?.payload).toMatchObject({
      stage: "model",
      kind: "provider-fatal",
      action: "abort",
      recoverable: false,
      providerId: "openai-live",
      providerStage: "generate",
      providerCode: "HTTP_4XX",
      retryable: false,
      statusCode: 401,
      error: {
        code: "PROVIDER_FATAL_ERROR",
        message: "unauthorized",
        retryable: false,
      },
    });
    expect(runtimeEvidenceEntries).toContainEqual(
      expect.objectContaining({
        kind: "runtime.failed",
        turnId: "turn-provider-fatal",
        payload: expect.objectContaining({
          kind: "provider-fatal",
          action: "abort",
          providerId: "openai-live",
        }),
      }),
    );
  });

  it("degrades memory recall exceptions and still completes the turn", async () => {
    const capturedRequests: Array<{
      messages: readonly ModelMessage[];
    }> = [];
    const generate = vi.fn(async ({ request }: { request: { messages: ModelMessage[] } }) => {
      capturedRequests.push({
        messages: request.messages,
      });
      return {
        text: "memory fallback output",
      };
    });
    const { sessionStore, journalEntries, runtimeEvidenceEntries } = createSessionStoreMock({
      recoverStep: vi.fn(() => ({
        session: {
          sessionId: "session-test",
          metadata: {},
          status: "active" as const,
          schemaVersion: "1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        },
        checkpoint: null,
        journal: [],
        state: {
          tasks: {
            items: [],
          },
        },
        lastAppliedSeq: 0,
        turnId: "turn-memory-exception",
        stepCheckpoint: null,
        stepJournal: [],
        replay: {
          modelOutput: [],
          plannedTools: [],
          toolResults: [],
          finalOutput: [],
        },
        replayWindow: {
          fromSeqExclusive: 0,
          toSeqInclusive: 0,
        },
        lastStepEvent: null,
        resumeAction: "no-progress" as const,
        nextStepIndex: 0,
      })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
    });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => {
        throw new Error("recall backend timeout");
      }),
    } as unknown as EngineDependencies["memory"];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher: () => ({ dispatch: vi.fn() }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    const result = await engine.runTurn({
      userText: "continue after recall failure",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-memory-exception",
      maxSteps: 1,
    });

    expect(result.output).toBe("memory fallback output");
    const dynamicPrompt = getMessageContent(capturedRequests[0]?.messages ?? [], "user");
    expect(dynamicPrompt).toContain("## runtime.degradations");
    expect(dynamicPrompt).toContain("category=memory");
    expect(dynamicPrompt).toContain(
      "message=Working-memory recall degraded: recall backend timeout",
    );
    expect(dynamicPrompt).toContain("Memory recall may be partial or skipped");
    const degradedEntry = journalEntries.find((entry) => entry.eventType === "runtime.degraded");
    expect(degradedEntry?.payload).toMatchObject({
      stage: "runtime",
      category: "memory",
      action: "degrade",
      recoverable: true,
      error: {
        code: "MEMORY_DEGRADED",
        message: "Working-memory recall degraded: recall backend timeout",
        retryable: true,
      },
    });
    expect(runtimeEvidenceEntries).toContainEqual(
      expect.objectContaining({
        kind: "runtime.degraded",
        turnId: "turn-memory-exception",
        payload: expect.objectContaining({
          stage: "runtime",
          category: "memory",
          action: "degrade",
        }),
      }),
    );
  });

  it("records omitted recall sections when token budget excludes degraded memory context", async () => {
    const generate: EngineDependencies["modelRuntime"]["generate"] = vi.fn(async (input) => ({
      text:
        input.request.messages.findLast((message: ModelMessage) => message.role === "user")
          ?.content ?? "",
    }));
    const dispatch = vi.fn();
    const { sessionStore, journalEntries, runtimeEvidenceEntries, stepJournalEntries } =
      createSessionStoreMock({
        recoverStep: vi.fn(() => ({
          session: {
            sessionId: "session-test",
            metadata: {},
            status: "active" as const,
            schemaVersion: "1",
            createdAtMs: 1,
            updatedAtMs: 1,
            archivedAtMs: null,
            archiveReason: null,
          },
          checkpoint: null,
          journal: [],
          state: {
            tasks: {
              items: [],
            },
          },
          lastAppliedSeq: 0,
          turnId: "turn-context-budget",
          stepCheckpoint: null,
          stepJournal: [],
          replay: {
            modelOutput: [],
            plannedTools: [],
            toolResults: [],
            finalOutput: [],
          },
          replayWindow: {
            fromSeqExclusive: 0,
            toSeqInclusive: 0,
          },
          lastStepEvent: null,
          resumeAction: "no-progress" as const,
          nextStepIndex: 0,
        })) as unknown as EngineDependencies["sessionStore"]["recoverStep"],
      });
    const memory = {
      writeLayer0: vi.fn(() => null),
      recallWorkingMemory: vi.fn(() => ({
        blockId: "working-memory",
        source: "working-memory" as const,
        scope: { sessionId: "session-test" },
        items: [
          {
            id: "memory-hit-1",
            layer: "layer1",
            content: "This recall entry is intentionally verbose so the token budget omits it.",
            score: 0.82,
          },
        ],
        degraded: {
          reason: "memory-timeout",
          message: "external recall skipped",
        },
      })),
    } as unknown as EngineDependencies["memory"];
    const registry = new PromptSectionRegistry();
    registry.register({
      id: "system",
      cacheBucket: "static",
      content: "sys",
    });
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(registry),
      createDispatcher: () => ({ dispatch }) as EngineToolDispatcher,
      memory,
      modelRuntime: { generate },
      sessionStore,
      workspaceRoot: "/workspace",
    });

    await engine.runTurn({
      userText: "hi",
      providerId: "mock-provider",
      model: "mock-model",
      turnId: "turn-context-budget",
      maxSteps: 1,
      tokenBudget: 2,
    });

    const contextBuilt = stepJournalEntries.find(
      (entry) => entry.eventType === "step.context_built",
    );
    const degradedEntry = journalEntries.find((entry) => entry.eventType === "runtime.degraded");
    expect(contextBuilt?.payload).toMatchObject({
      dynamicSections: [
        expect.objectContaining({
          id: "user-input",
          cacheBucket: "dynamic",
        }),
      ],
      dynamicSectionIds: ["user-input"],
      omittedSections: [
        expect.objectContaining({
          id: "runtime.degradations",
          owner: "runtime",
          cacheBucket: "dynamic",
        }),
        expect.objectContaining({
          id: "working-memory.degraded",
          owner: "memory",
          cacheBucket: "dynamic",
        }),
        expect.objectContaining({
          id: "working-memory.recall-1",
          cacheBucket: "dynamic",
        }),
      ],
      omittedSectionIds: [
        "runtime.degradations",
        "working-memory.degraded",
        "working-memory.recall-1",
      ],
      runtimeDegradations: [
        expect.objectContaining({
          stage: "runtime",
          category: "memory",
          action: "degrade",
        }),
      ],
    });
    expect(degradedEntry?.payload).toMatchObject({
      stage: "runtime",
      category: "memory",
      action: "degrade",
      recoverable: true,
    });
    expect(runtimeEvidenceEntries).toContainEqual(
      expect.objectContaining({
        kind: "runtime.degraded",
        turnId: "turn-context-budget",
        payload: expect.objectContaining({
          stage: "runtime",
          category: "memory",
          action: "degrade",
        }),
      }),
    );
  });
});
