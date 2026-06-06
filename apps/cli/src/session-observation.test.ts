import { describe, expect, test } from "vitest";
import {
  type ToolRuntimeStatus,
  combineRuntimeStatus,
  createSessionObservationSnapshot,
  createSessionPromptExplainSnapshot,
  createSessionPromptInspectSnapshot,
  createSessionResumeSnapshot,
  deriveRuntimeStatusFromEvidence,
} from "./session-observation.js";

describe("createSessionPromptExplainSnapshot", () => {
  test("explains prompt changes against the previous context-built event", () => {
    const snapshot = createSessionPromptExplainSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_prompt",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 0,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                        { id: "system.output-style", cacheBucket: "static", owner: "runtime" },
                        { id: "system.permission-mode", cacheBucket: "static", owner: "runtime" },
                        {
                          id: "system.response-language",
                          cacheBucket: "static",
                          owner: "runtime",
                        },
                      ],
                      dynamicSections: [
                        { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.guidance",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["outputStyle", "permissionMode"],
                          metadataPreview: {
                            outputStyle: "concise",
                            permissionMode: "deny",
                          },
                        },
                      ],
                      omittedSections: [
                        {
                          id: "working-memory.recall-1",
                          cacheBucket: "dynamic",
                          owner: "memory",
                        },
                      ],
                      usedTokens: 480,
                      remainingTokens: 1520,
                      runtimeDegradations: [],
                    },
                  },
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                        { id: "system.output-style", cacheBucket: "static", owner: "runtime" },
                        { id: "system.permission-mode", cacheBucket: "static", owner: "runtime" },
                        {
                          id: "system.response-language",
                          cacheBucket: "static",
                          owner: "runtime",
                        },
                      ],
                      dynamicSections: [
                        { id: "tool-results", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.guidance",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["outputStyle", "permissionMode"],
                          metadataPreview: {
                            outputStyle: "concise",
                            permissionMode: "deny",
                          },
                        },
                        {
                          id: "runtime.tool-status",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: [
                            "impactedTools",
                            "status",
                            "previewedTools",
                            "toolPreview",
                            "metaImpactedTools",
                            "metaPreviewedTools",
                            "toolMetaPreview",
                          ],
                          metadataPreview: {
                            impactedTools: 2,
                            status: "degraded",
                            previewedTools: 2,
                            toolPreview: "degraded_tool:degraded|blocked_tool:approval_required",
                            metaImpactedTools: 2,
                            metaPreviewedTools: 2,
                            toolMetaPreview:
                              "degraded_tool[timeout=1200ms]|blocked_tool[approval=pending]",
                          },
                        },
                      ],
                      omittedSections: [
                        {
                          id: "runtime.degradations",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                        },
                      ],
                      usedTokens: 620,
                      remainingTokens: 1380,
                      runtimeDegradations: [
                        {
                          stage: "context",
                          category: "budget",
                          severity: "warn",
                          reason: "token_budget_low",
                          message: "Prompt recall sections were trimmed by budget.",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          };
        },
      },
      {
        sessionId: "session_prompt",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_prompt",
      turnId: "turn_prompt",
      stepIndex: 1,
      previousStepIndex: 0,
      availableStepIndices: [0, 1],
      focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
      focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
      omittedSectionIds: ["runtime.degradations"],
      omittedSectionSummaries: ["runtime degradations"],
      addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
      addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
      removedDynamicSectionIds: ["user-input"],
      removedDynamicSectionSummaries: ["user input"],
      newlyOmittedSectionIds: ["runtime.degradations"],
      newlyOmittedSectionSummaries: ["runtime degradations"],
      restoredOmittedSectionIds: ["working-memory.recall-1"],
      restoredOmittedSectionSummaries: ["working memory recall 1"],
      sessionGuidance: {
        outputStyle: "concise",
        permissionMode: "deny",
      },
      toolRuntimeGuidance: {
        impactedTools: 2,
        status: "degraded",
        previewedTools: 2,
        toolPreview: "degraded_tool:degraded|blocked_tool:approval_required",
        metaImpactedTools: 2,
        metaPreviewedTools: 2,
        toolMetaPreview: "degraded_tool[timeout=1200ms]|blocked_tool[approval=pending]",
      },
      runtimeDegradationSummaries: ["budget trim [warn]"],
      runtimeDegradations: [
        {
          stage: "context",
          category: "budget",
          severity: "warn",
          reason: "token_budget_low",
          message: "Prompt recall sections were trimmed by budget.",
        },
      ],
    });
  });

  test("extracts turn resume guidance from runtime turn resume metadata", () => {
    const snapshot = createSessionPromptExplainSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_resume_prompt",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                        { id: "system.output-style", cacheBucket: "static", owner: "runtime" },
                        { id: "system.permission-mode", cacheBucket: "static", owner: "runtime" },
                        {
                          id: "system.response-language",
                          cacheBucket: "static",
                          owner: "runtime",
                        },
                      ],
                      dynamicSections: [
                        {
                          id: "runtime.turn-resume",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["resumeAction", "nextStepIndex", "recoveredToolResults"],
                          metadataPreview: {
                            resumeAction: "continue-current-step",
                            nextStepIndex: 1,
                            recoveredToolResults: 1,
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 320,
                      remainingTokens: 1680,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      },
      {
        sessionId: "session_turn_resume_prompt",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_turn_resume_prompt",
      turnId: "turn_resume_prompt",
      stepIndex: 1,
      availableStepIndices: [1],
      focusSectionIds: ["runtime.turn-resume"],
      focusSectionSummaries: ["turn resume guidance"],
      turnResumeGuidance: {
        resumeAction: "continue-current-step",
        nextStepIndex: 1,
        recoveredToolResults: 1,
      },
    });
  });

  test("summarizes named session guidance sections in prompt change output", () => {
    const snapshot = createSessionPromptExplainSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_named_session_guidance",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 0,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                        { id: "system.output-style", cacheBucket: "static", owner: "runtime" },
                        { id: "system.permission-mode", cacheBucket: "static", owner: "runtime" },
                        {
                          id: "system.response-language",
                          cacheBucket: "static",
                          owner: "runtime",
                        },
                      ],
                      dynamicSections: [
                        { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.output-style",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["outputStyle"],
                          metadataPreview: {
                            outputStyle: "concise",
                          },
                        },
                        {
                          id: "session.response-language",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["responseLanguage"],
                          metadataPreview: {
                            responseLanguage: "zh-CN",
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 500,
                      remainingTokens: 1500,
                      runtimeDegradations: [],
                    },
                  },
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                        { id: "system.output-style", cacheBucket: "static", owner: "runtime" },
                        { id: "system.permission-mode", cacheBucket: "static", owner: "runtime" },
                        {
                          id: "system.response-language",
                          cacheBucket: "static",
                          owner: "runtime",
                        },
                      ],
                      dynamicSections: [
                        { id: "tool-results", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.output-style",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["outputStyle"],
                          metadataPreview: {
                            outputStyle: "concise",
                          },
                        },
                        {
                          id: "session.permission-mode",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["permissionMode"],
                          metadataPreview: {
                            permissionMode: "deny",
                          },
                        },
                        {
                          id: "session.response-language",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["responseLanguage"],
                          metadataPreview: {
                            responseLanguage: "zh-CN",
                          },
                        },
                        {
                          id: "runtime.tool-status",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["impactedTools", "status"],
                          metadataPreview: {
                            impactedTools: 2,
                            status: "degraded",
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 650,
                      remainingTokens: 1350,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      },
      {
        sessionId: "session_named_session_guidance",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_named_session_guidance",
      turnId: "turn_named_session_guidance",
      stepIndex: 1,
      previousStepIndex: 0,
      runtimeShellSectionIds: ["system.runtime"],
      runtimeShellSectionSummaries: ["runtime shell"],
      staticGuidanceSectionIds: [
        "system.output-style",
        "system.permission-mode",
        "system.response-language",
      ],
      staticGuidanceSectionSummaries: [
        "default output style guidance",
        "default permission mode guidance",
        "default response language guidance",
      ],
      focusSectionIds: [
        "tool-results",
        "session.output-style",
        "session.permission-mode",
        "session.response-language",
        "runtime.tool-status",
      ],
      focusSectionSummaries: [
        "tool results",
        "output style guidance",
        "permission mode guidance",
        "response language guidance",
        "tool runtime guidance",
      ],
      addedDynamicSectionIds: ["tool-results", "session.permission-mode", "runtime.tool-status"],
      addedDynamicSectionSummaries: [
        "tool results",
        "permission mode guidance",
        "tool runtime guidance",
      ],
      removedDynamicSectionIds: ["user-input"],
      removedDynamicSectionSummaries: ["user input"],
      sessionGuidance: {
        outputStyle: "concise",
        permissionMode: "deny",
        responseLanguage: "zh-CN",
      },
      toolRuntimeGuidance: {
        impactedTools: 2,
        status: "degraded",
      },
    });
  });

  test("derives effective guidance from static prompt defaults plus session overrides", () => {
    const snapshot = createSessionPromptExplainSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_prompt_effective_guidance",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 0,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        {
                          id: "system.output-style",
                          cacheBucket: "static",
                          owner: "runtime",
                          metadataKeys: ["outputStyle", "source"],
                          metadataPreview: {
                            outputStyle: "verbose",
                            source: "runtime-default",
                          },
                        },
                        {
                          id: "system.permission-mode",
                          cacheBucket: "static",
                          owner: "runtime",
                          metadataKeys: ["permissionMode", "source"],
                          metadataPreview: {
                            permissionMode: "allow",
                            source: "runtime-default",
                          },
                        },
                        {
                          id: "system.response-language",
                          cacheBucket: "static",
                          owner: "runtime",
                          metadataKeys: ["responseLanguage", "source"],
                          metadataPreview: {
                            responseLanguage: "fr",
                            source: "runtime-default",
                          },
                        },
                      ],
                      dynamicSections: [
                        { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.output-style",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["outputStyle", "source"],
                          metadataPreview: {
                            outputStyle: "concise",
                            source: "session-override",
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 510,
                      remainingTokens: 1490,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      },
      {
        sessionId: "session_prompt_effective_guidance",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_prompt_effective_guidance",
      turnId: "turn_prompt_effective_guidance",
      stepIndex: 0,
      availableStepIndices: [0],
      staticGuidanceSectionIds: [
        "system.output-style",
        "system.permission-mode",
        "system.response-language",
      ],
      focusSectionIds: ["user-input", "session.output-style"],
      focusSectionSummaries: ["user input", "output style guidance"],
      sessionGuidance: {
        outputStyle: "concise",
      },
      effectiveGuidance: {
        outputStyle: "concise",
        permissionMode: "allow",
        responseLanguage: "fr",
      },
      effectiveGuidanceSources: {
        outputStyle: "session-override",
        permissionMode: "runtime-default",
        responseLanguage: "runtime-default",
      },
    });
  });

  test("summarizes replay trim degradations with the affected tool name", () => {
    const snapshot = createSessionPromptExplainSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_replay_trim_prompt",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        { id: "tool-results", cacheBucket: "dynamic", owner: "turn" },
                      ],
                      omittedSections: [
                        {
                          id: "runtime.degradations",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                        },
                      ],
                      usedTokens: 410,
                      remainingTokens: 1590,
                      runtimeDegradations: [
                        {
                          stage: "runtime",
                          category: "runtime",
                          severity: "minor",
                          reason: "context-pressure",
                          message:
                            'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
                          metadata: {
                            toolName: "filesystem.read_text",
                            toolCallId: "call-1",
                            replayChars: 512,
                            originalChars: 4096,
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          };
        },
      },
      {
        sessionId: "session_replay_trim_prompt",
      },
    );

    expect(snapshot.runtimeDegradationSummaries).toEqual([
      "tool replay trim (filesystem.read_text) [minor]",
    ]);
    expect(snapshot.runtimeDegradations).toMatchObject([
      {
        stage: "runtime",
        category: "runtime",
        severity: "minor",
        reason: "context-pressure",
        metadataPreview: {
          toolName: "filesystem.read_text",
          toolCallId: "call-1",
          replayChars: 512,
          originalChars: 4096,
        },
      },
    ]);
  });

  test("extracts latest turn guidance from session latest turn metadata", () => {
    const snapshot = createSessionPromptExplainSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_latest_turn_prompt",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        {
                          id: "session.latest-turn",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: [
                            "turnId",
                            "runtimeStatus",
                            "turnBranch",
                            "reasoningStrategy",
                            "reasoningConfidence",
                            "reasoningRationale",
                            "reasoningSuggestedAction",
                          ],
                          metadataPreview: {
                            turnId: "turn_previous",
                            runtimeStatus: "blocked",
                            turnBranch: "approval-required",
                            reasoningStrategy: "plan-execute",
                            reasoningConfidence: 1,
                            reasoningRationale: "forceStrategy was provided by caller",
                            reasoningSuggestedAction: "model",
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 360,
                      remainingTokens: 1640,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      },
      {
        sessionId: "session_latest_turn_prompt",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_latest_turn_prompt",
      turnId: "turn_latest_turn_prompt",
      stepIndex: 1,
      availableStepIndices: [1],
      focusSectionIds: ["session.latest-turn"],
      focusSectionSummaries: ["latest turn guidance"],
      latestTurnGuidance: {
        turnId: "turn_previous",
        runtimeStatus: "blocked",
        turnBranch: "approval-required",
        reasoning: {
          strategy: "plan-execute",
          confidence: 1,
          rationale: "forceStrategy was provided by caller",
          suggestedAction: "model",
        },
      },
    });
  });
});

