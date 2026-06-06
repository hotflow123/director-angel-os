import { parseChannelSlashCommand } from "./channel-command-registry.js";
import type {
  ConversationTurnAbilityGroup,
  ConversationTurnAttachment,
  ConversationTurnCapabilityRouteDecision,
  ConversationTurnInputModality,
  ConversationTurnModelCapabilities,
} from "./conversation-turn-types.js";

export interface ChannelConfirmationIntent {
  readonly supplement?: string;
}

export interface ChannelExperienceClassificationIntent {
  readonly candidateId: string;
  readonly categoryId: string;
  readonly tagIds: readonly string[];
}

export type ChannelExperienceManagementIntent =
  | {
      readonly kind: "category.create";
      readonly name: string;
    }
  | {
      readonly kind: "tag.create";
      readonly name: string;
    }
  | {
      readonly kind: "candidate.classify";
      readonly candidateId: string;
      readonly categoryId: string;
      readonly tagIds: readonly string[];
    }
  | {
      readonly kind: "candidate.explain";
      readonly candidateId: string;
    }
  | {
      readonly kind: "candidate.accept";
      readonly candidateId: string;
    }
  | {
      readonly kind: "candidate.reject";
      readonly candidateId: string;
    }
  | {
      readonly kind: "candidate.promote";
      readonly candidateId: string;
    }
  | {
      readonly kind: "candidate.list";
    };

export type ChannelKnowledgeManagementIntent =
  | {
      readonly kind: "candidate.explain";
      readonly packId: string;
    }
  | {
      readonly kind: "candidate.diff";
      readonly packId: string;
    }
  | {
      readonly kind: "candidate.review";
      readonly packId: string;
    }
  | {
      readonly kind: "candidate.accept";
      readonly packId: string;
    }
  | {
      readonly kind: "candidate.publish";
      readonly packId: string;
    }
  | {
      readonly kind: "candidate.reject";
      readonly packId: string;
    }
  | {
      readonly kind: "pack.explain";
      readonly packId: string;
    }
  | {
      readonly kind: "status";
    }
  | {
      readonly kind: "published.list";
    }
  | {
      readonly kind: "candidate.list";
    }
  | {
      readonly kind: "recall.preview";
    };

export type ChannelActiveSessionIntent =
  | {
      readonly kind: "confirm-current";
      readonly supplement?: string;
    }
  | {
      readonly kind: "supplement-current";
      readonly supplement: string;
    }
  | {
      readonly kind: "status-current";
      readonly commandId: string;
      readonly args: string;
    }
  | {
      readonly kind: "interrupt-current";
      readonly commandId: string;
      readonly args: string;
    }
  | {
      readonly kind: "execute-now";
      readonly commandId: string;
      readonly args: string;
    }
  | {
      readonly kind: "queue-next";
      readonly commandId: string;
      readonly args: string;
    }
  | {
      readonly kind: "none";
    };

export type ChannelRunCommandId =
  | "run.status"
  | "run.start"
  | "run.once"
  | "run.continue"
  | "run.delegations"
  | "run.pause"
  | "run.resume"
  | "run.abort"
  | "run.report"
  | "run.explain"
  | "run.audit"
  | "run.retry"
  | "run.approvePending"
  | "run.approve"
  | "run.reroute";

export type ChannelNaturalRunManagementIntent =
  | {
      readonly kind: "assignment.retry";
      readonly runId: string;
      readonly assignmentId: string;
    }
  | {
      readonly kind: "assignment.approve";
      readonly runId: string;
      readonly assignmentId: string;
    }
  | {
      readonly kind: "run.approvePending";
      readonly runId: string;
    }
  | {
      readonly kind: "run.reflect";
      readonly runId: string;
    }
  | {
      readonly kind: "run.command";
      readonly runId: string;
      readonly commandId: ChannelRunCommandId;
    };

export type ChannelNaturalHeartbeatManagementIntent =
  | {
      readonly kind: "heartbeat.enable";
    }
  | {
      readonly kind: "heartbeat.disable";
    }
  | {
      readonly kind: "heartbeat.status";
    };

export type ChannelNaturalMemoryManagementIntent =
  | {
      readonly kind: "session.inspect";
      readonly sessionId: string;
    }
  | {
      readonly kind: "session.clearWorking";
      readonly sessionId: string;
    }
  | {
      readonly kind: "memory.status";
    };

export type ChannelNaturalWorkspaceManagementIntent =
  | {
      readonly kind: "skills.list";
    }
  | {
      readonly kind: "tools.list";
    }
  | {
      readonly kind: "providers.list";
    }
  | {
      readonly kind: "settings.list";
    }
  | {
      readonly kind: "workspace.status";
    }
  | {
      readonly kind: "workspace.doctor";
    }
  | {
      readonly kind: "review.list";
    };

export interface ChannelNaturalImageGenerationIntent {
  readonly prompt: string;
}

export interface ChannelNaturalVideoGenerationIntent {
  readonly prompt: string;
}

export interface ResolveChannelCapabilityRouteOptions {
  readonly attachments?: readonly ConversationTurnAttachment[];
  readonly textModelCapabilities?: ConversationTurnModelCapabilities;
}

