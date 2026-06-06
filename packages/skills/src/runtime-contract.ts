import type { SkillSnapshot } from "./repository.js";

export const SKILL_RUNTIME_CONTRACT_SCHEMA_ID = "skills.runtime-contract.v1" as const;
export const SKILL_RUNTIME_USE_SCOPE = "skills.use" as const;

export type SkillRuntimeOperatorSurface =
  | "desktop-local"
  | "host-api"
  | "weixin"
  | "cli"
  | "automation"
  | "unknown";

export type SkillRuntimeContractStatus = "allowed" | "needs_setup" | "fallback" | "blocked";

export type SkillRuntimeContractReasonCode =
  | "runtime_contract_admitted"
  | "missing_required_capability"
  | "fallback_preferred"
  | "guard_blocked";

export type SkillRuntimeGuardStatus = "allowed" | "blocked" | "operator_scope_required";

export type SkillRuntimeGuardReasonCode =
  | "guard_admitted"
  | "surface_not_allowed"
  | "missing_operator_scope";

export interface SkillRuntimeOperatorContext {
  readonly actor?: string;
  readonly surface?: SkillRuntimeOperatorSurface | string;
  readonly scopes?: readonly string[];
}

export interface ResolveSkillRuntimeContractInput {
  readonly skill: SkillSnapshot;
  readonly availableTools?: readonly string[];
  readonly availableToolsets?: readonly string[];
  readonly operator?: SkillRuntimeOperatorContext | null;
  readonly nowMs?: number;
}

export interface SkillRuntimeConditionalLoading {
  readonly requiredTools: readonly string[];
  readonly requiredToolsets: readonly string[];
  readonly fallbackForTools: readonly string[];
  readonly fallbackForToolsets: readonly string[];
  readonly matched: boolean;
  readonly missingTools: readonly string[];
  readonly missingToolsets: readonly string[];
  readonly conflictingTools: readonly string[];
  readonly conflictingToolsets: readonly string[];
}

export interface SkillRuntimeSetupOnLoad {
  readonly required: boolean;
  readonly summary: string | null;
  readonly nextActions: readonly string[];
}

export interface SkillRuntimeFallback {
  readonly recommended: boolean;
  readonly skillIds: readonly string[];
  readonly toolNames: readonly string[];
  readonly reason: string | null;
}

