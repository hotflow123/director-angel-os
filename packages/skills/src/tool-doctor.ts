export type SkillDoctorStatus = "disabled" | "model-invocation-disabled" | "needs-setup" | "ready";

export interface SkillToolDoctorDetail {
  readonly toolName: string;
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly canInvoke: boolean;
  readonly summary: string;
  readonly nextActions: readonly string[];
}

export interface SkillToolDoctorIndex {
  readonly knownToolNames: Set<string>;
  readonly readyToolNames: Set<string>;
  readonly toolsByName: Map<string, SkillToolDoctorDetail>;
}

export interface SkillDoctorResult {
  readonly status: SkillDoctorStatus;
  readonly summary: string;
  readonly availableToolNames: readonly string[];
  readonly missingToolNames: readonly string[];
  readonly uncheckedToolNames: readonly string[];
  readonly nextActions: readonly string[];
}

export interface SkillRuntimeStatusSummary {
  readonly total: number;
  readonly readyCount: number;
  readonly needsSetupCount: number;
  readonly disabledCount: number;
  readonly modelInvocationDisabledCount: number;
  readonly missingSkillCount: number;
  readonly modelVisibleCount: number;
  readonly eligibleCount: number;
  readonly blockedCount: number;
  readonly uncheckedToolCount: number;
  readonly missingToolNames: readonly string[];
  readonly uncheckedToolNames: readonly string[];
  readonly statusCounts: Readonly<Record<string, number>>;
  readonly status: "empty" | "mixed" | "needs-attention" | "ready";
  readonly nextActions: readonly string[];
}

export interface SkillExternalToolBusSnapshot {
  readonly externalToolBus?: {
    readonly items?: readonly unknown[];
  };
}

export function summarizeSkillRuntimeStatuses(
  skills: readonly Readonly<Record<string, unknown>>[],
): SkillRuntimeStatusSummary {
  const statusCounts = new Map<string, number>();
  let readyCount = 0;
  let needsSetupCount = 0;
  let disabledCount = 0;
  let modelInvocationDisabledCount = 0;
  let missingSkillCount = 0;
  let modelVisibleCount = 0;
  let eligibleCount = 0;
  let uncheckedToolCount = 0;
  const missingToolNames: string[] = [];
  const uncheckedToolNames: string[] = [];

  for (const skill of skills) {
    const runtimeStatus = readString(
      skill.runtimeStatus,
      readString(skill.doctorStatus, "unknown"),
    );
    statusCounts.set(runtimeStatus, (statusCounts.get(runtimeStatus) ?? 0) + 1);
    if (runtimeStatus === "ready") {
      readyCount += 1;
    }
    if (runtimeStatus === "needs-setup") {
      needsSetupCount += 1;
    }
    if (runtimeStatus === "disabled") {
      disabledCount += 1;
    }
    if (runtimeStatus === "model-invocation-disabled") {
      modelInvocationDisabledCount += 1;
    }
    if (runtimeStatus === "missing-skill" || runtimeStatus === "missing_skill") {
      missingSkillCount += 1;
    }
    if (skill.modelVisible !== false) {
      modelVisibleCount += 1;
    }
    if (skill.eligible !== false) {
      eligibleCount += 1;
    }
    missingToolNames.push(...normalizeStringArray(skill.missingToolNames));
    const unchecked = normalizeStringArray(skill.uncheckedToolNames);
    uncheckedToolNames.push(...unchecked);
    uncheckedToolCount += unchecked.length;
  }

  const blockedCount = skills.length - readyCount;
  const attentionCount = needsSetupCount + modelInvocationDisabledCount + missingSkillCount;
  return {
    total: skills.length,
    readyCount,
    needsSetupCount,
    disabledCount,
    modelInvocationDisabledCount,
    missingSkillCount,
    modelVisibleCount,
    eligibleCount,
    blockedCount,
    uncheckedToolCount,
    missingToolNames: uniqueStringArray(missingToolNames),
    uncheckedToolNames: uniqueStringArray(uncheckedToolNames),
    statusCounts: Object.fromEntries(statusCounts.entries()),
    status:
      skills.length === 0
        ? "empty"
        : attentionCount > 0
          ? "needs-attention"
          : disabledCount > 0 || blockedCount > 0
            ? "mixed"
            : "ready",
    nextActions: createSkillRuntimeSummaryNextActions({
      needsSetupCount,
      modelInvocationDisabledCount,
      missingSkillCount,
      uncheckedToolCount,
    }),
  };
}

