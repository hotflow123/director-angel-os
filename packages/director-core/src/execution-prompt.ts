import type {
  DirectorContext,
  DirectorControlResult,
  DirectorPlan,
  ExecutionPromptBundle,
  ExecutionPromptSection,
  ExecutionPromptVisibility,
} from "./types.js";

function createExecutionPromptSection(
  id: string,
  visibility: ExecutionPromptVisibility,
  content: string,
): ExecutionPromptSection {
  return {
    id,
    visibility,
    content,
  };
}

function renderExecutionPromptSections(
  sections: readonly ExecutionPromptSection[],
  visibility: ExecutionPromptVisibility,
  separator: string,
): string | undefined {
  const rendered = sections
    .filter((section) => section.visibility === visibility)
    .map((section) => section.content.trim())
    .filter((content) => content.length > 0)
    .join(separator);

  return rendered.length > 0 ? rendered : undefined;
}

export function createExecutionPromptBundle(input: {
  readonly context: DirectorContext;
  readonly plan: DirectorPlan;
  readonly controlResult: DirectorControlResult;
}): ExecutionPromptBundle {
  const { context, plan, controlResult } = input;
  const sections: ExecutionPromptSection[] = [
    createExecutionPromptSection(
      "execution.project",
      "visible",
      `Project: ${context.project.title ?? context.request.projectId}`,
    ),
    createExecutionPromptSection("execution.group", "visible", `Group: ${context.group.groupId}`),
    createExecutionPromptSection(
      "execution.style",
      "visible",
      `Style: ${plan.modeDecision.selectedGenerationStyle}`,
    ),
    createExecutionPromptSection(
      "execution.policy",
      "visible",
      `Policy: ${context.intent.bindingPolicy}`,
    ),
    createExecutionPromptSection(
      "execution.control",
      "visible",
      `Control: ${controlResult.status}`,
    ),
  ];

  if (context.group.anchorIds.length > 0) {
    sections.push(
      createExecutionPromptSection(
        "execution.anchors",
        "hidden",
        `Anchors: ${context.group.anchorIds.join(", ")}`,
      ),
    );
  }

  if ((context.knowledgeSignals?.length ?? 0) > 0) {
    sections.push(
      createExecutionPromptSection(
        "execution.knowledge",
        "hidden",
        `Knowledge: ${(context.knowledgeSignals ?? [])
          .slice(0, 3)
          .map((signal) => `${signal.id}:${signal.description}`)
          .join("; ")}`,
      ),
    );
  }

  if (controlResult.handoffEnvelope) {
    sections.push(
      createExecutionPromptSection(
        "execution.preview",
        "hidden",
        `Preview: ${controlResult.handoffEnvelope.operatorPreview.summaryLines.join(" | ")}`,
      ),
    );
  }

  const visible = renderExecutionPromptSections(sections, "visible", " | ");
  if (visible === undefined) {
    throw new Error("Execution prompt must contain at least one visible section.");
  }

  const hidden = renderExecutionPromptSections(sections, "hidden", "\n");

  return {
    visible,
    ...(hidden === undefined ? {} : { hidden }),
    sections,
  };
}