describe("createSessionPromptInspectSnapshot", () => {
  test("preserves named session guidance source metadata in raw prompt sections", () => {
    const snapshot = createSessionPromptInspectSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_prompt_inspect_source",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 0,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.output-style",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          priority: 95,
                          metadataKeys: ["outputStyle", "source"],
                          metadataPreview: {
                            outputStyle: "concise",
                            source: "session-override",
                          },
                        },
                        {
                          id: "session.permission-mode",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          priority: 94,
                          metadataKeys: ["permissionMode", "source"],
                          metadataPreview: {
                            permissionMode: "deny",
                            source: "session-override",
                          },
                        },
                        {
                          id: "session.response-language",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          priority: 93,
                          metadataKeys: ["responseLanguage", "source"],
                          metadataPreview: {
                            responseLanguage: "zh-CN",
                            source: "session-override",
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 500,
                      remainingTokens: 1500,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_prompt_inspect_source",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_prompt_inspect_source",
      turnId: "turn_prompt_inspect_source",
      stepIndex: 0,
      runtimeShellSectionIds: ["system.runtime"],
      runtimeShellSectionSummaries: ["runtime shell"],
      sessionGuidance: {
        outputStyle: "concise",
        permissionMode: "deny",
        responseLanguage: "zh-CN",
      },
      dynamicSections: [
        {
          id: "user-input",
          cacheBucket: "dynamic",
          owner: "turn",
        },
        {
          id: "session.output-style",
          cacheBucket: "dynamic",
          owner: "runtime",
          priority: 95,
          metadataKeys: ["outputStyle", "source"],
          metadataPreview: {
            outputStyle: "concise",
            source: "session-override",
          },
        },
        {
          id: "session.permission-mode",
          cacheBucket: "dynamic",
          owner: "runtime",
          priority: 94,
          metadataKeys: ["permissionMode", "source"],
          metadataPreview: {
            permissionMode: "deny",
            source: "session-override",
          },
        },
        {
          id: "session.response-language",
          cacheBucket: "dynamic",
          owner: "runtime",
          priority: 93,
          metadataKeys: ["responseLanguage", "source"],
          metadataPreview: {
            responseLanguage: "zh-CN",
            source: "session-override",
          },
        },
      ],
    });
  });

  test("surfaces effective guidance from static prompt defaults plus session overrides", () => {
    const snapshot = createSessionPromptInspectSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_prompt_inspect_effective_guidance",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 0,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                        {
                          id: "system.output-style",
                          cacheBucket: "static",
                          owner: "runtime",
                          metadataKeys: ["outputStyle", "source"],
                          metadataPreview: {
                            outputStyle: "verbose",
                            source: "runtime-default",
                          },
                        },
                        {
                          id: "system.permission-mode",
                          cacheBucket: "static",
                          owner: "runtime",
                          metadataKeys: ["permissionMode", "source"],
                          metadataPreview: {
                            permissionMode: "allow",
                            source: "runtime-default",
                          },
                        },
                        {
                          id: "system.response-language",
                          cacheBucket: "static",
                          owner: "runtime",
                          metadataKeys: ["responseLanguage", "source"],
                          metadataPreview: {
                            responseLanguage: "fr",
                            source: "runtime-default",
                          },
                        },
                      ],
                      dynamicSections: [
                        { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.output-style",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["outputStyle", "source"],
                          metadataPreview: {
                            outputStyle: "concise",
                            source: "session-override",
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 505,
                      remainingTokens: 1495,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_prompt_inspect_effective_guidance",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_prompt_inspect_effective_guidance",
      turnId: "turn_prompt_inspect_effective_guidance",
      stepIndex: 0,
      availableStepIndices: [0],
      runtimeShellSectionIds: ["system.runtime"],
      runtimeShellSectionSummaries: ["runtime shell"],
      staticGuidanceSectionIds: [
        "system.output-style",
        "system.permission-mode",
        "system.response-language",
      ],
      staticGuidanceSectionSummaries: [
        "default output style guidance",
        "default permission mode guidance",
        "default response language guidance",
      ],
      sessionGuidance: {
        outputStyle: "concise",
      },
      effectiveGuidance: {
        outputStyle: "concise",
        permissionMode: "allow",
        responseLanguage: "fr",
      },
      effectiveGuidanceSources: {
        outputStyle: "session-override",
        permissionMode: "runtime-default",
        responseLanguage: "runtime-default",
      },
    });
  });

  test("surfaces dynamic runtime summaries alongside raw prompt-inspect evidence", () => {
    const snapshot = createSessionPromptInspectSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_prompt_inspect_runtime_summaries",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 0,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "runtime.tool-status",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: [
                            "status",
                            "impactedTools",
                            "previewedTools",
                            "toolPreview",
                          ],
                          metadataPreview: {
                            status: "degraded",
                            impactedTools: 2,
                            previewedTools: 2,
                            toolPreview: "filesystem.read_text:degraded|tools.exec:missing",
                          },
                        },
                        {
                          id: "runtime.turn-resume",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["resumeAction", "nextStepIndex", "recoveredToolResults"],
                          metadataPreview: {
                            resumeAction: "continue-current-step",
                            nextStepIndex: 1,
                            recoveredToolResults: 1,
                          },
                        },
                        {
                          id: "session.latest-turn",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: [
                            "turnId",
                            "runtimeStatus",
                            "turnBranch",
                            "reasoningStrategy",
                            "reasoningConfidence",
                            "reasoningRationale",
                            "reasoningSuggestedAction",
                          ],
                          metadataPreview: {
                            turnId: "turn_previous",
                            runtimeStatus: "blocked",
                            turnBranch: "approval-required",
                            reasoningStrategy: "plan-execute",
                            reasoningConfidence: 0.9,
                            reasoningRationale:
                              "tool-heavy work benefits from an explicit plan/execute turn strategy",
                            reasoningSuggestedAction: "tool",
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 420,
                      remainingTokens: 1580,
                      runtimeDegradations: [
                        {
                          stage: "context",
                          category: "budget",
                          severity: "warn",
                          reason: "token_budget_low",
                          message: "Prompt recall sections were trimmed by budget.",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_prompt_inspect_runtime_summaries",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_prompt_inspect_runtime_summaries",
      turnId: "turn_prompt_inspect_runtime_summaries",
      stepIndex: 0,
      focusSectionIds: [
        "user-input",
        "runtime.tool-status",
        "runtime.turn-resume",
        "session.latest-turn",
      ],
      focusSectionSummaries: [
        "user input",
        "tool runtime guidance",
        "turn resume guidance",
        "latest turn guidance",
      ],
      omittedSectionIds: [],
      toolRuntimeGuidance: {
        status: "degraded",
        impactedTools: 2,
        previewedTools: 2,
        toolPreview: "filesystem.read_text:degraded|tools.exec:missing",
      },
      turnResumeGuidance: {
        resumeAction: "continue-current-step",
        nextStepIndex: 1,
        recoveredToolResults: 1,
      },
      latestTurnGuidance: {
        turnId: "turn_previous",
        runtimeStatus: "blocked",
        turnBranch: "approval-required",
      },
      runtimeDegradationSummaries: ["budget trim [warn]"],
    });
  });

  test("surfaces prompt-inspect change summaries when a previous prompt build exists", () => {
    const snapshot = createSessionPromptInspectSnapshot(
      {
        recoverLatestStep() {
          return {
            latestTurnId: "turn_prompt_inspect_change_summaries",
            stepRecovery: {
              replay: {
                contextBuilt: [
                  {
                    stepIndex: 0,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
                        { id: "session.guidance", cacheBucket: "dynamic", owner: "runtime" },
                      ],
                      omittedSections: [
                        {
                          id: "working-memory.recall-1",
                          cacheBucket: "dynamic",
                          owner: "memory",
                        },
                      ],
                      usedTokens: 480,
                      remainingTokens: 1520,
                      runtimeDegradations: [],
                    },
                  },
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        { id: "tool-results", cacheBucket: "dynamic", owner: "turn" },
                        { id: "session.guidance", cacheBucket: "dynamic", owner: "runtime" },
                        {
                          id: "runtime.tool-status",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                        },
                      ],
                      omittedSections: [
                        {
                          id: "runtime.degradations",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                        },
                      ],
                      usedTokens: 620,
                      remainingTokens: 1380,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_prompt_inspect_change_summaries",
      },
    );

    expect(snapshot).toMatchObject({
      sessionId: "session_prompt_inspect_change_summaries",
      turnId: "turn_prompt_inspect_change_summaries",
      stepIndex: 1,
      previousStepIndex: 0,
      focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
      focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
      omittedSectionIds: ["runtime.degradations"],
      omittedSectionSummaries: ["runtime degradations"],
      addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
      addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
      removedDynamicSectionIds: ["user-input"],
      removedDynamicSectionSummaries: ["user input"],
      newlyOmittedSectionIds: ["runtime.degradations"],
      newlyOmittedSectionSummaries: ["runtime degradations"],
      restoredOmittedSectionIds: ["working-memory.recall-1"],
      restoredOmittedSectionSummaries: ["working memory recall 1"],
    });
  });
});