export function createEmptySkillToolDoctorIndex(): SkillToolDoctorIndex {
  return {
    knownToolNames: new Set<string>(),
    readyToolNames: new Set<string>(),
    toolsByName: new Map<string, SkillToolDoctorDetail>(),
  };
}

export function createSkillToolDoctorIndex(
  toolsSnapshot: SkillExternalToolBusSnapshot | null | undefined,
): SkillToolDoctorIndex {
  const index = createEmptySkillToolDoctorIndex();
  const busItems = Array.isArray(toolsSnapshot?.externalToolBus?.items)
    ? toolsSnapshot.externalToolBus.items
    : [];
  for (const item of busItems) {
    if (!isRecord(item)) {
      continue;
    }
    const modelToolNames = collectExternalToolBusModelToolNames(item);
    const canInvoke = item.canInvoke === true || item.status === "ready";
    for (const toolName of modelToolNames) {
      index.knownToolNames.add(toolName);
      if (canInvoke) {
        index.readyToolNames.add(toolName);
      }
      const existing = index.toolsByName.get(toolName);
      if (existing === undefined || (!existing.canInvoke && canInvoke)) {
        index.toolsByName.set(toolName, {
          toolName,
          id: readString(item.id, toolName),
          label: readString(item.label, readString(item.id, toolName)),
          status: readString(item.status, readString(readRecord(item.doctor)?.status, "unknown")),
          canInvoke,
          summary:
            readString(readRecord(item.doctor)?.summary, "") ||
            readString(item.unavailableReason, ""),
          nextActions: normalizeStringArray(readRecord(item.doctor)?.nextActions),
        });
      }
    }
  }
  return index;
}

export function deriveSkillDoctor(input: {
  readonly toolNames?: readonly string[];
  readonly enabled: boolean;
  readonly modelInvocable: boolean;
  readonly toolDoctor?: SkillToolDoctorIndex | null;
}): SkillDoctorResult {
  if (!input.enabled) {
    return {
      status: "disabled",
      summary: "Skill 已关闭。",
      availableToolNames: [],
      missingToolNames: [],
      uncheckedToolNames: [],
      nextActions: ["启用该 Skill 后再检查工具依赖。"],
    };
  }
  if (!input.modelInvocable) {
    return {
      status: "model-invocation-disabled",
      summary: "Skill 标记为模型不可调用。",
      availableToolNames: [],
      missingToolNames: [],
      uncheckedToolNames: [],
      nextActions: ["如需模型在对话中调用，先移除 disableModelInvocation。"],
    };
  }
  const toolDoctor = input.toolDoctor ?? createEmptySkillToolDoctorIndex();
  const declaredToolNames = uniqueStringArray(input.toolNames ?? []);
  if (declaredToolNames.length === 0) {
    return {
      status: "ready",
      summary: "Skill 未声明强工具依赖。",
      availableToolNames: [],
      missingToolNames: [],
      uncheckedToolNames: [],
      nextActions: [],
    };
  }
  const availableToolNames: string[] = [];
  const missingToolNames: string[] = [];
  const uncheckedToolNames: string[] = [];
  const unavailableDetails: string[] = [];
  for (const toolName of declaredToolNames) {
    if (!toolDoctor.knownToolNames.has(toolName)) {
      uncheckedToolNames.push(toolName);
      continue;
    }
    const detail = toolDoctor.toolsByName.get(toolName);
    if (toolDoctor.readyToolNames.has(toolName)) {
      availableToolNames.push(toolName);
      continue;
    }
    missingToolNames.push(toolName);
    if (detail !== undefined) {
      unavailableDetails.push(
        `${toolName}: ${detail.status}${detail.summary ? `；${detail.summary}` : ""}`,
      );
    }
  }
  if (missingToolNames.length > 0) {
    return {
      status: "needs-setup",
      summary: `Skill 声明的工具尚不可用：${missingToolNames.join(", ")}。${unavailableDetails.join(" | ")}`,
      availableToolNames,
      missingToolNames,
      uncheckedToolNames,
      nextActions: createSkillDoctorNextActions(missingToolNames, toolDoctor),
    };
  }
  return {
    status: "ready",
    summary:
      uncheckedToolNames.length === 0
        ? "Skill 声明的工具依赖已可用。"
        : `Skill 声明的已知工具可用；未识别工具按兼容模式跳过：${uncheckedToolNames.join(", ")}。`,
    availableToolNames,
    missingToolNames: [],
    uncheckedToolNames,
    nextActions:
      uncheckedToolNames.length === 0
        ? []
        : ["如这些未识别工具属于外部能力，请补 provider manifest/doctor 后再强约束。"],
  };
}