export interface ResolveChannelModelAbilityGroupsInput {
  readonly capabilities?: readonly string[];
  readonly inputModalities?: readonly ConversationTurnInputModality[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function parseChannelConfirmation(text: string): ChannelConfirmationIntent | null {
  const trimmed = text.trim();
  const matchedPrefix = /^(确认执行|确认继续|继续执行|确认|执行)(?:[，,。:：\s]|$)/u.exec(trimmed);
  if (matchedPrefix === null) {
    return null;
  }
  const rest = trimmed.slice(matchedPrefix[0].length).trim();
  const supplement = rest
    .replace(/^(内容是|内容为|补充是|补充为|补充内容是|补充内容为|要求是|要求为)[:：]?\s*/u, "")
    .trim();
  return supplement.length === 0 ? {} : { supplement };
}

export function parseChannelActiveSessionIntent(text: string): ChannelActiveSessionIntent {
  const trimmed = text.trim();
  const confirmation = parseChannelConfirmation(trimmed);
  if (confirmation !== null) {
    return confirmation.supplement === undefined
      ? { kind: "confirm-current" }
      : { kind: "confirm-current", supplement: confirmation.supplement };
  }

  const command = parseChannelSlashCommand(trimmed);
  if (command !== null) {
    const payload = {
      commandId: command.commandId,
      args: command.args,
    };
    if (command.activeSessionPolicy === "status-only") {
      return { kind: "status-current", ...payload };
    }
    if (command.activeSessionPolicy === "interrupt-current") {
      return { kind: "interrupt-current", ...payload };
    }
    if (command.activeSessionPolicy === "queue-next") {
      return { kind: "queue-next", ...payload };
    }
    return { kind: "execute-now", ...payload };
  }

  if (isChannelSearchFollowup(trimmed)) {
    return { kind: "none" };
  }

  if (looksLikeProductionSupplement(trimmed)) {
    return { kind: "supplement-current", supplement: trimmed };
  }

  return { kind: "none" };
}

export function isSafeRewriteConfirmation(text: string): boolean {
  return /^(确认改写|确认安全改写|按这个方向|按安全方向|可以改写|就这样改)(?:[，,。:：\s]|$)/u.test(
    text.trim(),
  );
}

export function parseExplicitProductionObjective(text: string): string | null {
  const command = parseChannelSlashCommand(text);
  if (command?.commandId !== "production.start") {
    return null;
  }
  return command.args || null;
}

export function parseNaturalProductionObjective(text: string): string | null {
  const trimmed = text.trim();
  if (parseChannelConfirmation(trimmed) !== null) {
    return null;
  }
  if (isCasualPersonalLearningOrMakingStatement(trimmed)) {
    return null;
  }
  if (isProductionConsultationQuestion(trimmed)) {
    return null;
  }
  const match =
    /^(?:我想|我要|我来|我|帮我|请帮我|请你|请|麻烦你|给我)?\s*(制作|生成|写|做|设计|创作|策划|出)\s*(.+)$/su.exec(
      trimmed,
    );
  if (match === null) {
    return null;
  }
  const verb = match[1]?.trim() ?? "";
  const target = match[2]?.trim() ?? "";
  if (target.length < 2) {
    return null;
  }
  return `${verb}${target}`;
}

export function parseNaturalDirectorProductionObjective(text: string): string | null {
  const objective = parseNaturalProductionObjective(text);
  if (objective === null) {
    return null;
  }
  return isDirectorProductionObjective(objective) ? objective : null;
}

export function isDirectorProductionObjective(objective: string): boolean {
  return (
    /^(?:制作|做|生成|创建|设计|创作|策划|出|写)/u.test(objective) &&
    /(短剧|视频|影片|片子|分镜|镜头|脚本|剧本|文案|口播|故事板|制作蓝图|执行蓝图|成片方案|旅游记|旅行记|广告片|预告片)/u.test(
      objective,
    )
  );
}

export function isProductionConsultationQuestion(text: string): boolean {
  const normalized = text.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) {
    return false;
  }
  if (
    /(?:别|不要|不必|无需|禁止).{0,16}(?:创建|生成|制作|建立|新建).{0,12}(?:任务|run|制作任务)/iu.test(
      normalized,
    )
  ) {
    return true;
  }
  const hasQuestionCue =
    /[?？]/u.test(normalized) ||
    /(?:什么|哪些|哪个|哪种|哪款|怎么|如何|为什么|多久|多少|要不要|应不应该|有什么技巧|技巧吗|更难|比较|维度|用什么模型|模型好|多少钱|值得吗|可以吗|吗|呢)/iu.test(
      normalized,
    );
  if (!hasQuestionCue) {
    return false;
  }
  return /(?:短剧|视频|分镜|镜头|脚本|剧本|广告片|制作|生成|模型|能力|维度|成本|价格|时长|流程)/iu.test(
    normalized,
  );
}

export function isLowValueChannelChitchat(text: string): boolean {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if (isAgentCapabilityQuestion(trimmed)) {
    return false;
  }
  return /^(?:你?好|hi|hello|hey|在吗|谢谢|谢了|辛苦|ok|okay|嗯+|啊+|哦+|好的|好|可以|收到|明白|测试|哈哈+|嘿嘿+|呵呵+)[。！!,.，\s]*$/iu.test(
    trimmed,
  );
}

export function isAgentCapabilityQuestion(text: string): boolean {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if (trimmed.length === 0 || trimmed.length > 80) {
    return false;
  }
  if (
    /(?:你是谁|你是(?:谁|什么|大模型|机器人|AI|ai)|你的(?:功能|能力|作用|定位)|你(?:会|能|可以|具备).*(?:什么|哪些|干什么|做什么|能力|功能)|(?:功能|能力).*(?:是什么|有哪些|介绍|说明)|说(?:全面|详细|清楚).*(?:点|一点|些)|只能发这几句|只会(?:发)?这几句)/iu.test(
      trimmed,
    )
  ) {
    return true;
  }
  return /^(?:你好[，,\s]*)?(?:你(?:会|能|可以|具备)什么|你能干什么|你会干什么)[？?。!！\s]*$/iu.test(
    trimmed,
  );
}

export function hasLearningAdmissionSource(text: string): boolean {
  const trimmed = text.trim();
  return (
    /https?:\/\/\S+/iu.test(trimmed) ||
    /file:\/\/\S+/iu.test(trimmed) ||
    /(?:^|\s)(?:\/(?:Volumes|Users|tmp|var|private|home|opt)\/\S+|~\/\S+|\.\/\S+|\.\.\/\S+|[A-Za-z]:[\\/]\S+)/u.test(
      trimmed,
    ) ||
    extractLearningAdmissionText(trimmed).length >= 600
  );
}

export function extractFirstLearningAdmissionUrl(text: string): string | null {
  return /https?:\/\/\S+/iu.exec(text.trim())?.[0]?.replace(/[，,。.;；]+$/u, "") ?? null;
}

export function isExplicitLearningAdmissionPrompt(text: string): boolean {
  const trimmed = text.trim();
  const command = parseChannelSlashCommand(trimmed);
  if (command?.commandId === "learning.admit") {
    return true;
  }
  return isExplicitLearningPersistencePrompt(trimmed);
}

export function isExplicitLearningPersistencePrompt(text: string): boolean {
  const trimmed = text.trim();
  if (hasLearningPersistenceBlocker(trimmed)) {
    return false;
  }
  return /(?:\/学习|学习(?:以下|这段|内容|资料)[:：]?|(?:保存|收录|记录|沉淀|整理|写入|加入|放进|存到|存入).{0,12}(?:经验|知识|资料|记忆|候选|经验库|知识库)|(?:存起来|记下来|记住|留下).{0,24}(?:以后|后续|下次|复用|用|过审|制作|生成|执行)|(?:当成|作为|变成|做成|转成|整理成|提炼成).{0,24}(?:经验|知识|候选|规则|避坑|方法)|(?:生成|创建|建立|新建).{0,8}(?:经验|知识|候选)|(?:经验|知识).{0,8}(?:沉淀|收录|入库|候选|保存|记录))/u.test(
    trimmed,
  );
}

function hasLearningPersistenceBlocker(text: string): boolean {
  return /(?:不要|别|无需|不用|禁止|不许).{0,16}(?:创建|生成|保存|收录|沉淀|写入|入库|候选|经验|知识|记忆|学到|学到了)|只.{0,8}(?:告诉|给).{0,8}(?:我)?(?:结果|结论|正文|摘要)|不要说.{0,8}(?:学到|学到了)/u.test(
    text,
  );
}

export function shouldAdmitNaturalLearningPrompt(
  text: string,
  options: { readonly hasAdditionalLearningSource?: boolean } = {},
): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (
    !/(学习|经验|知识|资料|规则|方法|避坑|保存|收录|沉淀|存起来|当成|作为|learn)/iu.test(trimmed)
  ) {
    return false;
  }
  if (isCasualPersonalLearningOrMakingStatement(trimmed)) {
    return false;
  }
  if (!isExplicitLearningPersistencePrompt(trimmed)) {
    return false;
  }
  return (
    hasLearningAdmissionSource(trimmed) ||
    options.hasAdditionalLearningSource === true ||
    /(?:学习以下|学习这段|学习内容|学习资料)[:：]/u.test(trimmed)
  );
}

