export type ChannelAdapterIngressMode = "polling" | "webhook" | "desktop" | "cli" | (string & {});

export type ChannelAdapterContractRiskLevel = "low" | "medium" | "high";

export interface ChannelAdapterTransportContract {
  readonly ingress: ChannelAdapterIngressMode;
  readonly supportsDirect: boolean;
  readonly supportsGroups: boolean;
  readonly supportsThreads: boolean;
  readonly supportsAttachments: boolean;
  readonly supportsStreaming: boolean;
}

export interface ChannelAdapterRuntimeContract {
  readonly usesUnifiedConversationRuntime: boolean;
  readonly usesDynamicCapabilityContext: boolean;
  readonly emitsRuntimeEvents: boolean;
  readonly recordsOperatorTrace: boolean;
  readonly resultFirstReplies: boolean;
}

export interface ChannelAdapterApprovalContract {
  readonly persistsRuntimeApprovals: boolean;
  readonly routesApproveRejectBeforeChat: boolean;
  readonly expiresStaleApprovals: boolean;
  readonly executesThroughSharedToolExecutor: boolean;
  readonly sanitizesStatusSnapshots: boolean;
}

export interface ChannelAdapterMemoryContract {
  readonly hasGarbageFilter: boolean;
  readonly separatesUserMemoryFromExperience: boolean;
  readonly admitsExperienceOnlyAfterReview: boolean;
}

export interface ChannelAdapterOperationsContract {
  readonly hasHealthStatus: boolean;
  readonly hasReconnectFlow: boolean;
  readonly hasCredentialRedaction: boolean;
}

export interface ChannelAdapterContract {
  readonly schemaVersion: "director.channel-adapter-contract.v1";
  readonly channel: string;
  readonly adapterId: string;
  readonly transport: ChannelAdapterTransportContract;
  readonly runtime: ChannelAdapterRuntimeContract;
  readonly approval: ChannelAdapterApprovalContract;
  readonly memory: ChannelAdapterMemoryContract;
  readonly operations: ChannelAdapterOperationsContract;
}

export interface ChannelAdapterContractReport {
  readonly schemaVersion: "director.channel-adapter-contract-report.v1";
  readonly channel: string;
  readonly adapterId: string;
  readonly ready: boolean;
  readonly riskLevel: ChannelAdapterContractRiskLevel;
  readonly requiredMissing: readonly string[];
  readonly recommendedMissing: readonly string[];
  readonly nextActions: readonly string[];
}

export const CHANNEL_ADAPTER_V2_TEMPLATE_SCHEMA_ID =
  "director.channel-adapter-v2-template.v1" as const;

export interface ChannelAdapterRuntimeBindingContract {
  readonly usesUnifiedConversationRuntime: boolean;
  readonly usesDynamicCapabilityContext: boolean;
  readonly recordsOperatorTrace: boolean;
  readonly emitsRuntimeEvents: boolean;
  readonly resultFirstReplies: boolean;
  readonly requiresSharedToolExecutor: boolean;
  readonly forbidsChannelSpecificToolSideDoor: boolean;
  readonly noCredentialProfileAccessWithoutOperatorScope: boolean;
}

export interface ChannelAdapterV2Template {
  readonly schemaId: typeof CHANNEL_ADAPTER_V2_TEMPLATE_SCHEMA_ID;
  readonly templateId: string;
  readonly channel: string;
  readonly adapterId: string;
  readonly lifecycle: "second-channel-template" | "production";
  readonly transport: ChannelAdapterTransportContract;
  readonly runtimeBinding: ChannelAdapterRuntimeBindingContract;
  readonly approval: ChannelAdapterApprovalContract;
  readonly memory: ChannelAdapterMemoryContract;
  readonly operations: ChannelAdapterOperationsContract;
  readonly operatorScopes: readonly string[];
  readonly forbiddenSideDoors: readonly string[];
  readonly notes: readonly string[];
}

export interface ChannelAdapterV2TemplateReport {
  readonly schemaVersion: "director.channel-adapter-v2-template-report.v1";
  readonly templateId: string;
  readonly channel: string;
  readonly adapterId: string;
  readonly ready: boolean;
  readonly riskLevel: ChannelAdapterContractRiskLevel;
  readonly requiredMissing: readonly string[];
  readonly forbiddenSideDoorHits: readonly string[];
  readonly nextActions: readonly string[];
}