export interface SkillRuntimeGuardResult {
  readonly allowed: boolean;
  readonly status: SkillRuntimeGuardStatus;
  readonly reasonCode: SkillRuntimeGuardReasonCode;
  readonly operatorSurface: SkillRuntimeOperatorSurface;
  readonly operatorActor: string | null;
  readonly allowedSurfaces: readonly SkillRuntimeOperatorSurface[];
  readonly requiredScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly missingScopes: readonly string[];
  readonly summary: string;
  readonly nextActions: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface SkillRuntimeContractResult {
  readonly schemaId: typeof SKILL_RUNTIME_CONTRACT_SCHEMA_ID;
  readonly skillId: string;
  readonly title: string;
  readonly loadable: boolean;
  readonly status: SkillRuntimeContractStatus;
  readonly reasonCode: SkillRuntimeContractReasonCode;
  readonly summary: string;
  readonly conditionalLoading: SkillRuntimeConditionalLoading;
  readonly setupOnLoad: SkillRuntimeSetupOnLoad;
  readonly fallback: SkillRuntimeFallback;
  readonly guard: SkillRuntimeGuardResult;
  readonly nextActions: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly generatedAtMs: number;
}

interface RuntimeContractMetadata {
  readonly hermes: Readonly<Record<string, unknown>>;
  readonly guard: Readonly<Record<string, unknown>>;
}

export function resolveSkillRuntimeContract(
  input: ResolveSkillRuntimeContractInput,
): SkillRuntimeContractResult {
  const generatedAtMs = normalizeNowMs(input.nowMs);
  const metadata = readRuntimeContractMetadata(input.skill);
  const availableTools = normalizeNameSet(input.availableTools);
  const availableToolsets = normalizeNameSet(input.availableToolsets);
  const conditionalLoading = resolveConditionalLoading({
    hermes: metadata.hermes,
    availableTools,
    availableToolsets,
  });
  const setupOnLoad = resolveSetupOnLoad(metadata.hermes, conditionalLoading);
  const fallback = resolveFallback(metadata.hermes, conditionalLoading);
  const guard = resolveSkillRuntimeGuard({
    skillId: input.skill.id,
    guard: metadata.guard,
    ...(input.operator === undefined ? {} : { operator: input.operator }),
  });
  const evidenceRefs = [
    ...conditionalLoading.missingTools.map(
      (toolName) => `skill-runtime://${input.skill.id}/missing-tool/${toolName}`,
    ),
    ...conditionalLoading.missingToolsets.map(
      (toolsetName) => `skill-runtime://${input.skill.id}/missing-toolset/${toolsetName}`,
    ),
    ...conditionalLoading.conflictingTools.map(
      (toolName) => `skill-runtime://${input.skill.id}/fallback-conflict-tool/${toolName}`,
    ),
    ...conditionalLoading.conflictingToolsets.map(
      (toolsetName) => `skill-runtime://${input.skill.id}/fallback-conflict-toolset/${toolsetName}`,
    ),
    ...fallback.skillIds.map((skillId) => `skill-runtime://${input.skill.id}/fallback/${skillId}`),
    ...guard.evidenceRefs,
  ];

  if (!guard.allowed) {
    return {
      schemaId: SKILL_RUNTIME_CONTRACT_SCHEMA_ID,
      skillId: input.skill.id,
      title: input.skill.title,
      loadable: false,
      status: "blocked",
      reasonCode: "guard_blocked",
      summary: guard.summary,
      conditionalLoading,
      setupOnLoad,
      fallback,
      guard,
      nextActions: guard.nextActions,
      evidenceRefs,
      generatedAtMs,
    };
  }

  if (!conditionalLoading.matched) {
    const nextActions = [
      ...setupOnLoad.nextActions,
      ...(fallback.recommended
        ? [`改用 fallback Skill：${fallback.skillIds.join(", ") || "未声明具体 Skill"}`]
        : []),
    ];
    return {
      schemaId: SKILL_RUNTIME_CONTRACT_SCHEMA_ID,
      skillId: input.skill.id,
      title: input.skill.title,
      loadable: false,
      status: "needs_setup",
      reasonCode: "missing_required_capability",
      summary: createConditionalBlockedSummary(input.skill, conditionalLoading, fallback),
      conditionalLoading,
      setupOnLoad,
      fallback,
      guard,
      nextActions:
        nextActions.length > 0
          ? nextActions
          : ["先完成 Skill 声明的依赖工具/工具集配置，再加载该 Skill。"],
      evidenceRefs,
      generatedAtMs,
    };
  }

  return {
    schemaId: SKILL_RUNTIME_CONTRACT_SCHEMA_ID,
    skillId: input.skill.id,
    title: input.skill.title,
    loadable: true,
    status: "allowed",
    reasonCode: "runtime_contract_admitted",
    summary: `Skill runtime contract admitted: ${input.skill.title}.`,
    conditionalLoading,
    setupOnLoad,
    fallback,
    guard,
    nextActions: ["可以加载 Skill 内容；如果后续执行外部工具，仍需遵守对应工具审批和沙箱边界。"],
    evidenceRefs,
    generatedAtMs,
  };
}

function resolveConditionalLoading(input: {
  readonly hermes: Readonly<Record<string, unknown>>;
  readonly availableTools: ReadonlySet<string> | null;
  readonly availableToolsets: ReadonlySet<string> | null;
}): SkillRuntimeConditionalLoading {
  const requiredTools = normalizeStringList(input.hermes.requires_tools);
  const requiredToolsets = normalizeStringList(input.hermes.requires_toolsets);
  const fallbackForTools = normalizeStringList(input.hermes.fallback_for_tools);
  const fallbackForToolsets = normalizeStringList(input.hermes.fallback_for_toolsets);
  const missingTools =
    input.availableTools === null
      ? []
      : requiredTools.filter((toolName) => !input.availableTools?.has(toolName));
  const missingToolsets =
    input.availableToolsets === null
      ? []
      : requiredToolsets.filter((toolsetName) => !input.availableToolsets?.has(toolsetName));
  const conflictingTools =
    input.availableTools === null
      ? []
      : fallbackForTools.filter((toolName) => input.availableTools?.has(toolName));
  const conflictingToolsets =
    input.availableToolsets === null
      ? []
      : fallbackForToolsets.filter((toolsetName) => input.availableToolsets?.has(toolsetName));

  return {
    requiredTools,
    requiredToolsets,
    fallbackForTools,
    fallbackForToolsets,
    matched:
      missingTools.length === 0 &&
      missingToolsets.length === 0 &&
      conflictingTools.length === 0 &&
      conflictingToolsets.length === 0,
    missingTools,
    missingToolsets,
    conflictingTools,
    conflictingToolsets,
  };
}

function resolveSetupOnLoad(
  hermes: Readonly<Record<string, unknown>>,
  conditionalLoading: SkillRuntimeConditionalLoading,
): SkillRuntimeSetupOnLoad {
  const setup = readRecord(hermes.setup_on_load);
  const required = !conditionalLoading.matched || setup.required === true;
  const summary = normalizeOptionalString(setup.summary) ?? null;
  const nextActions = [
    ...normalizeStringList(setup.next_actions),
    ...normalizeStringList(setup.nextActions),
  ];
  return {
    required,
    summary,
    nextActions,
  };
}

function resolveFallback(
  hermes: Readonly<Record<string, unknown>>,
  conditionalLoading: SkillRuntimeConditionalLoading,
): SkillRuntimeFallback {
  const skillIds = [
    ...normalizeStringList(hermes.fallback_skill_ids),
    ...normalizeStringList(hermes.fallbackSkillIds),
  ];
  const toolNames = [
    ...normalizeStringList(hermes.fallback_tools),
    ...normalizeStringList(hermes.fallbackTools),
  ];
  const reason = normalizeOptionalString(hermes.fallback_reason ?? hermes.fallbackReason) ?? null;
  return {
    recommended: !conditionalLoading.matched && (skillIds.length > 0 || toolNames.length > 0),
    skillIds,
    toolNames,
    reason,
  };
}

function resolveSkillRuntimeGuard(input: {
  readonly skillId: string;
  readonly guard: Readonly<Record<string, unknown>>;
  readonly operator?: SkillRuntimeOperatorContext | null;
}): SkillRuntimeGuardResult {
  const operatorSurface = normalizeOperatorSurface(input.operator?.surface);
  const operatorActor = normalizeOptionalString(input.operator?.actor) ?? null;
  const grantedScopes = uniqueStrings(input.operator?.scopes ?? []);
  const allowedSurfaces = normalizeOperatorSurfaces(input.guard.allowed_surfaces);
  const requiredScopes = [
    ...normalizeStringList(input.guard.required_scopes),
    ...normalizeStringList(input.guard.requiredScopes),
  ];
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  const surfaceAllowed = allowedSurfaces.length === 0 || allowedSurfaces.includes(operatorSurface);
  const evidenceRefs = [
    ...(surfaceAllowed ? [] : [`skill-runtime://${input.skillId}/guard/surface-not-allowed`]),
    ...missingScopes.map(
      (scope) => `skill-runtime://${input.skillId}/guard/missing-scope/${scope}`,
    ),
  ];

  if (!surfaceAllowed) {
    return {
      allowed: false,
      status: "blocked",
      reasonCode: "surface_not_allowed",
      operatorSurface,
      operatorActor,
      allowedSurfaces,
      requiredScopes,
      grantedScopes,
      missingScopes,
      summary: "Skill guard blocked this runtime surface.",
      nextActions: ["切换到 Skill guard 允许的入口后再加载，或由本地 operator 调整 Skill guard。"],
      evidenceRefs,
    };
  }

  if (missingScopes.length > 0) {
    return {
      allowed: false,
      status: "operator_scope_required",
      reasonCode: "missing_operator_scope",
      operatorSurface,
      operatorActor,
      allowedSurfaces,
      requiredScopes,
      grantedScopes,
      missingScopes,
      summary: "Skill guard requires additional operator scope before loading.",
      nextActions: [
        `授予 operator scope 后再加载：${missingScopes.join(", ")}。`,
        "没有 scope 时不要把该 Skill 当作已读取或已应用。",
      ],
      evidenceRefs,
    };
  }

  return {
    allowed: true,
    status: "allowed",
    reasonCode: "guard_admitted",
    operatorSurface,
    operatorActor,
    allowedSurfaces,
    requiredScopes,
    grantedScopes,
    missingScopes,
    summary: "Skill guard admitted this runtime load.",
    nextActions: [],
    evidenceRefs,
  };
}

function createConditionalBlockedSummary(
  skill: SkillSnapshot,
  conditionalLoading: SkillRuntimeConditionalLoading,
  fallback: SkillRuntimeFallback,
): string {
  const missing = [
    ...conditionalLoading.missingTools.map((toolName) => `tool:${toolName}`),
    ...conditionalLoading.missingToolsets.map((toolsetName) => `toolset:${toolsetName}`),
  ];
  if (fallback.recommended) {
    return `Skill ${skill.title} requires setup; fallback is recommended before loading.`;
  }
  return `Skill ${skill.title} cannot load until required capabilities are ready: ${missing.join(
    ", ",
  )}.`;
}

function readRuntimeContractMetadata(skill: SkillSnapshot): RuntimeContractMetadata {
  const metadata = readRecord(skill.metadata);
  const hermes = readRecord(metadata.hermes);
  return {
    hermes,
    guard: readRecord(metadata.guard),
  };
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function normalizeNameSet(values: readonly string[] | undefined): ReadonlySet<string> | null {
  if (values === undefined) {
    return null;
  }
  return new Set(uniqueStrings(values));
}

function normalizeOperatorSurfaces(value: unknown): readonly SkillRuntimeOperatorSurface[] {
  return normalizeStringList(value).map(normalizeOperatorSurface);
}

function normalizeOperatorSurface(surface: unknown): SkillRuntimeOperatorSurface {
  if (
    surface === "desktop-local" ||
    surface === "host-api" ||
    surface === "weixin" ||
    surface === "cli" ||
    surface === "automation"
  ) {
    return surface;
  }
  return "unknown";
}

function normalizeStringList(value: unknown): readonly string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return uniqueStrings(raw);
}

function uniqueStrings(values: readonly unknown[]): readonly string[] {
  return [
    ...new Set(
      values
        .map((value) => normalizeOptionalString(value))
        .filter((value): value is string => value !== undefined),
    ),
  ];
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeNowMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : Date.now();
}