export function looksLikeNaturalLearningSearchQuery(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || hasLearningAdmissionSource(trimmed)) {
    return false;
  }
  const asksExternalSource =
    /(?:微信)?公众号|网页|网上|互联网|网络|网站|资料库|知识库|推特|twitter|x\/twitter|\bX\b/iu.test(
      trimmed,
    );
  const asksSearch =
    /搜索|搜一下|查找|找一下|找找|看一下|看看|有没有|哪里有|哪有|查一查|检索|调研|研究/u.test(
      trimmed,
    );
  const asksLearningOutput =
    /学习内容|学习资料|教程|文章|资料|经验|知识|案例|链接|信息|最新内容|最新资料|玩法/u.test(
      trimmed,
    );
  const asksToBringBackLearning =
    /(?:学习|整理|吸收|沉淀|记录|保存)(?:一下|下来|起来|成经验|成知识|为经验|为知识)?/u.test(
      trimmed,
    );
  const hasLearningIntent =
    isExplicitLearningAdmissionPrompt(trimmed) ||
    /^(?:现在|先|再)?(?:去|帮我|请你?|麻烦你)?\s*(?:搜索|搜一下|查找|找一下|找找|看一下|看看|调研|研究)(?:一下)?/u.test(
      trimmed,
    ) ||
    (asksExternalSource && asksSearch && asksLearningOutput) ||
    (asksExternalSource && asksSearch && asksToBringBackLearning) ||
    (asksExternalSource && asksLearningOutput && asksToBringBackLearning);
  if (!hasLearningIntent) {
    return false;
  }
  return /(?:文章|资料|教程|经验|知识|案例|公众号|网页|推特|twitter|x\/twitter|\bX\b|链接|信息|学习内容|最新内容|最新资料|玩法|学习下来)/iu.test(
    trimmed,
  );
}

export function extractNaturalLearningSearchQuery(text: string): string {
  return (
    extractLearningAdmissionText(text)
      .replace(/^(?:(?:现在|帮我|请你|请|麻烦你|去|先|再)\s*)+/u, "")
      .replace(/^\/学习\s*/u, "")
      .replace(/^(?:学习|研究|调研)(?:一下)?\s*/u, "")
      .replace(
        /^(?:微信公众号|微信?公众号|公众号|网页|网上|互联网|网络|网站|推特|twitter|x\/twitter|\bX\b)(?:的)?\s*/iu,
        "",
      )
      .replace(
        /^(?:搜索|搜一下|查找|找一下|找找|看一下|看看|调研|研究|检索|查一查)(?:一下)?\s*/u,
        "",
      )
      .replace(/^(?:你)?(?:现在|帮我|请你|请|麻烦你|去|先|再)\s*/u, "")
      .replace(
        /^(?:去)?(?:微信公众号|微信?公众号|公众号|网页|网上|互联网|网络|网站|推特|twitter|x\/twitter|\bX\b)(?:看一下|看看|找一下|搜一下|搜索一下|查一下|查找一下|有没有|学习|研究|调研)?\s*/iu,
        "",
      )
      .replace(/^(?:学习|研究|调研)(?:一下)?\s*/u, "")
      .replace(/^(?:有没有|哪里有|哪有)\s*/u, "")
      .replace(
        /(?:，|,)?\s*(?:学习|整理|吸收|沉淀|记录|保存)(?:一下|下来|起来|成经验|成知识|为经验|为知识)?$/u,
        "",
      )
      .trim() || text.trim()
  );
}

export function extractLearningAdmissionText(text: string): string {
  return text
    .trim()
    .replace(/^\/?学习(?:一下|这个|以下|这段|资料|内容|经验)?[:：\s]*/u, "")
    .replace(
      /^(?:请|帮我)?(?:学习|吸收|记录|保存)(?:一下|这个|以下|这段|资料|内容|经验)?[:：\s]*/u,
      "",
    )
    .trim();
}

export function isCasualPersonalLearningOrMakingStatement(text: string): boolean {
  return /^我(?:今天|刚刚|刚才|现在|之前|以前|最近)?(?:在)?(?:学习|学了|研究|看了|做了|制作了|写了|设计了|创作了)/u.test(
    text.trim(),
  );
}

export function isLowAdmissionText(text: string): boolean {
  const trimmed = text.trim();
  if (
    parseChannelSlashCommand(trimmed) !== null ||
    hasLearningAdmissionSource(trimmed) ||
    isExplicitLearningAdmissionPrompt(trimmed) ||
    isAgentCapabilityQuestion(trimmed)
  ) {
    return false;
  }
  if (isLowValueChannelChitchat(text)) {
    return true;
  }
  if (isLowSignalCasualConversationText(trimmed)) {
    return true;
  }
  if (!/(学习|经验|知识|资料|制作|生成|写|设计|创作|策划|做)/u.test(trimmed)) {
    return false;
  }
  return isCasualPersonalLearningOrMakingStatement(trimmed);
}

export function isLowSignalCasualConversationText(text: string): boolean {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if (trimmed.length === 0) {
    return true;
  }
  if (
    /(?:今天天气|天气不错|随便聊聊|随便说说|闲聊|没事|路过|看看|测试一下|心情不错|挺开心)/u.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (trimmed.length > 32) {
    return false;
  }
  return !hasDirectorAdmissionSignal(trimmed);
}

function hasDirectorAdmissionSignal(text: string): boolean {
  return /(?:确认|继续|执行|补充|然后|另外|加上|改成|调整|不要|需要|主题|角色|场景|风格|时长|结尾|开头|学习|经验|知识|资料|链接|文件|目录|制作|生成|写|设计|创作|策划|做|短剧|视频|影片|片子|分镜|镜头|脚本|剧本|故事板|图片|记住|以后|默认|偏好|反馈|不对|错误|改进|建议|问题|bug|create|make|generate|write|design|produce|continue|revise|script|video|brief|story|storyboard|shot|task|objective|learn|study|research|reference|https?:\/\/|file:\/\/|(?:^|[\s：:])\/(?:Users|Volumes|tmp|var)\/)/iu.test(
    text,
  );
}

export function looksLikeProductionSupplement(text: string): boolean {
  const trimmed = text.trim();
  if (isChannelSearchFollowup(trimmed)) {
    return false;
  }
  return /^(?:然后|再|另外|补充|补充一下|加上|加一个|改成|改一下|换成|调整|把|不要|需要|风格|主题|角色|场景|时长|结尾|开头|制作(?:风格|要求|时))/u.test(
    trimmed,
  );
}

export function isHighSignalChannelContextLine(text: string): boolean {
  const normalized = normalizeChannelContextText(text);
  return (
    normalized.length >= 8 &&
    /(seedance|sora|comfyui|短剧|视频|分镜|镜头|脚本|剧本|制作|经验|知识|资料|公众号|模型|工作流|图片|图生视频|文生视频)/iu.test(
      normalized,
    )
  );
}

export function shouldUseRecentChannelContext(text: string): boolean {
  return (
    /(这方面|这个|那个|刚才|前面|上面|它|相关|类似)/u.test(text) ||
    isChannelExecuteFollowup(text) ||
    isChannelSearchFollowup(text)
  );
}

export function isChannelSearchFollowup(text: string): boolean {
  const trimmed = text.trim().replace(/\s+/gu, "");
  if (trimmed.length === 0) {
    return false;
  }
  return (
    /^(?:再|继续|重新|接着|然后)?(?:去)?(?:搜索|搜一下|搜|查找|找一下|找找|检索|查一查|查|找)(?:看|看看|一下|一次)?$/u.test(
      trimmed,
    ) ||
    /(?:再|继续|重新|接着|然后)(?:去)?(?:搜索|搜一下|搜|查找|找一下|找找|检索|查一查|查)/u.test(
      trimmed,
    )
  );
}

export function looksLikeChannelContextOnlyMessage(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^(?:我(?:最近|现在|想|打算|准备|正在|在)?|最近|现在)?(?:想|打算|准备|正在|在)?(?:研究|了解|关注|看看|学习)/u.test(
      trimmed,
    ) &&
    isHighSignalChannelContextLine(trimmed) &&
    hasDirectorChannelContextTopic(trimmed) &&
    !/^(?:请|帮我|你|Angel)?(?:去)?(?:学习|研究|吸收|收录|保存|记录|沉淀|整理|提炼)(?:一下|下|这|这个|这段|这些|上面|刚才)?/u.test(
      trimmed,
    ) &&
    !/(搜索|搜一下|查找|找一下|学习一下|去学习|帮我学习|生成|写|做|创建|出一版|给我|帮我制作|请制作|制作一个|制作一条)/u.test(
      trimmed,
    )
  );
}

