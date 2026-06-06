import type { ConversationRuntimeBackgroundJobScheduleDefinition } from "./background-job-scheduler.js";
import type { ConversationRuntimeAngelRoleProfile } from "./types.js";

export type ScheduledLearningCadence = "hourly" | "daily" | "weekly" | (string & {});

export type ScheduledLearningMediaMode =
  | "text_only"
  | "media_inventory"
  | "focused_media"
  | "full_multimodal";

export type ScheduledLearningPrivacy = "public" | "internal" | "confidential" | "restricted";

export type ScheduledLearningAdmissionMode =
  | "auto_stage"
  | "confirm_before_publish"
  | "never_persist";

export type ScheduledLearningExternalKnowledgeMode =
  | "disabled"
  | "sync_summary"
  | "sync_clean_text"
  | "sync_original_files";

export type ScheduledLearningExternalKnowledgeConnector =
  | "notebooklm"
  | "ima"
  | "notion"
  | "obsidian"
  | "feishu"
  | "custom";

export interface ScheduledLearningBudget {
  readonly dailyTokenLimit: number;
  readonly dailyMediaItemLimit: number;
  readonly maxImagesPerRun: number;
  readonly maxVideosPerRun: number;
  readonly maxVideoMinutesPerRun: number;
  readonly maxAudioMinutesPerRun: number;
}

export interface ScheduledLearningExternalKnowledgePolicy {
  readonly mode: ScheduledLearningExternalKnowledgeMode;
  readonly connectors: readonly ScheduledLearningExternalKnowledgeConnector[];
}

export interface ScheduledLearningTaskPolicy {
  readonly taskId: string;
  readonly title: string;
  readonly sources: readonly string[];
  readonly cadence: ScheduledLearningCadence;
  readonly mediaMode: ScheduledLearningMediaMode;
  readonly privacy: ScheduledLearningPrivacy;
  readonly budget: ScheduledLearningBudget;
  readonly admissionMode: ScheduledLearningAdmissionMode;
  readonly externalKnowledge: ScheduledLearningExternalKnowledgePolicy;
}

export interface ScheduledLearningSourcePolicy {
  readonly qualityGate: "high_signal_only" | "trusted_sources_only";
  readonly candidateOnly: true;
}

export interface RoleScopedScheduledLearningTaskPolicy extends ScheduledLearningTaskPolicy {
  readonly roleProfile: ConversationRuntimeAngelRoleProfile;
  readonly learningScope: readonly string[];
  readonly sourcePolicy: ScheduledLearningSourcePolicy;
  readonly candidateOnly: true;
  readonly autoPublish: false;
}

export interface CreateScheduledLearningTaskPolicyInput {
  readonly taskId: string;
  readonly title: string;
  readonly sources: readonly string[];
  readonly cadence: ScheduledLearningCadence;
  readonly mediaMode?: ScheduledLearningMediaMode;
  readonly privacy?: ScheduledLearningPrivacy;
  readonly budget?: Partial<ScheduledLearningBudget>;
  readonly admissionMode?: ScheduledLearningAdmissionMode;
  readonly externalKnowledge?: Partial<ScheduledLearningExternalKnowledgePolicy>;
}

export interface CreateRoleScopedScheduledLearningTaskPolicyInput
  extends CreateScheduledLearningTaskPolicyInput {
  readonly roleProfile: ConversationRuntimeAngelRoleProfile;
  readonly learningScope?: readonly string[];
}

export interface CreateRoleScopedScheduledLearningBackgroundScheduleDefinitionInput {
  readonly schedule?: ConversationRuntimeBackgroundJobScheduleDefinition["schedule"];
  readonly sessionKey?: string;
  readonly scheduleId?: string;
  readonly allowedTools?: readonly string[];
}

export type ScheduledLearningTextQuality = "trusted" | "low_quality" | "blocked" | "error";

export interface ScheduledLearningDiscoveredMedia {
  readonly imageCount: number;
  readonly videoCount: number;
  readonly audioCount: number;
}

export interface ResolveScheduledLearningExecutionPlanInput {
  readonly discoveredMedia: ScheduledLearningDiscoveredMedia;
  readonly textQuality: ScheduledLearningTextQuality;
}

