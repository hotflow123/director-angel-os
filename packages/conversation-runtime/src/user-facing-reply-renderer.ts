import {
  type ConversationRuntimeUserFacingFailure,
  type ConversationRuntimeUserFacingFailureKind,
  classifyConversationRuntimeFailure,
} from "./failure-taxonomy.js";
import type {
  ConversationRuntimeEvent,
  ConversationRuntimeResult,
  ConversationRuntimeUserFacingProjection,
} from "./types.js";

export interface ConversationRuntimeUserFacingFailureRenderInput {
  readonly failure?: ConversationRuntimeUserFacingFailure;
  readonly error?: unknown;
  readonly code?: string;
  readonly message?: string;
  readonly surface?: string;
  readonly includeInternalDetail?: boolean;
}

export interface ConversationRuntimeFailureProjectionInput
  extends ConversationRuntimeUserFacingFailureRenderInput {
  readonly traceRef?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeUserFacingReply {
  readonly kind: ConversationRuntimeUserFacingFailureKind;
  readonly title: string;
  readonly text: string;
  readonly nextAction: string;
  readonly recoverable: boolean;
}

export interface ConversationRuntimeProjectionInput {
  readonly userText?: string;
  readonly status?: string;
  readonly canRetry?: boolean;
  readonly suggestedNextStep?: string;
  readonly developerTraceRef?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeLearningProjectionCandidate {
  readonly candidateId?: string;
  readonly title?: string;
  readonly summary?: string;
}

export interface ConversationRuntimeLearningProjectionFailure {
  readonly sourceRef?: string;
  readonly title?: string;
  readonly reason?: string;
  readonly detail?: string;
}

export interface ConversationRuntimeLearningProjectionEvidence {
  readonly id?: string;
  readonly sourceRef?: string;
  readonly sourceAccessStatus?: string;
  readonly sourceAccessError?: string;
  readonly publishable?: boolean;
  readonly evidenceRefs?: readonly string[];
  readonly evidenceDisclosureSnapshot?: Readonly<Record<string, unknown>>;
  readonly externalContentSnapshot?: Readonly<Record<string, unknown>>;
  readonly contentRef?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeLearningArtifactProjectionInput {
  readonly source: "query" | "url" | "directory" | "runtime-tool" | (string & {});
  readonly query?: string;
  readonly candidateCount?: number;
  readonly candidates?: readonly ConversationRuntimeLearningProjectionCandidate[];
  readonly failureCount?: number;
  readonly failures?: readonly ConversationRuntimeLearningProjectionFailure[];
  readonly sourceEvidenceRefs?: readonly ConversationRuntimeLearningProjectionEvidence[];
  readonly memoryEvidenceRecords?: readonly ConversationRuntimeLearningProjectionEvidence[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createConversationRuntimeUserFacingProjection(
  input: ConversationRuntimeProjectionInput,
): ConversationRuntimeUserFacingProjection {
  const userText = sanitizeUserFacingProjectionText(input.userText ?? "");
  const status = normalizeProjectionString(input.status);
  const suggestedNextStep = normalizeProjectionString(input.suggestedNextStep);
  const developerTraceRef = normalizeProjectionString(input.developerTraceRef);
  return {
    userText:
      userText.length > 0
        ? userText
        : "这次没有生成可展示的结果，系统已经记录了过程。可以换个说法重试，或打开开发者视图查看运行记录。",
    ...(status === undefined ? {} : { briefStatus: status }),
    ...(input.canRetry === undefined ? {} : { canRetry: input.canRetry }),
    ...(suggestedNextStep === undefined ? {} : { suggestedNextStep }),
    ...(developerTraceRef === undefined ? {} : { developerTraceRef }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function createConversationRuntimeLearningArtifactProjection(
  input: ConversationRuntimeLearningArtifactProjectionInput,
): ConversationRuntimeUserFacingProjection {
  const candidates = input.candidates ?? [];
  const failures = input.failures ?? [];
  const candidateCount = input.candidateCount ?? candidates.length;
  const failureCount = input.failureCount ?? failures.length;
  const label = labelForLearningSource(input.source);
  const lines = [label];
  const sourceAccessLimitedEvidence = findSourceAccessLimitedLearningEvidence(input);
  const query = normalizeProjectionString(input.query);
  let extractiveEnglishSummary = false;
  if (query !== undefined && sourceAccessLimitedEvidence !== undefined) {
    lines.push(`来源：${query}`);
  }
  if (sourceAccessLimitedEvidence !== undefined) {
    lines[0] = "这次还没有学到可信正文。";
    lines.push("主要卡点：");
    const blockedSource = normalizeProjectionString(sourceAccessLimitedEvidence.sourceRef ?? query);
    lines.push(`1. ${blockedSource ?? "目标来源"}`);
    const reason = normalizeProjectionString(
      humanizeLearningFailureReason(
        sourceAccessLimitedEvidence.sourceAccessError ??
          sourceAccessLimitedEvidence.sourceAccessStatus ??
          "source_access_limited",
      ),
    );
    if (reason !== undefined) {
      lines.push(`   ${reason}`);
    }
  } else if (candidates.length > 0 || candidateCount > 0) {
    const primary = candidates[0];
    const title = primary === undefined ? undefined : normalizeLearningCandidateTitle(primary);
    const fullSummary =
      primary === undefined ? undefined : normalizeLearningCandidateFullSummary(primary.summary);
    const summary =
      fullSummary === undefined ? undefined : truncateLearningCandidateSummary(fullSummary, 240);
    extractiveEnglishSummary = isExtractiveEnglishLearningSummary(fullSummary);
    const summaryBullets = createLearningSummaryBullets(fullSummary);
    const coreSummary =
      summaryBullets.length === 0 ? summary : title === undefined ? summaryBullets[0] : undefined;
    const core = dedupeLearningCoreParts([title, coreSummary])
      .filter((item): item is string => item !== undefined && item.length > 0)
      .join("。");
    lines[0] = `看完了。核心是：${
      core.length > 0 ? core : `整理出 ${candidateCount} 条待确认经验候选`
    }。`;
    lines.push(`已整理出 ${candidateCount} 条待确认经验候选。`);
    if (summaryBullets.length > 0) {
      lines.push(input.source === "url" ? "学到的要点：" : "可用要点：");
      for (const [index, bullet] of summaryBullets.entries()) {
        lines.push(`${index + 1}. ${bullet}`);
      }
    }
    const candidateIds = candidates
      .map((candidate) => normalizeProjectionString(candidate.candidateId))
      .filter((candidateId): candidateId is string => candidateId !== undefined);
    if (candidateIds.length > 0) {
      lines.push(`候选 ID：${candidateIds.slice(0, 5).join("、")}`);
    }
    if (candidateCount > 1) {
      lines.push(`另外还有 ${candidateCount - 1} 条候选，可以指定第几条。`);
    } else {
      lines.push("要收录吗？");
    }
    if (extractiveEnglishSummary) {
      lines.push("这条更像原文摘录，我先按证据保留；需要的话可以再精炼成中文。");
    }
    if (query !== undefined) {
      lines.push(`来源：${query}`);
    }
  } else {
    lines[0] = "这次还没有学到可信正文。";
  }
  if (
    sourceAccessLimitedEvidence === undefined &&
    failures.length > 0 &&
    candidates.length === 0 &&
    candidateCount === 0
  ) {
    lines.push("主要卡点：");
    for (const [index, failure] of failures.slice(0, 5).entries()) {
      const title =
        normalizeProjectionString(failure.title ?? failure.sourceRef) ?? `失败项 ${index + 1}`;
      lines.push(`${index + 1}. ${title}`);
      const reason = normalizeProjectionString(
        failure.reason === undefined ? undefined : humanizeLearningFailureReason(failure.reason),
      );
      if (reason !== undefined) {
        lines.push(`   ${reason}`);
      }
      const detail = normalizeProjectionString(truncateProjectionDetail(failure.detail, 140));
      if (
        detail !== undefined &&
        !/status\s*:|next_actions\s*:|learning_result\s*:/iu.test(detail)
      ) {
        lines.push(`   ${detail}`);
      }
    }
  }
  const nextStep =
    sourceAccessLimitedEvidence === undefined && (candidates.length > 0 || candidateCount > 0)
      ? "回复“收录”即可保存这条候选。"
      : "换成可公开访问的链接，或把正文直接发过来；系统不会把验证页当成学习内容。";
  if (
    sourceAccessLimitedEvidence !== undefined ||
    (candidates.length === 0 && candidateCount === 0)
  ) {
    lines.push(`下一步：${nextStep}`);
  }
  return createConversationRuntimeUserFacingProjection({
    userText: lines.join("\n"),
    status:
      sourceAccessLimitedEvidence === undefined && (candidates.length > 0 || candidateCount > 0)
        ? "learning-candidate"
        : "source-not-readable",
    canRetry:
      sourceAccessLimitedEvidence !== undefined ||
      (candidates.length === 0 && candidateCount === 0),
    suggestedNextStep: nextStep,
    metadata: {
      ...(input.metadata ?? {}),
      source: input.source,
      candidateCount,
      failureCount,
      ...(extractiveEnglishSummary ? { extractiveEnglishSummary: true } : {}),
      ...(sourceAccessLimitedEvidence === undefined
        ? {}
        : { sourceAccessStatus: "source_access_limited" }),
    },
  });
}

export function renderConversationRuntimeUserFacingFailureReply(
  input: ConversationRuntimeUserFacingFailureRenderInput,
): ConversationRuntimeUserFacingReply {
  const failure =
    input.failure ??
    classifyConversationRuntimeFailure({
      error: input.error,
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.message === undefined ? {} : { message: input.message }),
    });
  const copy = copyForFailureKind(failure.kind, input.surface);
  const detail =
    input.includeInternalDetail === true && failure.internalMessage !== undefined
      ? `\n\n内部记录：${truncateInternalDetail(failure.internalMessage)}`
      : "";
  return {
    kind: failure.kind,
    title: copy.title,
    text: `${copy.title}：${copy.body}\n下一步：${copy.nextAction}${detail}`,
    nextAction: copy.nextAction,
    recoverable: failure.recoverable,
  };
}

export function createConversationRuntimeFailureProjection(
  input: ConversationRuntimeFailureProjectionInput,
): ConversationRuntimeUserFacingProjection {
  const failure =
    input.failure ??
    classifyConversationRuntimeFailure({
      error: input.error,
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.message === undefined ? {} : { message: input.message }),
    });
  const reply = renderConversationRuntimeUserFacingFailureReply({
    failure,
    ...(input.surface === undefined ? {} : { surface: input.surface }),
    ...(input.includeInternalDetail === undefined
      ? {}
      : { includeInternalDetail: input.includeInternalDetail }),
  });
  return createConversationRuntimeUserFacingProjection({
    userText: reply.text,
    status: failure.kind,
    canRetry: reply.recoverable,
    suggestedNextStep: reply.nextAction,
    ...(input.traceRef === undefined ? {} : { developerTraceRef: input.traceRef }),
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.surface === undefined ? {} : { surface: input.surface }),
      failureKind: failure.kind,
      recoverable: reply.recoverable,
    },
  });
}

export function renderConversationRuntimeResultUserFacingText(
  result: Pick<
    ConversationRuntimeResult,
    "finalText" | "events" | "replySource" | "userFacingProjection"
  >,
): string {
  const projectedText = result.userFacingProjection?.userText.trim();
  if (projectedText !== undefined && projectedText.length > 0) {
    return projectedText;
  }
  const finalText = sanitizeUserFacingProjectionText(result.finalText ?? "");
  if (finalText !== undefined && finalText.length > 0) {
    return finalText;
  }
  const failedEvent = findRuntimeFailureEvent(result.events);
  if (failedEvent !== undefined) {
    return renderConversationRuntimeUserFacingFailureReply({
      ...(failedEvent.payload.code === undefined ? {} : { code: failedEvent.payload.code }),
      message: failedEvent.payload.message,
    }).text;
  }
  return renderConversationRuntimeUserFacingFailureReply({
    code: result.replySource === "local-command" ? "user_stopped" : "runtime_failed",
    message:
      result.replySource === "local-command"
        ? "Conversation runtime stopped by user."
        : "Conversation runtime produced no user visible text.",
  }).text;
}

export function findRuntimeFailureEvent(
  events: readonly ConversationRuntimeEvent[],
): ConversationRuntimeEvent<"runtime.error"> | undefined {
  return events.find(
    (event): event is ConversationRuntimeEvent<"runtime.error"> => event.kind === "runtime.error",
  );
}

function copyForFailureKind(
  kind: ConversationRuntimeUserFacingFailureKind,
  surface?: string,
): { readonly title: string; readonly body: string; readonly nextAction: string } {
  const channel = surface === "weixin" ? "微信" : "当前客户端";
  switch (kind) {
    case "provider_missing_key":
      return {
        title: "模型 Key 未配置",
        body: "系统找到了模型供应方，但还没有可用的 Key，所以这次不能假装调用成功。",
        nextAction: "先在设置里添加并启用对应供应方的 Key，再重新发送这条消息。",
      };
    case "model_unavailable":
      return {
        title: "模型不可用",
        body: "当前没有可用的模型供应方处理这条消息，暂时无法处理这条对话，系统已经按失败收口，没有用假数据冒充结果。",
        nextAction: "检查模型供应方是否启用、Key 是否有效、默认模型是否已选择，然后重试。",
      };
    case "provider_upstream_failed":
      return {
        title: "模型供应方暂时不可用",
        body: "系统已经找到并调用了模型供应方，但对方接口这次返回失败，不是没有配置模型，也不是本地用了假结果。",
        nextAction: "重试本轮；如果连续失败，切换模型或检查供应方状态。",
      };
    case "channel_delivery_failed":
      return {
        title: `${channel}发送失败`,
        body: "任务本身不一定失败，是回复投递通道没有把消息发出去。",
        nextAction: "检查客户端登录状态和网关连接；任务结果以运行记录为准，不要重复触发长任务。",
      };
    case "permission_denied":
      return {
        title: "需要确认权限",
        body: "这次卡在工具、权限或安全边界上，不是你的表达有问题。",
        nextAction: "到桌面端确认待处理权限，或换一个不需要外部工具的说法重试。",
      };
    case "source_access_limited":
      return {
        title: "来源读取受限",
        body: "目标链接或来源要求验证、登录或环境校验，系统没有拿到可信正文。",
        nextAction: "换成可公开访问的链接，或把正文发过来；系统不会把验证页当成学习内容。",
      };
    case "tool_failed":
      return {
        title: "工具调用失败",
        body: "模型已经尝试调用外部能力，但工具没有返回可用结果。",
        nextAction: "检查对应工具或 MCP 服务是否在线，再重试这一步。",
      };
    case "user_stopped":
      return {
        title: "已停止",
        body: "当前回合已经按你的要求停止，后续模型和工具调用不会继续跑。",
        nextAction: "需要继续时重新发送目标，或从运行中心选择后续操作。",
      };
    case "runtime_failed":
      return {
        title: "运行失败",
        body: "这次没有处理成功，系统已经记录失败原因。",
        nextAction: "稍后重试；如果连续失败，检查后端运行状态和最近的运行记录。",
      };
  }
}

function truncateInternalDetail(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

function labelForLearningSource(source: string): string {
  if (source === "url") {
    return "这个链接我看过了";
  }
  if (source === "query") {
    return "这轮学习我整理好了";
  }
  if (source === "directory") {
    return "这个目录我整理过了";
  }
  return "这次学习我整理好了";
}

function findSourceAccessLimitedLearningEvidence(
  input: ConversationRuntimeLearningArtifactProjectionInput,
): ConversationRuntimeLearningProjectionEvidence | undefined {
  const evidence = [...(input.sourceEvidenceRefs ?? []), ...(input.memoryEvidenceRecords ?? [])];
  return evidence.find((item) => {
    const text = [
      item.sourceAccessStatus,
      item.sourceAccessError,
      item.publishable === false ? "not publishable" : "",
    ]
      .filter((value) => value !== undefined && value.length > 0)
      .join("\n");
    return /source[_ -]?access[_ -]?limited|captcha|verify|验证|访问受限|环境异常/iu.test(text);
  });
}

function humanizeLearningFailureReason(reason: string): string {
  if (
    /dynamic application shell|JavaScript is not available|enable JavaScript|__SCRIPTS_LOADED__|SENTRY_RELEASE|unsupported browser|_sentryDebugIds|_sentryDebugIdIdentifier|sentry-dbid|Object\.prototype\.hasOwnProperty\.call|webpackChunk|__webpack/iu.test(
      reason,
    )
  ) {
    return "访问受限，系统只拿到网页壳，没有拿到正文";
  }
  if (/source access challenge|captcha|anti[- ]?bot/iu.test(reason)) {
    return "访问受限，页面要求验证，系统没有拿到可信正文";
  }
  if (/source[_ -]?access[_ -]?limited|captcha|verify|验证|访问受限|环境异常/iu.test(reason)) {
    return "访问受限，系统没有拿到可信正文";
  }
  if (/low-quality extracted content|verification|login|UI residue|article body/iu.test(reason)) {
    return "访问受限，系统只读到验证页、登录页或网页按钮残渣，没有拿到可信正文";
  }
  if (/quarantine|隔离/iu.test(reason)) {
    return "内容被隔离，不能直接收录";
  }
  if (/HTTP\s*(?:401|403)|unauthorized|forbidden/iu.test(reason)) {
    return "需要登录或没有访问权限";
  }
  return reason;
}

function truncateProjectionDetail(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, " ");
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3)}...`;
}

function normalizeProjectionString(value: string | undefined): string | undefined {
  const normalized = sanitizeUserFacingProjectionText(value ?? "");
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeLearningCandidateTitle(
  candidate: ConversationRuntimeLearningProjectionCandidate,
): string | undefined {
  const raw = normalizeProjectionString(candidate.title);
  const cleaned = cleanupLearningCandidateUserFacingText(
    cleanupInternalLearningCandidatePrefix(raw),
  );
  if (cleaned !== undefined && !isInternalLearningCandidateLabel(cleaned)) {
    return cleaned;
  }
  return undefined;
}

function normalizeLearningCandidateSummary(value: string | undefined): string | undefined {
  const cleaned = normalizeLearningCandidateFullSummary(value);
  return cleaned === undefined ? undefined : truncateLearningCandidateSummary(cleaned, 240);
}

function normalizeLearningCandidateFullSummary(value: string | undefined): string | undefined {
  const normalized = normalizeProjectionString(value);
  if (normalized === undefined) {
    return undefined;
  }
  const cleaned = cleanupLearningCandidateUserFacingText(
    cleanupInternalLearningCandidatePrefix(normalized),
  );
  if (cleaned === undefined || isInternalLearningApplicabilityText(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function isExtractiveEnglishLearningSummary(value: string | undefined): boolean {
  if (value === undefined || value.length === 0) {
    return false;
  }
  const letters = value.match(/[A-Za-z]/gu)?.length ?? 0;
  const cjk = value.match(/[\u4E00-\u9FFF]/gu)?.length ?? 0;
  const words = value.match(/\b[A-Za-z][A-Za-z'-]{2,}\b/gu)?.length ?? 0;
  const sentences = value.match(/[^.!?]+[.!?]/gu)?.length ?? 0;
  return letters >= 80 && words >= 12 && cjk <= 8 && (sentences >= 2 || value.length > 160);
}

function cleanupInternalLearningCandidatePrefix(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = value
    .replace(/^\s*Pasted\s+lesson\s*[:：]\s*/iu, "")
    .replace(/^\s*经验提炼\s*[:：]\s*/u, "")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned;
}

function isInternalLearningCandidateLabel(value: string): boolean {
  return /^(?:https?:\/\/|Pasted\s+lesson|候选|experience[-_]|candidate[-_]|\(?\s*(?:Note|Retweet|Quote)\s+Tweet\s*\)?\.?)$/iu.test(
    value.trim(),
  );
}

function isInternalLearningApplicabilityText(value: string): boolean {
  return /\bUse when Director Angel\b|\buser-pasted material\b|\bpreserved source evidence\b/iu.test(
    value,
  );
}

function dedupeLearningCoreParts(parts: readonly (string | undefined)[]): (string | undefined)[] {
  const selected: string[] = [];
  for (const part of parts) {
    if (part === undefined || part.length === 0) {
      continue;
    }
    const normalized = part.toLocaleLowerCase();
    if (selected.some((item) => item.toLocaleLowerCase() === normalized)) {
      continue;
    }
    selected.push(part);
  }
  return selected;
}

function createLearningSummaryBullets(summary: string | undefined): string[] {
  if (summary === undefined || summary.length < 80) {
    return [];
  }
  const normalized = summary.replace(/\s+/gu, " ").trim();
  const sentences = splitLearningSummaryIntoSentences(normalized);
  const candidates =
    sentences.length >= 2 ? sentences : splitLearningSummaryBySemicolon(normalized);
  const cleanedCandidates = normalizeLearningSummaryBulletFragments(candidates)
    .map((item) =>
      item
        .replace(/^[；;。！？!?、，,\s]+/u, "")
        .replace(/[；;。！？!?]+$/u, "")
        .trim(),
    )
    .filter(
      (item) =>
        item.length > 0 && !/[^\s]\.\.\.$/u.test(item) && !isLowSignalLearningSummaryBullet(item),
    );
  const selected =
    cleanedCandidates.length <= 5
      ? cleanedCandidates
      : cleanedCandidates
          .map((item, index) => ({
            item,
            index,
            score: scoreLearningSummaryBullet(item),
          }))
          .sort((left, right) => right.score - left.score || left.index - right.index)
          .slice(0, 5)
          .sort((left, right) => left.index - right.index)
          .map((entry) => entry.item);
  return selected.slice(0, 5);
}

function normalizeLearningSummaryBulletFragments(candidates: readonly string[]): string[] {
  const normalized = candidates.map((item) => item.trim()).filter((item) => item.length > 0);
  const merged: string[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] ?? "";
    const next = normalized[index + 1] ?? "";
    const afterNext = normalized[index + 2] ?? "";
    if (
      isQuotedNotInstructionBullet(current) &&
      isQuotedNotInstructionBullet(next) &&
      isQuotedNotInstructionBullet(afterNext)
    ) {
      merged.push("好看、高级、有设计感不是指令");
      index += 2;
      continue;
    }
    const commonPromptPitfallRule = normalizeCommonPromptPitfallRule(current);
    if (commonPromptPitfallRule !== undefined) {
      merged.push(commonPromptPitfallRule);
      continue;
    }
    const concretePromptRule = normalizeConcretePromptRule(current, [
      next,
      afterNext,
      normalized[index + 3] ?? "",
      normalized[index + 4] ?? "",
      normalized[index + 5] ?? "",
    ]);
    if (concretePromptRule !== undefined) {
      merged.push(concretePromptRule);
      continue;
    }
    const formulaRule = normalizeChineseFontFormulaRule(current, [
      next,
      afterNext,
      normalized[index + 3] ?? "",
    ]);
    if (formulaRule !== undefined) {
      merged.push(formulaRule);
      continue;
    }
    merged.push(current);
  }
  return dedupeLearningSummaryBullets(merged);
}

function isQuotedNotInstructionBullet(value: string): boolean {
  return /^["“][^"”]{1,12}["”](?:也)?不是指令$/u.test(value.trim());
}

function normalizeCommonPromptPitfallRule(current: string): string | undefined {
  if (!/帮我生成\s*XX\s*几个字/iu.test(current)) {
    return undefined;
  }
  return "不要只写“帮我生成 XX 几个字”，要把字形和画面要求说具体";
}

function normalizeConcretePromptRule(
  current: string,
  following: readonly string[],
): string | undefined {
  const text = [current, ...following].join(" ");
  if (!/AI 真正需要的是更具体的描述/iu.test(current)) {
    return undefined;
  }
  if (!/字体|笔画|结构|边缘|材质|背景/iu.test(text)) {
    return undefined;
  }
  return "AI 真正需要更具体的描述：字体、笔画粗细、结构、边缘、材质和背景";
}

function normalizeChineseFontFormulaRule(
  current: string,
  following: readonly string[],
): string | undefined {
  if (!/中文字体提示词|写几个字|设计一组字/iu.test(current)) {
    return undefined;
  }
  const text = [current, ...following].join(" ");
  if (!/中文字体提示词.*公式写/iu.test(text)) {
    return undefined;
  }
  if (!/写几个字|设计一组字/iu.test(text)) {
    return undefined;
  }
  return "中文字体提示词，最好按公式写；不是让 AI 写几个字，而是让 AI 设计一组字";
}

function dedupeLearningSummaryBullets(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeLearningSummaryBulletKey(value);
    if (normalized.length === 0) {
      continue;
    }
    if (result.some((existing) => learningSummaryBulletsOverlap(existing, value))) {
      continue;
    }
    result.push(value);
  }
  return result;
}

function learningSummaryBulletsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeLearningSummaryBulletKey(left);
  const normalizedRight = normalizeLearningSummaryBulletKey(right);
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return false;
  }
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function normalizeLearningSummaryBulletKey(value: string): string {
  return value.replace(/[。！？!?；;，,、:：#｜|“”"'\s]/gu, "").toLocaleLowerCase();
}

function splitLearningSummaryIntoSentences(summary: string): string[] {
  return summary
    .split(/(?<=[。！？!?])\s*/u)
    .flatMap((item) => splitLearningSummarySentenceTail(item))
    .map((item) => item.replace(/[。！？!?]+$/u, "").trim())
    .filter((item) => item.length > 0);
}

function splitLearningSummarySentenceTail(sentence: string): string[] {
  const trimmed = sentence.trim();
  const match = /^(.*?(?:不是指令|不是命令|不是目标|不是需求))([^\n。！？!?]{8,})$/u.exec(trimmed);
  if (match === null) {
    return [trimmed];
  }
  const first = match[1] ?? "";
  const second = match[2] ?? "";
  return [first, second].map((item) => item.trim()).filter((item) => item.length > 0);
}
function splitLearningSummaryBySemicolon(summary: string): string[] {
  return summary
    .split(/[；;]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isLowSignalLearningSummaryBullet(item: string): boolean {
  return /肝爆|挡不住我想分享|分两次发|达到长文图片上限|上册|下册|👇|求转发|求点赞|收藏起来|出来的图|经常像|PPT|艺术字|能看但不能当封面|中文字体提示方案|方案\s*\d+|^#+\s*\d*个|^(?:这个字是什么字体|笔画是粗还是细|结构是紧凑还是舒展|边缘是锋利还是圆润|材质是金属|背景是科技界面)|^这是让 AI/u.test(
    item,
  );
}

function scoreLearningSummaryBullet(item: string): number {
  let score = 0;
  if (/需要|不要|不能|不是|最好|应该|必须|关键|核心|重点|公式|方法|流程|步骤/iu.test(item)) {
    score += 4;
  }
  if (/具体|描述|提示词|指令|字体|笔画|结构|边缘|材质|背景|构图|光线|镜头|设计/iu.test(item)) {
    score += 3;
  }
  if (/问题|痛点|高风险|安全|稳定|红色|黄色|绿色|禁用|谨慎|可用/iu.test(item)) {
    score += 2;
  }
  if (/我|分享|时间|上限|评论区|转发|点赞|关注|收藏/iu.test(item)) {
    score -= 3;
  }
  if (/出来的图|经常像|能看|不能当封面|PPT|艺术字/iu.test(item)) {
    score -= 3;
  }
  return score;
}

function cleanupLearningCandidateUserFacingText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let cleaned = value.trim();
  for (let index = 0; index < 4; index += 1) {
    const next = cleaned
      .replace(/^\s*\(?\s*(?:Note|Retweet|Quote)\s+Tweet\s*\)?\s*[。.!?：:;-]*\s*/iu, "")
      .trim();
    if (next === cleaned) {
      break;
    }
    cleaned = next;
  }
  cleaned = cleaned
    .replace(/\s+/gu, " ")
    .replace(/\s+[\p{L}\p{N}_-]{4,}\.\.\.$/u, "...")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned;
}

function truncateLearningCandidateSummary(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const completeSentences = value.match(/[^.!?。！？]+[.!?。！？]+/gu) ?? [];
  let summary = "";
  for (const sentence of completeSentences) {
    if ((summary + sentence).trim().length > maxChars) {
      break;
    }
    summary += sentence;
  }
  const trimmed = summary.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  const sliced = value.slice(0, maxChars - 3);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.65) {
    return `${sliced.slice(0, lastSpace).trim()}...`;
  }
  return `${sliced.trim()}...`;
}

function sanitizeUserFacingProjectionText(value: string): string {
  return value
    .replace(
      /^\s*(?:status|summary|next_actions|learning_result|tool_result|endpoint|runId|trace|traceRef|developerTraceRef)\s*[:：].*$/gimu,
      "",
    )
    .replace(/^.*\bNative Bridge\b.*$/gimu, "")
    .replace(/接口：undefined/giu, "接口：统一运行时")
    .replace(/耗时：(?:undefined|0ms)/giu, "耗时：未记录")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