const REQUIRED_CHECKS: Readonly<Record<string, (contract: ChannelAdapterContract) => boolean>> = {
  "runtime.usesUnifiedConversationRuntime": (contract) =>
    contract.runtime.usesUnifiedConversationRuntime,
  "runtime.usesDynamicCapabilityContext": (contract) =>
    contract.runtime.usesDynamicCapabilityContext,
  "runtime.emitsRuntimeEvents": (contract) => contract.runtime.emitsRuntimeEvents,
  "runtime.recordsOperatorTrace": (contract) => contract.runtime.recordsOperatorTrace,
  "runtime.resultFirstReplies": (contract) => contract.runtime.resultFirstReplies,
  "approval.persistsRuntimeApprovals": (contract) => contract.approval.persistsRuntimeApprovals,
  "approval.routesApproveRejectBeforeChat": (contract) =>
    contract.approval.routesApproveRejectBeforeChat,
  "approval.expiresStaleApprovals": (contract) => contract.approval.expiresStaleApprovals,
  "approval.executesThroughSharedToolExecutor": (contract) =>
    contract.approval.executesThroughSharedToolExecutor,
  "approval.sanitizesStatusSnapshots": (contract) => contract.approval.sanitizesStatusSnapshots,
  "memory.hasGarbageFilter": (contract) => contract.memory.hasGarbageFilter,
  "memory.separatesUserMemoryFromExperience": (contract) =>
    contract.memory.separatesUserMemoryFromExperience,
  "memory.admitsExperienceOnlyAfterReview": (contract) =>
    contract.memory.admitsExperienceOnlyAfterReview,
  "operations.hasCredentialRedaction": (contract) => contract.operations.hasCredentialRedaction,
};

const RECOMMENDED_CHECKS: Readonly<Record<string, (contract: ChannelAdapterContract) => boolean>> =
  {
    "operations.hasHealthStatus": (contract) => contract.operations.hasHealthStatus,
    "operations.hasReconnectFlow": (contract) => contract.operations.hasReconnectFlow,
  };

const NEXT_ACTIONS: Readonly<Record<string, string>> = {
  "runtime.usesUnifiedConversationRuntime":
    "接入统一 ConversationRuntime，通道只做 adapter，不直接硬编码模型/工具流程。",
  "runtime.usesDynamicCapabilityContext":
    "接入动态能力上下文：已发布经验、启用 Skill、记忆和外部工具必须由运行时自动召回。",
  "runtime.emitsRuntimeEvents": "把运行过程输出为统一 runtime events，供桌面状态和审查面板消费。",
  "runtime.recordsOperatorTrace": "记录 operatorTrace，保留可审查的路由、召回、工具和审批痕迹。",
  "runtime.resultFirstReplies": "用户侧回复必须结果优先，过程细节放入 trace 或开发者详情。",
  "runtime.requiresSharedToolExecutor":
    "通道只能提交共享 runtime tool call，执行必须回到共享工具执行器。",
  "runtime.forbidsChannelSpecificToolSideDoor":
    "禁止通道 adapter 自建工具执行旁路、浏览器旁路或本地进程旁路。",
  "runtime.noCredentialProfileAccessWithoutOperatorScope":
    "没有 operator scope 时，通道 adapter 不能访问凭证、账号 profile 或浏览器会话。",
  "approval.persistsRuntimeApprovals":
    "把 runtime.approval 持久化为通道本地可恢复状态，不能只发一次提示。",
  "approval.routesApproveRejectBeforeChat":
    "确认/拒绝必须在普通聊天和模型回合之前处理，避免确认话术被当成新任务。",
  "approval.expiresStaleApprovals": "为通道本地审批记录接入 TTL 过期，防止旧工具确认被误执行。",
  "approval.executesThroughSharedToolExecutor":
    "审批通过后必须通过共享工具执行器恢复原 tool call，不能绕过权限层。",
  "approval.sanitizesStatusSnapshots": "状态面板只能展示脱敏摘要，不能泄露 tool args 或凭证。",
  "memory.hasGarbageFilter": "接入垃圾筛选层，闲聊和临时输入不能直接进入长期记忆或经验。",
  "memory.separatesUserMemoryFromExperience":
    "用户记忆、经验、会话搜索需要分层，不能混成一份流水账。",
  "memory.admitsExperienceOnlyAfterReview":
    "学习内容必须进入候选/审核/发布流程，不能直接变成经验。",
  "operations.hasCredentialRedaction":
    "所有状态、日志和错误信息必须脱敏 token、cookie、二维码会话等凭证。",
  "operations.hasHealthStatus": "补充通道健康状态，能看见运行、连接、账号和最近错误。",
  "operations.hasReconnectFlow": "补充重连/重新授权流程，避免连接过期后只剩后台错误。",
};