export type ScheduledLearningTextStrategy =
  | "extract_trusted_text"
  | "hold_for_review"
  | "skip_untrusted_text";

export type ScheduledLearningMediaStrategy =
  | "skip_media"
  | "record_media_inventory"
  | "understand_selected_media"
  | "understand_all_budgeted_media";

export type ScheduledLearningExternalSyncDecision =
  | "disabled"
  | "sync_summary"
  | "sync_clean_text"
  | "sync_original_files"
  | "blocked_by_privacy";

export interface ScheduledLearningExecutionPlan {
  readonly textStrategy: ScheduledLearningTextStrategy;
  readonly mediaStrategy: ScheduledLearningMediaStrategy;
  readonly allowedImages: number;
  readonly allowedVideos: number;
  readonly allowedAudioMinutes: number;
  readonly externalSync: ScheduledLearningExternalSyncDecision;
  readonly requiresUserConfirmation: boolean;
  readonly qualityGates: readonly string[];
}

const DEFAULT_BUDGET: ScheduledLearningBudget = {
  dailyTokenLimit: 50_000,
  dailyMediaItemLimit: 0,
  maxImagesPerRun: 0,
  maxVideosPerRun: 0,
  maxVideoMinutesPerRun: 0,
  maxAudioMinutesPerRun: 0,
};

const FOCUSED_MEDIA_DEFAULT_BUDGET: ScheduledLearningBudget = {
  dailyTokenLimit: 150_000,
  dailyMediaItemLimit: 12,
  maxImagesPerRun: 8,
  maxVideosPerRun: 2,
  maxVideoMinutesPerRun: 6,
  maxAudioMinutesPerRun: 10,
};

const FULL_MULTIMODAL_DEFAULT_BUDGET: ScheduledLearningBudget = {
  dailyTokenLimit: 500_000,
  dailyMediaItemLimit: 80,
  maxImagesPerRun: 40,
  maxVideosPerRun: 8,
  maxVideoMinutesPerRun: 30,
  maxAudioMinutesPerRun: 60,
};

export function createScheduledLearningTaskPolicy(
  input: CreateScheduledLearningTaskPolicyInput,
): ScheduledLearningTaskPolicy {
  const mediaMode = input.mediaMode ?? "text_only";
  return {
    taskId: input.taskId,
    title: input.title,
    sources: [...input.sources],
    cadence: input.cadence,
    mediaMode,
    privacy: input.privacy ?? "public",
    budget: normalizeBudget(mediaMode, input.budget),
    admissionMode: input.admissionMode ?? "confirm_before_publish",
    externalKnowledge: {
      mode: input.externalKnowledge?.mode ?? "disabled",
      connectors: [...(input.externalKnowledge?.connectors ?? [])],
    },
  };
}

export function createRoleScopedScheduledLearningTaskPolicy(
  input: CreateRoleScopedScheduledLearningTaskPolicyInput,
): RoleScopedScheduledLearningTaskPolicy {
  const basePolicy = createScheduledLearningTaskPolicy({
    ...input,
    admissionMode: "confirm_before_publish",
  });
  const explicitLearningScope = normalizeStringList(input.learningScope);
  const roleLearningScope = normalizeStringList(input.roleProfile.learningScope);
  return {
    ...basePolicy,
    roleProfile: input.roleProfile,
    learningScope: explicitLearningScope.length === 0 ? roleLearningScope : explicitLearningScope,
    sourcePolicy: {
      qualityGate: "high_signal_only",
      candidateOnly: true,
    },
    candidateOnly: true,
    autoPublish: false,
  };
}