export function selectRecentChannelContextLines(
  lines: readonly string[],
  options: { readonly maxLines?: number } = {},
): readonly string[] {
  const maxLines = options.maxLines ?? 3;
  return lines
    .map((line) => normalizeChannelContextText(line))
    .filter(isHighSignalChannelContextLine)
    .slice(-maxLines);
}

export function appendRecentChannelContext(input: {
  readonly text: string;
  readonly contextLines: readonly string[];
  readonly prefix?: string;
  readonly separator?: string;
  readonly maxLines?: number;
}): string {
  const text = normalizeChannelContextText(input.text);
  if (!shouldUseRecentChannelContext(text)) {
    return text;
  }
  const contextLines = selectRecentChannelContextLines(input.contextLines, {
    maxLines: input.maxLines ?? 3,
  }).filter((line) => line !== text);
  if (contextLines.length === 0) {
    return text;
  }
  return `${text}${input.separator ?? "。"}${input.prefix ?? "近期对话上下文："}${contextLines.join("；")}`;
}

function isChannelExecuteFollowup(text: string): boolean {
  return /^(?:那就)?(?:执行|开始|继续执行|马上执行|去做|做吧)$/u.test(text.trim());
}

export function isChannelReviewActionIntent(text: string): boolean {
  return /^(接受|同意|通过|晋升|发布|召回|继续|下一步)$/u.test(text.trim());
}

export function isChannelNextStepQuestion(text: string): boolean {
  return /^(我该做什么|下一步做什么|现在做什么|怎么继续|接下来做什么|下一步呢|现在呢)$/u.test(
    text.trim(),
  );
}

export function isChannelRunApprovalIntent(text: string): boolean {
  const trimmed = text.trim();
  return /(待审|审批|批准|通过).{0,24}(任务|assignment|制作|运行|run)|(任务|assignment|制作|运行|run).{0,24}(批准|通过)/iu.test(
    trimmed,
  );
}

export function isChannelRejectIntent(text: string): boolean {
  const trimmed = text.trim();
  if (hasChannelExperienceAcceptWithCaveatIntent(trimmed)) {
    return false;
  }
  if (/^(拒绝|不要|丢弃)$/u.test(trimmed)) {
    return true;
  }
  if (looksLikeAnswerOnlyLearningConstraint(trimmed)) {
    return false;
  }
  if (/(?:别|不要|不必|不用).{0,12}(?:存|保存|收录|沉淀|入库|当经验|放进经验)/u.test(trimmed)) {
    return true;
  }
  if (looksLikeRejectDiscussionQuestion(trimmed)) {
    return false;
  }
  return /(?:图片|页面|内容|刚才那条).{0,16}(?:没看懂|不对|错了|不可信|低置信)/u.test(trimmed);
}

function looksLikeAnswerOnlyLearningConstraint(text: string): boolean {
  return (
    /(?:不要|别|先别|暂时别|不必|不用|无需).{0,12}(?:存|保存|收录|沉淀|入库|写入|记忆|当经验|放进经验|生成候选|创建候选)/u.test(
      text,
    ) && /(?:只|仅|先|直接).{0,12}(?:回答|回复|总结|摘要|读取|打开|看看|告诉|分析|解释)/u.test(text)
  );
}

function looksLikeRejectDiscussionQuestion(text: string): boolean {
  return (
    /[?？]/u.test(text) ||
    /(?:如果|假如|要是|为什么|为何|怎么|怎么办|如何|有什么用|是否|是不是|能不能|可不可以)/u.test(
      text,
    )
  );
}

function hasChannelExperienceAcceptWithCaveatIntent(text: string): boolean {
  return (
    /(?:收录|保存|接受|通过|批准|入库|存起来|记下来|保留|留着)/u.test(text) &&
    /(?:但|但是|不过|只是|其中|部分|先).{0,18}(?:低置信|标低置信|降权|降置信|待验证|不完整|有风险|存疑)/u.test(
      text,
    )
  );
}

export function resolveChannelRunCommandIdFromVerb(verb: string): ChannelRunCommandId | null {
  const normalized = verb.trim().toLowerCase();
  if (matchesChannelVerb(normalized, ["状态", "status"])) {
    return "run.status";
  }
  if (matchesChannelVerb(normalized, ["启动", "开始", "start"])) {
    return "run.start";
  }
  if (matchesChannelVerb(normalized, ["推进", "执行一次", "once"])) {
    return "run.once";
  }
  if (matchesChannelVerb(normalized, ["继续", "继续推进", "continue"])) {
    return "run.continue";
  }
  if (matchesChannelVerb(normalized, ["协作", "角色", "分工", "delegations", "workers", "crew"])) {
    return "run.delegations";
  }
  if (matchesChannelVerb(normalized, ["暂停", "pause"])) {
    return "run.pause";
  }
  if (matchesChannelVerb(normalized, ["恢复", "resume"])) {
    return "run.resume";
  }
  if (matchesChannelVerb(normalized, ["中止", "取消", "停止", "abort", "stop"])) {
    return "run.abort";
  }
  if (matchesChannelVerb(normalized, ["报告", "report"])) {
    return "run.report";
  }
  if (matchesChannelVerb(normalized, ["解释", "说明", "explain"])) {
    return "run.explain";
  }
  if (matchesChannelVerb(normalized, ["审计", "审查", "audit"])) {
    return "run.audit";
  }
  if (matchesChannelVerb(normalized, ["重试", "retry"])) {
    return "run.retry";
  }
  if (matchesChannelVerb(normalized, ["批准全部", "全部批准", "approve-all", "approveall"])) {
    return "run.approvePending";
  }
  if (matchesChannelVerb(normalized, ["批准", "通过", "approve"])) {
    return "run.approve";
  }
  if (matchesChannelVerb(normalized, ["切换", "改派", "reroute"])) {
    return "run.reroute";
  }
  return null;
}