export function defineChannelAdapterContract(
  input: Omit<ChannelAdapterContract, "schemaVersion">,
): ChannelAdapterContract {
  return {
    schemaVersion: "director.channel-adapter-contract.v1",
    ...input,
  };
}

export function defineChannelAdapterV2Template(
  input: Omit<ChannelAdapterV2Template, "schemaId">,
): ChannelAdapterV2Template {
  return {
    schemaId: CHANNEL_ADAPTER_V2_TEMPLATE_SCHEMA_ID,
    ...input,
  };
}

export function createSecondChannelAdapterV2Template(
  input: {
    readonly channel: string;
    readonly adapterId: string;
    readonly ingress?: ChannelAdapterIngressMode;
    readonly supportsGroups?: boolean;
    readonly supportsThreads?: boolean;
    readonly supportsAttachments?: boolean;
    readonly operatorScopes?: readonly string[];
    readonly notes?: readonly string[];
  } = {
    channel: "telegram",
    adapterId: "telegram-template",
  },
): ChannelAdapterV2Template {
  const channel = normalizeNonEmpty(input.channel, "telegram");
  const adapterId = normalizeNonEmpty(input.adapterId, `${channel}-template`);
  return defineChannelAdapterV2Template({
    templateId: `${channel}-second-channel-template`,
    channel,
    adapterId,
    lifecycle: "second-channel-template",
    transport: {
      ingress: input.ingress ?? "webhook",
      supportsDirect: true,
      supportsGroups: input.supportsGroups ?? true,
      supportsThreads: input.supportsThreads ?? false,
      supportsAttachments: input.supportsAttachments ?? true,
      supportsStreaming: false,
    },
    runtimeBinding: {
      usesUnifiedConversationRuntime: true,
      usesDynamicCapabilityContext: true,
      recordsOperatorTrace: true,
      emitsRuntimeEvents: true,
      resultFirstReplies: true,
      requiresSharedToolExecutor: true,
      forbidsChannelSpecificToolSideDoor: true,
      noCredentialProfileAccessWithoutOperatorScope: true,
    },
    approval: {
      persistsRuntimeApprovals: true,
      routesApproveRejectBeforeChat: true,
      expiresStaleApprovals: true,
      executesThroughSharedToolExecutor: true,
      sanitizesStatusSnapshots: true,
    },
    memory: {
      hasGarbageFilter: true,
      separatesUserMemoryFromExperience: true,
      admitsExperienceOnlyAfterReview: true,
    },
    operations: {
      hasHealthStatus: true,
      hasReconnectFlow: true,
      hasCredentialRedaction: true,
    },
    operatorScopes: [...(input.operatorScopes ?? ["channel.adapter.configure"])],
    forbiddenSideDoors: [
      "channel-specific-tool-executor",
      "direct-child-process-runner",
      "credential-profile-access-without-operator-scope",
      "browser-automation-runner-owned-by-channel",
    ],
    notes: [
      "Second channel templates must bind to the shared ConversationRuntime channel turn contract.",
      "Transport adapters normalize events; runtime, tool execution, approvals, memory, and trace stay shared.",
      ...(input.notes ?? []),
    ],
  });
}

