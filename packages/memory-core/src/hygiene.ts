import type { MemoryScope, MemoryUpsertInput } from "./types.js";

export type UserMemoryCategory =
  | "chitchat"
  | "confirmation"
  | "production-task"
  | "learning-source"
  | "user-preference"
  | "user-profile"
  | "feedback"
  | "reference"
  | "conversation";

export type UserMemoryRetention = "none" | "working" | "user" | "quarantine";

export type UserMemoryAdmissionStatus = "store" | "drop" | "quarantine";

export type UserMemorySafetyFindingType =
  | "api-key"
  | "token"
  | "private-key"
  | "prompt-injection"
  | "invisible-unicode";

export interface UserMemorySafetyFinding {
  readonly type: UserMemorySafetyFindingType;
  readonly severity: "low" | "medium" | "high";
  readonly reason: string;
}

export interface UserMemorySafetyScan {
  readonly safe: boolean;
  readonly findings: readonly UserMemorySafetyFinding[];
}

export interface UserMemoryHygieneDecision {
  readonly status: UserMemoryAdmissionStatus;
  readonly category: UserMemoryCategory;
  readonly retention: UserMemoryRetention;
  readonly namespace: string;
  readonly tags: readonly string[];
  readonly reason: string;
  readonly confidence: number;
  readonly score: number;
  readonly safety: UserMemorySafetyScan;
  readonly redactedContent: string;
}

export interface MemoryAdmissionUpsertOptions {
  readonly id?: string;
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly timestamp?: number;
}

const LOW_VALUE_PATTERNS = [
  /^(?:你?好|hi|hello|hey|在吗|谢谢|谢了|辛苦|ok|okay|嗯+|啊+|哦+|好的|好|可以|收到|明白|测试|哈哈+|嘿嘿+|呵呵+)[。！!,.，\s]*$/iu,
  /^(?:确认|确认执行|继续|继续执行|执行|可以了|就这样)[。！!,.，\s]*$/u,
];

const CASUAL_SELF_REPORT_PATTERN =
  /^我(?:今天|刚刚|刚才|现在|之前|以前|最近)?(?:在)?(?:学习|学了|研究|看了|做了|制作)(?!.*(?:资料|链接|文件|目录|网页|经验库|总结|提炼|沉淀|记住|以后|默认|帮我|请你))/u;

const INVISIBLE_UNICODE_PATTERN = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const INVISIBLE_UNICODE_GLOBAL_PATTERN = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;

export function classifyUserMemoryInput(value: string): UserMemoryHygieneDecision {
  const text = normalizeUserMemoryText(value);
  const semanticText = stripLowValueInterjection(text);
  const safety = scanUserMemorySafety(value);

  if (text.length === 0) {
    return dropDecision("chitchat", "empty-input", safety, "");
  }

  if (!safety.safe) {
    const category = classifyUnsafeMemoryCategory(semanticText);
    return quarantineDecision(category, safety, redactUnsafeMemoryText(text));
  }

  if (LOW_VALUE_PATTERNS.some((pattern) => pattern.test(text))) {
    return dropDecision(
      text.includes("确认") || text.includes("继续") ? "confirmation" : "chitchat",
      "low-value-chatter",
      safety,
      text,
    );
  }

  if (CASUAL_SELF_REPORT_PATTERN.test(semanticText) && semanticText.length < 80) {
    return dropDecision("chitchat", "casual-self-report", safety, text);
  }

  if (isExplicitUserPreference(semanticText)) {
    return storeDecision(
      "user-preference",
      "user",
      "user-memory:preference",
      ["memory:user", "memory:preference", "memory:explicit"],
      safety,
      text,
      0.95,
    );
  }

  if (isExplicitUserProfile(semanticText)) {
    return storeDecision(
      "user-profile",
      "user",
      "user-memory:profile",
      ["memory:user", "memory:profile", "memory:explicit"],
      safety,
      text,
      0.93,
    );
  }

  if (isLearningSourceMemory(semanticText)) {
    return storeDecision(
      "learning-source",
      "working",
      "conversation:learning",
      ["memory:working", "memory:learning"],
      safety,
      text,
      0.88,
    );
  }

  if (isReferenceMemory(semanticText)) {
    return storeDecision(
      "reference",
      "working",
      "conversation:reference",
      ["memory:working", "memory:reference"],
      safety,
      text,
      0.84,
    );
  }

  if (isFeedbackMemory(semanticText)) {
    return storeDecision(
      "feedback",
      "working",
      "conversation:feedback",
      ["memory:working", "memory:feedback"],
      safety,
      text,
      0.82,
    );
  }

  if (isProductionTaskMemory(semanticText)) {
    return storeDecision(
      "production-task",
      "working",
      "conversation:task",
      ["memory:working", "memory:production-task"],
      safety,
      text,
      0.86,
    );
  }

  return dropDecision("conversation", "low-signal-conversation", safety, text);
}