export function createRoleScopedScheduledLearningBackgroundScheduleDefinition(
  policy: RoleScopedScheduledLearningTaskPolicy,
  input: CreateRoleScopedScheduledLearningBackgroundScheduleDefinitionInput = {},
): ConversationRuntimeBackgroundJobScheduleDefinition {
  const roleId = policy.roleProfile.roleId;
  return {
    scheduleId: input.scheduleId ?? `role-learning:${roleId}:${policy.taskId}`,
    sessionKey: input.sessionKey ?? `role:${roleId}:learning`,
    title: policy.title,
    objective: renderRoleScopedScheduledLearningObjective(policy),
    schedule: input.schedule ?? scheduledLearningCadenceToSchedule(policy.cadence),
    budget: {
      tokenLimit: policy.budget.dailyTokenLimit,
      fileCountLimit: policy.sources.length,
    },
    allowedTools: normalizeStringList(
      input.allowedTools ?? ["web_extract", "director.learning.url", "director.learning.admit"],
    ),
    allowedCapabilities: ["learning"],
    sourceRefs: normalizeStringList(policy.sources),
    metadata: {
      scheduledLearning: true,
      roleId,
      ...(policy.roleProfile.title === undefined ? {} : { roleTitle: policy.roleProfile.title }),
      ...(policy.roleProfile.domain === undefined ? {} : { roleDomain: policy.roleProfile.domain }),
      learningScope: [...policy.learningScope],
      admissionMode: policy.admissionMode,
      sourcePolicy: policy.sourcePolicy,
      candidateOnly: true,
      autoPublish: false,
      memorySync: "skip-auto-write",
    },
  };
}

export function resolveScheduledLearningExecutionPlan(
  policy: ScheduledLearningTaskPolicy,
  input: ResolveScheduledLearningExecutionPlanInput,
): ScheduledLearningExecutionPlan {
  const qualityGates: string[] = [];
  const textStrategy = resolveTextStrategy(input.textQuality, qualityGates);
  const mediaStrategy = resolveMediaStrategy(policy.mediaMode, input.discoveredMedia);
  const mediaAllowance = resolveMediaAllowance(policy, input.discoveredMedia, qualityGates);
  const externalSync = resolveExternalSync(policy, qualityGates);

  return {
    textStrategy,
    mediaStrategy,
    ...mediaAllowance,
    externalSync,
    requiresUserConfirmation:
      policy.admissionMode === "confirm_before_publish" ||
      policy.mediaMode === "focused_media" ||
      policy.mediaMode === "full_multimodal" ||
      externalSync !== "disabled",
    qualityGates: [...new Set(qualityGates)],
  };
}

export function renderScheduledLearningConsentPrompt(policy: ScheduledLearningTaskPolicy): string {
  return [
    `任务：${policy.title}`,
    `来源：${policy.sources.length} 个`,
    `频率：${renderCadence(policy.cadence)}`,
    `媒体处理：${renderMediaMode(policy.mediaMode)}`,
    `每日 token 上限：${policy.budget.dailyTokenLimit}`,
    `每日媒体上限：${policy.budget.dailyMediaItemLimit} 个`,
    `外部知识库：${renderExternalKnowledge(policy.externalKnowledge)}`,
    `入库规则：${renderAdmissionMode(policy.admissionMode)}`,
    needsExplicitConsent(policy)
      ? "这个任务会读取媒体或同步外部知识库，需要你确认。"
      : "这个任务默认只读可信正文。",
  ].join("\n");
}

export function summarizeScheduledLearningPolicyForUser(
  policy: ScheduledLearningTaskPolicy,
): readonly string[] {
  return [
    `${renderCadence(policy.cadence)}读取 ${policy.sources.length} 个来源，默认先抓可信正文。`,
    `媒体处理：${renderMediaSummary(policy.mediaMode)}。`,
    `外部知识库：${renderExternalKnowledgeSummary(policy.externalKnowledge)}。`,
    `入库规则：${renderAdmissionSummary(policy.admissionMode)}。`,
  ];
}

function renderRoleScopedScheduledLearningObjective(
  policy: RoleScopedScheduledLearningTaskPolicy,
): string {
  const roleTitle = policy.roleProfile.title ?? policy.roleProfile.roleId;
  const scopeText =
    policy.learningScope.length === 0 ? "岗位相关资料" : policy.learningScope.join("、");
  return [
    `${roleTitle} 定时学习：围绕 ${scopeText} 读取高质量来源。`,
    "只生成待审经验候选，保留来源和证据边界。",
    "用户确认前不得写入长期经验库，不得自动发布。",
  ].join("\n");
}

