import type { ConversationRuntimeModelToolDefinition } from "./model-tool-loop.js";

export type ConversationRuntimeToolExposurePolicy =
  | "all"
  | "local-learning-evidence-only"
  | "disable-all";

export function resolveConversationRuntimeToolExposurePolicy(
  rawUserText: string,
): ConversationRuntimeToolExposurePolicy {
  const text = rawUserText.trim();
  if (text.length === 0) {
    return "all";
  }
  if (
    /(?:不要|不用|无需|别|禁止|不许|不能)[^。！？!?\n]{0,12}(?:调用|使用|执行|跑|开)[^。！？!?\n]{0,12}(?:外部)?(?:工具|tool|Tools|MCP|浏览器|搜索|检索|联网|网页|API)/iu.test(
      text,
    )
  ) {
    return "disable-all";
  }
  if (
    /(?:只|仅).{0,8}(?:基于|根据|看).{0,12}(?:上面|上文|前文|这段对话|当前对话|聊天记录|已有上下文|刚才).{0,18}(?:回答|说|解释|判断)?/iu.test(
      text,
    )
  ) {
    return looksLikeLocalLearningEvidenceOnlyRequest(text)
      ? "local-learning-evidence-only"
      : "disable-all";
  }
  if (looksLikeExplicitUrlRereadRequest(text)) {
    return "all";
  }
  if (
    /(?:不要|不用|无需|别)[^。！？!?\n]{0,12}(?:查|搜索|检索|联网|读取链接|重新读取|访问网页)/iu.test(
      text,
    )
  ) {
    return looksLikeLocalLearningEvidenceOnlyRequest(text)
      ? "local-learning-evidence-only"
      : "disable-all";
  }
  return "all";
}

export function shouldDisableConversationRuntimeToolsForUserInstruction(
  rawUserText: string,
): boolean {
  return resolveConversationRuntimeToolExposurePolicy(rawUserText) === "disable-all";
}

export function filterConversationRuntimeToolsForExposurePolicy(
  tools: readonly ConversationRuntimeModelToolDefinition[],
  policy: ConversationRuntimeToolExposurePolicy,
): readonly ConversationRuntimeModelToolDefinition[] {
  if (policy === "all") {
    return tools;
  }
  if (policy === "disable-all") {
    return [];
  }
  return tools.filter((tool) => isLocalLearningEvidenceTool(tool));
}

export function looksLikeLocalLearningEvidenceOnlyRequest(text: string): boolean {
  return (
    /(?:刚才|上一轮|上次|这次|最近|前面|这条|这篇|这个链接|该链接|候选|已学习|学习内容|学习结果|学到|学到了|证据|来源|媒体|图片|视频|全文|要点|摘要|总结|详情|收录|入库|经验|保存)/iu.test(
      text,
    ) &&
    /(?:学|学习|候选|证据|来源|媒体|图片|视频|全文|要点|摘要|总结|详情|收录|入库|经验|保存|值得)/iu.test(
      text,
    )
  );
}

export function isLocalLearningEvidenceTool(tool: ConversationRuntimeModelToolDefinition): boolean {
  return tool.name === "director.experience.candidates.list";
}

export function isLearningCollectionAdviceQuestion(rawText: string): boolean {
  const text = normalizeConversationRuntimePolicyText(rawText);
  if (text.length === 0 || isSpecificLearningEvidenceFieldQuestion(text)) {
    return false;
  }
  const valueQuestion =
    /(?:最值得保存|值得保存|值得.{0,8}(?:保存|收录|入库)|(?:保存|收录|入库).{0,8}(?:哪|哪些|什么|三点|价值|有用)|有用吗|有价值吗|有帮助吗)/iu.test(
      text,
    );
  const mentionsLearning =
    /(?:收录|保存|入库|经验|经验库|候选|学习|学到|资料|内容|帖子|推文|文章|链接)/iu.test(text);
  if (!mentionsLearning) {
    return false;
  }
  if (valueQuestion) {
    return true;
  }
  return /(?:要不要|是否|需不需要|值不值得|值得|可以不可以|能不能|该不该|有没有必要|有用吗|有价值吗|有帮助吗|哪些地方|哪里|哪点|最有用|怎么提炼|如何提炼|提炼成一句|一句可以进经验库)/iu.test(
    text,
  );
}

