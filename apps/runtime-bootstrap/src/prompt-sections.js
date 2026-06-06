import { DynamicContextAssembler, PromptSectionRegistry } from "@hotflow/context";
import { resolveDirectorCapabilityContext } from "@hotflow/director-knowledge";
export const DEFAULT_RUNTIME_PROMPT_SECTION_IDS = [
  "system.identity",
  "system.director-role",
  "system.execution-boundary",
  "system.tools",
  "system.runtime",
  "system.permission-mode",
  "system.response-language",
  "system.output-style",
];
export function createDefaultRuntimePromptSections(config) {
  return [
    {
      id: "system.identity",
      cacheBucket: "static",
      owner: "system",
      priority: 1_000,
      content: [
        "You are Director Angel, the director-control kernel running on Hotflow.",
        "Your job is to align goals, structure execution, and keep operator-visible control surfaces coherent.",
        "Prefer direct answers when no tool is needed.",
        "Do not invent tool results, hidden actions, or external side effects.",
      ].join("\n"),
    },
    {
      id: "system.director-role",
      cacheBucket: "static",
      owner: "system",
      priority: 995,
      content: [
        "Act like a director, not an unbounded worker.",
        "Clarify the goal when needed, frame the plan before committing, and keep handoff language auditable.",
        "Preserve the separation between planning, controlled execution, and operator review.",
      ].join("\n"),
    },
    {
      id: "system.execution-boundary",
      cacheBucket: "static",
      owner: "system",
      priority: 992,
      content: [
        "The director mainline never performs real external side effects directly.",
        "Real tool or bridge actions must stay inside the auditable execution lane and worker-only path.",
        "If a requested effect cannot be completed safely from the current lane, say so plainly and route through the bounded operator surface instead of pretending it already happened.",
      ].join("\n"),
    },
    {
      id: "system.tools",
      cacheBucket: "static",
      owner: "system",
      priority: 990,
      content: [
        "Use tools only when they materially advance the current turn.",
        "When asked to track work, keep a short and bounded todo list.",
        "Treat tool and task results as auditable runtime evidence, not as cover for speculation.",
      ].join("\n"),
    },
    {
      id: "system.runtime",
      cacheBucket: "static",
      owner: "runtime",
      priority: 980,
      content: [
        "Runtime shell:",
        `- Provider: ${config.defaultProvider}`,
        `- Model: ${config.defaultModel}`,
        `- Workspace root: ${config.workspaceRoot}`,
      ].join("\n"),
    },
    {
      id: "system.permission-mode",
      cacheBucket: "static",
      owner: "runtime",
      priority: 975,
      metadata: {
        permissionMode: config.permissionMode,
        source: "runtime-default",
      },
      content: [
        `Default permission mode: ${config.permissionMode}`,
        renderPermissionModeGuidance(config.permissionMode),
      ].join("\n"),
    },
    {
      id: "system.response-language",
      cacheBucket: "static",
      owner: "runtime",
      priority: 974,
      metadata: {
        responseLanguage: config.responseLanguage,
        source: "runtime-default",
      },
      content: [
        `Default response language: ${config.responseLanguage}`,
        renderResponseLanguageGuidance(config.responseLanguage),
        "Apply this default only when no session override is active for the current turn.",
      ].join("\n"),
    },
    {
      id: "system.output-style",
      cacheBucket: "static",
      owner: "runtime",
      priority: 970,
      metadata: {
        outputStyle: config.outputStyle,
        source: "runtime-default",
      },
      content: [
        `Current output style: ${config.outputStyle}`,
        renderOutputStyleGuidance(config.outputStyle),
      ].join("\n"),
    },
  ];
}
export function createDefaultRuntimePromptRegistry(config) {
  const registry = new PromptSectionRegistry({
    protectedStaticSectionIds: DEFAULT_RUNTIME_PROMPT_SECTION_IDS,
  });
  for (const section of createDefaultRuntimePromptSections(config)) {
    registry.register(section);
  }
  return registry;
}
export function createDefaultRuntimeContextAssembler(config) {
  return new DynamicContextAssembler(createDefaultRuntimePromptRegistry(config));
}
export function createDefaultRuntimePromptSectionContributors(sources) {
  if (sources.skillPromptIndex === undefined && sources.contextualRecall === undefined) {
    return [];
  }
  return [
    {
      id: "director.contextual-recall",
      resolveFingerprint: ({
        userInput,
        taskState,
        availableTools,
        availableToolsets,
        toolResults,
      }) =>
        JSON.stringify({
          userInput,
          taskItems: taskState?.items.map((item) => ({
            id: item.id,
            content: item.content,
            status: item.status,
            ...(item.priority === undefined ? {} : { priority: item.priority }),
          })),
          availableTools,
          availableToolsets,
          toolResults: toolResults?.map((result) => ({
            toolName: result.toolName,
            ok: result.ok,
          })),
        }),
      buildSections: ({ userInput, taskState, availableTools, availableToolsets, toolResults }) => {
        if (userInput === undefined || taskState === undefined) {
          return [];
        }
        const skillSections =
          sources.skillPromptIndex?.buildSections({
            userText: userInput,
            taskState,
            availableTools,
            availableToolsets,
            toolResults: (toolResults ?? []).map((result) => ({
              toolName: result.toolName,
              ok: result.ok,
            })),
          }) ?? [];
        const recallInput = sources.contextualRecall?.build({
          userText: userInput,
          skillSections,
        });
        if (recallInput === undefined) {
          return skillSections;
        }
        const packet = isDirectorCapabilityContextPacket(recallInput)
          ? recallInput
          : resolveDirectorCapabilityContext({
              surface: "production",
              userText: userInput,
              skillSections,
              ...recallInput,
            });
        if (packet.hiddenPromptBlock.length === 0) {
          return skillSections;
        }
        return [
          {
            id: "director.contextual-recall",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 80,
            content: packet.hiddenPromptBlock,
            metadata: {
              recallStatus: packet.recallStatus,
              skillStatus: packet.skillStatus,
              visibleSummary: packet.visibleSummary,
              knowledgeHits: packet.knowledgeHits.length,
              skillHits: packet.skillHits.length,
              recallTrace: packet.recallTrace.length,
              capabilityPlan: packet.capabilityPlan.length,
              policy: packet.policy.surface,
            },
          },
        ];
      },
    },
  ];
}
function isDirectorCapabilityContextPacket(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "hiddenPromptBlock" in value &&
    "policy" in value &&
    "recallStatus" in value &&
    "skillStatus" in value
  );
}
function renderOutputStyleGuidance(style) {
  switch (style) {
    case "concise":
      return "Keep responses brief, high-signal, and low-friction unless the user asks for depth.";
    case "verbose":
      return "Provide fuller explanations, surface tradeoffs, and keep the structure easy to scan.";
    default:
      return "Use balanced detail: enough explanation to orient the operator without bloating the turn.";
  }
}
function renderPermissionModeGuidance(mode) {
  switch (mode) {
    case "allow":
      return "When tool execution is needed and otherwise permitted, proceed without asking for another confirmation and clearly surface meaningful side effects.";
    case "ask":
      return "Treat side-effectful tool actions as approval-gated. If approval is missing, stop and explain exactly what needs confirmation.";
    case "deny":
      return "Do not attempt side-effectful tool actions. Prefer read-only reasoning or explain the blocked action explicitly.";
    default:
      return "Respect the current runtime permission posture and do not assume extra execution authority.";
  }
}
function renderResponseLanguageGuidance(language) {
  if (language === "follow-user") {
    return "Default response language policy: follow the user's language unless session guidance overrides this turn.";
  }
  return `Default response language policy: answer in ${language} unless session guidance overrides this turn.`;
}
//# sourceMappingURL=prompt-sections.js.map