function createSkillRuntimeSummaryNextActions(input: {
  readonly needsSetupCount: number;
  readonly modelInvocationDisabledCount: number;
  readonly missingSkillCount: number;
  readonly uncheckedToolCount: number;
}): readonly string[] {
  const actions: string[] = [];
  if (input.missingSkillCount > 0) {
    actions.push("刷新 Skill 索引，移除已删除 Skill 的旧上下文。");
  }
  if (input.needsSetupCount > 0) {
    actions.push("先配置或启用缺失的外部工具 provider，再让模型调用相关 Skill。");
  }
  if (input.modelInvocationDisabledCount > 0) {
    actions.push("需要模型调用的 Skill，先在管理页打开模型调用权限。");
  }
  if (input.uncheckedToolCount > 0) {
    actions.push("为未识别工具补 provider manifest/doctor，避免兼容模式漏检。");
  }
  return actions;
}

function createSkillDoctorNextActions(
  missingToolNames: readonly string[],
  toolDoctor: SkillToolDoctorIndex,
): readonly string[] {
  const actions: string[] = [];
  for (const toolName of missingToolNames) {
    const detail = toolDoctor.toolsByName.get(toolName);
    const detailActions = Array.isArray(detail?.nextActions) ? detail.nextActions : [];
    if (detailActions.length > 0) {
      actions.push(...detailActions.map((action) => `${toolName}: ${action}`));
      continue;
    }
    actions.push(`配置或启用 ${toolName} 对应的外部 provider。`);
  }
  return uniqueStringArray(actions);
}

function collectExternalToolBusModelToolNames(
  item: Readonly<Record<string, unknown>>,
): readonly string[] {
  const metadata = readRecord(item.metadata);
  const capabilities = Array.isArray(item.capabilities) ? item.capabilities : [];
  return uniqueStringArray([
    typeof item.id === "string" && item.kind === "model-tool" ? item.id : "",
    readString(metadata?.modelToolName, ""),
    ...normalizeStringArray(metadata?.modelToolNames),
    ...normalizeStringArray(
      capabilities
        .map((capability) => readRecord(capability)?.metadata)
        .map((metadataValue) => readRecord(metadataValue)?.modelToolName),
    ),
    ...normalizeStringArray(
      capabilities
        .map((capability) => readRecord(capability)?.metadata)
        .map((metadataValue) => readRecord(metadataValue)?.toolName),
    ),
  ]);
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
  return typeof value === "string" ? value : fallback;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