export function resolveChannelNaturalRunCommandId(text: string): ChannelRunCommandId | null {
  const normalized = text.trim();
  if (matchesAnyChannelText(normalized, ["状态", "status"])) {
    return "run.status";
  }
  if (matchesAnyChannelText(normalized, ["启动", "开始", "start"])) {
    return "run.start";
  }
  if (matchesAnyChannelText(normalized, ["推进", "执行一次", "跑一轮", "once"])) {
    return "run.once";
  }
  if (matchesAnyChannelText(normalized, ["继续", "继续推进", "continue"])) {
    return "run.continue";
  }
  if (
    matchesAnyChannelText(normalized, ["协作", "角色", "分工", "delegations", "workers", "crew"])
  ) {
    return "run.delegations";
  }
  if (matchesAnyChannelText(normalized, ["暂停", "pause"])) {
    return "run.pause";
  }
  if (matchesAnyChannelText(normalized, ["恢复", "resume"])) {
    return "run.resume";
  }
  if (matchesAnyChannelText(normalized, ["中止", "取消", "停止", "abort", "stop"])) {
    return "run.abort";
  }
  if (matchesAnyChannelText(normalized, ["报告", "report"])) {
    return "run.report";
  }
  if (matchesAnyChannelText(normalized, ["解释", "说明", "explain"])) {
    return "run.explain";
  }
  if (matchesAnyChannelText(normalized, ["审计", "审查", "audit"])) {
    return "run.audit";
  }
  return null;
}

export function parseChannelNaturalRunManagementIntent(
  text: string,
): ChannelNaturalRunManagementIntent | null {
  const runId = extractChannelRunId(text);
  if (runId.length === 0) {
    return null;
  }

  const assignmentId = extractChannelAssignmentId(text);
  if (assignmentId.length > 0 && matchesAnyChannelText(text, ["重试", "retry"])) {
    return { kind: "assignment.retry", runId, assignmentId };
  }
  if (assignmentId.length > 0 && matchesAnyChannelText(text, ["批准", "通过", "approve"])) {
    return { kind: "assignment.approve", runId, assignmentId };
  }
  if (matchesAnyChannelText(text, ["批准全部", "全部通过", "待审"])) {
    return { kind: "run.approvePending", runId };
  }
  if (matchesAnyChannelText(text, ["复盘", "反思", "reflect"])) {
    return { kind: "run.reflect", runId };
  }

  const commandId = resolveChannelNaturalRunCommandId(text);
  if (commandId === null) {
    return null;
  }
  return { kind: "run.command", runId, commandId };
}

export function parseChannelNaturalHeartbeatManagementIntent(
  text: string,
): ChannelNaturalHeartbeatManagementIntent | null {
  if (!matchesAnyChannelText(text, ["心跳", "heartbeat"])) {
    return null;
  }
  if (matchesAnyChannelText(text, ["开启", "启用", "打开"])) {
    return { kind: "heartbeat.enable" };
  }
  if (matchesAnyChannelText(text, ["关闭", "禁用"])) {
    return { kind: "heartbeat.disable" };
  }
  return { kind: "heartbeat.status" };
}

export function parseChannelNaturalMemoryManagementIntent(
  text: string,
): ChannelNaturalMemoryManagementIntent | null {
  if (!matchesAnyChannelText(text, ["记忆", "memory"])) {
    return null;
  }
  const sessionId = extractChannelSessionId(text);
  if (sessionId.length > 0 && matchesAnyChannelText(text, ["查看", "检查", "inspect"])) {
    return { kind: "session.inspect", sessionId };
  }
  if (sessionId.length > 0 && matchesAnyChannelText(text, ["清理", "清空", "删除"])) {
    return { kind: "session.clearWorking", sessionId };
  }
  if (matchesAnyChannelText(text, ["状态", "查看", "检查"])) {
    return { kind: "memory.status" };
  }
  return null;
}

export function parseChannelNaturalWorkspaceManagementIntent(
  text: string,
): ChannelNaturalWorkspaceManagementIntent | null {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return null;
  }

  if (
    matchesExplicitChannelManagementText(
      normalized,
      ["skill", "技能"],
      ["列表", "查看", "管理", "候选", "状态"],
    )
  ) {
    return { kind: "skills.list" };
  }
  if (
    matchesExplicitChannelManagementText(
      normalized,
      ["外部工具", "工具", "adapter", "cli", "连接", "平台"],
      ["列表", "查看", "管理", "状态", "连接"],
    )
  ) {
    return { kind: "tools.list" };
  }
  if (
    matchesExplicitChannelManagementText(
      normalized,
      ["api", "供应方", "供应商", "模型供应", "模型供应方"],
      ["列表", "查看", "管理", "状态", "配置", "设置"],
    )
  ) {
    return { kind: "providers.list" };
  }
  if (
    matchesExplicitChannelManagementText(
      normalized,
      ["设置", "配置", "开关", "权限", "switch", "隐私"],
      ["列表", "查看", "管理", "状态", "打开", "进入"],
    )
  ) {
    return { kind: "settings.list" };
  }
  if (matchesExplicitWorkspaceStatusText(normalized)) {
    return { kind: "workspace.status" };
  }
  if (
    matchesExplicitChannelManagementText(
      normalized,
      ["诊断", "健康", "doctor"],
      ["运行", "查看", "检查", "工作区"],
    )
  ) {
    return { kind: "workspace.doctor" };
  }
  if (
    matchesExplicitChannelManagementText(
      normalized,
      ["审查", "队列", "review"],
      ["查看", "管理", "列表", "打开"],
    )
  ) {
    return { kind: "review.list" };
  }
  return null;
}

export function parseChannelNaturalImageGenerationIntent(
  text: string,
): ChannelNaturalImageGenerationIntent | null {
  const normalized = text.trim();
  if (normalized.length === 0 || isExplanatoryChannelQuestion(normalized)) {
    return null;
  }
  const looksLikeImageGeneration =
    /(生成|制作|创建|做一张|出一张).{0,12}(图片|图像|海报|插画|封面|视觉图)/u.test(normalized) ||
    /(^|[\s，。；:：])(出图|绘制|画)(一个|一张|一幅|张|幅|个|出|下|:|：|\s)/u.test(normalized) ||
    /\b(generate|create|draw)\s+(an?\s+)?(image|picture|poster|illustration)\b/iu.test(normalized);
  if (!looksLikeImageGeneration) {
    return null;
  }
  const prompt = extractChannelImagePrompt(normalized);
  return { prompt };
}

export function parseChannelNaturalVideoGenerationIntent(
  text: string,
): ChannelNaturalVideoGenerationIntent | null {
  const normalized = text.trim();
  if (normalized.length === 0 || isExplanatoryChannelQuestion(normalized)) {
    return null;
  }
  const looksLikeVideoGeneration =
    /^(?:@|\/)?\s*(?:生成视频|视频生成|文生视频|图生视频|做视频|出视频|video)\b/iu.test(
      normalized,
    ) ||
    /(生成|制作|创建|做|出).{0,12}(视频|短片|影片|片子|动画|动图)/u.test(normalized) ||
    /\b(generate|create|make)\s+(a\s+)?(video|clip|movie)\b/iu.test(normalized);
  if (!looksLikeVideoGeneration) {
    return null;
  }
  return { prompt: extractChannelVideoPrompt(normalized) };
}