export function isReadOnlyLearningEvidenceFollowup(rawText: string): boolean {
  const text = normalizeConversationRuntimePolicyText(rawText);
  if (text.length === 0) {
    return false;
  }
  const asksSpecificLearningEvidence = isSpecificLearningEvidenceFieldQuestion(text);
  const asksKnownSourceIdentification =
    /(?:这是|这个|截图|图里|上面|下面|内容).{0,18}(?:哪个|哪条|什么).{0,18}(?:链接|URL|来源|帖子|推文|内容)|(?:哪个|哪条|什么).{0,18}(?:链接|URL|来源|帖子|推文)/iu.test(
      text,
    );
  if (isLearningCollectionAdviceQuestion(text)) {
    return false;
  }
  const hasLearningContext =
    extractFirstHttpUrl(text) !== null ||
    /(?:刚才|上一轮|上次|学习结果|学到了什么|学到什么|学到|学习|入库|候选|经验|已读|未理解)/iu.test(
      text,
    ) ||
    /(?:这个|该|那条|这条|那篇|这篇).{0,8}(?:链接|URL|url|来源|帖子|推文|文章|资料|内容)/iu.test(
      text,
    ) ||
    asksKnownSourceIdentification;
  const asksAnswerOnly =
    /(?:只|仅|直接|基于|请).{0,20}(?:回答|回复|列|列出|总结|告诉|读取|提取|看看|看详情|说明|解释)/iu.test(
      text,
    );
  const blocksSideEffects =
    /(?:不要|别|不必|不用|无需|禁止|不许|不能).{0,32}(?:执行|保存|收录|晋升|入库|沉淀|写入|创建候选|生成候选|拒绝|接受|发布|动作)/iu.test(
      text,
    );
  return (
    hasLearningContext &&
    (asksSpecificLearningEvidence ||
      asksKnownSourceIdentification ||
      (asksAnswerOnly && blocksSideEffects))
  );
}

export function isLearningConfirmationPrompt(rawText: string): boolean {
  const text = normalizeConversationRuntimePolicyText(rawText);
  if (text.length === 0 || isReadOnlyLearningEvidenceFollowup(text)) {
    return false;
  }
  if (isLearningCollectionAdviceQuestion(text)) {
    return false;
  }
  if (
    /(?:不要|别|先别|暂时别|不必|不用|无需|禁止|不许).{0,16}(?:存|保存|收录|接受|通过|入库|当经验|放进经验)/iu.test(
      text,
    )
  ) {
    return false;
  }
  const hasConfirmationVerb =
    /(?:保存|存起来|收录|接受|通过|确认|批准|入库|记下来|记住|纳入|归档|保留|留下)/iu.test(text);
  if (!hasConfirmationVerb) {
    return false;
  }
  if (/第\s*(?:[1-9]\d*|[一二两三四五六七八九十])\s*(?:条|个|项|篇|则)?/u.test(text)) {
    return true;
  }
  const hasLearningReference =
    /(?:刚才|上一轮|上次|前面|上面|这次|最近|学习|学到|学了|经验|候选|链接|帖子|推文|文章|资料)/iu.test(
      text,
    );
  const hasPersistenceVerb =
    /(?:保存|存起来|收录|入库|记下来|记住|纳入|归档|保留|留下|当经验|放进经验)/iu.test(text);
  const hasLearningPointer =
    /(?:这个|该|那条|这条|这篇|内容)/iu.test(text) &&
    /(?:学习|学到|学了|经验|候选|链接|帖子|推文|文章|资料)/iu.test(text);
  return hasLearningReference || (hasPersistenceVerb && hasLearningPointer);
}

function looksLikeExplicitUrlRereadRequest(text: string): boolean {
  return (
    /https?:\/\/[^\s"'<>]+/iu.test(text) &&
    /(?:重新|再次|继续|二次|完整|全文|全部|详细|直接|只).{0,16}(?:读取|提取|抽取|打开|总结|学习|学到|学到了)|(?:读取|提取|抽取|打开|总结|学习).{0,16}(?:全文|完整|全部|详细|这个链接|该链接|链接)/iu.test(
      text,
    )
  );
}

function isSpecificLearningEvidenceFieldQuestion(text: string): boolean {
  return /(?:证据字段|全文字符数|正文字符数|是否二次提取|二次提取|是否已入库|媒体是否(?:已)?理解|图片\/视频\/音频|poster|blob|full_body|fullBody)/iu.test(
    text,
  );
}

function normalizeConversationRuntimePolicyText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function extractFirstHttpUrl(value: string): string | null {
  return /https?:\/\/[^\s"'<>]+/iu.exec(value)?.[0] ?? null;
}