export function toMemoryUpsertInput(
  decision: UserMemoryHygieneDecision,
  content: string,
  scope: MemoryScope,
  options: MemoryAdmissionUpsertOptions = {},
): MemoryUpsertInput | undefined {
  if (decision.retention === "none") {
    return undefined;
  }

  const normalizedContent = normalizeUserMemoryText(content);
  const admittedContent =
    decision.retention === "quarantine" ? decision.redactedContent : normalizedContent;

  if (admittedContent.length === 0) {
    return undefined;
  }

  const input: MemoryUpsertInput = {
    content: admittedContent,
    scope: {
      ...scope,
      namespace: decision.namespace,
    },
    tags: uniqueStrings([...decision.tags, ...(options.tags ?? [])]),
    metadata: {
      ...options.metadata,
      memoryAdmission: {
        category: decision.category,
        retention: decision.retention,
        confidence: decision.confidence,
        score: decision.score,
        reason: decision.reason,
        safety: decision.safety,
      },
    },
  };

  if (options.id !== undefined) {
    input.id = options.id;
  }
  if (options.timestamp !== undefined) {
    input.timestamp = options.timestamp;
  }

  return input;
}

function normalizeUserMemoryText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function stripLowValueInterjection(value: string): string {
  return value.replace(/^(?:哈哈+|嘿嘿+|呵呵+|嗯+|啊+|哦+)[，,。!！\s]*/u, "").trim();
}

function dropDecision(
  category: UserMemoryCategory,
  reason: string,
  safety: UserMemorySafetyScan,
  redactedContent: string,
): UserMemoryHygieneDecision {
  const confidence = 0.9;
  return {
    status: "drop",
    category,
    retention: "none",
    namespace: "memory:discarded",
    tags: ["memory:noise", `memory:${category}`],
    reason,
    confidence,
    score: confidence,
    safety,
    redactedContent,
  };
}

function storeDecision(
  category: UserMemoryCategory,
  retention: Exclude<UserMemoryRetention, "none">,
  namespace: string,
  tags: readonly string[],
  safety: UserMemorySafetyScan,
  redactedContent: string,
  confidence: number,
): UserMemoryHygieneDecision {
  return {
    status: "store",
    category,
    retention,
    namespace,
    tags,
    reason: `classified:${category}`,
    confidence,
    score: confidence,
    safety,
    redactedContent,
  };
}

function quarantineDecision(
  category: UserMemoryCategory,
  safety: UserMemorySafetyScan,
  redactedContent: string,
): UserMemoryHygieneDecision {
  const confidence = 0.98;
  return {
    status: "quarantine",
    category,
    retention: "quarantine",
    namespace: "memory:quarantine",
    tags: [
      "memory:quarantine",
      "memory:safety",
      `memory:${category}`,
      ...safety.findings.map((finding) => `safety:${finding.type}`),
    ],
    reason: "safety:quarantine",
    confidence,
    score: confidence,
    safety,
    redactedContent,
  };
}

function isExplicitUserPreference(text: string): boolean {
  return (
    /(?:记住|以后|以后都|默认|偏好|习惯|不要每次|回复风格|脚本要|回答要)/u.test(text) &&
    /(?:喜欢|不喜欢|偏好|习惯|默认|回复|回答|脚本|称呼|不要每次)/u.test(text)
  );
}

function isExplicitUserProfile(text: string): boolean {
  return (
    /(?:我的(?:名字|职业|公司|项目|账号|团队)(?:是|为|叫)|我叫|称呼我为)/u.test(text) ||
    /(?:我的工作(?:是|为)|我在.+(?:工作|公司|团队))/u.test(text) ||
    /我是.{1,24}(?:导演|编剧|开发者|工程师|设计师|创作者|学生|老师|经理|运营|剪辑|制片|摄影师)/u.test(
      text,
    )
  );
}

function isLearningSourceMemory(text: string): boolean {
  return /(?:^\/学习\b|学习这个|学习以下|去学习|请学习|帮我学习|从.+学习|经验库)/iu.test(text);
}

function isReferenceMemory(text: string): boolean {
  return /(?:参考|资料|链接|文档|出处|source|reference|https?:\/\/|file:\/\/|(?:^|[\s：:])\/(?:Users|Volumes|tmp|var)\/)/iu.test(
    text,
  );
}