export function resolveChannelCapabilityRoute(
  text: string,
  options: ResolveChannelCapabilityRouteOptions = {},
): ConversationTurnCapabilityRouteDecision {
  const normalized = text.trim();
  const inputModalities = resolveChannelInputModalities(normalized, options.attachments);
  const modelAbilityGroups = resolveChannelModelAbilityGroups(options.textModelCapabilities ?? {});
  const imageGeneration = parseChannelNaturalImageGenerationIntent(normalized);
  if (isExplicitChannelImageGenerationRequest(normalized) || imageGeneration !== null) {
    return {
      abilityGroup: "image_generation",
      intentKind: "image_generation",
      inputModalities,
      outputModality: "image",
      requiresMediaUnderstanding: inputModalities.some(isMediaUnderstandingModality),
      explicitGeneration: true,
      reason: "用户明确要求生成图片，路由到图片生成组。",
      modelAbilityGroups,
    };
  }

  const videoGeneration = parseChannelNaturalVideoGenerationIntent(normalized);
  if (isExplicitChannelVideoGenerationRequest(normalized) || videoGeneration !== null) {
    return {
      abilityGroup: "video_generation",
      intentKind: "video_generation",
      inputModalities,
      outputModality: "video",
      requiresMediaUnderstanding: inputModalities.some(isMediaUnderstandingModality),
      explicitGeneration: true,
      reason: "用户明确要求生成视频，路由到视频生成组。",
      modelAbilityGroups,
    };
  }

  const requiresMediaUnderstanding = inputModalities.some(isMediaUnderstandingModality);
  if (requiresMediaUnderstanding) {
    const textModelCanHandleVision = canTextModelHandleMediaUnderstanding(
      options.textModelCapabilities,
      inputModalities,
    );
    return {
      abilityGroup: textModelCanHandleVision ? "text" : "vision",
      intentKind: "media_understanding",
      inputModalities,
      outputModality: "text",
      requiresMediaUnderstanding: true,
      explicitGeneration: false,
      textModelCanHandleVision,
      reason: textModelCanHandleVision
        ? "输入包含图片或视频，当前文本模型具备理解能力，继续走文本组。"
        : "输入包含图片或视频，当前文本模型不具备理解能力，切到视觉组。",
      modelAbilityGroups,
    };
  }

  return {
    abilityGroup: "text",
    intentKind: "text_chat",
    inputModalities,
    outputModality: "text",
    requiresMediaUnderstanding: false,
    explicitGeneration: false,
    reason: "默认日常对话走文本组。",
    modelAbilityGroups,
  };
}

export function resolveChannelModelAbilityGroups(
  input: ResolveChannelModelAbilityGroupsInput,
): readonly ConversationTurnAbilityGroup[] {
  const normalizedCapabilities = new Set(
    [
      ...(input.capabilities ?? []),
      ...(readMetadataStringList(input.metadata, "capabilities") ?? []),
    ]
      .map((capability) => capability.trim().toLowerCase())
      .filter(Boolean),
  );
  const normalizedModalities = new Set(
    (input.inputModalities ?? []).map((modality) => modality.trim().toLowerCase()).filter(Boolean),
  );
  const groups: ConversationTurnAbilityGroup[] = [];
  if (
    normalizedCapabilities.has("text") ||
    normalizedCapabilities.has("chat") ||
    normalizedCapabilities.has("model.text")
  ) {
    groups.push("text");
  }
  if (
    normalizedCapabilities.has("vision") ||
    normalizedCapabilities.has("model.vision") ||
    normalizedCapabilities.has("media.understand_image") ||
    normalizedCapabilities.has("media.understand_video") ||
    normalizedModalities.has("image") ||
    normalizedModalities.has("video")
  ) {
    groups.push("vision");
  }
  if (
    normalizedCapabilities.has("image_generation") ||
    normalizedCapabilities.has("media.generate_image") ||
    normalizedCapabilities.has("image")
  ) {
    groups.push("image_generation");
  }
  if (
    normalizedCapabilities.has("video_generation") ||
    normalizedCapabilities.has("media.generate_video") ||
    normalizedCapabilities.has("video")
  ) {
    groups.push("video_generation");
  }
  return uniqueChannelAbilityGroups(groups);
}

export function parseChannelExperienceClassificationIntent(
  text: string,
): ChannelExperienceClassificationIntent | null {
  const match = /(?:给|把)?\s*经验\s+(\S+)\s+分类\s+(\S+)(?:\s+标签\s+(.+))?/u.exec(text);
  if (match === null) {
    return null;
  }
  const candidateId = match[1]?.trim() ?? "";
  const categoryId = match[2]?.trim() ?? "";
  if (candidateId.length === 0 || categoryId.length === 0) {
    return null;
  }
  return {
    candidateId,
    categoryId,
    tagIds: normalizeChannelTokenList(match[3] === undefined ? [] : match[3].split(/\s+/u)),
  };
}

export function parseChannelExperienceManagementIntent(
  text: string,
): ChannelExperienceManagementIntent | null {
  if (!matchesAnyChannelText(text, ["经验"])) {
    return null;
  }

  const categoryName = extractChannelNaturalTail(text, /(?:新建|创建|添加).{0,6}经验分类\s+/u);
  if (categoryName.length > 0) {
    return { kind: "category.create", name: categoryName };
  }

  const tagName = extractChannelNaturalTail(text, /(?:新建|创建|添加).{0,6}经验标签\s+/u);
  if (tagName.length > 0) {
    return { kind: "tag.create", name: tagName };
  }

  const classification = parseChannelExperienceClassificationIntent(text);
  if (classification !== null) {
    return { kind: "candidate.classify", ...classification };
  }

  const candidateId = extractChannelCandidateId(text);
  if (candidateId.length > 0 && matchesAnyChannelText(text, ["解释", "说明", "详情", "查看"])) {
    return { kind: "candidate.explain", candidateId };
  }
  if (candidateId.length > 0 && matchesAnyChannelText(text, ["接受", "通过", "批准"])) {
    return { kind: "candidate.accept", candidateId };
  }
  if (candidateId.length > 0 && matchesAnyChannelText(text, ["拒绝", "丢弃", "不要"])) {
    return { kind: "candidate.reject", candidateId };
  }
  if (candidateId.length > 0 && matchesAnyChannelText(text, ["晋升", "沉淀"])) {
    return { kind: "candidate.promote", candidateId };
  }
  if (matchesAnyChannelText(text, ["经验列表", "经验候选", "列出经验", "查看经验"])) {
    return { kind: "candidate.list" };
  }
  return null;
}