export function createChannelAdapterContractReport(
  contract: ChannelAdapterContract,
): ChannelAdapterContractReport {
  const requiredMissing = missingKeys(contract, REQUIRED_CHECKS);
  const recommendedMissing = missingKeys(contract, RECOMMENDED_CHECKS);
  return {
    schemaVersion: "director.channel-adapter-contract-report.v1",
    channel: contract.channel,
    adapterId: contract.adapterId,
    ready: requiredMissing.length === 0,
    riskLevel: resolveRiskLevel(requiredMissing, recommendedMissing),
    requiredMissing,
    recommendedMissing,
    nextActions: [...requiredMissing, ...recommendedMissing].map(
      (key) => NEXT_ACTIONS[key] ?? `补齐 ${key}`,
    ),
  };
}

export function createChannelAdapterV2TemplateReport(
  template: ChannelAdapterV2Template,
): ChannelAdapterV2TemplateReport {
  const requiredMissing = missingChannelAdapterV2TemplateKeys(template);
  const forbiddenSideDoorHits = template.forbiddenSideDoors.filter((sideDoor) =>
    sideDoor.startsWith("allowed:"),
  );
  return {
    schemaVersion: "director.channel-adapter-v2-template-report.v1",
    templateId: template.templateId,
    channel: template.channel,
    adapterId: template.adapterId,
    ready: requiredMissing.length === 0 && forbiddenSideDoorHits.length === 0,
    riskLevel: resolveRiskLevel(requiredMissing, forbiddenSideDoorHits),
    requiredMissing,
    forbiddenSideDoorHits,
    nextActions: [
      ...requiredMissing.map((key) => NEXT_ACTIONS[key] ?? `补齐 ${key}`),
      ...forbiddenSideDoorHits.map((sideDoor) => `移除通道专属工具旁路：${sideDoor}`),
    ],
  };
}

function missingChannelAdapterV2TemplateKeys(template: ChannelAdapterV2Template): string[] {
  const checks: Readonly<Record<string, boolean>> = {
    "runtime.usesUnifiedConversationRuntime":
      template.runtimeBinding.usesUnifiedConversationRuntime,
    "runtime.usesDynamicCapabilityContext": template.runtimeBinding.usesDynamicCapabilityContext,
    "runtime.emitsRuntimeEvents": template.runtimeBinding.emitsRuntimeEvents,
    "runtime.recordsOperatorTrace": template.runtimeBinding.recordsOperatorTrace,
    "runtime.resultFirstReplies": template.runtimeBinding.resultFirstReplies,
    "runtime.requiresSharedToolExecutor": template.runtimeBinding.requiresSharedToolExecutor,
    "runtime.forbidsChannelSpecificToolSideDoor":
      template.runtimeBinding.forbidsChannelSpecificToolSideDoor,
    "runtime.noCredentialProfileAccessWithoutOperatorScope":
      template.runtimeBinding.noCredentialProfileAccessWithoutOperatorScope,
    "approval.persistsRuntimeApprovals": template.approval.persistsRuntimeApprovals,
    "approval.routesApproveRejectBeforeChat": template.approval.routesApproveRejectBeforeChat,
    "approval.expiresStaleApprovals": template.approval.expiresStaleApprovals,
    "approval.executesThroughSharedToolExecutor":
      template.approval.executesThroughSharedToolExecutor,
    "approval.sanitizesStatusSnapshots": template.approval.sanitizesStatusSnapshots,
    "memory.hasGarbageFilter": template.memory.hasGarbageFilter,
    "memory.separatesUserMemoryFromExperience": template.memory.separatesUserMemoryFromExperience,
    "memory.admitsExperienceOnlyAfterReview": template.memory.admitsExperienceOnlyAfterReview,
    "operations.hasCredentialRedaction": template.operations.hasCredentialRedaction,
  };
  return Object.entries(checks).flatMap(([key, ok]) => (ok ? [] : [key]));
}

function missingKeys(
  contract: ChannelAdapterContract,
  checks: Readonly<Record<string, (contract: ChannelAdapterContract) => boolean>>,
): string[] {
  return Object.entries(checks).flatMap(([key, check]) => (check(contract) ? [] : [key]));
}

function resolveRiskLevel(
  requiredMissing: readonly string[],
  recommendedMissing: readonly string[],
): ChannelAdapterContractRiskLevel {
  if (requiredMissing.length >= 3) {
    return "high";
  }
  if (requiredMissing.length > 0 || recommendedMissing.length >= 2) {
    return "medium";
  }
  return "low";
}

function normalizeNonEmpty(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}
