export const SKILL_EXPLANATION_SURFACE_SCHEMA_ID = "skills.explanation-surface.v1";

export type SkillExplanationSurfaceKind = "skill-curator" | "skill-runtime";

export interface SkillExplanationSurface {
  readonly schemaId: typeof SKILL_EXPLANATION_SURFACE_SCHEMA_ID;
  readonly kind: SkillExplanationSurfaceKind;
  readonly status: string;
  readonly summary: string;
  readonly statusExplanation: string;
  readonly operatorReviewRequired: boolean;
  readonly nextActions: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly operatorReviewGate?: string;
  readonly operatorReviewExplanation?: string;
  readonly curatorExplanation?: string;
}

export interface CreateSkillExplanationSurfaceInput {
  readonly skill: Readonly<Record<string, unknown>>;
  readonly requestedSkillId?: string;
  readonly actionLabel?: string;
}

export function createSkillExplanationSurface(
  input: CreateSkillExplanationSurfaceInput,
): SkillExplanationSurface {
  const skill = input.skill;
  const metadata = readRecord(skill.metadata);
  const requestedSkillId = readString(input.requestedSkillId, "");
  const skillId = readString(skill.id, requestedSkillId || "unknown-skill");
  const title = readString(skill.title, skillId);
  const status = normalizeSkillRuntimeStatus(
    readString(skill.runtimeStatus, readString(skill.doctorStatus, "ready")),
  );
  const missingToolNames = normalizeStringArray(skill.missingToolNames);
  const declaredNextActions = normalizeStringArray(skill.nextActions);
  const doctorSummary = readString(skill.doctorSummary, readString(skill.disabledReason, ""));
  const operatorReviewGate = resolveOperatorReviewGate(skill, metadata, status);
  const operatorReviewRequired = operatorReviewGate !== undefined;
  const statusExplanation = createRuntimeStatusExplanation({
    title,
    status,
    doctorSummary,
    missingToolNames,
  });
  const operatorReviewExplanation = operatorReviewRequired
    ? createOperatorReviewExplanation(title, operatorReviewGate)
    : undefined;
  const nextActions = uniqueStringArray([
    ...declaredNextActions,
    ...createRuntimeNextActions({
      status,
      missingToolNames,
      operatorReviewRequired,
    }),
  ]);
  const evidenceRefs = uniqueStringArray([
    `skill://${skillId}`,
    readString(metadata?.sourceExperienceRef, ""),
    readString(metadata?.evidenceRef, ""),
    ...missingToolNames.map((toolName) => `tool://${toolName}`),
  ]);

  return {
    schemaId: SKILL_EXPLANATION_SURFACE_SCHEMA_ID,
    kind: "skill-runtime",
    status,
    summary: createRuntimeSummary({ title, status, missingToolNames }),
    statusExplanation,
    operatorReviewRequired,
    nextActions,
    evidenceRefs,
    ...(operatorReviewGate === undefined ? {} : { operatorReviewGate }),
    ...(operatorReviewExplanation === undefined ? {} : { operatorReviewExplanation }),
  };
}

export function createSkillCuratorExplanationSurface(
  action: Readonly<Record<string, unknown>>,
): SkillExplanationSurface {
  const kind = readString(action.kind, "keep");
  const skillId = readString(action.skillId, "unknown-skill");
  const title = readString(action.title, skillId);
  const reason = readString(action.reason, "Skill curator suggested maintenance.");
  const duplicateSkillIds = normalizeStringArray(action.duplicateSkillIds);
  const status = `curator-${kind}`;
  const operatorReviewRequired = kind !== "keep";
  const curatorExplanation =
    "这是本地 operator-gated Skill 维护建议：修补、归档或合并必须由操作员确认；不会让模型自动改写 Skill，也不会开放远程写操作。";
  const nextActions = createCuratorNextActions(kind);
  const evidenceRefs = uniqueStringArray([
    `skill-curator://${kind}/${skillId}`,
    ...duplicateSkillIds.map((duplicateSkillId) => `skill-curator://duplicate/${duplicateSkillId}`),
  ]);

  return {
    schemaId: SKILL_EXPLANATION_SURFACE_SCHEMA_ID,
    kind: "skill-curator",
    status,
    summary: `Curator 建议 ${formatCuratorKind(kind)} Skill「${title}」。`,
    statusExplanation: reason,
    operatorReviewRequired,
    nextActions,
    evidenceRefs,
    curatorExplanation,
    ...(operatorReviewRequired
      ? {
          operatorReviewGate: "curator-operator-gated",
          operatorReviewExplanation:
            "需要操作员在 Review/Ops 中人工审核后才会写入本地 Skill snapshot 或 usage evidence。",
        }
      : {}),
  };
}

export function formatSkillExplanationSurfaceForToolObservation(
  surface: SkillExplanationSurface | Readonly<Record<string, unknown>> | null | undefined,
): readonly string[] {
  if (!isRecord(surface)) {
    return [];
  }
  const status = readString(surface.status, "");
  const statusExplanation = readString(surface.statusExplanation, "");
  const operatorReviewRequired = surface.operatorReviewRequired === true;
  const operatorReviewGate = readString(surface.operatorReviewGate, "");
  const operatorReviewExplanation = readString(surface.operatorReviewExplanation, "");
  const curatorExplanation = readString(surface.curatorExplanation, "");
  const nextActions = normalizeStringArray(surface.nextActions);
  const evidenceRefs = normalizeStringArray(surface.evidenceRefs);
  return [
    status.length > 0 ? `explanation_status: ${status}` : "",
    statusExplanation.length > 0 ? `status_explanation: ${statusExplanation}` : "",
    `operator_review: ${operatorReviewRequired ? "yes" : "no"}${
      operatorReviewGate.length > 0 ? `; gate=${operatorReviewGate}` : ""
    }`,
    operatorReviewExplanation.length > 0
      ? `operator_review_explanation: ${operatorReviewExplanation}`
      : "",
    curatorExplanation.length > 0 ? `curator_explanation: ${curatorExplanation}` : "",
    nextActions.length > 0 ? `explanation_next_actions: ${nextActions.join("；")}` : "",
    evidenceRefs.length > 0 ? `explanation_evidence: ${evidenceRefs.join("；")}` : "",
  ].filter((line) => line.length > 0);
}