function scheduledLearningCadenceToSchedule(
  cadence: ScheduledLearningCadence,
): ConversationRuntimeBackgroundJobScheduleDefinition["schedule"] {
  if (cadence === "hourly") {
    return { kind: "every", everyMs: 3_600_000 };
  }
  if (cadence === "weekly") {
    return { kind: "cron", expr: "0 9 * * 1", tz: "Asia/Shanghai" };
  }
  if (cadence === "daily") {
    return { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" };
  }
  return { kind: "cron", expr: String(cadence), tz: "Asia/Shanghai" };
}

function normalizeStringList(values: readonly string[] | undefined): readonly string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0)),
  ];
}

function normalizeBudget(
  mediaMode: ScheduledLearningMediaMode,
  budget: Partial<ScheduledLearningBudget> | undefined,
): ScheduledLearningBudget {
  const defaults =
    mediaMode === "focused_media"
      ? FOCUSED_MEDIA_DEFAULT_BUDGET
      : mediaMode === "full_multimodal"
        ? FULL_MULTIMODAL_DEFAULT_BUDGET
        : DEFAULT_BUDGET;
  return {
    dailyTokenLimit: positiveIntegerOrDefault(budget?.dailyTokenLimit, defaults.dailyTokenLimit),
    dailyMediaItemLimit: positiveIntegerOrDefault(
      budget?.dailyMediaItemLimit,
      defaults.dailyMediaItemLimit,
    ),
    maxImagesPerRun: positiveIntegerOrDefault(budget?.maxImagesPerRun, defaults.maxImagesPerRun),
    maxVideosPerRun: positiveIntegerOrDefault(budget?.maxVideosPerRun, defaults.maxVideosPerRun),
    maxVideoMinutesPerRun: positiveIntegerOrDefault(
      budget?.maxVideoMinutesPerRun,
      defaults.maxVideoMinutesPerRun,
    ),
    maxAudioMinutesPerRun: positiveIntegerOrDefault(
      budget?.maxAudioMinutesPerRun,
      defaults.maxAudioMinutesPerRun,
    ),
  };
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function resolveTextStrategy(
  quality: ScheduledLearningTextQuality,
  qualityGates: string[],
): ScheduledLearningTextStrategy {
  if (quality === "trusted") {
    return "extract_trusted_text";
  }
  if (quality === "low_quality") {
    qualityGates.push("text_low_quality");
    return "hold_for_review";
  }
  qualityGates.push("text_untrusted");
  return "skip_untrusted_text";
}

function resolveMediaStrategy(
  mediaMode: ScheduledLearningMediaMode,
  media: ScheduledLearningDiscoveredMedia,
): ScheduledLearningMediaStrategy {
  const hasMedia = media.imageCount + media.videoCount + media.audioCount > 0;
  if (!hasMedia || mediaMode === "text_only") {
    return "skip_media";
  }
  if (mediaMode === "media_inventory") {
    return "record_media_inventory";
  }
  if (mediaMode === "focused_media") {
    return "understand_selected_media";
  }
  return "understand_all_budgeted_media";
}

function resolveMediaAllowance(
  policy: ScheduledLearningTaskPolicy,
  media: ScheduledLearningDiscoveredMedia,
  qualityGates: string[],
): Pick<ScheduledLearningExecutionPlan, "allowedImages" | "allowedVideos" | "allowedAudioMinutes"> {
  if (policy.mediaMode === "text_only" || policy.mediaMode === "media_inventory") {
    return { allowedImages: 0, allowedVideos: 0, allowedAudioMinutes: 0 };
  }

  const dailyItemLimit = policy.budget.dailyMediaItemLimit;
  const allowedImages = Math.min(media.imageCount, policy.budget.maxImagesPerRun, dailyItemLimit);
  const remainingAfterImages = Math.max(0, dailyItemLimit - allowedImages);
  const allowedVideos = Math.min(
    media.videoCount,
    policy.budget.maxVideosPerRun,
    remainingAfterImages,
  );
  const allowedAudioMinutes = media.audioCount > 0 ? policy.budget.maxAudioMinutesPerRun : 0;

  if (
    allowedImages < media.imageCount ||
    allowedVideos < media.videoCount ||
    (media.audioCount > 0 && allowedAudioMinutes === 0)
  ) {
    qualityGates.push("media_budget_limited");
  }

  return { allowedImages, allowedVideos, allowedAudioMinutes };
}

function resolveExternalSync(
  policy: ScheduledLearningTaskPolicy,
  qualityGates: string[],
): ScheduledLearningExternalSyncDecision {
  if (policy.externalKnowledge.mode === "disabled") {
    return "disabled";
  }
  if (policy.privacy === "confidential" || policy.privacy === "restricted") {
    qualityGates.push("external_sync_blocked_for_confidential_content");
    return "blocked_by_privacy";
  }
  return policy.externalKnowledge.mode;
}

function needsExplicitConsent(policy: ScheduledLearningTaskPolicy): boolean {
  return (
    policy.mediaMode === "focused_media" ||
    policy.mediaMode === "full_multimodal" ||
    policy.externalKnowledge.mode !== "disabled"
  );
}

function renderCadence(cadence: ScheduledLearningCadence): string {
  if (cadence === "hourly") {
    return "每小时";
  }
  if (cadence === "daily") {
    return "每天";
  }
  if (cadence === "weekly") {
    return "每周";
  }
  return cadence;
}

function renderMediaMode(mode: ScheduledLearningMediaMode): string {
  if (mode === "text_only") {
    return "只读正文";
  }
  if (mode === "media_inventory") {
    return "正文 + 媒体清单";
  }
  if (mode === "focused_media") {
    return "重点媒体理解";
  }
  return "全量多模态深读";
}

function renderMediaSummary(mode: ScheduledLearningMediaMode): string {
  if (mode === "text_only") {
    return "只读正文，不处理图片/视频/音频";
  }
  if (mode === "media_inventory") {
    return "只记录图片/视频/音频清单，不调用视觉或音频模型";
  }
  if (mode === "focused_media") {
    return "按预算精读重点图片、视频关键帧和音频";
  }
  return "按预算做全量多模态深读";
}

function renderExternalKnowledge(policy: ScheduledLearningExternalKnowledgePolicy): string {
  if (policy.mode === "disabled") {
    return "不上传";
  }
  const connectors = policy.connectors.map(renderConnectorName).join("、") || "未配置连接器";
  return `${renderExternalKnowledgeMode(policy.mode)}到 ${connectors}`;
}

function renderExternalKnowledgeSummary(policy: ScheduledLearningExternalKnowledgePolicy): string {
  if (policy.mode === "disabled") {
    return "不上传到外部知识库";
  }
  const connectors = policy.connectors.map(renderConnectorName).join("、") || "未配置连接器";
  return `${renderExternalKnowledgeMode(policy.mode)}到${connectors}`;
}

function renderExternalKnowledgeMode(mode: ScheduledLearningExternalKnowledgeMode): string {
  if (mode === "sync_summary") {
    return "只同步摘要";
  }
  if (mode === "sync_clean_text") {
    return "同步清洗后的正文";
  }
  if (mode === "sync_original_files") {
    return "同步原文件";
  }
  return "不上传";
}

function renderConnectorName(connector: ScheduledLearningExternalKnowledgeConnector): string {
  if (connector === "notebooklm") {
    return "NotebookLM";
  }
  if (connector === "ima") {
    return "ima";
  }
  if (connector === "notion") {
    return "Notion";
  }
  if (connector === "obsidian") {
    return "Obsidian/Git";
  }
  if (connector === "feishu") {
    return "飞书知识库";
  }
  return "自定义连接器";
}

function renderAdmissionMode(mode: ScheduledLearningAdmissionMode): string {
  if (mode === "auto_stage") {
    return "自动暂存，后续抽查发布";
  }
  if (mode === "never_persist") {
    return "只报告，不进入长期库";
  }
  return "用户确认后才发布到长期库";
}

function renderAdmissionSummary(mode: ScheduledLearningAdmissionMode): string {
  if (mode === "auto_stage") {
    return "自动暂存为待审经验，后续抽查发布";
  }
  if (mode === "never_persist") {
    return "只报告，不进入长期库";
  }
  return "生成待审经验，用户确认后才发布到长期库";
}