export function parseChannelKnowledgeManagementIntent(
  text: string,
): ChannelKnowledgeManagementIntent | null {
  if (!matchesAnyChannelText(text, ["知识"])) {
    return null;
  }

  const packId = extractChannelKnowledgePackId(text);
  if (
    packId.length > 0 &&
    matchesAnyChannelText(text, ["候选"]) &&
    matchesAnyChannelText(text, ["解释", "说明", "详情", "查看"])
  ) {
    return { kind: "candidate.explain", packId };
  }
  if (packId.length > 0 && matchesAnyChannelText(text, ["diff", "差异", "变更"])) {
    return { kind: "candidate.diff", packId };
  }
  if (packId.length > 0 && matchesAnyChannelText(text, ["审查", "审核", "review"])) {
    return { kind: "candidate.review", packId };
  }
  if (packId.length > 0 && matchesAnyChannelText(text, ["解释", "说明", "详情", "查看"])) {
    return { kind: "pack.explain", packId };
  }
  if (packId.length > 0 && matchesAnyChannelText(text, ["接受", "通过", "批准"])) {
    return { kind: "candidate.accept", packId };
  }
  if (packId.length > 0 && matchesAnyChannelText(text, ["发布"])) {
    return { kind: "candidate.publish", packId };
  }
  if (packId.length > 0 && matchesAnyChannelText(text, ["拒绝"])) {
    return { kind: "candidate.reject", packId };
  }
  if (matchesAnyChannelText(text, ["知识状态"])) {
    return { kind: "status" };
  }
  if (matchesAnyChannelText(text, ["已发布知识", "知识包列表"])) {
    return { kind: "published.list" };
  }
  if (matchesAnyChannelText(text, ["知识候选", "待审知识"])) {
    return { kind: "candidate.list" };
  }
  if (matchesAnyChannelText(text, ["召回"])) {
    return { kind: "recall.preview" };
  }
  return null;
}

function normalizeChannelContextText(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

function normalizeChannelTokenList(values: readonly string[]): readonly string[] {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function matchesChannelVerb(value: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => value === alias.toLowerCase());
}

function matchesAnyChannelText(value: string, needles: readonly string[]): boolean {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function matchesExplicitChannelManagementText(
  value: string,
  nouns: readonly string[],
  verbs: readonly string[],
): boolean {
  const normalized = value.trim();
  if (normalized.length > 80) {
    return false;
  }
  if (isExplanatoryChannelQuestion(normalized)) {
    return false;
  }
  const hasNoun = matchesAnyChannelText(normalized, nouns);
  if (!hasNoun) {
    return false;
  }
  if (
    /^(?:\/)?(?:skill|skills|技能|外部工具|工具|api|供应方|供应商|模型供应方|设置|开关|状态|诊断|审查队列|review)$/iu.test(
      normalized,
    )
  ) {
    return true;
  }
  if (
    /^(?:请|帮我|麻烦你?|打开|进入|查看|检查|运行|看一下|列出|管理|显示|切到|去|我要看|我想看|当前|现在)\s*/u.test(
      normalized,
    )
  ) {
    return true;
  }
  return (
    /(?:列表|管理|状态|配置页|设置页)$/u.test(normalized) &&
    matchesAnyChannelText(normalized, verbs)
  );
}

function matchesExplicitWorkspaceStatusText(value: string): boolean {
  const normalized = value.trim();
  if (isExplanatoryChannelQuestion(normalized)) {
    return false;
  }
  if (/^(?:状态|status)$/iu.test(normalized)) {
    return true;
  }
  return (
    /^(?:请|帮我|麻烦你?)?\s*(?:查看|检查|看一下|打开|显示)\s*(?:当前|本机|工作区|系统|运行时)?\s*(?:状态|status)$/iu.test(
      normalized,
    ) || /^(?:当前|本机|工作区|系统|运行时)\s*(?:状态|status)$/iu.test(normalized)
  );
}

function isExplanatoryChannelQuestion(value: string): boolean {
  return /(?:为什么|为何|怎么|怎样|如何|是否|是不是|能不能|会不会|应该|需要|可以吗|哪个|哪款|哪种|哪家|谁家|排行|排名|榜单|最厉害|最好|最强|推荐|对比|测评|模型|吗|呢|\?|？)/u.test(
    value,
  );
}

function extractChannelImagePrompt(value: string): string {
  const normalized = value.trim();
  const withoutPrefix = normalized.replace(
    /^(?:@|\/)?\s*(请|帮我|帮忙|麻烦)?\s*(生成图片|图片生成|生成|制作|创建|绘制|画|出图|做一张)\s*(一个|一张|一幅|张|幅|个)?\s*(图片|图像|海报|插画|封面|视觉图)?\s*[:：,，-]?\s*/u,
    "",
  );
  return withoutPrefix.trim() || normalized;
}

function extractChannelVideoPrompt(value: string): string {
  const normalized = value.trim();
  const withoutPrefix = normalized.replace(
    /^(?:@|\/)?\s*(请|帮我|帮忙|麻烦)?\s*(生成视频|视频生成|文生视频|图生视频|生成|制作|创建|做|出)\s*(一个|一条|一段|条|段|个)?\s*(视频|短片|影片|片子|动画|动图)?\s*[:：,，-]?\s*/u,
    "",
  );
  return withoutPrefix.trim() || normalized;
}

function isExplicitChannelImageGenerationRequest(text: string): boolean {
  return /^(?:@|\/)\s*(?:生成图片|图片生成|生图|文生图|图生图|image)\b/iu.test(text.trim());
}

function isExplicitChannelVideoGenerationRequest(text: string): boolean {
  return /^(?:@|\/)\s*(?:生成视频|视频生成|文生视频|图生视频|video)\b/iu.test(text.trim());
}

function resolveChannelInputModalities(
  text: string,
  attachments: readonly ConversationTurnAttachment[] | undefined,
): readonly ConversationTurnInputModality[] {
  const modalities: ConversationTurnInputModality[] = [];
  if (text.trim().length > 0) {
    modalities.push("text");
  }
  for (const attachment of attachments ?? []) {
    appendChannelInputModality(modalities, normalizeAttachmentModality(attachment));
  }
  return modalities.length === 0 ? ["text"] : modalities;
}

function normalizeAttachmentModality(
  attachment: ConversationTurnAttachment,
): ConversationTurnInputModality {
  const kind = String(attachment.kind ?? "").toLowerCase();
  const mimeType = String(attachment.mimeType ?? "").toLowerCase();
  if (kind === "image" || mimeType.startsWith("image/")) {
    return "image";
  }
  if (kind === "video" || mimeType.startsWith("video/")) {
    return "video";
  }
  if (kind === "audio" || mimeType.startsWith("audio/")) {
    return "audio";
  }
  if (kind === "link" || /^https?:\/\//iu.test(attachment.url ?? "")) {
    return "link";
  }
  return kind === "text" ? "text" : "file";
}

function appendChannelInputModality(
  modalities: ConversationTurnInputModality[],
  modality: ConversationTurnInputModality,
): void {
  if (!modalities.includes(modality)) {
    modalities.push(modality);
  }
}

function isMediaUnderstandingModality(modality: ConversationTurnInputModality): boolean {
  return modality === "image" || modality === "video";
}

function canTextModelHandleMediaUnderstanding(
  capabilities: ConversationTurnModelCapabilities | undefined,
  modalities: readonly ConversationTurnInputModality[],
): boolean {
  if (capabilities === undefined) {
    return false;
  }
  if (capabilities.mediaUnderstanding === true) {
    return true;
  }
  if (modalities.includes("image") && !canTextModelHandleImageUnderstanding(capabilities)) {
    return false;
  }
  if (modalities.includes("video") && !canTextModelHandleVideoUnderstanding(capabilities)) {
    return false;
  }
  return modalities.some(isMediaUnderstandingModality);
}

function canTextModelHandleImageUnderstanding(
  capabilities: ConversationTurnModelCapabilities,
): boolean {
  return (
    capabilities.vision === true ||
    capabilities.imageUnderstanding === true ||
    capabilities.capabilities?.some((capability) =>
      /^(?:vision|model\.vision|media\.understand_image)$/iu.test(capability),
    ) === true ||
    capabilities.inputModalities?.includes("image") === true
  );
}

function canTextModelHandleVideoUnderstanding(
  capabilities: ConversationTurnModelCapabilities,
): boolean {
  return (
    capabilities.videoUnderstanding === true ||
    capabilities.capabilities?.some((capability) =>
      /^(?:vision|model\.vision|media\.understand_video)$/iu.test(capability),
    ) === true ||
    capabilities.inputModalities?.includes("video") === true
  );
}

function uniqueChannelAbilityGroups(
  groups: readonly ConversationTurnAbilityGroup[],
): readonly ConversationTurnAbilityGroup[] {
  const ordered: ConversationTurnAbilityGroup[] = [
    "text",
    "vision",
    "image_generation",
    "video_generation",
  ];
  const seen = new Set(groups);
  return ordered.filter((group) => seen.has(group));
}

function readMetadataStringList(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] | undefined {
  const value = metadata?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function extractChannelNaturalTail(value: string, markerPattern: RegExp): string {
  const match = markerPattern.exec(value);
  if (match === null) {
    return "";
  }
  return value
    .slice(match.index + match[0].length)
    .trim()
    .replace(/[，。；：,.;:]+$/u, "");
}

function extractChannelCandidateId(value: string): string {
  return extractChannelFirstIdentifier(value, /\bcandidate[-_:][A-Za-z0-9_.:-]+/iu);
}

function extractChannelKnowledgePackId(value: string): string {
  return extractChannelFirstIdentifier(value, /\bpack[-_:][A-Za-z0-9_.:-]+/iu);
}

function extractChannelRunId(value: string): string {
  return extractChannelFirstIdentifier(value, /\brun[-_:][A-Za-z0-9_.:-]+/iu);
}

function extractChannelAssignmentId(value: string): string {
  return extractChannelFirstIdentifier(value, /\bassignment[-_:][A-Za-z0-9_.:-]+/iu);
}

function extractChannelSessionId(value: string): string {
  return extractChannelFirstIdentifier(value, /\bsession[-_:][A-Za-z0-9_.:-]+/iu);
}

function extractChannelFirstIdentifier(value: string, pattern: RegExp): string {
  const match = pattern.exec(value);
  return match === null ? "" : stripChannelTrailingIdentifierPunctuation(match[0]);
}

function stripChannelTrailingIdentifierPunctuation(value: string): string {
  return value.replace(/[)\]}>,.;:!?，。；：！？、]+$/u, "");
}