function isFeedbackMemory(text: string): boolean {
  return (
    /(?:反馈|不对|错误|太慢|太快|不好|下次|改进|建议|问题|bug|体验|节奏|质量)/iu.test(text) ||
    /(?:这版|这个结果|输出|回答|脚本|分镜).{0,12}(很好|不错)/iu.test(text)
  );
}

function isProductionTaskMemory(text: string): boolean {
  return /(?:^\/(?:制作|生成|生产|创建)\b|制作|生成|分镜|短剧|脚本|镜头|视频|图片)/iu.test(text);
}

function classifyUnsafeMemoryCategory(text: string): UserMemoryCategory {
  if (isExplicitUserPreference(text)) {
    return "user-preference";
  }
  if (isExplicitUserProfile(text)) {
    return "user-profile";
  }
  if (isLearningSourceMemory(text)) {
    return "learning-source";
  }
  if (isReferenceMemory(text)) {
    return "reference";
  }
  if (isFeedbackMemory(text)) {
    return "feedback";
  }
  if (isProductionTaskMemory(text)) {
    return "production-task";
  }
  return "conversation";
}

function scanUserMemorySafety(value: string): UserMemorySafetyScan {
  const findings: UserMemorySafetyFinding[] = [];

  addFinding(findings, detectApiKey(value));
  addFinding(findings, detectToken(value));
  addFinding(findings, detectPrivateKey(value));
  addFinding(findings, detectPromptInjection(value));
  addFinding(findings, detectInvisibleUnicode(value));

  return {
    safe: findings.length === 0,
    findings,
  };
}

function addFinding(
  findings: UserMemorySafetyFinding[],
  finding: UserMemorySafetyFinding | undefined,
): void {
  if (finding && !findings.some((existing) => existing.type === finding.type)) {
    findings.push(finding);
  }
}

function detectApiKey(value: string): UserMemorySafetyFinding | undefined {
  if (
    /(?:api[\s_-]?key|apikey|secret[\s_-]?key)\s*(?:是|=|:)?\s*["']?(?:sk-[a-z0-9_-]{16,}|[a-z0-9_-]{32,})/iu.test(
      value,
    )
  ) {
    return {
      type: "api-key",
      severity: "high",
      reason: "credential-like-api-key",
    };
  }
  return undefined;
}

function detectToken(value: string): UserMemorySafetyFinding | undefined {
  if (
    /(?:token|bearer|authorization|access[_-]?token|refresh[_-]?token)\s*(?:是|=|:)?\s*["']?[a-z0-9._-]{24,}/iu.test(
      value,
    )
  ) {
    return {
      type: "token",
      severity: "high",
      reason: "credential-like-token",
    };
  }
  return undefined;
}

function detectPrivateKey(value: string): UserMemorySafetyFinding | undefined {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value)) {
    return {
      type: "private-key",
      severity: "high",
      reason: "private-key-block",
    };
  }
  return undefined;
}

function detectPromptInjection(value: string): UserMemorySafetyFinding | undefined {
  if (
    /(?:忽略|无视|覆盖).{0,12}(?:系统|以上|之前).{0,12}(?:指令|提示词|规则)|(?:reveal|print|show).{0,20}(?:system prompt|hidden prompt|developer message)|ignore.{0,20}(?:previous|above).{0,20}(?:instructions|rules)/iu.test(
      value,
    )
  ) {
    return {
      type: "prompt-injection",
      severity: "medium",
      reason: "prompt-injection-instruction",
    };
  }
  return undefined;
}

function detectInvisibleUnicode(value: string): UserMemorySafetyFinding | undefined {
  if (INVISIBLE_UNICODE_PATTERN.test(value)) {
    return {
      type: "invisible-unicode",
      severity: "medium",
      reason: "invisible-unicode-control-character",
    };
  }
  return undefined;
}

function redactUnsafeMemoryText(value: string): string {
  return normalizeUserMemoryText(value)
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
      "[redacted:private-key]",
    )
    .replace(
      /((?:api[\s_-]?key|apikey|secret[\s_-]?key)\s*(?:是|=|:)?\s*["']?)(?:sk-[a-z0-9_-]{16,}|[a-z0-9_-]{32,})/giu,
      "$1[redacted:api-key]",
    )
    .replace(
      /((?:token|bearer|authorization|access[_-]?token|refresh[_-]?token)\s*(?:是|=|:)?\s*["']?)[a-z0-9._-]{24,}/giu,
      "$1[redacted:token]",
    )
    .replace(INVISIBLE_UNICODE_GLOBAL_PATTERN, "");
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