function createRuntimeSummary(input: {
  readonly title: string;
  readonly status: string;
  readonly missingToolNames: readonly string[];
}): string {
  if (input.status === "missing-skill") {
    return `Skill「${input.title}」已从当前已批准快照移除。`;
  }
  if (input.status === "needs-setup") {
    return `Skill「${input.title}」依赖未就绪${
      input.missingToolNames.length > 0 ? `，缺失工具：${input.missingToolNames.join(", ")}` : ""
    }。`;
  }
  if (input.status === "model-invocation-disabled") {
    return `Skill「${input.title}」需要人工审核或操作员权限后才可模型调用。`;
  }
  if (input.status === "disabled") {
    return `Skill「${input.title}」已关闭。`;
  }
  return `Skill「${input.title}」当前可用。`;
}

function createRuntimeStatusExplanation(input: {
  readonly title: string;
  readonly status: string;
  readonly doctorSummary: string;
  readonly missingToolNames: readonly string[];
}): string {
  if (input.status === "missing-skill") {
    return `旧上下文仍在引用 Skill「${input.title}」，但它不存在或已从当前已批准快照移除；当前轮不能读取、应用或执行。`;
  }
  if (input.status === "needs-setup") {
    const missing =
      input.missingToolNames.length > 0
        ? `缺失或不可用工具：${input.missingToolNames.join(", ")}。`
        : "";
    return `Skill「${input.title}」依赖未就绪。${missing}${input.doctorSummary}`;
  }
  if (input.status === "model-invocation-disabled") {
    return `Skill「${input.title}」被标记为模型不可调用；普通对话不会自动加载、应用或执行。`;
  }
  if (input.status === "disabled") {
    return `Skill「${input.title}」当前被操作员关闭，不会进入模型可见 Skill 索引。`;
  }
  return input.doctorSummary || `Skill「${input.title}」已通过运行时可用性检查。`;
}

function createRuntimeNextActions(input: {
  readonly status: string;
  readonly missingToolNames: readonly string[];
  readonly operatorReviewRequired: boolean;
}): readonly string[] {
  const actions: string[] = [];
  if (input.status === "missing-skill") {
    actions.push("重新调用 director.skills.list 刷新 Skill 索引。");
    actions.push("当前轮不要假装已经读取、应用或执行这个 Skill。");
  }
  if (input.status === "needs-setup") {
    const tools = input.missingToolNames.join(", ");
    actions.push(
      tools.length > 0
        ? `先配置或启用缺失的外部工具 provider：${tools}。`
        : "先完成 Skill 依赖工具配置。",
    );
  }
  if (input.operatorReviewRequired) {
    actions.push("由操作员在 Skills 管理或 Review/Ops 中完成人工审核，再决定是否开放模型调用。");
  }
  if (input.status === "disabled") {
    actions.push("如用户确实要使用它，先请求操作员启用该 Skill。");
  }
  return actions;
}

function resolveOperatorReviewGate(
  skill: Readonly<Record<string, unknown>>,
  metadata: Readonly<Record<string, unknown>> | null,
  status: string,
): string | undefined {
  const explicitGate = readString(
    metadata?.modelInvocationGate,
    readString(skill.modelInvocationGate, ""),
  );
  if (explicitGate.length > 0 && explicitGate !== "none") {
    return explicitGate;
  }
  if (
    status === "model-invocation-disabled" ||
    skill.modelInvocable === false ||
    skill.disableModelInvocation === true ||
    metadata?.disableModelInvocation === true
  ) {
    return "operator-review-required";
  }
  return undefined;
}

function createOperatorReviewExplanation(title: string, gate: string): string {
  if (gate === "restricted-experience") {
    return `Skill「${title}」来自 restricted experience，需要人工审核确认隐私与证据边界后，才可考虑开放模型调用。`;
  }
  return `Skill「${title}」需要人工审核或操作员授权后，才可进入普通对话模型调用路径。`;
}

function createCuratorNextActions(kind: string): readonly string[] {
  if (kind === "patch") {
    return ["人工确认 Skill 已修补后，再标记已修补以清理失败计数并保留 patch evidence。"];
  }
  if (kind === "archive") {
    return ["人工确认 Skill 已过期或不再适用后，再归档并写入新的 approved Skill snapshot。"];
  }
  if (kind === "merge") {
    return ["人工确认 canonical 与 duplicate 的正文、标签和工具依赖后，再合并重复项。"];
  }
  return ["保持观察，不需要写入 curator 维护动作。"];
}

function formatCuratorKind(kind: string): string {
  if (kind === "patch") {
    return "修补";
  }
  if (kind === "archive") {
    return "归档";
  }
  if (kind === "merge") {
    return "合并";
  }
  return "保留";
}

function normalizeSkillRuntimeStatus(status: string): string {
  if (status === "missing_skill") {
    return "missing-skill";
  }
  if (status === "needs_setup") {
    return "needs-setup";
  }
  if (status === "model_invocation_disabled") {
    return "model-invocation-disabled";
  }
  return status;
}

function uniqueStringArray(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeStringArray(values: unknown): readonly string[] {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