function hasDirectorChannelContextTopic(text: string): boolean {
  return /(seedance|sora|comfyui|短剧|视频|分镜|镜头|脚本|剧本|工作流|图片|图生视频|文生视频|公众号|模型)/iu.test(
    text,
  );
}

export function needsHumanTraffickingBoundary(text: string): boolean {
  return /买.*女|买.*老婆|买妻|拐卖|人口买卖|强迫婚姻|被卖/iu.test(text);
}

export function hasCriticalHumanTraffickingFrame(text: string): boolean {
  return /批判|救助|解救|逃离|逃脱|反抗|反拐|报警|法律|追责|惩罚|后果|受害者|女性主体|不能美化|不美化/iu.test(
    text,
  );
}

export function hasRomanticizedHumanTraffickingFrame(text: string): boolean {
  return /爱情美满|幸福美满|相爱|爱上|圆满|甜宠|最终.*在一起|终成眷属|真爱/iu.test(text);
}

export type ChannelContentSafetyMode = "standard" | "developer-debug";
export type ChannelContentSafetyFloor = "none" | "operator-approval" | "hard";
export type ChannelContentSafetySeverity = "info" | "warning" | "blocked";

export interface ChannelContentSafetyEvaluation {
  readonly verdict: "allow" | "rewrite-required";
  readonly mode: ChannelContentSafetyMode;
  readonly floor: ChannelContentSafetyFloor;
  readonly severity: ChannelContentSafetySeverity;
  readonly canOverride: boolean;
  readonly requiresApproval: boolean;
  readonly ruleId?: string;
  readonly reason?: string;
  readonly safeRewriteObjective?: string;
  readonly auditEvent?: string;
  readonly debugNotes?: readonly string[];
}

export function evaluateProductionContentSafety(
  text: string,
  options: { readonly mode?: ChannelContentSafetyMode } = {},
): ChannelContentSafetyEvaluation {
  const mode = options.mode ?? "standard";
  if (!needsSafetyDialogue(text)) {
    return {
      verdict: "allow",
      mode,
      floor: "none",
      severity: "info",
      canOverride: false,
      requiresApproval: false,
      ...(mode === "developer-debug"
        ? {
            debugNotes: [
              "content-policy: 未命中硬改写规则",
              needsHumanTraffickingBoundary(text)
                ? "human-trafficking-boundary: 检测到题材，但已有批判框架或没有浪漫化结局"
                : "human-trafficking-boundary: 未检测到",
            ],
          }
        : {}),
    };
  }

  return {
    verdict: "rewrite-required",
    mode,
    floor: "hard",
    severity: "blocked",
    canOverride: false,
    requiresApproval: false,
    ruleId: "content.humanTrafficking.romanticized",
    reason: "不能把拐卖、买妻或强迫婚姻包装成美满爱情。",
    safeRewriteObjective: buildSafeRewriteObjective(text),
    auditEvent: "content-policy.rewrite-required.hard-floor",
    ...(mode === "developer-debug"
      ? {
          debugNotes: [
            "developer-debug: 显示命中规则和改写目标，但不会绕过硬底线",
            "floor: hard；canOverride: false；requiresApproval: false",
            "reference-pattern: Claude Code hook allow 不绕过总权限；OpenClaw dangerous flags 是窄范围 opt-in；Hermes break-glass 只用于本地工具审批",
            "matched: 拐卖/买妻题材 + 浪漫化结局 + 缺少批判框架",
          ],
        }
      : {}),
  };
}

export function needsSafetyDialogue(text: string): boolean {
  return (
    needsHumanTraffickingBoundary(text) &&
    hasRomanticizedHumanTraffickingFrame(text) &&
    !hasCriticalHumanTraffickingFrame(text)
  );
}

export function cleanUserFacingCommandText(value: string): string {
  const cleaned = value
    .replace(/^\/(?:制作|生产|创建|生成)\s*/u, "")
    .replace(/\s+needs operator review before execution handoff\.?$/giu, "")
    .trim();
  return cleaned.split(/\n(?:补充内容|执行意图|安全边界)[:：]/u)[0]?.trim() ?? cleaned;
}

export function buildSafeRewriteObjective(objective: string): string {
  const cleanedObjective = cleanUserFacingCommandText(objective);
  return [
    cleanedObjective.replace(
      /最终.*?(爱情美满|幸福美满|圆满|在一起|终成眷属)/giu,
      "结尾脱困与追责",
    ),
    "立场：批判拐卖、买妻和强迫婚姻，不美化施害者，不把受害者创伤包装成爱情",
    "结局：女性获得救助与主体性，施害者承担法律后果",
  ].join("；");
}