describe("createSessionObservationSnapshot", () => {
  test("projects an Agent OS timeline summary from the full recovered journal", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "agent os timeline todo" }],
              },
            },
            lastAppliedSeq: 4,
            journal: [
              {
                rowId: 1,
                sessionId: "session_agent_os_timeline",
                seq: 1,
                eventType: "step.context_built",
                turnId: "turn_agent_os",
                schemaVersion: "sessions.v1",
                createdAtMs: 1_778_220_000_000,
                payload: {
                  stepIndex: 0,
                  data: {
                    usedTokens: 320,
                  },
                },
              },
              {
                rowId: 2,
                sessionId: "session_agent_os_timeline",
                seq: 2,
                eventType: "step.tool_result",
                turnId: "turn_agent_os",
                schemaVersion: "sessions.v1",
                createdAtMs: 1_778_220_000_100,
                payload: {
                  stepIndex: 1,
                  data: {
                    toolName: "filesystem.read_text",
                    outcome: "executed",
                  },
                },
              },
              {
                rowId: 3,
                sessionId: "session_agent_os_timeline",
                seq: 3,
                eventType: "step.final_output",
                turnId: "turn_agent_os",
                schemaVersion: "sessions.v1",
                createdAtMs: 1_778_220_000_200,
                payload: {
                  stepIndex: 1,
                  data: {
                    text: "done",
                  },
                },
              },
              {
                rowId: 4,
                sessionId: "session_agent_os_timeline",
                seq: 4,
                eventType: "runtime.degraded",
                turnId: "turn_agent_os",
                schemaVersion: "sessions.v1",
                createdAtMs: 1_778_220_000_300,
                payload: {
                  reason: "provider_cooldown",
                },
              },
            ],
            session: {
              metadata: {},
            },
          };
        },
        listAuditEvents(_sessionId: string, options?: { readonly limit?: number }) {
          return Array.from({ length: options?.limit ?? 0 }, (_, index) => ({
            event: {
              kind: `audit.${index}`,
            },
          }));
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: null,
            stepRecovery: null,
          };
        },
      } as never,
      {
        sessionId: "session_agent_os_timeline",
        limit: 1,
      },
    );

    expect(snapshot).toMatchObject({
      agentOsTimelineSummary: {
        totalEvents: 4,
        firstSequence: 1,
        lastSequence: 4,
        latestEventType: "control.log",
        toolEvents: 1,
        controlPlaneEvents: 1,
        finalDelivered: true,
      },
      auditEvents: 1,
    });
  });

  test("surfaces current session guidance from session metadata when prompt replay is unavailable", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "session guidance fallback todo" }],
              },
            },
            lastAppliedSeq: 2,
            journal: [{}],
            session: {
              metadata: {
                preferences: {
                  outputStyle: "concise",
                  permissionMode: "deny",
                  responseLanguage: "zh-CN",
                },
              },
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: null,
            stepRecovery: null,
          };
        },
      } as never,
      {
        sessionId: "session_guidance_fallback",
      },
    );

    expect(snapshot).toMatchObject({
      firstTodo: "session guidance fallback todo",
      sessionGuidance: {
        outputStyle: "concise",
        permissionMode: "deny",
        responseLanguage: "zh-CN",
      },
    });
    expect(snapshot.latestTurnId).toBeUndefined();
    expect(snapshot.step).toBeUndefined();
  });

  test("adds a compact prompt summary to the latest step when prompt evidence exists", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "status snapshot todo" }],
              },
            },
            lastAppliedSeq: 7,
            journal: [{}, {}],
            session: {
              metadata: {
                runtime: {
                  latestTurn: {
                    turnId: "turn_prompt",
                    providerId: "openai-live",
                    model: "gpt-5-mini",
                  },
                },
              },
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: "turn_prompt",
            stepRecovery: {
              resumeAction: "turn-complete",
              replayWindow: {
                fromSeqExclusive: 2,
                toSeqInclusive: 6,
              },
              nextStepIndex: 2,
              stepJournal: [{}, {}, {}],
              lastStepEvent: {
                eventType: "step.final_output",
              },
              replay: {
                modelOutput: [{}],
                plannedTools: [{}],
                toolResults: [
                  {
                    payload: {
                      results: [
                        {
                          toolName: "tasks.todo_write",
                          resolution: "executed",
                          ok: true,
                        },
                      ],
                    },
                  },
                ],
                finalOutput: [{}],
                contextBuilt: [
                  {
                    stepIndex: 0,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.guidance",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["outputStyle", "permissionMode"],
                          metadataPreview: {
                            outputStyle: "verbose",
                            permissionMode: "ask",
                          },
                        },
                      ],
                      omittedSections: [
                        {
                          id: "working-memory.recall-1",
                          cacheBucket: "dynamic",
                          owner: "memory",
                        },
                      ],
                      usedTokens: 480,
                      remainingTokens: 1520,
                      runtimeDegradations: [],
                    },
                  },
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                        { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        { id: "tool-results", cacheBucket: "dynamic", owner: "turn" },
                        {
                          id: "session.guidance",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["outputStyle", "permissionMode"],
                          metadataPreview: {
                            outputStyle: "verbose",
                            permissionMode: "ask",
                          },
                        },
                        {
                          id: "runtime.tool-status",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: [
                            "impactedTools",
                            "status",
                            "previewedTools",
                            "toolPreview",
                            "metaImpactedTools",
                            "metaPreviewedTools",
                            "toolMetaPreview",
                          ],
                          metadataPreview: {
                            impactedTools: 2,
                            status: "degraded",
                            previewedTools: 2,
                            toolPreview: "degraded_tool:degraded|blocked_tool:approval_required",
                            metaImpactedTools: 2,
                            metaPreviewedTools: 2,
                            toolMetaPreview:
                              "degraded_tool[timeout=1200ms]|blocked_tool[approval=pending]",
                          },
                        },
                      ],
                      omittedSections: [
                        {
                          id: "runtime.degradations",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                        },
                      ],
                      usedTokens: 620,
                      remainingTokens: 1380,
                      runtimeDegradations: [
                        {
                          stage: "context",
                          category: "budget",
                          severity: "warn",
                          reason: "token_budget_low",
                          message: "Prompt recall sections were trimmed by budget.",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_prompt",
      },
    );

    expect(snapshot).toMatchObject({
      firstTodo: "status snapshot todo",
      latestTurnId: "turn_prompt",
      latestTurnProviderId: "openai-live",
      latestTurnModel: "gpt-5-mini",
      step: {
        turnId: "turn_prompt",
        runtimeStatus: "healthy",
        promptSummary: {
          stepIndex: 1,
          previousStepIndex: 0,
          usedTokens: 620,
          remainingTokens: 1380,
          runtimeShellSectionIds: ["system.runtime"],
          runtimeShellSectionSummaries: ["runtime shell"],
          focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
          focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
          omittedSectionIds: ["runtime.degradations"],
          omittedSectionSummaries: ["runtime degradations"],
          addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
          addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
          removedDynamicSectionIds: ["user-input"],
          removedDynamicSectionSummaries: ["user input"],
          newlyOmittedSectionIds: ["runtime.degradations"],
          newlyOmittedSectionSummaries: ["runtime degradations"],
          restoredOmittedSectionIds: ["working-memory.recall-1"],
          restoredOmittedSectionSummaries: ["working memory recall 1"],
          sessionGuidance: {
            outputStyle: "verbose",
            permissionMode: "ask",
          },
          toolRuntimeGuidance: {
            impactedTools: 2,
            status: "degraded",
            previewedTools: 2,
            toolPreview: "degraded_tool:degraded|blocked_tool:approval_required",
            metaImpactedTools: 2,
            metaPreviewedTools: 2,
            toolMetaPreview: "degraded_tool[timeout=1200ms]|blocked_tool[approval=pending]",
          },
          runtimeDegradationSummaries: ["budget trim [warn]"],
          runtimeDegradations: [
            {
              stage: "context",
              category: "budget",
              severity: "warn",
              reason: "token_budget_low",
              message: "Prompt recall sections were trimmed by budget.",
            },
          ],
        },
      },
    });
  });

  test("adds turn resume guidance to the compact prompt summary", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "resume prompt todo" }],
              },
            },
            lastAppliedSeq: 4,
            journal: [{}, {}],
            session: {
              metadata: {
                runtime: {
                  latestTurn: {
                    turnId: "turn_resume_prompt",
                    providerId: "openai-live",
                    model: "gpt-5-mini",
                  },
                },
              },
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: "turn_resume_prompt",
            stepRecovery: {
              resumeAction: "continue-current-step",
              replayWindow: {
                fromSeqExclusive: 1,
                toSeqInclusive: 3,
              },
              nextStepIndex: 1,
              stepJournal: [{}],
              replay: {
                modelOutput: [],
                plannedTools: [],
                toolResults: [],
                finalOutput: [],
                contextBuilt: [
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        {
                          id: "runtime.turn-resume",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: ["resumeAction", "nextStepIndex", "recoveredToolResults"],
                          metadataPreview: {
                            resumeAction: "continue-current-step",
                            nextStepIndex: 1,
                            recoveredToolResults: 1,
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 320,
                      remainingTokens: 1680,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_turn_resume_prompt",
      },
    );

    expect(snapshot).toMatchObject({
      firstTodo: "resume prompt todo",
      latestTurnId: "turn_resume_prompt",
      step: {
        turnId: "turn_resume_prompt",
        promptSummary: {
          stepIndex: 1,
          usedTokens: 320,
          remainingTokens: 1680,
          focusSectionIds: ["runtime.turn-resume"],
          focusSectionSummaries: ["turn resume guidance"],
          turnResumeGuidance: {
            resumeAction: "continue-current-step",
            nextStepIndex: 1,
            recoveredToolResults: 1,
          },
        },
      },
    });
  });

  test("adds latest turn guidance to the compact prompt summary", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "latest turn prompt todo" }],
              },
            },
            lastAppliedSeq: 4,
            journal: [{}, {}],
            session: {
              metadata: {
                runtime: {
                  latestTurn: {
                    turnId: "turn_latest_turn_prompt",
                    providerId: "openai-live",
                    model: "gpt-5-mini",
                  },
                },
              },
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: "turn_latest_turn_prompt",
            stepRecovery: {
              resumeAction: "no-progress",
              replayWindow: {
                fromSeqExclusive: 1,
                toSeqInclusive: 3,
              },
              nextStepIndex: 0,
              stepJournal: [{}],
              replay: {
                modelOutput: [],
                plannedTools: [],
                toolResults: [],
                finalOutput: [],
                contextBuilt: [
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        {
                          id: "session.latest-turn",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                          metadataKeys: [
                            "turnId",
                            "runtimeStatus",
                            "turnBranch",
                            "reasoningStrategy",
                            "reasoningConfidence",
                            "reasoningRationale",
                            "reasoningSuggestedAction",
                          ],
                          metadataPreview: {
                            turnId: "turn_previous",
                            runtimeStatus: "blocked",
                            turnBranch: "approval-required",
                            reasoningStrategy: "plan-execute",
                            reasoningConfidence: 0.9,
                            reasoningRationale:
                              "tool-heavy work benefits from an explicit plan/execute turn strategy",
                            reasoningSuggestedAction: "tool",
                          },
                        },
                      ],
                      omittedSections: [],
                      usedTokens: 360,
                      remainingTokens: 1640,
                      runtimeDegradations: [],
                    },
                  },
                ],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_latest_turn_prompt",
      },
    );

    expect(snapshot).toMatchObject({
      firstTodo: "latest turn prompt todo",
      latestTurnId: "turn_latest_turn_prompt",
      step: {
        turnId: "turn_latest_turn_prompt",
        promptSummary: {
          stepIndex: 1,
          usedTokens: 360,
          remainingTokens: 1640,
          focusSectionIds: ["session.latest-turn"],
          focusSectionSummaries: ["latest turn guidance"],
          latestTurnGuidance: {
            turnId: "turn_previous",
            runtimeStatus: "blocked",
            turnBranch: "approval-required",
            reasoning: {
              strategy: "plan-execute",
              confidence: 0.9,
              rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
              suggestedAction: "tool",
            },
          },
        },
      },
    });
  });

  test("adds replay trim degradation summaries to the compact prompt summary", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "replay trim prompt todo" }],
              },
            },
            lastAppliedSeq: 4,
            journal: [{}, {}],
            session: {
              metadata: {
                runtime: {
                  latestTurn: {
                    turnId: "turn_replay_trim_prompt",
                    providerId: "openai-live",
                    model: "gpt-5-mini",
                  },
                },
              },
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [
            {
              kind: "runtime.degraded",
            },
          ];
        },
        recoverLatestStep() {
          return {
            latestTurnId: "turn_replay_trim_prompt",
            stepRecovery: {
              resumeAction: "continue-current-step",
              replayWindow: {
                fromSeqExclusive: 1,
                toSeqInclusive: 3,
              },
              nextStepIndex: 2,
              stepJournal: [{}],
              replay: {
                modelOutput: [],
                plannedTools: [],
                toolResults: [],
                finalOutput: [],
                contextBuilt: [
                  {
                    stepIndex: 1,
                    payload: {
                      staticSections: [
                        { id: "system.identity", cacheBucket: "static", owner: "runtime" },
                      ],
                      dynamicSections: [
                        { id: "tool-results", cacheBucket: "dynamic", owner: "turn" },
                      ],
                      omittedSections: [
                        {
                          id: "runtime.degradations",
                          cacheBucket: "dynamic",
                          owner: "runtime",
                        },
                      ],
                      usedTokens: 410,
                      remainingTokens: 1590,
                      runtimeDegradations: [
                        {
                          stage: "runtime",
                          category: "runtime",
                          severity: "minor",
                          reason: "context-pressure",
                          message:
                            'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
                          metadata: {
                            toolName: "filesystem.read_text",
                            toolCallId: "call-1",
                            replayChars: 512,
                            originalChars: 4096,
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_replay_trim_prompt",
      },
    );

    expect(snapshot).toMatchObject({
      latestTurnId: "turn_replay_trim_prompt",
      step: {
        turnId: "turn_replay_trim_prompt",
        runtimeStatus: "degraded",
        promptSummary: {
          stepIndex: 1,
          runtimeDegradationSummaries: ["tool replay trim (filesystem.read_text) [minor]"],
          runtimeDegradations: [
            {
              metadataPreview: {
                toolName: "filesystem.read_text",
                toolCallId: "call-1",
                replayChars: 512,
                originalChars: 4096,
              },
            },
          ],
        },
      },
    });
  });

  test("falls back to persisted latest turn tool runtime guidance when step replay is unavailable", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "latest turn fallback todo" }],
              },
            },
            lastAppliedSeq: 2,
            journal: [{}],
            session: {
              metadata: {
                runtime: {
                  latestTurn: {
                    turnId: "turn_latest_turn_fallback",
                    providerId: "openai-live",
                    model: "gpt-5-mini",
                    runtimeStatus: "blocked",
                    turnBranch: "approval-required",
                    finishReason: "length",
                    completedSteps: 4,
                    resumeAction: "continue-current-step",
                    nextStepIndex: 1,
                    lastStepEventType: "step.tools_planned",
                    toolCount: 3,
                    toolOutcomes: {
                      total: 3,
                      executed: 1,
                      denied: 0,
                      approvalRequired: 1,
                      degraded: 1,
                      failed: 0,
                      missing: 0,
                      unknown: 0,
                    },
                    reasoning: {
                      strategy: "plan-execute",
                      confidence: 0.9,
                      rationale:
                        "tool-heavy work benefits from an explicit plan/execute turn strategy",
                      suggestedAction: "tool",
                    },
                    toolRuntimeGuidance: {
                      status: "blocked",
                      impactedTools: 2,
                      previewedTools: 2,
                      toolPreview:
                        "filesystem.read_text:missing|tasks.todo_write:approval_required",
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
              },
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: "turn_latest_turn_fallback",
            stepRecovery: null,
          };
        },
      } as never,
      {
        sessionId: "session_latest_turn_fallback",
      },
    );

    expect(snapshot).toMatchObject({
      latestTurnId: "turn_latest_turn_fallback",
      latestTurnProviderId: "openai-live",
      latestTurnModel: "gpt-5-mini",
      latestTurnRuntimeStatus: "blocked",
      latestTurnTurnBranch: "approval-required",
      latestTurnFinishReason: "length",
      latestTurnCompletedSteps: 4,
      latestTurnResumeAction: "continue-current-step",
      latestTurnNextStepIndex: 1,
      latestTurnLastStepEventType: "step.tools_planned",
      latestTurnToolCount: 3,
      latestTurnToolOutcomes: {
        total: 3,
        executed: 1,
        denied: 0,
        approvalRequired: 1,
        degraded: 1,
        failed: 0,
        missing: 0,
        unknown: 0,
      },
      latestTurnReasoning: {
        strategy: "plan-execute",
        confidence: 0.9,
        rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
        suggestedAction: "tool",
      },
      latestTurnToolRuntimeGuidance: {
        status: "blocked",
        impactedTools: 2,
        previewedTools: 2,
        toolPreview: "filesystem.read_text:missing|tasks.todo_write:approval_required",
        metaImpactedTools: 2,
        metaPreviewedTools: 2,
        toolMetaPreview:
          "filesystem.read_text[availability=missing-env,env=OPENAI_API_KEY]|tasks.todo_write[approval=pending]",
      },
      latestTurnRuntimeDegradationSummaries: [
        "budget trim [warn]",
        "tool replay trim (filesystem.read_text) [warn]",
      ],
    });
    expect(snapshot.step).toBeUndefined();
  });

  test("reads the latest memory control summary from session journal", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "memory control summary todo" }],
              },
            },
            lastAppliedSeq: 5,
            journal: [
              {
                seq: 1,
                createdAtMs: 100,
                eventType: "control.memory_inspect",
                payload: {
                  scope: "all",
                  layer0Count: 3,
                  layer1Count: 1,
                },
              },
              {
                seq: 2,
                createdAtMs: 120,
                eventType: "control.memory_clear",
                payload: {
                  scope: "working",
                  beforeLayer0Count: 3,
                  beforeLayer1Count: 1,
                  layer0Cleared: 2,
                  layer1Cleared: 0,
                  afterLayer0Count: 1,
                  afterLayer1Count: 1,
                },
              },
            ],
            session: {
              metadata: {},
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: undefined,
            stepRecovery: null,
          };
        },
      } as never,
      {
        sessionId: "session_memory_control_summary",
      },
    );

    expect(snapshot).toMatchObject({
      latestMemoryControl: {
        action: "clear",
        scope: "working",
        journalSeq: 2,
        occurredAtMs: 120,
        beforeWorkingMemoryEntries: 3,
        beforeEpisodicMemoryEntries: 1,
        afterWorkingMemoryEntries: 1,
        afterEpisodicMemoryEntries: 1,
      },
    });
  });

  test("reads the latest guidance control summary from session journal", () => {
    const snapshot = createSessionObservationSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "guidance control summary todo" }],
              },
            },
            lastAppliedSeq: 6,
            journal: [
              {
                seq: 1,
                createdAtMs: 100,
                eventType: "control.output_style",
                payload: {
                  style: "concise",
                },
              },
              {
                seq: 2,
                createdAtMs: 120,
                eventType: "control.permission_mode",
                payload: {
                  previousMode: "ask",
                  mode: "deny",
                },
              },
              {
                seq: 3,
                createdAtMs: 140,
                eventType: "control.response_language",
                payload: {
                  previousLanguage: "follow-user",
                  language: "zh-CN",
                },
              },
            ],
            session: {
              metadata: {},
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: undefined,
            stepRecovery: null,
          };
        },
      } as never,
      {
        sessionId: "session_guidance_control_summary",
      },
    );

    expect(snapshot).toMatchObject({
      latestGuidanceControl: {
        action: "response-language",
        value: "zh-CN",
        previousValue: "follow-user",
        journalSeq: 3,
        occurredAtMs: 140,
      },
    });
  });
});

describe("deriveRuntimeStatusFromEvidence", () => {
  test("prefers stream reasoning evidence when building the resume snapshot", () => {
    const snapshot = createSessionResumeSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "resume from stream reasoning" }],
              },
            },
            lastAppliedSeq: 5,
            journal: [{}],
            checkpoint: {
              checkpointId: 3,
              uptoSeq: 5,
            },
            session: {
              metadata: {
                runtime: {
                  latestTurn: {
                    turnId: "turn_resume_stream",
                    providerId: "openai-live",
                    model: "gpt-5-mini",
                    reasoning: {
                      strategy: "plan-execute",
                      confidence: 0.9,
                      rationale:
                        "tool-heavy work benefits from an explicit plan/execute turn strategy",
                      suggestedAction: "tool",
                    },
                  },
                },
              },
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [
            {
              event: {
                kind: "stream.reasoning",
                payload: {
                  decision: {
                    strategy: "react",
                  },
                },
              },
            },
          ];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: "turn_resume_stream",
            stepRecovery: {
              resumeAction: "continue-current-step",
              replayWindow: {
                fromSeqExclusive: 5,
                toSeqInclusive: 8,
              },
              nextStepIndex: 1,
              lastStepEvent: {
                eventType: "step.tools_planned",
              },
              stepJournal: [{}],
              replay: {
                modelOutput: [],
                plannedTools: [],
                toolResults: [],
                finalOutput: [],
                contextBuilt: [],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_resume_stream",
      },
      {
        defaultProviderId: "scripted",
        defaultModel: "fake-model",
      },
    );

    expect(snapshot).toMatchObject({
      latestTurnId: "turn_resume_stream",
      recoveryReasoningSource: "stream-evidence",
      recoveryReasoningStrategy: "react",
      recoverySelectionSource: "persisted-runtime",
    });
  });

  test("falls back to persisted latest-turn reasoning when stream reasoning is unavailable", () => {
    const snapshot = createSessionResumeSnapshot(
      {
        recover() {
          return {
            state: {
              tasks: {
                items: [{ content: "resume from latest-turn reasoning" }],
              },
            },
            lastAppliedSeq: 5,
            journal: [{}],
            checkpoint: {
              checkpointId: 3,
              uptoSeq: 5,
            },
            session: {
              metadata: {
                runtime: {
                  latestTurn: {
                    turnId: "turn_resume_latest_turn",
                    providerId: "openai-live",
                    model: "gpt-5-mini",
                    reasoning: {
                      strategy: "plan-execute",
                      confidence: 0.9,
                      rationale:
                        "tool-heavy work benefits from an explicit plan/execute turn strategy",
                      suggestedAction: "tool",
                    },
                  },
                },
              },
            },
          };
        },
        listAuditEvents() {
          return [];
        },
        listStreamEvents() {
          return [];
        },
        listRuntimeEvidence() {
          return [];
        },
        recoverLatestStep() {
          return {
            latestTurnId: "turn_resume_latest_turn",
            stepRecovery: {
              resumeAction: "continue-current-step",
              replayWindow: {
                fromSeqExclusive: 5,
                toSeqInclusive: 8,
              },
              nextStepIndex: 1,
              lastStepEvent: {
                eventType: "step.tools_planned",
              },
              stepJournal: [{}],
              replay: {
                modelOutput: [],
                plannedTools: [],
                toolResults: [],
                finalOutput: [],
                contextBuilt: [],
              },
            },
          };
        },
      } as never,
      {
        sessionId: "session_resume_latest_turn",
      },
      {
        defaultProviderId: "scripted",
        defaultModel: "fake-model",
      },
    );

    expect(snapshot).toMatchObject({
      latestTurnId: "turn_resume_latest_turn",
      recoveryReasoningSource: "latest-turn-fallback",
      recoveryReasoningStrategy: "plan-execute",
      recoverySelectionSource: "persisted-runtime",
    });
  });

  test("returns healthy when there is no evidence", () => {
    expect(deriveRuntimeStatusFromEvidence([])).toBe("healthy");
  });

  const failingKinds = [
    "runtime.failed",
    "provider.transient_failure",
    "stream.error",
    "stream.aborted",
  ];

  test.each(failingKinds)("returns failed when evidence kind %s is present", (kind) => {
    expect(deriveRuntimeStatusFromEvidence([{ kind }])).toBe("failed");
  });

  const degradedKinds = ["runtime.degraded", "stream.degraded"];

  test.each(degradedKinds)("returns degraded when evidence kind %s is present", (kind) => {
    expect(deriveRuntimeStatusFromEvidence([{ kind }])).toBe("degraded");
  });

  test("prefers failed when degraded evidence arrives alongside an error", () => {
    expect(
      deriveRuntimeStatusFromEvidence([{ kind: "stream.degraded" }, { kind: "stream.error" }]),
    ).toBe("failed");
  });
});

describe("combineRuntimeStatus", () => {
  const severityCases: Array<[ToolRuntimeStatus, ToolRuntimeStatus, ToolRuntimeStatus]> = [
    ["healthy", "degraded", "degraded"],
    ["degraded", "blocked", "blocked"],
    ["blocked", "failed", "failed"],
    ["failed", "degraded", "failed"],
    ["blocked", "healthy", "blocked"],
    ["degraded", "healthy", "degraded"],
    ["healthy", "healthy", "healthy"],
  ];

  test.each(severityCases)("primary=%s secondary=%s yields %s", (primary, secondary, expected) => {
    expect(combineRuntimeStatus(primary, secondary)).toBe(expected);
  });
});
